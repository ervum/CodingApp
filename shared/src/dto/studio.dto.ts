import type { Id, IsoDateString } from './common.dto.js';
import type {
  AgentKey,
  CodingMode,
  CodingSyncTool,
  ContextMode,
  MembershipRole,
  SandboxAccessPolicy,
  SandboxProviderKind,
} from '../enums.js';
import type { GameDto } from './game.dto.js';
import type { AgentDto } from './agent.dto.js';
import type { LiveRunDto } from './run.dto.js';
import type { StudioLaneDto } from './lane.dto.js';
import type { HumanRequestDto } from './human-request.dto.js';
import type { ReviewCountsDto } from './review.dto.js';

export interface StudioDto {
  id: Id;
  slug: string;
  name: string;
  workspaceLabel: string;
  isPaused: boolean;
  pausedAt: IsoDateString | null;
  browserHeadless?: boolean;
  autoDeleteCreatedChats?: boolean;
  codingMode?: CodingMode;
  codingSyncTool?: CodingSyncTool;
  contextMode?: ContextMode;
  allowTerminalWithoutPermission?: boolean;
  allowExternalFilesWithoutPermission?: boolean;
  allowPcControlWithoutPermission?: boolean;
  pcIdleTakeoverSeconds?: number;
  sandboxAccessPolicy?: SandboxAccessPolicy;
  sandboxProviderKind?: SandboxProviderKind;
  maxConcurrentSandboxes?: number;
  allowAutoSaveVersion?: boolean;
  allowAutoPublish?: boolean;
  robloxUniverseId?: string | null;
  robloxPlaceId?: string | null;
  hasOpenCloudApiKey?: boolean;
  openCloudApiKeyLast4?: string | null;
  dailyTokenBudget?: number | null;
  dailyCostBudgetUsd?: number | null;
  perTaskTokenBudget?: number | null;
}
export interface StudioFreshnessDto {
  marketLastSuccessAt: IsoDateString | null;
  vaultDocCount: number;
  vaultLastUpdatedAt: IsoDateString | null;
  assetCount: number;
  assetLastUpdatedAt: IsoDateString | null;
}
export interface AgentScreenDto {
  studioId: Id;
  agentKey: AgentKey;
  runId: Id | null;
  taskTitle: string | null;
  mediaId: Id | null;
  mediaUrl: string | null;
  source: 'MAIN_PC' | 'SANDBOX' | 'BROWSER';
  windowTitle: string | null;
  capturedAt: IsoDateString;
}
export interface StudioSummaryDto extends StudioDto { role: MembershipRole; }
export interface StudioCountsDto {
  needsYou: number;      // OPEN human requests
  working: number;       // agents with status WORKING
  queued: number;        // tasks QUEUED (incl. waiting on deps)
  openTasks: number;     // tasks in OPEN_TASK_STATUSES
  review: ReviewCountsDto;
}
export interface StudioSetupDto { hasAnyLlmConnection: boolean; unboundAgentKeys: AgentKey[]; }
export interface StudioSnapshotDto {
  studio: StudioDto;
  myRole: MembershipRole;
  games: GameDto[];
  agents: AgentDto[];
  liveRuns: LiveRunDto[];
  lanes: StudioLaneDto[];
  humanRequests: HumanRequestDto[]; // OPEN only, newest first
  counts: StudioCountsDto;
  setup: StudioSetupDto;
  freshness?: StudioFreshnessDto;
  agentScreens?: AgentScreenDto[];
  serverTime: IsoDateString;
}
export interface MemberDto { userId: Id; email: string; displayName: string; avatarColor: string; role: MembershipRole; joinedAt: IsoDateString; }
