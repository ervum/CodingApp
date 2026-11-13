import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreatePlaybookSchema,
  RunPlaybookSchema,
  UpdatePlaybookSchema,
  type CreatePlaybookRequest,
  type PlaybookDto,
  type RunPlaybookRequest,
  type RunPlaybookResultDto,
  type UpdatePlaybookRequest,
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
import { PlaybooksService } from './playbooks.service.js';

@Controller('studios/:studioId/playbooks')
@UseGuards(StudioAccessGuard)
export class PlaybooksController {
  constructor(private readonly playbooks: PlaybooksService) {}

  @Get()
  async list(@StudioCtx() studio: StudioRequestContext): Promise<PlaybookDto[]> {
    return this.playbooks.list(studio.id);
  }

  @Post()
  @StudioRoles('PRODUCER')
  async create(
    @StudioCtx() studio: StudioRequestContext,
    @Body(new ZodValidationPipe(CreatePlaybookSchema))
    body: CreatePlaybookRequest,
  ): Promise<PlaybookDto> {
    return this.playbooks.create(studio.id, body);
  }

  @Patch(':playbookId')
  @StudioRoles('PRODUCER')
  async update(
    @StudioCtx() studio: StudioRequestContext,
    @Param('playbookId') playbookId: string,
    @Body(new ZodValidationPipe(UpdatePlaybookSchema))
    body: UpdatePlaybookRequest,
  ): Promise<PlaybookDto> {
    return this.playbooks.update(studio.id, playbookId, body);
  }

  @Delete(':playbookId')
  @StudioRoles('PRODUCER')
  async remove(
    @StudioCtx() studio: StudioRequestContext,
    @Param('playbookId') playbookId: string,
  ): Promise<{ deletedId: string }> {
    return this.playbooks.delete(studio.id, playbookId);
  }

  @Post(':playbookId/run')
  @StudioRoles('PRODUCER')
  @HttpCode(HttpStatus.OK)
  async run(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('playbookId') playbookId: string,
    @Body(new ZodValidationPipe(RunPlaybookSchema)) body: RunPlaybookRequest,
  ): Promise<RunPlaybookResultDto> {
    return this.playbooks.run(studio.id, playbookId, body, user.id);
  }
}
