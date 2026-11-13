import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AgentDetailDto,
  type AgentDto,
  type AgentKey,
  type AgentRunDetailDto,
  type AgentRunSummaryDto,
  type AgentVaultBindingDto,
  type Paginated,
  type PutVaultBindingsRequest,
  type RunLogMeta,
  type UpdateAgentRequest,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { decodeCursor, toPaginated } from '../../common/http/pagination.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LanesService } from '../lanes/lanes.service.js';
import { GoogleWebBrowserAdapter } from '../llm/adapters/google-web.adapter.js';
import { PROVIDER_LABEL } from '../llm/provider-defaults.js';
import { RunRegistryService } from '../orchestrator/run-registry.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { AgentStatusService } from './agent-status.service.js';

@Injectable()
export class AgentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentStatus: AgentStatusService,
    private readonly registry: RunRegistryService,
    private readonly lanes: LanesService,
    private readonly tasks: TasksService,
    private readonly realtime: RealtimeService,
    private readonly googleWeb: GoogleWebBrowserAdapter,
  ) {}

  async list(studioId: string): Promise<AgentDto[]> {
    const agents = await this.prisma.agent.findMany({
      where: { studioId },
      include: {
        llmConnection: { select: { provider: true, label: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const taskIds = agents
      .map((a) => a.currentTaskId)
      .filter((id): id is string => id !== null);

    const tasks =
      taskIds.length > 0
        ? await this.prisma.task.findMany({
            where: { id: { in: taskIds } },
            select: { id: true, title: true, gameId: true },
          })
        : [];
    const taskById = new Map(tasks.map((t) => [t.id, t]));

    return agents.map((a) => {
      const currentTask = a.currentTaskId ? taskById.get(a.currentTaskId) : undefined;
      return {
        id: a.id,
        key: a.key,
        name: a.name,
        title: a.title,
        color: a.color,
        glyph: a.glyph,
        order: a.sortOrder,
        status: a.status,
        isEnabled: a.isEnabled,
        currentTaskId: a.currentTaskId,
        currentTaskTitle: currentTask?.title ?? null,
        currentRunId: a.currentRunId,
        currentGameId: currentTask?.gameId ?? null,
        lastActivityAt: a.lastActivityAt ? a.lastActivityAt.toISOString() : null,
        lastSnippet: a.lastSnippet,
        modelLabel:
          a.llmConnection && a.modelId
            ? `${PROVIDER_LABEL[a.llmConnection.provider]} · ${a.modelId}`
            : null,
        lastErrorCode: a.lastErrorCode,
      };
    });
  }

  async getDetail(studioId: string, agentKey: AgentKey): Promise<AgentDetailDto> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      include: {
        llmConnection: { select: { provider: true, label: true } },
        vaultBindings: {
          include: {
            document: { select: { id: true, path: true, title: true } },
          },
          orderBy: { priority: 'asc' },
        },
      },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const currentTask = agent.currentTaskId
      ? await this.prisma.task.findUnique({
          where: { id: agent.currentTaskId },
          select: { title: true, gameId: true },
        })
      : null;

    return {
      id: agent.id,
      key: agent.key,
      name: agent.name,
      title: agent.title,
      color: agent.color,
      glyph: agent.glyph,
      order: agent.sortOrder,
      status: agent.status,
      isEnabled: agent.isEnabled,
      currentTaskId: agent.currentTaskId,
      currentTaskTitle: currentTask?.title ?? null,
      currentRunId: agent.currentRunId,
      currentGameId: currentTask?.gameId ?? null,
      lastActivityAt: agent.lastActivityAt ? agent.lastActivityAt.toISOString() : null,
      lastSnippet: agent.lastSnippet,
      modelLabel:
        agent.llmConnection && agent.modelId
          ? `${PROVIDER_LABEL[agent.llmConnection.provider]} · ${agent.modelId}`
          : null,
      lastErrorCode: agent.lastErrorCode,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools,
      llmConnectionId: agent.llmConnectionId,
      provider: agent.llmConnection?.provider ?? null,
      modelId: agent.modelId,
      temperature: agent.temperature,
      maxOutputTokens: agent.maxOutputTokens,
      imageConnectionId: agent.imageConnectionId,
      imageModelId: agent.imageModelId,
      vaultBindings: agent.vaultBindings.map((vb) => ({
        documentId: vb.document.id,
        path: vb.document.path,
        title: vb.document.title,
        priority: vb.priority,
      })),
    };
  }

  async update(
    studioId: string,
    agentKey: AgentKey,
    body: UpdateAgentRequest,
  ): Promise<AgentDetailDto> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    if (body.llmConnectionId) {
      const conn = await this.prisma.llmConnection.findFirst({
        where: { id: body.llmConnectionId, studioId },
        select: { id: true },
      });
      if (!conn) {
        throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
      }
    }

    if (body.imageConnectionId) {
      const imgConn = await this.prisma.llmConnection.findFirst({
        where: { id: body.imageConnectionId, studioId },
        select: { id: true },
      });
      if (!imgConn) {
        throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Image connection not found');
      }
    }

    const bindingChanged =
      body.llmConnectionId !== undefined || body.modelId !== undefined;

    await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
        ...(body.tools !== undefined
          ? { tools: [...new Set(body.tools)] }
          : {}),
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        ...(body.llmConnectionId !== undefined
          ? { llmConnectionId: body.llmConnectionId }
          : {}),
        ...(body.modelId !== undefined ? { modelId: body.modelId } : {}),
        ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
        ...(body.maxOutputTokens !== undefined
          ? { maxOutputTokens: body.maxOutputTokens }
          : {}),
        ...(body.imageConnectionId !== undefined
          ? { imageConnectionId: body.imageConnectionId }
          : {}),
        ...(body.imageModelId !== undefined ? { imageModelId: body.imageModelId } : {}),
        ...(bindingChanged ? { lastErrorCode: null } : {}),
      },
    });

    await this.agentStatus.recompute(agent.id);
    return this.getDetail(studioId, agentKey);
  }

  async putVaultBindings(
    studioId: string,
    agentKey: AgentKey,
    body: PutVaultBindingsRequest,
  ): Promise<AgentVaultBindingDto[]> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const docIds = [...new Set(body.bindings.map((b) => b.documentId))];
    if (docIds.length > 0) {
      const docs = await this.prisma.vaultDocument.findMany({
        where: { studioId, id: { in: docIds } },
        select: { id: true },
      });
      if (docs.length !== docIds.length) {
        throw new AppError(
          'VALIDATION_FAILED',
          HttpStatus.BAD_REQUEST,
          'One or more vault documents do not belong to this studio',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.agentVaultBinding.deleteMany({ where: { agentId: agent.id } });
      if (body.bindings.length > 0) {
        await tx.agentVaultBinding.createMany({
          data: body.bindings.map((b) => ({
            agentId: agent.id,
            documentId: b.documentId,
            priority: b.priority,
          })),
        });
      }
    });

    const detail = await this.getDetail(studioId, agentKey);
    return detail.vaultBindings;
  }

  async listRuns(
    studioId: string,
    agentKey: AgentKey,
    cursorRaw?: string,
    limit = 20,
    includeArchived = false,
  ): Promise<Paginated<AgentRunSummaryDto>> {
    const agent = await this.prisma.agent.findUnique({
      where: { studioId_key: { studioId, key: agentKey } },
      select: { id: true, key: true },
    });
    if (!agent) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Agent ${agentKey} not found`);
    }

    const cursor = decodeCursor(cursorRaw);
    const rows = await this.prisma.agentRun.findMany({
      where: {
        studioId,
        agentId: agent.id,
        ...(includeArchived ? {} : { archiveId: null }),
        ...(cursor
          ? {
              OR: [
                { startedAt: { lt: cursor.createdAt } },
                { startedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      include: {
        agent: { select: { key: true } },
        task: { select: { title: true, brief: true } },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const mappedRows = rows.map((r) => ({ ...r, createdAt: r.startedAt }));
    return toPaginated(mappedRows, limit, (r) => this.tasks.toRunSummaryDto(r));
  }

  async getRunDetail(studioId: string, runId: string): Promise<AgentRunDetailDto> {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: runId, studioId },
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
    });
    if (!run) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Run not found');
    }

    const summary = this.tasks.toRunSummaryDto(run);
    return {
      ...summary,
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
  }

  async cancelRun(studioId: string, runId: string): Promise<AgentRunSummaryDto> {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: runId, studioId },
      include: {
        agent: { select: { id: true, key: true } },
        task: { select: { id: true, title: true } },
      },
    });
    if (!run) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Run not found');
    }

    if (run.status !== 'RUNNING') {
      return this.tasks.toRunSummaryDto(run);
    }

    if (!this.registry.abort(run.id, 'CANCELLED')) {
      await this.prisma.agentRun.update({
        where: { id: run.id },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });
      await this.prisma.task.update({
        where: { id: run.taskId },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      await this.prisma.agent.updateMany({
        where: { id: run.agentId, currentRunId: run.id },
        data: { currentRunId: null, currentTaskId: null },
      });
      await this.lanes.releaseByRun(studioId, run.id);
      await this.tasks.propagateDependencyFailure(studioId, run.taskId);
      await this.agentStatus.recompute(run.agentId);

      const updatedTask = await this.tasks.getById(studioId, run.taskId);
      this.realtime.emitToStudio(studioId, 'task:updated', {
        task: updatedTask,
        change: 'updated',
      });
      this.realtime.broadcastCounts(studioId);
    }

    const refreshed = await this.prisma.agentRun.findUniqueOrThrow({
      where: { id: run.id },
      include: {
        agent: { select: { key: true } },
        task: { select: { title: true } },
      },
    });
    return this.tasks.toRunSummaryDto(refreshed);
  }

  async deleteRun(
    studioId: string,
    runId: string,
  ): Promise<{ deletedRunId: string; deletedTaskId: string | null }> {
    const run = await this.prisma.agentRun.findFirst({
      where: { id: runId, studioId },
      select: { id: true, agentId: true, taskId: true, status: true },
    });
    if (!run) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Run not found');
    }

    if (run.status === 'RUNNING') {
      this.registry.abort(run.id, 'CANCELLED');
    }
    await this.lanes.releaseByRun(studioId, run.id);

    await this.prisma.agentRun.delete({
      where: { id: run.id },
    });

    const siblingCount = await this.prisma.agentRun.count({
      where: { studioId, taskId: run.taskId },
    });

    let deletedTaskId: string | null = null;
    if (siblingCount === 0) {
      await this.prisma.agentMessage.deleteMany({
        where: { studioId, taskId: run.taskId },
      });
      await this.prisma.task
        .delete({
          where: { id: run.taskId },
        })
        .catch(() => {});
      deletedTaskId = run.taskId;
    }

    const latestRun = await this.prisma.agentRun.findFirst({
      where: { studioId, agentId: run.agentId, archiveId: null },
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
      where: { id: run.agentId },
      data: {
        currentRunId: isLatestRunning ? latestRun.id : null,
        currentTaskId: isLatestRunning ? latestRun.taskId : null,
        lastActivityAt: latestRun ? (latestRun.finishedAt ?? latestRun.startedAt) : null,
        lastSnippet,
        lastErrorCode: latestRun?.errorCode ?? null,
        lastErrorMessage: latestRun?.errorMessage ?? null,
      },
    });

    await this.agentStatus.recompute(run.agentId);
    this.realtime.broadcastCounts(studioId);

    return { deletedRunId: run.id, deletedTaskId };
  }

  async deleteAgentRuns(
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

    const runs = await this.prisma.agentRun.findMany({
      where: { studioId, agentId: agent.id },
      select: { id: true, status: true },
    });

    for (const r of runs) {
      if (r.status === 'RUNNING') {
        this.registry.abort(r.id, 'CANCELLED');
      }
      await this.lanes.releaseByRun(studioId, r.id);
    }

    await this.googleWeb.deleteAgentWebChats(studioId, agent.key).catch(() => {});

    await this.prisma.studioLane.updateMany({
      where: { studioId, heldByAgentId: agent.id },
      data: {
        heldByAgentId: null,
        heldForGameId: null,
        heldByRunId: null,
        heldSince: null,
      },
    });

    const deleted = await this.prisma.agentRun.deleteMany({
      where: { studioId, agentId: agent.id },
    });

    await this.prisma.agentMessage.deleteMany({
      where: { studioId, agentId: agent.id },
    });

    await this.prisma.chatArchive.deleteMany({
      where: { studioId, agentId: agent.id },
    });

    await this.prisma.task.deleteMany({
      where: { studioId, agentId: agent.id },
    });

    await this.prisma.agent.update({
      where: { id: agent.id },
      data: {
        currentRunId: null,
        currentTaskId: null,
        lastActivityAt: null,
        lastSnippet: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    await this.agentStatus.recompute(agent.id);
    this.realtime.broadcastCounts(studioId);

    return { deletedCount: deleted.count };
  }

  async deleteAllStudioRuns(studioId: string): Promise<{ deletedCount: number }> {
    const runs = await this.prisma.agentRun.findMany({
      where: { studioId },
      select: { id: true, status: true },
    });

    for (const r of runs) {
      if (r.status === 'RUNNING') {
        this.registry.abort(r.id, 'CANCELLED');
      }
    }

    await this.prisma.studioLane.updateMany({
      where: { studioId },
      data: {
        heldByAgentId: null,
        heldForGameId: null,
        heldByRunId: null,
        heldSince: null,
      },
    });

    const deleted = await this.prisma.agentRun.deleteMany({
      where: { studioId },
    });

    await this.prisma.agentMessage.deleteMany({
      where: { studioId },
    });

    await this.prisma.chatArchive.deleteMany({
      where: { studioId },
    });

    await this.prisma.task.deleteMany({
      where: { studioId },
    });

    await this.prisma.agent.updateMany({
      where: { studioId },
      data: {
        currentRunId: null,
        currentTaskId: null,
        lastActivityAt: null,
        lastSnippet: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });

    const agents = await this.prisma.agent.findMany({
      where: { studioId },
      select: { id: true },
    });
    for (const a of agents) {
      await this.agentStatus.recompute(a.id);
    }

    this.realtime.broadcastCounts(studioId);
    return { deletedCount: deleted.count };
  }
}
