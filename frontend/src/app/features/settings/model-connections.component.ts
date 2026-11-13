import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AGENT_BY_KEY,
  type AgentKey,
  type BrowserVisibilityStatusDto,
  type CodingMode,
  type CodingSyncTool,
  type ContextMode,
  type DetectedLocalRuntimeDto,
  type LlmConnectionDto,
  type LlmProvider,
  type SandboxAccessPolicy,
  type SandboxProviderKind,
  type WebChatPlatform,
  type WebChatSessionDto,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { AgentsApiService } from '../../core/api/agents-api.service';
import { LlmApiService } from '../../core/api/llm-api.service';
import { StudioApiService } from '../../core/api/studio-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import {
  ConnectionFormDialogComponent,
  PROVIDER_LABEL,
} from './connection-form-dialog.component';
import {
  AI_STUDIO_TOOL_OPTIONS,
  CREATE_NEW_CHAT_OPTIONS,
  MEDIA_RESOLUTION_OPTIONS,
  THINKING_LEVEL_OPTIONS,
  WEB_BASE_MODELS,
  buildWebModelId,
  parseWebModelIdString,
  type AiStudioToolId,
  type CreateNewChatModeId,
  type MediaResolutionId,
  type ThinkingLevelId,
} from '../team/agent-console.component';

export interface ContextModeOption {
  id: ContextMode;
  label: string;
  badge: string;
  description: string;
}

export const CONTEXT_MODE_OPTIONS: ReadonlyArray<ContextModeOption> = [
  {
    id: 'GENERAL',
    label: 'General Mode (Non-Roblox Software Engineering)',
    badge: 'General',
    description:
      'Deactivates Roblox-specific prompts, Luau rules, and Silicon folder transformations. Agents write general software (TypeScript, Python, Web, Node.js, CLI, C++, Rust, etc.) directly inside /workspace/.',
  },
  {
    id: 'ROBLOX',
    label: 'Roblox Mode (Roblox Studio & Luau Game Development)',
    badge: 'Roblox',
    description:
      'Optimizes all 15 specialist agents, Knowledge Vault injections, Luau static diagnostics, and Silicon / Rojo / MCP synchronization for Roblox game development.',
  },
];

export interface CodingModeOption {
  id: CodingMode;
  label: string;
  description: string;
}

export interface CodingSyncToolOption {
  id: CodingSyncTool;
  label: string;
  badge: string;
  description: string;
  exampleTree: string;
}

export const CODING_MODE_OPTIONS: ReadonlyArray<CodingModeOption> = [
  {
    id: 'ROBLOX_MCP',
    label: "1. Creating files directly in Roblox through Roblox Studio's MCP",
    description:
      'Agents push Luau scripts and parent Folder instances directly into the open Roblox Studio DataModel via the local Roblox Studio MCP proxy (%LOCALAPPDATA%\\Roblox\\mcp.bat).',
  },
  {
    id: 'LOCAL_SYNC',
    label:
      "2. Creating files locally following Silicon / Rojo / Azul / Argon / Pesto / rbxmk's architecture",
    description:
      'Agents generate local files in your workspace strictly following the selected synchronization program architecture.',
  },
];

export const CODING_SYNC_TOOL_OPTIONS: ReadonlyArray<CodingSyncToolOption> = [
  {
    id: 'SILICON',
    label: 'Silicon (Uniform Instance Folder)',
    badge: 'Personal Plugin',
    description:
      'Every Roblox Instance is a directory under Game/ containing Properties.yaml (ClassName, Properties, Attributes, Tags) and Source.[shared|client|server].luau for scripts.',
    exampleTree: [
      'Game/',
      '└── StarterPlayer/',
      '    ├── Properties.yaml',
      '    └── StarterPlayerScripts/',
      '        ├── Properties.yaml',
      '        └── CombatClient/',
      '            ├── Properties.yaml       <-- ClassName: LocalScript',
      '            └── Source.client.luau    <-- Clean, pure Luau source code',
    ].join('\n'),
  },
  {
    id: 'ROJO',
    label: 'Rojo',
    badge: 'default.project.json',
    description:
      'Maps src/server (*.server.luau), src/client (*.client.luau), and src/shared (*.luau) via default.project.json and *.meta.json.',
    exampleTree: [
      'default.project.json',
      'src/',
      '├── client/CombatClient.client.luau',
      '├── server/CombatServer.server.luau',
      '└── shared/CombatConfig.luau',
    ].join('\n'),
  },
  {
    id: 'AZUL',
    label: 'Azul',
    badge: 'azul.toml / sync.json',
    description:
      'Service folders mirror the Roblox DataModel with *.server.luau, *.client.luau, *.luau, and *.azul.json metadata.',
    exampleTree: [
      'azul.toml',
      'StarterPlayer/StarterPlayerScripts/',
      '├── CombatClient.client.luau',
      '└── CombatClient.azul.json',
    ].join('\n'),
  },
  {
    id: 'ARGON',
    label: 'Argon',
    badge: 'default.project.json',
    description:
      'Uses src/server, src/client, and src/shared with init.luau / *.data.json instance property definitions.',
    exampleTree: [
      'default.project.json',
      'src/client/CombatClient/',
      '├── init.client.luau',
      '└── init.data.json',
    ].join('\n'),
  },
  {
    id: 'PESTO',
    label: 'Pesto',
    badge: '*.pesto.yaml',
    description:
      'Mirrors Roblox DataModel service directories with *.server.luau, *.client.luau, *.luau, and *.pesto.yaml metadata.',
    exampleTree: [
      'StarterPlayer/StarterPlayerScripts/',
      '├── CombatClient.client.luau',
      '└── CombatClient.pesto.yaml',
    ].join('\n'),
  },
  {
    id: 'RBXMK',
    label: 'rbxmk',
    badge: 'build.lua',
    description:
      'Script-driven place builder under game/<Service>/... with *.server.luau, *.client.luau, *.luau, and *.desc.json.',
    exampleTree: [
      'build.lua',
      'game/StarterPlayer/StarterPlayerScripts/',
      '└── CombatClient.client.luau',
    ].join('\n'),
  },
];

@Component({
  selector: 'rd-model-connections',
  standalone: true,
  imports: [
    FormsModule,
    RelativeTimePipe,
    DialogComponent,
    EmptyStateComponent,
    IconComponent,
    StatusPillComponent,
    ConnectionFormDialogComponent,
  ],
  templateUrl: './model-connections.component.html',
  styleUrl: './model-connections.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelConnectionsComponent {
  readonly store = inject(StudioStoreService);
  private readonly llmApi = inject(LlmApiService);
  private readonly agentsApi = inject(AgentsApiService);
  private readonly studioApi = inject(StudioApiService);
  private readonly toast = inject(ToastService);

  readonly connectionsChanged = output<LlmConnectionDto[]>();

  readonly connections = signal<LlmConnectionDto[]>([]);
  readonly detectedRuntimes = signal<DetectedLocalRuntimeDto[]>([]);
  readonly dialogOpen = signal(false);
  readonly editingConn = signal<LlmConnectionDto | null>(null);
  readonly testingId = signal<string | null>(null);
  readonly browserLoggingInId = signal<string | null>(null);
  readonly quickConnectingProvider = signal<LlmProvider | null>(null);

  // Pull Ollama model dialog state
  readonly pullDialogOpen = signal(false);
  readonly pullTargetConn = signal<LlmConnectionDto | null>(null);
  readonly pullModelName = signal('qwen2.5-coder:7b');
  readonly pullingModel = signal(false);

  // Google Web & AI Studio model + thinking level + tools + media resolution state
  readonly webBaseModels = WEB_BASE_MODELS;
  readonly thinkingLevels = THINKING_LEVEL_OPTIONS;
  readonly mediaResolutions = MEDIA_RESOLUTION_OPTIONS;
  readonly createNewChatOptions = CREATE_NEW_CHAT_OPTIONS;
  readonly aiStudioToolOptions = AI_STUDIO_TOOL_OPTIONS;
  readonly selectedWebModel = signal<string>('gemini-web:3.8-flash');
  readonly selectedThinkingLevel = signal<ThinkingLevelId>('medium');
  readonly selectedMediaResolution = signal<MediaResolutionId>('default');
  readonly selectedCreateNewChatMode = signal<CreateNewChatModeId>('per-run');
  readonly selectedAiStudioTools = signal<AiStudioToolId[]>(['googleSearch', 'urlContext']);

  // Browser visibility & Web Chat Session management state
  readonly browserVisibility = signal<BrowserVisibilityStatusDto | null>(null);
  readonly togglingBrowser = signal<boolean>(false);
  readonly savingStudioSetting = signal<boolean>(false);
  readonly webChats = signal<WebChatSessionDto[]>([]);
  readonly deletingChatId = signal<string | null>(null);
  readonly deletingLastRun = signal<boolean>(false);

  readonly showBrowserByDefault = computed(
    () => !(this.store.studio()?.browserHeadless ?? true),
  );
  readonly autoDeleteCreatedChats = computed(
    () => this.store.studio()?.autoDeleteCreatedChats ?? false,
  );
  readonly isBrowserVisible = computed(() => {
    const status = this.browserVisibility();
    if (status) return status.visible;
    return this.showBrowserByDefault();
  });

  // Context Mode, Permissions, Coding Mode & Synchronization Program state
  readonly contextModes = CONTEXT_MODE_OPTIONS;
  readonly codingModes = CODING_MODE_OPTIONS;
  readonly codingSyncTools = CODING_SYNC_TOOL_OPTIONS;
  readonly contextMode = computed<ContextMode>(
    () => this.store.studio()?.contextMode ?? 'ROBLOX',
  );
  readonly allowTerminalWithoutPermission = computed<boolean>(
    () => this.store.studio()?.allowTerminalWithoutPermission ?? false,
  );
  readonly allowExternalFilesWithoutPermission = computed<boolean>(
    () => this.store.studio()?.allowExternalFilesWithoutPermission ?? false,
  );
  readonly allowPcControlWithoutPermission = computed<boolean>(
    () => this.store.studio()?.allowPcControlWithoutPermission ?? false,
  );
  readonly pcIdleTakeoverSeconds = computed<number>(
    () => this.store.studio()?.pcIdleTakeoverSeconds ?? 60,
  );
  readonly sandboxAccessPolicy = computed<SandboxAccessPolicy>(
    () => this.store.studio()?.sandboxAccessPolicy ?? 'ALLOW',
  );
  readonly sandboxProviderKind = computed<SandboxProviderKind>(
    () => this.store.studio()?.sandboxProviderKind ?? 'LOCAL',
  );
  readonly maxConcurrentSandboxes = computed<number>(
    () => this.store.studio()?.maxConcurrentSandboxes ?? 15,
  );
  readonly allowAutoSaveVersion = computed<boolean>(
    () => this.store.studio()?.allowAutoSaveVersion ?? true,
  );
  readonly allowAutoPublish = computed<boolean>(
    () => this.store.studio()?.allowAutoPublish ?? true,
  );
  readonly openCloudKeyDraft = signal<string>('');
  readonly robloxUniverseIdDraft = signal<string>('');
  readonly robloxPlaceIdDraft = signal<string>('');
  readonly agentPriorityRanking: ReadonlyArray<{
    rank: number;
    key: AgentKey;
    name: string;
    priority: number;
  }> = (
    [
      ['playtest', 100],
      ['tester108', 95],
      ['builder', 90],
      ['scenic', 85],
      ['frame', 80],
      ['reviewer', 75],
      ['lead', 70],
      ['liveops', 60],
      ['architect', 55],
      ['balance', 50],
      ['merchant', 45],
      ['producer', 40],
      ['librarian', 35],
      ['splash', 30],
      ['pulse', 20],
    ] as const
  ).map(([key, priority], idx) => ({
    rank: idx + 1,
    key,
    name: AGENT_BY_KEY[key]?.name ?? key,
    priority,
  }));
  readonly codingMode = computed<CodingMode>(
    () => this.store.studio()?.codingMode ?? 'LOCAL_SYNC',
  );
  readonly codingSyncTool = computed<CodingSyncTool>(
    () => this.store.studio()?.codingSyncTool ?? 'SILICON',
  );
  readonly selectedSyncToolMeta = computed<CodingSyncToolOption>(
    () =>
      this.codingSyncTools.find((t) => t.id === this.codingSyncTool()) ??
      this.codingSyncTools[0]!,
  );

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        void this.load();
      }
    });
  }

  providerLabel(p: LlmProvider): string {
    return PROVIDER_LABEL[p] ?? p;
  }

  isBrowserLoginProvider(p: LlmProvider): boolean {
    return [
      'GOOGLE_WEB',
      'CLAUDE_WEB',
      'CHATGPT_WEB',
      'GEMINI_APP',
      'CLAUDE_APP',
      'GPT_APP',
    ].includes(p);
  }

  hasProviderConnected(p: LlmProvider): boolean {
    return this.connections().some((c) => c.provider === p);
  }

  platformLabel(p: WebChatPlatform): string {
    switch (p) {
      case 'aistudio':
        return 'AI Studio';
      case 'gemini':
        return 'Gemini Web';
      case 'claude-web':
        return 'Claude Web';
      case 'chatgpt-web':
        return 'ChatGPT Web';
      case 'gemini-app':
        return 'Gemini App';
      case 'claude-app':
        return 'Claude App';
      case 'gpt-app':
        return 'GPT App';
      case 'antigravity':
        return 'Antigravity';
      default:
        return p;
    }
  }

  agentName(key: AgentKey): string {
    return AGENT_BY_KEY[key]?.name ?? key;
  }

  async load(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    const [list, vis, chats, leadDetail, runtimes] = await Promise.all([
      firstValueFrom(this.llmApi.listConnections(studioId)),
      firstValueFrom(this.llmApi.getBrowserVisibility(studioId)).catch(() => null),
      firstValueFrom(this.llmApi.listWebChats(studioId)).catch(() => [] as WebChatSessionDto[]),
      firstValueFrom(this.agentsApi.getDetail(studioId, 'lead')).catch(() => null),
      firstValueFrom(this.llmApi.detectLocalRuntimes(studioId)).catch(
        () => [] as DetectedLocalRuntimeDto[],
      ),
    ]);
    this.connections.set(list);
    this.detectedRuntimes.set(runtimes);
    if (vis) this.browserVisibility.set(vis);
    this.webChats.set(chats);
    const st = this.store.studio();
    if (st) {
      this.robloxUniverseIdDraft.set(st.robloxUniverseId ?? '');
      this.robloxPlaceIdDraft.set(st.robloxPlaceId ?? '');
    }
    if (
      (leadDetail?.provider === 'GOOGLE_WEB' || leadDetail?.provider === 'GEMINI_APP') &&
      leadDetail.modelId
    ) {
      const parsed = parseWebModelIdString(leadDetail.modelId);
      this.selectedWebModel.set(parsed.baseModel);
      this.selectedThinkingLevel.set(parsed.thinkingLevel);
      this.selectedMediaResolution.set(parsed.mediaResolution);
      this.selectedCreateNewChatMode.set(parsed.createNewChatMode);
      this.selectedAiStudioTools.set(parsed.tools);
    }
    this.connectionsChanged.emit(list);
  }

  async quickConnectRuntime(rt: DetectedLocalRuntimeDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.quickConnectingProvider()) return;
    this.quickConnectingProvider.set(rt.provider);
    try {
      const existing = this.connections().find((c) => c.provider === rt.provider);
      const conn =
        existing ??
        (await firstValueFrom(
          this.llmApi.createConnection(studioId, {
            provider: rt.provider,
            label: rt.name,
            baseUrl: rt.executablePath ?? null,
            apiKey: null,
          }),
        ));
      const bound = await firstValueFrom(
        this.llmApi.bindAllAgents(studioId, conn.id, rt.defaultModel),
      );
      this.toast.success(
        `Connected ${rt.name} and bound all ${bound.boundCount} agents (${bound.modelId})`,
      );
      await this.load();
      await this.store.reloadSnapshot();
    } catch {
      this.toast.error(`Failed to connect ${rt.name}`);
    } finally {
      this.quickConnectingProvider.set(null);
    }
  }

  async onToggleShowBrowserByDefault(showWindow: boolean): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { browserHeadless: !showWindow }),
      );
      this.store.studio.set(updated);
      const vis = await firstValueFrom(this.llmApi.getBrowserVisibility(studioId)).catch(
        () => null,
      );
      if (vis) this.browserVisibility.set(vis);
      this.toast.success(
        showWindow
          ? 'Browser will now be shown by default when agents run'
          : 'Browser set to headless mode by default',
      );
    } catch {
      this.toast.error('Failed to update browser visibility setting');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onToggleLiveBrowserVisibility(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.togglingBrowser()) return;
    this.togglingBrowser.set(true);
    try {
      const targetVisible = !this.isBrowserVisible();
      const vis = await firstValueFrom(
        this.llmApi.setBrowserVisibility(studioId, targetVisible),
      );
      this.browserVisibility.set(vis);
      this.toast.success(
        vis.visible
          ? 'Agent browser window is now visible'
          : 'Agent browser window hidden',
      );
    } catch {
      this.toast.error('Failed to toggle browser window visibility');
    } finally {
      this.togglingBrowser.set(false);
    }
  }

  async onToggleAutoDeleteCreatedChats(autoDelete: boolean): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { autoDeleteCreatedChats: autoDelete }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        autoDelete
          ? 'Agent-created web chats will be deleted automatically when each task finishes'
          : 'Auto-delete of agent-created web chats disabled',
      );
    } catch {
      this.toast.error('Failed to update auto-delete web chats setting');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onContextModeChange(mode: ContextMode): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting() || this.contextMode() === mode) {
      return;
    }
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { contextMode: mode }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        mode === 'GENERAL'
          ? 'Switched to General mode (Roblox mode deactivated)'
          : 'Switched to Roblox mode',
      );
    } catch {
      this.toast.error('Failed to update studio context mode');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onToggleAllowTerminalWithoutPermission(allow: boolean): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, {
          allowTerminalWithoutPermission: allow,
        }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        allow
          ? 'Agents can now execute terminal commands without asking for permission first'
          : 'Agents will now always ask for permission before executing terminal commands',
      );
    } catch {
      this.toast.error('Failed to update terminal permission setting');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onToggleAllowExternalFilesWithoutPermission(
    allow: boolean,
  ): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, {
          allowExternalFilesWithoutPermission: allow,
        }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        allow
          ? 'Agents can now write files outside /workspace/ without asking for permission'
          : 'Agents will now always ask for permission before writing outside /workspace/',
      );
    } catch {
      this.toast.error('Failed to update external file permission setting');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onToggleAllowPcControlWithoutPermission(allow: boolean): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, {
          allowPcControlWithoutPermission: allow,
        }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        allow
          ? 'Agents can now control the physical Main PC without asking for permission'
          : 'Agents will ask for permission when you are active, or auto-start after idle timeout until Ctrl+Shift+Delete',
      );
    } catch {
      this.toast.error('Failed to update Main PC control permission setting');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onPcIdleTakeoverSecondsChange(seconds: number): Promise<void> {
    const studioId = this.store.studio()?.id;
    const clamped = Math.max(0, Math.min(3600, Math.round(Number(seconds) || 0)));
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, {
          pcIdleTakeoverSeconds: clamped,
        }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        clamped > 0
          ? `Main PC idle auto-takeover set to ${clamped}s (press Ctrl+Shift+Delete to stop)`
          : 'Main PC idle auto-takeover disabled',
      );
    } catch {
      this.toast.error('Failed to update idle auto-takeover timer');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onSandboxAccessPolicyChange(policy: SandboxAccessPolicy): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { sandboxAccessPolicy: policy }),
      );
      this.store.studio.set(updated);
      this.toast.success(`Sandbox access policy set to ${policy}`);
    } catch {
      this.toast.error('Failed to update Sandbox access policy');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onSandboxProviderKindChange(kind: SandboxProviderKind): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { sandboxProviderKind: kind }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        kind === 'CLOUD_GPU'
          ? 'Sandboxes configured for Cloud GPU / Dedicated VM service'
          : 'Sandboxes configured for Local isolated execution',
      );
    } catch {
      this.toast.error('Failed to update Sandbox provider kind');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onToggleAllowAutoSaveVersion(allow: boolean): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { allowAutoSaveVersion: allow }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        allow
          ? 'Agents can save versions automatically without asking'
          : 'Agents will now ask for permission before saving versions',
      );
    } catch {
      this.toast.error('Failed to update auto-save version setting');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onToggleAllowAutoPublish(allow: boolean): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { allowAutoPublish: allow }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        allow
          ? 'Agents can publish places automatically without asking'
          : 'Agents will now ask for permission before publishing places',
      );
    } catch {
      this.toast.error('Failed to update auto-publish setting');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async saveRobloxOpenCloudSettings(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting()) return;
    this.savingStudioSetting.set(true);
    try {
      const payload: {
        robloxUniverseId: string | null;
        robloxPlaceId: string | null;
        openCloudApiKey?: string | null;
      } = {
        robloxUniverseId: this.robloxUniverseIdDraft().trim() || null,
        robloxPlaceId: this.robloxPlaceIdDraft().trim() || null,
      };
      if (this.openCloudKeyDraft().trim()) {
        payload.openCloudApiKey = this.openCloudKeyDraft().trim();
      }
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, payload),
      );
      this.store.studio.set(updated);
      this.openCloudKeyDraft.set('');
      this.toast.success('Saved Roblox Universe / Place ID & Open Cloud settings');
    } catch {
      this.toast.error('Failed to save Roblox Open Cloud settings');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onCodingModeChange(mode: CodingMode): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.savingStudioSetting() || this.codingMode() === mode) {
      return;
    }
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, { codingMode: mode }),
      );
      this.store.studio.set(updated);
      this.toast.success(
        mode === 'ROBLOX_MCP'
          ? "Coding mode set to Roblox Studio's MCP (direct DataModel editing)"
          : `Coding mode set to local synchronization (${this.selectedSyncToolMeta().label})`,
      );
    } catch {
      this.toast.error('Failed to update coding mode');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onCodingSyncToolChange(tool: CodingSyncTool): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (
      !studioId ||
      this.savingStudioSetting() ||
      this.codingSyncTool() === tool
    ) {
      return;
    }
    this.savingStudioSetting.set(true);
    try {
      const updated = await firstValueFrom(
        this.studioApi.update(studioId, {
          codingMode: 'LOCAL_SYNC',
          codingSyncTool: tool,
        }),
      );
      this.store.studio.set(updated);
      const meta =
        this.codingSyncTools.find((t) => t.id === tool) ??
        this.codingSyncTools[0]!;
      this.toast.success(`Synchronization architecture set to ${meta.label}`);
    } catch {
      this.toast.error('Failed to update synchronization program');
    } finally {
      this.savingStudioSetting.set(false);
    }
  }

  async onDeleteSingleWebChat(chat: WebChatSessionDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.deletingChatId()) return;
    this.deletingChatId.set(chat.id);
    try {
      const res = await firstValueFrom(this.llmApi.deleteWebChat(studioId, chat.id));
      if (res.deletedFromWebCount > 0) {
        this.toast.success(
          `Deleted web chat "${chat.chatTitle}" (${this.agentName(chat.agentKey)})`,
        );
      } else {
        this.toast.warning(res.message);
      }
      const chats = await firstValueFrom(this.llmApi.listWebChats(studioId));
      this.webChats.set(chats);
    } catch {
      this.toast.error('Failed to delete web chat');
    } finally {
      this.deletingChatId.set(null);
    }
  }

  async onDeleteAgentWebChats(agentKey: AgentKey): Promise<void> {
    const studioId = this.store.studio()?.id;
    const name = this.agentName(agentKey);
    if (!studioId || this.deletingLastRun()) return;
    this.deletingLastRun.set(true);
    try {
      const res = await firstValueFrom(this.llmApi.deleteAgentWebChats(studioId, agentKey));
      this.toast.success(
        `Deleted ${res.deletedFromWebCount} web chat${res.deletedFromWebCount === 1 ? '' : 's'} created by ${name}`,
      );
      const chats = await firstValueFrom(this.llmApi.listWebChats(studioId));
      this.webChats.set(chats);
    } catch {
      this.toast.error(`Failed to delete web chats for ${name}`);
    } finally {
      this.deletingLastRun.set(false);
    }
  }

  async onDeleteLastRunWebChats(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.deletingLastRun()) return;
    this.deletingLastRun.set(true);
    try {
      const res = await firstValueFrom(this.llmApi.deleteLastRunWebChats(studioId));
      if (res.deletedFromWebCount > 0) {
        this.toast.success(
          `Deleted ${res.deletedFromWebCount} web chat${res.deletedFromWebCount === 1 ? '' : 's'} from the last run`,
        );
      } else {
        this.toast.info(res.message);
      }
      const chats = await firstValueFrom(this.llmApi.listWebChats(studioId));
      this.webChats.set(chats);
    } catch {
      this.toast.error('Failed to delete web chats from the last run');
    } finally {
      this.deletingLastRun.set(false);
    }
  }

  openAdd(): void {
    this.editingConn.set(null);
    this.dialogOpen.set(true);
  }

  openEdit(conn: LlmConnectionDto): void {
    this.editingConn.set(conn);
    this.dialogOpen.set(true);
  }

  async test(conn: LlmConnectionDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.testingId()) return;
    this.testingId.set(conn.id);
    try {
      const res = await firstValueFrom(this.llmApi.testConnection(studioId, conn.id));
      if (res.ok) {
        this.toast.success(`Verified ${conn.label} (${res.modelCount} models, ${res.latencyMs}ms)`);
      } else {
        this.toast.error(`Test failed: ${res.error ?? 'Connection error'}`);
      }
      await this.load();
      await this.store.reloadSnapshot();
    } finally {
      this.testingId.set(null);
    }
  }

  hasSelectedAiStudioTool(toolId: AiStudioToolId): boolean {
    return this.selectedAiStudioTools().includes(toolId);
  }

  async onWebModelSelectChange(conn: LlmConnectionDto, model: string): Promise<void> {
    this.selectedWebModel.set(model);
    if (conn.boundAgentCount > 0) {
      await this.bindAllAgents(conn);
    }
  }

  async onThinkingSelectChange(conn: LlmConnectionDto, level: ThinkingLevelId): Promise<void> {
    this.selectedThinkingLevel.set(level);
    if (conn.boundAgentCount > 0) {
      await this.bindAllAgents(conn);
    }
  }

  async onMediaResSelectChange(
    conn: LlmConnectionDto,
    res: MediaResolutionId,
  ): Promise<void> {
    this.selectedMediaResolution.set(res);
    if (conn.boundAgentCount > 0) {
      await this.bindAllAgents(conn);
    }
  }

  async onCreateNewChatModeSelectChange(
    conn: LlmConnectionDto,
    mode: CreateNewChatModeId,
  ): Promise<void> {
    this.selectedCreateNewChatMode.set(mode);
    if (conn.boundAgentCount > 0) {
      await this.bindAllAgents(conn);
    }
  }

  async toggleSelectedAiStudioTool(
    conn: LlmConnectionDto,
    toolId: AiStudioToolId,
  ): Promise<void> {
    this.selectedAiStudioTools.update((cur) =>
      cur.includes(toolId) ? cur.filter((t) => t !== toolId) : [...cur, toolId],
    );
    if (conn.boundAgentCount > 0) {
      await this.bindAllAgents(conn);
    }
  }

  async bindAllAgents(conn: LlmConnectionDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    const requestedModelId =
      conn.provider === 'GOOGLE_WEB'
        ? buildWebModelId({
            baseModel: this.selectedWebModel(),
            thinkingLevel: this.selectedThinkingLevel(),
            mediaResolution: this.selectedMediaResolution(),
            tools: this.selectedAiStudioTools(),
            createNewChatMode: this.selectedCreateNewChatMode(),
          })
        : undefined;
    try {
      const res = await firstValueFrom(
        this.llmApi.bindAllAgents(studioId, conn.id, requestedModelId),
      );
      this.toast.success(`Bound all ${res.boundCount} agents to ${conn.label} (${res.modelId})`);
      await this.load();
      await this.store.reloadSnapshot();
    } catch {
      this.toast.error(`Could not bind agents to ${conn.label}.`);
    }
  }

  async launchBrowserLogin(conn: LlmConnectionDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.browserLoggingInId()) return;
    this.browserLoggingInId.set(conn.id);
    this.toast.info('Launching Chrome/Edge sign-in window — log into your Google account there.');
    try {
      const res = await firstValueFrom(this.llmApi.browserLogin(studioId, conn.id));
      if (res.authenticated) {
        this.toast.success(res.message);
      } else {
        this.toast.warning(res.message);
      }
      await this.load();
      await this.store.reloadSnapshot();
    } catch {
      this.toast.error('Could not launch browser sign-in window.');
    } finally {
      this.browserLoggingInId.set(null);
    }
  }

  openPullDialog(conn: LlmConnectionDto): void {
    this.pullTargetConn.set(conn);
    this.pullModelName.set('qwen2.5-coder:7b');
    this.pullDialogOpen.set(true);
  }

  async submitPullModel(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const conn = this.pullTargetConn();
    const model = this.pullModelName().trim();
    if (!studioId || !conn || !model || this.pullingModel()) return;
    this.pullingModel.set(true);
    try {
      const res = await firstValueFrom(
        this.llmApi.pullModel(studioId, conn.id, { model }),
      );
      this.toast.success(`Pulled ${res.model} (${res.status})`);
      this.pullDialogOpen.set(false);
      await this.load();
    } catch {
      this.toast.error(`Failed to pull "${model}" from Ollama.`);
    } finally {
      this.pullingModel.set(false);
    }
  }

  extractRunpodPodId(baseUrl: string | null): { podId: string; port: number } | null {
    if (!baseUrl) return null;
    const match = /^https:\/\/([a-zA-Z0-9_-]+)-(\d+)\.proxy\.runpod\.net/i.exec(baseUrl);
    if (!match || !match[1] || !match[2]) return null;
    return { podId: match[1], port: Number(match[2]) };
  }

  async controlRunpod(conn: LlmConnectionDto, action: 'RESUME' | 'STOP'): Promise<void> {
    const studioId = this.store.studio()?.id;
    const pod = this.extractRunpodPodId(conn.baseUrl);
    if (!studioId || !pod) return;
    try {
      const res = await firstValueFrom(
        this.llmApi.controlRunpodPod(studioId, conn.id, {
          podId: pod.podId,
          action,
          port: pod.port,
        }),
      );
      this.toast.success(res.message);
    } catch {
      this.toast.error(`Could not ${action.toLowerCase()} RunPod GPU pod.`);
    }
  }

  async toggleEnabled(conn: LlmConnectionDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    await firstValueFrom(
      this.llmApi.updateConnection(studioId, conn.id, { isEnabled: !conn.isEnabled }),
    );
    await this.load();
  }

  async remove(conn: LlmConnectionDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    await firstValueFrom(this.llmApi.deleteConnection(studioId, conn.id));
    this.toast.warning(`Deleted ${conn.label}`);
    await this.load();
  }
}
