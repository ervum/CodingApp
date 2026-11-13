import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { TasksService } from '../../tasks/tasks.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class DelegateTaskTool implements ToolHandler<'delegate_task'> {
  readonly name = 'delegate_task' as const;

  constructor(private readonly tasks: TasksService) {}

  async execute(
    args: ToolArgsOf<'delegate_task'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const targetAgent = await ctx.prisma.agent.findUnique({
      where: {
        studioId_key: {
          studioId: ctx.studioId,
          key: args.agentKey,
        },
      },
      select: { id: true, key: true, name: true },
    });

    if (!targetAgent) {
      return {
        payload: {
          ok: false,
          error: 'NOT_FOUND',
          message: `Agent not found: ${args.agentKey}`,
        },
      };
    }

    const origin =
      ctx.agent.key === 'lead' ? 'LEAD_DELEGATION' : 'AGENT_DELEGATION';

    // Resolve symbolic dependency references (e.g. "task_1", "task_2", "1", or agentKey like "librarian")
    // when an agent delegates multiple tasks in a single turn.
    let resolvedDeps: string[] = [];
    if (args.dependsOnTaskIds && args.dependsOnTaskIds.length > 0) {
      const siblingTasks = await ctx.prisma.task.findMany({
        where: {
          studioId: ctx.studioId,
          parentTaskId: ctx.task.id,
        },
        include: { agent: { select: { key: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      for (const rawDep of args.dependsOnTaskIds) {
        const trimmed = rawDep.trim();
        const posMatch = /^(?:task|step|subtask)[_-]?(\d+)$|^(\d+)$/i.exec(trimmed);
        if (posMatch) {
          const idx = Number.parseInt(posMatch[1] ?? posMatch[2] ?? '1', 10) - 1;
          const sibling = siblingTasks[idx] ?? siblingTasks[siblingTasks.length - 1];
          if (sibling) {
            resolvedDeps.push(sibling.id);
          }
          continue;
        }

        const byAgentKey = [...siblingTasks]
          .reverse()
          .find(
            (s) =>
              s.agent.key.toLowerCase() === trimmed.toLowerCase() ||
              trimmed.toLowerCase().includes(s.agent.key.toLowerCase()) ||
              s.id === trimmed,
          );
        if (byAgentKey) {
          resolvedDeps.push(byAgentKey.id);
          continue;
        }

        if (siblingTasks.length > 0 && !/^cm[a-z0-9]{15,}$/i.test(trimmed)) {
          resolvedDeps.push(siblingTasks[siblingTasks.length - 1]!.id);
          continue;
        }

        resolvedDeps.push(trimmed);
      }
      resolvedDeps = [...new Set(resolvedDeps)];
    }

    const created = await this.tasks.createInternal({
      studioId: ctx.studioId,
      agentId: targetAgent.id,
      gameId: args.gameId ?? ctx.task.gameId,
      parentTaskId: ctx.task.id,
      createdByAgentId: ctx.agent.id,
      origin,
      priority: args.priority,
      title: args.title,
      brief: args.brief,
      tags: args.tags,
      dependsOnTaskIds: resolvedDeps,
    });

    await ctx.log.entry(
      'HANDOFF',
      `Delegated "${created.title}" to ${targetAgent.name}`,
      {
        handoffTaskId: created.id,
        handoffAgentKey: targetAgent.key,
      },
    );

    return {
      payload: {
        ok: true,
        taskId: created.id,
        agentKey: created.agentKey,
        status: created.status,
      },
    };
  }
}
