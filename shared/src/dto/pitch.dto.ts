import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, PitchSectionKey, PitchStatus } from '../enums.js';

export interface PitchMetric { label: string; value: string; tone: 'neutral' | 'positive' | 'warning'; }
export interface PitchComparable { universeId: string; name: string; ccu?: string; growth7d?: string; likes?: string; gap?: string; }
export interface PitchSectionDto { key: PitchSectionKey; title: string; markdown: string; sortOrder: number; }
export interface PitchGameSpecRow { label: string; value: string; }
export interface PitchDto {
  id: Id; title: string; logline: string; genre: string; status: PitchStatus; createdByAgentKey: AgentKey | null;
  metrics: PitchMetric[]; whatChanged: string; howDifferent: string; comparables: PitchComparable[];
  feedback: string | null; pickedGameId: Id | null; createdAt: IsoDateString; updatedAt: IsoDateString;
}
export interface PitchDetailDto extends PitchDto { sections: PitchSectionDto[]; }
