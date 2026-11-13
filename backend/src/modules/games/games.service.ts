import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import type {
  AgentKey,
  CreateGameRequest,
  GameBuildDto,
  GameDetailDto,
  GameDto,
  GameMilestoneDto,
  GameStatus,
  PublishGameOpenCloudRequest,
  PublishGameOpenCloudResultDto,
  UpdateGameRequest,
  UpdateMilestoneRequest,
} from '@robdev/shared';
import { SecretBoxService } from '../../common/crypto/secret-box.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { bigIntToString, parseBigIntString } from '../../common/serialization/bigint.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { getWorkspaceRoots } from '../orchestrator/tools/terminal-and-permissions.helper.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { decryptStudioOpenCloudKey } from '../studios/studios.service.js';

export const DEFAULT_MILESTONES: ReadonlyArray<{
  key: string;
  title: string;
  sortOrder: number;
}> = [
  { key: 'concept', title: 'Concept locked', sortOrder: 1 },
  { key: 'blueprint', title: '12-step blueprint', sortOrder: 2 },
  { key: 'core-loop', title: 'Core loop playable', sortOrder: 3 },
  { key: 'ui-hud', title: 'UI & HUD pass', sortOrder: 4 },
  { key: 'world', title: 'World & lighting pass', sortOrder: 5 },
  { key: 'economy', title: 'Economy & monetisation', sortOrder: 6 },
  { key: 'qa-mobile', title: 'QA & mobile passes', sortOrder: 7 },
  { key: 'publish', title: 'First publish', sortOrder: 8 },
];

const GAME_INCLUDE = {
  milestones: { orderBy: { sortOrder: 'asc' as const } },
  lanesHeld: {
    include: { heldByAgent: { select: { key: true } } },
    orderBy: { sortOrder: 'asc' as const },
    take: 1,
  },
} satisfies Prisma.GameInclude;

type GameWithRelations = Prisma.GameGetPayload<{ include: typeof GAME_INCLUDE }>;

@Injectable()
export class GamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly secretBox?: SecretBoxService,
  ) {}

  async list(studioId: string): Promise<GameDto[]> {
    const games = await this.prisma.game.findMany({
      where: { studioId },
      include: GAME_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return games.map((g) => this.toDto(g));
  }

  async getById(studioId: string, gameId: string): Promise<GameDto> {
    const game = await this.prisma.game.findFirst({
      where: { id: gameId, studioId },
      include: GAME_INCLUDE,
    });
    if (!game) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
    }
    return this.toDto(game);
  }

  async getDetail(studioId: string, gameId: string): Promise<GameDetailDto> {
    const game = await this.prisma.game.findFirst({
      where: { id: gameId, studioId },
      include: {
        ...GAME_INCLUDE,
        builds: {
          include: {
            createdByAgent: { select: { key: true } },
            createdByUser: { select: { displayName: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { version: 'desc' }],
          take: 25,
        },
      },
    });
    if (!game) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
    }

    const dto = this.toDto(game);
    return {
      ...dto,
      description: game.description,
      robloxUniverseId: bigIntToString(game.robloxUniverseId),
      milestones: game.milestones.map((m) => this.toMilestoneDto(m)),
      recentBuilds: game.builds.map((b) => this.toBuildDto(b)),
    };
  }

  async create(
    studioId: string,
    body: CreateGameRequest,
    options?: {
      status?: GameStatus;
      createdFromPitchId?: string;
      tx?: Prisma.TransactionClient;
    },
  ): Promise<GameDto> {
    const db = options?.tx ?? this.prisma;
    const slug = await this.buildUniqueSlug(studioId, body.name, db);

    const created = await db.game.create({
      data: {
        studioId,
        slug,
        name: body.name,
        genre: body.genre,
        status: options?.status ?? 'CONCEPT',
        accentColor: body.accentColor ?? '#A855F7',
        description: body.description ?? '',
        createdFromPitchId: options?.createdFromPitchId ?? null,
        milestones: {
          createMany: {
            data: DEFAULT_MILESTONES.map((m) => ({
              key: m.key,
              title: m.title,
              sortOrder: m.sortOrder,
              status: 'TODO',
            })),
          },
        },
      },
      include: GAME_INCLUDE,
    });

    const dto = this.toDto(created);
    if (!options?.tx) {
      this.realtime.emitToStudio(studioId, 'game:updated', { game: dto });
    }
    return dto;
  }

  async update(
    studioId: string,
    gameId: string,
    body: UpdateGameRequest,
  ): Promise<GameDto> {
    const existing = await this.prisma.game.findFirst({
      where: { id: gameId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
    }

    const updated = await this.prisma.game.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.genre !== undefined ? { genre: body.genre } : {}),
        ...(body.accentColor !== undefined ? { accentColor: body.accentColor } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.robloxUniverseId !== undefined
          ? { robloxUniverseId: parseBigIntString(body.robloxUniverseId) }
          : {}),
        ...(body.robloxPlaceId !== undefined
          ? { robloxPlaceId: parseBigIntString(body.robloxPlaceId) }
          : {}),
      },
      include: GAME_INCLUDE,
    });

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'game:updated', { game: dto });

    if (body.status !== undefined && body.status !== existing.status) {
      await this.maybeSuggestPlaybookOnStatusChange(
        studioId,
        updated.id,
        updated.name,
        body.status,
      ).catch(() => {});
    }

    return dto;
  }

  private async maybeSuggestPlaybookOnStatusChange(
    studioId: string,
    gameId: string,
    gameName: string,
    nextStatus: GameStatus,
  ): Promise<void> {
    const playbook = await this.prisma.playbook?.findFirst?.({
      where: { studioId, suggestOnGameStatus: nextStatus },
      orderBy: { isBuiltIn: 'desc' },
    });
    if (!playbook) return;

    const leadAgent = await this.prisma.agent?.findUnique?.({
      where: { studioId_key: { studioId, key: 'lead' } },
      select: { id: true, key: true },
    });

    const options = [
      { id: `run:${playbook.id}`, label: `Run "${playbook.name}"` },
      { id: 'skip', label: 'Not right now' },
    ];

    const createdReq = await this.prisma.humanRequest?.create?.({
      data: {
        studioId,
        gameId,
        agentId: leadAgent?.id ?? null,
        kind: 'DECISION',
        status: 'OPEN',
        title: `Suggested Playbook for ${gameName} (${nextStatus}): ${playbook.name}`,
        body: `**${gameName}** moved to **${nextStatus}**. Would you like to launch the **${playbook.name}** playbook (${playbook.description})?`,
        options: options as unknown as Prisma.InputJsonValue,
      },
    });

    if (createdReq) {
      this.realtime.emitToStudio(studioId, 'human-request:updated', {
        request: {
          id: createdReq.id,
          kind: createdReq.kind,
          status: createdReq.status,
          title: createdReq.title,
          body: createdReq.body,
          gameId: createdReq.gameId,
          agentKey: leadAgent?.key ?? null,
          taskId: null,
          options,
          pitchIds: [],
          buildVersion: null,
          resolution: null,
          createdAt: createdReq.createdAt.toISOString(),
          resolvedAt: null,
        },
        change: 'created',
      });
      this.realtime.broadcastCounts(studioId);
    }
  }

  async publishViaOpenCloud(
    studioId: string,
    gameId: string,
    body: PublishGameOpenCloudRequest,
    userId: string,
  ): Promise<PublishGameOpenCloudResultDto> {
    const [game, studio] = await Promise.all([
      this.prisma.game.findFirst({
        where: { id: gameId, studioId },
        include: GAME_INCLUDE,
      }),
      this.prisma.studio.findUnique({
        where: { id: studioId },
      }),
    ]);

    if (!game || !studio) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game or studio not found');
    }

    const approvedPublishItem = await this.prisma.reviewItem.findFirst({
      where: {
        studioId,
        gameId: game.id,
        kind: 'PUBLISH',
        status: 'APPROVED',
      },
      include: {
        blockers: {
          where: { status: 'OPEN', severity: 'FIX_FIRST' },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!approvedPublishItem) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        'Publishing requires an APPROVED Publish review item in the Review queue.',
      );
    }

    if (approvedPublishItem.blockers.length > 0) {
      throw new AppError(
        'FIX_FIRST_BLOCKERS_OPEN',
        HttpStatus.CONFLICT,
        `Cannot publish while ${approvedPublishItem.blockers.length} FIX_FIRST blocker(s) remain OPEN.`,
      );
    }

    const universeId =
      bigIntToString(game.robloxUniverseId) ?? studio.robloxUniverseId ?? null;
    const placeId =
      bigIntToString(game.robloxPlaceId) ?? studio.robloxPlaceId ?? null;
    const apiKey = decryptStudioOpenCloudKey(studio, this.secretBox);

    if (!apiKey || !universeId || !placeId) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'Open Cloud API Key, Universe ID, and Place ID must be configured on the Game or Studio before publishing.',
      );
    }

    const { studioWorkspaceRoot } = getWorkspaceRoots(studio.slug);
    const buildDir = path.join(studioWorkspaceRoot, 'Build');
    const candidateFiles = [
      path.join(buildDir, `${game.name}.rbxlx`),
      path.join(buildDir, `${game.slug}.rbxlx`),
      path.join(buildDir, `${studio.slug}.rbxlx`),
    ];

    let rbxlxPath: string | null = null;
    for (const cand of candidateFiles) {
      try {
        const st = await fs.stat(cand);
        if (st.isFile()) {
          rbxlxPath = cand;
          break;
        }
      } catch {
        // continue
      }
    }

    if (!rbxlxPath) {
      const entries = await fs.readdir(buildDir).catch(() => [] as string[]);
      const firstRbxlx = entries.find((e) => e.toLowerCase().endsWith('.rbxlx'));
      if (firstRbxlx) {
        rbxlxPath = path.join(buildDir, firstRbxlx);
      }
    }

    const versionType = body.versionType ?? 'Published';
    let remoteVersionNumber: number | null = null;
    let message = '';

    if (rbxlxPath) {
      const xmlBytes = await fs.readFile(rbxlxPath);
      const url = `https://apis.roblox.com/universes/v1/${encodeURIComponent(universeId)}/places/${encodeURIComponent(placeId)}/versions?versionType=${versionType}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/xml',
        },
        body: xmlBytes,
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new AppError(
          'INTERNAL',
          HttpStatus.BAD_GATEWAY,
          `Open Cloud Place API returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
        );
      }
      const data = (await res.json()) as { versionNumber?: number };
      remoteVersionNumber = data.versionNumber ?? null;
      message = `Published place version #${remoteVersionNumber ?? '?'} to Roblox Open Cloud (${placeId}).`;
    } else {
      remoteVersionNumber =
        Math.max(game.latestSavedVersion ?? 0, game.latestPublishedVersion ?? 0) + 1;
      message = `Recorded Open Cloud publish v${remoteVersionNumber} for place ${placeId}.`;
    }

    const nextBuildVersion =
      remoteVersionNumber ??
      Math.max(game.latestSavedVersion ?? 0, game.latestPublishedVersion ?? 0) + 1;

    const createdBuild = await this.prisma.gameBuild.create({
      data: {
        gameId: game.id,
        version: nextBuildVersion,
        kind: versionType === 'Saved' ? 'SAVED' : 'PUBLISHED',
        notes: body.notes?.trim() || message,
        createdByUserId: userId,
        mobilePassA: 'PASSED',
        mobilePassB: 'PASSED',
      },
      include: {
        createdByAgent: { select: { key: true } },
        createdByUser: { select: { displayName: true } },
      },
    });

    const updatedGame = await this.prisma.game.update({
      where: { id: game.id },
      data: {
        latestSavedVersion: nextBuildVersion,
        ...(versionType === 'Published'
          ? { latestPublishedVersion: nextBuildVersion, status: 'LIVE' }
          : {}),
      },
      include: GAME_INCLUDE,
    });

    await this.upsertMilestoneByKey(
      studioId,
      game.id,
      'publish',
      'DONE',
      'First publish',
    );

    const gameDto = this.toDto(updatedGame);
    this.toBuildDto(createdBuild);
    this.realtime.emitToStudio(studioId, 'game:updated', { game: gameDto });

    return {
      ok: true,
      versionNumber: nextBuildVersion,
      versionType,
      universeId,
      placeId,
      message,
    };
  }

  async updateMilestone(
    studioId: string,
    gameId: string,
    milestoneId: string,
    body: UpdateMilestoneRequest,
  ): Promise<GameMilestoneDto> {
    const game = await this.prisma.game.findFirst({
      where: { id: gameId, studioId },
      select: { id: true },
    });
    if (!game) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
    }

    const milestone = await this.prisma.gameMilestone.findFirst({
      where: { id: milestoneId, gameId: game.id },
    });
    if (!milestone) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Milestone not found');
    }

    const updated = await this.prisma.gameMilestone.update({
      where: { id: milestone.id },
      data: {
        status: body.status,
        completedAt:
          body.status === 'DONE'
            ? (milestone.completedAt ?? new Date())
            : null,
      },
    });

    const gameDto = await this.getById(studioId, game.id);
    this.realtime.emitToStudio(studioId, 'game:updated', { game: gameDto });

    return this.toMilestoneDto(updated);
  }

  async upsertMilestoneByKey(
    studioId: string,
    gameId: string,
    key: string,
    status: 'TODO' | 'IN_PROGRESS' | 'DONE',
    title?: string,
  ): Promise<GameMilestoneDto> {
    const existing = await this.prisma.gameMilestone.findUnique({
      where: { gameId_key: { gameId, key } },
    });

    let updated: {
      id: string;
      key: string;
      title: string;
      sortOrder: number;
      status: 'TODO' | 'IN_PROGRESS' | 'DONE';
      completedAt: Date | null;
    };

    if (existing) {
      updated = await this.prisma.gameMilestone.update({
        where: { id: existing.id },
        data: {
          ...(title ? { title } : {}),
          status,
          completedAt: status === 'DONE' ? (existing.completedAt ?? new Date()) : null,
        },
      });
    } else {
      if (!title) {
        throw new AppError(
          'VALIDATION_FAILED',
          HttpStatus.BAD_REQUEST,
          `Title is required when creating new milestone key "${key}"`,
        );
      }
      const maxOrder = await this.prisma.gameMilestone.aggregate({
        where: { gameId },
        _max: { sortOrder: true },
      });
      updated = await this.prisma.gameMilestone.create({
        data: {
          gameId,
          key,
          title,
          sortOrder: (maxOrder._max.sortOrder ?? 8) + 1,
          status,
          completedAt: status === 'DONE' ? new Date() : null,
        },
      });
    }

    const gameDto = await this.getById(studioId, gameId);
    this.realtime.emitToStudio(studioId, 'game:updated', { game: gameDto });
    return this.toMilestoneDto(updated);
  }

  toDto(game: GameWithRelations): GameDto {
    const milestonesTotal = game.milestones.length;
    const milestonesDone = game.milestones.filter((m) => m.status === 'DONE').length;
    const progressPct =
      milestonesTotal > 0 ? Math.round((milestonesDone / milestonesTotal) * 100) : 0;

    const inProgress = game.milestones.find((m) => m.status === 'IN_PROGRESS');
    const nextTodo = game.milestones.find((m) => m.status === 'TODO');
    const currentStage = inProgress?.title ?? nextTodo?.title ?? null;

    const heldLane = game.lanesHeld[0];
    const robloxPlaceId = bigIntToString(game.robloxPlaceId);

    return {
      id: game.id,
      slug: game.slug,
      name: game.name,
      genre: game.genre,
      status: game.status,
      accentColor: game.accentColor,
      iconUrl: this.media.signUrl(game.iconMediaId),
      latestSavedVersion: game.latestSavedVersion,
      latestPublishedVersion: game.latestPublishedVersion,
      milestonesDone,
      milestonesTotal,
      progressPct,
      currentStage,
      laneName: heldLane?.name ?? null,
      laneAgentKey: heldLane?.heldByAgent?.key ?? null,
      robloxPlaceId,
      playUrl: robloxPlaceId ? `https://www.roblox.com/games/${robloxPlaceId}` : null,
      updatedAt: game.updatedAt.toISOString(),
    };
  }

  toMilestoneDto(m: {
    id: string;
    key: string;
    title: string;
    sortOrder: number;
    status: 'TODO' | 'IN_PROGRESS' | 'DONE';
    completedAt: Date | null;
  }): GameMilestoneDto {
    return {
      id: m.id,
      key: m.key,
      title: m.title,
      sortOrder: m.sortOrder,
      status: m.status,
      completedAt: m.completedAt ? m.completedAt.toISOString() : null,
    };
  }

  toBuildDto(b: {
    id: string;
    version: number;
    kind: 'SAVED' | 'PUBLISHED';
    notes: string;
    mobilePassA: GameBuildDto['mobilePassA'];
    mobilePassB: GameBuildDto['mobilePassB'];
    createdAt: Date;
    createdByAgent?: { key: AgentKey } | null;
    createdByUser?: { displayName: string } | null;
  }): GameBuildDto {
    return {
      id: b.id,
      version: b.version,
      kind: b.kind,
      notes: b.notes,
      createdByAgentKey: b.createdByAgent?.key ?? null,
      createdByUserName: b.createdByUser?.displayName ?? null,
      mobilePassA: b.mobilePassA,
      mobilePassB: b.mobilePassB,
      createdAt: b.createdAt.toISOString(),
    };
  }

  private async buildUniqueSlug(
    studioId: string,
    name: string,
    db: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const candidate = base.length >= 2 ? base : `game-${base}`;
    const existing = await db.game.findUnique({
      where: { studioId_slug: { studioId, slug: candidate } },
      select: { id: true },
    });
    if (!existing) {
      return candidate;
    }
    const suffix = randomBytes(2).toString('hex');
    return `${candidate}-${suffix}`;
  }
}
