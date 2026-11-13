import { describe, expect, it } from 'vitest';
import type { TaskDto } from '@robdev/shared';
import { computeTaskGraphLayout } from './task-graph-layout';

function makeTask(overrides: Partial<TaskDto> & { id: string; title: string }): TaskDto {
  return {
    id: overrides.id,
    title: overrides.title,
    brief: overrides.brief ?? 'Task brief',
    status: overrides.status ?? 'QUEUED',
    priority: overrides.priority ?? 'NORMAL',
    origin: overrides.origin ?? 'USER',
    agentKey: overrides.agentKey ?? 'builder',
    gameId: overrides.gameId ?? null,
    parentTaskId: overrides.parentTaskId ?? null,
    tags: overrides.tags ?? [],
    dependsOn: overrides.dependsOn ?? [],
    waitingOnDependencies: overrides.waitingOnDependencies ?? false,
    attempts: overrides.attempts ?? 0,
    createdAt: '2026-10-31T00:00:00.000Z',
    queuedAt: '2026-10-31T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    resultSummary: null,
    latestRunId: null,
    openHumanRequestId: null,
  };
}

describe('computeTaskGraphLayout', () => {
  it('Assigns topological columns based on dependencies and parent tasks', () => {
    const tasks: TaskDto[] = [
      makeTask({ id: 't1', title: 'Blueprint', agentKey: 'architect' }),
      makeTask({
        id: 't2',
        title: 'Core Loop',
        agentKey: 'builder',
        dependsOn: ['t1'],
      }),
      makeTask({
        id: 't3',
        title: 'HUD',
        agentKey: 'frame',
        dependsOn: ['t1'],
      }),
      makeTask({
        id: 't4',
        title: 'QA Pass',
        agentKey: 'reviewer',
        dependsOn: ['t2', 't3'],
      }),
    ];

    const layout = computeTaskGraphLayout(tasks);
    expect(layout.nodes).toHaveLength(4);
    expect(layout.edges).toHaveLength(4);

    const colOf = (id: string) => layout.nodes.find((n) => n.task.id === id)?.column;
    expect(colOf('t1')).toBe(0);
    expect(colOf('t2')).toBe(1);
    expect(colOf('t3')).toBe(1);
    expect(colOf('t4')).toBe(2);
  });
});
