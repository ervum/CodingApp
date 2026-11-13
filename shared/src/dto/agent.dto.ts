import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, AgentStatus, AgentTool, ChatDirective, LlmProvider, MessageAuthor } from '../enums.js';
import type { ChatAttachment } from './chat.dto.js';

export interface AgentDto {
  id: Id; key: AgentKey; name: string; title: string; color: string; glyph: string; order: number;
  status: AgentStatus; isEnabled: boolean;
  currentTaskId: Id | null; currentTaskTitle: string | null; currentRunId: Id | null; currentGameId: Id | null;
  lastActivityAt: IsoDateString | null; lastSnippet: string | null;
  modelLabel: string | null;          // e.g. "Anthropic · <modelId>" or null when unbound
  lastErrorCode: string | null;
}
export interface AgentVaultBindingDto { documentId: Id; path: string; title: string; priority: number; }
export interface AgentDetailDto extends AgentDto {
  description: string; systemPrompt: string; tools: AgentTool[];
  llmConnectionId: Id | null; provider: LlmProvider | null; modelId: string | null; temperature: number; maxOutputTokens: number;
  imageConnectionId: Id | null; imageModelId: string | null;
  vaultBindings: AgentVaultBindingDto[];
}
export interface AgentMessageDto {
  id: Id;
  agentKey: AgentKey;
  author: MessageAuthor;
  userDisplayName: string | null;
  body: string;
  taskId: Id | null;
  archiveId?: Id | null;
  attachments?: ChatAttachment[];
  directives?: ChatDirective[];
  createdAt: IsoDateString;
}
