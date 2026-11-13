import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { AGENT_ROSTER, type LlmProvider } from '@robdev/shared';
import { AppConfigService } from '../../config/app-config.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentStatusService } from '../agents/agent-status.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  AGENT_PERSONAS,
  AGENT_VAULT_BINDINGS,
  GENERAL_AGENT_PERSONAS,
} from '../studios/provision-studio.js';
import { TasksService } from '../tasks/tasks.service.js';
import { evaluateStudioBudget } from './budget-rules.js';
import { RunExecutorService } from './run-executor.service.js';
import { RunRegistryService } from './run-registry.service.js';

@Injectable()
export class OrchestratorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OrchestratorService.name);
  private ticking = false;
  private pendingTick = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
    private readonly registry: RunRegistryService,
    private readonly executor: RunExecutorService,
    private readonly agentStatus: AgentStatusService,
    private readonly tasks: TasksService,
    private readonly realtime: RealtimeService,
    private readonly scheduler: SchedulerRegistry,
  ) {
    this.tasks.onTaskQueued(() => {
      void this.tick().catch((err: unknown) => {
        this.logger.error(`Immediate orchestrator tick error: ${String(err)}`);
      });
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverOnBoot();

    if (!this.cfg.orchestratorAutostart) {
      await this.prisma.studio.updateMany({
        data: { isPaused: true, pausedAt: new Date() },
      });
    }

    await this.autoBindUnboundAgentsOnBoot();

    const allAgents = await this.prisma.agent.findMany({
      select: { id: true },
    });
    for (const a of allAgents) {
      await this.agentStatus.recompute(a.id);
    }

    void this.tick().catch((err: unknown) => {
      this.logger.error(`Initial orchestrator tick error: ${String(err)}`);
    });

    const interval = setInterval(() => {
      void this.tick().catch((err: unknown) => {
        this.logger.error(`Orchestrator tick error: ${String(err)}`);
      });
    }, this.cfg.orchestratorTickMs);

    try {
      this.scheduler.addInterval('orchestrator', interval);
    } catch {
      clearInterval(interval);
    }
  }

  onModuleDestroy(): void {
    try {
      this.scheduler.deleteInterval('orchestrator');
    } catch {
      // Ignore if interval was not registered
    }
  }

  private async autoBindUnboundAgentsOnBoot(): Promise<void> {
    const allStudios = await this.prisma.studio.findMany({
      select: { id: true, contextMode: true },
    });
    for (const s of allStudios) {
      // Backfill any newly added roster agents (e.g., 16th `browser` agent) on existing studios
      const existingAgents = await this.prisma.agent.findMany({
        where: { studioId: s.id },
        select: { key: true },
      });
      const existingKeys = new Set(existingAgents.map((a) => a.key));
      const missingSpecs = AGENT_ROSTER.filter((spec) => !existingKeys.has(spec.key));
      if (missingSpecs.length > 0) {
        const docs = await this.prisma.vaultDocument.findMany({
          where: { studioId: s.id },
          select: { id: true, title: true },
        });
        const docByTitle = new Map(docs.map((d) => [d.title, d.id]));
        const isGeneral = s.contextMode === 'GENERAL';

        for (const entry of missingSpecs) {
          const createdAgent = await this.prisma.agent.create({
            data: {
              studioId: s.id,
              key: entry.key,
              name: entry.name,
              title: isGeneral ? (entry.generalTitle ?? entry.title) : entry.title,
              description: isGeneral ? (entry.generalTitle ?? entry.title) : entry.title,
              color: entry.color,
              glyph: entry.glyph,
              sortOrder: entry.order,
              systemPrompt: isGeneral
                ? GENERAL_AGENT_PERSONAS[entry.key]
                : AGENT_PERSONAS[entry.key],
              tools: [...entry.defaultTools],
              status: 'OFFLINE',
              isEnabled: true,
              temperature: 0.4,
              maxOutputTokens: 16384,
            },
          });

          const bindingSpecs = AGENT_VAULT_BINDINGS[entry.key] ?? [];
          for (const bSpec of bindingSpecs) {
            const docId = docByTitle.get(bSpec.folder);
            if (docId) {
              await this.prisma.agentVaultBinding
                .create({
                  data: {
                    agentId: createdAgent.id,
                    documentId: docId,
                    priority: bSpec.priority,
                  },
                })
                .catch(() => {});
            }
          }
        }
      }

      const count = await this.prisma.llmConnection.count({
        where: { studioId: s.id },
      });
      if (count === 0) {
        await this.prisma.llmConnection.create({
          data: {
            studioId: s.id,
            provider: 'GOOGLE_WEB',
            label: 'Google Gemini Web / AI Studio',
            baseUrl: 'https://gemini.google.com/app',
            isEnabled: true,
          },
        });
      }
    }

    const connections = await this.prisma.llmConnection.findMany({
      where: { isEnabled: true },
      orderBy: [{ lastVerifiedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const bestByStudio = new Map<string, (typeof connections)[number]>();
    for (const c of connections) {
      if (!bestByStudio.has(c.studioId)) {
        bestByStudio.set(c.studioId, c);
      }
    }

    for (const [studioId, conn] of bestByStudio.entries()) {
      const modelId =
        conn.provider === 'GOOGLE_WEB'
          ? conn.baseUrl?.includes('aistudio.google.com')
            ? 'aistudio:gemini-3.8-flash?thinking=medium&tools=googleSearch&mediaRes=default'
            : 'gemini-web:3.8-flash?thinking=medium'
          : conn.provider === 'OLLAMA'
            ? 'qwen2.5-coder:7b'
            : conn.provider === 'GOOGLE'
              ? 'gemini-3.8-flash'
              : conn.provider === 'OPENAI'
                ? 'gpt-4o'
                : conn.provider === 'ANTHROPIC'
                  ? 'claude-sonnet-4-20250514'
                  : conn.provider === 'XAI'
                    ? 'grok-3'
                    : 'default';

      await this.prisma.agent.updateMany({
        where: {
          studioId,
          OR: [{ llmConnectionId: null }, { modelId: null }],
        },
        data: {
          llmConnectionId: conn.id,
          modelId,
          lastErrorCode: null,
        },
      });
    }
  }

  async tick(): Promise<string[]> {
    if (this.ticking) {
      this.pendingTick = true;
      return [];
    }
    this.ticking = true;
    const startedRunIds: string[] = [];

    try {
      const studios = await this.prisma.studio.findMany({
        where: { isPaused: false },
        select: {
          id: true,
          dailyTokenBudget: true,
          dailyCostBudgetUsd: true,
        },
      });

      for (const studio of studios) {
        if (
          (studio.dailyTokenBudget && studio.dailyTokenBudget > 0) ||
          (studio.dailyCostBudgetUsd && studio.dailyCostBudgetUsd > 0)
        ) {
          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          const todayAgg = await this.prisma.agentRun
            ?.aggregate?.({
              where: {
                studioId: studio.id,
                startedAt: { gte: startOfDay },
              },
              _sum: {
                inputTokens: true,
                outputTokens: true,
                costUsd: true,
              },
            })
            .catch(() => null);
          const todayTokens =
            (todayAgg?._sum?.inputTokens ?? 0) +
            (todayAgg?._sum?.outputTokens ?? 0);
          const todayCost = todayAgg?._sum?.costUsd ?? 0;
          const budgetCheck = evaluateStudioBudget({
            dailyTokenBudget: studio.dailyTokenBudget ?? null,
            dailyCostBudgetUsd: studio.dailyCostBudgetUsd ?? null,
            perTaskTokenBudget: null,
            todayTotalTokens: todayTokens,
            todayTotalCostUsd: todayCost,
          });
          if (!budgetCheck.allowed) {
            continue;
          }
        }

        const capacity = Math.max(
          0,
          this.cfg.maxConcurrentRunsPerStudio -
            this.registry.activeCount(studio.id),
        );

        for (let slot = 0; slot < capacity; slot++) {
          const claimed = await this.claimNextTask(studio.id);
          if (!claimed) break;

          startedRunIds.push(claimed.runId);
          const taskDto = await this.tasks.getById(studio.id, claimed.taskId);
          this.realtime.emitToStudio(studio.id, 'task:updated', {
            task: taskDto,
            change: 'updated',
          });
          this.realtime.broadcastCounts(studio.id);

          // Fire-and-forget RunExecutorService.start(runId)
          void this.executor.start(claimed.runId);
        }
      }
    } finally {
      this.ticking = false;
      if (this.pendingTick) {
        this.pendingTick = false;
        setImmediate(() => {
          void this.tick().catch((err: unknown) => {
            this.logger.error(`Pending orchestrator tick error: ${String(err)}`);
          });
        });
      }
    }

    return startedRunIds;
  }

  private async claimNextTask(
    studioId: string,
  ): Promise<{ taskId: string; runId: string; agentId: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; agentId: string }>
      >`
        WITH candidate AS (
          SELECT t.id, t."agentId"
          FROM "Task" t
          JOIN "Agent" a ON a.id = t."agentId"
          JOIN "Studio" s ON s.id = t."studioId"
          LEFT JOIN "LlmConnection" c ON c.id = a."llmConnectionId"
          WHERE t."studioId" = ${studioId}
            AND t.status = 'QUEUED'
            AND s."isPaused" = false
            AND a."isEnabled" = true AND a."modelId" IS NOT NULL AND c."isEnabled" = true
            AND a."currentRunId" IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM "TaskDependency" d JOIN "Task" dt ON dt.id = d."dependsOnId"
              WHERE d."taskId" = t.id AND dt.status <> 'DONE'
            )
          ORDER BY CASE t.priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, t."queuedAt"
          LIMIT 1
          FOR UPDATE OF t, a SKIP LOCKED
        )
        UPDATE "Task" SET status = 'RUNNING', "startedAt" = now(), "updatedAt" = now()
        FROM candidate WHERE "Task".id = candidate.id
        RETURNING "Task".id, candidate."agentId";
      `;

      const picked = rows[0];
      if (!picked) {
        return null;
      }

      const task = await tx.task.findUniqueOrThrow({
        where: { id: picked.id },
        select: { id: true, attempts: true, gameId: true, metadata: true },
      });
      const agent = await tx.agent.findUniqueOrThrow({
        where: { id: picked.agentId },
        include: { llmConnection: { select: { provider: true } } },
      });

      if (!agent.llmConnection || !agent.modelId) {
        return null;
      }

      const nextAttempt = task.attempts + 1;
      const meta: Record<string, unknown> =
        typeof task.metadata === 'object' && task.metadata !== null
          ? { ...(task.metadata as Record<string, unknown>) }
          : {};
      const rawOverride =
        typeof meta['runOverride'] === 'object' && meta['runOverride'] !== null
          ? (meta['runOverride'] as Record<string, unknown>)
          : null;

      let effectiveLlmConnectionId = agent.llmConnectionId;
      let effectiveProvider: LlmProvider = agent.llmConnection.provider;
      let effectiveModelId = agent.modelId;
      let effectiveTemperature = agent.temperature;
      let effectiveMaxOutputTokens = agent.maxOutputTokens;

      if (rawOverride) {
        if (typeof rawOverride['llmConnectionId'] === 'string') {
          const overrideConn = await tx.llmConnection
            ?.findFirst?.({
              where: {
                id: rawOverride['llmConnectionId'],
                studioId,
                isEnabled: true,
              },
              select: { id: true, provider: true },
            })
            .catch(() => null);
          if (overrideConn) {
            effectiveLlmConnectionId = overrideConn.id;
            effectiveProvider = overrideConn.provider;
          }
        } else if (typeof rawOverride['provider'] === 'string') {
          const overrideConn = await tx.llmConnection
            ?.findFirst?.({
              where: {
                studioId,
                provider: rawOverride['provider'] as LlmProvider,
                isEnabled: true,
              },
              orderBy: { createdAt: 'asc' },
              select: { id: true, provider: true },
            })
            .catch(() => null);
          if (overrideConn) {
            effectiveLlmConnectionId = overrideConn.id;
            effectiveProvider = overrideConn.provider;
          }
        }
        if (
          typeof rawOverride['modelId'] === 'string' &&
          rawOverride['modelId'].trim().length > 0
        ) {
          effectiveModelId = rawOverride['modelId'].trim();
        }
        if (typeof rawOverride['temperature'] === 'number') {
          effectiveTemperature = rawOverride['temperature'];
        }
        if (typeof rawOverride['maxOutputTokens'] === 'number') {
          effectiveMaxOutputTokens = rawOverride['maxOutputTokens'];
        }
        delete meta['runOverride'];
      }

      await tx.task.update({
        where: { id: task.id },
        data: {
          attempts: nextAttempt,
          ...(rawOverride ? { metadata: meta as Prisma.InputJsonValue } : {}),
        },
      });

      const existingRun = await tx.agentRun
        ?.findFirst?.({
          where: {
            studioId,
            taskId: task.id,
            agentId: agent.id,
            archiveId: null,
            status: { in: ['AWAITING_HUMAN', 'INTERRUPTED'] },
          },
          orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        })
        .catch(() => null);

      const run = existingRun
        ? await tx.agentRun.update({
            where: { id: existingRun.id },
            data: {
              status: 'RUNNING',
              finishedAt: null,
              errorCode: null,
              errorMessage: null,
              llmConnectionId: effectiveLlmConnectionId,
              provider: effectiveProvider,
              modelId: effectiveModelId,
              temperature: effectiveTemperature,
              maxOutputTokens: effectiveMaxOutputTokens,
              attempt: nextAttempt,
              heartbeatAt: new Date(),
            },
          })
        : await tx.agentRun.create({
            data: {
              studioId,
              taskId: task.id,
              agentId: agent.id,
              status: 'RUNNING',
              llmConnectionId: effectiveLlmConnectionId,
              provider: effectiveProvider,
              modelId: effectiveModelId,
              temperature: effectiveTemperature,
              maxOutputTokens: effectiveMaxOutputTokens,
              attempt: nextAttempt,
            },
          });

      await tx.agent.update({
        where: { id: agent.id },
        data: {
          currentTaskId: task.id,
          currentRunId: run.id,
          status: 'WORKING',
        },
      });

      if (
        task.gameId &&
        typeof task.metadata === 'object' &&
        task.metadata !== null
      ) {
        const meta = task.metadata as Record<string, unknown>;
        const buildId =
          typeof meta['buildId'] === 'string' ? meta['buildId'] : null;
        const pass =
          meta['pass'] === 'A' || meta['pass'] === 'B' ? meta['pass'] : null;
        if (buildId && pass) {
          await tx.gameBuild.updateMany({
            where: { id: buildId, gameId: task.gameId },
            data:
              pass === 'A'
                ? { mobilePassA: 'RUNNING' }
                : { mobilePassB: 'RUNNING' },
          });
        }
      }

      return {
        taskId: task.id,
        runId: run.id,
        agentId: agent.id,
      };
    });
  }

  private async recoverOnBoot(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const interruptedRuns = await tx.agentRun.findMany({
        where: { status: 'RUNNING' },
        select: { id: true, taskId: true },
      });

      if (interruptedRuns.length > 0) {
        const runIds = interruptedRuns.map((r) => r.id);
        await tx.agentRun.updateMany({
          where: { id: { in: runIds } },
          data: {
            status: 'INTERRUPTED',
            finishedAt: new Date(),
            errorMessage: 'Interrupted by server restart',
          },
        });

        await tx.studioLane.updateMany({
          where: { heldByRunId: { in: runIds } },
          data: {
            heldByAgentId: null,
            heldForGameId: null,
            heldByRunId: null,
            heldSince: null,
          },
        });
      }

      const runningTasks = await tx.task.findMany({
        where: { status: 'RUNNING' },
        select: { id: true, attempts: true },
      });

      for (const t of runningTasks) {
        if (t.attempts >= 15) {
          await tx.task.update({
            where: { id: t.id },
            data: {
              status: 'FAILED',
              resultSummary: 'RUN_INTERRUPTED_TOO_OFTEN',
            },
          });
        } else {
          await tx.task.update({
            where: { id: t.id },
            data: {
              status: 'QUEUED',
              queuedAt: new Date(),
              attempts: t.attempts + 1,
            },
          });
        }
      }

      await tx.agent.updateMany({
        where: {
          OR: [{ currentTaskId: { not: null } }, { currentRunId: { not: null } }],
        },
        data: {
          currentTaskId: null,
          currentRunId: null,
        },
      });
    });
  }
}
