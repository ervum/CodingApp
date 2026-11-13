import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  BrowserSessionStatusDto,
  BrowserVisibilityStatusDto,
  CreateLlmConnectionRequest,
  DeleteWebChatsResultDto,
  DetectedLocalRuntimeDto,
  DetectedLocalServerDto,
  LlmConnectionDto,
  LlmModelInfoDto,
  LlmProvider,
  PullLocalModelRequest,
  RunpodPodActionRequest,
  RunpodPodStatusDto,
  TestConnectionResultDto,
  UpdateLlmConnectionRequest,
  WebChatSessionDto,
} from '@robdev/shared';
import { SecretBoxService } from '../../common/crypto/secret-box.service.js';
import { AppError } from '../../common/errors/app-error.js';
import type { LlmConnection } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentStatusService } from '../agents/agent-status.service.js';
import { AntigravityAdapter } from './adapters/antigravity.adapter.js';
import { ChatGptWebBrowserAdapter } from './adapters/chatgpt-web.adapter.js';
import { ClaudeWebBrowserAdapter } from './adapters/claude-web.adapter.js';
import { GoogleWebBrowserAdapter } from './adapters/google-web.adapter.js';
import { LlmError, type ResolvedConnection } from './adapters/llm-adapter.interface.js';
import { LlmAdapterFactory } from './llm-adapter.factory.js';
import { LocalAiService } from './local-ai.service.js';
import { LocalRuntimeDiscoveryService } from './local-runtime-discovery.service.js';
import { RunpodService } from './runpod.service.js';

@Injectable()
export class LlmConnectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secretBox: SecretBoxService,
    private readonly factory: LlmAdapterFactory,
    private readonly agentStatus: AgentStatusService,
    private readonly googleWeb: GoogleWebBrowserAdapter,
    private readonly localAi: LocalAiService,
    private readonly runpod: RunpodService,
    private readonly claudeWeb?: ClaudeWebBrowserAdapter,
    private readonly chatgptWeb?: ChatGptWebBrowserAdapter,
    private readonly antigravity?: AntigravityAdapter,
    private readonly runtimeDiscovery?: LocalRuntimeDiscoveryService,
  ) {}

  defaultModelForConnection(conn: {
    provider: LlmProvider;
    baseUrl: string | null;
  }): string {
    switch (conn.provider) {
      case 'GOOGLE_WEB':
      case 'GEMINI_APP':
        return conn.baseUrl?.includes('aistudio.google.com')
          ? 'aistudio:gemini-3.8-flash?thinking=medium&tools=googleSearch&mediaRes=default'
          : 'gemini-web:3.8-flash?thinking=medium';
      case 'CLAUDE_WEB':
        return 'claude-web-sonnet-4-6';
      case 'CLAUDE_APP':
        return 'claude-app-sonnet-4-6';
      case 'CHATGPT_WEB':
        return 'chatgpt-web-default';
      case 'GPT_APP':
        return 'gpt-app-default';
      case 'ANTIGRAVITY':
        return 'gemini-3.1-pro-high';
      case 'CLAUDE_CODE':
        return 'claude-sonnet-4-6';
      case 'CODEX':
        return 'gpt-5.3-codex';
      case 'OLLAMA':
        return 'qwen2.5-coder:7b';
      case 'GOOGLE':
        return 'gemini-3.8-flash';
      case 'OPENAI':
        return 'gpt-4o';
      case 'ANTHROPIC':
        return 'claude-sonnet-4-20250514';
      case 'XAI':
        return 'grok-3';
      case 'RUNPOD':
      case 'OPENAI_COMPATIBLE':
        return 'default';
    }
  }

  async ensureUnboundAgentsBound(
    studioId: string,
    preferredConn?: LlmConnection,
    preferredModelId?: string,
  ): Promise<number> {
    const unboundAgents = await this.prisma.agent.findMany({
      where: {
        studioId,
        OR: [{ llmConnectionId: null }, { modelId: null }],
      },
      select: { id: true, key: true, imageConnectionId: true },
    });

    if (unboundAgents.length === 0) {
      return 0;
    }

    const conn =
      preferredConn ??
      (await this.prisma.llmConnection.findFirst({
        where: { studioId, isEnabled: true },
        orderBy: [{ lastVerifiedAt: 'desc' }, { createdAt: 'desc' }],
      }));

    if (!conn || !conn.isEnabled) {
      return 0;
    }

    const modelId = preferredModelId ?? this.defaultModelForConnection(conn);

    await this.prisma.agent.updateMany({
      where: {
        id: { in: unboundAgents.map((a) => a.id) },
      },
      data: {
        llmConnectionId: conn.id,
        modelId,
        lastErrorCode: null,
      },
    });

    // Also bind Splash's imageConnectionId if unbound
    const splash = unboundAgents.find((a) => a.key === 'splash' && !a.imageConnectionId);
    if (splash) {
      await this.prisma.agent.update({
        where: { id: splash.id },
        data: {
          imageConnectionId: conn.id,
          imageModelId: modelId,
        },
      });
    }

    for (const agent of unboundAgents) {
      await this.agentStatus.recompute(agent.id);
    }

    return unboundAgents.length;
  }

  async bindAllAgents(
    studioId: string,
    connectionId: string,
    requestedModelId?: string,
  ): Promise<{ boundCount: number; modelId: string }> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }

    let modelId = requestedModelId?.trim() || '';
    if (!modelId) {
      try {
        const resolved = this.decryptConnection(existing);
        const models = await this.factory.forConnection(resolved).listModels();
        modelId = models[0]?.id ?? this.defaultModelForConnection(existing);
      } catch {
        modelId = this.defaultModelForConnection(existing);
      }
    }

    const agents = await this.prisma.agent.findMany({
      where: { studioId },
      select: { id: true, key: true },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.agent.updateMany({
        where: { studioId },
        data: {
          llmConnectionId: existing.id,
          modelId,
          lastErrorCode: null,
        },
      });
      await tx.agent.updateMany({
        where: { studioId, key: 'splash' },
        data: {
          imageConnectionId: existing.id,
          imageModelId: modelId,
        },
      });
    });

    for (const agent of agents) {
      await this.agentStatus.recompute(agent.id);
    }

    return {
      boundCount: agents.length,
      modelId,
    };
  }

  async list(studioId: string): Promise<LlmConnectionDto[]> {
    await this.ensureUnboundAgentsBound(studioId);
    const rows = await this.prisma.llmConnection.findMany({
      where: { studioId },
      include: { _count: { select: { textAgents: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toDto(r, r._count.textAgents));
  }

  async create(
    studioId: string,
    body: CreateLlmConnectionRequest,
  ): Promise<LlmConnectionDto> {
    let apiKeyCiphertext: string | null = null;
    let apiKeyIv: string | null = null;
    let apiKeyTag: string | null = null;
    let apiKeyLast4: string | null = null;

    if (body.apiKey) {
      const sealed = this.secretBox.seal(body.apiKey);
      apiKeyCiphertext = sealed.ciphertext;
      apiKeyIv = sealed.iv;
      apiKeyTag = sealed.tag;
      apiKeyLast4 = body.apiKey.slice(-4);
    }

    const created = await this.prisma.llmConnection.create({
      data: {
        studioId,
        provider: body.provider,
        label: body.label,
        baseUrl: body.baseUrl,
        apiKeyCiphertext,
        apiKeyIv,
        apiKeyTag,
        apiKeyLast4,
        inputCostPerMTok: body.inputCostPerMTok ?? null,
        outputCostPerMTok: body.outputCostPerMTok ?? null,
        isEnabled: true,
      },
    });

    await this.ensureUnboundAgentsBound(studioId, created);

    const refreshed = await this.prisma.llmConnection.findUniqueOrThrow({
      where: { id: created.id },
      include: { _count: { select: { textAgents: true } } },
    });

    return this.toDto(refreshed, refreshed._count.textAgents);
  }

  async update(
    studioId: string,
    connectionId: string,
    body: UpdateLlmConnectionRequest,
  ): Promise<LlmConnectionDto> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }

    let secretFields: {
      apiKeyCiphertext?: string;
      apiKeyIv?: string;
      apiKeyTag?: string;
      apiKeyLast4?: string;
    } = {};

    if (body.apiKey !== undefined) {
      const sealed = this.secretBox.seal(body.apiKey);
      secretFields = {
        apiKeyCiphertext: sealed.ciphertext,
        apiKeyIv: sealed.iv,
        apiKeyTag: sealed.tag,
        apiKeyLast4: body.apiKey.slice(-4),
      };
    }

    const updated = await this.prisma.llmConnection.update({
      where: { id: existing.id },
      data: {
        ...(body.label !== undefined ? { label: body.label } : {}),
        ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        ...(body.inputCostPerMTok !== undefined
          ? { inputCostPerMTok: body.inputCostPerMTok }
          : {}),
        ...(body.outputCostPerMTok !== undefined
          ? { outputCostPerMTok: body.outputCostPerMTok }
          : {}),
        ...secretFields,
      },
      include: {
        _count: { select: { textAgents: true } },
        textAgents: { select: { id: true } },
      },
    });

    if (updated.isEnabled) {
      await this.ensureUnboundAgentsBound(studioId, updated);
    }

    for (const agent of updated.textAgents) {
      await this.agentStatus.recompute(agent.id);
    }

    const refreshed = await this.prisma.llmConnection.findUniqueOrThrow({
      where: { id: updated.id },
      include: { _count: { select: { textAgents: true } } },
    });

    return this.toDto(refreshed, refreshed._count.textAgents);
  }

  async delete(studioId: string, connectionId: string): Promise<void> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
      include: { textAgents: { select: { id: true } } },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }

    const boundAgentIds = existing.textAgents.map((a) => a.id);

    await this.prisma.$transaction(async (tx) => {
      await tx.agent.updateMany({
        where: { studioId, llmConnectionId: existing.id },
        data: { llmConnectionId: null, modelId: null },
      });
      await tx.agent.updateMany({
        where: { studioId, imageConnectionId: existing.id },
        data: { imageConnectionId: null, imageModelId: null },
      });
      await tx.llmConnection.delete({ where: { id: existing.id } });
    });

    await this.ensureUnboundAgentsBound(studioId);

    for (const agentId of boundAgentIds) {
      await this.agentStatus.recompute(agentId);
    }
  }

  async testConnection(
    studioId: string,
    connectionId: string,
  ): Promise<TestConnectionResultDto> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
      include: { textAgents: { select: { id: true } } },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }

    const resolved = this.decryptConnection(existing);
    const start = Date.now();
    try {
      const models = await this.factory.forConnection(resolved).listModels();
      const latencyMs = Math.max(1, Date.now() - start);

      await this.prisma.$transaction(async (tx) => {
        await tx.llmConnection.update({
          where: { id: existing.id },
          data: { lastVerifiedAt: new Date(), lastError: null },
        });
        await tx.agent.updateMany({
          where: {
            studioId,
            llmConnectionId: existing.id,
            lastErrorCode: 'PROVIDER_AUTH_FAILED',
          },
          data: { lastErrorCode: null },
        });
      });

      await this.ensureUnboundAgentsBound(studioId, existing, models[0]?.id);

      for (const agent of existing.textAgents) {
        await this.agentStatus.recompute(agent.id);
      }

      return {
        ok: true,
        latencyMs,
        modelCount: models.length,
        error: null,
      };
    } catch (err) {
      const latencyMs = Math.max(1, Date.now() - start);
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.llmConnection.update({
        where: { id: existing.id },
        data: { lastError: message },
      });

      for (const agent of existing.textAgents) {
        await this.agentStatus.recompute(agent.id);
      }

      return {
        ok: false,
        latencyMs,
        modelCount: 0,
        error: message,
      };
    }
  }

  async listModels(studioId: string, connectionId: string): Promise<LlmModelInfoDto[]> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
      include: { textAgents: { select: { id: true } } },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }

    const resolved = this.decryptConnection(existing);
    try {
      const models = await this.factory.forConnection(resolved).listModels();
      await this.prisma.$transaction(async (tx) => {
        await tx.llmConnection.update({
          where: { id: existing.id },
          data: { lastVerifiedAt: new Date(), lastError: null },
        });
        await tx.agent.updateMany({
          where: {
            studioId,
            llmConnectionId: existing.id,
            lastErrorCode: 'PROVIDER_AUTH_FAILED',
          },
          data: { lastErrorCode: null },
        });
      });

      await this.ensureUnboundAgentsBound(studioId, existing, models[0]?.id);

      for (const agent of existing.textAgents) {
        await this.agentStatus.recompute(agent.id);
      }
      return models;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.llmConnection.update({
        where: { id: existing.id },
        data: { lastError: message },
      });
      if (err instanceof LlmError) {
        throw new AppError(err.code, HttpStatus.BAD_GATEWAY, err.message);
      }
      throw new AppError('PROVIDER_UNAVAILABLE', HttpStatus.BAD_GATEWAY, message);
    }
  }

  decryptConnection(conn: LlmConnection): ResolvedConnection {
    let apiKey: string | null = null;
    if (conn.apiKeyCiphertext && conn.apiKeyIv && conn.apiKeyTag) {
      apiKey = this.secretBox.open({
        ciphertext: conn.apiKeyCiphertext,
        iv: conn.apiKeyIv,
        tag: conn.apiKeyTag,
      });
    }
    return {
      id: conn.id,
      provider: conn.provider,
      baseUrl: conn.baseUrl,
      apiKey,
    };
  }

  async detectLocalServers(): Promise<DetectedLocalServerDto[]> {
    return this.localAi.detectLocalServers();
  }

  async detectLocalRuntimes(forceRefresh = false): Promise<DetectedLocalRuntimeDto[]> {
    if (!this.runtimeDiscovery) return [];
    return this.runtimeDiscovery.discoverAll(forceRefresh);
  }

  async finalizeRunSession(runId: string, studioId: string): Promise<void> {
    await Promise.allSettled([
      this.googleWeb.finalizeRunSession(runId, studioId),
      this.claudeWeb?.finalizeRunSession(runId, studioId),
      this.chatgptWeb?.finalizeRunSession(runId, studioId),
    ]);
  }

  async getBrowserVisibility(studioId: string): Promise<BrowserVisibilityStatusDto> {
    return this.googleWeb.getBrowserVisibilityStatus(studioId);
  }

  async setBrowserVisibility(
    studioId: string,
    visible: boolean,
  ): Promise<BrowserVisibilityStatusDto> {
    await Promise.allSettled([
      this.claudeWeb?.setBrowserVisibility(studioId, visible),
      this.chatgptWeb?.setBrowserVisibility(studioId, visible),
    ]);
    return this.googleWeb.setBrowserVisibility(studioId, visible);
  }

  async triggerAnswerNow(
    studioId: string,
    body?: { runId?: string; agentKey?: AgentKey },
  ): Promise<{ ok: boolean; message: string }> {
    return this.googleWeb.triggerAnswerNow(studioId, body?.runId, body?.agentKey);
  }

  async listWebChats(
    studioId: string,
    agentKey?: AgentKey,
  ): Promise<WebChatSessionDto[]> {
    return this.googleWeb.listWebChatSessions(studioId, agentKey);
  }

  async deleteAgentWebChats(
    studioId: string,
    agentKey: AgentKey,
  ): Promise<DeleteWebChatsResultDto> {
    return this.googleWeb.deleteAgentWebChats(studioId, agentKey);
  }

  async deleteLastRunWebChats(studioId: string): Promise<DeleteWebChatsResultDto> {
    return this.googleWeb.deleteLastRunWebChats(studioId);
  }

  async deleteSingleWebChat(
    studioId: string,
    chatId: string,
  ): Promise<DeleteWebChatsResultDto> {
    return this.googleWeb.deleteSingleWebChat(studioId, chatId);
  }

  async launchBrowserLogin(
    studioId: string,
    connectionId: string,
  ): Promise<BrowserSessionStatusDto> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
      include: { textAgents: { select: { id: true } } },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }
    const resolved = this.decryptConnection(existing);
    let status: BrowserSessionStatusDto;
    if (
      (resolved.provider === 'CLAUDE_WEB' || resolved.provider === 'CLAUDE_APP') &&
      this.claudeWeb
    ) {
      status = await this.claudeWeb.launchInteractiveSignIn(resolved);
    } else if (
      (resolved.provider === 'CHATGPT_WEB' || resolved.provider === 'GPT_APP') &&
      this.chatgptWeb
    ) {
      status = await this.chatgptWeb.launchInteractiveSignIn(resolved);
    } else if (resolved.provider === 'ANTIGRAVITY' && this.antigravity) {
      status = await this.antigravity.getSessionStatus(resolved);
    } else {
      status = await this.googleWeb.launchInteractiveSignIn(resolved);
    }

    if (status.authenticated) {
      await this.prisma.llmConnection.update({
        where: { id: existing.id },
        data: { lastVerifiedAt: new Date(), lastError: null },
      });
      await this.ensureUnboundAgentsBound(studioId, existing);
      for (const agent of existing.textAgents) {
        await this.agentStatus.recompute(agent.id);
      }
    }
    return status;
  }

  async pullLocalModel(
    studioId: string,
    connectionId: string,
    body: PullLocalModelRequest,
  ): Promise<{ ok: boolean; model: string; status: string }> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }
    try {
      const res = await this.localAi.pullOllamaModel(existing.baseUrl, body.model);
      await this.prisma.llmConnection.update({
        where: { id: existing.id },
        data: { lastVerifiedAt: new Date(), lastError: null },
      });
      await this.ensureUnboundAgentsBound(studioId, existing, body.model);
      return res;
    } catch (err) {
      if (err instanceof LlmError) {
        throw new AppError(err.code, HttpStatus.BAD_GATEWAY, err.message);
      }
      throw err;
    }
  }

  async controlRunpodPod(
    studioId: string,
    connectionId: string,
    body: RunpodPodActionRequest,
  ): Promise<RunpodPodStatusDto> {
    const existing = await this.prisma.llmConnection.findFirst({
      where: { id: connectionId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'LLM connection not found');
    }
    const resolved = this.decryptConnection(existing);
    try {
      return await this.runpod.controlPod(resolved, body.podId, body.action, body.port);
    } catch (err) {
      if (err instanceof LlmError) {
        throw new AppError(err.code, HttpStatus.BAD_GATEWAY, err.message);
      }
      throw err;
    }
  }

  private toDto(conn: LlmConnection, boundAgentCount: number): LlmConnectionDto {
    return {
      id: conn.id,
      provider: conn.provider,
      label: conn.label,
      baseUrl: conn.baseUrl,
      hasApiKey: Boolean(conn.apiKeyCiphertext),
      apiKeyLast4: conn.apiKeyLast4,
      isEnabled: conn.isEnabled,
      inputCostPerMTok: conn.inputCostPerMTok ?? null,
      outputCostPerMTok: conn.outputCostPerMTok ?? null,
      lastVerifiedAt: conn.lastVerifiedAt ? conn.lastVerifiedAt.toISOString() : null,
      lastError: conn.lastError,
      boundAgentCount,
      createdAt: conn.createdAt.toISOString(),
    };
  }
}
