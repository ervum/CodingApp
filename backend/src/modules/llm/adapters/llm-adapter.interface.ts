import type { AgentKey, LlmModelInfoDto, LlmProvider } from '@robdev/shared';

export interface LlmToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  id: string;
  name: string;
  argumentsJson: string;
}

export interface LlmImageAttachment {
  mediaId?: string;
  mimeType: string;
  base64: string;
  filePath?: string;
  width?: number;
  height?: number;
}

export type LlmMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string; images?: LlmImageAttachment[] }
  | { role: 'assistant'; content: string; toolCalls?: LlmToolCall[] }
  | {
      role: 'tool';
      toolCallId: string;
      name: string;
      content: string;
      images?: LlmImageAttachment[];
    };

export interface LlmStreamRequest {
  model: string;
  messages: LlmMessage[];
  tools: LlmToolDef[];
  temperature: number;
  maxOutputTokens: number;
  runId?: string;
  studioId?: string;
  taskId?: string;
  rootTaskId?: string;
  agentId?: string;
  agentKey?: AgentKey;
  agentName?: string;
  taskTitle?: string;
  turnIndex?: number;
  forceNewWebChat?: boolean;
}

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter';

export type LlmStreamEvent =
  | { type: 'status'; statusText: string }
  | {
      type: 'thinking';
      text: string;
      startedAt: string;
      durationMs: number;
      done: boolean;
    }
  | { type: 'text-delta'; text: string; replace?: boolean }
  | { type: 'tool-call'; call: LlmToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason: LlmFinishReason };

export interface ResolvedConnection {
  id: string;
  provider: LlmProvider;
  baseUrl: string | null;
  apiKey: string | null;
}

export interface LlmAdapter {
  listModels(conn: ResolvedConnection): Promise<LlmModelInfoDto[]>;
  stream(
    conn: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent>;
}

export interface BoundLlmAdapter {
  listModels(): Promise<LlmModelInfoDto[]>;
  stream(req: LlmStreamRequest, signal: AbortSignal): AsyncIterable<LlmStreamEvent>;
}

export type LlmErrorCode =
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_BAD_REQUEST';

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
