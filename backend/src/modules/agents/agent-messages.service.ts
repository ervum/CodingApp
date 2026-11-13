import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  AgentMessageDto,
  AgentTool,
  ChatAttachment,
  ChatDirective,
  HumanRequestDto,
  HumanRequestOption,
  Paginated,
  PostAgentMessageRequest,
  TaskDto,
} from '@robdev/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { decodeCursor, toPaginated } from '../../common/http/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  isDenialResponseText,
  processPendingPermissionResolution,
} from '../orchestrator/tools/terminal-and-permissions.helper.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { AgentStatusService } from './agent-status.service.js';

export function buildTaskTitleFromBody(body: string): string {
  const clean = body.replace(/\s+/g, ' ').trim();
  if (clean.length <= 80) {
    return clean.length >= 4 ? clean : `${clean} task`;
  }
  const slice = clean.slice(0, 79);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = lastSpace >= 30 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed}…`;
}

export function mergeDirectivesAndAttachmentsIntoTaskMeta(
  existingMeta: unknown,
  directives: readonly ChatDirective[],
  attachments: readonly ChatAttachment[],
): Record<string, unknown> {
  const meta: Record<string, unknown> =
    typeof existingMeta === 'object' && existingMeta !== null
      ? { ...(existingMeta as Record<string, unknown>) }
      : {};

  if (directives.includes('PC_CONTROL')) {
    meta['approvedMainPcControl'] = true;
    delete meta['pcTargetEnvLock'];
    const existingTools = Array.isArray(meta['extraTools'])
      ? (meta['extraTools'] as string[])
      : [];
    meta['extraTools'] = Array.from(
      new Set<AgentTool>([
        ...(existingTools as AgentTool[]),
        'pc_observe',
        'pc_act',
        'pc_window',
      ]),
    );
  }

  if (directives.includes('PC_CONTROL_SANDBOX')) {
    meta['pcTargetEnvLock'] = 'SANDBOX';
    const existingTools = Array.isArray(meta['extraTools'])
      ? (meta['extraTools'] as string[])
      : [];
    meta['extraTools'] = Array.from(
      new Set<AgentTool>([
        ...(existingTools as AgentTool[]),
        'pc_observe',
        'pc_act',
        'pc_window',
        'pc_sandbox',
      ]),
    );
  }

  if (directives.includes('BROWSER')) {
    const existingTools = Array.isArray(meta['extraTools'])
      ? (meta['extraTools'] as string[])
      : [];
    meta['extraTools'] = Array.from(
      new Set<AgentTool>([
        ...(existingTools as AgentTool[]),
        'browser_navigate',
        'browser_observe',
        'browser_act',
        'browser_extract',
        'browser_tabs',
      ]),
    );
  }

  if (directives.includes('PLAN_FIRST')) {
    meta['planFirst'] = true;
  }

  const localFolders = attachments
    .filter((a): a is Extract<ChatAttachment, { kind: 'local_folder' }> => a.kind === 'local_folder')
    .map((a) => a.absPath);
  if (localFolders.length > 0) {
    const existingReadOnly = Array.isArray(meta['readOnlyExternalPaths'])
      ? (meta['readOnlyExternalPaths'] as string[])
      : [];
    meta['readOnlyExternalPaths'] = Array.from(
      new Set([...existingReadOnly, ...localFolders]),
    );
  }

  return meta;
}

@Injectable()
export class AgentMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly agentStatus: AgentStatusService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(
    studioId: string,
    agentKey: AgentKey,
    cursorRaw?: string,
    limit = 50,
    includeArchived = false,
  ): Promise<Paginated<AgentMessageDto>> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const cursor = decodeCursor(cursorRaw);
    const rows = await this.prisma.agentMessage.findMany({
      where: {
        studioId,
        agentId: agent.id,
        ...(includeArchived ? {} : { archiveId: null }),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        user: { select: { displayName: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    return toPaginated(rows, limit, (r) => ({
      id: r.id,
      agentKey: agent.key,
      author: r.author,
      userDisplayName: r.user?.displayName ?? null,
      body: r.body,
      taskId: r.taskId,
      archiveId: r.archiveId ?? null,
      attachments: Array.isArray(r.attachments)
        ? (r.attachments as unknown as ChatAttachment[])
        : [],
      directives: (r.directives ?? []) as ChatDirective[],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async postUserMessage(
    studioId: string,
    agentKey: AgentKey,
    body: Omit<PostAgentMessageRequest, 'attachments' | 'directives'> & {
      attachments?: ChatAttachment[];
      directives?: ChatDirective[];
    },
    user: AuthenticatedUser,
  ): Promise<{ message: AgentMessageDto; task: TaskDto }> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const attachments = body.attachments ?? [];
    const directives = body.directives ?? [];

    // Check if the user is continuing an existing app chat (taskId) that is not archived
    const rawTargetTask = body.taskId
      ? await this.prisma.task.findFirst({
          where: {
            id: body.taskId,
            studioId,
            agentId: agent.id,
          },
          include: {
            humanRequests: {
              where: { status: 'OPEN', agentId: agent.id },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
            runs: {
              select: { id: true, archiveId: true },
            },
            messages: {
              select: { id: true, archiveId: true },
            },
          },
        })
      : null;

    const isTaskArchived = (t: typeof rawTargetTask): boolean => {
      if (!t) return true;
      const meta =
        typeof t.metadata === 'object' && t.metadata !== null
          ? (t.metadata as Record<string, unknown>)
          : null;
      if (meta?.['archived'] === true) return true;
      const hasAnyItems = t.runs.length > 0 || t.messages.length > 0;
      if (!hasAnyItems) return false;
      const hasActiveRun = t.runs.some((r) => !r.archiveId);
      const hasActiveMsg = t.messages.some((m) => !m.archiveId);
      return !hasActiveRun && !hasActiveMsg;
    };

    const targetTask = rawTargetTask && !isTaskArchived(rawTargetTask) ? rawTargetTask : null;

    // Check if the agent has a NEEDS_HUMAN task with an OPEN human request from this agent
    const waitingTask =
      targetTask && targetTask.humanRequests[0]
        ? targetTask
        : await this.prisma.task.findFirst({
            where: {
              studioId,
              agentId: agent.id,
              status: 'NEEDS_HUMAN',
              humanRequests: {
                some: { status: 'OPEN', agentId: agent.id },
              },
            },
            include: {
              humanRequests: {
                where: { status: 'OPEN', agentId: agent.id },
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
            orderBy: { updatedAt: 'desc' },
          });

    let taskDto: TaskDto;
    let messageRow: {
      id: string;
      author: 'USER' | 'AGENT' | 'SYSTEM';
      body: string;
      taskId: string | null;
      archiveId: string | null;
      attachments: Prisma.JsonValue;
      directives: string[];
      createdAt: Date;
    };

    if (waitingTask && waitingTask.humanRequests[0]) {
      const openReq = waitingTask.humanRequests[0];
      const approved = !isDenialResponseText(body.body);
      const permRes = await processPendingPermissionResolution({
        prisma: this.prisma,
        studioId,
        taskId: waitingTask.id,
        requestId: openReq.id,
        approved,
      });
      const effectiveUserBody =
        permRes.handled && permRes.summaryText
          ? `${body.body}\n\n${permRes.summaryText}`
          : body.body;

      messageRow = await this.prisma.agentMessage.create({
        data: {
          studioId,
          agentId: agent.id,
          author: 'USER',
          userId: user.id,
          taskId: waitingTask.id,
          body: effectiveUserBody,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          directives,
        },
      });

      const resolvedReq = await this.prisma.humanRequest.update({
        where: { id: openReq.id },
        data: {
          status: 'RESOLVED',
          resolution: effectiveUserBody,
          resolvedById: user.id,
          resolvedAt: new Date(),
        },
        include: { agent: { select: { key: true } } },
      });

      const refreshedWaitingTask = await this.prisma.task.findUnique({
        where: { id: waitingTask.id },
        select: { metadata: true },
      });
      const mergedMeta = mergeDirectivesAndAttachmentsIntoTaskMeta(
        refreshedWaitingTask?.metadata ?? waitingTask.metadata,
        directives,
        attachments,
      );

      await this.prisma.task.update({
        where: { id: waitingTask.id },
        data: {
          brief: effectiveUserBody,
          status: 'QUEUED',
          queuedAt: new Date(),
          metadata: mergedMeta as Prisma.InputJsonValue,
        },
      });

      await this.agentStatus.recompute(agent.id);
      taskDto = await this.tasks.getById(studioId, waitingTask.id);

      const reqDto: HumanRequestDto = {
        id: resolvedReq.id,
        kind: resolvedReq.kind,
        status: resolvedReq.status,
        title: resolvedReq.title,
        body: resolvedReq.body,
        gameId: resolvedReq.gameId,
        agentKey: resolvedReq.agent?.key ?? null,
        taskId: resolvedReq.taskId,
        options: Array.isArray(resolvedReq.options)
          ? (resolvedReq.options as unknown as HumanRequestOption[])
          : [],
        pitchIds: resolvedReq.pitchIds,
        buildVersion: resolvedReq.buildVersion,
        resolution: resolvedReq.resolution,
        createdAt: resolvedReq.createdAt.toISOString(),
        resolvedAt: resolvedReq.resolvedAt ? resolvedReq.resolvedAt.toISOString() : null,
      };

      this.realtime.emitToStudio(studioId, 'human-request:updated', {
        request: reqDto,
        change: 'updated',
      });
      this.realtime.emitToStudio(studioId, 'task:updated', {
        task: taskDto,
        change: 'updated',
      });
      this.realtime.broadcastCounts(studioId);
      this.tasks.notifyTaskQueued(studioId);
    } else if (targetTask && targetTask.status !== 'RUNNING') {
      messageRow = await this.prisma.agentMessage.create({
        data: {
          studioId,
          agentId: agent.id,
          author: 'USER',
          userId: user.id,
          taskId: targetTask.id,
          body: body.body,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          directives,
        },
      });

      const mergedMeta = mergeDirectivesAndAttachmentsIntoTaskMeta(
        targetTask.metadata,
        directives,
        attachments,
      );

      await this.prisma.task.update({
        where: { id: targetTask.id },
        data: {
          brief: body.body,
          status: 'QUEUED',
          queuedAt: new Date(),
          completedAt: null,
          metadata: mergedMeta as Prisma.InputJsonValue,
        },
      });

      await this.agentStatus.recompute(agent.id);
      taskDto = await this.tasks.getById(studioId, targetTask.id);

      this.realtime.emitToStudio(studioId, 'task:updated', {
        task: taskDto,
        change: 'updated',
      });
      this.realtime.broadcastCounts(studioId);
      this.tasks.notifyTaskQueued(studioId);
    } else {
      const title = buildTaskTitleFromBody(body.body);
      const initialMeta = mergeDirectivesAndAttachmentsIntoTaskMeta(
        null,
        directives,
        attachments,
      );
      taskDto = await this.tasks.createInternal({
        studioId,
        agentId: agent.id,
        gameId: body.gameId,
        createdByUserId: user.id,
        origin: 'USER',
        title,
        brief: body.body,
        priority: 'NORMAL',
      });

      if (Object.keys(initialMeta).length > 0) {
        await this.prisma.task.update({
          where: { id: taskDto.id },
          data: { metadata: initialMeta as Prisma.InputJsonValue },
        });
      }

      messageRow = await this.prisma.agentMessage.create({
        data: {
          studioId,
          agentId: agent.id,
          author: 'USER',
          userId: user.id,
          taskId: taskDto.id,
          body: body.body,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          directives,
        },
      });
    }

    const messageDto: AgentMessageDto = {
      id: messageRow.id,
      agentKey: agent.key,
      author: messageRow.author,
      userDisplayName: user.displayName,
      body: messageRow.body,
      taskId: messageRow.taskId,
      archiveId: messageRow.archiveId ?? null,
      attachments,
      directives,
      createdAt: messageRow.createdAt.toISOString(),
    };

    this.realtime.emitToStudio(studioId, 'agent:message', { message: messageDto });
    return { message: messageDto, task: taskDto };
  }

  async createAgentOrSystemMessage(params: {
    studioId: string;
    agentId: string;
    agentKey: AgentKey;
    author: 'AGENT' | 'SYSTEM';
    taskId?: string | null;
    body: string;
  }): Promise<AgentMessageDto> {
    const row = await this.prisma.agentMessage.create({
      data: {
        studioId: params.studioId,
        agentId: params.agentId,
        author: params.author,
        taskId: params.taskId ?? null,
        body: params.body,
      },
    });

    const dto: AgentMessageDto = {
      id: row.id,
      agentKey: params.agentKey,
      author: row.author,
      userDisplayName: null,
      body: row.body,
      taskId: row.taskId,
      createdAt: row.createdAt.toISOString(),
    };

    this.realtime.emitToStudio(params.studioId, 'agent:message', { message: dto });
    return dto;
  }
}
