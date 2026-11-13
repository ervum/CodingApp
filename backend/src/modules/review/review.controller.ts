import {
  Body,
  Controller,
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
  ListReviewQuerySchema,
  UpdateBlockerSchema,
  UploadReviewMetaSchema,
  VerdictRequestSchema,
  type BlockerDto,
  type ListReviewQuery,
  type ReviewCountsDto,
  type ReviewItemDetailDto,
  type ReviewItemDto,
  type UpdateBlockerRequest,
  type VerdictRequest,
} from '@robdev/shared';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator.js';
import { StudioRoles } from '../../common/decorators/studio-roles.decorator.js';
import { StudioAccessGuard } from '../../common/guards/studio-access.guard.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { ReviewService } from './review.service.js';

@Controller('studios/:studioId')
@UseGuards(StudioAccessGuard)
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get('review-items')
  async list(
    @Param('studioId') studioId: string,
    @Query(new ZodValidationPipe(ListReviewQuerySchema)) query: ListReviewQuery,
  ): Promise<ReviewItemDto[]> {
    return this.review.list(studioId, query);
  }

  @Get('review-items/counts')
  async counts(
    @Param('studioId') studioId: string,
    @Query('gameId') gameId?: string,
  ): Promise<ReviewCountsDto> {
    return this.review.counts(studioId, gameId || undefined);
  }

  @Get('review-items/:id')
  async getDetail(
    @Param('studioId') studioId: string,
    @Param('id') itemId: string,
  ): Promise<ReviewItemDetailDto> {
    return this.review.getDetail(studioId, itemId);
  }

  @Post('review-items/:id/verdict')
  @StudioRoles('PRODUCER')
  async applyVerdict(
    @Param('studioId') studioId: string,
    @Param('id') itemId: string,
    @Body(new ZodValidationPipe(VerdictRequestSchema)) body: VerdictRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ReviewItemDetailDto> {
    return this.review.applyVerdict(studioId, itemId, body, user);
  }

  @Post('review-items/upload')
  @StudioRoles('PRODUCER')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('studioId') studioId: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string } | undefined,
    @Body() rawBody: Record<string, unknown>,
  ): Promise<ReviewItemDto> {
    const rawGameId = rawBody['gameId'];
    const normalizedGameId =
      typeof rawGameId === 'string' && rawGameId.trim() !== '' && rawGameId !== 'null'
        ? rawGameId
        : null;
    const meta = UploadReviewMetaSchema.parse({
      ...rawBody,
      gameId: normalizedGameId,
    });
    return this.review.upload(studioId, file, meta);
  }

  @Patch('blockers/:blockerId')
  @StudioRoles('PRODUCER')
  async updateBlocker(
    @Param('studioId') studioId: string,
    @Param('blockerId') blockerId: string,
    @Body(new ZodValidationPipe(UpdateBlockerSchema)) body: UpdateBlockerRequest,
  ): Promise<BlockerDto> {
    return this.review.updateBlocker(studioId, blockerId, body.status);
  }
}
