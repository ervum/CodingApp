import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { BuildsService } from '../../games/builds.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class RecordBuildTool implements ToolHandler<'record_build'> {
  readonly name = 'record_build' as const;

  constructor(private readonly builds: BuildsService) {}

  async execute(
    args: ToolArgsOf<'record_build'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (!ctx.game) {
      return {
        payload: {
          ok: false,
          error: 'VALIDATION_FAILED',
          message: 'record_build requires a task bound to a game',
        },
      };
    }

    const build = await this.builds.record({
      studioId: ctx.studioId,
      gameId: ctx.game.id,
      version: args.version,
      kind: args.kind,
      notes: args.notes,
      agentId: ctx.agent.id,
    });

    return {
      payload: {
        ok: true,
        buildId: build.id,
      },
    };
  }
}
