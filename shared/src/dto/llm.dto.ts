import type { Id, IsoDateString } from './common.dto.js';
import type { AgentKey, LlmProvider } from '../enums.js';

export interface LlmConnectionDto {
  id: Id; provider: LlmProvider; label: string; baseUrl: string | null; hasApiKey: boolean; apiKeyLast4: string | null;
  inputCostPerMTok?: number | null; outputCostPerMTok?: number | null;
  isEnabled: boolean; lastVerifiedAt: IsoDateString | null; lastError: string | null; boundAgentCount: number; createdAt: IsoDateString;
}
export interface LlmModelInfoDto { id: string; displayName: string; contextWindow: number | null; supportsTools: boolean | null; supportsImageOutput: boolean | null; }
export interface TestConnectionResultDto { ok: boolean; latencyMs: number; modelCount: number; error: string | null; }
export interface DetectedLocalServerDto {
  name: string;
  provider: LlmProvider;
  baseUrl: string;
  models: string[];
  latencyMs: number;
}
export interface BrowserSessionStatusDto {
  authenticated: boolean;
  targetUrl: string;
  profileDir: string;
  message: string;
}
export interface BrowserVisibilityStatusDto {
  visible: boolean;
  browserHeadlessSetting: boolean;
  activeContexts: number;
  message: string;
}
export type WebChatPlatform =
  | 'gemini'
  | 'aistudio'
  | 'claude-web'
  | 'chatgpt-web'
  | 'gemini-app'
  | 'claude-app'
  | 'gpt-app'
  | 'antigravity';

export interface WebChatSessionDto {
  id: Id;
  studioId: Id;
  runId: Id | null;
  taskId: Id | null;
  rootTaskId: Id | null;
  agentId: Id;
  agentKey: AgentKey;
  platform: WebChatPlatform;
  guestMode: boolean;
  externalChatId: string;
  chatTitle: string;
  chatUrl: string;
  status: 'ACTIVE' | 'DELETED' | 'FAILED';
  createdAt: IsoDateString;
  deletedFromWebAt: IsoDateString | null;
}
export interface DeleteWebChatsResultDto {
  deletedFromWebCount: number;
  totalProcessed: number;
  message: string;
}
export interface RunpodPodStatusDto {
  podId: string;
  desiredStatus: 'RUNNING' | 'EXITED' | 'UNKNOWN';
  proxyBaseUrl: string;
  message: string;
}
export interface DetectedLocalRuntimeDto {
  provider: LlmProvider;
  name: string;
  category: 'cli' | 'desktop-app' | 'web-session';
  installed: boolean;
  executablePath: string | null;
  version: string | null;
  authenticated: boolean;
  defaultModel: string;
  models: string[];
  notes: string;
}
