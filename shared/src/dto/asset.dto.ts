import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, StudioAssetKind } from '../enums.js';

export interface StudioAssetDto {
  id: Id;
  studioId: Id;
  kind: StudioAssetKind;
  name: string;
  tags: string[];
  mediaId: Id | null;
  mediaUrl: string | null;
  mimeType: string | null;
  robloxAssetId: string | null;
  notes: string;
  curatedByAgentKey: AgentKey | null;
  createdAt: IsoDateString;
}
