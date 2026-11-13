import type { AgentKey, ChatArchiveKind, ChatDirective } from '../enums.js';
import type { AgentMessageDto } from './agent.dto.js';
import type { Id, IsoDateString } from './common.dto.js';
import type { AgentRunDetailDto, AgentRunSummaryDto } from './run.dto.js';

export type ChatAttachment =
  | { kind: 'vault_doc'; documentId: Id; path: string; title: string }
  | { kind: 'workspace_file'; path: string; relPath?: string; bytes?: number }
  | { kind: 'workspace_folder'; path: string; relPath?: string; fileCount?: number }
  | { kind: 'game'; gameId: Id; name: string }
  | { kind: 'task'; taskId: Id; title: string }
  | { kind: 'chat_artifact'; path: string; runId?: Id | null; artifactId?: Id; language?: string }
  | { kind: 'upload_file'; uploadId: Id; name: string; mimeType: string; bytes: number; relativePath?: string; relPath?: string }
  | { kind: 'upload_folder'; uploadId: Id; rootName: string; name?: string; fileCount: number; bytes: number; totalBytes?: number }
  | { kind: 'local_folder'; absPath: string; name?: string }
  | { kind: 'image'; mediaId: Id; name: string; mimeType?: string; width?: number; height?: number; previewUrl?: string; source?: 'screenshot' | 'upload' | 'paste' };

export interface ChatArchiveSummaryDto {
  id: Id;
  agentKey: AgentKey;
  kind: ChatArchiveKind;
  number: number;
  label: string;
  turnCount: number;
  messageCount: number;
  runCount: number;
  firstPromptExcerpt: string | null;
  previewSnippet?: string | null;
  createdAt: IsoDateString;
}

export interface ChatArchiveDetailDto extends ChatArchiveSummaryDto {
  messages: AgentMessageDto[];
  runs: AgentRunDetailDto[];
  runDetails?: AgentRunDetailDto[];
}

export interface ChatTurnRef {
  taskId: Id | null;
  promptMessageId: Id | null;
  runIds: Id[];
}

export interface ChatMentionItemDto {
  id?: string;
  kind?: string;
  group?: 'vault' | 'workspace_file' | 'workspace_folder' | 'game' | 'task' | 'artifact';
  label: string;
  detail?: string | null;
  sublabel?: string | null;
  autoInjected?: boolean;
  attachment: ChatAttachment;
}

export interface ChatComposerPayload {
  body: string;
  attachments: ChatAttachment[];
  directives: ChatDirective[];
}
