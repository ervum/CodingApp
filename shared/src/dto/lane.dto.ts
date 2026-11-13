import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey } from '../enums.js';

export interface StudioLaneDto { id: Id; name: string; sortOrder: number; heldByAgentKey: AgentKey | null; heldForGameId: Id | null; heldByRunId: Id | null; heldSince: IsoDateString | null; }
