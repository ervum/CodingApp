import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  AgentRunSummaryDto,
  CreateTaskRequest,
  ListTasksQuery,
  Paginated,
  RunLogMeta,
  TaskDetailDto,
  TaskDto,
  TaskFeedbackRequest,
  TaskOrigin,
  TaskOutputAgentResponseDto,
  TaskOutputArtifactDto,
  TaskOutputDto,
  TaskOutputImageDto,
  TaskOutputVaultDocDto,
  TaskPriority,
  TaskStatus,
  UpdateTaskRequest,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { decodeCursor, toPaginated } from '../../common/http/pagination.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentStatusService } from '../agents/agent-status.service.js';
import { LanesService } from '../lanes/lanes.service.js';
import { analyzeLuauCode } from '../orchestrator/coding-mode-rules.js';
import { RunRegistryService } from '../orchestrator/run-registry.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const TASK_INCLUDE = {
  agent: { select: { id: true, key: true } },
  acceptedByUser: { select: { displayName: true } },
  dependencies: {
    include: {
      dependsOn: { select: { id: true, status: true } },
    },
  },
  runs: {
    select: { id: true, status: true },
    orderBy: { startedAt: 'desc' as const },
    take: 1,
  },
  humanRequests: {
    where: { status: 'OPEN' as const },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.TaskInclude;

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

@Injectable()
export class TasksService {
  private readonly queuedListeners = new Set<(studioId: string) => void>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly agentStatus: AgentStatusService,
    private readonly registry: RunRegistryService,
    private readonly lanes: LanesService,
  ) {}

  onTaskQueued(listener: (studioId: string) => void): () => void {
    this.queuedListeners.add(listener);
    return () => this.queuedListeners.delete(listener);
  }

  notifyTaskQueued(studioId: string): void {
    for (const listener of this.queuedListeners) {
      try {
        listener(studioId);
      } catch {
        // Ignore listener errors
      }
    }
  }

  async list(studioId: string, query: ListTasksQuery): Promise<Paginated<TaskDto>> {
    const cursor = decodeCursor(query.cursor);
    const limit = query.limit ?? 50;

    let agentId: string | undefined;
    if (query.agentKey) {
      const agent = await this.prisma.agent.findUnique({
        where: { studioId_key: { studioId, key: query.agentKey } },
        select: { id: true },
      });
      if (!agent) {
        return { items: [], nextCursor: null };
      }
      agentId = agent.id;
    }

    const rows = await this.prisma.task.findMany({
      where: {
        studioId,
        ...(query.status ? { status: query.status } : {}),
        ...(query.priority ? { priority: query.priority } : {}),
        ...(query.inbox ? { status: 'DONE', acceptedAt: null } : {}),
        ...(agentId ? { agentId } : {}),
        ...(query.gameId ? { gameId: query.gameId } : {}),
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: TASK_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    return toPaginated(rows, limit, (r) => this.toDto(r));
  }

  async create(
    studioId: string,
    body: CreateTaskRequest,
    userId: string,
  ): Promise<TaskDto> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: body.agentKey } },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${body.agentKey} not found`);
    }

    if (body.gameId) {
      const game = await this.prisma.game.findFirst({
        where: { id: body.gameId, studioId },
        select: { id: true },
      });
      if (!game) {
        throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Game not found');
      }
    }

    return this.createInternal({
      studioId,
      agentId: agent.id,
      gameId: body.gameId,
      createdByUserId: userId,
      origin: 'USER',
      title: body.title,
      brief: body.brief,
      priority: body.priority,
      tags: body.tags,
    });
  }

  async createInternal(params: {
    studioId: string;
    agentId: string;
    gameId?: string | null;
    parentTaskId?: string | null;
    createdByUserId?: string | null;
    createdByAgentId?: string | null;
    origin: TaskOrigin;
    title: string;
    brief: string;
    priority?: TaskPriority;
    tags?: string[];
    dependsOnTaskIds?: string[];
    metadata?: Prisma.InputJsonValue;
  }): Promise<TaskDto> {
    const requestedDepIds = [...new Set(params.dependsOnTaskIds ?? [])];
    let validDepIds: string[] = [];
    let initialStatus: 'QUEUED' | 'BLOCKED' = 'QUEUED';

    if (requestedDepIds.length > 0) {
      const deps = await this.prisma.task.findMany({
        where: { studioId: params.studioId, id: { in: requestedDepIds } },
        select: { id: true, status: true },
      });
      validDepIds = deps.map((d) => d.id);
      if (deps.some((d) => d.status === 'FAILED' || d.status === 'CANCELLED')) {
        initialStatus = 'BLOCKED';
      }
    }

    const created = await this.prisma.task.create({
      data: {
        studioId: params.studioId,
        agentId: params.agentId,
        gameId: params.gameId ?? null,
        parentTaskId: params.parentTaskId ?? null,
        createdByUserId: params.createdByUserId ?? null,
        createdByAgentId: params.createdByAgentId ?? null,
        origin: params.origin,
        title: params.title,
        brief: params.brief,
        status: initialStatus,
        priority: params.priority ?? 'NORMAL',
        tags: params.tags ?? [],
        ...(params.metadata !== undefined ? { metadata: params.metadata } : {}),
        ...(validDepIds.length > 0
          ? {
              dependencies: {
                createMany: {
                  data: validDepIds.map((dependsOnId) => ({ dependsOnId })),
                },
              },
            }
          : {}),
      },
      include: TASK_INCLUDE,
    });

    const dto = this.toDto(created);
    await this.agentStatus.recompute(params.agentId);
    this.realtime.emitToStudio(params.studioId, 'task:updated', {
      task: dto,
      change: 'created',
    });
    this.realtime.broadcastCounts(params.studioId);
    if (initialStatus === 'QUEUED') {
      this.notifyTaskQueued(params.studioId);
    }
    return dto;
  }

  async getById(studioId: string, taskId: string): Promise<TaskDto> {
    const row = await this.prisma.task.findFirst({
      where: { id: taskId, studioId },
      include: TASK_INCLUDE,
    });
    if (!row) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Task not found');
    }
    return this.toDto(row);
  }

  async getDetail(studioId: string, taskId: string): Promise<TaskDetailDto> {
    const row = await this.prisma.task.findFirst({
      where: { id: taskId, studioId },
      include: {
        ...TASK_INCLUDE,
        children: {
          include: TASK_INCLUDE,
          orderBy: { createdAt: 'asc' },
        },
        runs: {
          include: {
            agent: { select: { key: true } },
            task: { select: { title: true } },
          },
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    if (!row) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Task not found');
    }

    const base = this.toDto(row);
    return {
      ...base,
      subtasks: row.children.map((c) => this.toDto(c)),
      runs: row.runs.map((r) => this.toRunSummaryDto(r)),
    };
  }

  async update(
    studioId: string,
    taskId: string,
    body: UpdateTaskRequest,
  ): Promise<TaskDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Task not found');
    }
    if (existing.status !== 'QUEUED' && existing.status !== 'PAUSED') {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `Task can only be edited while QUEUED or PAUSED (current: ${existing.status})`,
      );
    }

    const updated = await this.prisma.task.update({
      where: { id: existing.id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.brief !== undefined ? { brief: body.brief } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
      },
      include: TASK_INCLUDE,
    });

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'task:updated', {
      task: dto,
      change: 'updated',
    });
    return dto;
  }

  async cancel(studioId: string, taskId: string): Promise<TaskDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, studioId },
      include: {
        runs: {
          where: { status: 'RUNNING' },
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Task not found');
    }
    if (existing.status === 'DONE' || existing.status === 'CANCELLED') {
      return this.getById(studioId, taskId);
    }

    const activeRun = existing.runs[0];
    if (activeRun && this.registry.abort(activeRun.id, 'CANCELLED')) {
      // RunExecutor will finalize the run and task; also mark task CANCELLED immediately for synchronous response
      await this.prisma.task.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
    } else {
      if (activeRun) {
        await this.prisma.agentRun.update({
          where: { id: activeRun.id },
          data: { status: 'CANCELLED', finishedAt: new Date() },
        });
        await this.lanes.releaseByRun(studioId, activeRun.id);
      }
      await this.prisma.task.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await this.prisma.agent.updateMany({
        where: { id: existing.agentId, currentTaskId: existing.id },
        data: { currentTaskId: null, currentRunId: null },
      });
    }

    await this.propagateDependencyFailure(studioId, existing.id);
    await this.agentStatus.recompute(existing.agentId);

    const dto = await this.getById(studioId, existing.id);
    this.realtime.emitToStudio(studioId, 'task:updated', {
      task: dto,
      change: 'updated',
    });
    this.realtime.broadcastCounts(studioId);
    return dto;
  }

  async retry(studioId: string, taskId: string): Promise<TaskDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Task not found');
    }
    if (existing.status !== 'FAILED' && existing.status !== 'CANCELLED') {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `Task can only be retried from FAILED or CANCELLED (current: ${existing.status})`,
      );
    }

    const updated = await this.prisma.task.update({
      where: { id: existing.id },
      data: {
        status: 'QUEUED',
        queuedAt: new Date(),
        startedAt: null,
        completedAt: null,
      },
      include: TASK_INCLUDE,
    });

    await this.agentStatus.recompute(existing.agentId);

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'task:updated', {
      task: dto,
      change: 'updated',
    });
    this.realtime.broadcastCounts(studioId);
    this.notifyTaskQueued(studioId);
    return dto;
  }

  async accept(
    studioId: string,
    taskId: string,
    userId: string,
  ): Promise<TaskDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Task not found');
    }

    const updated = await this.prisma.task.update({
      where: { id: existing.id },
      data: {
        acceptedAt: new Date(),
        acceptedByUserId: userId,
      },
      include: TASK_INCLUDE,
    });

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'task:updated', {
      task: dto,
      change: 'updated',
    });
    return dto;
  }

  async feedback(
    studioId: string,
    taskId: string,
    body: TaskFeedbackRequest,
    userId: string,
  ): Promise<TaskDto> {
    const existing = await this.prisma.task.findFirst({
      where: { id: taskId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Task not found');
    }

    await this.prisma.task.update({
      where: { id: existing.id },
      data: {
        acceptedAt: new Date(),
        acceptedByUserId: userId,
      },
    });

    const updatedParent = await this.getById(studioId, existing.id);
    this.realtime.emitToStudio(studioId, 'task:updated', {
      task: updatedParent,
      change: 'updated',
    });

    const followUpBrief = [
      `Follow-up feedback on completed task **${existing.title}** (\`${existing.id}\`):`,
      '',
      body.feedback.trim(),
      '',
      ...(existing.resultSummary
        ? ['### Previous Result Summary', existing.resultSummary]
        : []),
    ].join('\n');

    return this.createInternal({
      studioId,
      agentId: existing.agentId,
      gameId: existing.gameId,
      parentTaskId: existing.id,
      createdByUserId: userId,
      origin: 'REVIEW_FEEDBACK',
      title: `Feedback: ${existing.title}`.slice(0, 140),
      brief: followUpBrief,
      priority: existing.priority,
      tags: [...new Set([...existing.tags, 'feedback'])].slice(0, 10),
    });
  }

  async propagateDependencyFailure(studioId: string, failedTaskId: string): Promise<void> {
    const queue = [failedTaskId];
    const visited = new Set<string>(queue);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const depEdges = await this.prisma.taskDependency.findMany({
        where: { dependsOnId: currentId },
        include: { task: true },
      });

      for (const edge of depEdges) {
        const dependent = edge.task;
        if (dependent.studioId !== studioId) continue;

        if (dependent.status === 'QUEUED') {
          const updated = await this.prisma.task.update({
            where: { id: dependent.id },
            data: { status: 'BLOCKED' },
            include: TASK_INCLUDE,
          });
          await this.agentStatus.recompute(dependent.agentId);
          this.realtime.emitToStudio(studioId, 'task:updated', {
            task: this.toDto(updated),
            change: 'updated',
          });
        }

        if (!visited.has(dependent.id)) {
          visited.add(dependent.id);
          queue.push(dependent.id);
        }
      }
    }
    this.realtime.broadcastCounts(studioId);
  }

  async propagateDependencyCompletion(studioId: string, completedTaskId: string): Promise<void> {
    const depEdges = await this.prisma.taskDependency.findMany({
      where: { dependsOnId: completedTaskId },
      include: {
        task: {
          include: {
            dependencies: {
              include: { dependsOn: { select: { status: true } } },
            },
          },
        },
      },
    });

    for (const edge of depEdges) {
      const dependent = edge.task;
      if (
        dependent.studioId !== studioId ||
        (dependent.status !== 'BLOCKED' && dependent.status !== 'QUEUED')
      ) {
        continue;
      }

      const allDone = dependent.dependencies.every((d) => d.dependsOn.status === 'DONE');
      if (allDone) {
        const updated = await this.prisma.task.update({
          where: { id: dependent.id },
          data: { status: 'QUEUED', queuedAt: new Date() },
          include: TASK_INCLUDE,
        });
        await this.agentStatus.recompute(dependent.agentId);
        this.realtime.emitToStudio(studioId, 'task:updated', {
          task: this.toDto(updated),
          change: 'updated',
        });
        this.notifyTaskQueued(studioId);
      }
    }
    this.realtime.broadcastCounts(studioId);
  }

  toDto(row: TaskWithRelations): TaskDto {
    const waitingOnDependencies = row.dependencies.some(
      (d) => d.dependsOn.status !== 'DONE',
    );
    return {
      id: row.id,
      title: row.title,
      brief: row.brief,
      status: row.status,
      priority: row.priority,
      origin: row.origin,
      agentKey: row.agent.key,
      gameId: row.gameId,
      parentTaskId: row.parentTaskId,
      tags: row.tags,
      dependsOn: row.dependencies.map((d) => d.dependsOn.id),
      waitingOnDependencies,
      attempts: row.attempts,
      createdAt: row.createdAt.toISOString(),
      queuedAt: row.queuedAt.toISOString(),
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
      acceptedByUserName: row.acceptedByUser?.displayName ?? null,
      resultSummary: row.resultSummary,
      latestRunId: row.runs[0]?.id ?? null,
      openHumanRequestId: row.humanRequests[0]?.id ?? null,
    };
  }

  toRunSummaryDto(run: {
    id: string;
    taskId: string;
    archiveId?: string | null;
    llmConnectionId?: string | null;
    temperature?: number | null;
    maxOutputTokens?: number | null;
    status: AgentRunSummaryDto['status'];
    provider: AgentRunSummaryDto['provider'];
    modelId: string;
    attempt: number;
    startedAt: Date;
    finishedAt: Date | null;
    inputTokens: number;
    outputTokens: number;
    costUsd?: number | null;
    toolCallCount: number;
    summary: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    agent: { key: AgentKey };
    task: { title: string; brief?: string };
  }): AgentRunSummaryDto {
    return {
      id: run.id,
      taskId: run.taskId,
      taskTitle: run.task.title,
      ...(run.task.brief !== undefined ? { taskBrief: run.task.brief } : {}),
      agentKey: run.agent.key,
      status: run.status,
      provider: run.provider,
      modelId: run.modelId,
      attempt: run.attempt,
      ...(run.archiveId !== undefined ? { archiveId: run.archiveId } : {}),
      ...(run.llmConnectionId !== undefined ? { llmConnectionId: run.llmConnectionId } : {}),
      ...(run.temperature !== undefined ? { temperature: run.temperature } : {}),
      ...(run.maxOutputTokens !== undefined ? { maxOutputTokens: run.maxOutputTokens } : {}),
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      costUsd: run.costUsd ?? 0,
      toolCallCount: run.toolCallCount,
      summary: run.summary,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
    };
  }

  async findRootTaskId(studioId: string, taskId: string): Promise<string> {
    let currentId = taskId;
    const seen = new Set<string>([currentId]);
    for (let depth = 0; depth < 15; depth++) {
      const row = await this.prisma.task.findFirst({
        where: { id: currentId, studioId },
        select: { id: true, parentTaskId: true },
      });
      if (!row || !row.parentTaskId || seen.has(row.parentTaskId)) {
        break;
      }
      currentId = row.parentTaskId;
      seen.add(currentId);
    }
    return currentId;
  }

  async checkAndEmitCompletedRootTaskOutput(
    studioId: string,
    taskId: string,
  ): Promise<void> {
    const rootTaskId = await this.findRootTaskId(studioId, taskId);
    const spawnedReview = await this.maybeSpawnLeadReviewForSpecialists(
      studioId,
      rootTaskId,
    );
    if (spawnedReview) {
      return;
    }
    const output = await this.buildCompletedRootTaskOutput(studioId, rootTaskId);
    if (output) {
      this.realtime.emitToStudio(studioId, 'task:output-ready', { output });
    }
  }

  /**
   * Closed-Loop Subagent Review:
   * When Lead delegates tasks to specialist agents and all specialist tasks finish,
   * automatically inspects their produced Luau artifacts. If any specialist artifact has
   * diagnostic errors (or if multiple specialists produced code that hasn't been reviewed by Lead),
   * spawns a single Lead Review & Synthesis pass before finalizing the workflow.
   */
  private async maybeSpawnLeadReviewForSpecialists(
    studioId: string,
    rootTaskId: string,
  ): Promise<boolean> {
    const rootRow = await this.prisma.task.findFirst({
      where: { id: rootTaskId, studioId },
      include: { agent: { select: { id: true, key: true } } },
    });
    if (!rootRow || rootRow.agent.key !== 'lead') {
      return false;
    }

    const rootMeta =
      typeof rootRow.metadata === 'object' && rootRow.metadata !== null
        ? (rootRow.metadata as Record<string, unknown>)
        : {};
    if (rootMeta['leadReviewSpawned'] === true) {
      return false;
    }

    const allTreeTasks = [rootRow];
    let frontier = [rootRow.id];
    const visited = new Set<string>([rootRow.id]);

    while (frontier.length > 0) {
      const children = await this.prisma.task.findMany({
        where: { studioId, parentTaskId: { in: frontier } },
        include: { agent: { select: { id: true, key: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      frontier = [];
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          allTreeTasks.push(child);
          frontier.push(child.id);
        }
      }
    }

    // Only applies when Lead actually delegated to specialist child tasks
    const specialistTasks = allTreeTasks.filter((t) => t.id !== rootRow.id);
    if (specialistTasks.length === 0) {
      return false;
    }

    const terminalStatuses = new Set<TaskStatus>(['DONE', 'FAILED', 'CANCELLED']);
    if (!allTreeTasks.every((t) => terminalStatuses.has(t.status))) {
      return false;
    }

    const activeRunsCount = await this.prisma.agentRun.count({
      where: {
        studioId,
        taskId: { in: allTreeTasks.map((t) => t.id) },
        status: 'RUNNING',
      },
    });
    if (activeRunsCount > 0) {
      return false;
    }

    const specialistTaskIds = specialistTasks.map((t) => t.id);
    const artifacts = await this.prisma.runArtifact.findMany({
      where: {
        run: {
          studioId,
          taskId: { in: specialistTaskIds },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const latestByPath = new Map<string, (typeof artifacts)[number]>();
    for (const art of artifacts) {
      if (!latestByPath.has(art.path)) {
        latestByPath.set(art.path, art);
      }
    }

    const diagnosticErrors: string[] = [];
    for (const art of latestByPath.values()) {
      if (
        art.language === 'luau' ||
        art.language === 'lua' ||
        /\.(?:luau|lua)$/i.test(art.path)
      ) {
        const diag = analyzeLuauCode(art.content, art.path);
        const errs = diag.issues.filter((i) => i.severity === 'error');
        for (const e of errs) {
          diagnosticErrors.push(
            `- \`${art.path}\`${e.line ? ` (line ${e.line})` : ''}: ${e.message}`,
          );
        }
      }
    }

    const failedSpecialists = specialistTasks.filter((t) => t.status === 'FAILED');
    const shouldSpawnReview =
      diagnosticErrors.length > 0 ||
      failedSpecialists.length > 0 ||
      latestByPath.size >= 2;

    if (!shouldSpawnReview) {
      return false;
    }

    await this.prisma.task.update({
      where: { id: rootRow.id },
      data: {
        metadata: {
          ...rootMeta,
          leadReviewSpawned: true,
        },
      },
    });

    const specialistBullets = specialistTasks.map(
      (t) =>
        `- **${t.agent.key}** — *${t.title}* (${t.status}): ${(t.resultSummary ?? 'Completed').slice(0, 300)}`,
    );
    const fileBullets = Array.from(latestByPath.keys()).map((p) => `- \`${p}\``);

    const reviewBriefLines = [
      'All delegated specialist tasks for this workflow have finished. Perform a Closed-Loop Lead Review & Synthesis:',
      '',
      '### Specialist Task Results',
      ...specialistBullets,
      '',
      ...(fileBullets.length > 0
        ? ['### Created / Updated Workspace Files', ...fileBullets, '']
        : []),
      ...(diagnosticErrors.length > 0
        ? [
            '### Luau Diagnostic Errors Detected (MUST FIX)',
            ...diagnosticErrors,
            '',
            'Inspect the affected files with `read_workspace_file` and fix all errors directly using `edit_workspace_file` or `save_artifact`.',
            '',
          ]
        : [
            'Verify cross-file integration (`read_workspace_file` if needed) and write a concise final "## Result" synthesis of everything delivered.',
          ]),
    ];

    await this.createInternal({
      studioId,
      agentId: rootRow.agentId,
      gameId: rootRow.gameId,
      parentTaskId: rootRow.id,
      createdByAgentId: rootRow.agentId,
      origin: 'SYSTEM',
      title: `Review & Synthesize: ${rootRow.title}`.slice(0, 140),
      brief: reviewBriefLines.join('\n'),
      priority: rootRow.priority,
      tags: [...new Set([...rootRow.tags, 'lead-review'])].slice(0, 8),
      metadata: { isLeadSynthesisReview: true },
    });

    return true;
  }

  async getTaskOutput(
    studioId: string,
    taskId: string,
  ): Promise<TaskOutputDto | null> {
    const rootTaskId = await this.findRootTaskId(studioId, taskId);
    return this.buildCompletedRootTaskOutput(studioId, rootTaskId);
  }

  async listCompletedOutputs(
    studioId: string,
    limit = 30,
  ): Promise<TaskOutputDto[]> {
    const rootTasks = await this.prisma.task.findMany({
      where: {
        studioId,
        parentTaskId: null,
        status: { in: ['DONE', 'FAILED', 'CANCELLED'] },
      },
      select: { id: true },
      orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });

    const outputs: TaskOutputDto[] = [];
    for (const rt of rootTasks) {
      const built = await this.buildCompletedRootTaskOutput(studioId, rt.id);
      if (built) {
        outputs.push(built);
      }
    }
    return outputs;
  }

  async buildCompletedRootTaskOutput(
    studioId: string,
    rootTaskId: string,
  ): Promise<TaskOutputDto | null> {
    const rootRow = await this.prisma.task.findFirst({
      where: { id: rootTaskId, studioId },
      include: { agent: { select: { key: true } } },
    });
    if (!rootRow) return null;

    const allTreeTasks = [rootRow];
    let frontier = [rootRow.id];
    const visited = new Set<string>([rootRow.id]);

    while (frontier.length > 0) {
      const children = await this.prisma.task.findMany({
        where: { studioId, parentTaskId: { in: frontier } },
        include: { agent: { select: { key: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      frontier = [];
      for (const child of children) {
        if (!visited.has(child.id)) {
          visited.add(child.id);
          allTreeTasks.push(child);
          frontier.push(child.id);
        }
      }
    }

    const terminalStatuses = new Set<TaskStatus>(['DONE', 'FAILED', 'CANCELLED']);
    const allFinished = allTreeTasks.every((t) => terminalStatuses.has(t.status));
    const anyDone = allTreeTasks.some((t) => t.status === 'DONE');
    if (!allFinished || !anyDone) {
      return null;
    }

    const treeTaskIds = allTreeTasks.map((t) => t.id);
    const activeRunsCount = await this.prisma.agentRun.count({
      where: { studioId, taskId: { in: treeTaskIds }, status: 'RUNNING' },
    });
    if (activeRunsCount > 0) {
      return null;
    }

    const runs = await this.prisma.agentRun.findMany({
      where: { studioId, taskId: { in: treeTaskIds } },
      include: {
        agent: { select: { key: true } },
        task: { select: { id: true, title: true, parentTaskId: true, resultSummary: true } },
        entries: { orderBy: { seq: 'asc' } },
        artifacts: { orderBy: { createdAt: 'asc' } },
        reviewItems: {
          include: { media: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    });

    const responses: TaskOutputAgentResponseDto[] = [];
    const artifacts: TaskOutputArtifactDto[] = [];
    const vaultDocIds = new Map<string, { agentKey: AgentKey; updatedAt: Date }>();
    const imagesMap = new Map<string, TaskOutputImageDto>();

    // Group runs by taskId to extract each task's latest completed response
    const latestRunByTaskId = new Map<string, (typeof runs)[number]>();
    for (const run of runs) {
      const existing = latestRunByTaskId.get(run.taskId);
      if (!existing || run.status === 'SUCCEEDED' || existing.status !== 'SUCCEEDED') {
        latestRunByTaskId.set(run.taskId, run);
      }

      for (const art of run.artifacts) {
        artifacts.push({
          id: art.id,
          runId: run.id,
          agentKey: run.agent.key,
          path: art.path,
          language: art.language,
          content: art.content,
          bytes: art.bytes,
          createdAt: art.createdAt.toISOString(),
        });
      }

      for (const ri of run.reviewItems) {
        if (ri.mediaId && ri.media) {
          imagesMap.set(ri.mediaId, {
            mediaId: ri.mediaId,
            title: `${ri.kind}: ${ri.title}`,
            kind: ri.kind,
            width: ri.media.width,
            height: ri.media.height,
            bytes: ri.media.bytes,
            agentKey: run.agent.key,
            reviewItemId: ri.id,
            createdAt: ri.createdAt.toISOString(),
          });
        }
      }

      for (const entry of run.entries) {
        const meta = (entry.meta as RunLogMeta | null) ?? null;
        if (meta?.createdArtifact) {
          const ca = meta.createdArtifact;
          if (ca.kind === 'vault_doc' && ca.id) {
            vaultDocIds.set(ca.id, {
              agentKey: run.agent.key,
              updatedAt: entry.createdAt,
            });
          } else if (ca.kind === 'image' && ca.mediaId && !imagesMap.has(ca.mediaId)) {
            imagesMap.set(ca.mediaId, {
              mediaId: ca.mediaId,
              title: ca.title ?? 'Generated image',
              kind: 'IMAGE',
              width: null,
              height: null,
              bytes: ca.bytes ?? 0,
              agentKey: run.agent.key,
              createdAt: entry.createdAt.toISOString(),
            });
          }
        } else if (
          entry.kind === 'TOOL_RESULT' &&
          meta?.tool === 'vault_update_document' &&
          meta.ok
        ) {
          try {
            const parsed = JSON.parse(entry.content) as { path?: string };
            if (parsed.path) {
              const docRow = await this.prisma.vaultDocument.findFirst({
                where: { studioId, path: parsed.path },
                select: { id: true },
              });
              if (docRow) {
                vaultDocIds.set(docRow.id, {
                  agentKey: run.agent.key,
                  updatedAt: entry.createdAt,
                });
              }
            }
          } catch {
            // ignore
          }
        } else if (
          entry.kind === 'TOOL_RESULT' &&
          (meta?.tool === 'generate_image' ||
            meta?.tool === 'pc_observe' ||
            meta?.tool === 'pc_act' ||
            meta?.tool === 'pc_sandbox' ||
            meta?.tool === 'studio_direct') &&
          meta.ok
        ) {
          try {
            const parsed = JSON.parse(entry.content) as {
              mediaId?: string;
              windowTitle?: string;
              width?: number;
              height?: number;
              bytes?: number;
            };
            if (parsed.mediaId && !imagesMap.has(parsed.mediaId)) {
              imagesMap.set(parsed.mediaId, {
                mediaId: parsed.mediaId,
                title:
                  meta.tool === 'generate_image'
                    ? 'Generated image'
                    : `Screenshot: ${parsed.windowTitle || meta.tool}`,
                kind: 'IMAGE',
                width: parsed.width ?? null,
                height: parsed.height ?? null,
                bytes: parsed.bytes ?? 0,
                agentKey: run.agent.key,
                createdAt: entry.createdAt.toISOString(),
              });
            }
          } catch {
            // ignore
          }
        }
      }
    }

    for (const taskRow of allTreeTasks) {
      const run = latestRunByTaskId.get(taskRow.id);
      if (!run) continue;

      let thinkingText: string | null = null;
      let thinkingDurationMs: number | null = null;
      const textParts: string[] = [];

      for (const entry of run.entries) {
        const meta = (entry.meta as RunLogMeta | null) ?? null;
        if (meta?.isThinking) {
          if (entry.content.trim()) {
            thinkingText = entry.content.trim();
          }
          if (typeof meta.thinkingDurationMs === 'number') {
            thinkingDurationMs = meta.thinkingDurationMs;
          }
        } else if (entry.kind === 'TEXT' && entry.content.trim()) {
          textParts.push(entry.content.trim());
        }
      }

      const responseText =
        textParts.join('\n\n').trim() ||
        (run.summary ?? taskRow.resultSummary ?? '').trim();

      if (responseText || thinkingText) {
        responses.push({
          taskId: taskRow.id,
          runId: run.id,
          agentKey: run.agent.key,
          taskTitle: taskRow.title,
          isRoot: taskRow.id === rootRow.id,
          thinkingText,
          thinkingDurationMs,
          responseText,
          finishedAt: (run.finishedAt ?? taskRow.completedAt ?? run.startedAt).toISOString(),
        });
      }
    }

    const vaultDocs: TaskOutputVaultDocDto[] = [];
    if (vaultDocIds.size > 0) {
      const docs = await this.prisma.vaultDocument.findMany({
        where: { studioId, id: { in: [...vaultDocIds.keys()] } },
      });
      for (const d of docs) {
        const ref = vaultDocIds.get(d.id);
        vaultDocs.push({
          documentId: d.id,
          path: d.path,
          title: d.title,
          version: d.version,
          markdown: d.markdown,
          bytes: Buffer.byteLength(d.markdown, 'utf8'),
          agentKey: ref?.agentKey ?? rootRow.agent.key,
          updatedAt: (ref?.updatedAt ?? d.updatedAt).toISOString(),
        });
      }
    }

    const participatingAgents = [
      ...new Set<AgentKey>(allTreeTasks.map((t) => t.agent.key)),
    ];
    const completedTasksInTree = allTreeTasks.filter((t) => t.status === 'DONE').length;

    const latestCompletedMs = Math.max(
      ...allTreeTasks.map((t) =>
        (t.completedAt ?? t.updatedAt ?? t.createdAt).getTime(),
      ),
    );

    const nonRootResponses = responses.filter((r) => !r.isRoot && r.responseText);
    const rootResponse = responses.find((r) => r.isRoot && r.responseText);

    let finalText = '';
    if (nonRootResponses.length === 0) {
      finalText = rootResponse?.responseText ?? rootRow.resultSummary ?? '';
    } else if (nonRootResponses.length === 1 && !rootResponse) {
      finalText = nonRootResponses[0]!.responseText;
    } else {
      const sections: string[] = [];
      if (rootResponse?.responseText) {
        sections.push(rootResponse.responseText);
      }
      for (const nr of nonRootResponses) {
        sections.push(`### ${nr.agentKey.toUpperCase()} — ${nr.taskTitle}\n\n${nr.responseText}`);
      }
      finalText = sections.join('\n\n---\n\n');
    }

    return {
      rootTaskId: rootRow.id,
      title: rootRow.title,
      brief: rootRow.brief,
      status: rootRow.status,
      gameId: rootRow.gameId,
      agentKey: rootRow.agent.key,
      totalTasksInTree: allTreeTasks.length,
      completedTasksInTree,
      participatingAgents,
      createdAt: rootRow.createdAt.toISOString(),
      completedAt: new Date(latestCompletedMs).toISOString(),
      finalText,
      responses,
      artifacts,
      vaultDocs,
      images: [...imagesMap.values()],
    };
  }
}
