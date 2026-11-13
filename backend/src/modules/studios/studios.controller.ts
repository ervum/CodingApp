import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateStudioSchema,
  UpdateStudioSchema,
  type CreateStudioRequest,
  type StudioDto,
  type StudioSnapshotDto,
  type StudioSummaryDto,
  type UpdateStudioRequest,
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
import { SnapshotService } from './snapshot.service.js';
import { StudiosService } from './studios.service.js';

@Controller('studios')
export class StudiosController {
  constructor(
    private readonly studios: StudiosService,
    private readonly snapshot: SnapshotService,
  ) {}

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<StudioSummaryDto[]> {
    return this.studios.listForUser(user.id);
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateStudioSchema)) body: CreateStudioRequest,
  ): Promise<StudioSummaryDto> {
    return this.studios.create(user.id, body);
  }

  @Get(':studioId/snapshot')
  @UseGuards(StudioAccessGuard)
  async getSnapshot(
    @Param('studioId') studioId: string,
    @StudioCtx() studio: StudioRequestContext,
  ): Promise<StudioSnapshotDto> {
    return this.snapshot.getSnapshot(studioId, studio.role);
  }

  @Patch(':studioId')
  @UseGuards(StudioAccessGuard)
  @StudioRoles('ADMIN')
  async update(
    @Param('studioId') studioId: string,
    @Body(new ZodValidationPipe(UpdateStudioSchema)) body: UpdateStudioRequest,
  ): Promise<StudioDto> {
    return this.studios.update(studioId, body);
  }

  @Post(':studioId/pause')
  @UseGuards(StudioAccessGuard)
  @StudioRoles('ADMIN')
  async pause(
    @Param('studioId') studioId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StudioDto> {
    return this.studios.pause(studioId, user.displayName);
  }

  @Post(':studioId/resume')
  @UseGuards(StudioAccessGuard)
  @StudioRoles('ADMIN')
  async resume(
    @Param('studioId') studioId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<StudioDto> {
    return this.studios.resume(studioId, user.displayName);
  }
}
