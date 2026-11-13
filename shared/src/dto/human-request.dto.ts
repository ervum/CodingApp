import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, HumanRequestKind, HumanRequestStatus } from '../enums.js';

export interface HumanRequestOption { id: string; label: string; }
export interface HumanRequestDto {
  id: Id; kind: HumanRequestKind; status: HumanRequestStatus; title: string; body: string;
  gameId: Id | null; agentKey: AgentKey | null; taskId: Id | null;
  options: HumanRequestOption[]; pitchIds: Id[]; buildVersion: number | null;
  resolution: string | null; createdAt: IsoDateString; resolvedAt: IsoDateString | null;
}
