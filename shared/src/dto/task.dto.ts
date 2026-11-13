import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, TaskOrigin, TaskPriority, TaskStatus } from '../enums.js';
import type { AgentRunSummaryDto } from './run.dto.js';

export interface TaskDto {
  id: Id; title: string; brief: string; status: TaskStatus; priority: TaskPriority; origin: TaskOrigin;
  agentKey: AgentKey; gameId: Id | null; parentTaskId: Id | null; tags: string[]; dependsOn: Id[];
  waitingOnDependencies: boolean; attempts: number;
  createdAt: IsoDateString; queuedAt: IsoDateString; startedAt: IsoDateString | null; completedAt: IsoDateString | null;
  acceptedAt?: IsoDateString | null; acceptedByUserName?: string | null;
  resultSummary: string | null; latestRunId: Id | null; openHumanRequestId: Id | null;
}
export interface TaskDetailDto extends TaskDto { subtasks: TaskDto[]; runs: AgentRunSummaryDto[]; }

export interface TaskOutputAgentResponseDto {
  taskId: Id;
  runId: Id;
  agentKey: AgentKey;
  taskTitle: string;
  isRoot: boolean;
  thinkingText: string | null;
  thinkingDurationMs: number | null;
  responseText: string;
  finishedAt: IsoDateString;
}

export interface TaskOutputArtifactDto {
  id: Id;
  runId: Id;
  agentKey: AgentKey;
  path: string;
  language: string;
  content: string;
  bytes: number;
  createdAt: IsoDateString;
}

export interface TaskOutputVaultDocDto {
  documentId: Id;
  path: string;
  title: string;
  version: number;
  markdown: string;
  bytes: number;
  agentKey: AgentKey;
  updatedAt: IsoDateString;
}

export interface TaskOutputImageDto {
  mediaId: Id;
  title: string;
  kind: string;
  width: number | null;
  height: number | null;
  bytes: number;
  agentKey: AgentKey;
  reviewItemId?: Id | null;
  createdAt: IsoDateString;
}

export interface TaskOutputDto {
  rootTaskId: Id;
  title: string;
  brief: string;
  status: TaskStatus;
  gameId: Id | null;
  agentKey: AgentKey;
  totalTasksInTree: number;
  completedTasksInTree: number;
  participatingAgents: AgentKey[];
  createdAt: IsoDateString;
  completedAt: IsoDateString;
  finalText: string;
  responses: TaskOutputAgentResponseDto[];
  artifacts: TaskOutputArtifactDto[];
  vaultDocs: TaskOutputVaultDocDto[];
  images: TaskOutputImageDto[];
}
