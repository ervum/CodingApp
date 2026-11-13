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
  GeneratePitchesSchema,
  PickPitchSchema,
  RequestPitchChangesSchema,
  UpdatePitchSchema,
  type GameDto,
  type GeneratePitchesRequest,
  type PickPitchRequest,
  type PitchDetailDto,
  type PitchDto,
  type PitchStatus,
  type RequestPitchChanges,
  type TaskDto,
  type UpdatePitchRequest,
} from '@robdev/shared';
import { z } from 'zod';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { PitchesService } from './pitches.service.js';

const ListPitchesQuerySchema = z.object({
  status: z
    .enum(['DRAFT', 'PROPOSED', 'CHANGES_REQUESTED', 'PICKED', 'ARCHIVED'])
    .optional(),
});

@Controller('studios/:studioId/pitches')
@UseGuards(StudioAccessGuard)
export class PitchesController {
  constructor(private readonly pitches: PitchesService) {}

  @Get()
  async list(
    @Param('studioId') studioId: string,
    @Query(new ZodValidationPipe(ListPitchesQuerySchema))
    query: { status?: PitchStatus },
  ): Promise<PitchDto[]> {
    return this.pitches.list(studioId, query.status);
  }

  @Get(':id')
  async getDetail(
    @Param('studioId') studioId: string,
    @Param('id') pitchId: string,
  ): Promise<PitchDetailDto> {
    return this.pitches.getDetail(studioId, pitchId);
  }

  @Post('generate')
  @StudioRoles('PRODUCER')
  async generate(
    @Param('studioId') studioId: string,
    @Body(new ZodValidationPipe(GeneratePitchesSchema))
    body: GeneratePitchesRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TaskDto> {
    return this.pitches.generate(studioId, body, user.id);
  }

  @Patch(':id')
  @StudioRoles('PRODUCER')
  async update(
    @Param('studioId') studioId: string,
    @Param('id') pitchId: string,
    @Body(new ZodValidationPipe(UpdatePitchSchema)) body: UpdatePitchRequest,
  ): Promise<PitchDetailDto> {
    return this.pitches.update(studioId, pitchId, body);
  }

  @Post(':id/pick')
  @StudioRoles('PRODUCER')
  async pick(
    @Param('studioId') studioId: string,
    @Param('id') pitchId: string,
    @Body(new ZodValidationPipe(PickPitchSchema)) body: PickPitchRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ pitch: PitchDetailDto; game: GameDto; task: TaskDto }> {
    return this.pitches.pick(studioId, pitchId, body, user.id);
  }

  @Post(':id/request-changes')
  @StudioRoles('PRODUCER')
  async requestChanges(
    @Param('studioId') studioId: string,
    @Param('id') pitchId: string,
    @Body(new ZodValidationPipe(RequestPitchChangesSchema))
    body: RequestPitchChanges,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ pitch: PitchDetailDto; task: TaskDto }> {
    return this.pitches.requestChanges(studioId, pitchId, body, user.id);
  }
}
