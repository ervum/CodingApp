import { HttpStatus, Injectable } from '@nestjs/common';
import {
  PITCH_SECTION_TITLES,
  PitchSectionKeyTuple,
  type AgentKey,
  type GameDto,
  type GeneratePitchesRequest,
  type PickPitchRequest,
  type PitchComparable,
  type PitchDetailDto,
  type PitchDto,
  type PitchMetric,
  type PitchSectionDto,
  type PitchSectionKey,
  type PitchStatus,
  type RequestPitchChanges,
  type TaskDto,
  type UpdatePitchRequest,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GamesService } from '../games/games.service.js';
import { HumanRequestsService } from '../human-requests/human-requests.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';

const PITCH_INCLUDE = {
  createdByAgent: { select: { key: true } },
  game: { select: { id: true } },
} satisfies Prisma.PitchInclude;

const PITCH_DETAIL_INCLUDE = {
  ...PITCH_INCLUDE,
  sections: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.PitchInclude;

type PitchWithRelations = Prisma.PitchGetPayload<{ include: typeof PITCH_INCLUDE }>;
type PitchDetailWithRelations = Prisma.PitchGetPayload<{
  include: typeof PITCH_DETAIL_INCLUDE;
}>;

@Injectable()
export class PitchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly games: GamesService,
    private readonly humanRequests: HumanRequestsService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(studioId: string, status?: PitchStatus): Promise<PitchDto[]> {
    const rows = await this.prisma.pitch.findMany({
      where: {
        studioId,
        ...(status ? { status } : {}),
      },
      include: PITCH_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async getById(studioId: string, pitchId: string): Promise<PitchDto> {
    const row = await this.prisma.pitch.findFirst({
      where: { id: pitchId, studioId },
      include: PITCH_INCLUDE,
    });
    if (!row) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Pitch not found');
    }
    return this.toDto(row);
  }

  async getDetail(studioId: string, pitchId: string): Promise<PitchDetailDto> {
    const row = await this.prisma.pitch.findFirst({
      where: { id: pitchId, studioId },
      include: PITCH_DETAIL_INCLUDE,
    });
    if (!row) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Pitch not found');
    }
    return this.toDetailDto(row);
  }

  async generate(
    studioId: string,
    body: GeneratePitchesRequest,
    userId: string,
  ): Promise<TaskDto> {
    const pulse = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: 'pulse' } },
      select: { id: true },
    });
    if (!pulse) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Pulse agent not found');
    }

    const title = body.focusGenre
      ? `Generate pitch: ${body.focusGenre}`
      : 'Generate new market-backed game pitch';
    const briefLines = [
      'Analyze the current Roblox market leaderboards (`market_query`) and propose a data-backed game pitch using `create_pitch`.',
      body.focusGenre ? `Focus genre: ${body.focusGenre}` : '',
      body.notes ? `Additional operator notes: ${body.notes}` : '',
    ].filter(Boolean);

    return this.tasks.createInternal({
      studioId,
      agentId: pulse.id,
      createdByUserId: userId,
      origin: 'USER',
      priority: 'HIGH',
      title: title.slice(0, 140),
      brief: briefLines.join('\n\n'),
      tags: ['pitch', ...(body.focusGenre ? [body.focusGenre.toLowerCase()] : [])],
    });
  }

  async update(
    studioId: string,
    pitchId: string,
    body: UpdatePitchRequest,
  ): Promise<PitchDetailDto> {
    const existing = await this.prisma.pitch.findFirst({
      where: { id: pitchId, studioId },
      select: { id: true },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Pitch not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.pitch.update({
        where: { id: existing.id },
        data: {
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.logline !== undefined ? { logline: body.logline } : {}),
          ...(body.whatChanged !== undefined ? { whatChanged: body.whatChanged } : {}),
          ...(body.howDifferent !== undefined ? { howDifferent: body.howDifferent } : {}),
        },
      });

      if (body.sections && body.sections.length > 0) {
        for (const sec of body.sections) {
          const sortOrder = PitchSectionKeyTuple.indexOf(sec.key) + 1;
          await tx.pitchSection.upsert({
            where: {
              pitchId_key: {
                pitchId: existing.id,
                key: sec.key,
              },
            },
            create: {
              pitchId: existing.id,
              key: sec.key,
              markdown: sec.markdown,
              sortOrder,
            },
            update: {
              markdown: sec.markdown,
            },
          });
        }
      }
    });

    const detail = await this.getDetail(studioId, existing.id);
    this.realtime.emitToStudio(studioId, 'pitch:updated', {
      pitch: detail,
      change: 'updated',
    });
    return detail;
  }

  async pick(
    studioId: string,
    pitchId: string,
    body: PickPitchRequest,
    userId: string,
  ): Promise<{ pitch: PitchDetailDto; game: GameDto; task: TaskDto }> {
    const pitch = await this.prisma.pitch.findFirst({
      where: { id: pitchId, studioId },
      include: PITCH_DETAIL_INCLUDE,
    });
    if (!pitch) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Pitch not found');
    }
    if (pitch.status === 'PICKED') {
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Pitch has already been picked');
    }

    const architect = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: 'architect' } },
      select: { id: true },
    });
    if (!architect) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Architect agent not found');
    }

    const gameName = body.gameName?.trim() || pitch.title;
    const accentColor = body.accentColor ?? '#A855F7';
    const fullPitchMarkdown = this.formatPitchMarkdown(pitch);

    const txResult = await this.prisma.$transaction(async (tx) => {
      await tx.pitch.update({
        where: { id: pitch.id },
        data: {
          status: 'PICKED',
          pickedAt: new Date(),
        },
      });

      const gameDto = await this.games.create(
        studioId,
        {
          name: gameName,
          genre: pitch.genre,
          accentColor,
          description: pitch.logline,
        },
        {
          status: 'BLUEPRINT',
          createdFromPitchId: pitch.id,
          tx,
        },
      );

      const createdTask = await tx.task.create({
        data: {
          studioId,
          gameId: gameDto.id,
          agentId: architect.id,
          createdByUserId: userId,
          origin: 'USER',
          priority: 'HIGH',
          status: 'QUEUED',
          title: `12-step blueprint: ${gameDto.name}`.slice(0, 140),
          brief: [
            `Write the complete 12-step technical and game design blueprint for "${gameDto.name}".`,
            '',
            fullPitchMarkdown,
          ].join('\n'),
          tags: ['blueprint', pitch.genre.toLowerCase()],
        },
      });

      const openPickRequests = await tx.humanRequest.findMany({
        where: {
          studioId,
          kind: 'PICK_NEXT_GAME',
          status: 'OPEN',
        },
      });

      const matchingRequests = openPickRequests.filter(
        (r) => r.pitchIds.includes(pitch.id) || r.pitchIds.length === 0,
      );

      const resolvedRequestIds: string[] = [];
      const siblingPitchIds = new Set<string>();

      for (const req of matchingRequests) {
        resolvedRequestIds.push(req.id);
        for (const pid of req.pitchIds) {
          if (pid !== pitch.id) {
            siblingPitchIds.add(pid);
          }
        }
        await tx.humanRequest.update({
          where: { id: req.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: new Date(),
            resolvedById: userId,
            resolution: `Picked pitch: ${pitch.title}`,
          },
        });
      }

      const archivedPitchIds: string[] = [];
      if (siblingPitchIds.size > 0) {
        const siblingsToArchive = await tx.pitch.findMany({
          where: {
            studioId,
            id: { in: [...siblingPitchIds] },
            status: 'PROPOSED',
          },
          select: { id: true },
        });
        for (const sib of siblingsToArchive) {
          archivedPitchIds.push(sib.id);
          await tx.pitch.update({
            where: { id: sib.id },
            data: { status: 'ARCHIVED' },
          });
        }
      }

      return {
        gameDto,
        taskId: createdTask.id,
        resolvedRequestIds,
        archivedPitchIds,
      };
    });

    const updatedPitch = await this.getDetail(studioId, pitch.id);
    const taskDto = await this.tasks.getById(studioId, txResult.taskId);

    this.realtime.emitToStudio(studioId, 'pitch:updated', {
      pitch: updatedPitch,
      change: 'updated',
    });
    for (const archivedId of txResult.archivedPitchIds) {
      const archivedDto = await this.getById(studioId, archivedId);
      this.realtime.emitToStudio(studioId, 'pitch:updated', {
        pitch: archivedDto,
        change: 'updated',
      });
    }
    this.realtime.emitToStudio(studioId, 'game:updated', { game: txResult.gameDto });
    this.realtime.emitToStudio(studioId, 'task:updated', {
      task: taskDto,
      change: 'created',
    });
    for (const reqId of txResult.resolvedRequestIds) {
      const reqDto = await this.humanRequests.getById(studioId, reqId);
      this.realtime.emitToStudio(studioId, 'human-request:updated', {
        request: reqDto,
        change: 'updated',
      });
    }
    this.realtime.broadcastCounts(studioId);

    return {
      pitch: updatedPitch,
      game: txResult.gameDto,
      task: taskDto,
    };
  }

  async requestChanges(
    studioId: string,
    pitchId: string,
    body: RequestPitchChanges,
    userId: string,
  ): Promise<{ pitch: PitchDetailDto; task: TaskDto }> {
    const pitch = await this.prisma.pitch.findFirst({
      where: { id: pitchId, studioId },
      include: PITCH_DETAIL_INCLUDE,
    });
    if (!pitch) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Pitch not found');
    }

    const pulse = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: 'pulse' } },
      select: { id: true },
    });
    if (!pulse) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Pulse agent not found');
    }

    await this.prisma.pitch.update({
      where: { id: pitch.id },
      data: {
        status: 'CHANGES_REQUESTED',
        feedback: body.feedback,
      },
    });

    const taskDto = await this.tasks.createInternal({
      studioId,
      agentId: pulse.id,
      createdByUserId: userId,
      origin: 'USER',
      priority: 'HIGH',
      title: `Revise pitch: ${pitch.title}`.slice(0, 140),
      brief: [
        `Operator requested changes on pitch "${pitch.title}" (id: ${pitch.id}).`,
        `Feedback: ${body.feedback}`,
        '',
        this.formatPitchMarkdown(pitch),
      ].join('\n'),
      tags: ['pitch', 'revision'],
      metadata: { revisesPitchId: pitch.id },
    });

    const updatedPitch = await this.getDetail(studioId, pitch.id);
    this.realtime.emitToStudio(studioId, 'pitch:updated', {
      pitch: updatedPitch,
      change: 'updated',
    });

    return {
      pitch: updatedPitch,
      task: taskDto,
    };
  }

  async createFromTool(params: {
    studioId: string;
    createdByAgentId: string;
    taskId: string;
    title: string;
    logline: string;
    genre: string;
    metrics: PitchMetric[];
    whatChanged: string;
    howDifferent: string;
    comparables: PitchComparable[];
    sections: Record<PitchSectionKey, string>;
  }): Promise<PitchDetailDto> {
    const sectionRows = PitchSectionKeyTuple.map((key, idx) => ({
      key,
      markdown: params.sections[key],
      sortOrder: idx + 1,
    }));

    const created = await this.prisma.$transaction(async (tx) => {
      const pitch = await tx.pitch.create({
        data: {
          studioId: params.studioId,
          createdByAgentId: params.createdByAgentId,
          title: params.title,
          logline: params.logline,
          genre: params.genre,
          status: 'PROPOSED',
          metrics: params.metrics as unknown as Prisma.InputJsonValue,
          whatChanged: params.whatChanged,
          howDifferent: params.howDifferent,
          comparables: params.comparables as unknown as Prisma.InputJsonValue,
          sections: {
            createMany: {
              data: sectionRows,
            },
          },
        },
        include: PITCH_DETAIL_INCLUDE,
      });

      const existingOpenPick = await tx.humanRequest.findFirst({
        where: {
          studioId: params.studioId,
          kind: 'PICK_NEXT_GAME',
          status: 'OPEN',
        },
        orderBy: { createdAt: 'desc' },
      });

      let requestId: string;
      let requestChange: 'created' | 'updated';
      if (existingOpenPick) {
        const nextPitchIds = existingOpenPick.pitchIds.includes(pitch.id)
          ? existingOpenPick.pitchIds
          : [...existingOpenPick.pitchIds, pitch.id];
        await tx.humanRequest.update({
          where: { id: existingOpenPick.id },
          data: { pitchIds: nextPitchIds },
        });
        requestId = existingOpenPick.id;
        requestChange = 'updated';
      } else {
        const req = await tx.humanRequest.create({
          data: {
            studioId: params.studioId,
            agentId: params.createdByAgentId,
            taskId: params.taskId,
            kind: 'PICK_NEXT_GAME',
            status: 'OPEN',
            title: 'Pick the next game to build',
            body: `Pulse proposed "${pitch.title}" — review and pick a game concept.`,
            pitchIds: [pitch.id],
          },
        });
        requestId = req.id;
        requestChange = 'created';
      }

      return { pitch, requestId, requestChange };
    });

    const dto = this.toDetailDto(created.pitch);
    const reqDto = await this.humanRequests.getById(params.studioId, created.requestId);

    this.realtime.emitToStudio(params.studioId, 'pitch:updated', {
      pitch: dto,
      change: 'created',
    });
    this.realtime.emitToStudio(params.studioId, 'human-request:updated', {
      request: reqDto,
      change: created.requestChange,
    });
    this.realtime.broadcastCounts(params.studioId);

    return dto;
  }

  toDto(row: PitchWithRelations): PitchDto {
    return {
      id: row.id,
      title: row.title,
      logline: row.logline,
      genre: row.genre,
      status: row.status,
      createdByAgentKey: (row.createdByAgent?.key as AgentKey | undefined) ?? null,
      metrics: this.parseMetrics(row.metrics),
      whatChanged: row.whatChanged,
      howDifferent: row.howDifferent,
      comparables: this.parseComparables(row.comparables),
      feedback: row.feedback,
      pickedGameId: row.game?.id ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  toDetailDto(row: PitchDetailWithRelations): PitchDetailDto {
    const sections: PitchSectionDto[] = row.sections.map((s) => ({
      key: s.key,
      title: PITCH_SECTION_TITLES[s.key],
      markdown: s.markdown,
      sortOrder: s.sortOrder,
    }));
    return {
      ...this.toDto(row),
      sections,
    };
  }

  private formatPitchMarkdown(pitch: PitchDetailWithRelations): string {
    const lines: string[] = [
      `# Pitch: ${pitch.title}`,
      `**Genre:** ${pitch.genre}`,
      `**Logline:** ${pitch.logline}`,
      '',
      `## What Changed`,
      pitch.whatChanged,
      '',
      `## How We're Different`,
      pitch.howDifferent,
    ];

    for (const sec of pitch.sections) {
      lines.push('', `## ${PITCH_SECTION_TITLES[sec.key]}`, sec.markdown);
    }
    return lines.join('\n');
  }

  private parseMetrics(raw: unknown): PitchMetric[] {
    if (!Array.isArray(raw)) return [];
    const out: PitchMetric[] = [];
    for (const item of raw) {
      if (typeof item === 'object' && item !== null) {
        const rec = item as Record<string, unknown>;
        const label = typeof rec['label'] === 'string' ? rec['label'] : '';
        const value = typeof rec['value'] === 'string' ? rec['value'] : '';
        const rawTone = rec['tone'];
        const tone: PitchMetric['tone'] =
          rawTone === 'positive' || rawTone === 'warning' || rawTone === 'neutral'
            ? rawTone
            : 'neutral';
        if (label && value) {
          out.push({ label, value, tone });
        }
      }
    }
    return out;
  }

  private parseComparables(raw: unknown): PitchComparable[] {
    if (!Array.isArray(raw)) return [];
    const out: PitchComparable[] = [];
    for (const item of raw) {
      if (typeof item === 'object' && item !== null) {
        const rec = item as Record<string, unknown>;
        const universeId =
          typeof rec['universeId'] === 'string'
            ? rec['universeId']
            : typeof rec['universeId'] === 'number'
              ? String(rec['universeId'])
              : '';
        const name = typeof rec['name'] === 'string' ? rec['name'] : '';
        if (universeId && name) {
          out.push({ universeId, name });
        }
      }
    }
    return out;
  }
}
