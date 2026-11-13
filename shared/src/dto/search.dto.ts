import type { Id } from './common.dto.js';

export type QuickJumpType = 'route' | 'agent' | 'game' | 'doc' | 'pitch' | 'task' | 'review';
export interface QuickJumpResultDto { type: QuickJumpType; id: Id; label: string; sublabel: string; route: string; }
