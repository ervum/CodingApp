import type { Id, IsoDateString } from '../dto/common.dto.js';
import type { AgentKey, AgentStatus, LogEntryKind, ReviewStatus, Verdict } from '../enums.js';
import type { RunLogEntryDto, RunLogMeta, LiveRunDto, AgentRunSummaryDto } from '../dto/run.dto.js';
import type { TaskDto, TaskOutputDto } from '../dto/task.dto.js';
import type { ReviewItemDto } from '../dto/review.dto.js';
import type { HumanRequestDto } from '../dto/human-request.dto.js';
import type { StudioLaneDto } from '../dto/lane.dto.js';
import type { GameDto } from '../dto/game.dto.js';
import type { PitchDto } from '../dto/pitch.dto.js';
import type { AgentMessageDto } from '../dto/agent.dto.js';
import type { AgentScreenDto, StudioCountsDto } from '../dto/studio.dto.js';
import type { StudioAssetDto } from '../dto/asset.dto.js';

export const WS_NAMESPACE = '/studio';

interface Envelope { studioId: Id; at: IsoDateString; }

export interface AgentStatusEvent extends Envelope {
  agentKey: AgentKey; status: AgentStatus; currentTaskId: Id | null; currentTaskTitle: string | null;
  currentRunId: Id | null; currentGameId: Id | null; lastSnippet: string | null; lastErrorCode: string | null;
}
/** Streamed to room run:{runId}. `delta` is set for TEXT appends; `entry` is set when an entry is created or finalized. */
export interface AgentLogChunkEvent extends Envelope {
  runId: Id; agentKey: AgentKey; entryId: Id; seq: number; kind: LogEntryKind;
  delta: string | null; entry: RunLogEntryDto | null; meta: RunLogMeta | null;
}
/** Throttled (≤1/s per agent) to studio room for list snippets. */
export interface AgentActivityEvent extends Envelope { agentKey: AgentKey; runId: Id; snippet: string; }
export interface RunLifecycleEvent extends Envelope { run: AgentRunSummaryDto; live: LiveRunDto | null; }
export interface TaskUpdatedEvent extends Envelope { task: TaskDto; change: 'created' | 'updated' | 'deleted'; }
export interface TaskOutputEvent extends Envelope { output: TaskOutputDto; }
export interface ReviewItemEvent extends Envelope { item: ReviewItemDto; change: 'created' | 'updated'; }
export interface ReviewVerdictEvent extends Envelope {
  reviewItemId: Id; verdict: Verdict; status: ReviewStatus; feedback: string | null; byUserName: string; followUpTaskId: Id | null;
}
export interface CountsEvent extends Envelope { counts: StudioCountsDto; }
export interface HumanRequestEvent extends Envelope { request: HumanRequestDto; change: 'created' | 'updated'; }
export interface LaneEvent extends Envelope { lane: StudioLaneDto; }
export interface StudioPausedEvent extends Envelope { isPaused: boolean; byUserName: string; }
export interface GameUpdatedEvent extends Envelope { game: GameDto; }
export interface PitchEvent extends Envelope { pitch: PitchDto; change: 'created' | 'updated'; }
export interface AgentMessageEvent extends Envelope { message: AgentMessageDto; }
export interface ChatHistoryChangedEvent extends Envelope {
  agentKey: AgentKey;
  reason?: string;
  archiveId?: Id | null;
}
export interface VaultDocumentEvent extends Envelope { documentId: Id; path: string; version: number; byLabel: string; }
export interface MarketIngestedEvent { at: IsoDateString; ingestionRunId: Id; status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED'; gamesFetched: number; }
export interface AgentScreenEvent extends Envelope { screen: AgentScreenDto; }
export interface StudioAssetEvent extends Envelope { asset: StudioAssetDto; change: 'created' | 'updated' | 'deleted'; }

export interface ServerToClientEvents {
  'agent:status': (e: AgentStatusEvent) => void;
  'agent:log-chunk': (e: AgentLogChunkEvent) => void;
  'agent:activity': (e: AgentActivityEvent) => void;
  'agent:message': (e: AgentMessageEvent) => void;
  'agent:screen': (e: AgentScreenEvent) => void;
  'chat:history-changed': (e: ChatHistoryChangedEvent) => void;
  'run:started': (e: RunLifecycleEvent) => void;
  'run:finished': (e: RunLifecycleEvent) => void;
  'task:updated': (e: TaskUpdatedEvent) => void;
  'task:output-ready': (e: TaskOutputEvent) => void;
  'review:item': (e: ReviewItemEvent) => void;
  'review:verdict': (e: ReviewVerdictEvent) => void;
  'studio:counts': (e: CountsEvent) => void;
  'studio:paused': (e: StudioPausedEvent) => void;
  'human-request:updated': (e: HumanRequestEvent) => void;
  'lane:updated': (e: LaneEvent) => void;
  'game:updated': (e: GameUpdatedEvent) => void;
  'pitch:updated': (e: PitchEvent) => void;
  'vault:document-updated': (e: VaultDocumentEvent) => void;
  'market:ingested': (e: MarketIngestedEvent) => void;
  'asset:updated': (e: StudioAssetEvent) => void;
}

export type Ack<T = undefined> = (res: { ok: true; data: T } | { ok: false; code: string; message: string }) => void;

export interface ClientToServerEvents {
  'studio:join': (p: { studioId: Id }, ack: Ack<{ joinedAt: IsoDateString }>) => void;
  'studio:leave': (p: { studioId: Id }, ack: Ack) => void;
  'run:subscribe': (p: { studioId: Id; runId: Id }, ack: Ack<{ lastSeq: number }>) => void;
  'run:unsubscribe': (p: { runId: Id }, ack: Ack) => void;
}

export interface SocketData { userId: Id; displayName: string; studioIds: Id[]; }
export const studioRoom = (studioId: Id) => `studio:${studioId}`;
export const runRoom = (runId: Id) => `run:${runId}`;
export const MARKET_ROOM = 'market';
