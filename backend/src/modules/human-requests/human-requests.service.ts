import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  HumanRequestDto,
  HumanRequestKind,
  HumanRequestOption,
  HumanRequestStatus,
  ReplyHumanRequest,
  ResolveHumanRequest,
} from '@robdev/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentStatusService } from '../agents/agent-status.service.js';
import {
  isDenialResponseText,
  processPendingPermissionResolution,
} from '../orchestrator/tools/terminal-and-permissions.helper.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';

@Injectable()
export class HumanRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly agentStatus: AgentStatusService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(studioId: string, status?: HumanRequestStatus): Promise<HumanRequestDto[]> {
    const rows = await this.prisma.humanRequest.findMany({
      where: {
        studioId,
        ...(status ? { status } : {}),
      },
      include: {
        agent: { select: { key: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async getById(studioId: string, requestId: string): Promise<HumanRequestDto> {
    const row = await this.prisma.humanRequest.findFirst({
      where: { id: requestId, studioId },
      include: {
        agent: { select: { key: true } },
      },
    });
    if (!row) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Human request not found');
    }
    return this.toDto(row);
  }

  async createFromTool(params: {
    studioId: string;
    kind: HumanRequestKind;
    title: string;
    body: string;
    agentId: string;
    agentKey: AgentKey;
    taskId: string;
    gameId: string | null;
    options: HumanRequestOption[];
    buildVersion: number | null;
  }): Promise<HumanRequestDto> {
    const created = await this.prisma.humanRequest.create({
      data: {
        studioId: params.studioId,
        kind: params.kind,
        status: 'OPEN',
        title: params.title,
        body: params.body,
        agentId: params.agentId,
        taskId: params.taskId,
        gameId: params.gameId,
        options: params.options as unknown as Prisma.InputJsonValue,
        pitchIds: [],
        buildVersion: params.buildVersion,
      },
      include: {
        agent: { select: { key: true } },
      },
    });

    const msg = await this.prisma.agentMessage.create({
      data: {
        studioId: params.studioId,
        agentId: params.agentId,
        author: 'AGENT',
        taskId: params.taskId,
        body: params.body,
      },
    });

    this.realtime.emitToStudio(params.studioId, 'agent:message', {
      message: {
        id: msg.id,
        agentKey: params.agentKey,
        author: msg.author,
        userDisplayName: null,
        body: msg.body,
        taskId: msg.taskId,
        createdAt: msg.createdAt.toISOString(),
      },
    });

    const dto = this.toDto(created);
    this.realtime.emitToStudio(params.studioId, 'human-request:updated', {
      request: dto,
      change: 'created',
    });
    this.realtime.broadcastCounts(params.studioId);
    return dto;
  }

  async reply(
    studioId: string,
    requestId: string,
    body: ReplyHumanRequest,
    user: AuthenticatedUser,
  ): Promise<HumanRequestDto> {
    const req = await this.prisma.humanRequest.findFirst({
      where: { id: requestId, studioId },
      include: { agent: { select: { id: true, key: true } } },
    });
    if (!req) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Human request not found');
    }
    if (req.status !== 'OPEN') {
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Human request is already closed');
    }

    const opts = this.parseOptions(req.options);
    const chosenOption = body.optionId
      ? opts.find((o) => o.id === body.optionId)
      : undefined;

    let fullBody = chosenOption
      ? `${body.body}\nChosen option: ${chosenOption.label}`
      : body.body;

    if (req.taskId) {
      const approved =
        body.optionId === 'deny'
          ? false
          : body.optionId === 'approve'
            ? true
            : !isDenialResponseText(body.body);
      const permRes = await processPendingPermissionResolution({
        prisma: this.prisma,
        studioId,
        taskId: req.taskId,
        requestId: req.id,
        approved,
      });
      if (permRes.handled && permRes.summaryText) {
        fullBody = `${fullBody}\n\n${permRes.summaryText}`;
      }
    }

    if (req.agent) {
      const msg = await this.prisma.agentMessage.create({
        data: {
          studioId,
          agentId: req.agent.id,
          author: 'USER',
          userId: user.id,
          taskId: req.taskId,
          body: fullBody,
        },
      });
      this.realtime.emitToStudio(studioId, 'agent:message', {
        message: {
          id: msg.id,
          agentKey: req.agent.key,
          author: msg.author,
          userDisplayName: user.displayName,
          body: msg.body,
          taskId: msg.taskId,
          createdAt: msg.createdAt.toISOString(),
        },
      });
    }

    const updated = await this.prisma.humanRequest.update({
      where: { id: req.id },
      data: {
        status: 'RESOLVED',
        resolution: fullBody,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
      include: { agent: { select: { key: true } } },
    });

    if (req.taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: req.taskId, studioId },
      });
      if (task && task.status === 'NEEDS_HUMAN') {
        await this.prisma.task.update({
          where: { id: task.id },
          data: { status: 'QUEUED', queuedAt: new Date() },
        });
        await this.agentStatus.recompute(task.agentId);
        const taskDto = await this.tasks.getById(studioId, task.id);
        this.realtime.emitToStudio(studioId, 'task:updated', {
          task: taskDto,
          change: 'updated',
        });
        this.tasks.notifyTaskQueued?.(studioId);
      }
    } else if (req.agentId) {
      await this.agentStatus.recompute(req.agentId);
    }

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'human-request:updated', {
      request: dto,
      change: 'updated',
    });
    this.realtime.broadcastCounts(studioId);
    return dto;
  }

  async resolve(
    studioId: string,
    requestId: string,
    body: ResolveHumanRequest,
    user: AuthenticatedUser,
  ): Promise<HumanRequestDto> {
    const req = await this.prisma.humanRequest.findFirst({
      where: { id: requestId, studioId },
      include: { agent: { select: { id: true, key: true } } },
    });
    if (!req) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Human request not found');
    }
    if (req.status !== 'OPEN') {
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Human request is already closed');
    }

    const noteText = body.note?.trim() || 'Done';
    const updated = await this.prisma.humanRequest.update({
      where: { id: req.id },
      data: {
        status: body.outcome,
        resolution: noteText,
        resolvedById: user.id,
        resolvedAt: new Date(),
      },
      include: { agent: { select: { key: true } } },
    });

    if (req.taskId) {
      const task = await this.prisma.task.findFirst({
        where: { id: req.taskId, studioId },
      });
      if (task && task.status === 'NEEDS_HUMAN') {
        await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'DONE',
            resultSummary: `Closed by ${user.displayName}: ${noteText}`,
            completedAt: new Date(),
          },
        });
        await this.tasks.propagateDependencyCompletion(studioId, task.id);
        await this.agentStatus.recompute(task.agentId);
        const taskDto = await this.tasks.getById(studioId, task.id);
        this.realtime.emitToStudio(studioId, 'task:updated', {
          task: taskDto,
          change: 'updated',
        });
        this.tasks.notifyTaskQueued?.(studioId);
      }
    } else if (req.agentId) {
      await this.agentStatus.recompute(req.agentId);
    }

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'human-request:updated', {
      request: dto,
      change: 'updated',
    });
    this.realtime.broadcastCounts(studioId);
    return dto;
  }

  toDto(row: {
    id: string;
    kind: HumanRequestKind;
    status: HumanRequestStatus;
    title: string;
    body: string;
    gameId: string | null;
    taskId: string | null;
    options: unknown;
    pitchIds: string[];
    buildVersion: number | null;
    resolution: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    agent?: { key: AgentKey } | null;
  }): HumanRequestDto {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      title: row.title,
      body: row.body,
      gameId: row.gameId,
      agentKey: row.agent?.key ?? null,
      taskId: row.taskId,
      options: this.parseOptions(row.options),
      pitchIds: row.pitchIds,
      buildVersion: row.buildVersion,
      resolution: row.resolution,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    };
  }

  private parseOptions(raw: unknown): HumanRequestOption[] {
    if (!Array.isArray(raw)) return [];
    const out: HumanRequestOption[] = [];
    for (const item of raw) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as Record<string, unknown>)['id'] === 'string' &&
        typeof (item as Record<string, unknown>)['label'] === 'string'
      ) {
        out.push({
          id: (item as Record<string, string>)['id']!,
          label: (item as Record<string, string>)['label']!,
        });
      }
    }
    return out;
  }
}
