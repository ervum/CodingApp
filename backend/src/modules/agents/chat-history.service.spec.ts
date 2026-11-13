import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { LanesService } from '../lanes/lanes.service.js';
import type { GoogleWebBrowserAdapter } from '../llm/adapters/google-web.adapter.js';
import type { RunRegistryService } from '../orchestrator/run-registry.service.js';
import type { RealtimeService } from '../realtime/realtime.service.js';
import type { TasksService } from '../tasks/tasks.service.js';
import type { AgentStatusService } from './agent-status.service.js';
import { ChatHistoryService } from './chat-history.service.js';

function createMockHarness() {
  const archives: Array<{
    id: string;
    studioId: string;
    agentId: string;
    kind: 'FRESH_START' | 'BRANCH';
    number: number;
    createdAt: Date;
  }> = [];

  const messages: Array<{
    id: string;
    studioId: string;
    agentId: string;
    author: 'USER' | 'AGENT';
    body: string;
    archiveId: string | null;
    taskId: string | null;
    userId: string | null;
    directives: string[];
    attachments: unknown[];
    createdAt: Date;
  }> = [
    {
      id: 'msg-1',
      studioId: 'studio-1',
      agentId: 'agent-builder',
      author: 'USER',
      body: 'First user prompt',
      archiveId: null,
      taskId: 'task-1',
      userId: 'user-1',
      directives: ['PLAN'],
      attachments: [],
      createdAt: new Date('2026-10-27T01:00:00.000Z'),
    },
    {
      id: 'msg-2',
      studioId: 'studio-1',
      agentId: 'agent-builder',
      author: 'USER',
      body: 'Second user prompt',
      archiveId: null,
      taskId: 'task-2',
      userId: 'user-1',
      directives: ['BROWSER'],
      attachments: [],
      createdAt: new Date('2026-10-27T02:00:00.000Z'),
    },
  ];

  const runs: Array<{
    id: string;
    studioId: string;
    agentId: string;
    taskId: string;
    status: string;
    archiveId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    provider: 'GOOGLE_GEMINI';
    modelId: string;
    llmConnectionId: string | null;
    temperature: number;
    maxOutputTokens: number;
    summary: string | null;
    errorMessage: string | null;
    errorCode: string | null;
    task: { id: string; title: string; brief: string };
    entries: Array<{
      id: string;
      seq: number;
      kind: string;
      content: string;
      meta: unknown;
    }>;
  }> = [
    {
      id: 'run-1',
      studioId: 'studio-1',
      agentId: 'agent-builder',
      taskId: 'task-1',
      status: 'SUCCEEDED',
      archiveId: null,
      startedAt: new Date('2026-10-27T01:00:05.000Z'),
      finishedAt: new Date('2026-10-27T01:00:15.000Z'),
      provider: 'GOOGLE_GEMINI',
      modelId: 'gemini-2.5-pro',
      llmConnectionId: 'conn-orig',
      temperature: 0.2,
      maxOutputTokens: 4096,
      summary: 'Completed Task 1',
      errorMessage: null,
      errorCode: null,
      task: { id: 'task-1', title: 'Task 1', brief: 'First user prompt' },
      entries: [],
    },
    {
      id: 'run-2',
      studioId: 'studio-1',
      agentId: 'agent-builder',
      taskId: 'task-2',
      status: 'SUCCEEDED',
      archiveId: null,
      startedAt: new Date('2026-10-27T02:00:05.000Z'),
      finishedAt: new Date('2026-10-27T02:00:15.000Z'),
      provider: 'GOOGLE_GEMINI',
      modelId: 'gemini-2.5-flash',
      llmConnectionId: 'conn-2',
      temperature: 0.5,
      maxOutputTokens: 8192,
      summary: 'Completed Task 2',
      errorMessage: null,
      errorCode: null,
      task: { id: 'task-2', title: 'Task 2', brief: 'Second user prompt' },
      entries: [],
    },
  ];

  const tasksMap = new Map<
    string,
    {
      id: string;
      studioId: string;
      agentId: string;
      title: string;
      brief: string;
      status: string;
      metadata: Record<string, unknown>;
    }
  >([
    [
      'task-1',
      {
        id: 'task-1',
        studioId: 'studio-1',
        agentId: 'agent-builder',
        title: 'Task 1',
        brief: 'First user prompt',
        status: 'DONE',
        metadata: {},
      },
    ],
    [
      'task-2',
      {
        id: 'task-2',
        studioId: 'studio-1',
        agentId: 'agent-builder',
        title: 'Task 2',
        brief: 'Second user prompt',
        status: 'DONE',
        metadata: {},
      },
    ],
  ]);

  const prisma = {
    agent: {
      findUnique: vi.fn(async () => ({
        id: 'agent-builder',
        studioId: 'studio-1',
        key: 'builder',
        displayName: 'Builder',
        modelId: 'gemini-2.5-flash',
        temperature: 0.4,
        maxOutputTokens: 8192,
      })),
      update: vi.fn(async () => ({})),
    },
    chatArchive: {
      aggregate: vi.fn(async ({ where }: { where: { agentId: string; kind: string } }) => {
        const matching = archives.filter((a) => a.agentId === where.agentId && a.kind === where.kind);
        const maxNum = matching.length > 0 ? Math.max(...matching.map((a) => a.number)) : null;
        return { _max: { number: maxNum } };
      }),
      create: vi.fn(async ({ data }: { data: Omit<(typeof archives)[0], 'id' | 'createdAt'> }) => {
        const created = {
          ...data,
          id: `arch-${archives.length + 1}`,
          createdAt: new Date('2026-10-27T03:00:00.000Z'),
        };
        archives.push(created);
        return created;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const arch = archives.find((a) => a.id === where.id)!;
        return {
          ...arch,
          messages: messages.filter((m) => m.archiveId === arch.id),
          runs: runs.filter((r) => r.archiveId === arch.id),
        };
      }),
    },
    agentMessage: {
      findMany: vi.fn(
        async ({ where }: { where: { archiveId?: string | null; id?: { in: string[] } } }) =>
          messages.filter((m) => {
            if (where.archiveId !== undefined && m.archiveId !== where.archiveId) return false;
            if (where.id?.in && !where.id.in.includes(m.id)) return false;
            return true;
          }),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id?: string; taskId?: string; archiveId?: string | null } }) =>
          messages.find((m) => {
            if (where.id && m.id !== where.id) return false;
            if (where.taskId && m.taskId !== where.taskId) return false;
            if (where.archiveId !== undefined && m.archiveId !== where.archiveId) return false;
            return true;
          }) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { archiveId?: null; id?: { in: string[] } };
          data: { archiveId: string | null };
        }) => {
          let count = 0;
          for (const m of messages) {
            const matchArchive = where.archiveId === undefined || m.archiveId === where.archiveId;
            const matchId = !where.id?.in || where.id.in.includes(m.id);
            if (matchArchive && matchId) {
              m.archiveId = data.archiveId;
              count++;
            }
          }
          return { count };
        },
      ),
    },
    agentRun: {
      findMany: vi.fn(
        async ({ where }: { where: { archiveId?: string | null; id?: { in: string[] } } }) =>
          runs.filter((r) => {
            if (where.archiveId !== undefined && r.archiveId !== where.archiveId) return false;
            if (where.id?.in && !where.id.in.includes(r.id)) return false;
            return true;
          }),
      ),
      findFirst: vi.fn(
        async ({ where }: { where: { id?: string; archiveId?: string | null } }) =>
          runs.find((r) => {
            if (where.id && r.id !== where.id) return false;
            if (where.archiveId !== undefined && r.archiveId !== where.archiveId) return false;
            return true;
          }) ?? null,
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { archiveId?: null | string; id?: { in: string[] }; status?: string };
          data: { archiveId?: string; status?: string };
        }) => {
          let count = 0;
          for (const r of runs) {
            const matchArchive = where.archiveId === undefined || r.archiveId === where.archiveId;
            const matchId = !where.id?.in || where.id.in.includes(r.id);
            const matchStatus = !where.status || r.status === where.status;
            if (matchArchive && matchId && matchStatus) {
              if (data.archiveId !== undefined) r.archiveId = data.archiveId;
              if (data.status !== undefined) r.status = data.status;
              count++;
            }
          }
          return { count };
        },
      ),
    },
    humanRequest: {
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    task: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .map((id) => tasksMap.get(id))
          .filter((t): t is NonNullable<typeof t> => Boolean(t))
          .map((t) => ({
            ...t,
            runs: runs.filter((r) => r.taskId === t.id),
            messages: messages.filter((m) => m.taskId === t.id),
          })),
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) => tasksMap.get(where.id) ?? null),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { metadata?: Record<string, unknown>; status?: string; brief?: string };
        }) => {
          const existing = tasksMap.get(where.id);
          if (existing) {
            if (data.metadata) existing.metadata = data.metadata;
            if (data.status) existing.status = data.status;
            if (data.brief) existing.brief = data.brief;
          }
          return existing;
        },
      ),
    },
  } as unknown as PrismaService;

  const tasks = {
    getById: vi.fn(async (_studioId: string, taskId: string) => ({
      id: taskId,
      title: 'Task 1',
      brief: 'First user prompt',
      status: 'QUEUED',
      priority: 'NORMAL',
      origin: 'OPERATOR_DIRECT',
      agentKey: 'builder',
      gameId: null,
      parentTaskId: null,
      tags: [],
      dependsOn: [],
      waitingOnDependencies: false,
      attempts: 1,
      createdAt: '2026-10-27T01:00:00.000Z',
      queuedAt: '2026-10-27T03:00:00.000Z',
      startedAt: null,
      completedAt: null,
      resultSummary: null,
      latestRunId: null,
      openHumanRequestId: null,
    })),
    notifyTaskQueued: vi.fn(),
  } as unknown as TasksService;

  const agentStatus = {
    recompute: vi.fn(async () => {}),
  } as unknown as AgentStatusService;

  const registry = {
    abort: vi.fn(),
  } as unknown as RunRegistryService;

  const lanes = {
    releaseByRun: vi.fn(async () => {}),
  } as unknown as LanesService;

  const realtime = {
    emitToStudio: vi.fn(),
    broadcastCounts: vi.fn(),
  } as unknown as RealtimeService;

  const googleWeb = {
    detachAgentWebChatCache: vi.fn(async () => {}),
  } as unknown as GoogleWebBrowserAdapter;

  const service = new ChatHistoryService(
    prisma,
    tasks,
    agentStatus,
    registry,
    lanes,
    realtime,
    googleWeb,
  );
  return { service, archives, messages, runs, tasksMap, realtime };
}

describe('ChatHistoryService', () => {
  it('moves all active messages and runs into Archive #1 on freshStart', async () => {
    const { service, messages, runs, realtime } = createMockHarness();

    const { archive } = await service.freshStart('studio-1', 'builder');
    expect(archive).not.toBeNull();
    expect(archive?.kind).toBe('FRESH_START');
    expect(archive?.number).toBe(1);
    expect(archive?.label).toBe('Archive #1');
    expect(archive?.messageCount).toBe(2);
    expect(archive?.runCount).toBe(2);
    expect(messages.every((m) => m.archiveId === archive?.id)).toBe(true);
    expect(runs.every((r) => r.archiveId === archive?.id)).toBe(true);
    expect(realtime.emitToStudio).toHaveBeenCalledWith(
      'studio-1',
      'chat:history-changed',
      expect.objectContaining({ agentKey: 'builder', reason: 'fresh-start' }),
    );
  });

  it('branches from target message onwards into Branch Archive #1 while keeping earlier messages active', async () => {
    const { service, messages, runs } = createMockHarness();

    const { archive } = await service.branchFrom('studio-1', 'builder', {
      ref: {
        taskId: 'task-2',
        promptMessageId: 'msg-2',
        runIds: ['run-2'],
      },
      part: 'USER',
    });
    expect(archive).not.toBeNull();
    expect(archive?.kind).toBe('BRANCH');
    expect(archive?.number).toBe(1);
    expect(archive?.label).toBe('Branch Archive #1');

    expect(messages.find((m) => m.id === 'msg-1')?.archiveId).toBeNull();
    expect(runs.find((r) => r.id === 'run-1')?.archiveId).toBeNull();
    expect(messages.find((m) => m.id === 'msg-2')?.archiveId).toBe(archive?.id);
    expect(runs.find((r) => r.id === 'run-2')?.archiveId).toBe(archive?.id);
  });

  it('retries with SAME_AGENT using the original run snapshot parameters and archives replaced turns', async () => {
    const { service, tasksMap } = createMockHarness();

    const result = await service.retry(
      'studio-1',
      'builder',
      {
        ref: {
          taskId: 'task-1',
          promptMessageId: 'msg-1',
          runIds: ['run-1'],
        },
        mode: 'SAME_AGENT',
        sourceRunId: 'run-1',
      },
      {
        id: 'user-1',
        email: 'operator@robdev.local',
        displayName: 'Operator',
      },
    );

    expect(result.archive?.label).toBe('Branch Archive #1');
    expect(result.task.id).toBe('task-1');
    const updatedTask = tasksMap.get('task-1');
    expect(updatedTask?.status).toBe('QUEUED');
    expect(updatedTask?.metadata['runOverride']).toEqual({
      llmConnectionId: 'conn-orig',
      provider: 'GOOGLE_GEMINI',
      modelId: 'gemini-2.5-pro',
      temperature: 0.2,
      maxOutputTokens: 4096,
    });
  });
});
