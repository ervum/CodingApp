import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { RunRegistryService } from '../orchestrator/run-registry.service.js';
import type { RealtimeService } from '../realtime/realtime.service.js';
import { deriveAgentStatus, type DeriveAgentStatusInput } from './agent-status.rules.js';
import { AgentStatusService } from './agent-status.service.js';

describe('deriveAgentStatus precedence rules', () => {
  const base: DeriveAgentStatusInput = {
    isEnabled: true,
    llmConnectionId: 'conn_1',
    modelId: 'model-1',
    connectionIsEnabled: true,
    hasActiveRun: false,
    studioIsPaused: false,
    lastErrorCode: null,
    needsHumanTaskCount: 0,
    blockedTaskCount: 0,
    queuedTaskCount: 0,
  };

  it('returns OFFLINE when disabled, unbound, or connection disabled (highest priority)', () => {
    expect(deriveAgentStatus({ ...base, isEnabled: false, hasActiveRun: true })).toBe('OFFLINE');
    expect(deriveAgentStatus({ ...base, llmConnectionId: null, hasActiveRun: true })).toBe(
      'OFFLINE',
    );
    expect(deriveAgentStatus({ ...base, modelId: null, hasActiveRun: true })).toBe('OFFLINE');
    expect(deriveAgentStatus({ ...base, connectionIsEnabled: false, hasActiveRun: true })).toBe(
      'OFFLINE',
    );
  });

  it('returns WORKING when an active run exists in RunRegistry', () => {
    expect(
      deriveAgentStatus({
        ...base,
        hasActiveRun: true,
        studioIsPaused: true,
        lastErrorCode: 'PROVIDER_AUTH_FAILED',
      }),
    ).toBe('WORKING');
  });

  it('returns PAUSED when studio is paused and no active run exists', () => {
    expect(
      deriveAgentStatus({
        ...base,
        studioIsPaused: true,
        lastErrorCode: 'PROVIDER_AUTH_FAILED',
        needsHumanTaskCount: 2,
      }),
    ).toBe('PAUSED');
  });

  it('returns ERROR when lastErrorCode is PROVIDER_AUTH_FAILED', () => {
    expect(
      deriveAgentStatus({
        ...base,
        lastErrorCode: 'PROVIDER_AUTH_FAILED',
        needsHumanTaskCount: 1,
      }),
    ).toBe('ERROR');
  });

  it('returns WAITING_ON_HUMAN when needsHumanTaskCount > 0', () => {
    expect(
      deriveAgentStatus({
        ...base,
        needsHumanTaskCount: 1,
        blockedTaskCount: 2,
        queuedTaskCount: 0,
      }),
    ).toBe('WAITING_ON_HUMAN');
  });

  it('returns BLOCKED when blockedTaskCount > 0 and queuedTaskCount === 0', () => {
    expect(
      deriveAgentStatus({
        ...base,
        blockedTaskCount: 1,
        queuedTaskCount: 0,
      }),
    ).toBe('BLOCKED');
    expect(
      deriveAgentStatus({
        ...base,
        blockedTaskCount: 1,
        queuedTaskCount: 1,
      }),
    ).toBe('IDLE');
  });

  it('returns IDLE otherwise', () => {
    expect(deriveAgentStatus(base)).toBe('IDLE');
  });
});

describe('AgentStatusService.recompute', () => {
  it('emits agent:status only when status or pointers change', async () => {
    let storedStatus = 'OFFLINE';
    const updateMock = vi.fn().mockImplementation(async ({ data }: { data: { status: string } }) => {
      storedStatus = data.status;
    });

    const prismaMock = {
      agent: {
        findUnique: vi.fn().mockImplementation(async () => ({
          id: 'agent_1',
          studioId: 'studio_1',
          key: 'builder',
          status: storedStatus,
          isEnabled: true,
          llmConnectionId: 'conn_1',
          modelId: 'model-1',
          currentTaskId: null,
          currentRunId: null,
          lastSnippet: null,
          lastErrorCode: null,
          studio: { isPaused: false },
          llmConnection: { isEnabled: true },
        })),
        update: updateMock,
      },
      task: {
        count: vi.fn().mockResolvedValue(0),
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;

    const emitToStudio = vi.fn();
    const broadcastCounts = vi.fn();
    const realtimeMock = {
      emitToStudio,
      broadcastCounts,
    } as unknown as RealtimeService;

    const registry = new RunRegistryService();
    const svc = new AgentStatusService(prismaMock, registry, realtimeMock);

    const first = await svc.recompute('agent_1');
    expect(first).toBe('IDLE');
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(emitToStudio).toHaveBeenCalledTimes(1);

    // Second call with no state changes should not update or emit
    const second = await svc.recompute('agent_1');
    expect(second).toBe('IDLE');
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(emitToStudio).toHaveBeenCalledTimes(1);
  });
});
