import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { ReviewService } from '../../review/review.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class SubmitForReviewTool implements ToolHandler<'submit_for_review'> {
  readonly name = 'submit_for_review' as const;

  constructor(private readonly review: ReviewService) {}

  async execute(
    args: ToolArgsOf<'submit_for_review'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const revisesId =
      typeof ctx.task.metadata?.['revisesReviewItemId'] === 'string'
        ? ctx.task.metadata['revisesReviewItemId']
        : null;

    const item = await this.review.submitForReview({
      studioId: ctx.studioId,
      gameId: ctx.task.gameId,
      kind: args.kind,
      title: args.title,
      description: args.description,
      mediaId: args.mediaId,
      madeByAgentId: ctx.agent.id,
      taskId: ctx.task.id,
      runId: ctx.run.id,
      buildVersion: args.buildVersion,
      checklist: args.checklist,
      revisesReviewItemId: revisesId,
    });

    await ctx.log.entry(
      'SYSTEM',
      `Submitted for review: ${args.title} (${args.kind})`,
      {
        createdArtifact: {
          kind: 'review_item',
          id: item.id,
          title: `${args.kind}: ${args.title}`,
          content: args.description,
          mediaId: args.mediaId ?? undefined,
        },
      },
    );

    return {
      payload: {
        ok: true,
        reviewItemId: item.id,
      },
    };
  }
}
