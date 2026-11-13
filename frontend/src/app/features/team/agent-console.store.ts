import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  AGENT_TOOL_DEFINITIONS,
  estimateTokens,
  type AgentDetailDto,
  type AgentKey,
  type AgentMessageDto,
  type AgentRunDetailDto,
  type AgentRunSummaryDto,
  type ChatArchiveSummaryDto,
  type ChatAttachment,
  type ChatComposerPayload,
  type ChatDirective,
  type ChatTurnRef,
  type LlmProvider,
  type RunArtifactDto,
  type RunLogEntryDto,
} from '@robdev/shared';
import { Subscription, firstValueFrom } from 'rxjs';
import { AgentsApiService } from '../../core/api/agents-api.service';
import { API_PATHS } from '../../core/api/api-paths';
import {
  classifyFilePath,
  extractMarkdownArtifactsAndProse,
  extractReferencedFilesFromMarkdown,
} from '../../core/markdown/markdown.service';
import { SocketService } from '../../core/realtime/socket.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { upsertById } from '../../core/state/upsert';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  AI_STUDIO_TOOL_OPTIONS,
  CREATE_NEW_CHAT_OPTIONS,
  MEDIA_RESOLUTION_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  type AiStudioToolId,
} from './agent-chat-bar.component';

export interface TurnModelInfo {
  readonly shortModelName: string;
  readonly providerLabel: string;
  readonly rawModelId: string;
  readonly thinkingLevel: string;
  readonly outputLength: number;
  readonly temperature: number;
  readonly mediaResolution: string | null;
  readonly tools: string[];
  readonly chatSessionMode: string | null;
}

export interface UserTokenBreakdown {
  readonly total: number;
  readonly userPrompt: number;
  readonly vaultContext: number;
  readonly vaultDocCount: number;
  readonly systemRules: number;
  readonly toolsAndContext: number;
}

export interface AiTokenBreakdown {
  readonly total: number;
  readonly thoughts: number;
  readonly artifacts: number;
  readonly response: number;
  readonly toolCalls: number;
}

export interface ChatArtifactVersion {
  readonly id: string;
  readonly versionNumber: number;
  readonly path: string;
  readonly title: string;
  readonly language: string;
  readonly content: string;
  readonly bytes: number;
  readonly tokens: number;
  readonly createdAt: string;
  readonly turnIndex: number;
  readonly promptExcerpt: string;
  readonly previewKind?: 'image' | 'video' | 'audio' | 'code';
  readonly previewUrl?: string | null;
}

export interface ChatArtifactTrack {
  readonly key: string;
  readonly path: string;
  readonly language: string;
  readonly latestVersion: ChatArtifactVersion;
  readonly versions: readonly ChatArtifactVersion[];
}

export interface ChatTurn {
  readonly id: string;
  readonly ref: ChatTurnRef;
  readonly userMessage: AgentMessageDto | null;
  readonly entries: RunLogEntryDto[];
  readonly artifacts: RunArtifactDto[];
  readonly rawAssistantMarkdown: string;
  readonly statusText: string | null;
  readonly aiTimestamp: string;
  readonly isStreaming: boolean;
  readonly hasTextResponse: boolean;
  readonly modelInfo: TurnModelInfo;
  readonly userTokens: UserTokenBreakdown;
  readonly aiTokens: AiTokenBreakdown;
}

export function buildRawAssistantMarkdown(
  entries: readonly RunLogEntryDto[],
  artifacts: readonly RunArtifactDto[],
): string {
  const parts: string[] = [];
  for (const e of entries) {
    if (e.kind === 'TEXT' && e.content.trim()) {
      parts.push(e.content.trim());
    } else if (e.kind === 'ERROR' && e.content.trim()) {
      parts.push(`**Error:** ${e.content.trim()}`);
    } else if (e.kind === 'HANDOFF' && e.content.trim()) {
      parts.push(e.content.trim());
    }
  }
  for (const art of artifacts) {
    if (art.content.trim() && !parts.some((p) => p.includes(art.content.trim()))) {
      parts.push(`### ${art.path}\n\`\`\`${art.language || ''}\n${art.content.trim()}\n\`\`\``);
    }
  }
  if (parts.length === 0) {
    for (const e of entries) {
      if (e.kind === 'SYSTEM' && e.meta?.isThinking && e.content.trim()) {
        parts.push(e.content.trim());
      } else if (e.kind === 'TOOL_CALL' && e.content.trim()) {
        parts.push(`- ${e.content.trim()}`);
      }
    }
  }
  return parts.join('\n\n');
}

function computeTurnTokens(params: {
  userMessage: AgentMessageDto | null;
  entries: readonly RunLogEntryDto[];
  artifacts: readonly RunArtifactDto[];
  agentDetail: AgentDetailDto | null;
}): { userTokens: UserTokenBreakdown; aiTokens: AiTokenBreakdown } {
  const ctxEntry = params.entries.find((e) => e.kind === 'CONTEXT');
  const injectedDocs = ctxEntry?.meta?.docs ?? [];
  const vaultDocCount = injectedDocs.length;
  const serverPromptTokens = ctxEntry?.meta?.promptTokens;

  const userPromptTokens =
    serverPromptTokens?.userPrompt ??
    estimateTokens(params.userMessage?.body ?? '');
  const vaultContextTokens =
    serverPromptTokens?.vaultContext ??
    injectedDocs.reduce((sum, d) => sum + (d.estimatedTokens || 0), 0);

  let systemRulesTokens = serverPromptTokens?.systemRules ?? 0;
  if (!systemRulesTokens) {
    const sysPromptText = params.agentDetail?.systemPrompt ?? '';
    // Base studio preamble + persona + coding contract + output contract (~420 tokens + persona)
    systemRulesTokens = estimateTokens(sysPromptText) + 420;
  }

  let toolsAndContextTokens = serverPromptTokens?.toolsAndContext ?? 0;
  if (!toolsAndContextTokens) {
    const toolList = params.agentDetail?.tools ?? [];
    const toolTokens = toolList.reduce((sum, tName) => {
      const def = AGENT_TOOL_DEFINITIONS[tName];
      return sum + (def ? estimateTokens(`${def.name} ${def.description}`) + 45 : 50);
    }, 0);
    toolsAndContextTokens = Math.max(110, toolTokens + 95);
  }

  const userTotal =
    userPromptTokens +
    vaultContextTokens +
    systemRulesTokens +
    toolsAndContextTokens;

  let thoughtsTokens = 0;
  let inlineArtifactsTokens = 0;
  let responseProseTokens = 0;
  let toolCallTokens = 0;
  const seenInlineContents = new Set<string>();

  for (const e of params.entries) {
    if (e.kind === 'SYSTEM' && e.meta?.isThinking) {
      thoughtsTokens += estimateTokens(e.content);
    } else if (e.kind === 'TEXT') {
      const parsed = extractMarkdownArtifactsAndProse(e.content);
      responseProseTokens += parsed.proseTokens;
      inlineArtifactsTokens += parsed.artifactsTokens;
      for (const a of parsed.artifacts) {
        seenInlineContents.add(a.content.trim());
      }
    } else if (e.kind === 'TOOL_CALL') {
      const argsStr =
        typeof e.meta?.args === 'string'
          ? e.meta.args
          : JSON.stringify(e.meta?.args ?? '');
      toolCallTokens += estimateTokens(`${e.meta?.tool ?? ''} ${argsStr}`);
    } else if (
      e.kind === 'SYSTEM' &&
      e.meta?.createdArtifact?.content &&
      !seenInlineContents.has(e.meta.createdArtifact.content.trim())
    ) {
      seenInlineContents.add(e.meta.createdArtifact.content.trim());
      inlineArtifactsTokens += estimateTokens(e.meta.createdArtifact.content);
    }
  }

  for (const art of params.artifacts) {
    if (art.content && !seenInlineContents.has(art.content.trim())) {
      seenInlineContents.add(art.content.trim());
      inlineArtifactsTokens += estimateTokens(art.content);
    }
  }

  const aiTotal =
    thoughtsTokens +
    inlineArtifactsTokens +
    responseProseTokens +
    toolCallTokens;

  return {
    userTokens: {
      total: userTotal,
      userPrompt: userPromptTokens,
      vaultContext: vaultContextTokens,
      vaultDocCount,
      systemRules: systemRulesTokens,
      toolsAndContext: toolsAndContextTokens,
    },
    aiTokens: {
      total: aiTotal,
      thoughts: thoughtsTokens,
      artifacts: inlineArtifactsTokens,
      response: responseProseTokens,
      toolCalls: toolCallTokens,
    },
  };
}

function buildTurnModelInfo(params: {
  provider: LlmProvider;
  modelId: string;
  temperature: number;
  maxOutputTokens: number;
  fallbackLabel?: string | null;
}): TurnModelInfo {
  const raw = (params.modelId ?? '').trim();
  const [basePartRaw = '', queryPart = ''] = raw.split('?');
  const baseLower = (basePartRaw.split(':thinking-')[0] ?? basePartRaw).toLowerCase();
  const searchParams = new URLSearchParams(queryPart);

  const isWeb =
    params.provider === 'GOOGLE_WEB' ||
    params.provider === 'GEMINI_APP' ||
    baseLower.startsWith('aistudio:') ||
    baseLower.startsWith('gemini-web');

  if (isWeb) {
    const isAiStudio = baseLower.startsWith('aistudio');
    const isGuest = baseLower.includes('guest');
    const isGeminiApp = params.provider === 'GEMINI_APP';

    let shortModelName = 'Gemini 3.8 Flash';
    if (
      baseLower.includes('4.0-argon') ||
      baseLower.includes('4-argon') ||
      baseLower.includes('argon')
    ) {
      shortModelName = 'Gemini 4.0 Argon';
    } else if (baseLower.includes('3.8-flash')) {
      shortModelName = 'Gemini 3.8 Flash';
    } else if (baseLower.includes('3.5-flash-lite') || baseLower.includes('3.5-flash')) {
      shortModelName = 'Gemini 3.5 Flash-Lite';
    } else if (baseLower.includes('3.1-pro')) {
      shortModelName = 'Gemini 3.1 Pro';
    } else if (baseLower.includes('3.1-flash-lite')) {
      shortModelName = 'Gemini 3.1 Flash-Lite';
    } else if (baseLower.includes('3.0-flash')) {
      shortModelName = 'Gemini 3.0 Flash';
    }

    const providerLabel = isGeminiApp
      ? 'Gemini App'
      : isAiStudio
        ? 'AI Studio'
        : isGuest
          ? 'Gemini Web (Guest Mode)'
          : 'Gemini Web';

    const thinkingRaw = (searchParams.get('thinking') || 'medium').toLowerCase();
    const thinkingOpt = THINKING_LEVEL_OPTIONS.find((t) => t.id === thinkingRaw);
    const thinkingLevel = isGuest
      ? 'Automatic (Guest Mode)'
      : (thinkingOpt?.label ?? 'Medium');

    const mediaRaw = (searchParams.get('mediaRes') || 'default').toLowerCase();
    const mediaOpt = MEDIA_RESOLUTION_OPTIONS.find((m) => m.id === mediaRaw);
    const mediaResolution = isAiStudio ? (mediaOpt?.label ?? 'Default') : null;

    const toolsRaw = searchParams.get('tools');
    const toolLabelMap = new Map<string, string>(
      AI_STUDIO_TOOL_OPTIONS.map((t) => [t.id, t.shortLabel]),
    );
    let tools: string[] = [];
    if (isAiStudio) {
      const ids =
        toolsRaw === null
          ? (['googleSearch'] as AiStudioToolId[])
          : toolsRaw
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
      tools = ids.map((id) => toolLabelMap.get(id) ?? id);
      if (tools.length === 0) {
        tools = ['None'];
      }
    } else {
      tools = ['Studio Tool Bridge'];
    }

    const chatModeRaw = (searchParams.get('chatMode') || 'per-run').toLowerCase();
    const chatModeOpt = CREATE_NEW_CHAT_OPTIONS.find((c) => c.id === chatModeRaw);
    const chatSessionMode = chatModeOpt?.label ?? 'Create on different runs';

    return {
      shortModelName,
      providerLabel,
      rawModelId: raw || baseLower,
      thinkingLevel,
      outputLength: params.maxOutputTokens,
      temperature: params.temperature,
      mediaResolution,
      tools,
      chatSessionMode,
    };
  }

  const providerLabels: Record<LlmProvider, string> = {
    GOOGLE_WEB: 'Gemini Web',
    CLAUDE_WEB: 'Claude Web',
    CHATGPT_WEB: 'ChatGPT Web',
    GEMINI_APP: 'Gemini App',
    CLAUDE_APP: 'Claude App',
    GPT_APP: 'GPT App',
    ANTIGRAVITY: 'Antigravity',
    CLAUDE_CODE: 'Claude Code',
    CODEX: 'OpenAI Codex',
    OLLAMA: 'Local (Ollama)',
    GOOGLE: 'API (Google Gemini)',
    OPENAI: 'API (OpenAI)',
    ANTHROPIC: 'API (Anthropic)',
    XAI: 'API (xAI)',
    RUNPOD: 'Cloud Service (RunPod)',
    OPENAI_COMPATIBLE: 'Cloud Service (OpenAI Compatible)',
  };

  return {
    shortModelName: raw || params.fallbackLabel || 'Default Model',
    providerLabel: providerLabels[params.provider] ?? params.provider,
    rawModelId: raw || 'default',
    thinkingLevel: 'Standard',
    outputLength: params.maxOutputTokens,
    temperature: params.temperature,
    mediaResolution: null,
    tools: ['Native Tool Calling'],
    chatSessionMode: null,
  };
}

@Injectable()
export class AgentConsoleStore {
  private readonly agentsApi = inject(AgentsApiService);
  private readonly socket = inject(SocketService);
  private readonly studioStore = inject(StudioStoreService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly agentKey = signal<AgentKey>('lead');
  readonly detail = signal<AgentDetailDto | null>(null);
  readonly runs = signal<AgentRunSummaryDto[]>([]);
  readonly selectedRunId = signal<string | null>(null);
  readonly entries = signal<RunLogEntryDto[]>([]);
  readonly streamingText = signal<ReadonlyMap<string, string>>(new Map());
  readonly artifacts = signal<RunArtifactDto[]>([]);
  readonly runDetailsById = signal<
    ReadonlyMap<string, { entries: RunLogEntryDto[]; artifacts: RunArtifactDto[] }>
  >(new Map());
  readonly messages = signal<AgentMessageDto[]>([]);
  readonly messagesNextCursor = signal<string | null>(null);
  readonly archives = signal<ChatArchiveSummaryDto[]>([]);
  readonly expandedArchiveIds = signal<ReadonlySet<string>>(new Set());
  readonly archiveTurnsById = signal<Readonly<Record<string, ChatTurn[]>>>({});
  readonly archiveLoadingIds = signal<ReadonlySet<string>>(new Set());
  readonly isFollowingLive = signal<boolean>(true);
  readonly loading = signal<boolean>(false);
  readonly pendingStatusText = signal<string | null>(null);

  private normalizeEntriesForRun(
    rawEntries: readonly RunLogEntryDto[],
    isRunActive: boolean,
  ): RunLogEntryDto[] {
    const map = this.streamingText();
    const rawMapped = rawEntries.map((e) =>
      map.has(e.id) ? { ...e, content: e.content + (map.get(e.id) ?? '') } : e,
    );

    // Pair TOOL_CALL and TOOL_RESULT entries into a single unified TOOL_CALL entry
    const resultsByCallId = new Map<string, RunLogEntryDto>();
    for (const e of rawMapped) {
      if (e.kind === 'TOOL_RESULT' && e.meta?.toolCallId) {
        resultsByCallId.set(e.meta.toolCallId, e);
      }
    }

    const mergedResultIds = new Set<string>();
    const unified: RunLogEntryDto[] = [];

    for (let i = 0; i < rawMapped.length; i++) {
      const e = rawMapped[i]!;
      if (e.kind === 'TOOL_CALL') {
        let matchedResult = e.meta?.toolCallId
          ? resultsByCallId.get(e.meta.toolCallId)
          : undefined;
        if (!matchedResult) {
          const next = rawMapped[i + 1];
          if (
            next &&
            next.kind === 'TOOL_RESULT' &&
            !mergedResultIds.has(next.id) &&
            next.meta?.tool === e.meta?.tool
          ) {
            matchedResult = next;
          }
        }
        if (matchedResult) {
          mergedResultIds.add(matchedResult.id);
          unified.push({
            ...e,
            meta: {
              ...e.meta,
              ok: matchedResult.meta?.ok ?? true,
              durationMs: matchedResult.meta?.durationMs,
              errorCode: matchedResult.meta?.errorCode,
              resultContent: matchedResult.content,
            },
          });
          continue;
        }
      }
      unified.push(e);
    }

    const mapped = unified.filter(
      (e) => !mergedResultIds.has(e.id) && e.kind !== 'USAGE',
    );

    // Clean up thinking entries:
    // 1. Identify the last thinking entry in the sequence
    let lastThinkingId: string | null = null;
    for (const e of mapped) {
      if (e.kind === 'SYSTEM' && e.meta?.isThinking) {
        lastThinkingId = e.id;
      }
    }

    const cleanedThinking: RunLogEntryDto[] = [];
    for (let i = 0; i < mapped.length; i++) {
      const e = mapped[i]!;
      if (e.kind === 'SYSTEM' && e.meta?.isThinking) {
        const hasLaterSubstantive = mapped
          .slice(i + 1)
          .some(
            (later) =>
              later.kind === 'TEXT' ||
              later.kind === 'TOOL_CALL' ||
              later.kind === 'ERROR' ||
              later.kind === 'HANDOFF' ||
              Boolean(later.meta?.isThinking) ||
              Boolean(later.meta?.createdArtifact),
          );
        const isEmpty = e.content.trim().length === 0;
        const shouldBeFinished =
          Boolean(e.meta.thinkingFinished) || !isRunActive || hasLaterSubstantive;

        // Drop abandoned empty thinking placeholders if a later entry exists or the run has ended
        if (isEmpty && (e.id !== lastThinkingId || shouldBeFinished)) {
          continue;
        }

        if (shouldBeFinished && !e.meta.thinkingFinished) {
          const startMs = Date.parse(e.meta.thinkingStartedAt ?? e.createdAt);
          const endRefIso = mapped[i + 1]?.createdAt ?? e.createdAt;
          const endMs = Date.parse(endRefIso);
          const fallbackDur =
            Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
              ? Math.min(endMs - startMs, 60_000)
              : 1000;
          cleanedThinking.push({
            ...e,
            meta: {
              ...e.meta,
              thinkingFinished: true,
              thinkingDurationMs: e.meta.thinkingDurationMs || fallbackDur,
            },
          });
          continue;
        }
      }
      cleanedThinking.push(e);
    }

    const isTransientStatus = (e: RunLogEntryDto): boolean =>
      e.kind === 'SYSTEM' &&
      !e.meta?.isThinking &&
      !e.meta?.createdArtifact;

    const hasSubstantiveEntry = cleanedThinking.some(
      (e) =>
        (e.kind === 'TEXT' && e.content.trim().length > 0) ||
        (e.kind === 'SYSTEM' && Boolean(e.meta?.isThinking)) ||
        (e.kind === 'SYSTEM' && Boolean(e.meta?.createdArtifact)) ||
        e.kind === 'TOOL_CALL' ||
        e.kind === 'HANDOFF' ||
        e.kind === 'ERROR',
    );
    if (hasSubstantiveEntry) {
      const textReferencedFileNames = new Set<string>();
      for (const e of cleanedThinking) {
        if (e.kind === 'TEXT' && e.content.trim()) {
          const refs = extractReferencedFilesFromMarkdown(
            e.content,
            this.studioStore.studio()?.slug ?? 'inclined-games',
          );
          for (const r of refs) {
            textReferencedFileNames.add(r.fileName.toLowerCase());
            textReferencedFileNames.add(r.filePath.toLowerCase().replace(/\\/g, '/'));
          }
        }
      }

      return cleanedThinking.filter((e) => {
        if (isTransientStatus(e)) return false;
        // Avoid rendering a duplicate SYSTEM image card when the AI's TEXT response in the same turn already embeds that exact file path
        if (
          e.kind === 'SYSTEM' &&
          e.meta?.createdArtifact?.kind === 'image' &&
          e.meta.createdArtifact.path
        ) {
          const pNorm = e.meta.createdArtifact.path.toLowerCase().replace(/\\/g, '/');
          const baseName = pNorm.split('/').pop() ?? pNorm;
          if (
            textReferencedFileNames.has(pNorm) ||
            textReferencedFileNames.has(baseName)
          ) {
            return false;
          }
        }
        return true;
      });
    }

    // Keep only the latest SYSTEM status entry while waiting
    let lastStatusId: string | null = null;
    for (const e of cleanedThinking) {
      if (isTransientStatus(e)) {
        lastStatusId = e.id;
      }
    }
    if (!lastStatusId) return cleanedThinking;
    return cleanedThinking.filter(
      (e) => !isTransientStatus(e) || e.id === lastStatusId,
    );
  }

  readonly renderedEntries = computed<RunLogEntryDto[]>(() => {
    const selRun = this.selectedRun();
    const isRunActive = selRun?.status === 'RUNNING';
    return this.normalizeEntriesForRun(this.entries(), isRunActive);
  });

  readonly sortedMessages = computed<AgentMessageDto[]>(() =>
    [...this.messages()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  );

  readonly selectedRun = computed<AgentRunSummaryDto | null>(() => {
    const id = this.selectedRunId();
    if (!id) return null;
    return this.runs().find((r) => r.id === id) ?? null;
  });

  readonly chatTurns = computed<ChatTurn[]>(() => {
    const rawUserMsgs = this.sortedMessages().filter((m) => m.author === 'USER');
    const runsChrono = [...this.runs()].sort((a, b) =>
      a.startedAt.localeCompare(b.startedAt),
    );
    const detailsMap = this.runDetailsById();
    const selRunId = this.selectedRunId();
    const selEntries = this.entries();
    const selArtifacts = this.artifacts();
    const pendingStatus = this.pendingStatusText();
    const streamingId = this.streamingEntryId();
    const agentDetail = this.detail();

    return this.computeChatTurns({
      rawUserMsgs,
      runsChrono,
      getRunDetail: (runId) =>
        runId === selRunId
          ? { entries: selEntries, artifacts: selArtifacts }
          : detailsMap.get(runId),
      pendingStatus,
      streamingId,
      agentDetail,
    });
  });

  computeChatTurns(params: {
    rawUserMsgs: readonly AgentMessageDto[];
    runsChrono: readonly AgentRunSummaryDto[];
    getRunDetail: (
      runId: string,
    ) => { entries: RunLogEntryDto[]; artifacts: RunArtifactDto[] } | undefined;
    pendingStatus: string | null;
    streamingId: string | null;
    agentDetail: AgentDetailDto | null;
  }): ChatTurn[] {
    const {
      rawUserMsgs,
      runsChrono,
      getRunDetail,
      pendingStatus,
      streamingId,
      agentDetail,
    } = params;

    // Synthesize user messages for any runs whose taskId has no USER message
    const msgTaskIds = new Set(
      rawUserMsgs.map((m) => m.taskId).filter((id): id is string => Boolean(id)),
    );
    const allPrompts: AgentMessageDto[] = [...rawUserMsgs];
    for (const run of runsChrono) {
      if (!msgTaskIds.has(run.taskId) && (run.taskBrief || run.taskTitle)) {
        msgTaskIds.add(run.taskId);
        allPrompts.push({
          id: `brief-${run.taskId}`,
          agentKey: run.agentKey,
          author: 'USER',
          userDisplayName: null,
          taskId: run.taskId,
          body: run.taskBrief || run.taskTitle,
          createdAt: run.startedAt,
        });
      }
    }
    allPrompts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Gather all normalized entries and artifacts across all runs
    const allEntries: Array<{
      entry: RunLogEntryDto;
      runId: string;
      taskId: string;
      runStatus: string;
    }> = [];
    const allArtifacts: Array<{
      artifact: RunArtifactDto;
      runId: string;
      taskId: string;
    }> = [];

    for (const run of runsChrono) {
      const detail = getRunDetail(run.id);
      if (!detail) continue;
      for (const e of detail.entries) {
        allEntries.push({
          entry: e,
          runId: run.id,
          taskId: run.taskId,
          runStatus: run.status,
        });
      }
      for (const a of detail.artifacts) {
        allArtifacts.push({ artifact: a, runId: run.id, taskId: run.taskId });
      }
    }

    const defaultModelInfo = buildTurnModelInfo({
      provider: agentDetail?.provider ?? 'GOOGLE_WEB',
      modelId: agentDetail?.modelId ?? 'aistudio:gemini-4-argon',
      temperature: agentDetail?.temperature ?? 0.2,
      maxOutputTokens: agentDetail?.maxOutputTokens ?? 8192,
      fallbackLabel: agentDetail?.modelLabel,
    });

    if (allPrompts.length === 0) {
      if (allEntries.length === 0 && allArtifacts.length === 0 && !pendingStatus) {
        return [];
      }
      const isRunActive = runsChrono.some((r) => r.status === 'RUNNING');
      const norm = this.normalizeEntriesForRun(
        allEntries.map((x) => x.entry),
        isRunActive,
      );
      const flatArts = allArtifacts.map((x) => x.artifact);
      const hasText = norm.some((e) => e.kind === 'TEXT' && e.content.trim().length > 0);
      const initialTokens = computeTurnTokens({
        userMessage: null,
        entries: norm,
        artifacts: flatArts,
        agentDetail,
      });
      return [
        {
          id: 'turn-initial',
          ref: {
            taskId: runsChrono[0]?.taskId ?? null,
            promptMessageId: null,
            runIds: runsChrono.map((r) => r.id),
          },
          userMessage: null,
          entries: norm,
          artifacts: flatArts,
          rawAssistantMarkdown: buildRawAssistantMarkdown(norm, flatArts),
          statusText: norm.length === 0 ? pendingStatus : null,
          aiTimestamp:
            norm[norm.length - 1]?.createdAt ?? new Date().toISOString(),
          isStreaming: Boolean(streamingId) || isRunActive,
          hasTextResponse: hasText,
          modelInfo: defaultModelInfo,
          userTokens: initialTokens.userTokens,
          aiTokens: initialTokens.aiTokens,
        },
      ];
    }

    // Map each entry/artifact to its matching prompt turn
    const entriesByPromptIdx = new Map<number, RunLogEntryDto[]>();
    const artifactsByPromptIdx = new Map<number, RunArtifactDto[]>();
    const activeRunByPromptIdx = new Map<number, boolean>();
    const runIdsByPromptIdx = new Map<number, Set<string>>();

    const findPromptIndex = (taskId: string, itemCreatedAt: string): number => {
      const sameTaskIndices: number[] = [];
      for (let i = 0; i < allPrompts.length; i++) {
        if (allPrompts[i]!.taskId === taskId) {
          sameTaskIndices.push(i);
        }
      }
      if (sameTaskIndices.length === 1) {
        return sameTaskIndices[0]!;
      }
      const pool =
        sameTaskIndices.length > 1
          ? sameTaskIndices
          : allPrompts.map((_, idx) => idx);
      let chosen = pool[0]!;
      const itemMs = Date.parse(itemCreatedAt);
      for (const idx of pool) {
        const promptMs = Date.parse(allPrompts[idx]!.createdAt);
        if (Number.isFinite(itemMs) && Number.isFinite(promptMs) && promptMs <= itemMs + 1000) {
          chosen = idx;
        }
      }
      return chosen;
    };

    for (const run of runsChrono) {
      const idx = findPromptIndex(run.taskId, run.startedAt);
      const set = runIdsByPromptIdx.get(idx) ?? new Set<string>();
      set.add(run.id);
      runIdsByPromptIdx.set(idx, set);
    }

    const contextEntryByTaskId = new Map<string, RunLogEntryDto>();
    for (const item of allEntries) {
      if (item.entry.kind === 'CONTEXT' && !contextEntryByTaskId.has(item.taskId)) {
        contextEntryByTaskId.set(item.taskId, item.entry);
      }
      const idx = findPromptIndex(item.taskId, item.entry.createdAt);
      const list = entriesByPromptIdx.get(idx) ?? [];
      list.push(item.entry);
      entriesByPromptIdx.set(idx, list);
      const rSet = runIdsByPromptIdx.get(idx) ?? new Set<string>();
      rSet.add(item.runId);
      runIdsByPromptIdx.set(idx, rSet);
      if (item.runStatus === 'RUNNING') {
        activeRunByPromptIdx.set(idx, true);
      }
    }

    for (const item of allArtifacts) {
      const idx = findPromptIndex(item.taskId, item.artifact.createdAt);
      const list = artifactsByPromptIdx.get(idx) ?? [];
      list.push(item.artifact);
      artifactsByPromptIdx.set(idx, list);
      const rSet = runIdsByPromptIdx.get(idx) ?? new Set<string>();
      rSet.add(item.runId);
      runIdsByPromptIdx.set(idx, rSet);
    }

    const rawTurns: ChatTurn[] = [];
    for (let i = 0; i < allPrompts.length; i++) {
      const prompt = allPrompts[i]!;
      const isLastPrompt = i === allPrompts.length - 1;
      const isRunActive =
        Boolean(activeRunByPromptIdx.get(i)) ||
        (isLastPrompt && runsChrono.some((r) => r.status === 'RUNNING'));
      const rawTurnEntries = (entriesByPromptIdx.get(i) ?? []).sort(
        (a, b) => a.seq - b.seq || a.createdAt.localeCompare(b.createdAt),
      );
      const normEntries = this.normalizeEntriesForRun(
        rawTurnEntries,
        isRunActive && isLastPrompt,
      );

      // Ensure Vault Context is included on every substantive prompt turn if sent for this task
      if (
        normEntries.length > 0 &&
        !normEntries.some((e) => e.kind === 'CONTEXT') &&
        prompt.taskId
      ) {
        const inheritedCtx = contextEntryByTaskId.get(prompt.taskId);
        if (inheritedCtx) {
          normEntries.unshift({
            ...inheritedCtx,
            id: `${inheritedCtx.id}-turn-${prompt.id}`,
          });
        }
      }

      const turnArtifacts = artifactsByPromptIdx.get(i) ?? [];
      const turnStatus =
        isLastPrompt && normEntries.length === 0 ? pendingStatus : null;
      const hasText = normEntries.some(
        (e) => e.kind === 'TEXT' && e.content.trim().length > 0,
      );
      const lastEntryAt =
        normEntries[normEntries.length - 1]?.createdAt ?? prompt.createdAt;

      const entryRunConfig = rawTurnEntries.find((e) => e.meta?.runConfig)?.meta?.runConfig;
      const matchedRun =
        (prompt.taskId
          ? [...runsChrono].reverse().find((r) => r.taskId === prompt.taskId)
          : undefined) ?? runsChrono[runsChrono.length - 1];

      const turnModelInfo = buildTurnModelInfo({
        provider:
          entryRunConfig?.provider ??
          matchedRun?.provider ??
          agentDetail?.provider ??
          'GOOGLE_WEB',
        modelId:
          entryRunConfig?.modelId ??
          matchedRun?.modelId ??
          agentDetail?.modelId ??
          'aistudio:gemini-4-argon',
        temperature:
          entryRunConfig?.temperature ?? agentDetail?.temperature ?? 0.2,
        maxOutputTokens:
          entryRunConfig?.maxOutputTokens ?? agentDetail?.maxOutputTokens ?? 8192,
        fallbackLabel: agentDetail?.modelLabel,
      });

      const turnTokens = computeTurnTokens({
        userMessage: prompt,
        entries: normEntries,
        artifacts: turnArtifacts,
        agentDetail,
      });

      const turnRunIds = Array.from(runIdsByPromptIdx.get(i) ?? []);

      rawTurns.push({
        id: prompt.id,
        ref: {
          taskId: prompt.taskId ?? matchedRun?.taskId ?? null,
          promptMessageId: prompt.id,
          runIds: turnRunIds,
        },
        userMessage: prompt,
        entries: normEntries,
        artifacts: turnArtifacts,
        rawAssistantMarkdown: buildRawAssistantMarkdown(normEntries, turnArtifacts),
        statusText: turnStatus,
        aiTimestamp: lastEntryAt,
        isStreaming:
          isLastPrompt &&
          (Boolean(streamingId) || isRunActive || Boolean(turnStatus)),
        hasTextResponse: hasText,
        modelInfo: turnModelInfo,
        userTokens: turnTokens.userTokens,
        aiTokens: turnTokens.aiTokens,
      });
    }

    // Deduplicate consecutive identical user messages where the earlier retry produced no substantive output
    const finalTurns: ChatTurn[] = [];
    for (let i = 0; i < rawTurns.length; i++) {
      const cur = rawTurns[i]!;
      const next = rawTurns[i + 1];
      const curHasSubstantive =
        cur.entries.some(
          (e) =>
            e.kind === 'TEXT' ||
            e.kind === 'TOOL_CALL' ||
            e.kind === 'ERROR' ||
            e.kind === 'HANDOFF' ||
            Boolean(e.meta?.isThinking && e.content.trim().length > 0) ||
            Boolean(e.meta?.createdArtifact),
        ) || cur.artifacts.length > 0;
      if (
        next &&
        !curHasSubstantive &&
        cur.userMessage &&
        next.userMessage &&
        cur.userMessage.body.trim() === next.userMessage.body.trim()
      ) {
        // Merge any CONTEXT entry into next turn if next turn doesn't have one
        const ctxEntries = cur.entries.filter((e) => e.kind === 'CONTEXT');
        if (
          ctxEntries.length > 0 &&
          !next.entries.some((e) => e.kind === 'CONTEXT')
        ) {
          (next.entries as RunLogEntryDto[]).unshift(...ctxEntries);
        }
        continue;
      }
      finalTurns.push(cur);
    }

    return finalTurns;
  }

  readonly chatArtifactTracks = computed<ChatArtifactTrack[]>(() => {
    const turns = this.chatTurns();
    const studioSlug = this.studioStore.studio()?.slug ?? 'inclined-games';
    const tracksByKey = new Map<
      string,
      {
        key: string;
        path: string;
        language: string;
        versions: ChatArtifactVersion[];
      }
    >();

    const normalizeTrackKey = (rawPath: string): string => {
      const norm = rawPath.trim().replace(/\\/g, '/').toLowerCase();
      const base = norm.split('/').pop() ?? norm;
      return base || norm;
    };

    for (let tIdx = 0; tIdx < turns.length; tIdx++) {
      const turn = turns[tIdx]!;
      const turnNumber = tIdx + 1;
      const promptExcerpt =
        (turn.userMessage?.body ?? '').replace(/\s+/g, ' ').trim().slice(0, 65) ||
        `Turn #${turnNumber}`;
      const seenTurnKeys = new Set<string>();

      const addArtifactVersion = (item: {
        rawId: string;
        path: string;
        title: string;
        language: string;
        content: string;
        bytes: number;
        tokens: number;
        createdAt: string;
        previewKind?: 'image' | 'video' | 'audio' | 'code';
        previewUrl?: string | null;
      }): void => {
        const cleanContent = item.content.trim();
        if (!cleanContent && !item.previewUrl) return;
        const trackKey = normalizeTrackKey(item.path);
        const turnDedupKey = `${trackKey}::${cleanContent || item.previewUrl || item.path.toLowerCase()}`;
        if (seenTurnKeys.has(turnDedupKey) || seenTurnKeys.has(trackKey)) return;
        seenTurnKeys.add(turnDedupKey);
        seenTurnKeys.add(trackKey);

        let track = tracksByKey.get(trackKey);
        if (!track) {
          track = {
            key: trackKey,
            path: item.path,
            language: item.language || 'text',
            versions: [],
          };
          tracksByKey.set(trackKey, track);
        } else if (
          item.path.length > track.path.length &&
          /[\\/]/.test(item.path)
        ) {
          // Prefer full path when available
          track.path = item.path;
        }

        const versionNumber = track.versions.length + 1;
        track.versions.push({
          id: `${item.rawId}-v${versionNumber}`,
          versionNumber,
          path: item.path,
          title: item.title || item.path,
          language: item.language || 'text',
          content: item.content,
          bytes: item.bytes,
          tokens: item.tokens,
          createdAt: item.createdAt,
          turnIndex: turnNumber,
          promptExcerpt,
          ...(item.previewKind ? { previewKind: item.previewKind } : {}),
          ...(item.previewUrl !== undefined ? { previewUrl: item.previewUrl } : {}),
        });
      };

      // 1. Check user message for referenced previewable file paths
      if (turn.userMessage?.body) {
        const userRefs = extractReferencedFilesFromMarkdown(
          turn.userMessage.body,
          studioSlug,
        );
        for (const ref of userRefs) {
          if (!ref.previewKind) continue;
          addArtifactVersion({
            rawId: `user-${turn.id}-${ref.fileName}`,
            path: ref.filePath,
            title: ref.fileName,
            language: ref.language,
            content: '',
            bytes: 0,
            tokens: 0,
            createdAt: turn.userMessage.createdAt,
            previewKind: ref.previewKind,
            previewUrl: ref.previewUrl,
          });
        }
      }

      for (const e of turn.entries) {
        if (e.kind === 'TEXT' && e.content.trim()) {
          const parsed = extractMarkdownArtifactsAndProse(e.content);
          for (const inl of parsed.artifacts) {
            addArtifactVersion({
              rawId: `${e.id}-inl-${inl.index}`,
              path: inl.path,
              title: inl.headingTitle ? `${inl.headingTitle} (${inl.path})` : inl.path,
              language: inl.language,
              content: inl.content,
              bytes: inl.bytes,
              tokens: inl.tokens,
              createdAt: e.createdAt,
              previewKind: 'code',
            });
          }

          const textRefs = extractReferencedFilesFromMarkdown(
            e.content,
            studioSlug,
          );
          for (const ref of textRefs) {
            if (!ref.previewKind) continue;
            addArtifactVersion({
              rawId: `${e.id}-ref-${ref.fileName}`,
              path: ref.filePath,
              title: ref.fileName,
              language: ref.language,
              content: '',
              bytes: 0,
              tokens: 0,
              createdAt: e.createdAt,
              previewKind: ref.previewKind,
              previewUrl: ref.previewUrl,
            });
          }
        } else if (e.kind === 'SYSTEM' && e.meta?.createdArtifact) {
          const ca = e.meta.createdArtifact;
          const path = ca.path ?? ca.title ?? 'artifact.txt';
          const content = ca.content ?? '';
          if (ca.kind === 'image' || ca.mediaId) {
            const previewUrl = ca.mediaId
              ? API_PATHS.media.byId(ca.mediaId)
              : ca.path
                ? API_PATHS.media.byPath(ca.path, studioSlug)
                : null;
            addArtifactVersion({
              rawId: ca.id ?? e.id,
              path,
              title: ca.title ?? path,
              language: 'image/png',
              content: '',
              bytes: ca.bytes ?? 0,
              tokens: 0,
              createdAt: e.createdAt,
              previewKind: 'image',
              previewUrl,
            });
          } else if (content.trim()) {
            addArtifactVersion({
              rawId: ca.id ?? e.id,
              path,
              title: ca.title ?? path,
              language: ca.language ?? 'text',
              content,
              bytes: ca.bytes ?? new TextEncoder().encode(content).length,
              tokens: estimateTokens(content),
              createdAt: e.createdAt,
              previewKind: 'code',
            });
          }
        } else if (e.kind === 'TOOL_CALL' && e.meta?.resultContent) {
          try {
            const parsedRes = JSON.parse(e.meta.resultContent) as {
              screenshotPath?: string;
              mediaId?: string;
              windowTitle?: string;
              path?: string;
              bytes?: number;
            };
            const filePath = parsedRes.screenshotPath || parsedRes.path;
            if (filePath) {
              const info = classifyFilePath(
                filePath,
                studioSlug,
                parsedRes.mediaId ?? null,
              );
              if (info && info.previewKind) {
                addArtifactVersion({
                  rawId: `${e.id}-tool`,
                  path: info.filePath,
                  title: parsedRes.windowTitle
                    ? `${info.fileName} (${parsedRes.windowTitle})`
                    : info.fileName,
                  language: info.language,
                  content: '',
                  bytes: parsedRes.bytes ?? 0,
                  tokens: 0,
                  createdAt: e.createdAt,
                  previewKind: info.previewKind,
                  previewUrl: info.previewUrl,
                });
              }
            }
          } catch {
            // ignore non-JSON tool resultContent
          }
        }
      }

      for (const art of turn.artifacts) {
        addArtifactVersion({
          rawId: art.id,
          path: art.path,
          title: art.path,
          language: art.language,
          content: art.content,
          bytes: art.bytes,
          tokens: estimateTokens(art.content),
          createdAt: art.createdAt,
          previewKind: 'code',
        });
      }
    }

    const result: ChatArtifactTrack[] = [];
    for (const track of tracksByKey.values()) {
      if (track.versions.length === 0) continue;
      result.push({
        key: track.key,
        path: track.path,
        language: track.language,
        latestVersion: track.versions[track.versions.length - 1]!,
        versions: track.versions,
      });
    }
    return result;
  });

  readonly totalChatArtifactsCount = computed<number>(() =>
    this.chatArtifactTracks().reduce((sum, t) => sum + t.versions.length, 0),
  );

  readonly activePromptMessages = computed<AgentMessageDto[]>(() => {
    const msgs = this.sortedMessages();
    const run = this.selectedRun();
    if (!run) {
      if (this.runs().length > 0) {
        return [];
      }
      return msgs;
    }
    const matched = msgs.filter((m) => m.taskId === run.taskId);
    if (matched.length > 0) {
      return matched;
    }
    if (run.taskBrief) {
      return [
        {
          id: `brief-${run.taskId}`,
          agentKey: run.agentKey,
          author: 'USER',
          userDisplayName: 'Task Brief',
          taskId: run.taskId,
          body: run.taskBrief,
          createdAt: run.startedAt,
        },
      ];
    }
    return msgs.slice(-1);
  });

  readonly streamingEntryId = computed<string | null>(() => {
    const keys = [...this.streamingText().keys()];
    return keys.length > 0 ? keys[keys.length - 1]! : null;
  });

  readonly liveRunId = computed<string | null>(() => {
    const key = this.agentKey();
    const agent = this.studioStore.agent(key)();
    if (agent?.currentRunId) return agent.currentRunId;
    const running = this.runs().find((r) => r.status === 'RUNNING');
    return running?.id ?? null;
  });

  private subscribedRunId: string | null = null;
  private readonly subs = new Subscription();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private recentSendAt = 0;

  constructor() {
    this.wireSocket();
    this.pollTimer = setInterval(() => {
      void this.pollIfWorking();
    }, 2500);
    this.destroyRef.onDestroy(() => {
      this.subs.unsubscribe();
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.subscribedRunId) {
        void this.socket
          .emitWithAck('run:unsubscribe', { runId: this.subscribedRunId })
          .catch(() => undefined);
      }
    });
  }

  async select(key: AgentKey): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;

    this.agentKey.set(key);
    this.loading.set(true);
    this.runDetailsById.set(new Map());
    this.expandedArchiveIds.set(new Set());
    this.archiveTurnsById.set({});
    this.archiveLoadingIds.set(new Set());
    try {
      const [detail, runsPage, msgsPage, archives] = await Promise.all([
        firstValueFrom(this.agentsApi.getDetail(studioId, key)),
        firstValueFrom(this.agentsApi.listRuns(studioId, key, { limit: 20 })),
        firstValueFrom(this.agentsApi.listMessages(studioId, key, { limit: 30 })),
        firstValueFrom(this.agentsApi.listChatArchives(studioId, key)).catch(() => []),
      ]);
      this.detail.set(detail);
      this.runs.set(runsPage.items);
      this.messages.set(msgsPage.items);
      this.messagesNextCursor.set(msgsPage.nextCursor);
      this.archives.set(archives);

      const targetRunId = detail.currentRunId ?? runsPage.items[0]?.id ?? null;
      await this.selectRun(targetRunId);
      void this.hydrateAllRunDetails(studioId, runsPage.items);
    } finally {
      this.loading.set(false);
    }
  }

  async reloadAfterHistoryChange(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    try {
      const [detail, runsPage, msgsPage, archives] = await Promise.all([
        firstValueFrom(this.agentsApi.getDetail(studioId, key)),
        firstValueFrom(this.agentsApi.listRuns(studioId, key, { limit: 20 })),
        firstValueFrom(this.agentsApi.listMessages(studioId, key, { limit: 30 })),
        firstValueFrom(this.agentsApi.listChatArchives(studioId, key)).catch(() => []),
      ]);
      this.detail.set(detail);
      this.runs.set(runsPage.items);
      this.messages.set(msgsPage.items);
      this.messagesNextCursor.set(msgsPage.nextCursor);
      this.archives.set(archives);
      if (runsPage.items.length === 0 && msgsPage.items.length === 0) {
        this.pendingStatusText.set(null);
      }

      const targetRunId = detail.currentRunId ?? runsPage.items[0]?.id ?? null;
      await this.selectRun(targetRunId);
      void this.hydrateAllRunDetails(studioId, runsPage.items);
      void this.studioStore.reloadSnapshot();
    } catch {
      // Ignore transient errors
    }
  }

  private async hydrateAllRunDetails(
    studioId: string,
    runs: readonly AgentRunSummaryDto[],
  ): Promise<void> {
    const missing = runs.filter(
      (r) => r.id !== this.selectedRunId() && !this.runDetailsById().has(r.id),
    );
    if (missing.length === 0) return;
    const fetched = await Promise.all(
      missing.map((r) =>
        firstValueFrom(this.agentsApi.getRunDetail(studioId, r.id)).catch(
          () => null,
        ),
      ),
    );
    this.runDetailsById.update((prev) => {
      const next = new Map(prev);
      for (const d of fetched) {
        if (d) {
          next.set(d.id, { entries: d.entries, artifacts: d.artifacts });
        }
      }
      return next;
    });
  }

  async selectRun(runId: string | null): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (this.subscribedRunId && this.subscribedRunId !== runId) {
      const prev = this.subscribedRunId;
      const prevEntries = this.entries();
      const prevArtifacts = this.artifacts();
      this.runDetailsById.update((map) => {
        const next = new Map(map);
        next.set(prev, { entries: prevEntries, artifacts: prevArtifacts });
        return next;
      });
      this.subscribedRunId = null;
      await this.socket.emitWithAck('run:unsubscribe', { runId: prev }).catch(() => undefined);
    }

    this.selectedRunId.set(runId);
    this.streamingText.set(new Map());

    if (!runId || !studioId) {
      this.entries.set([]);
      this.artifacts.set([]);
      return;
    }

    try {
      const runDetail = await firstValueFrom(this.agentsApi.getRunDetail(studioId, runId));
      this.entries.set(runDetail.entries);
      this.artifacts.set(runDetail.artifacts);
      this.runDetailsById.update((map) => {
        const next = new Map(map);
        next.set(runId, {
          entries: runDetail.entries,
          artifacts: runDetail.artifacts,
        });
        return next;
      });
      this.subscribedRunId = runId;
      await this.socket
        .emitWithAck('run:subscribe', { studioId, runId })
        .catch(() => undefined);
    } catch {
      this.entries.set([]);
      this.artifacts.set([]);
    }
  }

  async send(payload: string | ChatComposerPayload): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const rawBody = typeof payload === 'string' ? payload : payload.body;
    const attachments: ChatAttachment[] =
      typeof payload === 'string' ? [] : [...(payload.attachments ?? [])];
    const directives: ChatDirective[] =
      typeof payload === 'string' ? [] : [...(payload.directives ?? [])];
    const text = rawBody.trim();
    if (!studioId || (!text && attachments.length === 0 && directives.length === 0)) {
      return;
    }

    // Handle direct client-side slash commands if typed alone
    const lowerCmd = text.toLowerCase();
    if (attachments.length === 0 && directives.length === 0) {
      if (lowerCmd === '/fresh') {
        await this.freshStart();
        return;
      }
      if (lowerCmd === '/cancel') {
        await this.cancelRun();
        return;
      }
      if (lowerCmd === '/undo') {
        const turns = this.chatTurns();
        const lastTurn = turns[turns.length - 1];
        if (lastTurn) {
          await this.branchFrom(lastTurn, 'USER');
        }
        return;
      }
      if (lowerCmd === '/retry') {
        const turns = this.chatTurns();
        const lastTurn = turns[turns.length - 1];
        if (lastTurn) {
          await this.retryTurn(lastTurn, 'CURRENT');
        }
        return;
      }
    }

    const effectiveBody =
      text ||
      (attachments.length > 0
        ? `Please review the attached ${attachments.map((a) => a.kind.replace('_', ' ')).join(', ')}.`
        : 'Continue with the selected directive.');

    const selGame = this.studioStore.selectedGameId();
    const activeTaskId = this.selectedRun()?.taskId ?? null;
    const initialStatus =
      this.agentKey() === 'lead'
        ? 'Initializing agents...'
        : `Initializing ${this.detail()?.name ?? this.agentKey()}...`;
    this.pendingStatusText.set(initialStatus);

    const res = await firstValueFrom(
      this.agentsApi.postMessage(studioId, this.agentKey(), {
        body: effectiveBody,
        gameId: selGame === 'all' ? null : selGame,
        taskId: activeTaskId,
        attachments,
        directives,
      }),
    );
    this.messages.update((list) => upsertById(list, res.message));
    this.studioStore.tasks.update((list) => upsertById(list, res.task, 'prepend'));
    this.isFollowingLive.set(true);
    this.recentSendAt = Date.now();
    this.toast.success(`Message sent to ${this.detail()?.name ?? this.agentKey()}`);

    // Refresh runs & agent detail shortly after queueing in case the orchestrator claims the task immediately
    const activeKey = this.agentKey();
    setTimeout(() => {
      if (this.agentKey() === activeKey) {
        void this.refreshRunsAfterSend(studioId, activeKey);
      }
    }, 300);
  }

  async freshStart(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    const res = await firstValueFrom(this.agentsApi.freshStartChat(studioId, key));
    await this.reloadAfterHistoryChange();
    if (res.archive) {
      this.toast.success(`Chat archived into ${res.archive.label}`);
    } else {
      this.toast.info('Chat is already empty');
    }
  }

  async branchFrom(turn: ChatTurn, part: 'USER' | 'AI'): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    const res = await firstValueFrom(
      this.agentsApi.branchChat(studioId, key, {
        ref: turn.ref,
        part,
      }),
    );
    await this.reloadAfterHistoryChange();
    if (res.archive) {
      this.toast.success(`Branched into ${res.archive.label}`);
    }
  }

  async retryTurn(
    turn: ChatTurn,
    mode: 'CURRENT' | 'CURRENT_AGENT' | 'SAME_AGENT',
  ): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;

    const initialStatus =
      mode === 'SAME_AGENT'
        ? `Retrying with ${turn.modelInfo.shortModelName}...`
        : `Retrying with ${this.detail()?.name ?? key}...`;
    this.pendingStatusText.set(initialStatus);

    const lastRunId =
      turn.ref.runIds.length > 0
        ? turn.ref.runIds[turn.ref.runIds.length - 1]!
        : null;

    const res = await firstValueFrom(
      this.agentsApi.retryChat(studioId, key, {
        ref: turn.ref,
        mode,
        sourceRunId: lastRunId,
        promptText: turn.userMessage?.body,
      }),
    );
    this.studioStore.tasks.update((list) => upsertById(list, res.task, 'prepend'));
    this.isFollowingLive.set(true);
    this.recentSendAt = Date.now();
    await this.reloadAfterHistoryChange();
    this.pendingStatusText.set(initialStatus);
    this.toast.success(
      res.archive
        ? `Archived old response into ${res.archive.label} and queued retry`
        : 'Retry queued',
    );

    const activeKey = this.agentKey();
    setTimeout(() => {
      if (this.agentKey() === activeKey) {
        void this.refreshRunsAfterSend(studioId, activeKey);
      }
    }, 350);
  }

  async deleteTurnPart(turn: ChatTurn, part: 'USER' | 'AI'): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    await firstValueFrom(
      this.agentsApi.deleteChatPart(studioId, key, {
        ref: turn.ref,
        part,
      }),
    );
    await this.reloadAfterHistoryChange();
    this.toast.success(part === 'USER' ? 'Message deleted' : 'Response deleted');
  }

  async toggleArchive(archiveId: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;

    const currentExpanded = new Set(this.expandedArchiveIds());
    if (currentExpanded.has(archiveId)) {
      currentExpanded.delete(archiveId);
      this.expandedArchiveIds.set(currentExpanded);
      return;
    }

    currentExpanded.add(archiveId);
    this.expandedArchiveIds.set(currentExpanded);

    if (this.archiveTurnsById()[archiveId]) {
      return;
    }

    this.archiveLoadingIds.update((set) => {
      const next = new Set(set);
      next.add(archiveId);
      return next;
    });
    try {
      const detail = await firstValueFrom(
        this.agentsApi.getChatArchive(studioId, key, archiveId),
      );
      const rawUserMsgs = [...detail.messages]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .filter((m) => m.author === 'USER');
      const runDetails: AgentRunDetailDto[] = detail.runDetails ?? detail.runs ?? [];
      const runsChrono = [...runDetails].sort((a, b) =>
        a.startedAt.localeCompare(b.startedAt),
      );
      const runDetailMap = new Map<
        string,
        { entries: RunLogEntryDto[]; artifacts: RunArtifactDto[] }
      >();
      for (const r of runDetails) {
        runDetailMap.set(r.id, {
          entries: r.entries ?? [],
          artifacts: r.artifacts ?? [],
        });
      }

      const turns = this.computeChatTurns({
        rawUserMsgs,
        runsChrono,
        getRunDetail: (rId) => runDetailMap.get(rId),
        pendingStatus: null,
        streamingId: null,
        agentDetail: this.detail(),
      });
      this.archiveTurnsById.update((prev) => ({
        ...prev,
        [archiveId]: turns,
      }));
    } catch {
      this.toast.error('Failed to load archived messages');
    } finally {
      this.archiveLoadingIds.update((set) => {
        const next = new Set(set);
        next.delete(archiveId);
        return next;
      });
    }
  }

  async deleteArchive(archiveId: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    const target = this.archives().find((a) => a.id === archiveId);
    await firstValueFrom(this.agentsApi.deleteChatArchive(studioId, key, archiveId));
    this.archives.update((list) => list.filter((a) => a.id !== archiveId));
    this.expandedArchiveIds.update((set) => {
      const next = new Set(set);
      next.delete(archiveId);
      return next;
    });
    this.archiveTurnsById.update((prev) => {
      const next = { ...prev };
      delete next[archiveId];
      return next;
    });
    void this.studioStore.reloadSnapshot();
    this.toast.success(`Deleted ${target?.label ?? 'archive'}`);
  }

  async deleteAllArchives(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    const res = await firstValueFrom(this.agentsApi.deleteAllChatArchives(studioId, key));
    this.archives.set([]);
    this.expandedArchiveIds.set(new Set());
    this.archiveTurnsById.set({});
    void this.studioStore.reloadSnapshot();
    this.toast.success(
      `Deleted ${res.deletedCount} archive${res.deletedCount === 1 ? '' : 's'}`,
    );
  }

  private async pollIfWorking(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId || this.loading()) return;

    const agentSummary = this.studioStore.agent(key)();
    const hasLocalRunning = this.runs().some((r) => r.status === 'RUNNING');
    const isWorking =
      agentSummary?.status === 'WORKING' ||
      this.liveRunId() !== null ||
      hasLocalRunning ||
      this.pendingStatusText() !== null ||
      Date.now() - this.recentSendAt < 15_000;

    if (!isWorking) return;

    await this.refreshRunsAfterSend(studioId, key);
  }

  private async refreshRunsAfterSend(studioId: string, key: AgentKey): Promise<void> {
    try {
      const [detail, runsPage] = await Promise.all([
        firstValueFrom(this.agentsApi.getDetail(studioId, key)),
        firstValueFrom(this.agentsApi.listRuns(studioId, key, { limit: 20 })),
      ]);
      this.detail.set(detail);
      this.runs.set(runsPage.items);
      const newestRun = runsPage.items[0] ?? null;
      if (newestRun && newestRun.status !== 'RUNNING' && detail.status !== 'WORKING') {
        this.pendingStatusText.set(null);
      }
      const newestRunId = detail.currentRunId ?? newestRun?.id ?? null;
      if (newestRunId && newestRunId !== this.selectedRunId()) {
        await this.selectRun(newestRunId);
      } else if (newestRunId) {
        const runDetail = await firstValueFrom(
          this.agentsApi.getRunDetail(studioId, newestRunId),
        );
        this.entries.set(runDetail.entries);
        this.artifacts.set(runDetail.artifacts);
        this.runDetailsById.update((map) => {
          const next = new Map(map);
          next.set(newestRunId, {
            entries: runDetail.entries,
            artifacts: runDetail.artifacts,
          });
          return next;
        });
      }
      void this.hydrateAllRunDetails(studioId, runsPage.items);
    } catch {
      // Ignore transient poll errors
    }
  }

  async cancelRun(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const runId = this.liveRunId() ?? this.selectedRunId();
    if (!studioId || !runId) return;
    const updated = await firstValueFrom(this.agentsApi.cancelRun(studioId, runId));
    this.runs.update((list) => upsertById(list, updated));
    this.toast.warning('Run cancelled');
  }

  async deleteRun(runId: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId || !runId) return;
    const res = await firstValueFrom(this.agentsApi.deleteRun(studioId, runId));
    this.runs.update((list) => list.filter((r) => r.id !== runId));
    if (res.deletedTaskId) {
      this.messages.update((list) => list.filter((m) => m.taskId !== res.deletedTaskId));
      this.studioStore.tasks.update((list) =>
        list.filter((t) => t.id !== res.deletedTaskId),
      );
    }
    if (this.selectedRunId() === runId) {
      const nextId = this.runs()[0]?.id ?? null;
      await this.selectRun(nextId);
    }
    await this.studioStore.reloadSnapshot();
    this.toast.success('Run deleted');
  }

  async deleteAllAgentRuns(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    const res = await firstValueFrom(this.agentsApi.deleteAgentRuns(studioId, key));
    await this.selectRun(null);
    this.runs.set([]);
    this.messages.set([]);
    this.messagesNextCursor.set(null);
    this.entries.set([]);
    this.artifacts.set([]);
    this.streamingText.set(new Map());
    const detail = await firstValueFrom(this.agentsApi.getDetail(studioId, key));
    this.detail.set(detail);
    await this.studioStore.reloadSnapshot();
    this.toast.success(
      `Deleted ${res.deletedCount} run${res.deletedCount === 1 ? '' : 's'} from ${detail.name}`,
    );
  }

  async deleteAllStudioRuns(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const key = this.agentKey();
    if (!studioId) return;
    const res = await firstValueFrom(this.agentsApi.deleteAllStudioRuns(studioId));
    await this.selectRun(null);
    this.runs.set([]);
    this.messages.set([]);
    this.messagesNextCursor.set(null);
    this.entries.set([]);
    this.artifacts.set([]);
    this.streamingText.set(new Map());
    this.studioStore.tasks.set([]);
    const detail = await firstValueFrom(this.agentsApi.getDetail(studioId, key));
    this.detail.set(detail);
    await this.studioStore.reloadSnapshot();
    this.toast.success(
      `Deleted ${res.deletedCount} run${res.deletedCount === 1 ? '' : 's'} across all chats`,
    );
  }

  async loadOlderMessages(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const cursor = this.messagesNextCursor();
    if (!studioId || !cursor) return;
    const page = await firstValueFrom(
      this.agentsApi.listMessages(studioId, this.agentKey(), { cursor, limit: 30 }),
    );
    this.messages.update((cur) => [...cur, ...page.items]);
    this.messagesNextCursor.set(page.nextCursor);
  }

  private wireSocket(): void {
    this.subs.add(
      this.socket.on('agent:log-chunk').subscribe((e) => {
        if (e.agentKey === this.agentKey() && !this.selectedRunId() && this.isFollowingLive()) {
          void this.selectRun(e.runId);
          return;
        }
        if (e.runId !== this.selectedRunId()) return;
        if (e.entry) {
          if (e.entry.kind === 'TEXT' && e.entry.content.trim().length > 0) {
            this.pendingStatusText.set(null);
          } else if (
            e.entry.kind === 'SYSTEM' &&
            !e.entry.meta?.isThinking &&
            !e.entry.meta?.createdArtifact &&
            e.entry.content.trim().endsWith('...')
          ) {
            this.pendingStatusText.set(e.entry.content.trim());
          }
          this.entries.update((list) =>
            upsertById(list, e.entry!).sort((a, b) => a.seq - b.seq),
          );
          this.streamingText.update((m) => {
            if (!m.has(e.entry!.id)) return m;
            const next = new Map(m);
            next.delete(e.entry!.id);
            return next;
          });
        } else if (e.delta) {
          this.pendingStatusText.set(null);
          this.streamingText.update((m) => {
            const next = new Map(m);
            next.set(e.entryId, (m.get(e.entryId) ?? '') + e.delta!);
            return next;
          });
          this.entries.update((list) => {
            if (list.some((x) => x.id === e.entryId)) return list;
            const placeholder: RunLogEntryDto = {
              id: e.entryId,
              runId: e.runId,
              seq: e.seq,
              kind: e.kind,
              content: '',
              meta: e.meta,
              createdAt: e.at,
            };
            return [...list, placeholder].sort((a, b) => a.seq - b.seq);
          });
        }
      }),
    );

    this.subs.add(
      this.socket.on('run:started').subscribe((e) => {
        if (e.run.agentKey !== this.agentKey()) return;
        this.runs.update((list) => upsertById(list, e.run, 'prepend'));
        if (this.isFollowingLive()) {
          void this.selectRun(e.run.id);
        }
      }),
    );

    this.subs.add(
      this.socket.on('run:finished').subscribe((e) => {
        if (e.run.agentKey !== this.agentKey()) return;
        this.pendingStatusText.set(null);
        this.runs.update((list) => upsertById(list, e.run));
        if (
          e.run.id === this.selectedRunId() ||
          !this.selectedRunId() ||
          this.isFollowingLive()
        ) {
          this.streamingText.set(new Map());
          void this.selectRun(e.run.id);
        }
        void this.studioStore.reloadOutputs();
      }),
    );

    this.subs.add(
      this.socket.on('agent:activity').subscribe((e) => {
        if (e.agentKey !== this.agentKey()) return;
        if (e.snippet.trim().endsWith('...')) {
          this.pendingStatusText.set(e.snippet.trim());
        }
      }),
    );

    this.subs.add(
      this.socket.on('agent:message').subscribe((e) => {
        if (e.message.agentKey !== this.agentKey()) return;
        this.messages.update((list) => upsertById(list, e.message, 'prepend'));
      }),
    );

    this.subs.add(
      this.socket.on('chat:history-changed').subscribe((e) => {
        if (e.agentKey !== this.agentKey()) return;
        void this.reloadAfterHistoryChange();
      }),
    );
  }
}
