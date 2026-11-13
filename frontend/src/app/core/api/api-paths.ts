import type { AgentKey } from '@robdev/shared';
import { environment } from '../../../environments/environment';

const BASE = environment.apiBaseUrl;

export const API_PATHS = {
  health: () => `${BASE}/health`,
  auth: {
    register: () => `${BASE}/auth/register`,
    login: () => `${BASE}/auth/login`,
    refresh: () => `${BASE}/auth/refresh`,
    logout: () => `${BASE}/auth/logout`,
    me: () => `${BASE}/auth/me`,
  },
  studios: {
    list: () => `${BASE}/studios`,
    create: () => `${BASE}/studios`,
    snapshot: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/snapshot`,
    byId: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}`,
    pause: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/pause`,
    resume: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/resume`,
    members: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/members`,
    memberByUser: (studioId: string, userId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/members/${encodeURIComponent(userId)}`,
  },
  games: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/games`,
    create: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/games`,
    byId: (studioId: string, gameId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/games/${encodeURIComponent(gameId)}`,
    builds: (studioId: string, gameId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/games/${encodeURIComponent(gameId)}/builds`,
    milestone: (studioId: string, gameId: string, milestoneId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/games/${encodeURIComponent(gameId)}/milestones/${encodeURIComponent(milestoneId)}`,
    publish: (studioId: string, gameId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/games/${encodeURIComponent(gameId)}/publish`,
  },
  agents: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/agents`,
    byKey: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}`,
    vaultBindings: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/vault-bindings`,
    runs: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/runs`,
    allRuns: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/runs`,
    messages: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/messages`,
    chatArchives: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/chat/archives`,
    chatArchiveById: (studioId: string, agentKey: AgentKey, archiveId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/chat/archives/${encodeURIComponent(archiveId)}`,
    chatFreshStart: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/chat/fresh-start`,
    chatBranch: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/chat/branch`,
    chatRetry: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/chat/retry`,
    chatDeletePart: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/agents/${encodeURIComponent(agentKey)}/chat/delete-part`,
    runById: (studioId: string, runId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/runs/${encodeURIComponent(runId)}`,
    cancelRun: (studioId: string, runId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/runs/${encodeURIComponent(runId)}/cancel`,
    leadAsk: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/lead/ask`,
  },
  tasks: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/tasks`,
    create: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/tasks`,
    outputs: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/tasks/outputs`,
    outputById: (studioId: string, taskId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/tasks/${encodeURIComponent(taskId)}/output`,
    byId: (studioId: string, taskId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/tasks/${encodeURIComponent(taskId)}`,
    cancel: (studioId: string, taskId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/tasks/${encodeURIComponent(taskId)}/cancel`,
    retry: (studioId: string, taskId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/tasks/${encodeURIComponent(taskId)}/retry`,
    accept: (studioId: string, taskId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/tasks/${encodeURIComponent(taskId)}/accept`,
    feedback: (studioId: string, taskId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/tasks/${encodeURIComponent(taskId)}/feedback`,
  },
  media: {
    byId: (mediaId: string) => `/api/media/${encodeURIComponent(mediaId)}`,
    byPath: (filePath: string, studioSlug?: string) =>
      `/api/media/by-path?path=${encodeURIComponent(filePath)}${
        studioSlug ? `&studioSlug=${encodeURIComponent(studioSlug)}` : ''
      }`,
    openWith: () => `${BASE}/media/open-with`,
  },
  humanRequests: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/human-requests`,
    reply: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/human-requests/${encodeURIComponent(id)}/reply`,
    resolve: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/human-requests/${encodeURIComponent(id)}/resolve`,
  },
  review: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/review-items`,
    counts: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/review-items/counts`,
    byId: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/review-items/${encodeURIComponent(id)}`,
    verdict: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/review-items/${encodeURIComponent(id)}/verdict`,
    upload: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/review-items/upload`,
    blocker: (studioId: string, blockerId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/blockers/${encodeURIComponent(blockerId)}`,
  },
  pitches: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/pitches`,
    byId: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/pitches/${encodeURIComponent(id)}`,
    generate: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/pitches/generate`,
    pick: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/pitches/${encodeURIComponent(id)}/pick`,
    requestChanges: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/pitches/${encodeURIComponent(id)}/request-changes`,
  },
  market: {
    leaderboard: () => `${BASE}/market/leaderboard`,
    history: (universeId: string) =>
      `${BASE}/market/games/${encodeURIComponent(universeId)}/history`,
    ingestionRuns: () => `${BASE}/market/ingestion-runs`,
    refresh: () => `${BASE}/market/refresh`,
  },
  vault: {
    tree: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/vault/tree`,
    graph: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/vault/graph`,
    search: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/vault/search`,
    byPath: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/vault/by-path`,
    documents: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/vault/documents`,
    documentById: (studioId: string, docId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/vault/documents/${encodeURIComponent(docId)}`,
    revisions: (studioId: string, docId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/vault/documents/${encodeURIComponent(docId)}/revisions`,
    revisionByVersion: (studioId: string, docId: string, version: number) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/vault/documents/${encodeURIComponent(docId)}/revisions/${version}`,
    folders: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/vault/folders`,
  },
  assets: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/assets`,
    create: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/assets`,
    upload: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/assets/upload`,
    byId: (studioId: string, assetId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/assets/${encodeURIComponent(assetId)}`,
  },
  usage: {
    overview: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/usage`,
  },
  playbooks: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/playbooks`,
    create: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/playbooks`,
    byId: (studioId: string, playbookId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/playbooks/${encodeURIComponent(playbookId)}`,
    run: (studioId: string, playbookId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/playbooks/${encodeURIComponent(playbookId)}/run`,
  },
  workspace: {
    tree: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/workspace/tree`,
    file: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/workspace/file`,
    comments: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/workspace/file/comments`,
  },
  llm: {
    connections: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections`,
    localDetect: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/local-detect`,
    localRuntimes: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/local-runtimes`,
    browserVisibility: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/browser-visibility`,
    answerNow: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/answer-now`,
    webChats: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/web-chats`,
    webChatsLastRun: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/web-chats/last-run`,
    webChatsByAgent: (studioId: string, agentKey: AgentKey) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/web-chats/agent/${encodeURIComponent(agentKey)}`,
    webChatById: (studioId: string, chatId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/web-chats/${encodeURIComponent(chatId)}`,
    connectionById: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/${encodeURIComponent(id)}`,
    testConnection: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/${encodeURIComponent(id)}/test`,
    browserLogin: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/${encodeURIComponent(id)}/browser-login`,
    pullModel: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/${encodeURIComponent(id)}/pull-model`,
    runpodPod: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/${encodeURIComponent(id)}/runpod-pod`,
    bindAll: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/${encodeURIComponent(id)}/bind-all`,
    models: (studioId: string, id: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/llm/connections/${encodeURIComponent(id)}/models`,
  },
  lanes: {
    list: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/lanes`,
    create: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/lanes`,
    release: (studioId: string, laneId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/lanes/${encodeURIComponent(laneId)}/release`,
  },
  search: {
    quickJump: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/search`,
  },
  chat: {
    mentions: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/chat/mentions`,
    uploads: (studioId: string) => `${BASE}/studios/${encodeURIComponent(studioId)}/chat/uploads`,
    pickFolder: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/chat/pick-folder`,
    screenshot: (studioId: string) =>
      `${BASE}/studios/${encodeURIComponent(studioId)}/chat/screenshot`,
  },
  mcp: {
    info: () => `${BASE}/mcp/info`,
    rpc: () => `${BASE}/mcp`,
    callTool: (toolName: string) => `${BASE}/mcp/tools/${encodeURIComponent(toolName)}`,
  },
} as const;
