import { Injectable, Optional } from '@nestjs/common';
import type {
  AgentTool,
  SandboxAccessPolicy,
  SandboxProviderKind,
  ToolArgsOf,
} from '@robdev/shared';
import { RealtimeService } from '../../realtime/realtime.service.js';
import { decryptStudioOpenCloudKey } from '../../studios/studios.service.js';
import { PcDesktopAutomationService } from './pc-desktop-automation.service.js';
import { executeShellCommand } from './terminal-and-permissions.helper.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

export async function getStudioPcAndRobloxConfig(
  ctx: Pick<ToolContext, 'studioId' | 'prisma'>,
): Promise<{
  studioSlug: string;
  allowPcControlWithoutPermission: boolean;
  pcIdleTakeoverSeconds: number;
  sandboxAccessPolicy: SandboxAccessPolicy;
  sandboxProviderKind: SandboxProviderKind;
  maxConcurrentSandboxes: number;
  allowAutoSaveVersion: boolean;
  allowAutoPublish: boolean;
  robloxUniverseId: string | null;
  robloxPlaceId: string | null;
  openCloudApiKey: string | null;
}> {
  const studio = await ctx.prisma.studio
    ?.findUnique?.({
      where: { id: ctx.studioId },
      select: {
        slug: true,
        allowPcControlWithoutPermission: true,
        pcIdleTakeoverSeconds: true,
        sandboxAccessPolicy: true,
        sandboxProviderKind: true,
        maxConcurrentSandboxes: true,
        allowAutoSaveVersion: true,
        allowAutoPublish: true,
        robloxUniverseId: true,
        robloxPlaceId: true,
        openCloudApiKey: true,
        openCloudApiKeyCiphertext: true,
        openCloudApiKeyIv: true,
        openCloudApiKeyTag: true,
      },
    })
    .catch(() => null);

  return {
    studioSlug: studio?.slug ?? 'default',
    allowPcControlWithoutPermission:
      studio?.allowPcControlWithoutPermission ?? false,
    pcIdleTakeoverSeconds: studio?.pcIdleTakeoverSeconds ?? 60,
    sandboxAccessPolicy:
      studio?.sandboxAccessPolicy === 'ASK' ||
      studio?.sandboxAccessPolicy === 'DENY'
        ? studio.sandboxAccessPolicy
        : 'ALLOW',
    sandboxProviderKind:
      studio?.sandboxProviderKind === 'CLOUD_GPU' ? 'CLOUD_GPU' : 'LOCAL',
    maxConcurrentSandboxes: studio?.maxConcurrentSandboxes ?? 15,
    allowAutoSaveVersion: studio?.allowAutoSaveVersion ?? true,
    allowAutoPublish: studio?.allowAutoPublish ?? true,
    robloxUniverseId: studio?.robloxUniverseId ?? null,
    robloxPlaceId: studio?.robloxPlaceId ?? null,
    openCloudApiKey: decryptStudioOpenCloudKey(studio),
  };
}

export async function requestMainPcPermissionPrompt(params: {
  ctx: ToolContext;
  realtime?: RealtimeService;
  actionSummary: string;
  idleSeconds: number;
  thresholdSeconds: number;
}): Promise<ToolResult> {
  const { ctx, realtime, actionSummary, idleSeconds, thresholdSeconds } = params;
  const priority = ctx.agent.key;
  const title = `Permission Required: Control Main PC Mouse & Keyboard`;
  const body = [
    `**${ctx.userFacingAgentName}** (\`${priority}\`) is requesting permission to control your **Main PC** because you are currently active (idle ${Math.round(idleSeconds)}s < ${thresholdSeconds}s threshold):`,
    `- **Requested Action**: ${actionSummary}`,
    `- **Stop Hotkey**: Press \`Ctrl + Shift + Delete\` (or move the mouse to top-left \`(0,0)\`) at any time to immediately halt PC control.`,
    '',
    'Approve to allow this agent to control the Main PC for this task, or deny so it uses its isolated Sandbox instead.',
  ].join('\n');

  const options = [
    {
      id: 'approve',
      label: 'Approve Main PC Control',
      description: 'Allow controlling the Main PC mouse & keyboard for this task',
    },
    {
      id: 'deny',
      label: 'Deny (Use Sandbox Instead)',
      description: 'Keep agent inside its isolated Sandbox',
    },
  ];

  const reqRow = await ctx.prisma.humanRequest
    ?.create?.({
      data: {
        studioId: ctx.studioId,
        gameId: ctx.game?.id ?? null,
        taskId: ctx.task.id,
        agentId: ctx.agent.id,
        kind: 'DECISION',
        status: 'OPEN',
        title,
        body,
        options: options as object,
      },
    })
    .catch(() => null);

  const requestId = reqRow?.id ?? `perm_pc_${Date.now()}`;

  const currentMeta =
    typeof ctx.task.metadata === 'object' && ctx.task.metadata !== null
      ? { ...(ctx.task.metadata as Record<string, unknown>) }
      : {};
  const approvedList = Array.isArray(currentMeta['approvedTerminalCommands'])
    ? [...(currentMeta['approvedTerminalCommands'] as string[])]
    : [];
  // Pre-seed a pending permission entry so approving the HumanRequest unlocks MAIN_PC_CONTROL
  const pendingMap =
    typeof currentMeta['pendingPermissions'] === 'object' &&
    currentMeta['pendingPermissions'] !== null
      ? { ...(currentMeta['pendingPermissions'] as Record<string, unknown>) }
      : {};

  pendingMap[requestId] = {
    requestId,
    type: 'TERMINAL_COMMAND',
    status: 'PENDING',
    shell: 'powershell',
    command: 'Write-Output "MAIN_PC_CONTROL_APPROVED"',
    cwd: process.cwd(),
    timeoutMs: 5000,
    reason: actionSummary,
    runId: ctx.run.id,
    agentId: ctx.agent.id,
    agentKey: ctx.agent.key,
    createdAt: new Date().toISOString(),
  };
  currentMeta['pendingPermissions'] = pendingMap;
  currentMeta['approvedMainPcControlOnResolve'] = true;
  currentMeta['approvedTerminalCommands'] = approvedList;
  ctx.task.metadata = currentMeta;

  await ctx.prisma.task
    ?.update?.({
      where: { id: ctx.task.id },
      data: { status: 'NEEDS_HUMAN', metadata: currentMeta as object },
    })
    .catch(() => null);

  await ctx.prisma.agentMessage
    ?.create?.({
      data: {
        studioId: ctx.studioId,
        agentId: ctx.agent.id,
        taskId: ctx.task.id,
        author: 'AGENT',
        body: `**[PERMISSION REQUIRED: MAIN PC CONTROL]**\n${body}`,
      },
    })
    .catch(() => null);

  if (realtime && reqRow) {
    realtime.emitToStudio(ctx.studioId, 'human-request:updated', {
      request: {
        id: reqRow.id,
        kind: reqRow.kind,
        status: reqRow.status,
        title: reqRow.title,
        body: reqRow.body,
        gameId: reqRow.gameId,
        agentKey: ctx.agent.key,
        taskId: reqRow.taskId,
        options: options.map((o) => ({ id: o.id, label: o.label })),
        pitchIds: [],
        buildVersion: null,
        resolution: null,
        createdAt: reqRow.createdAt.toISOString(),
        resolvedAt: null,
      },
      change: 'created',
    });
    realtime.broadcastCounts(ctx.studioId);
  }

  return {
    payload: {
      ok: false,
      status: 'AWAITING_MAIN_PC_PERMISSION',
      requestId,
      idleSeconds,
      thresholdSeconds,
      message:
        'Operator is actively using the PC (idle < 60s). Paused run to request permission to control Main PC mouse/keyboard (or use `targetEnv: "SANDBOX"` / `pc_sandbox` to work in your isolated sandbox without waiting).',
    },
    control: 'await-human',
  };
}

export async function logObservationScreenshot(
  ctx: ToolContext,
  toolName: AgentTool,
  obs: {
    targetEnv: 'MAIN_PC' | 'SANDBOX';
    windowTitle: string;
    width: number;
    height: number;
    elements: unknown[];
    openWindows?: unknown[];
    idleSeconds?: number;
    mediaId?: string;
    screenshotPath: string;
  },
  realtime?: RealtimeService,
): Promise<void> {
  const openWinSuffix =
    Array.isArray(obs.openWindows) && obs.openWindows.length > 0
      ? `, ${obs.openWindows.length} open windows`
      : '';
  const idleSuffix =
    typeof obs.idleSeconds === 'number' ? `, idle ${obs.idleSeconds}s` : '';
  await ctx.log.entry(
    'SYSTEM',
    `Observed ${obs.targetEnv === 'SANDBOX' ? 'Sandbox' : 'Main PC'} window "${obs.windowTitle}" (${obs.width}×${obs.height}, ${obs.elements.length} interactive elements${openWinSuffix}${idleSuffix})`,
    {
      tool: toolName,
      ...(obs.mediaId
        ? {
            createdArtifact: {
              kind: 'image',
              id: obs.mediaId,
              mediaId: obs.mediaId,
              title: `Screenshot: ${obs.windowTitle} (${obs.width}×${obs.height})`,
              path: obs.screenshotPath,
            },
          }
        : {}),
    },
  );
  if (realtime && (obs.mediaId || obs.screenshotPath)) {
    const mediaUrl = obs.mediaId
      ? `/api/media/${obs.mediaId}`
      : `/api/media/by-path?path=${encodeURIComponent(obs.screenshotPath)}`;
    realtime.emitAgentScreen(ctx.studioId, {
      studioId: ctx.studioId,
      agentKey: ctx.agent.key,
      runId: ctx.run.id,
      taskTitle: ctx.task.title,
      mediaId: obs.mediaId ?? null,
      mediaUrl,
      source: obs.targetEnv,
      windowTitle: obs.windowTitle,
      capturedAt: new Date().toISOString(),
    });
  }
}

@Injectable()
export class PcObserveTool implements ToolHandler<'pc_observe'> {
  readonly name = 'pc_observe' as const;

  constructor(
    private readonly pc: PcDesktopAutomationService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  async execute(
    args: ToolArgsOf<'pc_observe'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cfg = await getStudioPcAndRobloxConfig(ctx);
    const effectiveTargetEnv =
      ctx.task.metadata?.['pcTargetEnvLock'] === 'SANDBOX'
        ? 'SANDBOX'
        : args.targetEnv;

    if (effectiveTargetEnv === 'SANDBOX') {
      if (cfg.sandboxAccessPolicy === 'DENY') {
        return {
          payload: {
            ok: false,
            error: 'SANDBOX_DENIED',
            message: 'Sandbox access is disabled in Studio Settings.',
          },
        };
      }
      const obs = await this.pc.observeSandbox({
        studioId: ctx.studioId,
        studioSlug: cfg.studioSlug,
        agentKey: ctx.agent.key,
        prisma: ctx.prisma,
      });

      await logObservationScreenshot(ctx, this.name, obs, this.realtime);

      return {
        payload: {
          ok: true,
          targetEnv: 'SANDBOX',
          agentKey: ctx.agent.key,
          priority: this.pc.getAgentPriority(ctx.agent.key),
          windowTitle: obs.windowTitle,
          width: obs.width,
          height: obs.height,
          elementCount: obs.elements.length,
          elements: obs.elements,
          ocrText: obs.ocrText,
          screenshotPath: obs.screenshotPath,
          ...(obs.mediaId ? { mediaId: obs.mediaId } : {}),
        },
        ...(obs.image ? { images: [obs.image] } : {}),
      };
    }

    const obs = await this.pc.observeMainPc({
      studioId: ctx.studioId,
      studioSlug: cfg.studioSlug,
      prisma: ctx.prisma,
      target: args.target,
      annotate: args.annotate,
      maxElements: args.maxElements,
    });

    await logObservationScreenshot(ctx, this.name, obs, this.realtime);

    return {
      payload: {
        ok: obs.ok,
        targetEnv: 'MAIN_PC',
        agentKey: ctx.agent.key,
        priority: this.pc.getAgentPriority(ctx.agent.key),
        windowTitle: obs.windowTitle,
        originX: obs.originX,
        originY: obs.originY,
        width: obs.width,
        height: obs.height,
        cursorX: obs.cursorX,
        cursorY: obs.cursorY,
        idleSeconds: obs.idleSeconds,
        ctrlShiftDeletePressed: obs.ctrlShiftDeletePressed,
        openWindowCount: (obs.openWindows ?? []).length,
        openWindows: obs.openWindows ?? [],
        elementCount: obs.elements.length,
        elements: obs.elements,
        ocrText: obs.ocrText,
        screenshotPath: obs.screenshotPath,
        ...(obs.mediaId ? { mediaId: obs.mediaId } : {}),
      },
      ...(obs.image ? { images: [obs.image] } : {}),
    };
  }
}

@Injectable()
export class PcActTool implements ToolHandler<'pc_act'> {
  readonly name = 'pc_act' as const;

  constructor(
    private readonly pc: PcDesktopAutomationService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  async execute(
    args: ToolArgsOf<'pc_act'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cfg = await getStudioPcAndRobloxConfig(ctx);
    const effectiveTargetEnv =
      ctx.task.metadata?.['pcTargetEnvLock'] === 'SANDBOX'
        ? 'SANDBOX'
        : args.targetEnv;

    if (effectiveTargetEnv === 'SANDBOX') {
      if (cfg.sandboxAccessPolicy === 'DENY') {
        return {
          payload: {
            ok: false,
            error: 'SANDBOX_DENIED',
            message: 'Sandbox access is disabled in Studio Settings.',
          },
        };
      }
      const sbRes = await this.pc.executeSandboxSteps({
        studioId: ctx.studioId,
        studioSlug: cfg.studioSlug,
        agentKey: ctx.agent.key,
        prisma: ctx.prisma,
        steps: args.steps,
        observeAfter: args.observeAfter,
      });

      if (sbRes.observation) {
        await logObservationScreenshot(
          ctx,
          this.name,
          sbRes.observation,
          this.realtime,
        );
      }

      return {
        payload: {
          ok: sbRes.ok,
          targetEnv: 'SANDBOX',
          agentKey: ctx.agent.key,
          priority: this.pc.getAgentPriority(ctx.agent.key),
          completedSteps: sbRes.completedSteps,
          ...(sbRes.observation
            ? {
                windowTitle: sbRes.observation.windowTitle,
                elements: sbRes.observation.elements,
                ocrText: sbRes.observation.ocrText,
                screenshotPath: sbRes.observation.screenshotPath,
                mediaId: sbRes.observation.mediaId,
              }
            : {}),
        },
        ...(sbRes.observation?.image
          ? { images: [sbRes.observation.image] }
          : {}),
      };
    }

    // Evaluate Main PC access (Settings override, Task approval, or >= 60s Idle Auto-Takeover until Ctrl+Shift+Delete)
    const access = await this.pc.evaluateMainPcAccess({
      allowPcControlWithoutPermission: cfg.allowPcControlWithoutPermission,
      pcIdleTakeoverSeconds: cfg.pcIdleTakeoverSeconds,
      taskMetadata: ctx.task.metadata,
    });

    if (access.mode === 'BLOCKED_BY_HOTKEY') {
      return {
        payload: {
          ok: false,
          error: 'STOPPED_BY_CTRL_SHIFT_DELETE',
          message: access.reason,
        },
      };
    }

    if (!access.allowed) {
      const stepSummary = args.steps
        .map((s) => s.type)
        .join(' -> ');
      return requestMainPcPermissionPrompt({
        ctx,
        realtime: this.realtime,
        actionSummary: `${args.reason || `Execute ${args.steps.length} PC step(s): ${stepSummary}`}`,
        idleSeconds: access.idleSeconds,
        thresholdSeconds: cfg.pcIdleTakeoverSeconds,
      });
    }

    // Check 15-agent priority hierarchy lock on Main PC
    const lock = this.pc.acquireOrPreemptMainPcLock({
      agentKey: ctx.agent.key,
      runId: ctx.run.id,
      mode: access.mode as
        | 'PERMISSION_GRANTED'
        | 'AUTO_IDLE_TAKEOVER'
        | 'SETTINGS_AUTO_ALLOWED',
    });

    if (!lock.acquired) {
      // Automatically route lower-priority agent to its isolated Sandbox so it can keep working!
      await ctx.log.entry(
        'SYSTEM',
        `Main PC is currently held by higher-priority agent ${lock.heldByAgent} (priority ${lock.heldByPriority} > ${lock.requesterPriority}). Executing inside ${ctx.agent.key}'s isolated Sandbox instead.`,
      );
      const sbFallback = await this.pc.executeSandboxSteps({
        studioId: ctx.studioId,
        studioSlug: cfg.studioSlug,
        agentKey: ctx.agent.key,
        prisma: ctx.prisma,
        steps: args.steps,
        observeAfter: args.observeAfter,
      });
      return {
        payload: {
          ok: sbFallback.ok,
          targetEnv: 'SANDBOX',
          routedToSandboxByPriority: true,
          mainPcHeldBy: lock.heldByAgent,
          mainPcHeldByPriority: lock.heldByPriority,
          agentPriority: lock.requesterPriority,
          completedSteps: sbFallback.completedSteps,
        },
        ...(sbFallback.observation?.image
          ? { images: [sbFallback.observation.image] }
          : {}),
      };
    }

    if (access.mode === 'AUTO_IDLE_TAKEOVER') {
      await ctx.log.entry(
        'SYSTEM',
        `User idle for ${Math.round(access.idleSeconds)}s (>= ${cfg.pcIdleTakeoverSeconds}s) — ${ctx.userFacingAgentName} (priority ${lock.requesterPriority}) automatically controlling Main PC until Ctrl + Shift + Delete is pressed.`,
      );
    }

    const actRes = await this.pc.executeMainPcSteps({
      studioId: ctx.studioId,
      studioSlug: cfg.studioSlug,
      prisma: ctx.prisma,
      window: args.window,
      steps: args.steps,
      observeAfter: args.observeAfter,
      settleMs: args.settleMs,
    });

    const obs = actRes.observation;
    if (obs) {
      await logObservationScreenshot(ctx, this.name, obs, this.realtime);
    }

    return {
      payload: {
        ok: actRes.ok,
        targetEnv: 'MAIN_PC',
        accessMode: access.mode,
        agentKey: ctx.agent.key,
        priority: lock.requesterPriority,
        ...(lock.preemptedAgent ? { preemptedLowerPriorityAgent: lock.preemptedAgent } : {}),
        completedSteps: actRes.completedSteps,
        ...(actRes.stoppedByHotkey ? { stoppedByHotkey: 'Ctrl+Shift+Delete' } : {}),
        ...(actRes.failedStep ? { failedStep: actRes.failedStep } : {}),
        ...(obs
          ? {
              windowTitle: obs.windowTitle,
              cursorX: obs.cursorX,
              cursorY: obs.cursorY,
              elementCount: obs.elements.length,
              elements: obs.elements,
              ocrText: obs.ocrText,
              screenshotPath: obs.screenshotPath,
              mediaId: obs.mediaId,
            }
          : {}),
      },
      ...(obs?.image ? { images: [obs.image] } : {}),
    };
  }
}

@Injectable()
export class PcWindowTool implements ToolHandler<'pc_window'> {
  readonly name = 'pc_window' as const;

  constructor(
    private readonly pc: PcDesktopAutomationService,
    @Optional() private readonly realtime?: RealtimeService,
  ) {}

  async execute(
    args: ToolArgsOf<'pc_window'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    if (args.action === 'list') {
      const res = await this.pc.controlWindow({ action: 'list' });
      return {
        payload: {
          ok: true,
          action: 'list',
          windows: res.windows ?? [],
          message: res.message,
        },
      };
    }

    const cfg = await getStudioPcAndRobloxConfig(ctx);
    const access = await this.pc.evaluateMainPcAccess({
      allowPcControlWithoutPermission: cfg.allowPcControlWithoutPermission,
      pcIdleTakeoverSeconds: cfg.pcIdleTakeoverSeconds,
      taskMetadata: ctx.task.metadata,
    });

    if (access.mode === 'BLOCKED_BY_HOTKEY') {
      return {
        payload: {
          ok: false,
          error: 'STOPPED_BY_CTRL_SHIFT_DELETE',
          message: access.reason,
        },
      };
    }

    if (!access.allowed) {
      return requestMainPcPermissionPrompt({
        ctx,
        realtime: this.realtime,
        actionSummary: `${args.action} window "${args.match ?? ''}"`,
        idleSeconds: access.idleSeconds,
        thresholdSeconds: cfg.pcIdleTakeoverSeconds,
      });
    }

    const res = await this.pc.controlWindow({
      action: args.action,
      match: args.match,
      args: args.args,
    });

    return {
      payload: {
        ok: res.ok,
        action: res.action,
        matchedWindow: res.matchedWindow ?? null,
        message: res.message,
      },
    };
  }
}

@Injectable()
export class PcSandboxTool implements ToolHandler<'pc_sandbox'> {
  readonly name = 'pc_sandbox' as const;

  constructor(private readonly pc: PcDesktopAutomationService) {}

  async execute(
    args: ToolArgsOf<'pc_sandbox'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const cfg = await getStudioPcAndRobloxConfig(ctx);

    if (cfg.sandboxAccessPolicy === 'DENY') {
      return {
        payload: {
          ok: false,
          error: 'SANDBOX_DENIED',
          message: 'Agent Sandboxes are disabled in Studio Settings.',
        },
      };
    }

    if (args.action === 'list_all') {
      const list = this.pc.listStudioSandboxes(ctx.studioId);
      return {
        payload: {
          ok: true,
          maxConcurrentSandboxes: cfg.maxConcurrentSandboxes,
          activeCount: list.length,
          sandboxes: list,
        },
      };
    }

    if (args.action === 'destroy') {
      const destroyed = await this.pc.destroyAgentSandbox(
        ctx.studioId,
        ctx.agent.key,
      );
      return {
        payload: {
          ok: true,
          destroyed,
          agentKey: ctx.agent.key,
        },
      };
    }

    const sb = await this.pc.ensureAgentSandbox({
      studioId: ctx.studioId,
      studioSlug: cfg.studioSlug,
      agentKey: ctx.agent.key,
      provider: args.provider ?? cfg.sandboxProviderKind,
      cloudEndpoint: args.cloudEndpoint,
      maxConcurrent: cfg.maxConcurrentSandboxes,
    });

    if (args.action === 'status' || args.action === 'ensure') {
      return {
        payload: {
          ok: true,
          agentKey: sb.agentKey,
          priority: this.pc.getAgentPriority(sb.agentKey),
          provider: sb.provider,
          workspaceDir: sb.workspaceDir,
          status: sb.status,
          currentUrl: sb.currentUrl,
          cloudEndpoint: sb.cloudEndpoint,
          maxConcurrentSandboxes: cfg.maxConcurrentSandboxes,
          activeStudioSandboxes: this.pc.listStudioSandboxes(ctx.studioId).length,
        },
      };
    }

    if (args.action === 'navigate' && args.url) {
      if (sb.page) {
        await sb.page
          .goto(args.url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
          .catch(() => {});
        sb.currentUrl = sb.page.url();
      }
      const obs = await this.pc.observeSandbox({
        studioId: ctx.studioId,
        studioSlug: cfg.studioSlug,
        agentKey: ctx.agent.key,
        prisma: ctx.prisma,
      });
      await logObservationScreenshot(ctx, this.name, obs);
      return {
        payload: {
          ok: true,
          action: 'navigate',
          url: sb.currentUrl,
          windowTitle: obs.windowTitle,
          elements: obs.elements,
          screenshotPath: obs.screenshotPath,
          mediaId: obs.mediaId,
        },
        ...(obs.image ? { images: [obs.image] } : {}),
      };
    }

    if (args.action === 'exec' && args.command) {
      const execRes = await executeShellCommand({
        command: args.command,
        shell: 'powershell',
        cwd: sb.workspaceDir,
        timeoutMs: 30_000,
        signal: ctx.signal,
      });
      return {
        payload: {
          ok: execRes.ok,
          action: 'exec',
          sandboxWorkspaceDir: sb.workspaceDir,
          exitCode: execRes.exitCode,
          stdout: execRes.stdout,
          stderr: execRes.stderr,
          durationMs: execRes.durationMs,
        },
      };
    }

    if (args.action === 'click') {
      const stepRes = await this.pc.executeSandboxSteps({
        studioId: ctx.studioId,
        studioSlug: cfg.studioSlug,
        agentKey: ctx.agent.key,
        prisma: ctx.prisma,
        steps: [
          {
            type: 'click',
            target: {
              x: args.x,
              y: args.y,
              text: args.selectorOrText,
              space: 'screenshot',
            },
          },
        ],
        observeAfter: true,
      });
      if (stepRes.observation) {
        await logObservationScreenshot(ctx, this.name, stepRes.observation);
      }
      return {
        payload: {
          ok: stepRes.ok,
          action: 'click',
          completedSteps: stepRes.completedSteps,
          screenshotPath: stepRes.observation?.screenshotPath,
          mediaId: stepRes.observation?.mediaId,
        },
        ...(stepRes.observation?.image
          ? { images: [stepRes.observation.image] }
          : {}),
      };
    }

    if (args.action === 'type' && args.text) {
      const stepRes = await this.pc.executeSandboxSteps({
        studioId: ctx.studioId,
        studioSlug: cfg.studioSlug,
        agentKey: ctx.agent.key,
        prisma: ctx.prisma,
        steps: [{ type: 'type', text: args.text }],
        observeAfter: true,
      });
      if (stepRes.observation) {
        await logObservationScreenshot(ctx, this.name, stepRes.observation);
      }
      return {
        payload: {
          ok: stepRes.ok,
          action: 'type',
          completedSteps: stepRes.completedSteps,
          screenshotPath: stepRes.observation?.screenshotPath,
          mediaId: stepRes.observation?.mediaId,
        },
        ...(stepRes.observation?.image
          ? { images: [stepRes.observation.image] }
          : {}),
      };
    }

    const obs = await this.pc.observeSandbox({
      studioId: ctx.studioId,
      studioSlug: cfg.studioSlug,
      agentKey: ctx.agent.key,
      prisma: ctx.prisma,
    });
    await logObservationScreenshot(ctx, this.name, obs);
    return {
      payload: {
        ok: true,
        action: 'screenshot',
        agentKey: ctx.agent.key,
        windowTitle: obs.windowTitle,
        elements: obs.elements,
        screenshotPath: obs.screenshotPath,
        mediaId: obs.mediaId,
      },
      ...(obs.image ? { images: [obs.image] } : {}),
    };
  }
}
