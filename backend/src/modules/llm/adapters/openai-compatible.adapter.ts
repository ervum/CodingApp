import { Injectable } from '@nestjs/common';
import type { LlmModelInfoDto } from '@robdev/shared';
import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { normalizeProviderError, streamWithPreStreamRetry } from '../llm-errors.js';
import { DEFAULT_BASE_URL } from '../provider-defaults.js';
import type {
  LlmAdapter,
  LlmFinishReason,
  LlmMessage,
  LlmStreamEvent,
  LlmStreamRequest,
  LlmToolCall,
  ResolvedConnection,
} from './llm-adapter.interface.js';
import { PromptToolBridge } from './prompt-tool-bridge.js';

@Injectable()
export class OpenAiCompatibleAdapter implements LlmAdapter {
  private createClient(conn: ResolvedConnection): OpenAI {
    const baseURL = conn.baseUrl ?? DEFAULT_BASE_URL[conn.provider] ?? undefined;
    return new OpenAI({
      apiKey: conn.apiKey ?? 'local-no-key',
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async listModels(conn: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    try {
      const client = this.createClient(conn);
      const page = await client.models.list();
      const models: LlmModelInfoDto[] = [];
      for await (const model of page) {
        models.push({
          id: model.id,
          displayName: model.id,
          contextWindow: null,
          supportsTools: true,
          supportsImageOutput: true,
        });
      }
      if (models.length > 0) {
        return models.sort((a, b) => a.id.localeCompare(b.id));
      }
    } catch (err) {
      if (conn.provider !== 'OLLAMA' && conn.provider !== 'RUNPOD' && conn.provider !== 'OPENAI_COMPATIBLE') {
        throw normalizeProviderError(err);
      }
    }

    const baseUrl = conn.baseUrl ?? DEFAULT_BASE_URL[conn.provider];
    if (baseUrl) {
      const ollamaTags = await this.tryListOllamaTags(baseUrl);
      if (ollamaTags.length > 0) {
        return ollamaTags;
      }
    }

    if (conn.provider === 'OLLAMA' || conn.provider === 'RUNPOD' || conn.provider === 'OPENAI_COMPATIBLE') {
      return [
        {
          id: 'default-model',
          displayName: 'default-model (type your loaded model ID in bindings)',
          contextWindow: null,
          supportsTools: true,
          supportsImageOutput: true,
        },
      ];
    }

    return [];
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
    const usePromptBridgeByDefault =
      (conn.provider === 'OLLAMA' || conn.provider === 'RUNPOD') && req.tools.length > 0;

    if (usePromptBridgeByDefault) {
      yield* this.streamWithPromptBridge(conn, req, signal);
      return;
    }

    try {
      yield* this.streamWithNativeTools(conn, req, signal);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (req.tools.length > 0 && (status === 400 || status === 422 || status === 501)) {
        yield* this.streamWithPromptBridge(conn, req, signal);
        return;
      }
      throw err;
    }
  }

  private async *streamWithPromptBridge(
    conn: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const client = this.createClient(conn);
    const bridgedMessages = PromptToolBridge.injectToolsIntoMessages(req.messages, req.tools);
    const messages = this.toOpenAiMessages(bridgedMessages);

    const stream = await client.chat.completions.create(
      {
        model: req.model,
        messages,
        stream: true,
        temperature: req.temperature,
        max_tokens: req.maxOutputTokens,
      },
      { signal },
    );

    let fullText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        fullText += delta;
        if (!fullText.includes('<tool_call>')) {
          yield { type: 'text-delta', text: delta };
        }
      }
      if (chunk.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }

    const extracted = PromptToolBridge.extractToolCallsFromText(fullText);
    if (fullText.includes('<tool_call>') && extracted.cleanText) {
      yield { type: 'text-delta', text: extracted.cleanText };
    }
    for (const call of extracted.toolCalls) {
      yield { type: 'tool-call', call };
    }
    yield {
      type: 'finish',
      reason: extracted.toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  private async *streamWithNativeTools(
    conn: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const client = this.createClient(conn);
    const messages = this.toOpenAiMessages(req.messages);

    const tools: ChatCompletionTool[] | undefined =
      req.tools.length > 0
        ? req.tools.map((t) => ({
            type: 'function' as const,
            function: {
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            },
          }))
        : undefined;

    const stream = await client.chat.completions.create(
      {
        model: req.model,
        messages,
        ...(tools ? { tools } : {}),
        stream: true,
        stream_options: { include_usage: true },
        temperature: req.temperature,
        ...(conn.provider === 'OPENAI'
          ? { max_completion_tokens: req.maxOutputTokens }
          : { max_tokens: req.maxOutputTokens }),
      },
      { signal },
    );

    const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
    let emittedToolCalls = false;
    let finishReason: LlmFinishReason = 'stop';

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice) {
        const delta = choice.delta;
        if (delta?.content) {
          yield { type: 'text-delta', text: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            const existing = toolCallMap.get(idx) ?? {
              id: tc.id ?? `call_${idx}`,
              name: tc.function?.name ?? '',
              args: '',
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolCallMap.set(idx, existing);
          }
        }
        if (choice.finish_reason) {
          finishReason = this.mapFinishReason(choice.finish_reason);
          if (choice.finish_reason === 'tool_calls' && !emittedToolCalls) {
            emittedToolCalls = true;
            for (const call of this.flushToolCalls(toolCallMap)) {
              yield { type: 'tool-call', call };
            }
          }
        }
      }
      if (chunk.usage) {
        yield {
          type: 'usage',
          inputTokens: chunk.usage.prompt_tokens ?? 0,
          outputTokens: chunk.usage.completion_tokens ?? 0,
        };
      }
    }

    if (!emittedToolCalls && toolCallMap.size > 0) {
      for (const call of this.flushToolCalls(toolCallMap)) {
        yield { type: 'tool-call', call };
      }
      finishReason = 'tool_calls';
    }

    yield { type: 'finish', reason: finishReason };
  }

  private toOpenAiMessages(messages: LlmMessage[]): ChatCompletionMessageParam[] {
    const out: ChatCompletionMessageParam[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        out.push({ role: 'system', content: m.content });
        continue;
      }
      if (m.role === 'user') {
        if (m.images && m.images.length > 0) {
          out.push({
            role: 'user',
            content: [
              { type: 'text', text: m.content },
              ...m.images
                .filter((img) => Boolean(img.base64))
                .map((img) => ({
                  type: 'image_url' as const,
                  image_url: {
                    url: `data:${img.mimeType || 'image/png'};base64,${img.base64}`,
                  },
                })),
            ],
          });
        } else {
          out.push({ role: 'user', content: m.content });
        }
        continue;
      }
      if (m.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: m.content || null,
          ...(m.toolCalls && m.toolCalls.length > 0
            ? {
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: 'function' as const,
                  function: {
                    name: tc.name,
                    arguments: tc.argumentsJson,
                  },
                })),
              }
            : {}),
        });
        continue;
      }
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content,
      });
      if (m.images && m.images.length > 0) {
        out.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `[Visual screenshot from tool "${m.name}"]`,
            },
            ...m.images
              .filter((img) => Boolean(img.base64))
              .map((img) => ({
                type: 'image_url' as const,
                image_url: {
                  url: `data:${img.mimeType || 'image/png'};base64,${img.base64}`,
                },
              })),
          ],
        });
      }
    }
    return out;
  }

  private async tryListOllamaTags(baseUrl: string): Promise<LlmModelInfoDto[]> {
    try {
      const root = baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
      const res = await fetch(`${root}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return [];
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      if (!Array.isArray(data.models)) return [];
      return data.models
        .map((m) => m.name ?? '')
        .filter(Boolean)
        .map((name) => ({
          id: name,
          displayName: name,
          contextWindow: null,
          supportsTools: true,
          supportsImageOutput: true,
        }));
    } catch {
      return [];
    }
  }

  private flushToolCalls(
    map: Map<number, { id: string; name: string; args: string }>,
  ): LlmToolCall[] {
    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => ({
        id: v.id,
        name: v.name,
        argumentsJson: v.args || '{}',
      }));
  }

  private mapFinishReason(raw: string): LlmFinishReason {
    switch (raw) {
      case 'tool_calls':
        return 'tool_calls';
      case 'length':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      default:
        return 'stop';
    }
  }
}
