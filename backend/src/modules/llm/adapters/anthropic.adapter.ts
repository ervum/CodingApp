import Anthropic from '@anthropic-ai/sdk';
import type {
  ContentBlockParam,
  MessageParam,
  Tool,
} from '@anthropic-ai/sdk/resources/messages';
import { Injectable } from '@nestjs/common';
import type { LlmModelInfoDto } from '@robdev/shared';
import { normalizeProviderError, streamWithPreStreamRetry } from '../llm-errors.js';
import type {
  LlmAdapter,
  LlmFinishReason,
  LlmMessage,
  LlmStreamEvent,
  LlmStreamRequest,
  ResolvedConnection,
} from './llm-adapter.interface.js';

@Injectable()
export class AnthropicAdapter implements LlmAdapter {
  private createClient(conn: ResolvedConnection): Anthropic {
    return new Anthropic({
      apiKey: conn.apiKey ?? '',
      ...(conn.baseUrl ? { baseURL: conn.baseUrl } : {}),
    });
  }

  async listModels(conn: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    try {
      const client = this.createClient(conn);
      const page = await client.models.list();
      const models: LlmModelInfoDto[] = [];
      for await (const item of page) {
        models.push({
          id: item.id,
          displayName: item.display_name || item.id,
          contextWindow: null,
          supportsTools: true,
          supportsImageOutput: false,
        });
      }
      return models;
    } catch (err) {
      throw normalizeProviderError(err);
    }
  }

  stream(
    conn: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    return streamWithPreStreamRetry(() => this.streamOnce(conn, req, signal), signal);
  }

  private async *streamOnce(
    conn: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const client = this.createClient(conn);
    const { system, messages } = this.mapMessages(req.messages);

    const tools: Tool[] | undefined =
      req.tools.length > 0
        ? req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: {
              type: 'object' as const,
              ...t.parameters,
            },
          }))
        : undefined;

    const stream = await client.messages.create(
      {
        model: req.model,
        ...(system ? { system } : {}),
        messages,
        ...(tools ? { tools } : {}),
        max_tokens: req.maxOutputTokens,
        stream: true,
      },
      { signal },
    );

    const activeTools = new Map<number, { id: string; name: string; json: string }>();
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason: LlmFinishReason = 'stop';

    for await (const event of stream) {
      if (event.type === 'message_start') {
        inputTokens += event.message.usage.input_tokens ?? 0;
        outputTokens += event.message.usage.output_tokens ?? 0;
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          activeTools.set(event.index, {
            id: block.id,
            name: block.name,
            json: '',
          });
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text-delta', text: delta.text };
        } else if (delta.type === 'input_json_delta') {
          const tool = activeTools.get(event.index);
          if (tool) {
            tool.json += delta.partial_json;
          }
        }
      } else if (event.type === 'content_block_stop') {
        const tool = activeTools.get(event.index);
        if (tool) {
          activeTools.delete(event.index);
          yield {
            type: 'tool-call',
            call: {
              id: tool.id,
              name: tool.name,
              argumentsJson: tool.json || '{}',
            },
          };
        }
      } else if (event.type === 'message_delta') {
        outputTokens = event.usage.output_tokens ?? outputTokens;
        if (event.delta.stop_reason === 'tool_use') {
          finishReason = 'tool_calls';
        } else if (event.delta.stop_reason === 'max_tokens') {
          finishReason = 'length';
        } else {
          finishReason = 'stop';
        }
      }
    }

    if (inputTokens > 0 || outputTokens > 0) {
      yield { type: 'usage', inputTokens, outputTokens };
    }
    yield { type: 'finish', reason: finishReason };
  }

  private mapMessages(rawMessages: LlmMessage[]): {
    system: string | undefined;
    messages: MessageParam[];
  } {
    const systemParts: string[] = [];
    const messages: MessageParam[] = [];

    for (const msg of rawMessages) {
      if (msg.role === 'system') {
        systemParts.push(msg.content);
        continue;
      }

      if (msg.role === 'user') {
        messages.push({ role: 'user', content: msg.content });
        continue;
      }

      if (msg.role === 'assistant') {
        const blocks: ContentBlockParam[] = [];
        if (msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            let parsedInput: unknown = {};
            try {
              parsedInput = JSON.parse(tc.argumentsJson);
            } catch {
              parsedInput = {};
            }
            blocks.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: parsedInput,
            });
          }
        }
        if (blocks.length > 0) {
          messages.push({ role: 'assistant', content: blocks });
        }
        continue;
      }

      if (msg.role === 'tool') {
        const hasImages = Boolean(msg.images && msg.images.length > 0);
        const toolResultBlock: ContentBlockParam = {
          type: 'tool_result',
          tool_use_id: msg.toolCallId,
          content: hasImages
            ? [
                { type: 'text', text: msg.content },
                ...(msg.images ?? [])
                  .filter((img) => Boolean(img.base64))
                  .map((img) => ({
                    type: 'image' as const,
                    source: {
                      type: 'base64' as const,
                      media_type: (img.mimeType === 'image/jpeg'
                        ? 'image/jpeg'
                        : 'image/png') as 'image/jpeg' | 'image/png',
                      data: img.base64,
                    },
                  })),
              ]
            : msg.content,
        };
        const prev = messages[messages.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
          prev.content.push(toolResultBlock);
        } else {
          messages.push({ role: 'user', content: [toolResultBlock] });
        }
      }
    }

    return {
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      messages,
    };
  }
}
