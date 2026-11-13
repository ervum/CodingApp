import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { GamesService } from '../../games/games.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class UpdateMilestoneTool implements ToolHandler<'update_milestone'> {
  readonly name = 'update_milestone' as const;

  constructor(private readonly games: GamesService) {}

  async execute(
    args: ToolArgsOf<'update_milestone'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.game) {
      return {
        payload: {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: 'update_milestone requires a task bound to a game',
        },
      };
    }

    const milestone = await this.games.upsertMilestoneByKey(
      ctx.studioId,
      ctx.game.id,
      args.key,
      args.status,
      args.title,
    );

    return {
      payload: {
        ok: true,
        milestoneId: milestone.id,
        status: milestone.status,
      },
    };
  }
}
