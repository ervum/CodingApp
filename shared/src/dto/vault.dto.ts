import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, AuthorKind } from '../enums.js';

export interface VaultTreeNodeDto {
  type: 'folder' | 'document'; id: Id; name: string; path: string; sortOrder: number;
  wordCount?: number; children?: VaultTreeNodeDto[];
}
export interface VaultLinkRefDto { documentId: Id; path: string; title: string; }
export interface VaultOutlinkDto { targetPath: string; resolvedDocumentId: Id | null; }
export interface VaultLinkedAgentDto { agentKey: AgentKey; priority: number | null; source: 'BINDING' | 'ALWAYS' | 'RECENT_INJECTION'; lastInjectedAt: IsoDateString | null; }
export interface VaultDocumentDto {
  id: Id; folderId: Id; path: string; title: string; markdown: string; version: number;
  wordCount: number; charCount: number; tags: string[]; alwaysInject: boolean; updatedAt: IsoDateString;
  updatedBy: { kind: AuthorKind; label: string };
  backlinks: VaultLinkRefDto[]; outlinks: VaultOutlinkDto[]; linkedAgents: VaultLinkedAgentDto[];
}
export interface VaultRevisionDto { version: number; authorKind: AuthorKind; authorLabel: string; reason: string | null; createdAt: IsoDateString; wordCount: number; }
export interface VaultSearchHitDto { documentId: Id; path: string; title: string; snippet: string; score: number; }
export interface VaultGraphNodeDto {
  id: Id;
  title: string;
  path: string;
  folderName: string;
  wordCount: number;
  alwaysInject: boolean;
  boundAgents: AgentKey[];
}
export interface VaultGraphEdgeDto {
  from: Id;
  to: Id | null;
  targetPath: string;
  broken: boolean;
}
export interface VaultGraphDto {
  nodes: VaultGraphNodeDto[];
  edges: VaultGraphEdgeDto[];
}
export interface LibraryAssetDto {
  id: string;
  name: string;
  kind: 'Models' | 'Icons' | 'Audio' | 'UI';
  rbxAssetId: string;
  tags: string[];
  scope: string;
  previewType: 'aura' | 'arena' | 'shop' | 'waveform';
  description: string;
}
export interface LibrarySystemDto {
  id: string;
  name: string;
  category: string;
  summary: string;
  specs: string[];
  usedIn: string[];
}
