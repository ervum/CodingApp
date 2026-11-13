import path from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AgentKey,
  type AgentDetailDto,
  type AgentRunDetailDto,
  type McpServerInfoDto,
  type McpToolCallResultDto,
  type McpToolDefinitionDto,
  type PitchStatus,
  type ReviewStatus,
  type ReviewTab,
  type TaskPriority,
  type TaskStatus,
} from '@robdev/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AgentMessagesService } from '../agents/agent-messages.service.js';
import { AgentsService } from '../agents/agents.service.js';
import { GamesService } from '../games/games.service.js';
import { HumanRequestsService } from '../human-requests/human-requests.service.js';
import { LanesService } from '../lanes/lanes.service.js';
import { LlmConnectionsService } from '../llm/llm-connections.service.js';
import { MarketService } from '../market/market.service.js';
import { PitchesService } from '../pitches/pitches.service.js';
import { ReviewService } from '../review/review.service.js';
import { SnapshotService } from '../studios/snapshot.service.js';
import { StudiosService } from '../studios/studios.service.js';
import { TasksService } from '../tasks/tasks.service.js';
import { VaultSearchService } from '../vault/vault-search.service.js';
import { VaultService } from '../vault/vault.service.js';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface InternalToolDef extends McpToolDefinitionDto {
  handler: (
    args: Record<string, unknown>,
    user?: AuthenticatedUser,
  ) => Promise<unknown>;
}

const STUDIO_FILTER_PROPS = {
  studioSlug: {
    type: 'string',
    description:
      'Optional studio slug (e.g. "inclined-games"). Defaults automatically to the active studio.',
  },
  studioId: {
    type: 'string',
    description: 'Optional studio UUID. Defaults automatically to the active studio.',
  },
} as const;

const AGENT_KEY_ENUM = Object.values(AgentKey);

@Injectable()
export class McpService {
  private readonly tools: ReadonlyArray<InternalToolDef>;
  private readonly toolsByName: ReadonlyMap<string, InternalToolDef>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly studios: StudiosService,
    private readonly snapshot: SnapshotService,
    private readonly agents: AgentsService,
    private readonly agentMessages: AgentMessagesService,
    private readonly llm: LlmConnectionsService,
    private readonly tasks: TasksService,
    private readonly humanRequests: HumanRequestsService,
    private readonly games: GamesService,
    private readonly pitches: PitchesService,
    private readonly market: MarketService,
    private readonly vault: VaultService,
    private readonly vaultSearch: VaultSearchService,
    private readonly review: ReviewService,
    private readonly lanes: LanesService,
  ) {
    this.tools = this.buildToolDefinitions();
    this.toolsByName = new Map(this.tools.map((t) => [t.name, t]));
  }

  async getServerInfo(baseUrlOverride?: string): Promise<McpServerInfoDto> {
    const baseUrl = (baseUrlOverride || `http://localhost:${this.config.port}`).replace(
      /\/+$/,
      '',
    );
    const defaultStudio = await this.resolveStudio({}).catch(() => null);
    const stdioScript = path.resolve(process.cwd(), 'dist', 'mcp-stdio.js');

    return {
      serverName: 'robdev-control-room-mcp',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      httpEndpoint: `${baseUrl}/api/mcp`,
      sseEndpoint: `${baseUrl}/api/mcp/sse`,
      stdioCommand: 'node',
      stdioArgs: [stdioScript],
      defaultStudioId: defaultStudio?.id ?? null,
      defaultStudioSlug: defaultStudio?.slug ?? null,
      defaultStudioName: defaultStudio?.name ?? null,
      toolCount: this.tools.length,
      tools: this.tools.map(
        ({ name, category, title, description, inputSchema, exampleArgs }) => ({
          name,
          category,
          title,
          description,
          inputSchema,
          exampleArgs,
        }),
      ),
    };
  }

  listToolDefinitions(): McpToolDefinitionDto[] {
    return this.tools.map(
      ({ name, category, title, description, inputSchema, exampleArgs }) => ({
        name,
        category,
        title,
        description,
        inputSchema,
        exampleArgs,
      }),
    );
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown> = {},
    user?: AuthenticatedUser,
  ): Promise<McpToolCallResultDto> {
    const start = Date.now();
    const def = this.toolsByName.get(toolName);
    if (!def) {
      return {
        toolName,
        isError: true,
        durationMs: Math.max(1, Date.now() - start),
        content: [
          {
            type: 'text',
            text: `Unknown MCP tool "${toolName}". Available tools: ${this.tools.map((t) => t.name).join(', ')}`,
          },
        ],
      };
    }

    try {
      const result = await def.handler(args ?? {}, user);
      const serialized =
        typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return {
        toolName,
        isError: false,
        durationMs: Math.max(1, Date.now() - start),
        content: [{ type: 'text', text: serialized }],
        structuredContent: result,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        toolName,
        isError: true,
        durationMs: Math.max(1, Date.now() - start),
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: true, message }, null, 2),
          },
        ],
        structuredContent: { error: true, message },
      };
    }
  }

  async handleJsonRpcPayload(
    payload: unknown,
    user?: AuthenticatedUser,
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
      const responses: JsonRpcResponse[] = [];
      for (const item of payload) {
        const res = await this.handleSingleJsonRpc(item as JsonRpcRequest, user);
        if (res) responses.push(res);
      }
      return responses.length > 0 ? responses : null;
    }
    return this.handleSingleJsonRpc(payload as JsonRpcRequest, user);
  }

  private async handleSingleJsonRpc(
    req: JsonRpcRequest,
    user?: AuthenticatedUser,
  ): Promise<JsonRpcResponse | null> {
    if (!req || typeof req !== 'object' || typeof req.method !== 'string') {
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid JSON-RPC request' },
      };
    }

    const isNotification = req.id === undefined;
    const id = req.id ?? null;
    const params = (req.params ?? {}) as Record<string, unknown>;

    try {
      switch (req.method) {
        case 'initialize': {
          const requestedProtocol =
            typeof params.protocolVersion === 'string'
              ? params.protocolVersion
              : '2024-11-05';
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: requestedProtocol,
              capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
                prompts: { listChanged: false },
              },
              serverInfo: {
                name: 'robdev-control-room-mcp',
                version: '1.0.0',
              },
              instructions:
                'RobDev Control Room MCP Server. Use `prompt_lead` to prompt the Lead orchestrator agent in chat, `list_agents` / `get_studio_snapshot` to inspect studio state, `answer_now` to force Gemini to stop recursive thinking, `set_studio_model` to change models, and `set_browser_visibility` to show/hide the agent browser window.',
            },
          };
        }

        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;

        case 'ping':
          return { jsonrpc: '2.0', id, result: {} };

        case 'tools/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: this.tools.map((t) => ({
                name: t.name,
                title: t.title,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          };

        case 'tools/call': {
          const toolName = String(params.name ?? '');
          const toolArgs =
            params.arguments && typeof params.arguments === 'object'
              ? (params.arguments as Record<string, unknown>)
              : {};
          const callRes = await this.executeTool(toolName, toolArgs, user);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: callRes.content,
              isError: callRes.isError,
            },
          };
        }

        case 'resources/list': {
          const studio = await this.resolveStudio({}).catch(() => null);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              resources: studio
                ? [
                    {
                      uri: `robdev://studio/${studio.slug}/snapshot`,
                      name: `${studio.name} — Live Studio Snapshot`,
                      description:
                        'Real-time snapshot of agents, tasks, games, live runs, and human requests',
                      mimeType: 'application/json',
                    },
                  ]
                : [],
            },
          };
        }

        case 'resources/read': {
          const uri = String(params.uri ?? '');
          const studio = await this.resolveStudio({});
          const snap = await this.snapshot.getSnapshot(studio.id, 'OWNER');
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [
                {
                  uri: uri || `robdev://studio/${studio.slug}/snapshot`,
                  mimeType: 'application/json',
                  text: JSON.stringify(snap, null, 2),
                },
              ],
            },
          };
        }

        case 'prompts/list':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              prompts: [
                {
                  name: 'prompt-lead',
                  description: 'Send a directive to the Lead orchestrator agent',
                  arguments: [
                    {
                      name: 'directive',
                      description: 'Instruction or task for the Lead agent',
                      required: true,
                    },
                  ],
                },
              ],
            },
          };

        case 'prompts/get': {
          const promptArgs = (params.arguments ?? {}) as Record<string, string>;
          return {
            jsonrpc: '2.0',
            id,
            result: {
              description: 'Send a directive to the Lead orchestrator agent',
              messages: [
                {
                  role: 'user',
                  content: {
                    type: 'text',
                    text: `Call the \`prompt_lead\` MCP tool with prompt: "${promptArgs.directive ?? ''}"`,
                  },
                },
              ],
            },
          };
        }

        default:
          if (isNotification) return null;
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${req.method}`,
            },
          };
      }
    } catch (err) {
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  private async resolveStudio(args: Record<string, unknown>): Promise<{
    id: string;
    slug: string;
    name: string;
  }> {
    const studioId = typeof args.studioId === 'string' ? args.studioId.trim() : '';
    const studioSlug = typeof args.studioSlug === 'string' ? args.studioSlug.trim() : '';

    if (studioId) {
      const byId = await this.prisma.studio.findUnique({
        where: { id: studioId },
        select: { id: true, slug: true, name: true },
      });
      if (byId) return byId;
    }

    if (studioSlug) {
      const bySlug = await this.prisma.studio.findUnique({
        where: { slug: studioSlug },
        select: { id: true, slug: true, name: true },
      });
      if (bySlug) return bySlug;
    }

    // Prefer studio with an active/bound Lead agent or most recent LLM connection
    const boundLead = await this.prisma.agent.findFirst({
      where: {
        key: 'lead',
        llmConnectionId: { not: null },
        modelId: { not: null },
      },
      include: {
        studio: { select: { id: true, slug: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (boundLead?.studio) {
      return boundLead.studio;
    }

    const withConn = await this.prisma.llmConnection.findFirst({
      where: { isEnabled: true },
      include: {
        studio: { select: { id: true, slug: true, name: true } },
      },
      orderBy: [{ lastVerifiedAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (withConn?.studio) {
      return withConn.studio;
    }

    const firstStudio = await this.prisma.studio.findFirst({
      select: { id: true, slug: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!firstStudio) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'No studio found in database');
    }
    return firstStudio;
  }

  private async resolveUser(
    studioId: string,
    explicitUser?: AuthenticatedUser,
  ): Promise<AuthenticatedUser> {
    if (explicitUser) return explicitUser;

    const membership = await this.prisma.studioMembership.findFirst({
      where: { studioId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    if (membership?.user) {
      return {
        id: membership.user.id,
        email: membership.user.email,
        displayName: membership.user.displayName,
      };
    }

    const firstUser = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!firstUser) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'No operator user found');
    }
    return {
      id: firstUser.id,
      email: firstUser.email,
      displayName: firstUser.displayName,
    };
  }

  private parseAgentKeyParam(raw: unknown, fallback: AgentKey = 'lead'): AgentKey {
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!key) return fallback;
    if (!(key in AgentKey)) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        `Invalid agentKey "${String(raw)}". Valid keys: ${AGENT_KEY_ENUM.join(', ')}`,
      );
    }
    return key as AgentKey;
  }

  private async waitForTaskCompletion(params: {
    studioId: string;
    taskId: string;
    agentKey: AgentKey;
    timeoutMs: number;
    waitForSubtasks?: boolean;
  }): Promise<{
    completed: boolean;
    timedOut: boolean;
    task: unknown;
    latestRun: AgentRunDetailDto | null;
    agentReply: string | null;
    delegatedSubtasks: unknown[];
  }> {
    const deadline = Date.now() + Math.max(2_000, Math.min(600_000, params.timeoutMs));
    const terminalTaskStatuses = new Set<string>([
      'DONE',
      'FAILED',
      'CANCELLED',
      'NEEDS_HUMAN',
    ]);

    while (Date.now() < deadline) {
      const taskDetail = await this.tasks.getDetail(params.studioId, params.taskId);
      const isPrimaryTerminal = terminalTaskStatuses.has(taskDetail.status);

      if (isPrimaryTerminal) {
        const subtasksPending =
          params.waitForSubtasks &&
          taskDetail.subtasks.some((s) => !terminalTaskStatuses.has(s.status));
        if (!subtasksPending) {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    const finalTask = await this.tasks.getDetail(params.studioId, params.taskId);
    const isFinished = terminalTaskStatuses.has(finalTask.status);
    let latestRun: AgentRunDetailDto | null = null;
    if (finalTask.latestRunId) {
      latestRun = await this.agents
        .getRunDetail(params.studioId, finalTask.latestRunId)
        .catch(() => null);
    }

    // Extract the latest AGENT message or text log entries
    const messages = await this.agentMessages
      .list(params.studioId, params.agentKey, undefined, 10)
      .catch(() => ({ items: [] }));
    const taskAgentMsg = messages.items.find(
      (m) => m.taskId === params.taskId && m.author === 'AGENT',
    );
    const runTextOutput = latestRun
      ? latestRun.entries
          .filter((e) => e.kind === 'TEXT')
          .map((e) => e.content)
          .join('\n')
          .trim()
      : '';

    return {
      completed: isFinished,
      timedOut: !isFinished,
      task: finalTask,
      latestRun,
      agentReply:
        taskAgentMsg?.body ||
        runTextOutput ||
        finalTask.resultSummary ||
        latestRun?.summary ||
        null,
      delegatedSubtasks: finalTask.subtasks,
    };
  }

  private buildToolDefinitions(): InternalToolDef[] {
    return [
      // ── 1. LEAD & AGENT CHAT ─────────────────────────────────────────────
      {
        name: 'prompt_lead',
        category: 'Lead & Agent Chat',
        title: 'Prompt Lead Agent in Chat',
        description:
          'Send a message/prompt to the Lead orchestrator agent ("lead") in chat, just like typing in the Lead Console. By default waits for Lead to finish thinking/delegating and returns Lead\'s response, run logs, and any delegated subtasks.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt or instruction to send to the Lead agent.',
            },
            gameId: {
              type: 'string',
              description: 'Optional game UUID to scope the prompt to a specific game.',
            },
            waitForCompletion: {
              type: 'boolean',
              description:
                'Whether to wait for Lead\'s run to complete before returning (default: true). Set false to queue and return immediately.',
            },
            waitForSubtasks: {
              type: 'boolean',
              description:
                'If true, also waits for any child tasks delegated by Lead to specialist agents to finish (default: false).',
            },
            timeoutMs: {
              type: 'number',
              description:
                'Max milliseconds to wait when waitForCompletion is true (default: 120000).',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['prompt'],
        },
        exampleArgs: {
          prompt: 'Give me a concise status update of the studio and our current games.',
          waitForCompletion: true,
          timeoutMs: 120000,
        },
        handler: async (args, user) => {
          const prompt = String(args.prompt ?? args.message ?? args.body ?? '').trim();
          if (!prompt) {
            throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'prompt is required');
          }
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          const gameId =
            typeof args.gameId === 'string' && args.gameId.trim()
              ? args.gameId.trim()
              : null;

          const posted = await this.agentMessages.postUserMessage(
            studio.id,
            'lead',
            { body: prompt, gameId },
            resolvedUser,
          );

          const waitForCompletion = args.waitForCompletion !== false;
          if (!waitForCompletion) {
            return {
              queued: true,
              studioId: studio.id,
              studioSlug: studio.slug,
              message: posted.message,
              task: posted.task,
            };
          }

          const timeoutMs =
            typeof args.timeoutMs === 'number' ? args.timeoutMs : 120_000;
          const waitResult = await this.waitForTaskCompletion({
            studioId: studio.id,
            taskId: posted.task.id,
            agentKey: 'lead',
            timeoutMs,
            waitForSubtasks: Boolean(args.waitForSubtasks),
          });

          return {
            studioId: studio.id,
            studioSlug: studio.slug,
            userMessage: posted.message,
            ...waitResult,
          };
        },
      },

      {
        name: 'prompt_agent',
        category: 'Lead & Agent Chat',
        title: 'Prompt Any Studio Agent in Chat',
        description:
          'Send a message/prompt in chat to any of the 15 studio agents (lead, pulse, architect, builder, frame, scenic, balance, librarian, splash, producer, liveops, merchant, playtest, tester108, reviewer). If the agent has an open human request, this replies to and resolves it.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Key of the target studio agent.',
            },
            prompt: {
              type: 'string',
              description: 'The message or prompt to send to the agent.',
            },
            gameId: {
              type: 'string',
              description: 'Optional game UUID.',
            },
            waitForCompletion: {
              type: 'boolean',
              description:
                'Whether to wait for the agent run to complete before returning (default: true).',
            },
            timeoutMs: {
              type: 'number',
              description: 'Maximum wait time in ms (default: 120000).',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['agentKey', 'prompt'],
        },
        exampleArgs: {
          agentKey: 'architect',
          prompt: 'Outline the module architecture for the core round loop.',
          waitForCompletion: false,
        },
        handler: async (args, user) => {
          const agentKey = this.parseAgentKeyParam(args.agentKey);
          const prompt = String(args.prompt ?? args.message ?? args.body ?? '').trim();
          if (!prompt) {
            throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'prompt is required');
          }
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          const gameId =
            typeof args.gameId === 'string' && args.gameId.trim()
              ? args.gameId.trim()
              : null;

          const posted = await this.agentMessages.postUserMessage(
            studio.id,
            agentKey,
            { body: prompt, gameId },
            resolvedUser,
          );

          const waitForCompletion = args.waitForCompletion !== false;
          if (!waitForCompletion) {
            return {
              queued: true,
              studioId: studio.id,
              agentKey,
              message: posted.message,
              task: posted.task,
            };
          }

          const timeoutMs =
            typeof args.timeoutMs === 'number' ? args.timeoutMs : 120_000;
          const waitResult = await this.waitForTaskCompletion({
            studioId: studio.id,
            taskId: posted.task.id,
            agentKey,
            timeoutMs,
          });

          return {
            studioId: studio.id,
            agentKey,
            userMessage: posted.message,
            ...waitResult,
          };
        },
      },

      {
        name: 'get_agent_messages',
        category: 'Lead & Agent Chat',
        title: 'Get Agent Chat History',
        description:
          'Read recent chat messages (USER, AGENT, SYSTEM) from Lead or any specialist agent.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Agent key (defaults to "lead").',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to return (1-100, default: 25).',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          agentKey: 'lead',
          limit: 20,
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const agentKey = this.parseAgentKeyParam(args.agentKey, 'lead');
          const limit = Math.min(100, Math.max(1, Number(args.limit) || 25));
          return this.agentMessages.list(studio.id, agentKey, undefined, limit);
        },
      },

      {
        name: 'answer_now',
        category: 'Lead & Agent Chat',
        title: 'Force Gemini "Answer Now" (Stop Recursive Thinking)',
        description:
          'Clicks Gemini Web\'s "Answer now" button on the active browser tab for an agent run to immediately stop recursive thinking and force Gemini to output its answer.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Optional agent key (e.g. "lead") currently thinking.',
            },
            runId: {
              type: 'string',
              description: 'Optional active run UUID.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          agentKey: 'lead',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const agentKey = args.agentKey
            ? this.parseAgentKeyParam(args.agentKey)
            : undefined;
          const runId =
            typeof args.runId === 'string' && args.runId.trim()
              ? args.runId.trim()
              : undefined;
          return this.llm.triggerAnswerNow(studio.id, { runId, agentKey });
        },
      },

      {
        name: 'clear_agent_chat',
        category: 'Lead & Agent Chat',
        title: 'Clear Agent Chat & Runs',
        description:
          'Deletes all runs, tasks, and chat history for a single agent (plus its Gemini Web chat) or across all 15 studio agents when allAgents=true.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Agent key to clear (ignored if allAgents is true).',
            },
            allAgents: {
              type: 'boolean',
              description: 'If true, clears all runs and messages across all 15 studio agents.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          agentKey: 'lead',
          allAgents: false,
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          if (args.allAgents === true) {
            return this.agents.deleteAllStudioRuns(studio.id);
          }
          const agentKey = this.parseAgentKeyParam(args.agentKey, 'lead');
          return this.agents.deleteAgentRuns(studio.id, agentKey);
        },
      },

      // ── 2. AGENTS & RUNS ─────────────────────────────────────────────────
      {
        name: 'list_agents',
        category: 'Agents & Runs',
        title: 'List All 15 Studio Agents',
        description:
          'Returns all 15 studio agents with their current status (IDLE, WORKING, QUEUED, WAITING_ON_HUMAN, ERROR), bound model label, active task/run, and last activity snippet.',
        inputSchema: {
          type: 'object',
          properties: {
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {},
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          return this.agents.list(studio.id);
        },
      },

      {
        name: 'get_agent_detail',
        category: 'Agents & Runs',
        title: 'Get Agent Configuration & Detail',
        description:
          'Returns full details for a specific studio agent including systemPrompt, modelId, provider, temperature, maxOutputTokens, enabled tools, and Vault bindings.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Agent key (e.g. "lead", "architect", "builder").',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['agentKey'],
        },
        exampleArgs: {
          agentKey: 'lead',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const agentKey = this.parseAgentKeyParam(args.agentKey, 'lead');
          return this.agents.getDetail(studio.id, agentKey);
        },
      },

      {
        name: 'update_agent_config',
        category: 'Agents & Runs',
        title: 'Update Agent Configuration',
        description:
          'Updates an agent\'s modelId, llmConnectionId, systemPrompt, temperature, maxOutputTokens, or isEnabled state. Set applyToAllAgents=true to also bind the modelId across all 15 studio agents.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Agent key to update.',
            },
            modelId: {
              type: 'string',
              description:
                'Optional model identifier (e.g. "gemini-web:3.5-flash-lite?thinking=medium", "gemini-web:3.8-flash?thinking=high", "gemini-web-guest:3.5-flash-lite").',
            },
            llmConnectionId: {
              type: 'string',
              description: 'Optional LLM connection UUID.',
            },
            systemPrompt: {
              type: 'string',
              description: 'Optional updated system prompt.',
            },
            temperature: {
              type: 'number',
              description: 'Optional sampling temperature (0.0 - 2.0).',
            },
            maxOutputTokens: {
              type: 'number',
              description: 'Optional max output tokens.',
            },
            isEnabled: {
              type: 'boolean',
              description: 'Optional enabled flag.',
            },
            applyToAllAgents: {
              type: 'boolean',
              description:
                'If true and modelId is provided, binds all 15 agents to this modelId.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['agentKey'],
        },
        exampleArgs: {
          agentKey: 'lead',
          modelId: 'gemini-web:3.8-flash?thinking=medium',
          applyToAllAgents: true,
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const agentKey = this.parseAgentKeyParam(args.agentKey, 'lead');
          const detail: AgentDetailDto = await this.agents.update(studio.id, agentKey, {
            ...(typeof args.modelId === 'string' ? { modelId: args.modelId } : {}),
            ...(typeof args.llmConnectionId === 'string'
              ? { llmConnectionId: args.llmConnectionId }
              : {}),
            ...(typeof args.systemPrompt === 'string'
              ? { systemPrompt: args.systemPrompt }
              : {}),
            ...(typeof args.temperature === 'number'
              ? { temperature: args.temperature }
              : {}),
            ...(typeof args.maxOutputTokens === 'number'
              ? { maxOutputTokens: args.maxOutputTokens }
              : {}),
            ...(typeof args.isEnabled === 'boolean' ? { isEnabled: args.isEnabled } : {}),
          });

          if (
            args.applyToAllAgents === true &&
            typeof args.modelId === 'string' &&
            detail.llmConnectionId
          ) {
            await this.llm.bindAllAgents(
              studio.id,
              detail.llmConnectionId,
              args.modelId,
            );
          }
          return detail;
        },
      },

      {
        name: 'list_agent_runs',
        category: 'Agents & Runs',
        title: 'List Agent Runs',
        description:
          'Lists recent execution runs for a given agent with status, modelId, token usage, tool call count, and summary.',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Agent key (defaults to "lead").',
            },
            limit: {
              type: 'number',
              description: 'Max runs to return (1-100, default: 20).',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          agentKey: 'lead',
          limit: 10,
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const agentKey = this.parseAgentKeyParam(args.agentKey, 'lead');
          const limit = Math.min(100, Math.max(1, Number(args.limit) || 20));
          return this.agents.listRuns(studio.id, agentKey, undefined, limit);
        },
      },

      {
        name: 'get_run_detail',
        category: 'Agents & Runs',
        title: 'Get Run Logs, Tool Calls & Artifacts',
        description:
          'Returns the complete details of an agent run (runId), including all streamed log entries (TEXT, TOOL_CALL, TOOL_RESULT, SYSTEM), code/Luau artifacts, and injected Vault documents.',
        inputSchema: {
          type: 'object',
          properties: {
            runId: {
              type: 'string',
              description: 'The UUID of the agent run.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['runId'],
        },
        exampleArgs: {
          runId: 'replace-with-run-uuid',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const runId = String(args.runId ?? '').trim();
          if (!runId) {
            throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'runId is required');
          }
          return this.agents.getRunDetail(studio.id, runId);
        },
      },

      {
        name: 'wait_for_run',
        category: 'Agents & Runs',
        title: 'Wait for Run or Task Completion',
        description:
          'Waits until a running taskId or runId reaches a terminal status (DONE, FAILED, CANCELLED, NEEDS_HUMAN) and returns the final output, log entries, and subtasks.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Task UUID to wait on (provide taskId or runId).',
            },
            runId: {
              type: 'string',
              description: 'Run UUID to wait on (provide taskId or runId).',
            },
            waitForSubtasks: {
              type: 'boolean',
              description: 'Also wait for child tasks delegated by this task.',
            },
            timeoutMs: {
              type: 'number',
              description: 'Max wait time in ms (default: 120000).',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          taskId: 'replace-with-task-uuid',
          waitForSubtasks: true,
          timeoutMs: 120000,
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          let taskId = typeof args.taskId === 'string' ? args.taskId.trim() : '';
          const runId = typeof args.runId === 'string' ? args.runId.trim() : '';

          if (!taskId && runId) {
            const run = await this.agents.getRunDetail(studio.id, runId);
            taskId = run.taskId;
          }
          if (!taskId) {
            throw new AppError(
              'VALIDATION_FAILED',
              HttpStatus.BAD_REQUEST,
              'Either taskId or runId is required',
            );
          }

          const task = await this.tasks.getById(studio.id, taskId);
          const timeoutMs =
            typeof args.timeoutMs === 'number' ? args.timeoutMs : 120_000;
          return this.waitForTaskCompletion({
            studioId: studio.id,
            taskId: task.id,
            agentKey: task.agentKey,
            timeoutMs,
            waitForSubtasks: Boolean(args.waitForSubtasks),
          });
        },
      },

      {
        name: 'cancel_run',
        category: 'Agents & Runs',
        title: 'Cancel Active Agent Run',
        description: 'Aborts a currently running agent execution by runId.',
        inputSchema: {
          type: 'object',
          properties: {
            runId: {
              type: 'string',
              description: 'The UUID of the running execution to cancel.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['runId'],
        },
        exampleArgs: {
          runId: 'replace-with-run-uuid',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const runId = String(args.runId ?? '').trim();
          return this.agents.cancelRun(studio.id, runId);
        },
      },

      // ── 3. MODELS, BROWSER & WEB CHATS ───────────────────────────────────
      {
        name: 'list_llm_connections',
        category: 'Models, Browser & Web Chats',
        title: 'List LLM Connections & Available Models',
        description:
          'Lists all LLM provider connections configured for the studio along with the supported Gemini Web, Guest Mode, and Google AI Studio model IDs.',
        inputSchema: {
          type: 'object',
          properties: {
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {},
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const connections = await this.llm.list(studio.id);
          return {
            studioId: studio.id,
            connections,
            supportedWebModels: [
              'gemini-web:3.5-flash-lite?thinking=low',
              'gemini-web:3.5-flash-lite?thinking=medium',
              'gemini-web:3.5-flash-lite?thinking=high',
              'gemini-web:3.8-flash?thinking=low',
              'gemini-web:3.8-flash?thinking=medium',
              'gemini-web:3.8-flash?thinking=high',
              'gemini-web:3.1-pro?thinking=low',
              'gemini-web:3.1-pro?thinking=medium',
              'gemini-web:3.1-pro?thinking=high',
              'gemini-web:4.0-argon?thinking=low',
              'gemini-web:4.0-argon?thinking=medium',
              'gemini-web:4.0-argon?thinking=high',
              'gemini-web-guest:3.5-flash-lite',
              'aistudio:gemini-3.0-flash?thinking=medium&tools=googleSearch&mediaRes=default',
              'aistudio:gemini-3.1-flash-lite?thinking=low&tools=googleSearch&mediaRes=default',
              'aistudio:gemini-3.1-pro?thinking=high&tools=googleSearch,urlContext&mediaRes=default',
              'aistudio:gemini-3.5-flash-lite?thinking=low&tools=googleSearch&mediaRes=default',
              'aistudio:gemini-3.8-flash?thinking=medium&tools=googleSearch,urlContext&mediaRes=default',
              'aistudio:gemini-4-argon?thinking=high&tools=googleSearch,urlContext,codeExecution&mediaRes=default',
            ],
          };
        },
      },

      {
        name: 'set_studio_model',
        category: 'Models, Browser & Web Chats',
        title: 'Set Model & Thinking Level for All 15 Agents',
        description:
          'Binds all 15 studio agents to the specified model and thinking level (e.g. "gemini-web:3.5-flash-lite", "gemini-web:3.8-flash", "gemini-web:3.1-pro", "gemini-web:4.0-argon", "gemini-web-guest:3.5-flash-lite", or "aistudio:gemini-3.8-flash").',
        inputSchema: {
          type: 'object',
          properties: {
            baseModel: {
              type: 'string',
              description:
                'Base model ID, e.g. "gemini-web:3.5-flash-lite", "gemini-web:3.8-flash", "gemini-web:3.1-pro", "gemini-web:4.0-argon", "gemini-web-guest:3.5-flash-lite", or full modelId string.',
            },
            thinkingLevel: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description:
                'Thinking level ("low", "medium", "high"). Ignored for Guest Mode which uses automatic thinking.',
            },
            connectionId: {
              type: 'string',
              description:
                'Optional LLM connection UUID. Defaults to the studio\'s active GOOGLE_WEB or primary connection.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['baseModel'],
        },
        exampleArgs: {
          baseModel: 'gemini-web:3.5-flash-lite',
          thinkingLevel: 'medium',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const rawBase = String(args.baseModel ?? '').trim();
          const thinking =
            args.thinkingLevel === 'low' || args.thinkingLevel === 'high'
              ? args.thinkingLevel
              : 'medium';

          let fullModelId = rawBase;
          if (!rawBase.includes('?') && !rawBase.startsWith('gemini-web-guest:')) {
            if (rawBase.startsWith('aistudio:')) {
              fullModelId = `${rawBase}?thinking=${thinking}&tools=googleSearch,urlContext&mediaRes=default`;
            } else if (rawBase.startsWith('gemini-web:')) {
              fullModelId = `${rawBase}?thinking=${thinking}`;
            }
          }

          const connections = await this.llm.list(studio.id);
          const targetConn =
            (typeof args.connectionId === 'string'
              ? connections.find((c) => c.id === args.connectionId)
              : undefined) ??
            connections.find((c) => c.provider === 'GOOGLE_WEB' && c.isEnabled) ??
            connections.find((c) => c.isEnabled) ??
            connections[0];

          if (!targetConn) {
            throw new AppError(
              'NOT_FOUND',
              HttpStatus.NOT_FOUND,
              'No LLM connection configured for this studio',
            );
          }

          return this.llm.bindAllAgents(studio.id, targetConn.id, fullModelId);
        },
      },

      {
        name: 'get_browser_visibility',
        category: 'Models, Browser & Web Chats',
        title: 'Get Agent Browser Visibility Status',
        description:
          'Returns whether the Playwright Chromium browser window where agents run is currently visible on screen or hidden, and whether the studio defaults to headless mode.',
        inputSchema: {
          type: 'object',
          properties: {
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {},
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          return this.llm.getBrowserVisibility(studio.id);
        },
      },

      {
        name: 'set_browser_visibility',
        category: 'Models, Browser & Web Chats',
        title: 'Show or Hide Agent Browser Window',
        description:
          'Shows or hides the live Chromium browser window where agents interact with Gemini Web / AI Studio. Optionally also updates the studio\'s default headless setting.',
        inputSchema: {
          type: 'object',
          properties: {
            visible: {
              type: 'boolean',
              description: 'true to show the browser window on screen, false to hide it.',
            },
            updateStudioDefault: {
              type: 'boolean',
              description:
                'If true, also persists browserHeadless = !visible on the studio settings.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['visible'],
        },
        exampleArgs: {
          visible: true,
          updateStudioDefault: false,
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const visible = Boolean(args.visible);
          if (args.updateStudioDefault === true) {
            await this.studios.update(studio.id, { browserHeadless: !visible });
          }
          return this.llm.setBrowserVisibility(studio.id, visible);
        },
      },

      {
        name: 'list_web_chats',
        category: 'Models, Browser & Web Chats',
        title: 'List Tracked Gemini Web / AI Studio Chats',
        description:
          'Lists all tracked Gemini Web and Google AI Studio chat sessions created by studio agents (with chatTitle, externalChatId, responsible agentKey, createdAt, and status).',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Optional agentKey filter.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {},
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const agentKey = args.agentKey
            ? this.parseAgentKeyParam(args.agentKey)
            : undefined;
          return this.llm.listWebChats(studio.id, agentKey);
        },
      },

      {
        name: 'delete_web_chats',
        category: 'Models, Browser & Web Chats',
        title: 'Delete Agent-Created Web Chats',
        description:
          'Deletes agent-created chats from Gemini Web / AI Studio (never touches personal user chats). Supports deleting chats from the last run ("last_run"), a specific agent ("agent"), or a single chat record ("single"), plus toggling autoDeleteCreatedChats.',
        inputSchema: {
          type: 'object',
          properties: {
            scope: {
              type: 'string',
              enum: ['last_run', 'agent', 'single'],
              description: 'Which agent-created web chats to delete (default: "last_run").',
            },
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Required when scope === "agent".',
            },
            chatId: {
              type: 'string',
              description: 'Database WebChatSession ID, required when scope === "single".',
            },
            autoDeleteCreatedChats: {
              type: 'boolean',
              description:
                'Optional: update the studio setting to automatically delete agent-created web chats when each task finishes.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          scope: 'last_run',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          if (typeof args.autoDeleteCreatedChats === 'boolean') {
            await this.studios.update(studio.id, {
              autoDeleteCreatedChats: args.autoDeleteCreatedChats,
            });
          }
          const scope = String(args.scope ?? 'last_run');
          if (scope === 'agent') {
            const agentKey = this.parseAgentKeyParam(args.agentKey, 'lead');
            return this.llm.deleteAgentWebChats(studio.id, agentKey);
          }
          if (scope === 'single') {
            const chatId = String(args.chatId ?? '').trim();
            if (!chatId) {
              throw new AppError(
                'VALIDATION_FAILED',
                HttpStatus.BAD_REQUEST,
                'chatId is required when scope is "single"',
              );
            }
            return this.llm.deleteSingleWebChat(studio.id, chatId);
          }
          return this.llm.deleteLastRunWebChats(studio.id);
        },
      },

      // ── 4. TASKS & QUEUE ─────────────────────────────────────────────────
      {
        name: 'list_tasks',
        category: 'Tasks & Queue',
        title: 'List Studio Tasks',
        description:
          'Lists tasks in the studio queue with optional filters for status (QUEUED, RUNNING, NEEDS_HUMAN, BLOCKED, PAUSED, DONE, FAILED, CANCELLED), agentKey, and gameId.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: [
                'QUEUED',
                'RUNNING',
                'NEEDS_HUMAN',
                'BLOCKED',
                'PAUSED',
                'DONE',
                'FAILED',
                'CANCELLED',
              ],
            },
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
            },
            gameId: {
              type: 'string',
            },
            limit: {
              type: 'number',
              description: 'Max tasks to return (default: 50).',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          limit: 20,
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const limit = Math.min(100, Math.max(1, Number(args.limit) || 50));
          return this.tasks.list(studio.id, {
            status:
              typeof args.status === 'string'
                ? (args.status as TaskStatus)
                : undefined,
            agentKey: args.agentKey
              ? this.parseAgentKeyParam(args.agentKey)
              : undefined,
            gameId: typeof args.gameId === 'string' ? args.gameId : undefined,
            limit,
          });
        },
      },

      {
        name: 'get_task_detail',
        category: 'Tasks & Queue',
        title: 'Get Task Detail & Subtasks',
        description:
          'Returns full details of a task (taskId), including its subtasks, dependency state, and run history.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Task UUID.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['taskId'],
        },
        exampleArgs: {
          taskId: 'replace-with-task-uuid',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const taskId = String(args.taskId ?? '').trim();
          return this.tasks.getDetail(studio.id, taskId);
        },
      },

      {
        name: 'create_task',
        category: 'Tasks & Queue',
        title: 'Create & Queue Agent Task',
        description:
          'Creates and queues a new task assigned to any studio agent (with priority, optional gameId, and tags).',
        inputSchema: {
          type: 'object',
          properties: {
            agentKey: {
              type: 'string',
              enum: AGENT_KEY_ENUM,
              description: 'Target studio agent key.',
            },
            title: {
              type: 'string',
              description: 'Short task title (4-140 chars).',
            },
            brief: {
              type: 'string',
              description: 'Detailed instructions for the agent.',
            },
            priority: {
              type: 'string',
              enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
              description: 'Task priority (default: "NORMAL").',
            },
            gameId: {
              type: 'string',
              description: 'Optional game UUID.',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['agentKey', 'title', 'brief'],
        },
        exampleArgs: {
          agentKey: 'frame',
          title: 'Build responsive top HUD currency bar',
          brief: 'Create a Roact/Fusion-style Luau module for the top HUD bar with coin & gem counters.',
          priority: 'HIGH',
        },
        handler: async (args, user) => {
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          const agentKey = this.parseAgentKeyParam(args.agentKey, 'lead');
          const title = String(args.title ?? '').trim();
          const brief = String(args.brief ?? '').trim();
          const priority =
            typeof args.priority === 'string'
              ? (args.priority as TaskPriority)
              : 'NORMAL';
          const gameId =
            typeof args.gameId === 'string' && args.gameId.trim()
              ? args.gameId.trim()
              : null;
          const tags = Array.isArray(args.tags)
            ? args.tags.map((t) => String(t))
            : [];

          return this.tasks.create(
            studio.id,
            { agentKey, title, brief, priority, gameId, tags },
            resolvedUser.id,
          );
        },
      },

      {
        name: 'cancel_task',
        category: 'Tasks & Queue',
        title: 'Cancel Task',
        description: 'Cancels a queued, running, or waiting task by taskId.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Task UUID to cancel.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['taskId'],
        },
        exampleArgs: {
          taskId: 'replace-with-task-uuid',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          return this.tasks.cancel(studio.id, String(args.taskId ?? '').trim());
        },
      },

      {
        name: 'retry_task',
        category: 'Tasks & Queue',
        title: 'Retry Failed or Cancelled Task',
        description: 'Re-queues a FAILED or CANCELLED task so its agent executes it again.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'Task UUID to retry.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['taskId'],
        },
        exampleArgs: {
          taskId: 'replace-with-task-uuid',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          return this.tasks.retry(studio.id, String(args.taskId ?? '').trim());
        },
      },

      // ── 5. STUDIO & LANES ────────────────────────────────────────────────
      {
        name: 'get_studio_snapshot',
        category: 'Studio & Lanes',
        title: 'Get Complete Live Studio Snapshot',
        description:
          'Returns the full real-time studio snapshot including studio settings, badge counts, all 15 agents, games, active runs, open human requests, and Roblox Studio lanes.',
        inputSchema: {
          type: 'object',
          properties: {
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {},
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          return this.snapshot.getSnapshot(studio.id, 'OWNER');
        },
      },

      {
        name: 'pause_or_resume_studio',
        category: 'Studio & Lanes',
        title: 'Pause/Resume Studio or Release Roblox Lane',
        description:
          'Pauses or resumes the studio orchestrator, or force-releases a held Roblox Studio execution lane.',
        inputSchema: {
          type: 'object',
          properties: {
            paused: {
              type: 'boolean',
              description: 'true to pause all runs in the studio, false to resume.',
            },
            releaseLaneId: {
              type: 'string',
              description: 'Optional StudioLane UUID to force-release.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          paused: false,
        },
        handler: async (args, user) => {
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          let laneResult: unknown = null;
          if (typeof args.releaseLaneId === 'string' && args.releaseLaneId.trim()) {
            laneResult = await this.lanes.forceRelease(
              studio.id,
              args.releaseLaneId.trim(),
            );
          }
          let studioDto: unknown = null;
          if (typeof args.paused === 'boolean') {
            studioDto = args.paused
              ? await this.studios.pause(studio.id, resolvedUser.displayName)
              : await this.studios.resume(studio.id, resolvedUser.displayName);
          }
          return {
            studio: studioDto ?? (await this.snapshot.getSnapshot(studio.id, 'OWNER')).studio,
            releasedLane: laneResult,
          };
        },
      },

      // ── 6. HUMAN REQUESTS ────────────────────────────────────────────────
      {
        name: 'list_human_requests',
        category: 'Human Requests',
        title: 'List "Needs You" Human Requests',
        description:
          'Lists human requests (clarifications, blockers, asset requests, pitch picks) created by agents.',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['OPEN', 'RESOLVED', 'DISMISSED'],
              description: 'Filter by status (default: "OPEN").',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          status: 'OPEN',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const status =
            args.status === 'RESOLVED' || args.status === 'DISMISSED'
              ? args.status
              : args.status === 'ALL'
                ? undefined
                : 'OPEN';
          return this.humanRequests.list(studio.id, status);
        },
      },

      {
        name: 'reply_human_request',
        category: 'Human Requests',
        title: 'Reply to or Resolve a Human Request',
        description:
          'Replies to an open human request (or resolves/dismisses it) so the waiting agent unblocks and resumes its task.',
        inputSchema: {
          type: 'object',
          properties: {
            requestId: {
              type: 'string',
              description: 'UUID of the HumanRequest.',
            },
            reply: {
              type: 'string',
              description: 'Reply text to send back to the waiting agent.',
            },
            optionId: {
              type: 'string',
              description: 'Optional ID of a structured multiple-choice option.',
            },
            dismiss: {
              type: 'boolean',
              description: 'If true, dismisses the request instead of replying.',
            },
            ...STUDIO_FILTER_PROPS,
          },
          required: ['requestId'],
        },
        exampleArgs: {
          requestId: 'replace-with-request-uuid',
          reply: 'Proceed with option A and keep round length at 180 seconds.',
        },
        handler: async (args, user) => {
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          const requestId = String(args.requestId ?? '').trim();
          if (args.dismiss === true) {
            return this.humanRequests.resolve(
              studio.id,
              requestId,
              { outcome: 'DISMISSED', note: String(args.reply ?? 'Dismissed via MCP') },
              resolvedUser,
            );
          }
          const bodyText = String(args.reply ?? 'Approved').trim();
          const optionId =
            typeof args.optionId === 'string' && args.optionId.trim()
              ? args.optionId.trim()
              : undefined;
          return this.humanRequests.reply(
            studio.id,
            requestId,
            { body: bodyText, optionId },
            resolvedUser,
          );
        },
      },

      // ── 7. GAMES & PITCHES ───────────────────────────────────────────────
      {
        name: 'list_games',
        category: 'Games & Pitches',
        title: 'List Games or Get Game Detail',
        description:
          'Lists all games in the studio, or returns full detail (milestones and recent builds) when gameId is provided.',
        inputSchema: {
          type: 'object',
          properties: {
            gameId: {
              type: 'string',
              description: 'Optional game UUID to retrieve full details.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {},
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          if (typeof args.gameId === 'string' && args.gameId.trim()) {
            return this.games.getDetail(studio.id, args.gameId.trim());
          }
          return this.games.list(studio.id);
        },
      },

      {
        name: 'create_or_update_game',
        category: 'Games & Pitches',
        title: 'Create or Update Game & Milestones',
        description:
          'Creates a new game in the studio (when gameId is omitted) or updates an existing game\'s metadata, status, or milestone status.',
        inputSchema: {
          type: 'object',
          properties: {
            gameId: {
              type: 'string',
              description: 'Provide to update an existing game; omit to create a new game.',
            },
            name: {
              type: 'string',
              description: 'Game title.',
            },
            genre: {
              type: 'string',
              description: 'Game genre (e.g. "Simulator", "Horror", "Obby").',
            },
            description: {
              type: 'string',
              description: 'Game description / logline.',
            },
            accentColor: {
              type: 'string',
              description: 'Hex color (e.g. "#A855F7").',
            },
            status: {
              type: 'string',
              enum: [
                'CONCEPT',
                'BLUEPRINT',
                'IN_PRODUCTION',
                'QA',
                'LIVE',
                'PAUSED',
                'ARCHIVED',
              ],
            },
            milestoneKey: {
              type: 'string',
              description: 'Optional milestone key to update (e.g. "concept", "core-loop").',
            },
            milestoneStatus: {
              type: 'string',
              enum: ['TODO', 'IN_PROGRESS', 'DONE'],
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          name: 'Neon Drift Tycoon',
          genre: 'Tycoon',
          description: 'Cyberpunk drift garage tycoon with tandem multiplayer drift battles.',
        },
        handler: async (args) => {
          const studio = await this.resolveStudio(args);
          const gameId = typeof args.gameId === 'string' ? args.gameId.trim() : '';

          if (!gameId) {
            const name = String(args.name ?? '').trim();
            const genre = String(args.genre ?? 'Simulator').trim();
            if (!name) {
              throw new AppError(
                'VALIDATION_FAILED',
                HttpStatus.BAD_REQUEST,
                'name is required when creating a new game',
              );
            }
            return this.games.create(studio.id, {
              name,
              genre,
              accentColor:
                typeof args.accentColor === 'string' ? args.accentColor : '#A855F7',
              description:
                typeof args.description === 'string' ? args.description : '',
            });
          }

          if (typeof args.milestoneKey === 'string' && args.milestoneKey.trim()) {
            const mStatus =
              args.milestoneStatus === 'DONE' || args.milestoneStatus === 'IN_PROGRESS'
                ? args.milestoneStatus
                : 'TODO';
            await this.games.upsertMilestoneByKey(
              studio.id,
              gameId,
              args.milestoneKey.trim(),
              mStatus,
            );
          }

          await this.games.update(studio.id, gameId, {
            ...(typeof args.name === 'string' ? { name: args.name } : {}),
            ...(typeof args.genre === 'string' ? { genre: args.genre } : {}),
            ...(typeof args.description === 'string'
              ? { description: args.description }
              : {}),
            ...(typeof args.accentColor === 'string'
              ? { accentColor: args.accentColor }
              : {}),
            ...(typeof args.status === 'string'
              ? { status: args.status as never }
              : {}),
          });

          return this.games.getDetail(studio.id, gameId);
        },
      },

      {
        name: 'manage_pitches',
        category: 'Games & Pitches',
        title: 'List, Generate, Pick, or Revise Game Pitches',
        description:
          'Manage studio game pitches: "list" all pitches, "get" full pitch sections, "generate" a new market-backed pitch via Pulse, "pick" a pitch to promote it into a game, or "request_changes" on a pitch.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'get', 'generate', 'pick', 'request_changes'],
              description: 'Operation to perform (default: "list").',
            },
            pitchId: {
              type: 'string',
              description: 'Pitch UUID (for get, pick, request_changes).',
            },
            status: {
              type: 'string',
              enum: ['PROPOSED', 'PICKED', 'CHANGES_REQUESTED', 'ARCHIVED'],
            },
            focusGenre: {
              type: 'string',
              description: 'Optional focus genre when action === "generate".',
            },
            notes: {
              type: 'string',
              description: 'Optional operator notes when action === "generate" or feedback when action === "request_changes".',
            },
            gameName: {
              type: 'string',
              description: 'Optional custom game name when action === "pick".',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          action: 'list',
        },
        handler: async (args, user) => {
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          const action = String(args.action ?? 'list');

          switch (action) {
            case 'get': {
              const pitchId = String(args.pitchId ?? '').trim();
              return this.pitches.getDetail(studio.id, pitchId);
            }
            case 'generate':
              return this.pitches.generate(
                studio.id,
                {
                  focusGenre:
                    typeof args.focusGenre === 'string' ? args.focusGenre : null,
                  notes: typeof args.notes === 'string' ? args.notes : '',
                },
                resolvedUser.id,
              );
            case 'pick': {
              const pitchId = String(args.pitchId ?? '').trim();
              return this.pitches.pick(
                studio.id,
                pitchId,
                {
                  gameName:
                    typeof args.gameName === 'string' ? args.gameName : undefined,
                },
                resolvedUser.id,
              );
            }
            case 'request_changes': {
              const pitchId = String(args.pitchId ?? '').trim();
              const feedback = String(args.notes ?? args.feedback ?? '').trim();
              return this.pitches.requestChanges(
                studio.id,
                pitchId,
                { feedback: feedback || 'Please refine the core loop and retention hooks.' },
                resolvedUser.id,
              );
            }
            case 'list':
            default:
              return this.pitches.list(
                studio.id,
                typeof args.status === 'string'
                  ? (args.status as PitchStatus)
                  : undefined,
              );
          }
        },
      },

      // ── 8. MARKET INTELLIGENCE ───────────────────────────────────────────
      {
        name: 'query_market_leaderboard',
        category: 'Market Intelligence',
        title: 'Query Roblox Market Leaderboard',
        description:
          'Queries the Roblox market intelligence leaderboard (top-playing, top-earning, top-trending, breakout-7d, top-rated) or triggers a live market scrape when refresh=true.',
        inputSchema: {
          type: 'object',
          properties: {
            sort: {
              type: 'string',
              enum: [
                'top-playing-now',
                'top-earning',
                'up-and-coming',
                'top-rated',
              ],
              description: 'Sort category (default: "top-playing-now").',
            },
            genre: {
              type: 'string',
              description: 'Optional genre filter.',
            },
            search: {
              type: 'string',
              description: 'Optional game/creator search string.',
            },
            limit: {
              type: 'number',
              description: 'Max rows to return (default: 25).',
            },
            refresh: {
              type: 'boolean',
              description: 'If true, triggers a fresh market ingestion run first.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          sort: 'up-and-coming',
          limit: 15,
        },
        handler: async (args, user) => {
          if (args.refresh === true) {
            const studio = await this.resolveStudio(args);
            const resolvedUser = await this.resolveUser(studio.id, user);
            await this.market.triggerRefresh(resolvedUser.id).catch(() => null);
          }
          const sort =
            args.sort === 'top-earning' ||
            args.sort === 'up-and-coming' ||
            args.sort === 'top-rated'
              ? args.sort
              : 'top-playing-now';
          const limit = Math.min(100, Math.max(1, Number(args.limit) || 25));
          return this.market.leaderboard({
            sort,
            genre: typeof args.genre === 'string' ? args.genre : undefined,
            search: typeof args.search === 'string' ? args.search : undefined,
            limit,
          });
        },
      },

      // ── 9. VAULT & REVIEWS ───────────────────────────────────────────────
      {
        name: 'vault_operations',
        category: 'Vault & Reviews',
        title: 'Search, Read, or Write Vault Knowledge Documents',
        description:
          'Interact with the studio\'s Obsidian-style Markdown Vault: "tree" lists all folders/files, "search" performs full-text search, "read" reads a document by path or docId, "create" creates a new document, and "update" updates an existing document.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['tree', 'search', 'read', 'create', 'update'],
              description: 'Vault operation to run (default: "tree").',
            },
            query: {
              type: 'string',
              description: 'Search query when action === "search".',
            },
            path: {
              type: 'string',
              description: 'Document path (e.g. "01-Studio-SOPs/Studio-Charter.md") when reading or updating.',
            },
            docId: {
              type: 'string',
              description: 'Document UUID (alternative to path).',
            },
            folderId: {
              type: 'string',
              description: 'Target folder UUID when action === "create" (optional; defaults to root folder).',
            },
            title: {
              type: 'string',
              description: 'Document title when creating or updating.',
            },
            markdown: {
              type: 'string',
              description: 'Markdown content when creating or updating.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          action: 'tree',
        },
        handler: async (args, user) => {
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          const action = String(args.action ?? 'tree');

          switch (action) {
            case 'search': {
              const q = String(args.query ?? '').trim();
              return this.vaultSearch.search(studio.id, q, 15);
            }
            case 'read': {
              if (typeof args.docId === 'string' && args.docId.trim()) {
                return this.vault.getDocument(studio.id, args.docId.trim());
              }
              const docPath = String(args.path ?? '').trim();
              return this.vault.getDocumentByPath(studio.id, docPath);
            }
            case 'create': {
              const title = String(args.title ?? 'Untitled Note').trim();
              const markdown = String(args.markdown ?? '');
              let folderId =
                typeof args.folderId === 'string' ? args.folderId.trim() : '';
              if (!folderId) {
                const tree = await this.vault.tree(studio.id);
                const firstFolder = tree.find((n) => n.type === 'folder');
                if (!firstFolder) {
                  throw new AppError(
                    'NOT_FOUND',
                    HttpStatus.NOT_FOUND,
                    'No vault folder found',
                  );
                }
                folderId = firstFolder.id;
              }
              return this.vault.createDocument(
                studio.id,
                { folderId, title, markdown },
                resolvedUser,
              );
            }
            case 'update': {
              let docId = typeof args.docId === 'string' ? args.docId.trim() : '';
              if (!docId && typeof args.path === 'string' && args.path.trim()) {
                const existing = await this.vault.getDocumentByPath(
                  studio.id,
                  args.path.trim(),
                );
                docId = existing.id;
              }
              if (!docId) {
                throw new AppError(
                  'VALIDATION_FAILED',
                  HttpStatus.BAD_REQUEST,
                  'Provide docId or path to update a Vault document',
                );
              }
              return this.vault.save(
                studio.id,
                docId,
                {
                  markdown: String(args.markdown ?? ''),
                  ...(typeof args.title === 'string' ? { title: args.title } : {}),
                },
                {
                  kind: 'USER',
                  userId: resolvedUser.id,
                  label: resolvedUser.displayName,
                  reason: 'Updated via MCP',
                },
              );
            }
            case 'tree':
            default:
              return this.vault.tree(studio.id);
          }
        },
      },

      {
        name: 'review_operations',
        category: 'Vault & Reviews',
        title: 'List or Apply Verdict to Review Queue Items',
        description:
          'Manage the studio Review Queue: "list" items by tab (IMAGES_VIDEO or STAGES_PUBLISH), "detail" inspects a review item, and "verdict" submits APPROVE, REQUEST_CHANGES, or REJECT.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'detail', 'verdict'],
              description: 'Operation to perform (default: "list").',
            },
            tab: {
              type: 'string',
              enum: ['IMAGES_VIDEO', 'STAGES_PUBLISH'],
              description: 'Review tab when action === "list" (default: "STAGES_PUBLISH").',
            },
            status: {
              type: 'string',
              enum: ['TO_REVIEW', 'CHANGES_ASKED', 'APPROVED', 'REJECTED', 'ALL'],
            },
            itemId: {
              type: 'string',
              description: 'ReviewItem UUID (for detail or verdict).',
            },
            verdict: {
              type: 'string',
              enum: ['APPROVE', 'ASK_CHANGES', 'REJECT'],
              description: 'Verdict when action === "verdict".',
            },
            feedback: {
              type: 'string',
              description: 'Feedback comment when submitting a verdict.',
            },
            ...STUDIO_FILTER_PROPS,
          },
        },
        exampleArgs: {
          action: 'list',
          tab: 'STAGES_PUBLISH',
          status: 'TO_REVIEW',
        },
        handler: async (args, user) => {
          const studio = await this.resolveStudio(args);
          const resolvedUser = await this.resolveUser(studio.id, user);
          const action = String(args.action ?? 'list');

          switch (action) {
            case 'detail': {
              const itemId = String(args.itemId ?? '').trim();
              return this.review.getDetail(studio.id, itemId);
            }
            case 'verdict': {
              const itemId = String(args.itemId ?? '').trim();
              const feedbackText =
                typeof args.feedback === 'string' ? args.feedback : undefined;
              if (args.verdict === 'ASK_CHANGES' || args.verdict === 'REQUEST_CHANGES') {
                return this.review.applyVerdict(
                  studio.id,
                  itemId,
                  {
                    verdict: 'ASK_CHANGES',
                    feedback: feedbackText || 'Please address the requested changes.',
                  },
                  resolvedUser,
                );
              }
              return this.review.applyVerdict(
                studio.id,
                itemId,
                {
                  verdict: args.verdict === 'REJECT' ? 'REJECT' : 'APPROVE',
                  feedback: feedbackText,
                },
                resolvedUser,
              );
            }
            case 'list':
            default: {
              const tab: ReviewTab =
                args.tab === 'IMAGES_VIDEO' ? 'IMAGES_VIDEO' : 'STAGES_PUBLISH';
              const status: ReviewStatus | 'ALL' =
                args.status === 'CHANGES_ASKED' ||
                args.status === 'APPROVED' ||
                args.status === 'REJECTED' ||
                args.status === 'ALL'
                  ? args.status
                  : 'TO_REVIEW';
              return this.review.list(studio.id, { tab, status });
            }
          }
        },
      },
    ];
  }
}
