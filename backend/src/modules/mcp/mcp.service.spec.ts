import { describe, expect, it, vi } from 'vitest';
import { McpService } from './mcp.service.js';

function createMockMcpService() {
  const prisma = {
    studio: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([
        { id: 'studio-seed', slug: 'seed-studio', name: 'Seed Studio' },
        { id: 'studio-active', slug: 'inclined-games', name: 'Inclined Games' },
      ]),
    },
    agent: {
      findFirst: vi.fn().mockResolvedValue({
        studio: {
          id: 'studio-active',
          slug: 'inclined-games',
          name: 'Inclined Games',
        },
      }),
    },
    llmConnection: {
      findFirst: vi.fn().mockResolvedValue({
        studio: {
          id: 'studio-active',
          slug: 'inclined-games',
          name: 'Inclined Games',
        },
      }),
    },
    studioMembership: {
      findFirst: vi.fn().mockResolvedValue({
        user: {
          id: 'user-1',
          email: 'founder@robdev.local',
          displayName: 'Founder',
        },
      }),
    },
    user: {
      findFirst: vi.fn(),
    },
    agentRun: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };

  const config = {
    port: 3000,
  };

  const studios = {};
  const snapshot = {
    getStudioSnapshot: vi.fn().mockResolvedValue({
      studio: { id: 'studio-active', slug: 'inclined-games', name: 'Inclined Games' },
      agents: [],
      runningTasks: [],
      openBlockers: [],
      openHumanRequests: [],
    }),
  };
  const agents = {
    listForStudio: vi.fn().mockResolvedValue([]),
    getDetail: vi.fn().mockResolvedValue({
      key: 'lead',
      name: 'Lead',
      modelId: 'gemini-web:3.8-pro',
    }),
    update: vi.fn(),
    listRuns: vi.fn().mockResolvedValue([]),
    getRunDetail: vi.fn(),
    cancelRun: vi.fn(),
  };
  const agentMessages = {
    postUserMessage: vi.fn().mockResolvedValue({
      message: {
        id: 'msg-user-1',
        author: 'USER',
        body: 'Build a sword fighting arena',
      },
      ackMessage: {
        id: 'msg-ack-1',
        author: 'SYSTEM',
        body: 'Initializing agents...',
      },
      task: {
        id: 'task-1',
        title: 'Build a sword fighting arena',
        status: 'QUEUED',
      },
    }),
    list: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'msg-reply-1',
          author: 'AGENT',
          body: 'Here is the complete arena breakdown.',
          runId: 'run-1',
          taskId: 'task-1',
          createdAt: new Date().toISOString(),
        },
      ],
      nextCursor: null,
    }),
    clearForAgent: vi.fn().mockResolvedValue({ deletedRuns: 1, deletedMessages: 4 }),
    clearAllForStudio: vi.fn().mockResolvedValue({ deletedRuns: 2, deletedMessages: 8 }),
  };
  const llm = {
    list: vi.fn().mockResolvedValue([]),
    bindAllAgents: vi.fn().mockResolvedValue({
      boundCount: 15,
      modelId: 'gemini-web:3.8-pro?thinking=high',
    }),
    getBrowserVisibility: vi.fn().mockResolvedValue({
      visible: false,
      running: true,
      defaultHeadless: true,
    }),
    setBrowserVisibility: vi.fn().mockResolvedValue({
      visible: true,
      running: true,
      defaultHeadless: true,
    }),
    triggerAnswerNow: vi.fn().mockResolvedValue({
      clicked: true,
      agentKey: 'lead',
      message: 'Clicked "Answer now" in the browser.',
    }),
    listWebChatSessions: vi.fn().mockResolvedValue([]),
    deleteLastRunWebChatSessions: vi.fn().mockResolvedValue({
      deletedCount: 2,
      deletedFromWebCount: 2,
      message: 'Deleted 2 web chats',
    }),
    deleteAgentWebChatSessions: vi.fn(),
    deleteWebChatSessionById: vi.fn(),
  };
  const tasks = {
    list: vi.fn().mockResolvedValue([]),
    getDetail: vi.fn().mockResolvedValue({
      id: 'task-1',
      status: 'DONE',
      resultSummary: 'Done',
      latestRunId: null,
      subtasks: [],
    }),
    createAndQueue: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
  };
  const humanRequests = {
    list: vi.fn().mockResolvedValue([]),
    reply: vi.fn(),
  };
  const games = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
  };
  const pitches = {
    list: vi.fn().mockResolvedValue([]),
    getDetail: vi.fn(),
    generate: vi.fn(),
    pick: vi.fn(),
    requestChanges: vi.fn(),
  };
  const market = {
    leaderboard: vi.fn().mockResolvedValue([]),
    triggerRefresh: vi.fn(),
  };
  const vault = {
    tree: vi.fn().mockResolvedValue([]),
    getDocument: vi.fn(),
    getDocumentByPath: vi.fn(),
    createDocument: vi.fn(),
    save: vi.fn(),
  };
  const vaultSearch = {
    search: vi.fn().mockResolvedValue([]),
  };
  const review = {
    list: vi.fn().mockResolvedValue([]),
    getDetail: vi.fn(),
    applyVerdict: vi.fn(),
  };
  const lanes = {
    listForStudio: vi.fn().mockResolvedValue([]),
    forceRelease: vi.fn(),
  };

  const service = new McpService(
    prisma as never,
    config as never,
    studios as never,
    snapshot as never,
    agents as never,
    agentMessages as never,
    llm as never,
    tasks as never,
    humanRequests as never,
    games as never,
    pitches as never,
    market as never,
    vault as never,
    vaultSearch as never,
    review as never,
    lanes as never,
  );

  return {
    service,
    prisma,
    agentMessages,
    llm,
    tasks,
    snapshot,
  };
}

describe('McpService', () => {
  it('exposes server info and all 33 MCP tools across 9 categories', async () => {
    const { service } = createMockMcpService();
    const info = await service.getServerInfo('http://localhost:3000');

    expect(info.serverName).toBe('robdev-control-room-mcp');
    expect(info.httpEndpoint).toBe('http://localhost:3000/api/mcp');
    expect(info.defaultStudioSlug).toBe('inclined-games');
    expect(info.tools.length).toBe(33);
    expect(info.tools.some((t) => t.name === 'prompt_lead')).toBe(true);
    expect(info.tools.some((t) => t.name === 'answer_now')).toBe(true);
  });

  it('prompts the Lead agent in the active studio when prompt_lead is called', async () => {
    const { service, agentMessages } = createMockMcpService();

    const result = await service.executeTool('prompt_lead', {
      prompt: 'Build a sword fighting arena',
      waitForCompletion: false,
    });

    expect(result.isError).toBe(false);
    expect(agentMessages.postUserMessage).toHaveBeenCalledWith(
      'studio-active',
      'lead',
      { body: 'Build a sword fighting arena', gameId: null },
      expect.objectContaining({ id: 'user-1' }),
    );
    expect(result.structuredContent).toMatchObject({
      queued: true,
      studioId: 'studio-active',
      studioSlug: 'inclined-games',
    });
  });

  it('handles JSON-RPC initialize, tools/list, and tools/call requests', async () => {
    const { service, llm } = createMockMcpService();

    const initRes = await service.handleJsonRpcPayload({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05' },
    });

    expect(initRes).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'robdev-control-room-mcp',
        },
      },
    });

    const listRes = await service.handleJsonRpcPayload({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    expect(listRes).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
    });

    const callRes = await service.handleJsonRpcPayload({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'answer_now',
        arguments: { agentKey: 'lead' },
      },
    });
    expect(llm.triggerAnswerNow).toHaveBeenCalledWith('studio-active', {
      runId: undefined,
      agentKey: 'lead',
    });
    expect(callRes).toMatchObject({
      jsonrpc: '2.0',
      id: 3,
      result: {
        isError: false,
      },
    });
  });
});
