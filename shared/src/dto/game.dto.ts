import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, BuildKind, GameStatus, MilestoneStatus, MobilePassStatus } from '../enums.js';

export interface GameDto {
  id: Id; slug: string; name: string; genre: string; status: GameStatus; accentColor: string;
  iconUrl: string | null;
  latestSavedVersion: number | null;
  latestPublishedVersion: number | null;
  milestonesDone: number; milestonesTotal: number; progressPct: number; // 0..100 integer
  currentStage: string | null;     // title of first IN_PROGRESS milestone, else next TODO
  laneName: string | null;         // Studio lane currently held for this game
  laneAgentKey: AgentKey | null;
  robloxPlaceId: string | null;
  playUrl: string | null;          // https://www.roblox.com/games/{placeId}
  updatedAt: IsoDateString;
}
export interface GameMilestoneDto { id: Id; key: string; title: string; sortOrder: number; status: MilestoneStatus; completedAt: IsoDateString | null; }
export interface GameBuildDto {
  id: Id; version: number; kind: BuildKind; notes: string; createdByAgentKey: AgentKey | null; createdByUserName: string | null;
  mobilePassA: MobilePassStatus; mobilePassB: MobilePassStatus; createdAt: IsoDateString;
}
export interface GameDetailDto extends GameDto { description: string; robloxUniverseId: string | null; milestones: GameMilestoneDto[]; recentBuilds: GameBuildDto[]; }
export interface PublishGameOpenCloudResultDto {
  ok: boolean;
  versionNumber: number;
  versionType: 'Saved' | 'Published';
  universeId: string;
  placeId: string;
  message: string;
}
