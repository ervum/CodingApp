import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateLaneSchema,
  type CreateLaneRequest,
  type StudioLaneDto,
} from '@robdev/shared';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { LanesService } from './lanes.service.js';

@Controller('studios/:studioId/lanes')
@UseGuards(StudioAccessGuard)
export class LanesController {
  constructor(private readonly lanes: LanesService) {}

  @Get()
  async list(@StudioCtx() studio: StudioRequestContext): Promise<StudioLaneDto[]> {
    return this.lanes.list(studio.id);
  }

  @Post()
  @StudioRoles('ADMIN')
  async create(
    @StudioCtx() studio: StudioRequestContext,
    @Body(new ZodValidationPipe(CreateLaneSchema)) body: CreateLaneRequest,
  ): Promise<StudioLaneDto> {
    return this.lanes.create(studio.id, body.name);
  }

  @Post(':laneId/release')
  @StudioRoles('ADMIN')
  @HttpCode(HttpStatus.OK)
  async release(
    @StudioCtx() studio: StudioRequestContext,
    @Param('laneId') laneId: string,
  ): Promise<StudioLaneDto> {
    return this.lanes.forceRelease(studio.id, laneId);
  }
}
