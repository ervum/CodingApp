import { GoogleGenAI, type Content, type Part } from '@google/genai';
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
export class GoogleAdapter implements LlmAdapter {
  private createClient(conn: ResolvedConnection): GoogleGenAI {
    return new GoogleGenAI({
      apiKey: conn.apiKey ?? '',
    });
  }

  async listModels(conn: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    try {
      const ai = this.createClient(conn);
      const pager = await ai.models.list();
      const models: LlmModelInfoDto[] = [];
      for await (const m of pager) {
        const name = (m.name ?? '').replace(/^models\//, '');
        if (!name) continue;
        const actions = m.supportedActions ?? [];
        if (actions.length > 0 && !actions.includes('generateContent')) {
          continue;
        }
        models.push({
          id: name,
          displayName: m.displayName || name,
          contextWindow: m.inputTokenLimit ?? null,
          supportsTools: true,
          supportsImageOutput: name.toLowerCase().includes('image'),
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
    const ai = this.createClient(conn);
    const { systemInstruction, contents } = this.mapMessages(req.messages);

    const stream = await ai.models.generateContentStream({
      model: req.model,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(req.tools.length > 0
          ? {
              tools: [
                {
                  functionDeclarations: req.tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parametersJsonSchema: t.parameters,
                  })),
                },
              ],
            }
          : {}),
        temperature: req.temperature,
        maxOutputTokens: req.maxOutputTokens,
        abortSignal: signal,
      },
    });

    let callCounter = 0;
    let sawToolCalls = false;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    let finishReason: LlmFinishReason = 'stop';

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        yield { type: 'text-delta', text };
      }

      const fnCalls = chunk.functionCalls;
      if (fnCalls && fnCalls.length > 0) {
        for (const fc of fnCalls) {
          callCounter++;
          sawToolCalls = true;
          yield {
            type: 'tool-call',
            call: {
              id: fc.id ?? `call_${callCounter}`,
              name: fc.name ?? 'unknown',
              argumentsJson: JSON.stringify(fc.args ?? {}),
            },
          };
        }
      }

      if (chunk.usageMetadata) {
        lastInputTokens = chunk.usageMetadata.promptTokenCount ?? lastInputTokens;
        lastOutputTokens = chunk.usageMetadata.candidatesTokenCount ?? lastOutputTokens;
      }

      const candReason = chunk.candidates?.[0]?.finishReason;
      if (candReason) {
        if (candReason === 'MAX_TOKENS') {
          finishReason = 'length';
        } else if (candReason === 'SAFETY') {
          finishReason = 'content_filter';
        } else {
          finishReason = 'stop';
        }
      }
    }

    if (sawToolCalls && finishReason === 'stop') {
      finishReason = 'tool_calls';
    }

    if (lastInputTokens > 0 || lastOutputTokens > 0) {
      yield {
        type: 'usage',
        inputTokens: lastInputTokens,
        outputTokens: lastOutputTokens,
      };
    }

    yield { type: 'finish', reason: finishReason };
  }

  private mapMessages(rawMessages: LlmMessage[]): {
    systemInstruction: string | undefined;
    contents: Content[];
  } {
    const systemParts: string[] = [];
    const contents: Content[] = [];

    for (const msg of rawMessages) {
      if (msg.role === 'system') {
        systemParts.push(msg.content);
        continue;
      }
      if (msg.role === 'user') {
        const parts: Part[] = [{ text: msg.content }];
        if (msg.images && msg.images.length > 0) {
          for (const img of msg.images) {
            if (img.base64) {
              parts.push({
                inlineData: {
                  mimeType: img.mimeType || 'image/png',
                  data: img.base64,
                },
              });
            }
          }
        }
        contents.push({
          role: 'user',
          parts,
        });
        continue;
      }
      if (msg.role === 'assistant') {
        const parts: Part[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.argumentsJson) as Record<string, unknown>;
            } catch {
              args = {};
            }
            parts.push({
              functionCall: {
                id: tc.id,
                name: tc.name,
                args,
              },
            });
          }
        }
        if (parts.length > 0) {
          contents.push({ role: 'model', parts });
        }
        continue;
      }
      if (msg.role === 'tool') {
        let parsedResponse: Record<string, unknown> = {};
        try {
          parsedResponse = JSON.parse(msg.content) as Record<string, unknown>;
        } catch {
          parsedResponse = { raw: msg.content };
        }
        const parts: Part[] = [
          {
            functionResponse: {
              id: msg.toolCallId,
              name: msg.name,
              response: parsedResponse,
            },
          },
        ];
        if (msg.images && msg.images.length > 0) {
          for (const img of msg.images) {
            if (img.base64) {
              parts.push({
                inlineData: {
                  mimeType: img.mimeType || 'image/png',
                  data: img.base64,
                },
              });
            }
          }
        }
        contents.push({
          role: 'user',
          parts,
        });
      }
    }

    return {
      systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      contents,
    };
  }
}
