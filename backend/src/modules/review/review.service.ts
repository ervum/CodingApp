import { HttpStatus, Injectable } from '@nestjs/common';
import {
  REVIEW_KIND_TAB,
  VERDICT_TO_STATUS,
  type BlockerDto,
  type BlockerStatus,
  type ListReviewQuery,
  type ReviewAnnotationDto,
  type ReviewCountsDto,
  type ReviewItemDetailDto,
  type ReviewItemDto,
  type ReviewKind,
  type StageChecklistItem,
  type StagePayload,
  type UploadReviewMeta,
  type VerdictRequest,
} from '@robdev/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BuildsService } from '../games/builds.service.js';
import { GamesService } from '../games/games.service.js';
import { MediaService } from '../media/media.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { BlockersService } from './blockers.service.js';

const REVIEW_ITEM_INCLUDE = {
  game: { select: { id: true, name: true } },
  madeByAgent: { select: { id: true, key: true } },
  media: true,
  blockers: {
    select: { id: true, status: true, severity: true },
  },
} satisfies Prisma.ReviewItemInclude;

type ReviewItemWithRelations = Prisma.ReviewItemGetPayload<{
  include: typeof REVIEW_ITEM_INCLUDE;
}>;

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly blockers: BlockersService,
    private readonly tasks: TasksService,
    private readonly games: GamesService,
    private readonly builds: BuildsService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(studioId: string, query: ListReviewQuery): Promise<ReviewItemDto[]> {
    const rows = await this.prisma.reviewItem.findMany({
      where: {
        studioId,
        tab: query.tab,
        ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
        ...(query.gameId ? { gameId: query.gameId } : {}),
      },
      include: REVIEW_ITEM_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async counts(studioId: string, gameId?: string): Promise<ReviewCountsDto> {
    return this.realtime.computeReviewCounts(studioId, gameId);
  }

  async getById(studioId: string, itemId: string): Promise<ReviewItemDto> {
    const row = await this.prisma.reviewItem.findFirst({
      where: { id: itemId, studioId },
      include: REVIEW_ITEM_INCLUDE,
    });
    if (!row) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Review item not found');
    }
    return this.toDto(row);
  }

  async getDetail(studioId: string, itemId: string): Promise<ReviewItemDetailDto> {
    const row = await this.prisma.reviewItem.findFirst({
      where: { id: itemId, studioId },
      include: {
        ...REVIEW_ITEM_INCLUDE,
        verdicts: {
          include: { user: { select: { displayName: true } } },
          orderBy: { createdAt: 'desc' },
        },
        blockers: {
          include: { agent: { select: { key: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!row) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Review item not found');
    }

    const previousIterations: ReviewItemDetailDto['previousIterations'] = [];
    let cursorId = row.previousItemId;
    const seen = new Set<string>([row.id]);
    while (cursorId && !seen.has(cursorId)) {
      seen.add(cursorId);
      const prev = await this.prisma.reviewItem.findFirst({
        where: { id: cursorId, studioId },
        include: {
          media: true,
          verdicts: {
            select: { feedback: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
      if (!prev) break;
      previousIterations.push({
        id: prev.id,
        iteration: prev.iteration,
        status: prev.status,
        media: this.media.toDto(prev.media),
        lastFeedback: prev.verdicts[0]?.feedback ?? null,
        createdAt: prev.createdAt.toISOString(),
      });
      cursorId = prev.previousItemId;
    }

    const dto = this.toDto(row);
    return {
      ...dto,
      description: row.description,
      payload: this.parsePayload(row.payload),
      verdicts: row.verdicts.map((v) => ({
        id: v.id,
        verdict: v.verdict,
        feedback: v.feedback,
        annotations: Array.isArray(v.annotations)
          ? (v.annotations as unknown as ReviewAnnotationDto[])
          : [],
        userDisplayName: v.user.displayName,
        createdAt: v.createdAt.toISOString(),
      })),
      blockers: row.blockers.map((b) => this.blockers.toDto(b)),
      previousIterations,
      taskId: row.taskId,
      runId: row.runId,
    };
  }

  async submitForReview(params: {
    studioId: string;
    gameId: string | null;
    kind: ReviewKind;
    title: string;
    description: string;
    mediaId: string | null;
    madeByAgentId: string;
    taskId: string;
    runId: string;
    buildVersion: number | null;
    checklist: StageChecklistItem[];
    revisesReviewItemId?: string | null;
  }): Promise<ReviewItemDto> {
    let iteration = 1;
    let previousItemId: string | null = null;

    if (params.revisesReviewItemId) {
      const prev = await this.prisma.reviewItem.findFirst({
        where: { id: params.revisesReviewItemId, studioId: params.studioId },
        select: { id: true, iteration: true },
      });
      if (prev) {
        iteration = prev.iteration + 1;
        previousItemId = prev.id;
      }
    }

    const tab = REVIEW_KIND_TAB[params.kind];
    const hasStagePayload =
      params.kind === 'STAGE' ||
      params.kind === 'PUBLISH' ||
      params.buildVersion !== null ||
      params.checklist.length > 0;

    const payload: Prisma.InputJsonValue | undefined = hasStagePayload
      ? {
          buildVersion: params.buildVersion,
          checklist: params.checklist.map((c) => ({ label: c.label, done: c.done })),
        }
      : undefined;

    const created = await this.prisma.reviewItem.create({
      data: {
        studioId: params.studioId,
        gameId: params.gameId,
        kind: params.kind,
        tab,
        status: 'TO_REVIEW',
        title: params.title,
        description: params.description,
        madeByAgentId: params.madeByAgentId,
        mediaId: params.mediaId,
        taskId: params.taskId,
        runId: params.runId,
        ...(payload !== undefined ? { payload } : {}),
        iteration,
        previousItemId,
      },
    });

    if (params.gameId && params.buildVersion !== null) {
      await this.prisma.blocker.updateMany({
        where: {
          studioId: params.studioId,
          gameId: params.gameId,
          buildVersion: params.buildVersion,
          status: 'OPEN',
          reviewItemId: null,
        },
        data: { reviewItemId: created.id },
      });
    }

    if (params.kind === 'PUBLISH' && params.gameId && params.buildVersion !== null) {
      await this.builds.enqueueMobilePassB(
        params.studioId,
        params.gameId,
        params.buildVersion,
      );
    }

    const dto = await this.getById(params.studioId, created.id);
    this.realtime.emitToStudio(params.studioId, 'review:item', {
      item: dto,
      change: 'created',
    });
    this.realtime.broadcastCounts(params.studioId);
    return dto;
  }

  async applyVerdict(
    studioId: string,
    itemId: string,
    body: VerdictRequest,
    user: AuthenticatedUser,
  ): Promise<ReviewItemDetailDto> {
    const item = await this.prisma.reviewItem.findFirst({
      where: { id: itemId, studioId },
      include: {
        blockers: true,
      },
    });
    if (!item) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Review item not found');
    }

    if (item.status !== 'TO_REVIEW' && item.status !== 'CHANGES_ASKED') {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `Cannot apply verdict to item in status ${item.status}`,
      );
    }

    const parsedPayload = this.parsePayload(item.payload);

    if (body.verdict === 'APPROVE' && (item.kind === 'STAGE' || item.kind === 'PUBLISH')) {
      const openFixFirst = item.blockers.filter(
        (b) => b.status === 'OPEN' && b.severity === 'FIX_FIRST',
      );
      if (openFixFirst.length > 0) {
        throw new AppError(
          'FIX_FIRST_BLOCKERS_OPEN',
          HttpStatus.CONFLICT,
          `Cannot approve ${item.kind} item while ${openFixFirst.length} FIX_FIRST blocker(s) remain OPEN`,
          { openFixFirstCount: openFixFirst.length },
        );
      }

      if (item.kind === 'PUBLISH' && item.gameId && parsedPayload?.buildVersion) {
        const build = await this.prisma.gameBuild.findFirst({
          where: {
            gameId: item.gameId,
            version: parsedPayload.buildVersion,
          },
          orderBy: { createdAt: 'desc' },
        });
        if (
          build &&
          (build.mobilePassA !== 'PASSED' || build.mobilePassB !== 'PASSED')
        ) {
          throw new AppError(
            'FIX_FIRST_BLOCKERS_OPEN',
            HttpStatus.CONFLICT,
            'Both 108 Tester mobile passes (Pass A and Pass B) must be PASSED before publish approval',
            {
              reason: 'MOBILE_PASSES_INCOMPLETE',
              mobilePassA: build.mobilePassA,
              mobilePassB: build.mobilePassB,
            },
          );
        }
      }
    }

    const nextStatus = VERDICT_TO_STATUS[body.verdict];
    const feedback = body.feedback?.trim() || null;
    const annotations = body.annotations ?? [];

    await this.prisma.$transaction(async (tx) => {
      await tx.reviewVerdict.create({
        data: {
          reviewItemId: item.id,
          userId: user.id,
          verdict: body.verdict,
          feedback,
          ...(annotations.length > 0
            ? { annotations: annotations as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      await tx.reviewItem.update({
        where: { id: item.id },
        data: { status: nextStatus },
      });
    });

    let followUpTaskId: string | null = null;
    if (body.verdict === 'ASK_CHANGES' && item.madeByAgentId && feedback) {
      const annotationLines =
        annotations.length > 0
          ? [
              'Pinned Region Annotations:',
              ...annotations.map(
                (a, idx) =>
                  `- #${idx + 1} Region (${Math.round(a.x * 100)}%, ${Math.round(a.y * 100)}%, ${Math.round(a.w * 100)}×${Math.round(a.h * 100)}%): ${a.note}`,
              ),
            ].join('\n')
          : '';
      const followUp = await this.tasks.createInternal({
        studioId,
        agentId: item.madeByAgentId,
        gameId: item.gameId,
        createdByUserId: user.id,
        origin: 'REVIEW_FEEDBACK',
        priority: 'HIGH',
        title: `Revise: ${item.title}`.slice(0, 140),
        brief: [
          `Human review requested changes on review item "${item.title}" (id: ${item.id}, iteration v${item.iteration}).`,
          `Feedback: ${feedback}`,
          annotationLines,
          item.description ? `Original context: ${item.description}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        tags: ['review-revision'],
        metadata: { revisesReviewItemId: item.id },
      });
      followUpTaskId = followUp.id;
    }

    if (
      body.verdict === 'APPROVE' &&
      item.kind === 'PUBLISH' &&
      item.gameId &&
      parsedPayload?.buildVersion
    ) {
      await this.games.upsertMilestoneByKey(
        studioId,
        item.gameId,
        'publish-approved',
        'DONE',
        `Publish approved (v${parsedPayload.buildVersion})`,
      );
    }

    const detail = await this.getDetail(studioId, item.id);
    this.realtime.emitToStudio(studioId, 'review:verdict', {
      reviewItemId: item.id,
      verdict: body.verdict,
      status: nextStatus,
      feedback,
      byUserName: user.displayName,
      followUpTaskId,
    });
    this.realtime.emitToStudio(studioId, 'review:item', {
      item: detail,
      change: 'updated',
    });
    this.realtime.broadcastCounts(studioId);

    return detail;
  }

  async upload(
    studioId: string,
    file: { buffer: Buffer; mimetype: string; size: number; originalname?: string } | undefined,
    meta: UploadReviewMeta,
  ): Promise<ReviewItemDto> {
    if (!file) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Media file is required');
    }

    const isImage = ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype);
    const isVideo = ['video/mp4', 'video/webm'].includes(file.mimetype);
    if (!isImage && !isVideo) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'Unsupported file type (allowed: png, jpeg, webp, mp4, webm)',
      );
    }

    const maxBytes = isImage ? 10 * 1024 * 1024 : 200 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        `File exceeds maximum size of ${isImage ? '10 MB' : '200 MB'}`,
      );
    }

    if (meta.gameId) {
      const game = await this.prisma.game.findFirst({
        where: { id: meta.gameId, studioId },
        select: { id: true },
      });
      if (!game) {
        throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
      }
    }

    const storedMedia = await this.media.store(studioId, file.buffer, file.mimetype);
    const created = await this.prisma.reviewItem.create({
      data: {
        studioId,
        gameId: meta.gameId,
        kind: meta.kind,
        tab: REVIEW_KIND_TAB[meta.kind],
        status: 'TO_REVIEW',
        title: meta.title,
        description: meta.description?.trim() || 'Uploaded by operator',
        mediaId: storedMedia.id,
        iteration: 1,
      },
      include: REVIEW_ITEM_INCLUDE,
    });

    const dto = this.toDto(created);
    this.realtime.emitToStudio(studioId, 'review:item', {
      item: dto,
      change: 'created',
    });
    this.realtime.broadcastCounts(studioId);
    return dto;
  }

  async updateBlocker(
    studioId: string,
    blockerId: string,
    status: BlockerStatus,
  ): Promise<BlockerDto> {
    const { blocker, reviewItemId } = await this.blockers.updateStatus(
      studioId,
      blockerId,
      status,
    );

    if (reviewItemId) {
      const itemDto = await this.getById(studioId, reviewItemId);
      this.realtime.emitToStudio(studioId, 'review:item', {
        item: itemDto,
        change: 'updated',
      });
    }

    return blocker;
  }

  toDto(row: ReviewItemWithRelations): ReviewItemDto {
    const openBlockers = row.blockers.filter((b) => b.status === 'OPEN').length;
    const openFixFirst = row.blockers.filter(
      (b) => b.status === 'OPEN' && b.severity === 'FIX_FIRST',
    ).length;

    return {
      id: row.id,
      kind: row.kind,
      tab: row.tab,
      status: row.status,
      title: row.title,
      gameId: row.gameId,
      gameName: row.game?.name ?? null,
      madeByAgentKey: row.madeByAgent?.key ?? null,
      media: this.media.toDto(row.media),
      iteration: row.iteration,
      openBlockers,
      openFixFirst,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private parsePayload(raw: unknown): StagePayload | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const buildVersion =
      typeof obj['buildVersion'] === 'number' ? obj['buildVersion'] : null;
    const rawChecklist = Array.isArray(obj['checklist']) ? obj['checklist'] : [];
    const checklist: StageChecklistItem[] = [];
    for (const item of rawChecklist) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['label'] === 'string' &&
        typeof (item as Record<string, unknown>)['done'] === 'boolean'
      ) {
        checklist.push({
          label: (item as Record<string, string>)['label']!,
          done: (item as Record<string, boolean>)['done']!,
        });
      }
    }
    return { buildVersion, checklist };
  }
}
