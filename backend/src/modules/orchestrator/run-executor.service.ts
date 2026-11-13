import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  AGENT_BY_KEY,
  estimateTokens,
  type AgentKey,
  type AgentRunSummaryDto,
  type AgentTool,
  type LiveRunDto,
  type RunStatus,
  type TaskPriority,
  type TaskStatus,
} from '@robdev/shared';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentStatusService } from '../agents/agent-status.service.js';
import { BuildsService } from '../games/builds.service.js';
import { LanesService } from '../lanes/lanes.service.js';
import { GoogleWebBrowserAdapter } from '../llm/adapters/google-web.adapter.js';
import {
  LlmError,
  type LlmFinishReason,
  type LlmMessage,
  type LlmToolCall,
  type ResolvedConnection,
} from '../llm/adapters/llm-adapter.interface.js';
import { LlmAdapterFactory } from '../llm/llm-adapter.factory.js';
import { LlmConnectionsService } from '../llm/llm-connections.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import {
  calculateRunCostUsd,
  evaluateStudioBudget,
  type CostPricing,
} from './budget-rules.js';
import { analyzeLuauCode } from './coding-mode-rules.js';
import { LogBuffer, LogBufferFactory } from './log-buffer.js';
import { PromptResolverService } from './prompt-resolver.service.js';
import type { RunAbortReason, RunOutcome } from './run-errors.js';
import { RunRegistryService } from './run-registry.service.js';
import { PcDesktopAutomationService } from './tools/pc-desktop-automation.service.js';
import type { ToolContext } from './tools/tool-context.js';
import { ToolRegistryService } from './tools/tool-registry.service.js';

interface LoadedRunContext {
  studioId: string;
  studioName: string;
  run: {
    id: string;
    attempt: number;
    startedAt: Date;
  };
  task: {
    id: string;
    rootTaskId: string;
    title: string;
    brief: string;
    priority: TaskPriority;
    tags: string[];
    parentTaskId: string | null;
    gameId: string | null;
    metadata: Record<string, unknown> | null;
  };
  agent: {
    id: string;
    key: AgentKey;
    displayName: string;
    systemPrompt: string;
    tools: AgentTool[];
    modelId: string;
    temperature: number;
    maxOutputTokens: number;
    imageConnectionId: string | null;
    imageModelId: string | null;
  };
  game: {
    id: string;
    name: string;
    genre: string;
    status: string;
    latestSavedVersion: number | null;
    latestPublishedVersion: number | null;
  } | null;
  connection: ResolvedConnection;
  pricing: CostPricing;
  budgets: {
    dailyTokenBudget: number | null;
    dailyCostBudgetUsd: number | null;
    perTaskTokenBudget: number | null;
  };
}

@Injectable()
export class RunExecutorService {
  private readonly logger = new Logger(RunExecutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: AppConfigService,
    private readonly registry: RunRegistryService,
    private readonly adapters: LlmAdapterFactory,
    private readonly llmConnections: LlmConnectionsService,
    private readonly googleWeb: GoogleWebBrowserAdapter,
    private readonly promptResolver: PromptResolverService,
    private readonly tools: ToolRegistryService,
    private readonly logBufferFactory: LogBufferFactory,
    private readonly lanes: LanesService,
    private readonly tasks: TasksService,
    private readonly builds: BuildsService,
    private readonly agentStatus: AgentStatusService,
    private readonly realtime: RealtimeService,
    @Optional() private readonly pcAutomation?: PcDesktopAutomationService,
  ) {}

  async start(runId: string): Promise<void> {
    const ctl = this.registry.register(runId);
    const timeout = setTimeout(
      () => ctl.abort('TIMEOUT'),
      this.cfg.agentRunTimeoutMs,
    );
    const heartbeat = setInterval(() => {
      void this.prisma.agentRun
        .update({
          where: { id: runId },
          data: { heartbeatAt: new Date() },
        })
        .catch(() => {});
    }, 15_000);

    let log: LogBuffer | null = null;
    let outcome: RunOutcome = { kind: 'succeeded' };
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let loadedStudioId: string | null = null;

    try {
      const ctx = await this.loadContext(runId);
      loadedStudioId = ctx.studioId;
      this.registry.setMeta(runId, {
        studioId: ctx.studioId,
        agentId: ctx.agent.id,
      });

      const seqAgg = await this.prisma.runLogEntry
        ?.aggregate?.({
          where: { runId },
          _max: { seq: true },
        })
        .catch(() => null);
      const initialNextSeq = (seqAgg?._max?.seq ?? 0) + 1;

      log = this.logBufferFactory.create(
        ctx.studioId,
        runId,
        ctx.agent.key,
        initialNextSeq,
      );

      await this.emitRunStarted(ctx);
      await this.agentStatus.recompute(ctx.agent.id);

      const initStatus =
        ctx.agent.key === 'lead'
          ? 'Initializing agents...'
          : `Initializing ${ctx.agent.displayName}...`;
      await log.entry('SYSTEM', initStatus);
      this.realtime.emitToStudio(ctx.studioId, 'agent:activity', {
        agentKey: ctx.agent.key,
        runId,
        snippet: initStatus,
      });

      const adapter = this.adapters.forConnection(ctx.connection);
      const resolved = await this.promptResolver.resolve({
        studioId: ctx.studioId,
        studioName: ctx.studioName,
        runId: ctx.run.id,
        agent: ctx.agent,
        task: ctx.task,
        game: ctx.game,
      });

      await this.prisma.agentRun
        .update({
          where: { id: ctx.run.id },
          data: {
            llmConnectionId: ctx.connection.id,
            modelId: ctx.agent.modelId,
            provider: ctx.connection.provider,
            temperature: ctx.agent.temperature,
            maxOutputTokens: ctx.agent.maxOutputTokens,
          },
        })
        .catch(() => undefined);

      const forceNewWebChat = Boolean(ctx.task.metadata?.['forceNewWebChat']);
      if (forceNewWebChat && ctx.task.metadata) {
        const cleanedMeta = { ...ctx.task.metadata };
        delete cleanedMeta['forceNewWebChat'];
        await this.prisma.task
          .update({
            where: { id: ctx.task.id },
            data: { metadata: cleanedMeta as Record<string, never> },
          })
          .catch(() => undefined);
      }

      const vaultContextTokens = resolved.injected.reduce(
        (sum, d) => sum + (d.estimatedTokens || 0),
        0,
      );
      const sysMsgContent =
        resolved.messages.find((m) => m.role === 'system')?.content ?? '';
      const totalSystemTokens = estimateTokens(sysMsgContent);
      const systemRulesTokens = Math.max(
        120,
        totalSystemTokens - vaultContextTokens,
      );
      const userPromptTokens = estimateTokens(ctx.task.brief || ctx.task.title);
      const otherMsgTokens = resolved.messages
        .filter((m) => m.role !== 'system')
        .reduce((sum, m) => sum + estimateTokens(m.content), 0);
      const toolSchemaTokens = resolved.toolDefs.reduce(
        (sum, t) => sum + estimateTokens(JSON.stringify(t)),
        0,
      );
      const toolsAndContextTokens = Math.max(
        80,
        otherMsgTokens - userPromptTokens + toolSchemaTokens,
      );

      await log.entry(
        'CONTEXT',
        `Loaded ${resolved.injected.length} vault documents`,
        {
          docs: resolved.injected,
          runConfig: {
            llmConnectionId: ctx.connection.id,
            provider: ctx.connection.provider,
            modelId: ctx.agent.modelId,
            temperature: ctx.agent.temperature,
            maxOutputTokens: ctx.agent.maxOutputTokens,
          },
          promptTokens: {
            userPrompt: userPromptTokens,
            vaultContext: vaultContextTokens,
            systemRules: systemRulesTokens,
            toolsAndContext: toolsAndContextTokens,
          },
        },
      );

      const messages: LlmMessage[] = [...resolved.messages];
      let finalAssistantText = '';
      let qualityGateTriggered = false;

      for (let i = 0; i < this.cfg.agentMaxToolIterations; i++) {
        const pendingCalls: LlmToolCall[] = [];
        let finish: LlmFinishReason = 'stop';
        let text = '';
        const turnStartMs = Date.now();
        const turnStartedAt = new Date(turnStartMs).toISOString();
        let sawThinkingEvent = false;

        // Keep full base64 screenshot payloads only on the 2 most recent image-bearing messages to prevent context bloat
        let imageMsgSeen = 0;
        for (let mIdx = messages.length - 1; mIdx >= 0; mIdx--) {
          const msg = messages[mIdx]!;
          if (
            (msg.role === 'tool' || msg.role === 'user') &&
            msg.images &&
            msg.images.length > 0
          ) {
            imageMsgSeen += 1;
            if (imageMsgSeen > 2) {
              delete msg.images;
            }
          }
        }

        for await (const ev of adapter.stream(
          {
            model: ctx.agent.modelId,
            messages,
            tools: resolved.toolDefs,
            temperature: ctx.agent.temperature,
            maxOutputTokens: ctx.agent.maxOutputTokens,
            runId: ctx.run.id,
            studioId: ctx.studioId,
            taskId: ctx.task.id,
            rootTaskId: ctx.task.rootTaskId,
            agentId: ctx.agent.id,
            agentKey: ctx.agent.key,
            agentName: ctx.agent.displayName,
            taskTitle: ctx.task.title,
            turnIndex: i,
            ...(forceNewWebChat && i === 0 ? { forceNewWebChat: true } : {}),
          },
          ctl.signal,
        )) {
          if (ev.type === 'status') {
            await log.entry('SYSTEM', ev.statusText);
            this.realtime.emitToStudio(ctx.studioId, 'agent:activity', {
              agentKey: ctx.agent.key,
              runId,
              snippet: ev.statusText,
            });
            if (!sawThinkingEvent && text.length === 0) {
              await log.updateThinking?.(
                '',
                turnStartedAt,
                Math.max(0, Date.now() - turnStartMs),
                false,
              );
            }
          } else if (ev.type === 'thinking') {
            sawThinkingEvent = true;
            await log.updateThinking?.(
              ev.text,
              ev.startedAt,
              ev.durationMs,
              ev.done,
            );
          } else if (ev.type === 'text-delta') {
            if (ev.replace) {
              text = ev.text;
              await log.appendText(ev.text, true);
            } else {
              text += ev.text;
              await log.appendText(ev.text, false);
            }
          } else if (ev.type === 'tool-call') {
            await log.closeThinking?.();
            pendingCalls.push(ev.call);
          } else if (ev.type === 'usage') {
            totalInputTokens += ev.inputTokens;
            totalOutputTokens += ev.outputTokens;
            await this.addUsage(
              runId,
              ev.inputTokens,
              ev.outputTokens,
              ctx.pricing,
            );
            const taskEval = evaluateStudioBudget({
              dailyTokenBudget: null,
              dailyCostBudgetUsd: null,
              perTaskTokenBudget: ctx.budgets.perTaskTokenBudget,
              todayTotalTokens: 0,
              todayTotalCostUsd: 0,
              currentRunTokens: totalInputTokens + totalOutputTokens,
            });
            if (!taskEval.allowed && taskEval.reason) {
              await log.entry('SYSTEM', `[BUDGET GUARDRAIL] ${taskEval.reason}`);
              ctl.abort('PAUSED');
            }
          } else if (ev.type === 'finish') {
            finish = ev.reason;
          }
        }

        await log.closeThinking?.();
        await log.closeText();
        if (text.trim()) {
          finalAssistantText = text;
        }

        messages.push({
          role: 'assistant',
          content: text,
          ...(pendingCalls.length > 0 ? { toolCalls: pendingCalls } : {}),
        });

        if (pendingCalls.length === 0) {
          const gatePrompt = !qualityGateTriggered
            ? await this.evaluatePreFinishQualityGate(ctx, text)
            : null;
          if (gatePrompt && i < this.cfg.agentMaxToolIterations - 1) {
            qualityGateTriggered = true;
            await log.entry(
              'SYSTEM',
              'Pre-finish quality gate triggered — requesting verification/persistence fix...',
            );
            messages.push({ role: 'user', content: gatePrompt });
            continue;
          }
          outcome = { kind: 'succeeded', summary: finalAssistantText };
          break;
        }

        const toolCtx: ToolContext = {
          studioId: ctx.studioId,
          run: { id: ctx.run.id },
          task: ctx.task,
          agent: ctx.agent,
          game: ctx.game ? { id: ctx.game.id, name: ctx.game.name } : null,
          log,
          prisma: this.prisma,
          userFacingAgentName: ctx.agent.displayName,
          signal: ctl.signal,
        };

        for (const call of pendingCalls) {
          if (call.name === 'delegate_task') {
            this.realtime.emitToStudio(ctx.studioId, 'agent:activity', {
              agentKey: ctx.agent.key,
              runId,
              snippet: 'Delegating tasks to specialist agents...',
            });
          }
          const res = await this.tools.execute(call, toolCtx);
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: JSON.stringify(res.payload),
            ...(res.images && res.images.length > 0 ? { images: res.images } : {}),
          });
          if (res.control === 'await-human') {
            outcome = { kind: 'awaiting-human' };
          }
        }

        if (outcome.kind === 'awaiting-human') {
          break;
        }

        if (i === this.cfg.agentMaxToolIterations - 1) {
          const allTerminalActions = pendingCalls.every((c) =>
            [
              'delegate_task',
              'save_artifact',
              'edit_workspace_file',
              'comment_workspace_file',
              'run_terminal_command',
              'pc_act',
              'pc_window',
              'pc_sandbox',
              'studio_direct',
              'update_milestone',
              'create_build',
              'promote_build',
              'record_playtest_finding',
              'propose_fix',
            ].includes(c.name),
          );
          if (allTerminalActions && pendingCalls.length > 0) {
            outcome = {
              kind: 'succeeded',
              summary:
                finalAssistantText ||
                `Completed ${pendingCalls.length} studio action(s).`,
            };
          } else {
            outcome = {
              kind: 'failed',
              code: 'TOOL_LOOP_LIMIT',
              message: 'Tool iteration limit reached',
            };
          }
        }

        if (finish === 'length') {
          // Continue loop: model will be asked to continue via appended messages
        }
      }

      if (totalInputTokens > 0 || totalOutputTokens > 0) {
        await log.entry(
          'USAGE',
          `Tokens: ${totalInputTokens} input · ${totalOutputTokens} output`,
          {
            usage: {
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
            },
          },
        );
      }
    } catch (err) {
      outcome = this.classifyFailure(err, ctl.reason);
      if (outcome.kind === 'failed' && log) {
        await log
          .entry('ERROR', outcome.message, { errorCode: outcome.code })
          .catch(() => {});
      }
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      this.pcAutomation?.releaseMainPcLock(runId);
      if (loadedStudioId) {
        await (this.llmConnections.finalizeRunSession?.(runId, loadedStudioId) ??
          this.googleWeb.finalizeRunSession(runId, loadedStudioId)
        ).catch((err: unknown) => {
          this.logger.warn(
            `Failed to finalize web session for run ${runId}: ${String(err)}`,
          );
        });
      }
      if (log) {
        await log.flushAll().catch(() => {});
      }
      await this.finish(runId, outcome).catch((err: unknown) => {
        this.logger.error(`Failed to finalize run ${runId}: ${String(err)}`);
      });
    }
  }

  private async loadContext(runId: string): Promise<LoadedRunContext> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        studio: {
          select: {
            id: true,
            name: true,
            dailyTokenBudget: true,
            dailyCostBudgetUsd: true,
            perTaskTokenBudget: true,
          },
        },
        task: {
          include: {
            game: true,
          },
        },
        agent: {
          include: {
            llmConnection: true,
          },
        },
      },
    });

    if (!run) {
      throw new LlmError('PROVIDER_BAD_REQUEST', `Run ${runId} not found`);
    }

    let rawConnection = run.agent.llmConnection;
    if (run.llmConnectionId && run.llmConnectionId !== run.agent.llmConnection?.id) {
      const overrideConn = await this.prisma.llmConnection
        ?.findFirst?.({
          where: { id: run.llmConnectionId, studioId: run.studio.id },
        })
        .catch(() => null);
      if (overrideConn) {
        rawConnection = overrideConn;
      }
    }

    const effectiveModelId = run.modelId || run.agent.modelId;
    if (!rawConnection || !effectiveModelId) {
      throw new LlmError(
        'PROVIDER_BAD_REQUEST',
        `Agent ${run.agent.key} has no bound LLM connection or model`,
      );
    }

    const connection = this.llmConnections.decryptConnection(rawConnection);

    const metadata =
      typeof run.task.metadata === 'object' && run.task.metadata !== null
        ? (run.task.metadata as Record<string, unknown>)
        : null;

    const extraTools = Array.isArray(metadata?.['extraTools'])
      ? (metadata['extraTools'] as AgentTool[])
      : [];

    let rootTaskId = run.task.id;
    let currentParentId = run.task.parentTaskId;
    let depth = 0;
    while (currentParentId && depth < 10) {
      rootTaskId = currentParentId;
      const parentRow = await this.prisma.task.findUnique({
        where: { id: currentParentId },
        select: { parentTaskId: true },
      });
      currentParentId = parentRow?.parentTaskId ?? null;
      depth++;
    }

    return {
      studioId: run.studio.id,
      studioName: run.studio.name,
      run: {
        id: run.id,
        attempt: run.attempt,
        startedAt: run.startedAt,
      },
      task: {
        id: run.task.id,
        rootTaskId,
        title: run.task.title,
        brief: run.task.brief,
        priority: run.task.priority,
        tags: run.task.tags,
        parentTaskId: run.task.parentTaskId,
        gameId: run.task.gameId,
        metadata,
      },
      agent: {
        id: run.agent.id,
        key: run.agent.key,
        displayName: run.agent.name,
        systemPrompt: run.agent.systemPrompt,
        tools: Array.from(
          new Set<AgentTool>([
            ...run.agent.tools,
            ...(AGENT_BY_KEY[run.agent.key]?.defaultTools ?? []),
            ...extraTools,
          ]),
        ),
        modelId: effectiveModelId,
        temperature: run.temperature ?? run.agent.temperature,
        maxOutputTokens: Math.max(
          16384,
          run.maxOutputTokens ?? run.agent.maxOutputTokens ?? 16384,
        ),
        imageConnectionId: run.agent.imageConnectionId,
        imageModelId: run.agent.imageModelId,
      },
      game: run.task.game
        ? {
            id: run.task.game.id,
            name: run.task.game.name,
            genre: run.task.game.genre,
            status: run.task.game.status,
            latestSavedVersion: run.task.game.latestSavedVersion,
            latestPublishedVersion: run.task.game.latestPublishedVersion,
          }
        : null,
      connection,
      pricing: {
        inputCostPerMTok: rawConnection.inputCostPerMTok ?? null,
        outputCostPerMTok: rawConnection.outputCostPerMTok ?? null,
      },
      budgets: {
        dailyTokenBudget: run.studio.dailyTokenBudget ?? null,
        dailyCostBudgetUsd: run.studio.dailyCostBudgetUsd ?? null,
        perTaskTokenBudget: run.studio.perTaskTokenBudget ?? null,
      },
    };
  }

  /**
   * Pre-Finish Quality & Persistence Gate:
   * 1. Verifies that every Luau artifact saved/edited in this run passes `analyzeLuauCode` with 0 errors.
   * 2. Verifies that if a coding specialist wrote a multi-line ```luau block in its reply without calling
   *    `save_artifact` or `edit_workspace_file`, it persists the code before finishing.
   */
  private async evaluatePreFinishQualityGate(
    ctx: LoadedRunContext,
    lastAssistantText: string,
  ): Promise<string | null> {
    const runArtifacts = await this.prisma.runArtifact
      ?.findMany?.({
        where: { runId: ctx.run.id },
        orderBy: { createdAt: 'desc' },
      })
      .catch(() => []);

    const latestByPath = new Map<string, NonNullable<typeof runArtifacts>[number]>();
    for (const art of runArtifacts ?? []) {
      if (!latestByPath.has(art.path)) {
        latestByPath.set(art.path, art);
      }
    }

    const errorBullets: string[] = [];
    for (const art of latestByPath.values()) {
      if (
        art.language === 'luau' ||
        art.language === 'lua' ||
        /\.(?:luau|lua)$/i.test(art.path)
      ) {
        const diag = analyzeLuauCode(art.content, art.path);
        const errs = diag.issues.filter((i) => i.severity === 'error');
        for (const e of errs) {
          errorBullets.push(
            `- \`${art.path}\`${e.line ? ` (line ${e.line})` : ''}: ${e.message}`,
          );
        }
      }
    }

    if (errorBullets.length > 0) {
      return [
        '[SYSTEM QUALITY GATE — FIX REQUIRED]',
        'The following Luau artifact(s) saved in this run still have syntax, block-balance, or boundary errors:',
        ...errorBullets,
        '',
        'Call `edit_workspace_file` or `save_artifact` now to fix these errors before completing the task.',
      ].join('\n');
    }

    // Check if the agent wrote a non-trivial ```luau block in its markdown reply without persisting any artifact
    if (
      latestByPath.size === 0 &&
      ctx.agent.key !== 'lead' &&
      ctx.agent.tools.includes('save_artifact')
    ) {
      const fencedMatch = /```(?:luau|lua)\s*\n([\s\S]*?)```/i.exec(
        lastAssistantText,
      );
      const codeLines = fencedMatch?.[1]?.trim().split(/\r?\n/) ?? [];
      if (codeLines.length >= 6) {
        return [
          '[SYSTEM QUALITY GATE — PERSISTENCE REQUIRED]',
          'You wrote Luau code in your response, but you did not call `save_artifact` or `edit_workspace_file` to persist it to the workspace.',
          'Call `save_artifact` (or `edit_workspace_file`) now for each script so it is saved to disk / Roblox Studio, then provide your concise "## Result" summary.',
        ].join('\n');
      }
    }

    return null;
  }

  private async addUsage(
    runId: string,
    inputTokens: number,
    outputTokens: number,
    pricing?: CostPricing,
  ): Promise<void> {
    const costDelta = calculateRunCostUsd(inputTokens, outputTokens, pricing);
    await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        inputTokens: { increment: inputTokens },
        outputTokens: { increment: outputTokens },
        ...(costDelta > 0 ? { costUsd: { increment: costDelta } } : {}),
      },
    });
  }

  private classifyFailure(
    err: unknown,
    abortReason: RunAbortReason | null,
  ): RunOutcome {
    if (abortReason === 'PAUSED') {
      return { kind: 'interrupted' };
    }
    if (abortReason === 'CANCELLED') {
      return { kind: 'cancelled' };
    }
    if (abortReason === 'TIMEOUT') {
      return {
        kind: 'failed',
        code: 'RUN_TIMEOUT',
        message: 'Agent run timed out',
      };
    }
    if (err instanceof LlmError) {
      return {
        kind: 'failed',
        code: err.code,
        message: err.message,
      };
    }
    return {
      kind: 'failed',
      code: 'INTERNAL',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  private async finish(runId: string, outcome: RunOutcome): Promise<void> {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      include: {
        agent: { select: { id: true, key: true, studioId: true } },
        task: { select: { id: true, title: true, gameId: true, metadata: true } },
      },
    });

    this.registry.unregister(runId);
    if (!run) return;

    const studioId = run.studioId;
    await this.lanes.releaseByRun(studioId, runId);

    const now = new Date();
    let runStatus: RunStatus;
    let taskStatus: TaskStatus;
    let summaryText: string | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;

    switch (outcome.kind) {
      case 'succeeded':
        runStatus = 'SUCCEEDED';
        taskStatus = 'DONE';
        summaryText = outcome.summary ? outcome.summary.slice(0, 600) : 'Completed';
        break;
      case 'awaiting-human':
        runStatus = 'AWAITING_HUMAN';
        taskStatus = 'NEEDS_HUMAN';
        break;
      case 'interrupted':
        runStatus = 'INTERRUPTED';
        taskStatus = 'PAUSED';
        errorMessage = 'Paused by operator';
        break;
      case 'cancelled':
        runStatus = 'CANCELLED';
        taskStatus = 'CANCELLED';
        break;
      case 'failed':
        runStatus = 'FAILED';
        taskStatus = 'FAILED';
        errorCode = outcome.code;
        errorMessage = outcome.message;
        break;
    }

    const lastSnippetSource = summaryText ?? errorMessage ?? run.task.title;
    const lastSnippet = lastSnippetSource.replace(/\s+/g, ' ').trim().slice(-140);

    const updatedRun = await this.prisma.agentRun.update({
      where: { id: runId },
      data: {
        status: runStatus,
        finishedAt: now,
        summary: summaryText,
        errorCode,
        errorMessage,
      },
      include: {
        agent: { select: { key: true } },
        task: { select: { title: true } },
      },
    });

    await this.prisma.task.update({
      where: { id: run.taskId },
      data: {
        status: taskStatus,
        ...(taskStatus === 'DONE'
          ? { resultSummary: summaryText, completedAt: now }
          : {}),
        ...(taskStatus === 'FAILED' ? { resultSummary: errorMessage } : {}),
      },
    });

    await this.prisma.agent.update({
      where: { id: run.agentId },
      data: {
        currentTaskId: null,
        currentRunId: null,
        lastActivityAt: now,
        lastSnippet,
        ...(errorCode === 'PROVIDER_AUTH_FAILED'
          ? { lastErrorCode: 'PROVIDER_AUTH_FAILED' }
          : {}),
      },
    });

    if (taskStatus === 'DONE') {
      await this.tasks.propagateDependencyCompletion(studioId, run.taskId);
      await this.builds.onTaskFinished(studioId, run.task, runId, true);
    } else if (taskStatus === 'FAILED' || taskStatus === 'CANCELLED') {
      await this.tasks.propagateDependencyFailure(studioId, run.taskId);
      if (taskStatus === 'FAILED') {
        await this.builds.onTaskFinished(studioId, run.task, runId, false);
      }
    }

    await this.agentStatus.recompute(run.agentId);

    const runSummaryDto: AgentRunSummaryDto =
      this.tasks.toRunSummaryDto(updatedRun);
    const taskDto = await this.tasks.getById(studioId, run.taskId);

    this.realtime.emitToStudio(studioId, 'run:finished', {
      run: runSummaryDto,
      live: null,
    });
    this.realtime.emitToStudio(studioId, 'task:updated', {
      task: taskDto,
      change: 'updated',
    });
    this.realtime.broadcastCounts(studioId);
    this.tasks.notifyTaskQueued(studioId);
    await this.tasks
      .checkAndEmitCompletedRootTaskOutput?.(studioId, run.taskId)
      .catch(() => {});
  }

  private async emitRunStarted(ctx: LoadedRunContext): Promise<void> {
    const runRow = await this.prisma.agentRun.findUnique({
      where: { id: ctx.run.id },
      include: {
        agent: { select: { key: true } },
        task: { select: { title: true } },
      },
    });
    if (!runRow) return;

    const runSummary: AgentRunSummaryDto = this.tasks.toRunSummaryDto(runRow);
    const live: LiveRunDto = {
      runId: ctx.run.id,
      taskId: ctx.task.id,
      taskTitle: ctx.task.title,
      agentKey: ctx.agent.key,
      gameId: ctx.task.gameId,
      startedAt: ctx.run.startedAt.toISOString(),
      lastSnippet: ctx.task.title,
      laneName: null,
    };

    this.realtime.emitToStudio(ctx.studioId, 'run:started', {
      run: runSummary,
      live,
    });
  }
}
