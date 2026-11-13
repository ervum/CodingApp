import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  CreateStudioAssetSchema,
  ListStudioAssetsQuerySchema,
  UpdateStudioAssetSchema,
  type CreateStudioAssetRequest,
  type ListStudioAssetsQuery,
  type StudioAssetDto,
  type UpdateStudioAssetRequest,
} from '@robdev/shared';
import {
  StudioCtx,
  type StudioRequestContext,
} from '../../common/decorators/studio-context.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AssetsService } from './assets.service.js';

@Controller('studios/:studioId/assets')
@UseGuards(StudioAccessGuard)
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  async list(
    @StudioCtx() studio: StudioRequestContext,
    @Query(new ZodValidationPipe(ListStudioAssetsQuerySchema))
    query: ListStudioAssetsQuery,
  ): Promise<StudioAssetDto[]> {
    return this.assets.list(studio.id, query);
  }

  @Post()
  @StudioRoles('PRODUCER')
  async create(
    @StudioCtx() studio: StudioRequestContext,
    @Body(new ZodValidationPipe(CreateStudioAssetSchema))
    body: CreateStudioAssetRequest,
  ): Promise<StudioAssetDto> {
    return this.assets.create(studio.id, body);
  }

  @Post('upload')
  @StudioRoles('PRODUCER')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async upload(
    @StudioCtx() studio: StudioRequestContext,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    @Body() rawBody: Record<string, unknown>,
  ): Promise<StudioAssetDto> {
    const rawTags = rawBody['tags'];
    const tags =
      typeof rawTags === 'string'
        ? rawTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : Array.isArray(rawTags)
          ? rawTags
          : [];
    const parsed = CreateStudioAssetSchema.parse({
      ...rawBody,
      gameId:
        typeof rawBody['gameId'] === 'string' &&
        rawBody['gameId'].trim() !== '' &&
        rawBody['gameId'] !== 'null'
          ? rawBody['gameId']
          : null,
      tags,
    });
    return this.assets.upload(studio.id, file, parsed);
  }

  @Patch(':assetId')
  @StudioRoles('PRODUCER')
  async update(
    @StudioCtx() studio: StudioRequestContext,
    @Param('assetId') assetId: string,
    @Body(new ZodValidationPipe(UpdateStudioAssetSchema))
    body: UpdateStudioAssetRequest,
  ): Promise<StudioAssetDto> {
    return this.assets.update(studio.id, assetId, body);
  }

  @Delete(':assetId')
  @StudioRoles('PRODUCER')
  async remove(
    @StudioCtx() studio: StudioRequestContext,
    @Param('assetId') assetId: string,
  ): Promise<{ deletedId: string }> {
    return this.assets.delete(studio.id, assetId);
  }
}
