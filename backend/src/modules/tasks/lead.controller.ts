import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  LeadAskSchema,
  type AgentMessageDto,
  type LeadAskRequest,
  type TaskDto,
} from '@robdev/shared';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AgentMessagesService } from '../agents/agent-messages.service.js';

@Controller('studios/:studioId/lead')
@UseGuards(StudioAccessGuard)
export class LeadController {
  constructor(private readonly messages: AgentMessagesService) {}

  @Post('ask')
  @StudioRoles('PRODUCER')
  async ask(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(LeadAskSchema)) body: LeadAskRequest,
  ): Promise<{ message: AgentMessageDto; task: TaskDto }> {
    return this.messages.postUserMessage(
      studio.id,
      'lead',
      { body: body.prompt, gameId: body.gameId },
      user,
    );
  }
}
