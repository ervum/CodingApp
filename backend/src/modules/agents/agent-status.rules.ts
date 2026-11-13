import type { AgentStatus } from '@robdev/shared';

export interface DeriveAgentStatusInput {
  isEnabled: boolean;
  llmConnectionId: string | null;
  modelId: string | null;
  connectionIsEnabled: boolean;
  hasActiveRun: boolean;
  studioIsPaused: boolean;
  lastErrorCode: string | null;
  needsHumanTaskCount: number;
  blockedTaskCount: number;
  queuedTaskCount: number;
}

/**
 * Pure status derivation following Section 4.6 precedence:
 * 1. !isEnabled || !llmConnectionId || !modelId || !connection.isEnabled -> OFFLINE
 * 2. an active run in RunRegistry -> WORKING
 * 3. studio.isPaused -> PAUSED
 * 4. lastErrorCode in {PROVIDER_AUTH_FAILED} -> ERROR
 * 5. >=1 task with status=NEEDS_HUMAN assigned to the agent -> WAITING_ON_HUMAN
 * 6. >=1 task BLOCKED and no QUEUED tasks -> BLOCKED
 * 7. otherwise IDLE
 */
export function deriveAgentStatus(input: DeriveAgentStatusInput): AgentStatus {
  if (!input.isEnabled || !input.llmConnectionId || !input.modelId || !input.connectionIsEnabled) {
    return 'OFFLINE';
  }
  if (input.hasActiveRun) {
    return 'WORKING';
  }
  if (input.studioIsPaused) {
    return 'PAUSED';
  }
  if (input.lastErrorCode === 'PROVIDER_AUTH_FAILED') {
    return 'ERROR';
  }
  if (input.needsHumanTaskCount > 0) {
    return 'WAITING_ON_HUMAN';
  }
  if (input.blockedTaskCount > 0 && input.queuedTaskCount === 0) {
    return 'BLOCKED';
  }
  return 'IDLE';
}
