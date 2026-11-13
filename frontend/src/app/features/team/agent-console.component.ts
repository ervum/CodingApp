import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import {
  AGENT_BY_KEY,
  type AgentKey,
  type BrowserVisibilityStatusDto,
  type ChatAttachment,
  type ChatComposerPayload,
  type RunArtifactDto,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { AgentsApiService } from '../../core/api/agents-api.service';
import { LlmApiService } from '../../core/api/llm-api.service';
import { AuthStore } from '../../core/auth/auth.store';
import { LuauHighlighter } from '../../core/markdown/luau-highlighter';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { CopySplitButtonComponent } from '../../shared/ui/copy-split-button/copy-split-button.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import {
  MarkdownViewComponent,
  openFileWithSystemDialog,
} from '../../shared/ui/markdown-view/markdown-view.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  AI_STUDIO_TOOL_OPTIONS,
  AgentChatBarComponent,
  CREATE_NEW_CHAT_OPTIONS,
  DIRECTIVE_METADATA,
  MEDIA_RESOLUTION_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  WEB_BASE_MODELS,
  type AiStudioToolId,
  type AiStudioToolOption,
  type CreateNewChatModeId,
  type CreateNewChatModeOption,
  type MediaResolutionId,
  type MediaResolutionOption,
  type ThinkingLevelId,
  type ThinkingLevelOption,
  type WebBaseModelOption,
  type WebModelConfig,
} from './agent-chat-bar.component';
import {
  AgentConsoleStore,
  type ChatArtifactTrack,
  type ChatArtifactVersion,
  type ChatTurn,
} from './agent-console.store';
import { LogEntryComponent } from './log-entry.component';
import { computeLineDiff, type DiffLine } from '../../core/diff/line-diff';

export { computeLineDiff, type DiffLine };

export {
  AI_STUDIO_TOOL_OPTIONS,
  CREATE_NEW_CHAT_OPTIONS,
  MEDIA_RESOLUTION_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  WEB_BASE_MODELS,
  type AiStudioToolId,
  type AiStudioToolOption,
  type CreateNewChatModeId,
  type CreateNewChatModeOption,
  type MediaResolutionId,
  type MediaResolutionOption,
  type ThinkingLevelId,
  type ThinkingLevelOption,
  type WebBaseModelOption,
  type WebModelConfig,
};

export function buildWebModelId(params: {
  baseModel: string;
  thinkingLevel: ThinkingLevelId;
  mediaResolution: MediaResolutionId;
  tools: readonly AiStudioToolId[];
  createNewChatMode?: CreateNewChatModeId;
}): string {
  const opt = WEB_BASE_MODELS.find((m) => m.id === params.baseModel);
  if (
    opt?.provider &&
    opt.provider !== 'GOOGLE_WEB' &&
    opt.provider !== 'GEMINI_APP'
  ) {
    return params.baseModel;
  }
  const chatMode = params.createNewChatMode ?? 'per-run';
  const normalizedBase = params.baseModel.startsWith('gemini-app:')
    ? params.baseModel.replace(/^gemini-app:/, 'gemini-web:')
    : params.baseModel;
  if (normalizedBase.startsWith('gemini-web-guest:')) {
    return `${normalizedBase}?chatMode=${chatMode}`;
  }
  const isAiStudio = normalizedBase.startsWith('aistudio:');
  if (!isAiStudio) {
    return `${normalizedBase}?thinking=${params.thinkingLevel}&chatMode=${chatMode}`;
  }
  const toolsParam = params.tools.join(',');
  return `${normalizedBase}?thinking=${params.thinkingLevel}&tools=${toolsParam}&mediaRes=${params.mediaResolution}&chatMode=${chatMode}`;
}

export function parseWebModelIdString(rawModelId: string | null | undefined): {
  baseModel: string;
  thinkingLevel: ThinkingLevelId;
  mediaResolution: MediaResolutionId;
  tools: AiStudioToolId[];
  createNewChatMode: CreateNewChatModeId;
} {
  const raw = (rawModelId ?? '').trim();
  const [basePartRaw = '', queryPart = ''] = raw.split('?');
  const baseLower = (basePartRaw.split(':thinking-')[0] ?? basePartRaw).toLowerCase();
  const params = new URLSearchParams(queryPart);

  let baseModel = 'gemini-web:3.8-flash';
  if (WEB_BASE_MODELS.some((m) => m.id === baseLower)) {
    baseModel = baseLower;
  } else if (baseLower.startsWith('aistudio')) {
    if (baseLower.includes('3.0-flash')) baseModel = 'aistudio:gemini-3.0-flash';
    else if (baseLower.includes('3.1-flash-lite')) baseModel = 'aistudio:gemini-3.1-flash-lite';
    else if (baseLower.includes('3.1-pro')) baseModel = 'aistudio:gemini-3.1-pro';
    else if (baseLower.includes('3.5-flash-lite') || baseLower.includes('3.5-flash'))
      baseModel = 'aistudio:gemini-3.5-flash-lite';
    else if (
      baseLower.includes('4.0-argon') ||
      baseLower.includes('4-argon') ||
      baseLower.includes('argon')
    )
      baseModel = 'aistudio:gemini-4-argon';
    else baseModel = 'aistudio:gemini-3.8-flash';
  } else if (baseLower.includes('guest')) {
    baseModel = 'gemini-web-guest:3.5-flash-lite';
  } else {
    if (baseLower.includes('3.5-flash-lite')) baseModel = 'gemini-web:3.5-flash-lite';
    else if (baseLower.includes('3.1-pro')) baseModel = 'gemini-web:3.1-pro';
    else if (
      baseLower.includes('4.0-argon') ||
      baseLower.includes('4-argon') ||
      baseLower.includes('argon')
    )
      baseModel = 'gemini-web:4.0-argon';
    else baseModel = 'gemini-web:3.8-flash';
  }

  const thinkingRaw = (params.get('thinking') || 'medium').toLowerCase();
  const thinkingLevel: ThinkingLevelId =
    thinkingRaw === 'low' ? 'low' : thinkingRaw === 'high' ? 'high' : 'medium';

  const mediaRaw = (params.get('mediaRes') || 'default').toLowerCase();
  const mediaResolution: MediaResolutionId =
    mediaRaw === 'low' || mediaRaw === 'medium' || mediaRaw === 'high'
      ? mediaRaw
      : 'default';

  const toolsRaw = params.get('tools');
  const validToolIds = new Set<AiStudioToolId>(AI_STUDIO_TOOL_OPTIONS.map((t) => t.id));
  const tools: AiStudioToolId[] =
    toolsRaw === null
      ? ['googleSearch']
      : toolsRaw
          .split(',')
          .map((x) => x.trim() as AiStudioToolId)
          .filter((x) => validToolIds.has(x));

  const chatModeRaw = (params.get('chatMode') || 'per-run').toLowerCase();
  const createNewChatMode: CreateNewChatModeId =
    chatModeRaw === 'always'
      ? 'always'
      : chatModeRaw === 'first-run'
        ? 'first-run'
        : 'per-run';

  return {
    baseModel,
    thinkingLevel,
    mediaResolution,
    tools,
    createNewChatMode,
  };
}

@Component({
  selector: 'rd-agent-console',
  standalone: true,
  imports: [
    DecimalPipe,
    BytesPipe,
    RelativeTimePipe,
    AgentAvatarComponent,
    AgentChatBarComponent,
    CopySplitButtonComponent,
    IconComponent,
    LogEntryComponent,
    MarkdownViewComponent,
  ],
  templateUrl: './agent-console.component.html',
  styleUrl: './agent-console.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentConsoleComponent {
  readonly store = inject(StudioStoreService);
  readonly consoleStore = inject(AgentConsoleStore);
  private readonly auth = inject(AuthStore);
  private readonly agentsApi = inject(AgentsApiService);
  private readonly llmApi = inject(LlmApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  readonly agentKey = input.required<AgentKey>();
  readonly wide = input(false);

  readonly webBaseModels = WEB_BASE_MODELS;
  readonly thinkingLevels = THINKING_LEVEL_OPTIONS;
  readonly mediaResolutions = MEDIA_RESOLUTION_OPTIONS;
  readonly createNewChatOptions = CREATE_NEW_CHAT_OPTIONS;
  readonly aiStudioToolOptions = AI_STUDIO_TOOL_OPTIONS;
  readonly directiveMetadata = DIRECTIVE_METADATA;

  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');
  readonly userDisplayName = computed(() => this.auth.user()?.displayName?.trim() || 'You');

  readonly pendingHumanRequests = computed(() => {
    const key = this.agentKey();
    return this.store
      .humanRequests()
      .filter((r) => r.status === 'OPEN' && r.agentKey === key);
  });

  readonly agentSummary = computed(() => {
    const key = this.agentKey();
    const live = this.store.agent(key)();
    const detail = this.consoleStore.detail();
    const r = AGENT_BY_KEY[key];
    const isGeneral = this.store.studio()?.contextMode === 'GENERAL';
    return {
      id: live?.id ?? detail?.id ?? r.key,
      key: r.key,
      name: r.name,
      title: isGeneral ? (r.generalTitle ?? r.title) : r.title,
      color: r.color,
      glyph: r.glyph,
      order: r.order,
      status: live?.status ?? detail?.status ?? ('IDLE' as const),
      isEnabled: true,
      currentTaskId: live?.currentTaskId ?? null,
      currentTaskTitle: live?.currentTaskTitle ?? null,
      currentRunId: live?.currentRunId ?? null,
      currentGameId: live?.currentGameId ?? null,
      lastActivityAt: live?.lastActivityAt ?? null,
      lastSnippet: live?.lastSnippet ?? null,
      modelLabel: detail?.modelLabel ?? live?.modelLabel ?? null,
      lastErrorCode: null,
    };
  });

  readonly isGoogleWebProvider = computed(
    () => this.consoleStore.detail()?.provider === 'GOOGLE_WEB',
  );

  readonly parsedConfig = computed(() =>
    parseWebModelIdString(this.consoleStore.detail()?.modelId),
  );

  readonly isAiStudioModel = computed(() =>
    this.parsedConfig().baseModel.startsWith('aistudio:'),
  );

  readonly isGuestWebModel = computed(() =>
    this.parsedConfig().baseModel.startsWith('gemini-web-guest:'),
  );

  readonly browserVisibility = signal<BrowserVisibilityStatusDto | null>(null);
  readonly togglingBrowser = signal<boolean>(false);
  readonly deletingAgentWebChat = signal<boolean>(false);
  readonly deletingLastRunWebChats = signal<boolean>(false);
  readonly answeringNow = signal<boolean>(false);
  readonly openModelPopoverTurnId = signal<string | null>(null);
  readonly openTokenPopoverKey = signal<string | null>(null);

  readonly artifactsDrawerOpen = signal<boolean>(false);
  readonly selectedArtifactTrackKey = signal<string | null>(null);
  readonly selectedArtifactVersionNum = signal<number | null>(null);
  readonly compareBaseVersionNum = signal<number | null>(null);
  readonly artifactViewMode = signal<'code' | 'diff'>('code');
  readonly copiedArtifactId = signal<string | null>(null);
  readonly externalCodeContentById = signal<Record<string, string>>({});

  readonly selectedArtifactTrack = computed<ChatArtifactTrack | null>(() => {
    const tracks = this.consoleStore.chatArtifactTracks();
    if (tracks.length === 0) return null;
    const key = this.selectedArtifactTrackKey();
    return tracks.find((t) => t.key === key) ?? tracks[0] ?? null;
  });

  readonly selectedArtifactVersion = computed<ChatArtifactVersion | null>(() => {
    const track = this.selectedArtifactTrack();
    if (!track || track.versions.length === 0) return null;
    const num = this.selectedArtifactVersionNum();
    return (
      track.versions.find((v) => v.versionNumber === num) ??
      track.latestVersion
    );
  });

  readonly compareBaseVersion = computed<ChatArtifactVersion | null>(() => {
    const track = this.selectedArtifactTrack();
    const current = this.selectedArtifactVersion();
    if (!track || !current || track.versions.length < 2) return null;
    const explicitBase = this.compareBaseVersionNum();
    if (explicitBase !== null && explicitBase !== current.versionNumber) {
      const found = track.versions.find((v) => v.versionNumber === explicitBase);
      if (found) return found;
    }
    const prevIdx = track.versions.findIndex(
      (v) => v.versionNumber === current.versionNumber,
    );
    if (prevIdx > 0) {
      return track.versions[prevIdx - 1] ?? null;
    }
    return track.versions[0] ?? null;
  });

  readonly artifactDiffLines = computed<DiffLine[]>(() => {
    const cur = this.selectedArtifactVersion();
    const base = this.compareBaseVersion();
    if (!cur || !base) return [];
    return computeLineDiff(base.content, cur.content);
  });

  toggleTurnModelPopover(turnId: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openTokenPopoverKey.set(null);
    this.openModelPopoverTurnId.update((cur) => (cur === turnId ? null : turnId));
  }

  toggleTokenPopover(key: string, event: MouseEvent): void {
    event.stopPropagation();
    this.openModelPopoverTurnId.set(null);
    this.openTokenPopoverKey.update((cur) => (cur === key ? null : key));
  }

  toggleArtifactsDrawer(): void {
    const nextOpen = !this.artifactsDrawerOpen();
    this.artifactsDrawerOpen.set(nextOpen);
    if (nextOpen) {
      const track = this.selectedArtifactTrack();
      if (track) {
        this.selectedArtifactTrackKey.set(track.key);
        this.selectedArtifactVersionNum.set(track.latestVersion.versionNumber);
        if (track.versions.length > 1) {
          this.compareBaseVersionNum.set(
            track.versions[track.versions.length - 2]?.versionNumber ?? 1,
          );
        }
      }
    }
  }

  selectArtifactTrack(track: ChatArtifactTrack): void {
    this.selectedArtifactTrackKey.set(track.key);
    this.selectedArtifactVersionNum.set(track.latestVersion.versionNumber);
    if (track.versions.length > 1) {
      this.compareBaseVersionNum.set(
        track.versions[track.versions.length - 2]?.versionNumber ?? 1,
      );
    } else {
      this.compareBaseVersionNum.set(null);
      this.artifactViewMode.set('code');
    }
  }

  selectArtifactVersion(versionNum: number): void {
    this.selectedArtifactVersionNum.set(versionNum);
    const track = this.selectedArtifactTrack();
    if (track && track.versions.length > 1) {
      const prevVersion =
        versionNum > 1
          ? versionNum - 1
          : (track.versions[track.versions.length - 1]?.versionNumber ?? 1);
      this.compareBaseVersionNum.set(prevVersion);
    }
  }

  setCompareBaseVersion(versionNum: number): void {
    this.compareBaseVersionNum.set(versionNum);
  }

  setArtifactViewMode(mode: 'code' | 'diff'): void {
    this.artifactViewMode.set(mode);
  }

  copyRawArtifact(id: string, code: string, event?: MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    void navigator.clipboard?.writeText(code).then(() => {
      this.copiedArtifactId.set(id);
      setTimeout(() => {
        if (this.copiedArtifactId() === id) {
          this.copiedArtifactId.set(null);
        }
      }, 1500);
    });
  }

  downloadRawArtifact(
    filename: string,
    code: string,
    event?: MouseEvent,
    previewUrl?: string | null,
  ): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    const cleanFilename = (filename || 'artifact.txt').split(/[\\/]/).pop() || 'artifact.txt';
    if (!code && previewUrl) {
      const anchor = document.createElement('a');
      anchor.href = previewUrl;
      anchor.download = cleanFilename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      return;
    }
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = cleanFilename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  onOpenFilePath(filePath: string | undefined, event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (!filePath) return;
    void openFileWithSystemDialog(filePath, this.studioSlug(), this.toast);
  }

  resolvedVersionContent(ver: ChatArtifactVersion | null | undefined): string {
    if (!ver) return '';
    if (ver.content) return ver.content;
    return this.externalCodeContentById()[ver.id] ?? '';
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.openModelPopoverTurnId() && !target?.closest('.chat-bubble__model-wrap')) {
      this.openModelPopoverTurnId.set(null);
    }
    if (this.openTokenPopoverKey() && !target?.closest('.chat-bubble__tokens-wrap')) {
      this.openTokenPopoverKey.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.openModelPopoverTurnId()) {
      this.openModelPopoverTurnId.set(null);
    }
    if (this.openTokenPopoverKey()) {
      this.openTokenPopoverKey.set(null);
    }
    if (this.artifactsDrawerOpen()) {
      this.artifactsDrawerOpen.set(false);
    }
  }

  readonly isBrowserVisible = computed(() => {
    const status = this.browserVisibility();
    if (status) return status.visible;
    return !(this.store.studio()?.browserHeadless ?? true);
  });

  constructor() {
    effect(() => {
      const key = this.agentKey();
      const studioReady = this.store.loadState() === 'ready';
      if (studioReady && key) {
        untracked(() => {
          void this.consoleStore.select(key);
          void this.refreshBrowserVisibility();
        });
      }
    });

    effect(() => {
      const ver = this.selectedArtifactVersion();
      if (
        ver &&
        (!ver.previewKind || ver.previewKind === 'code') &&
        !ver.content &&
        ver.previewUrl
      ) {
        const curMap = untracked(() => this.externalCodeContentById());
        if (curMap[ver.id] === undefined) {
          const url = ver.previewUrl;
          const id = ver.id;
          void fetch(url)
            .then(async (r) => {
              const txt = r.ok
                ? await r.text()
                : `(File preview unavailable on disk: ${ver.path})`;
              this.externalCodeContentById.update((prev) => ({
                ...prev,
                [id]: txt,
              }));
            })
            .catch(() => {
              this.externalCodeContentById.update((prev) => ({
                ...prev,
                [id]: `(File preview unavailable: ${ver.path})`,
              }));
            });
        }
      }
    });
  }

  async refreshBrowserVisibility(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || !this.store.canEdit()) return;
    try {
      const status = await firstValueFrom(this.llmApi.getBrowserVisibility(studioId));
      this.browserVisibility.set(status);
    } catch {
      // Ignore if not available
    }
  }

  async onToggleBrowserVisibility(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.togglingBrowser()) return;
    this.togglingBrowser.set(true);
    try {
      const targetVisible = !this.isBrowserVisible();
      const status = await firstValueFrom(
        this.llmApi.setBrowserVisibility(studioId, targetVisible),
      );
      this.browserVisibility.set(status);
      this.toast.success(
        status.visible
          ? 'Agent browser window is now visible'
          : 'Agent browser window hidden',
      );
    } catch {
      this.toast.error('Could not toggle browser visibility.');
    } finally {
      this.togglingBrowser.set(false);
    }
  }

  async onDeleteAgentWebChat(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const key = this.agentKey();
    if (!studioId || this.deletingAgentWebChat()) return;
    this.deletingAgentWebChat.set(true);
    try {
      const res = await firstValueFrom(this.llmApi.deleteAgentWebChats(studioId, key));
      if (res.deletedFromWebCount > 0) {
        this.toast.success(
          `Deleted ${res.deletedFromWebCount} web chat${res.deletedFromWebCount === 1 ? '' : 's'} created by ${this.agentSummary().name}`,
        );
      } else {
        this.toast.info(res.message);
      }
    } catch {
      this.toast.error(`Failed to delete web chats for ${this.agentSummary().name}`);
    } finally {
      this.deletingAgentWebChat.set(false);
    }
  }

  async onDeleteLastRunWebChats(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.deletingLastRunWebChats()) return;
    this.deletingLastRunWebChats.set(true);
    try {
      const res = await firstValueFrom(this.llmApi.deleteLastRunWebChats(studioId));
      if (res.deletedFromWebCount > 0) {
        this.toast.success(
          `Deleted ${res.deletedFromWebCount} web chat${res.deletedFromWebCount === 1 ? '' : 's'} from the last run`,
        );
      } else {
        this.toast.info(res.message);
      }
    } catch {
      this.toast.error('Failed to delete web chats from the last run');
    } finally {
      this.deletingLastRunWebChats.set(false);
    }
  }

  hasAiStudioTool(toolId: AiStudioToolId): boolean {
    return this.parsedConfig().tools.includes(toolId);
  }

  async onWebModelChange(baseModel: string): Promise<void> {
    const cur = this.parsedConfig();
    await this.saveWebConfig({ ...cur, baseModel });
  }

  async onThinkingLevelChange(thinkingLevel: ThinkingLevelId): Promise<void> {
    const cur = this.parsedConfig();
    await this.saveWebConfig({ ...cur, thinkingLevel });
  }

  async onMediaResolutionChange(mediaResolution: MediaResolutionId): Promise<void> {
    const cur = this.parsedConfig();
    await this.saveWebConfig({ ...cur, mediaResolution });
  }

  async onCreateNewChatModeChange(createNewChatMode: CreateNewChatModeId): Promise<void> {
    const cur = this.parsedConfig();
    await this.saveWebConfig({ ...cur, createNewChatMode });
  }

  async onToggleAiStudioTool(toolId: AiStudioToolId): Promise<void> {
    const cur = this.parsedConfig();
    const nextTools = cur.tools.includes(toolId)
      ? cur.tools.filter((t) => t !== toolId)
      : [...cur.tools, toolId];
    await this.saveWebConfig({ ...cur, tools: nextTools });
  }

  async onApplyToAllAgents(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const connId = this.consoleStore.detail()?.llmConnectionId;
    if (!studioId || !connId) return;
    const combinedModelId = buildWebModelId(this.parsedConfig());
    const res = await firstValueFrom(
      this.llmApi.bindAllAgents(studioId, connId, combinedModelId),
    );
    await this.consoleStore.select(this.agentKey());
    await this.store.reloadSnapshot();
    this.toast.success(`Applied settings to all ${res.boundCount} studio agents`);
  }

  async onModelConfigChange(config: WebModelConfig): Promise<void> {
    await this.saveWebConfig(config);
  }

  private async saveWebConfig(params: {
    baseModel: string;
    thinkingLevel: ThinkingLevelId;
    mediaResolution: MediaResolutionId;
    tools: readonly AiStudioToolId[];
    createNewChatMode?: CreateNewChatModeId;
  }): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    const combinedModelId = buildWebModelId(params);
    const opt = WEB_BASE_MODELS.find((m) => m.id === params.baseModel);
    const targetProvider = opt?.provider ?? 'GOOGLE_WEB';

    let targetConnectionId: string | undefined;
    const currentDetail = this.consoleStore.detail();
    if (currentDetail?.provider !== targetProvider) {
      const conns = await firstValueFrom(this.llmApi.listConnections(studioId)).catch(
        () => [],
      );
      const existingConn = conns.find((c) => c.provider === targetProvider);
      if (existingConn) {
        targetConnectionId = existingConn.id;
      } else {
        const createdConn = await firstValueFrom(
          this.llmApi.createConnection(studioId, {
            provider: targetProvider,
            label: opt?.group ?? targetProvider,
            baseUrl: null,
            apiKey: null,
          }),
        ).catch(() => null);
        if (createdConn) {
          targetConnectionId = createdConn.id;
        }
      }
    }

    const updated = await firstValueFrom(
      this.agentsApi.update(studioId, this.agentKey(), {
        ...(targetConnectionId ? { llmConnectionId: targetConnectionId } : {}),
        modelId: combinedModelId,
      }),
    );
    this.consoleStore.detail.set(updated);
    await this.store.reloadSnapshot();
    this.toast.success(`Updated ${this.agentSummary().name} model settings`);
  }

  onSelectRun(runId: string | null): void {
    void this.consoleStore.selectRun(runId);
  }

  onSendMessage(payload: string | ChatComposerPayload): void {
    void this.consoleStore.send(payload);
  }

  onFreshStart(): void {
    void this.consoleStore.freshStart();
  }

  onUndoLastTurn(): void {
    const turns = this.consoleStore.chatTurns();
    const last = turns[turns.length - 1];
    if (last) {
      void this.consoleStore.branchFrom(last, 'USER');
    }
  }

  onRetryLastTurn(): void {
    const turns = this.consoleStore.chatTurns();
    const last = turns[turns.length - 1];
    if (last) {
      void this.consoleStore.retryTurn(last, 'CURRENT');
    }
  }

  onDeleteTurnPart(turn: ChatTurn, part: 'USER' | 'AI', event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.consoleStore.deleteTurnPart(turn, part);
  }

  onBranchFrom(turn: ChatTurn, part: 'USER' | 'AI', event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.consoleStore.branchFrom(turn, part);
  }

  onRetryTurn(
    turn: ChatTurn,
    mode: 'CURRENT' | 'SAME_AGENT',
    event?: MouseEvent,
  ): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.consoleStore.retryTurn(turn, mode);
  }

  onToggleArchive(archiveId: string, event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.consoleStore.toggleArchive(archiveId);
  }

  onDeleteArchive(archiveId: string, event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.consoleStore.deleteArchive(archiveId);
  }

  onDeleteAllArchives(event?: MouseEvent): void {
    event?.preventDefault();
    event?.stopPropagation();
    void this.consoleStore.deleteAllArchives();
  }

  isArchiveExpanded(archiveId: string): boolean {
    return this.consoleStore.expandedArchiveIds().has(archiveId);
  }

  isArchiveLoading(archiveId: string): boolean {
    return this.consoleStore.archiveLoadingIds().has(archiveId);
  }

  archiveTurns(archiveId: string): ChatTurn[] {
    return this.consoleStore.archiveTurnsById()[archiveId] ?? [];
  }

  attachmentBadgeLabel(att: ChatAttachment): string {
    switch (att.kind) {
      case 'vault_doc':
        return `Vault: ${att.title}`;
      case 'workspace_file':
        return att.relPath ?? att.path;
      case 'workspace_folder':
        return `${att.relPath ?? att.path}/`;
      case 'game':
        return `Game: ${att.name}`;
      case 'task':
        return `Task: ${att.title}`;
      case 'chat_artifact':
        return `Artifact: ${att.path}`;
      case 'upload_file':
        return att.name;
      case 'upload_folder':
        return `${att.name ?? att.rootName} (${att.fileCount} files)`;
      case 'local_folder':
        return `${att.name ?? att.absPath} (linked)`;
      case 'image':
        return att.name;
    }
  }

  onDecisionOptionClick(label: string, optionId: string): void {
    const text = optionId === 'deny' ? `Deny: ${label}` : `Approve: ${label}`;
    void this.consoleStore.send(text);
  }

  onCancelRun(): void {
    void this.consoleStore.cancelRun();
  }

  async onAnswerNow(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.answeringNow()) return;
    this.answeringNow.set(true);
    try {
      const res = await firstValueFrom(
        this.llmApi.answerNow(studioId, {
          runId: this.consoleStore.liveRunId(),
          agentKey: this.agentKey(),
        }),
      );
      if (res.ok) {
        this.toast.success(res.message);
      } else {
        this.toast.info(res.message);
      }
    } catch {
      this.toast.error('Failed to trigger Answer Now.');
    } finally {
      this.answeringNow.set(false);
    }
  }

  onDeleteRun(runId: string): void {
    void this.consoleStore.deleteRun(runId);
  }

  onStartFresh(): void {
    void this.consoleStore.deleteAllAgentRuns();
  }

  onClearAllStudioRuns(): void {
    void this.consoleStore.deleteAllStudioRuns();
  }

  highlightArtifact(art: RunArtifactDto): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      LuauHighlighter.highlight(art.content, art.language),
    );
  }

  highlightRawCode(code: string, lang?: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      LuauHighlighter.highlight(code, lang) || ' ',
    );
  }

  onWikilink(target: string): void {
    void this.router.navigate(['/s', this.studioSlug(), 'library'], {
      queryParams: { q: target },
    });
  }
}
