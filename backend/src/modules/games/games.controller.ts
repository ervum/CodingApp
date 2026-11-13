import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateGameSchema,
  PublishGameOpenCloudSchema,
  RecordBuildSchema,
  UpdateGameSchema,
  UpdateMilestoneSchema,
  type CreateGameRequest,
  type GameBuildDto,
  type GameDetailDto,
  type GameDto,
  type GameMilestoneDto,
  type Paginated,
  type PublishGameOpenCloudRequest,
  type PublishGameOpenCloudResultDto,
  type RecordBuildRequest,
  type UpdateGameRequest,
  type UpdateMilestoneRequest,
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
import { BuildsService } from './builds.service.js';
import { GamesService } from './games.service.js';

@Controller('studios/:studioId/games')
@UseGuards(StudioAccessGuard)
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly builds: BuildsService,
  ) {}

  @Get()
  async list(@StudioCtx() studio: StudioRequestContext): Promise<GameDto[]> {
    return this.games.list(studio.id);
  }

  @Post()
  @StudioRoles('PRODUCER')
  async create(
    @StudioCtx() studio: StudioRequestContext,
    @Body(new ZodValidationPipe(CreateGameSchema)) body: CreateGameRequest,
  ): Promise<GameDto> {
    return this.games.create(studio.id, body);
  }

  @Get(':gameId')
  async getDetail(
    @StudioCtx() studio: StudioRequestContext,
    @Param('gameId') gameId: string,
  ): Promise<GameDetailDto> {
    return this.games.getDetail(studio.id, gameId);
  }

  @Patch(':gameId')
  @StudioRoles('PRODUCER')
  async update(
    @StudioCtx() studio: StudioRequestContext,
    @Param('gameId') gameId: string,
    @Body(new ZodValidationPipe(UpdateGameSchema)) body: UpdateGameRequest,
  ): Promise<GameDto> {
    return this.games.update(studio.id, gameId, body);
  }

  @Get(':gameId/builds')
  async listBuilds(
    @StudioCtx() studio: StudioRequestContext,
    @Param('gameId') gameId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limitRaw?: string,
  ): Promise<Paginated<GameBuildDto>> {
    const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw) || 25)) : 25;
    return this.builds.list(studio.id, gameId, cursor, limit);
  }

  @Post(':gameId/builds')
  @StudioRoles('PRODUCER')
  async recordBuild(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('gameId') gameId: string,
    @Body(new ZodValidationPipe(RecordBuildSchema)) body: RecordBuildRequest,
  ): Promise<GameBuildDto> {
    return this.builds.record({
      studioId: studio.id,
      gameId,
      version: body.version,
      kind: body.kind,
      notes: body.notes,
      userId: user.id,
    });
  }

  @Patch(':gameId/milestones/:milestoneId')
  @StudioRoles('PRODUCER')
  async updateMilestone(
    @StudioCtx() studio: StudioRequestContext,
    @Param('gameId') gameId: string,
    @Param('milestoneId') milestoneId: string,
    @Body(new ZodValidationPipe(UpdateMilestoneSchema)) body: UpdateMilestoneRequest,
  ): Promise<GameMilestoneDto> {
    return this.games.updateMilestone(studio.id, gameId, milestoneId, body);
  }

  @Post(':gameId/publish')
  @StudioRoles('PRODUCER')
  async publishOpenCloud(
    @StudioCtx() studio: StudioRequestContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('gameId') gameId: string,
    @Body(new ZodValidationPipe(PublishGameOpenCloudSchema))
    body: PublishGameOpenCloudRequest,
  ): Promise<PublishGameOpenCloudResultDto> {
    return this.games.publishViaOpenCloud(studio.id, gameId, body, user.id);
  }
}
