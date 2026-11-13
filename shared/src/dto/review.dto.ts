import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, BlockerSeverity, BlockerStatus, ReviewKind, ReviewStatus, ReviewTab, Verdict } from '../enums.js';

export interface MediaDto { id: Id; url: string; mimeType: string; width: number | null; height: number | null; bytes: number; durationSec: number | null; }
export interface ReviewItemDto {
  id: Id; kind: ReviewKind; tab: ReviewTab; status: ReviewStatus; title: string;
  gameId: Id | null; gameName: string | null; madeByAgentKey: AgentKey | null;
  media: MediaDto | null; iteration: number; openBlockers: number; openFixFirst: number;
  createdAt: IsoDateString; updatedAt: IsoDateString;
}
export interface StageChecklistItem { label: string; done: boolean; }
export interface StagePayload { buildVersion: number | null; checklist: StageChecklistItem[]; }
export interface ReviewAnnotationDto { x: number; y: number; w: number; h: number; note: string; }
export interface ReviewVerdictDto {
  id: Id; verdict: Verdict; feedback: string | null; userDisplayName: string; createdAt: IsoDateString;
  annotations?: ReviewAnnotationDto[];
}
export interface BlockerDto { id: Id; severity: BlockerSeverity; status: BlockerStatus; title: string; detail: string; agentKey: AgentKey | null; buildVersion: number | null; createdAt: IsoDateString; }
export interface ReviewItemDetailDto extends ReviewItemDto {
  description: string; payload: StagePayload | null; verdicts: ReviewVerdictDto[]; blockers: BlockerDto[];
  previousIterations: Array<{
    id: Id; iteration: number; status: ReviewStatus; createdAt: IsoDateString;
    media?: MediaDto | null; lastFeedback?: string | null;
  }>;
  taskId: Id | null; runId: Id | null;
}
export interface ReviewCountsDto {
  toReview: number; changesAsked: number; approved: number; rejected: number; all: number;
  byTab: Record<ReviewTab, { toReview: number; all: number }>;
}
