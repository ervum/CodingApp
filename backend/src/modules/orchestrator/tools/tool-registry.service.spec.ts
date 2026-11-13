import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { LogBuffer } from '../log-buffer.js';
import type { ToolContext, ToolHandler } from './tool-context.js';
import { ToolRegistryService } from './tool-registry.service.js';

function createTestRegistry(): {
  registry: ToolRegistryService;
  mockReadExecute: ReturnType<typeof vi.fn>;
} {
  const noopHandler = (name: string): ToolHandler => ({
    name: name as ToolHandler['name'],
    execute: async () => ({ payload: { ok: true } }),
  });

  const mockReadExecute = vi.fn(async (args: { path: string }) => ({
    payload: { ok: true as const, path: args.path, title: 'Doc', version: 1, markdown: '# Test' },
  }));

  const registry = new ToolRegistryService(
    noopHandler('vault_search') as never,
    { name: 'vault_read', execute: mockReadExecute } as never,
    noopHandler('vault_update_document') as never,
    noopHandler('delegate_task') as never,
    noopHandler('request_human') as never,
    noopHandler('save_artifact') as never,
    noopHandler('market_query') as never,
    noopHandler('create_pitch') as never,
    noopHandler('generate_image') as never,
    noopHandler('submit_for_review') as never,
    noopHandler('flag_blocker') as never,
    noopHandler('acquire_studio_lane') as never,
    noopHandler('release_studio_lane') as never,
    noopHandler('record_build') as never,
    noopHandler('update_milestone') as never,
  );

  return { registry, mockReadExecute };
}

function createTestContext(grantedTools: ToolContext['agent']['tools']): ToolContext {
  const log = new LogBuffer('run_1', 'builder', {
    createEntry: async (d) => ({ id: `e_${d.seq}`, createdAt: new Date() }),
    updateEntryContent: async () => {},
    emitLogChunk: () => {},
    emitActivity: () => {},
  });

  const prisma = {
    agentRun: {
      update: vi.fn(async () => ({})),
    },
  } as unknown as PrismaService;

  return {
    studioId: 'studio_1',
    run: { id: 'run_1' },
    task: { id: 'task_1', title: 'Test task', gameId: null, metadata: null },
    agent: {
      id: 'agent_1',
      key: 'builder',
      displayName: 'Builder',
      tools: grantedTools,
      imageConnectionId: null,
      imageModelId: null,
    },
    game: null,
    log,
    prisma,
    userFacingAgentName: 'Builder',
    signal: new AbortController().signal,
  };
}

describe('ToolRegistryService', () => {
  it('returns TOOL_NOT_GRANTED when agent does not have permission for the tool', async () => {
    const { registry } = createTestRegistry();
    const ctx = createTestContext(['vault_read']);

    const res = await registry.execute(
      {
        id: 'call_1',
        name: 'generate_image',
        argumentsJson: JSON.stringify({ kind: 'ICON', title: 'Test', prompt: 'A cool game icon with neon lighting' }),
      },
      ctx,
    );

    expect(res.payload).toMatchObject({
      ok: false,
      error: 'TOOL_NOT_GRANTED',
    });
  });

  it('returns VALIDATION_FAILED on malformed JSON arguments', async () => {
    const { registry } = createTestRegistry();
    const ctx = createTestContext(['vault_read']);

    const res = await registry.execute(
      {
        id: 'call_2',
        name: 'vault_read',
        argumentsJson: '{not-valid-json',
      },
      ctx,
    );

    expect(res.payload).toMatchObject({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
  });

  it('returns VALIDATION_FAILED with issues when Zod validation fails', async () => {
    const { registry } = createTestRegistry();
    const ctx = createTestContext(['vault_read']);

    const res = await registry.execute(
      {
        id: 'call_3',
        name: 'vault_read',
        argumentsJson: JSON.stringify({ path: '' }),
      },
      ctx,
    );

    expect(res.payload).toMatchObject({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect((res.payload as { issues?: unknown[] }).issues).toBeDefined();
  });

  it('executes granted tool with valid arguments and returns ok payload', async () => {
    const { registry, mockReadExecute } = createTestRegistry();
    const ctx = createTestContext(['vault_read']);

    const res = await registry.execute(
      {
        id: 'call_4',
        name: 'vault_read',
        argumentsJson: JSON.stringify({ path: '05 UI and HUD/05 UI and HUD.md' }),
      },
      ctx,
    );

    expect(mockReadExecute).toHaveBeenCalledTimes(1);
    expect(res.payload).toMatchObject({
      ok: true,
      path: '05 UI and HUD/05 UI and HUD.md',
    });
  });
});
