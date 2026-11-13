import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  AgentMessageDto,
  AgentRunDetailDto,
  ChatArchiveDetailDto,
  ChatArchiveSummaryDto,
  ChatAttachment,
  ChatBranchRequest,
  ChatDeletePartRequest,
  ChatDirective,
  ChatRetryRequest,
  LlmProvider,
  RunLogMeta,
  TaskDto,
} from '@robdev/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LanesService } from '../lanes/lanes.service.js';
import { GoogleWebBrowserAdapter } from '../llm/adapters/google-web.adapter.js';
import { RunRegistryService } from '../orchestrator/run-registry.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { mergeDirectivesAndAttachmentsIntoTaskMeta } from './agent-messages.service.js';
import { AgentStatusService } from './agent-status.service.js';

@Injectable()
export class ChatHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly agentStatus: AgentStatusService,
    private readonly registry: RunRegistryService,
    private readonly lanes: LanesService,
    private readonly realtime: RealtimeService,
    private readonly googleWeb: GoogleWebBrowserAdapter,
  ) {}

  async listArchives(studioId: string, agentKey: AgentKey): Promise<ChatArchiveSummaryDto[]> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const rows = await this.prisma.chatArchive.findMany({
      where: { studioId, agentId: agent.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: {
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, author: true, body: true, taskId: true },
        },
        runs: {
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            taskId: true,
            summary: true,
            task: { select: { title: true, brief: true } },
          },
        },
      },
    });

    return rows.map((r) => this.toArchiveSummaryDto(agent.key, r));
  }

  async getArchive(
    studioId: string,
    agentKey: AgentKey,
    archiveId: string,
  ): Promise<ChatArchiveDetailDto> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const archive = await this.prisma.chatArchive.findFirst({
      where: { id: archiveId, studioId, agentId: agent.id },
      include: {
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            user: { select: { displayName: true } },
          },
        },
        runs: {
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
          include: {
            agent: { select: { key: true } },
            task: { select: { title: true, brief: true } },
            entries: { orderBy: { seq: 'asc' } },
            artifacts: { orderBy: { createdAt: 'asc' } },
            injections: {
              include: {
                document: { select: { id: true, path: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    });

    if (!archive) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Archive not found');
    }

    const summary = this.toArchiveSummaryDto(agent.key, archive);
    const messages: AgentMessageDto[] = archive.messages.map((m) => ({
      id: m.id,
      agentKey: agent.key,
      author: m.author,
      userDisplayName: m.user?.displayName ?? null,
      body: m.body,
      taskId: m.taskId,
      archiveId: m.archiveId ?? null,
      attachments: Array.isArray(m.attachments)
        ? (m.attachments as unknown as ChatAttachment[])
        : [],
      directives: (m.directives ?? []) as ChatDirective[],
      createdAt: m.createdAt.toISOString(),
    }));

    const runs: AgentRunDetailDto[] = archive.runs.map((run) => {
      const runSummary = this.tasks.toRunSummaryDto(run);
      return {
        ...runSummary,
        entries: run.entries.map((e) => ({
          id: e.id,
          runId: e.runId,
          seq: e.seq,
          kind: e.kind,
          content: e.content,
          meta: (e.meta as RunLogMeta | null) ?? null,
          createdAt: e.createdAt.toISOString(),
        })),
        artifacts: run.artifacts.map((a) => ({
          id: a.id,
          path: a.path,
          language: a.language,
          content: a.content,
          bytes: a.bytes,
          createdAt: a.createdAt.toISOString(),
        })),
        injectedDocs: run.injections.map((inj) => ({
          documentId: inj.document.id,
          path: inj.document.path,
          version: inj.documentVersion,
          estimatedTokens: inj.estimatedTokens,
          truncated: inj.truncated,
        })),
      };
    });

    return {
      ...summary,
      messages,
      runs,
      runDetails: runs,
    };
  }

  async freshStart(
    studioId: string,
    agentKey: AgentKey,
  ): Promise<{ archive: ChatArchiveSummaryDto | null }> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const [activeMessages, activeRuns] = await Promise.all([
      this.prisma.agentMessage.findMany({
        where: { studioId, agentId: agent.id, archiveId: null },
        select: { id: true, taskId: true },
      }),
      this.prisma.agentRun.findMany({
        where: { studioId, agentId: agent.id, archiveId: null },
        select: { id: true, taskId: true, status: true },
      }),
    ]);

    await this.googleWeb.detachAgentWebChatCache(studioId, agent.key);

    if (activeMessages.length === 0 && activeRuns.length === 0) {
      return { archive: null };
    }

    for (const r of activeRuns) {
      if (r.status === 'RUNNING') {
        this.registry.abort(r.id, 'CANCELLED');
      }
      await this.lanes.releaseByRun(studioId, r.id);
    }

    const agg = await this.prisma.chatArchive.aggregate({
      where: { agentId: agent.id, kind: 'FRESH_START' },
      _max: { number: true },
    });
    const nextNumber = (agg._max.number ?? 0) + 1;
    const label = `Archive #${nextNumber}`;

    const archive = await this.prisma.chatArchive.create({
      data: {
        studioId,
        agentId: agent.id,
        kind: 'FRESH_START',
        number: nextNumber,
      },
    });

    await this.prisma.agentMessage.updateMany({
      where: { studioId, agentId: agent.id, archiveId: null },
      data: { archiveId: archive.id },
    });

    await this.prisma.agentRun.updateMany({
      where: { studioId, agentId: agent.id, archiveId: null },
      data: { archiveId: archive.id },
    });

    await this.prisma.agentRun.updateMany({
      where: { studioId, agentId: agent.id, archiveId: archive.id, status: 'RUNNING' },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });

    await this.prisma.humanRequest.updateMany({
      where: { studioId, agentId: agent.id, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolution: `Archived into ${label}`,
        resolvedAt: new Date(),
      },
    });

    const affectedTaskIds = Array.from(
      new Set([
        ...activeMessages.map((m) => m.taskId).filter((id): id is string => Boolean(id)),
        ...activeRuns.map((r) => r.taskId),
      ]),
    );

    if (affectedTaskIds.length > 0) {
      const tasks = await this.prisma.task.findMany({
        where: { id: { in: affectedTaskIds }, studioId },
        select: { id: true, status: true, metadata: true },
      });
      for (const t of tasks) {
        const meta: Record<string, unknown> =
          typeof t.metadata === 'object' && t.metadata !== null
            ? { ...(t.metadata as Record<string, unknown>) }
            : {};
        meta['archived'] = true;
        meta['forceNewWebChat'] = true;
        const isOpen =
          t.status === 'QUEUED' ||
          t.status === 'RUNNING' ||
          t.status === 'NEEDS_HUMAN' ||
          t.status === 'PAUSED' ||
          t.status === 'BLOCKED';
        await this.prisma.task.update({
          where: { id: t.id },
          data: {
            metadata: meta as Prisma.InputJsonValue,
            ...(isOpen ? { status: 'CANCELLED', completedAt: new Date() } : {}),
          },
        });
      }
    }

    await this.recomputeAgentHeadState(studioId, agent.id);

    const createdWithItems = await this.prisma.chatArchive.findUniqueOrThrow({
      where: { id: archive.id },
      include: {
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, author: true, body: true, taskId: true },
        },
        runs: {
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            taskId: true,
            summary: true,
            task: { select: { title: true, brief: true } },
          },
        },
      },
    });

    const summaryDto = this.toArchiveSummaryDto(agent.key, createdWithItems);

    this.realtime.emitToStudio(studioId, 'chat:history-changed', {
      agentKey: agent.key,
      reason: 'fresh-start',
      archiveId: archive.id,
    });
    this.realtime.broadcastCounts(studioId);

    return { archive: summaryDto };
  }

  async branchFrom(
    studioId: string,
    agentKey: AgentKey,
    body: ChatBranchRequest,
    emitEvent = true,
  ): Promise<{ archive: ChatArchiveSummaryDto | null }> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const [activeMessages, activeRuns] = await Promise.all([
      this.prisma.agentMessage.findMany({
        where: { studioId, agentId: agent.id, archiveId: null },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.agentRun.findMany({
        where: { studioId, agentId: agent.id, archiveId: null },
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
        include: {
          task: { select: { id: true, title: true, brief: true } },
        },
      }),
    ]);

    const refRunIds = new Set(body.ref.runIds);
    const matchingRuns = activeRuns.filter((r) => refRunIds.has(r.id));
    const promptMsg = body.ref.promptMessageId
      ? activeMessages.find((m) => m.id === body.ref.promptMessageId)
      : undefined;

    // If branching from AI part of a turn that had a synthesized brief (no USER AgentMessage),
    // materialize the USER message so the user prompt stays visible in the active chat.
    let keptUserMsgId = promptMsg?.id ?? null;
    if (body.part === 'AI' && !keptUserMsgId && body.ref.taskId) {
      const taskRow = await this.prisma.task.findFirst({
        where: { id: body.ref.taskId, studioId },
        select: { id: true, brief: true, createdByUserId: true, createdAt: true },
      });
      const earliestRun = matchingRuns[0];
      const briefText = (taskRow?.brief ?? earliestRun?.task.brief ?? '').trim();
      if (taskRow && briefText.length > 0) {
        const msgTime = earliestRun
          ? new Date(earliestRun.startedAt.getTime() - 1000)
          : taskRow.createdAt;
        const createdUserMsg = await this.prisma.agentMessage.create({
          data: {
            studioId,
            agentId: agent.id,
            author: 'USER',
            userId: taskRow.createdByUserId,
            taskId: taskRow.id,
            body: briefText,
            createdAt: msgTime,
          },
        });
        keptUserMsgId = createdUserMsg.id;
      }
    }

    const messageIdsToArchive = new Set<string>();
    const runIdsToArchive = new Set<string>();

    if (body.part === 'USER') {
      let cutoffMs: number | null = null;
      if (promptMsg) {
        cutoffMs = promptMsg.createdAt.getTime();
        messageIdsToArchive.add(promptMsg.id);
      }
      if (matchingRuns.length > 0) {
        const earliestRunMs = Math.min(...matchingRuns.map((r) => r.startedAt.getTime()));
        cutoffMs = cutoffMs === null ? earliestRunMs : Math.min(cutoffMs, earliestRunMs);
        for (const r of matchingRuns) {
          runIdsToArchive.add(r.id);
        }
      }
      if (cutoffMs === null && body.ref.taskId) {
        const taskMsgs = activeMessages.filter((m) => m.taskId === body.ref.taskId);
        const taskRuns = activeRuns.filter((r) => r.taskId === body.ref.taskId);
        const times = [
          ...taskMsgs.map((m) => m.createdAt.getTime()),
          ...taskRuns.map((r) => r.startedAt.getTime()),
        ];
        if (times.length > 0) {
          cutoffMs = Math.min(...times);
        }
      }

      if (cutoffMs !== null) {
        for (const m of activeMessages) {
          if (m.createdAt.getTime() >= cutoffMs) {
            messageIdsToArchive.add(m.id);
          }
        }
        for (const r of activeRuns) {
          if (r.startedAt.getTime() >= cutoffMs) {
            runIdsToArchive.add(r.id);
          }
        }
      }
    } else {
      // body.part === 'AI': Keep the user prompt of this turn, archive its AI runs + everything newer
      let runCutoffMs: number | null = null;
      if (matchingRuns.length > 0) {
        runCutoffMs = Math.min(...matchingRuns.map((r) => r.startedAt.getTime()));
        for (const r of matchingRuns) {
          runIdsToArchive.add(r.id);
        }
      }
      const msgCutoffMs = promptMsg ? promptMsg.createdAt.getTime() : runCutoffMs;

      if (msgCutoffMs !== null) {
        for (const m of activeMessages) {
          if (m.id === keptUserMsgId) continue;
          if (promptMsg) {
            if (m.createdAt.getTime() > promptMsg.createdAt.getTime()) {
              messageIdsToArchive.add(m.id);
            }
          } else if (m.createdAt.getTime() >= msgCutoffMs) {
            messageIdsToArchive.add(m.id);
          }
        }
      }

      const effectiveRunCutoff = runCutoffMs ?? msgCutoffMs;
      if (effectiveRunCutoff !== null) {
        for (const r of activeRuns) {
          if (r.startedAt.getTime() >= effectiveRunCutoff) {
            runIdsToArchive.add(r.id);
          }
        }
      }
    }

    await this.googleWeb.detachAgentWebChatCache(studioId, agent.key, body.ref.taskId);

    if (messageIdsToArchive.size === 0 && runIdsToArchive.size === 0) {
      return { archive: null };
    }

    const runsBeingArchived = activeRuns.filter((r) => runIdsToArchive.has(r.id));
    for (const r of runsBeingArchived) {
      if (r.status === 'RUNNING') {
        this.registry.abort(r.id, 'CANCELLED');
      }
      await this.lanes.releaseByRun(studioId, r.id);
    }

    const agg = await this.prisma.chatArchive.aggregate({
      where: { agentId: agent.id, kind: 'BRANCH' },
      _max: { number: true },
    });
    const nextNumber = (agg._max.number ?? 0) + 1;
    const label = `Branch Archive #${nextNumber}`;

    const archive = await this.prisma.chatArchive.create({
      data: {
        studioId,
        agentId: agent.id,
        kind: 'BRANCH',
        number: nextNumber,
      },
    });

    if (messageIdsToArchive.size > 0) {
      await this.prisma.agentMessage.updateMany({
        where: { id: { in: Array.from(messageIdsToArchive) }, studioId, agentId: agent.id },
        data: { archiveId: archive.id },
      });
    }

    if (runIdsToArchive.size > 0) {
      await this.prisma.agentRun.updateMany({
        where: { id: { in: Array.from(runIdsToArchive) }, studioId, agentId: agent.id },
        data: { archiveId: archive.id },
      });
      await this.prisma.agentRun.updateMany({
        where: {
          id: { in: Array.from(runIdsToArchive) },
          studioId,
          agentId: agent.id,
          status: 'RUNNING',
        },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });
    }

    const affectedTaskIds = Array.from(
      new Set([
        ...(body.ref.taskId ? [body.ref.taskId] : []),
        ...activeMessages
          .filter((m) => messageIdsToArchive.has(m.id))
          .map((m) => m.taskId)
          .filter((id): id is string => Boolean(id)),
        ...runsBeingArchived.map((r) => r.taskId),
      ]),
    );

    await this.syncAffectedTasksAfterArchive(studioId, agent.id, affectedTaskIds, label);
    await this.recomputeAgentHeadState(studioId, agent.id);

    const createdWithItems = await this.prisma.chatArchive.findUniqueOrThrow({
      where: { id: archive.id },
      include: {
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, author: true, body: true, taskId: true },
        },
        runs: {
          orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            taskId: true,
            summary: true,
            task: { select: { title: true, brief: true } },
          },
        },
      },
    });

    const summaryDto = this.toArchiveSummaryDto(agent.key, createdWithItems);

    if (emitEvent) {
      this.realtime.emitToStudio(studioId, 'chat:history-changed', {
        agentKey: agent.key,
        reason: 'branch',
        archiveId: archive.id,
      });
      this.realtime.broadcastCounts(studioId);
    }

    return { archive: summaryDto };
  }

  async retry(
    studioId: string,
    agentKey: AgentKey,
    body: ChatRetryRequest,
    user: AuthenticatedUser,
  ): Promise<{ archive: ChatArchiveSummaryDto | null; task: TaskDto }> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    // Snapshot original run config before archiving if mode === 'SAME_AGENT'
    let runOverride: {
      llmConnectionId: string | null;
      provider: LlmProvider;
      modelId: string;
      temperature: number;
      maxOutputTokens: number;
    } | null = null;

    if (body.mode === 'SAME_AGENT') {
      const candidateRunId = body.sourceRunId ?? body.ref.runIds[0] ?? null;
      if (candidateRunId) {
        const sourceRun = await this.prisma.agentRun.findFirst({
          where: { id: candidateRunId, studioId },
          include: {
            entries: {
              where: { kind: 'CONTEXT' },
              orderBy: { seq: 'asc' },
              take: 1,
            },
          },
        });
        if (sourceRun) {
          const contextMeta = (sourceRun.entries[0]?.meta as RunLogMeta | null) ?? null;
          const runConfig = contextMeta?.runConfig;
          const provider = sourceRun.provider;
          const modelId = sourceRun.modelId || runConfig?.modelId || agent.modelId || '';
          const temperature =
            sourceRun.temperature ?? runConfig?.temperature ?? agent.temperature;
          const maxOutputTokens =
            sourceRun.maxOutputTokens ??
            runConfig?.maxOutputTokens ??
            agent.maxOutputTokens;
          let llmConnectionId =
            sourceRun.llmConnectionId ?? runConfig?.llmConnectionId ?? null;

          if (!llmConnectionId) {
            const matchingConn = await this.prisma.llmConnection.findFirst({
              where: { studioId, provider, isEnabled: true },
              orderBy: { createdAt: 'asc' },
              select: { id: true },
            });
            llmConnectionId = matchingConn?.id ?? null;
          }

          if (modelId) {
            runOverride = {
              llmConnectionId,
              provider,
              modelId,
              temperature,
              maxOutputTokens,
            };
          }
        }
      }
    }

    // Archive old AI response of this turn + anything newer into a Branch Archive #N
    const { archive } = await this.branchFrom(
      studioId,
      agentKey,
      { ref: body.ref, part: 'AI' },
      false,
    );

    // Find the kept USER prompt message or task brief
    const promptMsg = body.ref.promptMessageId
      ? await this.prisma.agentMessage.findFirst({
          where: { id: body.ref.promptMessageId, studioId, agentId: agent.id },
        })
      : body.ref.taskId
        ? await this.prisma.agentMessage.findFirst({
            where: {
              studioId,
              agentId: agent.id,
              taskId: body.ref.taskId,
              author: 'USER',
              archiveId: null,
            },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    const existingTask = body.ref.taskId
      ? await this.prisma.task.findFirst({
          where: { id: body.ref.taskId, studioId, agentId: agent.id },
        })
      : null;

    const promptBody = (promptMsg?.body ?? existingTask?.brief ?? '').trim();
    if (!promptBody) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'Cannot find prompt text to retry',
      );
    }

    const attachments: ChatAttachment[] = Array.isArray(promptMsg?.attachments)
      ? (promptMsg.attachments as unknown as ChatAttachment[])
      : [];
    const directives: ChatDirective[] = (promptMsg?.directives ?? []) as ChatDirective[];

    let taskDto: TaskDto;
    if (existingTask) {
      const mergedMeta = mergeDirectivesAndAttachmentsIntoTaskMeta(
        existingTask.metadata,
        directives,
        attachments,
      );
      delete mergedMeta['archived'];
      mergedMeta['forceNewWebChat'] = true;
      if (runOverride) {
        mergedMeta['runOverride'] = runOverride;
      } else {
        delete mergedMeta['runOverride'];
      }

      await this.prisma.task.update({
        where: { id: existingTask.id },
        data: {
          brief: promptBody,
          status: 'QUEUED',
          queuedAt: new Date(),
          completedAt: null,
          metadata: mergedMeta as Prisma.InputJsonValue,
        },
      });
      await this.agentStatus.recompute(agent.id);
      taskDto = await this.tasks.getById(studioId, existingTask.id);
      this.realtime.emitToStudio(studioId, 'task:updated', {
        task: taskDto,
        change: 'updated',
      });
      this.realtime.broadcastCounts(studioId);
      this.tasks.notifyTaskQueued(studioId);
    } else {
      const mergedMeta = mergeDirectivesAndAttachmentsIntoTaskMeta(
        null,
        directives,
        attachments,
      );
      mergedMeta['forceNewWebChat'] = true;
      if (runOverride) {
        mergedMeta['runOverride'] = runOverride;
      }

      taskDto = await this.tasks.createInternal({
        studioId,
        agentId: agent.id,
        createdByUserId: user.id,
        origin: 'USER',
        title: promptBody.slice(0, 75),
        brief: promptBody,
        priority: 'NORMAL',
        metadata: mergedMeta as Prisma.InputJsonValue,
      });

      if (promptMsg && !promptMsg.taskId) {
        await this.prisma.agentMessage.update({
          where: { id: promptMsg.id },
          data: { taskId: taskDto.id },
        });
      }
    }

    this.realtime.emitToStudio(studioId, 'chat:history-changed', {
      agentKey: agent.key,
      reason: 'retry',
      archiveId: archive?.id ?? null,
    });

    return { archive, task: taskDto };
  }

  async deletePart(
    studioId: string,
    agentKey: AgentKey,
    body: ChatDeletePartRequest,
  ): Promise<{ ok: true }> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    if (body.part === 'USER') {
      if (body.ref.promptMessageId) {
        await this.prisma.agentMessage.deleteMany({
          where: { id: body.ref.promptMessageId, studioId, agentId: agent.id },
        });
      } else if (body.ref.taskId) {
        // Synthesized task brief with no AgentMessage row: clear task.brief so the synthesized prompt disappears
        await this.prisma.task
          .update({
            where: { id: body.ref.taskId },
            data: { brief: '' },
          })
          .catch(() => {});
      }

      if (body.ref.taskId) {
        await this.cleanupOrphanTask(studioId, body.ref.taskId);
      }
    } else {
      // body.part === 'AI'
      if (!body.ref.promptMessageId && body.ref.taskId) {
        const taskRow = await this.prisma.task.findFirst({
          where: { id: body.ref.taskId, studioId },
          select: { id: true, brief: true, createdByUserId: true, createdAt: true },
        });
        const briefText = (taskRow?.brief ?? '').trim();
        if (taskRow && briefText.length > 0) {
          const existingUserMsgCount = await this.prisma.agentMessage.count({
            where: { studioId, agentId: agent.id, taskId: taskRow.id, author: 'USER' },
          });
          if (existingUserMsgCount === 0) {
            await this.prisma.agentMessage.create({
              data: {
                studioId,
                agentId: agent.id,
                author: 'USER',
                userId: taskRow.createdByUserId,
                taskId: taskRow.id,
                body: briefText,
                createdAt: taskRow.createdAt,
              },
            });
          }
        }
      }

      if (body.ref.runIds.length > 0) {
        const runs = await this.prisma.agentRun.findMany({
          where: { id: { in: body.ref.runIds }, studioId, agentId: agent.id },
          select: { id: true, status: true },
        });
        for (const r of runs) {
          if (r.status === 'RUNNING') {
            this.registry.abort(r.id, 'CANCELLED');
          }
          await this.lanes.releaseByRun(studioId, r.id);
        }
        await this.prisma.agentRun.deleteMany({
          where: { id: { in: body.ref.runIds }, studioId, agentId: agent.id },
        });
      }

      if (body.ref.taskId) {
        await this.cleanupOrphanTask(studioId, body.ref.taskId);
      }
    }

    await this.recomputeAgentHeadState(studioId, agent.id);

    this.realtime.emitToStudio(studioId, 'chat:history-changed', {
      agentKey: agent.key,
      reason: 'delete-part',
      archiveId: null,
    });
    this.realtime.broadcastCounts(studioId);

    return { ok: true };
  }

  async deleteArchive(
    studioId: string,
    agentKey: AgentKey,
    archiveId: string,
  ): Promise<{ deletedArchiveId: string }> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const archive = await this.prisma.chatArchive.findFirst({
      where: { id: archiveId, studioId, agentId: agent.id },
      include: {
        messages: { select: { taskId: true } },
        runs: { select: { taskId: true } },
      },
    });
    if (!archive) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Archive not found');
    }

    const taskIds = Array.from(
      new Set([
        ...archive.messages
          .map((m) => m.taskId)
          .filter((id): id is string => Boolean(id)),
        ...archive.runs.map((r) => r.taskId),
      ]),
    );

    await this.prisma.agentRun.deleteMany({
      where: { studioId, agentId: agent.id, archiveId: archive.id },
    });
    await this.prisma.agentMessage.deleteMany({
      where: { studioId, agentId: agent.id, archiveId: archive.id },
    });
    await this.prisma.chatArchive.delete({
      where: { id: archive.id },
    });

    for (const taskId of taskIds) {
      await this.cleanupOrphanTask(studioId, taskId);
    }

    this.realtime.emitToStudio(studioId, 'chat:history-changed', {
      agentKey: agent.key,
      reason: 'delete-archive',
      archiveId: archive.id,
    });
    this.realtime.broadcastCounts(studioId);

    return { deletedArchiveId: archive.id };
  }

  async deleteAllArchives(
    studioId: string,
    agentKey: AgentKey,
  ): Promise<{ deletedCount: number }> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const [archivedMessages, archivedRuns] = await Promise.all([
      this.prisma.agentMessage.findMany({
        where: { studioId, agentId: agent.id, archiveId: { not: null } },
        select: { taskId: true },
      }),
      this.prisma.agentRun.findMany({
        where: { studioId, agentId: agent.id, archiveId: { not: null } },
        select: { taskId: true },
      }),
    ]);

    const taskIds = Array.from(
      new Set([
        ...archivedMessages
          .map((m) => m.taskId)
          .filter((id): id is string => Boolean(id)),
        ...archivedRuns.map((r) => r.taskId),
      ]),
    );

    await this.prisma.agentRun.deleteMany({
      where: { studioId, agentId: agent.id, archiveId: { not: null } },
    });
    await this.prisma.agentMessage.deleteMany({
      where: { studioId, agentId: agent.id, archiveId: { not: null } },
    });
    const deleted = await this.prisma.chatArchive.deleteMany({
      where: { studioId, agentId: agent.id },
    });

    for (const taskId of taskIds) {
      await this.cleanupOrphanTask(studioId, taskId);
    }

    this.realtime.emitToStudio(studioId, 'chat:history-changed', {
      agentKey: agent.key,
      reason: 'delete-all-archives',
      archiveId: null,
    });
    this.realtime.broadcastCounts(studioId);

    return { deletedCount: deleted.count };
  }

  private toArchiveSummaryDto(
    agentKey: AgentKey,
    row: {
      id: string;
      kind: 'FRESH_START' | 'BRANCH';
      number: number;
      label?: string;
      createdAt: Date;
      messages: Array<{ id: string; author: string; body: string; taskId: string | null }>;
      runs: Array<{
        id: string;
        taskId: string;
        summary: string | null;
        task: { title: string; brief: string };
      }>;
    },
  ): ChatArchiveSummaryDto {
    const userMessages = row.messages.filter((m) => m.author === 'USER');
    const tasksWithUserMsg = new Set(
      userMessages.map((m) => m.taskId).filter((id): id is string => Boolean(id)),
    );
    const runOnlyTaskIds = new Set(
      row.runs.map((r) => r.taskId).filter((id) => !tasksWithUserMsg.has(id)),
    );
    const turnCount = Math.max(userMessages.length + runOnlyTaskIds.size, row.runs.length > 0 ? 1 : 0);

    const lastUserMsg = userMessages[userMessages.length - 1];
    const lastRun = row.runs[row.runs.length - 1];
    const rawPreview =
      lastUserMsg?.body ??
      lastRun?.summary ??
      lastRun?.task.brief ??
      lastRun?.task.title ??
      null;
    const previewSnippet = rawPreview
      ? rawPreview.replace(/\s+/g, ' ').trim().slice(0, 140)
      : null;

    const label =
      row.label ??
      (row.kind === 'FRESH_START' ? `Archive #${row.number}` : `Branch Archive #${row.number}`);

    return {
      id: row.id,
      agentKey,
      kind: row.kind,
      number: row.number,
      label,
      turnCount,
      messageCount: row.messages.length,
      runCount: row.runs.length,
      firstPromptExcerpt: previewSnippet,
      previewSnippet,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async syncAffectedTasksAfterArchive(
    studioId: string,
    agentId: string,
    taskIds: string[],
    archiveLabel: string,
  ): Promise<void> {
    if (taskIds.length === 0) return;

    const tasks = await this.prisma.task.findMany({
      where: { id: { in: taskIds }, studioId },
      include: {
        runs: { select: { id: true, archiveId: true } },
        messages: { select: { id: true, archiveId: true } },
      },
    });

    for (const t of tasks) {
      const hasActiveRun = t.runs.some((r) => !r.archiveId);
      const hasActiveMsg = t.messages.some((m) => !m.archiveId);
      const meta: Record<string, unknown> =
        typeof t.metadata === 'object' && t.metadata !== null
          ? { ...(t.metadata as Record<string, unknown>) }
          : {};
      meta['forceNewWebChat'] = true;

      if (!hasActiveRun && !hasActiveMsg) {
        meta['archived'] = true;
        await this.prisma.humanRequest.updateMany({
          where: { studioId, taskId: t.id, agentId, status: 'OPEN' },
          data: {
            status: 'RESOLVED',
            resolution: `Archived into ${archiveLabel}`,
            resolvedAt: new Date(),
          },
        });
        const isOpen =
          t.status === 'QUEUED' ||
          t.status === 'RUNNING' ||
          t.status === 'NEEDS_HUMAN' ||
          t.status === 'PAUSED' ||
          t.status === 'BLOCKED';
        await this.prisma.task.update({
          where: { id: t.id },
          data: {
            metadata: meta as Prisma.InputJsonValue,
            ...(isOpen ? { status: 'CANCELLED', completedAt: new Date() } : {}),
          },
        });
      } else {
        delete meta['archived'];
        await this.prisma.task.update({
          where: { id: t.id },
          data: {
            metadata: meta as Prisma.InputJsonValue,
            ...(t.status === 'RUNNING' ? { status: 'DONE', completedAt: new Date() } : {}),
          },
        });
      }
    }
  }

  private async cleanupOrphanTask(studioId: string, taskId: string): Promise<void> {
    const [runCount, msgCount] = await Promise.all([
      this.prisma.agentRun.count({ where: { studioId, taskId } }),
      this.prisma.agentMessage.count({ where: { studioId, taskId } }),
    ]);
    if (runCount === 0 && msgCount === 0) {
      await this.prisma.task.delete({ where: { id: taskId } }).catch(() => {});
    }
  }

  private async recomputeAgentHeadState(studioId: string, agentId: string): Promise<void> {
    const latestRun = await this.prisma.agentRun.findFirst({
      where: { studioId, agentId, archiveId: null },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        taskId: true,
        status: true,
        summary: true,
        errorMessage: true,
        errorCode: true,
        startedAt: true,
        finishedAt: true,
        task: { select: { title: true } },
      },
    });

    const isLatestRunning = latestRun?.status === 'RUNNING';
    const rawSnippet = latestRun
      ? (latestRun.summary ?? latestRun.errorMessage ?? latestRun.task.title)
      : null;
    const lastSnippet = rawSnippet
      ? rawSnippet.replace(/\s+/g, ' ').trim().slice(-140)
      : null;

    await this.prisma.agent.update({
      where: { id: agentId },
      data: {
        currentRunId: isLatestRunning ? latestRun.id : null,
        currentTaskId: isLatestRunning ? latestRun.taskId : null,
        lastActivityAt: latestRun ? (latestRun.finishedAt ?? latestRun.startedAt) : null,
        lastSnippet,
        lastErrorCode: latestRun?.errorCode ?? null,
        lastErrorMessage: latestRun?.errorMessage ?? null,
      },
    });

    await this.agentStatus.recompute(agentId);
  }
}
