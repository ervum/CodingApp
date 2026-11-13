import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { HumanRequestsService } from '../../human-requests/human-requests.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class RequestHumanTool implements ToolHandler<'request_human'> {
  readonly name = 'request_human' as const;

  constructor(private readonly humanRequests: HumanRequestsService) {}

  async execute(
    args: ToolArgsOf<'request_human'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const req = await this.humanRequests.createFromTool({
      studioId: ctx.studioId,
      kind: args.kind,
      title: args.title,
      body: args.body,
      agentId: ctx.agent.id,
      agentKey: ctx.agent.key,
      taskId: ctx.task.id,
      gameId: ctx.task.gameId,
      options: args.options,
      buildVersion: args.buildVersion,
    });

    return {
      payload: {
        ok: true,
        requestId: req.id,
      },
      control: 'await-human',
    };
  }
}
