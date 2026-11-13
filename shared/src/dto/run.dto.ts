import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, AgentTool, LlmProvider, LogEntryKind, RunStatus } from '../enums.js';

export interface InjectedDocRef { documentId: Id; path: string; version: number; estimatedTokens: number; truncated: boolean; }
export interface CreatedDeliverableMeta {
  kind: 'artifact' | 'vault_doc' | 'image' | 'review_item' | 'pitch' | 'build';
  id?: Id;
  path?: string;
  title?: string;
  language?: string;
  content?: string;
  bytes?: number;
  mediaId?: Id;
  version?: number;
  agentComment?: string | null;
}
export interface RunLogMeta {
  tool?: AgentTool; toolCallId?: string; args?: unknown; ok?: boolean; durationMs?: number;
  errorCode?: string; resultContent?: string; docs?: InjectedDocRef[]; handoffTaskId?: Id; handoffAgentKey?: AgentKey;
  usage?: { inputTokens: number; outputTokens: number };
  isThinking?: boolean;
  thinkingStartedAt?: IsoDateString;
  thinkingDurationMs?: number;
  thinkingFinished?: boolean;
  createdArtifact?: CreatedDeliverableMeta;
  runConfig?: {
    provider: LlmProvider;
    modelId: string;
    llmConnectionId?: Id | null;
    temperature?: number;
    maxOutputTokens?: number;
  };
  promptTokens?: {
    userPrompt: number;
    vaultContext: number;
    systemRules: number;
    toolsAndContext: number;
  };
}
export interface RunLogEntryDto { id: Id; runId: Id; seq: number; kind: LogEntryKind; content: string; meta: RunLogMeta | null; createdAt: IsoDateString; }
export interface RunArtifactDto { id: Id; path: string; language: string; content: string; bytes: number; agentComment?: string | null; createdAt: IsoDateString; }
export interface AgentRunSummaryDto {
  id: Id; taskId: Id; taskTitle: string; taskBrief?: string; agentKey: AgentKey; status: RunStatus; provider: LlmProvider; modelId: string; attempt: number;
  archiveId?: Id | null; llmConnectionId?: Id | null; temperature?: number | null; maxOutputTokens?: number | null;
  startedAt: IsoDateString; finishedAt: IsoDateString | null; inputTokens: number; outputTokens: number; costUsd?: number | null; toolCallCount: number;
  summary: string | null; errorCode: string | null; errorMessage: string | null;
}
export interface AgentRunDetailDto extends AgentRunSummaryDto { entries: RunLogEntryDto[]; artifacts: RunArtifactDto[]; injectedDocs: InjectedDocRef[]; }
export interface LiveRunDto { runId: Id; taskId: Id; taskTitle: string; agentKey: AgentKey; gameId: Id | null; startedAt: IsoDateString; lastSnippet: string | null; laneName: string | null; }
