import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, GameStatus, TaskPriority } from '../enums.js';

export interface PlaybookStepDto {
  key: string;
  agentKey: AgentKey;
  title: string;
  brief: string;
  dependsOn: string[];
  priority: TaskPriority;
}

export interface PlaybookDto {
  id: Id;
  studioId: Id;
  key: string;
  name: string;
  description: string;
  steps: PlaybookStepDto[];
  suggestOnGameStatus: GameStatus | null;
  isBuiltIn: boolean;
  createdAt: IsoDateString;
  updatedAt: IsoDateString;
}

export interface RunPlaybookResultDto {
  playbookId: Id;
  rootTaskId: Id;
  createdTaskIds: Id[];
  taskCount: number;
}
