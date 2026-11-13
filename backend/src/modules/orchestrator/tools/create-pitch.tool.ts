import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { PitchesService } from '../../pitches/pitches.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class CreatePitchTool implements ToolHandler<'create_pitch'> {
  readonly name = 'create_pitch' as const;

  constructor(private readonly pitches: PitchesService) {}

  async execute(
    args: ToolArgsOf<'create_pitch'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const pitch = await this.pitches.createFromTool({
      studioId: ctx.studioId,
      createdByAgentId: ctx.agent.id,
      taskId: ctx.task.id,
      title: args.title,
      logline: args.logline,
      genre: args.genre,
      metrics: args.metrics,
      whatChanged: args.whatChanged,
      howDifferent: args.howDifferent,
      comparables: args.comparables,
      sections: args.sections,
    });

    await ctx.log.entry(
      'SYSTEM',
      `Created game pitch: ${args.title} (${args.genre})`,
      {
        createdArtifact: {
          kind: 'pitch',
          id: pitch.id,
          title: `${args.title} (${args.genre})`,
          content: args.logline,
        },
      },
    );

    return {
      payload: {
        ok: true,
        pitchId: pitch.id,
      },
    };
  }
}
