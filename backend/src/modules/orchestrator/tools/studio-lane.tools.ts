import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { LanesService } from '../../lanes/lanes.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class AcquireStudioLaneTool implements ToolHandler<'acquire_studio_lane'> {
  readonly name = 'acquire_studio_lane' as const;

  constructor(private readonly lanes: LanesService) {}

  async execute(
    _args: ToolArgsOf<'acquire_studio_lane'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.game) {
      return {
        payload: {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: 'acquire_studio_lane requires a task bound to a game',
        },
      };
    }

    const acquired = await this.lanes.acquire({
      studioId: ctx.studioId,
      agentId: ctx.agent.id,
      gameId: ctx.game.id,
      runId: ctx.run.id,
    });

    if (!acquired) {
      return {
        payload: {
          ok: false,
          error: 'LANE_BUSY',
          message: 'All Studio lanes are currently busy',
        },
      };
    }

    return {
      payload: {
        ok: true,
        laneName: acquired.name,
      },
    };
  }
}

@Injectable()
export class ReleaseStudioLaneTool implements ToolHandler<'release_studio_lane'> {
  readonly name = 'release_studio_lane' as const;

  constructor(private readonly lanes: LanesService) {}

  async execute(
    _args: ToolArgsOf<'release_studio_lane'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const released = await this.lanes.releaseByRun(ctx.studioId, ctx.run.id);
    return {
      payload: {
        ok: true,
        released,
      },
    };
  }
}
