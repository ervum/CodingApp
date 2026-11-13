import type { AgentKey, ContextMode } from '../enums.js';
import type { Id, IsoDateString } from './common.dto.js';

export interface WorkspaceTreeNodeDto {
  path: string;
  name: string;
  kind: 'folder' | 'file';
  extension: string;
  language: string;
  bytes: number;
  lineCount: number;
  fileCount?: number;
  versionCount: number;
  commentCount: number;
  createdAt: IsoDateString | null;
  updatedAt: IsoDateString | null;
  lastModifiedByAgentKey: AgentKey | null;
  lastModifiedByAgentName: string | null;
  lastTaskTitle: string | null;
  latestAgentComment: string | null;
  className: string | null;
  children?: WorkspaceTreeNodeDto[];
}

export interface WorkspaceOverviewDto {
  studioId: Id;
  studioSlug: string;
  workspaceRoot: string;
  contextMode: ContextMode;
  totalFiles: number;
  totalFolders: number;
  totalBytes: number;
  totalVersions: number;
  totalComments: number;
  languages: Array<{ language: string; count: number; bytes: number }>;
  tree: WorkspaceTreeNodeDto[];
}

export interface WorkspaceFileVersionDto {
  version: number;
  artifactId: Id | null;
  runId: Id | null;
  taskId: Id | null;
  taskTitle: string | null;
  agentKey: AgentKey | null;
  agentName: string | null;
  language: string;
  bytes: number;
  lineCount: number;
  sha256: string;
  content: string;
  agentComment: string | null;
  createdAt: IsoDateString;
  source: 'artifact' | 'disk';
}

export interface WorkspaceFileCommentDto {
  id: Id;
  filePath: string;
  authorKind: 'AGENT' | 'USER';
  agentKey: AgentKey | null;
  authorName: string;
  body: string;
  lineStart: number | null;
  lineEnd: number | null;
  runId: Id | null;
  taskId: Id | null;
  createdAt: IsoDateString;
}

export interface WorkspaceFileMiscInfoDto {
  diskPath: string;
  relativePath: string;
  existsOnDisk: boolean;
  encoding: string;
  lineEndings: 'LF' | 'CRLF' | 'MIXED' | 'NONE';
  sha256: string;
  lineCount: number;
  wordCount: number;
  charCount: number;
  estimatedTokens: number;
  className: string | null;
  companionPropertiesYaml: string | null;
  exportedSymbols: string[];
  contributingAgents: Array<{
    agentKey: AgentKey;
    agentName: string;
    versionCount: number;
    lastTouchedAt: IsoDateString;
  }>;
}

export interface WorkspaceFileDetailDto {
  path: string;
  name: string;
  extension: string;
  language: string;
  currentVersion: number;
  content: string;
  bytes: number;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
  versions: WorkspaceFileVersionDto[];
  comments: WorkspaceFileCommentDto[];
  misc: WorkspaceFileMiscInfoDto;
}
