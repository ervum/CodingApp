import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  HumanRequestStatus,
  ReplyHumanRequestSchema,
  ResolveHumanRequestSchema,
  type HumanRequestDto,
  type ReplyHumanRequest,
  type ResolveHumanRequest,
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
import { HumanRequestsService } from './human-requests.service.js';

@Controller('studios/:studioId/human-requests')
@UseGuards(StudioAccessGuard)
export class HumanRequestsController {
  constructor(private readonly humanRequests: HumanRequestsService) {}

  @Get()
  async list(
    @StudioCtx() studio: StudioRequestContext,
    @Query('status') statusRaw?: string,
  ): Promise<HumanRequestDto[]> {
    const status =
      statusRaw && statusRaw in HumanRequestStatus
        ? (statusRaw as HumanRequestStatus)
        : undefined;
    return this.humanRequests.list(studio.id, status);
  }

  @Post(':id/reply')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async reply(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReplyHumanRequestSchema)) body: ReplyHumanRequest,
  ): Promise<HumanRequestDto> {
    return this.humanRequests.reply(studio.id, id, body, user);
  }

  @Post(':id/resolve')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async resolve(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResolveHumanRequestSchema)) body: ResolveHumanRequest,
  ): Promise<HumanRequestDto> {
    return this.humanRequests.resolve(studio.id, id, body, user);
  }
}
