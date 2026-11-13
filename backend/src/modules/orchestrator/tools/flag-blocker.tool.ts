import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { BlockersService } from '../../review/blockers.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class FlagBlockerTool implements ToolHandler<'flag_blocker'> {
  readonly name = 'flag_blocker' as const;

  constructor(private readonly blockers: BlockersService) {}

  async execute(
    args: ToolArgsOf<'flag_blocker'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const blocker = await this.blockers.flag({
      studioId: ctx.studioId,
      gameId: ctx.task.gameId,
      taskId: ctx.task.id,
      runId: ctx.run.id,
      agentId: ctx.agent.id,
      severity: args.severity,
      title: args.title,
      detail: args.detail,
      buildVersion: args.buildVersion,
    });

    return {
      payload: {
        ok: true,
        blockerId: blocker.id,
      },
    };
  }
}
