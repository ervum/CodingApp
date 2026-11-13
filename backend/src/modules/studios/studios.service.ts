import { HttpStatus, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import type {
  CodingMode,
  CodingSyncTool,
  ContextMode,
  CreateStudioRequest,
  SandboxAccessPolicy,
  SandboxProviderKind,
  StudioDto,
  StudioSummaryDto,
  UpdateStudioRequest,
} from '@robdev/shared';
import {
  createSecretBox,
  SecretBoxService,
} from '../../common/crypto/secret-box.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentStatusService } from '../agents/agent-status.service.js';
import { GoogleWebBrowserAdapter } from '../llm/adapters/google-web.adapter.js';
import { RunRegistryService } from '../orchestrator/run-registry.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { provisionStudio } from './provision-studio.js';

export function decryptStudioOpenCloudKey(
  studio: {
    openCloudApiKey?: string | null;
    openCloudApiKeyCiphertext?: string | null;
    openCloudApiKeyIv?: string | null;
    openCloudApiKeyTag?: string | null;
  } | null | undefined,
  secretBox?: SecretBoxService,
): string | null {
  if (!studio) return null;
  if (
    studio.openCloudApiKeyCiphertext &&
    studio.openCloudApiKeyIv &&
    studio.openCloudApiKeyTag
  ) {
    try {
      const box =
        secretBox ??
        (process.env['SECRETS_MASTER_KEY']
          ? createSecretBox(process.env['SECRETS_MASTER_KEY'])
          : null);
      if (box) {
        return box.open({
          ciphertext: studio.openCloudApiKeyCiphertext,
          iv: studio.openCloudApiKeyIv,
          tag: studio.openCloudApiKeyTag,
        });
      }
    } catch {
      return null;
    }
  }
  return studio.openCloudApiKey ?? null;
}

@Injectable()
export class StudiosService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentStatus: AgentStatusService,
    private readonly registry: RunRegistryService,
    private readonly tasks: TasksService,
    private readonly realtime: RealtimeService,
    private readonly googleWeb: GoogleWebBrowserAdapter,
    @Optional() private readonly secretBox?: SecretBoxService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.secretBox) return;
    const legacyRows = await this.prisma.studio
      .findMany({
        where: {
          openCloudApiKey: { not: null },
        },
        select: {
          id: true,
          openCloudApiKey: true,
        },
      })
      .catch(() => []);

    for (const row of legacyRows) {
      const raw = row.openCloudApiKey?.trim();
      if (!raw) continue;
      const sealed = this.secretBox.seal(raw);
      await this.prisma.studio
        .update({
          where: { id: row.id },
          data: {
            openCloudApiKey: null,
            openCloudApiKeyCiphertext: sealed.ciphertext,
            openCloudApiKeyIv: sealed.iv,
            openCloudApiKeyTag: sealed.tag,
            openCloudApiKeyLast4: raw.slice(-4),
          },
        })
        .catch(() => {});
    }
  }

  async listForUser(userId: string): Promise<StudioSummaryDto[]> {
    const memberships = await this.prisma.studioMembership.findMany({
      where: { userId },
      include: { studio: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((m) => ({
      ...this.toDto(m.studio),
      role: m.role,
    }));
  }

  async create(
    userId: string,
    body: CreateStudioRequest,
  ): Promise<StudioSummaryDto> {
    const existing = await this.prisma.studio.findUnique({
      where: { slug: body.slug },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `Studio slug "${body.slug}" is already taken`,
      );
    }

    const studio = await this.prisma.studio.create({
      data: {
        name: body.name,
        slug: body.slug,
        workspaceLabel: 'robdev',
        memberships: {
          create: {
            userId,
            role: 'OWNER',
          },
        },
      },
    });

    await provisionStudio(this.prisma, studio.id);

    return {
      ...this.toDto(studio),
      role: 'OWNER',
    };
  }

  async update(
    studioId: string,
    body: UpdateStudioRequest,
  ): Promise<StudioDto> {
    let openCloudKeyPatch: Record<string, unknown> = {};
    if (body.openCloudApiKey !== undefined) {
      const trimmed = body.openCloudApiKey?.trim() ?? '';
      if (!trimmed) {
        openCloudKeyPatch = {
          openCloudApiKey: null,
          openCloudApiKeyCiphertext: null,
          openCloudApiKeyIv: null,
          openCloudApiKeyTag: null,
          openCloudApiKeyLast4: null,
        };
      } else if (this.secretBox) {
        const sealed = this.secretBox.seal(trimmed);
        openCloudKeyPatch = {
          openCloudApiKey: null,
          openCloudApiKeyCiphertext: sealed.ciphertext,
          openCloudApiKeyIv: sealed.iv,
          openCloudApiKeyTag: sealed.tag,
          openCloudApiKeyLast4: trimmed.slice(-4),
        };
      } else {
        openCloudKeyPatch = {
          openCloudApiKey: trimmed,
          openCloudApiKeyLast4: trimmed.slice(-4),
        };
      }
    }

    const updated = await this.prisma.studio.update({
      where: { id: studioId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.browserHeadless !== undefined
          ? { browserHeadless: body.browserHeadless }
          : {}),
        ...(body.autoDeleteCreatedChats !== undefined
          ? { autoDeleteCreatedChats: body.autoDeleteCreatedChats }
          : {}),
        ...(body.codingMode !== undefined ? { codingMode: body.codingMode } : {}),
        ...(body.codingSyncTool !== undefined
          ? { codingSyncTool: body.codingSyncTool }
          : {}),
        ...(body.contextMode !== undefined ? { contextMode: body.contextMode } : {}),
        ...(body.allowTerminalWithoutPermission !== undefined
          ? { allowTerminalWithoutPermission: body.allowTerminalWithoutPermission }
          : {}),
        ...(body.allowExternalFilesWithoutPermission !== undefined
          ? {
              allowExternalFilesWithoutPermission:
                body.allowExternalFilesWithoutPermission,
            }
          : {}),
        ...(body.allowPcControlWithoutPermission !== undefined
          ? {
              allowPcControlWithoutPermission:
                body.allowPcControlWithoutPermission,
            }
          : {}),
        ...(body.pcIdleTakeoverSeconds !== undefined
          ? { pcIdleTakeoverSeconds: body.pcIdleTakeoverSeconds }
          : {}),
        ...(body.sandboxAccessPolicy !== undefined
          ? { sandboxAccessPolicy: body.sandboxAccessPolicy }
          : {}),
        ...(body.sandboxProviderKind !== undefined
          ? { sandboxProviderKind: body.sandboxProviderKind }
          : {}),
        ...(body.maxConcurrentSandboxes !== undefined
          ? { maxConcurrentSandboxes: body.maxConcurrentSandboxes }
          : {}),
        ...(body.allowAutoSaveVersion !== undefined
          ? { allowAutoSaveVersion: body.allowAutoSaveVersion }
          : {}),
        ...(body.allowAutoPublish !== undefined
          ? { allowAutoPublish: body.allowAutoPublish }
          : {}),
        ...(body.robloxUniverseId !== undefined
          ? { robloxUniverseId: body.robloxUniverseId }
          : {}),
        ...(body.robloxPlaceId !== undefined
          ? { robloxPlaceId: body.robloxPlaceId }
          : {}),
        ...(body.dailyTokenBudget !== undefined
          ? { dailyTokenBudget: body.dailyTokenBudget }
          : {}),
        ...(body.dailyCostBudgetUsd !== undefined
          ? { dailyCostBudgetUsd: body.dailyCostBudgetUsd }
          : {}),
        ...(body.perTaskTokenBudget !== undefined
          ? { perTaskTokenBudget: body.perTaskTokenBudget }
          : {}),
        ...openCloudKeyPatch,
      },
    });
    if (body.browserHeadless !== undefined) {
      await this.googleWeb
        .onStudioBrowserSettingChanged(studioId, updated.browserHeadless)
        .catch(() => {});
    }
    return this.toDto(updated);
  }

  async pause(studioId: string, byUserName: string): Promise<StudioDto> {
    const updated = await this.prisma.studio.update({
      where: { id: studioId },
      data: {
        isPaused: true,
        pausedAt: new Date(),
      },
    });

    const activeRuns = await this.prisma.agentRun.findMany({
      where: { studioId, status: 'RUNNING' },
      select: { id: true, taskId: true },
    });

    for (const run of activeRuns) {
      const abortedInMemory = this.registry.abort(run.id, 'PAUSED');
      if (!abortedInMemory) {
        await this.prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: 'INTERRUPTED',
            finishedAt: new Date(),
            errorMessage: 'Paused by operator',
          },
        });
        await this.prisma.task.update({
          where: { id: run.taskId },
          data: { status: 'PAUSED' },
        });
      }
    }

    const agents = await this.prisma.agent.findMany({
      where: { studioId },
      select: { id: true },
    });
    for (const agent of agents) {
      await this.agentStatus.recompute(agent.id);
    }

    this.realtime.emitToStudio(studioId, 'studio:paused', {
      isPaused: true,
      byUserName,
    });
    this.realtime.broadcastCounts(studioId);

    return this.toDto(updated);
  }

  async resume(studioId: string, byUserName: string): Promise<StudioDto> {
    const updated = await this.prisma.studio.update({
      where: { id: studioId },
      data: {
        isPaused: false,
        pausedAt: null,
      },
    });

    const pausedTasks = await this.prisma.task.findMany({
      where: { studioId, status: 'PAUSED' },
      select: { id: true },
    });

    if (pausedTasks.length > 0) {
      await this.prisma.task.updateMany({
        where: { studioId, status: 'PAUSED' },
        data: { status: 'QUEUED', queuedAt: new Date() },
      });

      for (const t of pausedTasks) {
        const dto = await this.tasks.getById(studioId, t.id);
        this.realtime.emitToStudio(studioId, 'task:updated', {
          task: dto,
          change: 'updated',
        });
      }
    }

    const agents = await this.prisma.agent.findMany({
      where: { studioId },
      select: { id: true },
    });
    for (const agent of agents) {
      await this.agentStatus.recompute(agent.id);
    }

    this.realtime.emitToStudio(studioId, 'studio:paused', {
      isPaused: false,
      byUserName,
    });
    this.realtime.broadcastCounts(studioId);

    return this.toDto(updated);
  }

  toDto(studio: {
    id: string;
    slug: string;
    name: string;
    workspaceLabel: string;
    isPaused: boolean;
    pausedAt: Date | null;
    browserHeadless?: boolean;
    autoDeleteCreatedChats?: boolean;
    codingMode?: string;
    codingSyncTool?: string;
    contextMode?: string;
    allowTerminalWithoutPermission?: boolean;
    allowExternalFilesWithoutPermission?: boolean;
    allowPcControlWithoutPermission?: boolean;
    pcIdleTakeoverSeconds?: number;
    sandboxAccessPolicy?: string;
    sandboxProviderKind?: string;
    maxConcurrentSandboxes?: number;
    allowAutoSaveVersion?: boolean;
    allowAutoPublish?: boolean;
    robloxUniverseId?: string | null;
    robloxPlaceId?: string | null;
    openCloudApiKey?: string | null;
    openCloudApiKeyCiphertext?: string | null;
    openCloudApiKeyLast4?: string | null;
    dailyTokenBudget?: number | null;
    dailyCostBudgetUsd?: number | null;
    perTaskTokenBudget?: number | null;
  }): StudioDto {
    const mode =
      studio.codingMode === 'ROBLOX_MCP' ? 'ROBLOX_MCP' : ('LOCAL_SYNC' as CodingMode);
    const syncTool = (
      studio.codingSyncTool &&
      ['SILICON', 'ROJO', 'AZUL', 'ARGON', 'PESTO', 'RBXMK'].includes(
        studio.codingSyncTool,
      )
        ? studio.codingSyncTool
        : 'SILICON'
    ) as CodingSyncTool;
    const contextMode: ContextMode =
      studio.contextMode === 'GENERAL' ? 'GENERAL' : 'ROBLOX';
    const sandboxPolicy: SandboxAccessPolicy =
      studio.sandboxAccessPolicy === 'ASK' || studio.sandboxAccessPolicy === 'DENY'
        ? studio.sandboxAccessPolicy
        : 'ALLOW';
    const sandboxProvider: SandboxProviderKind =
      studio.sandboxProviderKind === 'CLOUD_GPU' ? 'CLOUD_GPU' : 'LOCAL';
    return {
      id: studio.id,
      slug: studio.slug,
      name: studio.name,
      workspaceLabel: studio.workspaceLabel,
      isPaused: studio.isPaused,
      pausedAt: studio.pausedAt ? studio.pausedAt.toISOString() : null,
      browserHeadless: studio.browserHeadless ?? true,
      autoDeleteCreatedChats: studio.autoDeleteCreatedChats ?? false,
      codingMode: mode,
      codingSyncTool: syncTool,
      contextMode,
      allowTerminalWithoutPermission:
        studio.allowTerminalWithoutPermission ?? false,
      allowExternalFilesWithoutPermission:
        studio.allowExternalFilesWithoutPermission ?? false,
      allowPcControlWithoutPermission:
        studio.allowPcControlWithoutPermission ?? false,
      pcIdleTakeoverSeconds: studio.pcIdleTakeoverSeconds ?? 60,
      sandboxAccessPolicy: sandboxPolicy,
      sandboxProviderKind: sandboxProvider,
      maxConcurrentSandboxes: studio.maxConcurrentSandboxes ?? 15,
      allowAutoSaveVersion: studio.allowAutoSaveVersion ?? true,
      allowAutoPublish: studio.allowAutoPublish ?? true,
      robloxUniverseId: studio.robloxUniverseId ?? null,
      robloxPlaceId: studio.robloxPlaceId ?? null,
      hasOpenCloudApiKey: Boolean(
        studio.openCloudApiKeyCiphertext || studio.openCloudApiKey,
      ),
      openCloudApiKeyLast4:
        studio.openCloudApiKeyLast4 ??
        (studio.openCloudApiKey ? studio.openCloudApiKey.slice(-4) : null),
      dailyTokenBudget: studio.dailyTokenBudget ?? null,
      dailyCostBudgetUsd: studio.dailyCostBudgetUsd ?? null,
      perTaskTokenBudget: studio.perTaskTokenBudget ?? null,
    };
  }
}
