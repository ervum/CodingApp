import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  AgentKey,
  ChatAttachment,
  ChatComposerPayload,
  ChatDirective,
  ChatMentionItemDto,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { AgentsApiService } from '../../core/api/agents-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AutosizeDirective } from '../../shared/directives/autosize.directive';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import type { IconName } from '../../shared/ui/icon/icons';
import { ToastService } from '../../shared/ui/toast/toast.service';

export type ThinkingLevelId = 'low' | 'medium' | 'high';
export type MediaResolutionId = 'default' | 'low' | 'medium' | 'high';
export type CreateNewChatModeId = 'always' | 'per-run' | 'first-run';
export type AiStudioToolId =
  | 'googleSearch'
  | 'urlContext'
  | 'codeExecution'
  | 'functionCalling'
  | 'structuredOutputs'
  | 'googleMaps';

export interface WebModelConfig {
  readonly baseModel: string;
  readonly thinkingLevel: ThinkingLevelId;
  readonly mediaResolution: MediaResolutionId;
  readonly tools: readonly AiStudioToolId[];
  readonly createNewChatMode: CreateNewChatModeId;
}

export type WebModelGroup =
  | 'Gemini Web'
  | 'Gemini Web (Guest)'
  | 'Google AI Studio'
  | 'Antigravity'
  | 'Claude Code'
  | 'Codex'
  | 'Gemini App'
  | 'Claude App'
  | 'GPT App'
  | 'Claude Web'
  | 'ChatGPT Web';

export interface WebBaseModelOption {
  readonly id: string;
  readonly group: WebModelGroup;
  readonly label: string;
  readonly provider?:
    | 'GOOGLE_WEB'
    | 'ANTIGRAVITY'
    | 'CLAUDE_CODE'
    | 'CODEX'
    | 'GEMINI_APP'
    | 'CLAUDE_APP'
    | 'GPT_APP'
    | 'CLAUDE_WEB'
    | 'CHATGPT_WEB';
}

export interface ThinkingLevelOption {
  readonly id: ThinkingLevelId;
  readonly label: string;
  readonly shortLabel: string;
}

export interface MediaResolutionOption {
  readonly id: MediaResolutionId;
  readonly label: string;
  readonly shortLabel: string;
}

export interface CreateNewChatModeOption {
  readonly id: CreateNewChatModeId;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

export interface AiStudioToolOption {
  readonly id: AiStudioToolId;
  readonly shortLabel: string;
  readonly fullLabel: string;
}

export interface SlashCommandOption {
  readonly command: string;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly directive?: ChatDirective;
  readonly action?:
    | 'screenshot'
    | 'fresh'
    | 'undo'
    | 'retry'
    | 'cancel'
    | 'files'
    | 'folder'
    | 'model'
    | 'help';
}

export const SLASH_COMMANDS: readonly SlashCommandOption[] = [
  {
    command: '/pc-control',
    label: 'PC Control (Main PC)',
    description: 'Authorize direct mouse & keyboard control on your Main PC for this task',
    icon: 'keyboard',
    directive: 'PC_CONTROL',
  },
  {
    command: '/pc-control-with-sandbox',
    label: 'PC Control with Sandbox',
    description: 'Run desktop & app automation inside the isolated Agent Sandbox',
    icon: 'cube',
    directive: 'PC_CONTROL_SANDBOX',
  },
  {
    command: '/screenshot',
    label: 'Capture Screenshot',
    description: 'Capture a live desktop screenshot and attach it to your message',
    icon: 'camera',
    action: 'screenshot',
  },
  {
    command: '/browser',
    label: 'Browser Agent',
    description: 'Equip this turn with autonomous Playwright web browsing tools',
    icon: 'globe',
    directive: 'BROWSER',
  },
  {
    command: '/plan',
    label: 'Plan First',
    description: 'Ask the agent to produce a structured step-by-step plan before changes',
    icon: 'tasks',
    directive: 'PLAN_FIRST',
  },
  {
    command: '/fresh',
    label: 'Start Fresh (Archive Chat)',
    description: 'Collapse current messages into Archive #N at the top of the chat',
    icon: 'archive',
    action: 'fresh',
  },
  {
    command: '/undo',
    label: 'Undo / Branch Last Turn',
    description: 'Move the last turn into a Branch Archive #N',
    icon: 'undo',
    action: 'undo',
  },
  {
    command: '/retry',
    label: 'Retry Last Turn',
    description: 'Archive the last AI response and re-run with current agent config',
    icon: 'rotate-ccw',
    action: 'retry',
  },
  {
    command: '/cancel',
    label: 'Cancel Active Run',
    description: 'Stop the currently running agent turn immediately',
    icon: 'stop',
    action: 'cancel',
  },
  {
    command: '/files',
    label: 'Attach Files',
    description: 'Select files from your computer to send to the agent',
    icon: 'file-text',
    action: 'files',
  },
  {
    command: '/folder',
    label: 'Link Local Folder',
    description: 'Link a local folder (read-only access, no copy) to this chat',
    icon: 'folder-open',
    action: 'folder',
  },
  {
    command: '/model',
    label: 'Switch Model & Options',
    description: 'Open the model, thinking level, and session mode selector',
    icon: 'sparkles',
    action: 'model',
  },
  {
    command: '/help',
    label: 'Composer Shortcuts Help',
    description: 'Show available @context mentions, /commands, and + attachments',
    icon: 'message-square',
    action: 'help',
  },
];

export const DIRECTIVE_METADATA: Record<
  ChatDirective,
  { command: string; label: string; icon: IconName }
> = {
  PC_CONTROL: {
    command: '/pc-control',
    label: 'Main PC Control',
    icon: 'keyboard',
  },
  PC_CONTROL_SANDBOX: {
    command: '/pc-control-with-sandbox',
    label: 'Sandbox PC Control',
    icon: 'cube',
  },
  BROWSER: {
    command: '/browser',
    label: 'Browser Agent',
    icon: 'globe',
  },
  PLAN_FIRST: {
    command: '/plan',
    label: 'Plan First',
    icon: 'tasks',
  },
};

export const WEB_BASE_MODELS: readonly WebBaseModelOption[] = [
  {
    id: 'gemini-web:3.5-flash-lite',
    group: 'Gemini Web',
    label: 'Gemini Web · 3.5 Flash-Lite',
  },
  {
    id: 'gemini-web:3.8-flash',
    group: 'Gemini Web',
    label: 'Gemini Web · 3.8 Flash',
  },
  {
    id: 'gemini-web:3.1-pro',
    group: 'Gemini Web',
    label: 'Gemini Web · 3.1 Pro',
  },
  {
    id: 'gemini-web:4.0-argon',
    group: 'Gemini Web',
    label: 'Gemini Web · 4.0 Argon',
  },
  {
    id: 'gemini-web-guest:3.5-flash-lite',
    group: 'Gemini Web (Guest)',
    label: 'Gemini Guest · 3.5 Flash-Lite',
  },
  {
    id: 'aistudio:gemini-3.0-flash',
    group: 'Google AI Studio',
    label: 'AI Studio · 3.0 Flash',
  },
  {
    id: 'aistudio:gemini-3.1-flash-lite',
    group: 'Google AI Studio',
    label: 'AI Studio · 3.1 Flash Lite',
  },
  {
    id: 'aistudio:gemini-3.1-pro',
    group: 'Google AI Studio',
    label: 'AI Studio · 3.1 Pro',
  },
  {
    id: 'aistudio:gemini-3.5-flash-lite',
    group: 'Google AI Studio',
    label: 'AI Studio · 3.5 Flash Lite',
  },
  {
    id: 'aistudio:gemini-3.8-flash',
    group: 'Google AI Studio',
    label: 'AI Studio · 3.8 Flash',
  },
  {
    id: 'aistudio:gemini-4-argon',
    group: 'Google AI Studio',
    label: 'AI Studio · 4.0 Argon',
    provider: 'GOOGLE_WEB',
  },
  {
    id: 'agy-auto',
    group: 'Antigravity',
    label: 'Antigravity · Auto (Recommended)',
    provider: 'ANTIGRAVITY',
  },
  {
    id: 'gemini-3.1-pro-high',
    group: 'Antigravity',
    label: 'Antigravity · Gemini 3.1 Pro (High)',
    provider: 'ANTIGRAVITY',
  },
  {
    id: 'gemini-3-flash',
    group: 'Antigravity',
    label: 'Antigravity · Gemini 3 Flash',
    provider: 'ANTIGRAVITY',
  },
  {
    id: 'claude-opus-4-6-thinking',
    group: 'Antigravity',
    label: 'Antigravity · Claude Opus 4.6 Thinking',
    provider: 'ANTIGRAVITY',
  },
  {
    id: 'claude-sonnet-4-6',
    group: 'Claude Code',
    label: 'Claude Code · Sonnet 4.6',
    provider: 'CLAUDE_CODE',
  },
  {
    id: 'claude-opus-4-6',
    group: 'Claude Code',
    label: 'Claude Code · Opus 4.6',
    provider: 'CLAUDE_CODE',
  },
  {
    id: 'claude-haiku-4-5',
    group: 'Claude Code',
    label: 'Claude Code · Haiku 4.5',
    provider: 'CLAUDE_CODE',
  },
  {
    id: 'gpt-5.3-codex',
    group: 'Codex',
    label: 'Codex · GPT-5.3 Codex',
    provider: 'CODEX',
  },
  {
    id: 'gpt-5.4',
    group: 'Codex',
    label: 'Codex · GPT-5.4',
    provider: 'CODEX',
  },
  {
    id: 'o3',
    group: 'Codex',
    label: 'Codex · OpenAI o3',
    provider: 'CODEX',
  },
  {
    id: 'gemini-app:3.8-flash',
    group: 'Gemini App',
    label: 'Gemini App · 3.8 Flash',
    provider: 'GEMINI_APP',
  },
  {
    id: 'gemini-app:3.1-pro',
    group: 'Gemini App',
    label: 'Gemini App · 3.1 Pro',
    provider: 'GEMINI_APP',
  },
  {
    id: 'claude-app-sonnet-4-6',
    group: 'Claude App',
    label: 'Claude App · Sonnet 4.6',
    provider: 'CLAUDE_APP',
  },
  {
    id: 'claude-app-opus-4-6',
    group: 'Claude App',
    label: 'Claude App · Opus 4.6',
    provider: 'CLAUDE_APP',
  },
  {
    id: 'gpt-app-default',
    group: 'GPT App',
    label: 'GPT App · Auto (Default)',
    provider: 'GPT_APP',
  },
  {
    id: 'gpt-app-gpt-5-4',
    group: 'GPT App',
    label: 'GPT App · GPT-5.4',
    provider: 'GPT_APP',
  },
  {
    id: 'gpt-app-gpt-5-4-thinking',
    group: 'GPT App',
    label: 'GPT App · GPT-5.4 Thinking',
    provider: 'GPT_APP',
  },
  {
    id: 'claude-web-sonnet-4-6',
    group: 'Claude Web',
    label: 'Claude Web · Sonnet 4.6',
    provider: 'CLAUDE_WEB',
  },
  {
    id: 'claude-web-opus-4-6',
    group: 'Claude Web',
    label: 'Claude Web · Opus 4.6',
    provider: 'CLAUDE_WEB',
  },
  {
    id: 'claude-web-haiku-4-5',
    group: 'Claude Web',
    label: 'Claude Web · Haiku 4.5',
    provider: 'CLAUDE_WEB',
  },
  {
    id: 'chatgpt-web-default',
    group: 'ChatGPT Web',
    label: 'ChatGPT Web · Auto (Default)',
    provider: 'CHATGPT_WEB',
  },
  {
    id: 'chatgpt-web-gpt-5-4',
    group: 'ChatGPT Web',
    label: 'ChatGPT Web · GPT-5.4',
    provider: 'CHATGPT_WEB',
  },
  {
    id: 'chatgpt-web-gpt-5-4-thinking',
    group: 'ChatGPT Web',
    label: 'ChatGPT Web · GPT-5.4 Thinking',
    provider: 'CHATGPT_WEB',
  },
];

export const THINKING_LEVEL_OPTIONS: readonly ThinkingLevelOption[] = [
  { id: 'low', label: 'Thinking: Low', shortLabel: 'Low' },
  { id: 'medium', label: 'Thinking: Medium', shortLabel: 'Medium' },
  { id: 'high', label: 'Thinking: High', shortLabel: 'High' },
];

export const MEDIA_RESOLUTION_OPTIONS: readonly MediaResolutionOption[] = [
  { id: 'default', label: 'Media: Default', shortLabel: 'Default' },
  { id: 'low', label: 'Media: Low', shortLabel: 'Low' },
  { id: 'medium', label: 'Media: Medium', shortLabel: 'Medium' },
  { id: 'high', label: 'Media: High', shortLabel: 'High' },
];

export const CREATE_NEW_CHAT_OPTIONS: readonly CreateNewChatModeOption[] = [
  {
    id: 'always',
    label: 'Create new chat: Always create',
    shortLabel: 'Always create',
    description:
      'Creates a new chat every time, even if the user input was sent in the same app chat.',
  },
  {
    id: 'per-run',
    label: 'Create new chat: Create on different runs',
    shortLabel: 'On different runs',
    description:
      'Creates a new chat only if a new chat was opened on the app or the synced Gemini/AI Studio chat was deleted.',
  },
  {
    id: 'first-run',
    label: 'Create new chat: Create on first run',
    shortLabel: 'On first run',
    description:
      'Creates a new chat only if none is assigned to the current agent (named after the agent, e.g. "Lead" or "Splash").',
  },
];

export const AI_STUDIO_TOOL_OPTIONS: readonly AiStudioToolOption[] = [
  {
    id: 'googleSearch',
    shortLabel: 'Google Search',
    fullLabel: 'Grounding with Google Search',
  },
  {
    id: 'urlContext',
    shortLabel: 'URL Context',
    fullLabel: 'URL context',
  },
  {
    id: 'codeExecution',
    shortLabel: 'Code Exec',
    fullLabel: 'Code execution',
  },
  {
    id: 'functionCalling',
    shortLabel: 'Function Calling',
    fullLabel: 'Function calling',
  },
  {
    id: 'structuredOutputs',
    shortLabel: 'Structured Out',
    fullLabel: 'Structured outputs',
  },
  {
    id: 'googleMaps',
    shortLabel: 'Google Maps',
    fullLabel: 'Grounding with Google Maps',
  },
];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
}

@Component({
  selector: 'rd-agent-chat-bar',
  standalone: true,
  imports: [FormsModule, AutosizeDirective, IconComponent],
  templateUrl: './agent-chat-bar.component.html',
  styleUrl: './agent-chat-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentChatBarComponent {
  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly agentsApi = inject(AgentsApiService);
  private readonly studioStore = inject(StudioStoreService);
  private readonly toast = inject(ToastService);

  @ViewChild('chatTextarea') chatTextarea?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;
  @ViewChild('folderInput') folderInput?: ElementRef<HTMLInputElement>;

  readonly agentKey = input<AgentKey>('lead');
  readonly agentName = input.required<string>();
  readonly wide = input(false);
  readonly disabled = input(false);
  readonly modelConfig = input<WebModelConfig>({
    baseModel: 'gemini-web:3.8-flash',
    thinkingLevel: 'medium',
    mediaResolution: 'default',
    tools: ['googleSearch'],
    createNewChatMode: 'per-run',
  });

  readonly send = output<ChatComposerPayload>();
  readonly freshStart = output<void>();
  readonly undoLast = output<void>();
  readonly retryLast = output<void>();
  readonly cancelRun = output<void>();
  readonly modelConfigChange = output<WebModelConfig>();

  readonly text = signal('');
  readonly attachments = signal<ChatAttachment[]>([]);
  readonly directives = signal<ChatDirective[]>([]);

  readonly menuOpen = signal(false);
  readonly plusMenuOpen = signal(false);
  readonly plusFoldersSubmenuOpen = signal(false);
  readonly mentionMenuOpen = signal(false);
  readonly slashMenuOpen = signal(false);

  readonly mentionQuery = signal('');
  readonly slashQuery = signal('');
  readonly mentionItems = signal<ChatMentionItemDto[]>([]);
  readonly mentionLoading = signal(false);
  readonly activePopoverIndex = signal(0);
  readonly uploadingBusy = signal(false);

  private activeTriggerRange: { start: number; end: number } | null = null;

  readonly webBaseModels = WEB_BASE_MODELS;
  readonly thinkingLevels = THINKING_LEVEL_OPTIONS;
  readonly mediaResolutions = MEDIA_RESOLUTION_OPTIONS;
  readonly createNewChatOptions = CREATE_NEW_CHAT_OPTIONS;
  readonly aiStudioToolOptions = AI_STUDIO_TOOL_OPTIONS;
  readonly directiveMetadata = DIRECTIVE_METADATA;

  readonly filteredSlashCommands = computed<SlashCommandOption[]>(() => {
    const q = this.slashQuery().trim().toLowerCase();
    if (!q) return [...SLASH_COMMANDS];
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.command.slice(1).toLowerCase().includes(q) ||
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q),
    );
  });

  readonly isAiStudioModel = computed(() =>
    this.modelConfig().baseModel.startsWith('aistudio:'),
  );

  readonly isGuestWebModel = computed(() =>
    this.modelConfig().baseModel.startsWith('gemini-web-guest:'),
  );

  readonly currentModelLabel = computed(() => {
    const base = this.modelConfig().baseModel;
    const found = WEB_BASE_MODELS.find((m) => m.id === base);
    return found ? found.label : base;
  });

  readonly placeholder = computed(() =>
    this.wide()
      ? 'Ask anything, or type @ for context, / for commands...'
      : `Message ${this.agentName()}... (@ context, / commands)`,
  );

  readonly canSend = computed(
    () =>
      !this.disabled() &&
      !this.uploadingBusy() &&
      (this.text().trim().length > 0 ||
        this.attachments().length > 0 ||
        this.directives().length > 0),
  );

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target as Node | null;
    if (target && !this.hostRef.nativeElement.contains(target)) {
      this.menuOpen.set(false);
      this.plusMenuOpen.set(false);
      this.plusFoldersSubmenuOpen.set(false);
      this.mentionMenuOpen.set(false);
      this.slashMenuOpen.set(false);
    }
  }

  toggleMenu(): void {
    if (this.disabled()) return;
    this.plusMenuOpen.set(false);
    this.mentionMenuOpen.set(false);
    this.slashMenuOpen.set(false);
    this.menuOpen.update((v) => !v);
  }

  togglePlusMenu(event?: MouseEvent): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (this.disabled()) return;
    this.menuOpen.set(false);
    this.mentionMenuOpen.set(false);
    this.slashMenuOpen.set(false);
    const next = !this.plusMenuOpen();
    this.plusMenuOpen.set(next);
    if (!next) {
      this.plusFoldersSubmenuOpen.set(false);
    }
  }

  togglePlusFoldersSubmenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.plusFoldersSubmenuOpen.update((v) => !v);
  }

  onPlusPickFiles(event?: MouseEvent): void {
    event?.stopPropagation();
    this.plusMenuOpen.set(false);
    this.plusFoldersSubmenuOpen.set(false);
    this.fileInput?.nativeElement.click();
  }

  onPlusUploadFolderCopy(event?: MouseEvent): void {
    event?.stopPropagation();
    this.plusMenuOpen.set(false);
    this.plusFoldersSubmenuOpen.set(false);
    this.folderInput?.nativeElement.click();
  }

  async onPlusLinkLocalFolder(event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    this.plusMenuOpen.set(false);
    this.plusFoldersSubmenuOpen.set(false);
    const studioId = this.studioStore.studio()?.id;
    if (!studioId || this.uploadingBusy()) return;
    this.uploadingBusy.set(true);
    try {
      const res = await firstValueFrom(this.agentsApi.pickChatLocalFolder(studioId));
      if (!res.cancelled && res.attachment) {
        this.addAttachment(res.attachment);
        this.toast.success('Linked local folder (read-only access)');
      }
    } catch {
      this.toast.error('Could not open local folder picker');
    } finally {
      this.uploadingBusy.set(false);
      this.focusTextarea();
    }
  }

  onPlusActions(event?: MouseEvent): void {
    event?.stopPropagation();
    this.plusMenuOpen.set(false);
    this.plusFoldersSubmenuOpen.set(false);
    this.insertTriggerChar('/');
  }

  onPlusContext(event?: MouseEvent): void {
    event?.stopPropagation();
    this.plusMenuOpen.set(false);
    this.plusFoldersSubmenuOpen.set(false);
    this.insertTriggerChar('@');
  }

  private insertTriggerChar(char: '/' | '@'): void {
    const cur = this.text();
    const needsSpace = cur.length > 0 && !/\s$/.test(cur);
    const nextText = `${cur}${needsSpace ? ' ' : ''}${char}`;
    this.text.set(nextText);
    const triggerStart = nextText.length - 1;
    this.activeTriggerRange = { start: triggerStart, end: nextText.length };
    this.activePopoverIndex.set(0);

    if (char === '/') {
      this.slashQuery.set('');
      this.mentionMenuOpen.set(false);
      this.slashMenuOpen.set(true);
    } else {
      this.mentionQuery.set('');
      this.slashMenuOpen.set(false);
      this.mentionMenuOpen.set(true);
      void this.loadMentions('');
    }
    this.focusTextarea(nextText.length);
  }

  private focusTextarea(cursorPos?: number): void {
    setTimeout(() => {
      const el = this.chatTextarea?.nativeElement;
      if (!el) return;
      el.focus();
      if (typeof cursorPos === 'number') {
        el.setSelectionRange(cursorPos, cursorPos);
      }
    }, 0);
  }

  onTextChange(nextValue: string): void {
    this.text.set(nextValue);
    const el = this.chatTextarea?.nativeElement;
    const caret = el?.selectionStart ?? nextValue.length;
    this.detectTriggerToken(nextValue, caret);
  }

  private detectTriggerToken(value: string, caret: number): void {
    const beforeCaret = value.slice(0, caret);

    // Check for @mention trigger
    const atMatch = /(?:^|\s)@([^\s@]*)$/.exec(beforeCaret);
    if (atMatch) {
      const query = atMatch[1] ?? '';
      const tokenStart = caret - query.length - 1;
      this.activeTriggerRange = { start: tokenStart, end: caret };
      this.mentionQuery.set(query);
      this.activePopoverIndex.set(0);
      this.slashMenuOpen.set(false);
      this.mentionMenuOpen.set(true);
      void this.loadMentions(query);
      return;
    }

    // Check for /command trigger
    const slashMatch = /(?:^|\s)\/([a-zA-Z0-9_-]*)$/.exec(beforeCaret);
    if (slashMatch) {
      const query = slashMatch[1] ?? '';
      const tokenStart = caret - query.length - 1;
      this.activeTriggerRange = { start: tokenStart, end: caret };
      this.slashQuery.set(query);
      this.activePopoverIndex.set(0);
      this.mentionMenuOpen.set(false);
      this.slashMenuOpen.set(true);
      return;
    }

    this.mentionMenuOpen.set(false);
    this.slashMenuOpen.set(false);
    this.activeTriggerRange = null;
  }

  private async loadMentions(query: string): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    this.mentionLoading.set(true);
    try {
      const items = await firstValueFrom(
        this.agentsApi.listChatMentions(studioId, {
          q: query,
          agentKey: this.agentKey(),
        }),
      );
      this.mentionItems.set(items);
    } catch {
      this.mentionItems.set([]);
    } finally {
      this.mentionLoading.set(false);
    }
  }

  selectMentionItem(item: ChatMentionItemDto, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.stripActiveTriggerToken();
    this.addAttachment(item.attachment);
    this.mentionMenuOpen.set(false);
    this.focusTextarea();
  }

  async selectSlashCommand(cmd: SlashCommandOption, event?: Event): Promise<void> {
    event?.preventDefault();
    event?.stopPropagation();
    this.stripActiveTriggerToken();
    this.slashMenuOpen.set(false);

    if (cmd.directive) {
      this.addDirective(cmd.directive);
      this.focusTextarea();
      return;
    }

    switch (cmd.action) {
      case 'screenshot':
        await this.captureScreenshotAndAttach();
        break;
      case 'fresh':
        this.freshStart.emit();
        break;
      case 'undo':
        this.undoLast.emit();
        break;
      case 'retry':
        this.retryLast.emit();
        break;
      case 'cancel':
        this.cancelRun.emit();
        break;
      case 'files':
        this.onPlusPickFiles();
        break;
      case 'folder':
        await this.onPlusLinkLocalFolder();
        break;
      case 'model':
        this.menuOpen.set(true);
        break;
      case 'help':
        this.toast.info(
          'Use @ to attach Vault rules, Workspace files/folders, Games, Tasks & Artifacts. Use / for commands (/pc-control, /pc-control-with-sandbox, /screenshot, /browser, /plan, /fresh, /undo, /retry) or click + to attach files & folders.',
        );
        this.focusTextarea();
        break;
    }
  }

  private stripActiveTriggerToken(): void {
    const cur = this.text();
    const range = this.activeTriggerRange;
    if (!range) return;
    const before = cur.slice(0, range.start);
    const after = cur.slice(range.end);
    const cleaned = `${before}${after}`.replace(/\s{2,}/g, ' ').trimStart();
    this.text.set(cleaned);
    this.activeTriggerRange = null;
  }

  addAttachment(att: ChatAttachment): void {
    this.attachments.update((list) => {
      const key = this.attachmentKey(att);
      if (list.some((x) => this.attachmentKey(x) === key)) {
        return list;
      }
      return [...list, att];
    });
  }

  removeAttachment(index: number, event?: Event): void {
    event?.stopPropagation();
    this.attachments.update((list) => list.filter((_, i) => i !== index));
  }

  addDirective(dir: ChatDirective): void {
    this.directives.update((list) => {
      let filtered = [...list];
      if (dir === 'PC_CONTROL') {
        filtered = filtered.filter((d) => d !== 'PC_CONTROL_SANDBOX');
      } else if (dir === 'PC_CONTROL_SANDBOX') {
        filtered = filtered.filter((d) => d !== 'PC_CONTROL');
      }
      if (filtered.includes(dir)) return filtered;
      return [...filtered, dir];
    });
  }

  removeDirective(dir: ChatDirective, event?: Event): void {
    event?.stopPropagation();
    this.directives.update((list) => list.filter((d) => d !== dir));
  }

  attachmentKey(att: ChatAttachment): string {
    switch (att.kind) {
      case 'vault_doc':
        return `vault:${att.documentId}`;
      case 'workspace_file':
        return `ws-file:${att.relPath ?? att.path}`;
      case 'workspace_folder':
        return `ws-folder:${att.relPath ?? att.path}`;
      case 'game':
        return `game:${att.gameId}`;
      case 'task':
        return `task:${att.taskId}`;
      case 'chat_artifact':
        return `artifact:${att.artifactId ?? att.path}`;
      case 'upload_file':
        return `upload-file:${att.uploadId}:${att.relPath ?? att.name}`;
      case 'upload_folder':
        return `upload-folder:${att.uploadId}`;
      case 'local_folder':
        return `local-folder:${att.absPath}`;
      case 'image':
        return `image:${att.mediaId}`;
    }
  }

  attachmentLabel(att: ChatAttachment): string {
    switch (att.kind) {
      case 'vault_doc':
        return att.title;
      case 'workspace_file':
        return att.relPath ?? att.path;
      case 'workspace_folder':
        return `${att.relPath ?? att.path}/`;
      case 'game':
        return att.name;
      case 'task':
        return att.title;
      case 'chat_artifact':
        return att.path;
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

  attachmentIcon(att: ChatAttachment): IconName {
    switch (att.kind) {
      case 'vault_doc':
        return 'library';
      case 'workspace_file':
      case 'upload_file':
      case 'chat_artifact':
        return 'file-text';
      case 'workspace_folder':
      case 'upload_folder':
      case 'local_folder':
        return 'folder';
      case 'game':
        return 'games';
      case 'task':
        return 'tasks';
      case 'image':
        return 'image';
    }
  }

  async onFilesSelected(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const fileList = inputEl.files ? Array.from(inputEl.files) : [];
    inputEl.value = '';
    if (fileList.length === 0) return;
    await this.uploadBrowserFiles(fileList, 'files');
  }

  async onFolderSelected(event: Event): Promise<void> {
    const inputEl = event.target as HTMLInputElement;
    const fileList = inputEl.files ? Array.from(inputEl.files) : [];
    inputEl.value = '';
    if (fileList.length === 0) return;
    const firstRel =
      (fileList[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
    const folderName = firstRel.split('/')[0] || 'Folder';
    await this.uploadBrowserFiles(fileList, 'folder', folderName);
  }

  private async uploadBrowserFiles(
    files: File[],
    mode: 'files' | 'folder',
    folderName?: string,
  ): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    this.uploadingBusy.set(true);
    try {
      const encoded = await Promise.all(
        files.slice(0, 200).map(async (f) => ({
          name: f.name,
          relPath:
            (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
          mimeType: f.type || 'application/octet-stream',
          base64: await fileToBase64(f),
        })),
      );
      const res = await firstValueFrom(
        this.agentsApi.uploadChatFiles(studioId, {
          mode,
          folderName,
          files: encoded,
        }),
      );
      for (const att of res.attachments) {
        this.addAttachment(att);
      }
      this.toast.success(
        mode === 'folder'
          ? `Attached folder "${folderName ?? 'Folder'}" (${encoded.length} files)`
          : `Attached ${res.attachments.length} file${res.attachments.length === 1 ? '' : 's'}`,
      );
    } catch {
      this.toast.error('Failed to upload selected files');
    } finally {
      this.uploadingBusy.set(false);
      this.focusTextarea();
    }
  }

  async captureScreenshotAndAttach(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId || this.uploadingBusy()) return;
    this.uploadingBusy.set(true);
    try {
      const res = await firstValueFrom(this.agentsApi.captureChatScreenshot(studioId));
      this.addAttachment(res.attachment);
      this.toast.success('Captured desktop screenshot');
    } catch {
      this.toast.error('Failed to capture screenshot');
    } finally {
      this.uploadingBusy.set(false);
      this.focusTextarea();
    }
  }

  async onPaste(event: ClipboardEvent): Promise<void> {
    const items = event.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item && item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) imageFiles.push(f);
      }
    }
    if (imageFiles.length > 0) {
      event.preventDefault();
      await this.uploadBrowserFiles(imageFiles, 'files');
    }
  }

  onBaseModelChange(baseModel: string): void {
    this.modelConfigChange.emit({
      ...this.modelConfig(),
      baseModel,
    });
  }

  onThinkingChange(thinkingLevel: ThinkingLevelId): void {
    this.modelConfigChange.emit({
      ...this.modelConfig(),
      thinkingLevel,
    });
  }

  onMediaResolutionChange(mediaResolution: MediaResolutionId): void {
    this.modelConfigChange.emit({
      ...this.modelConfig(),
      mediaResolution,
    });
  }

  onCreateNewChatModeChange(createNewChatMode: CreateNewChatModeId): void {
    this.modelConfigChange.emit({
      ...this.modelConfig(),
      createNewChatMode,
    });
  }

  hasTool(toolId: AiStudioToolId): boolean {
    return this.modelConfig().tools.includes(toolId);
  }

  onToggleTool(toolId: AiStudioToolId): void {
    const cur = this.modelConfig();
    const nextTools = cur.tools.includes(toolId)
      ? cur.tools.filter((t) => t !== toolId)
      : [...cur.tools, toolId];
    this.modelConfigChange.emit({
      ...cur,
      tools: nextTools,
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (this.mentionMenuOpen()) {
      const list = this.mentionItems();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.activePopoverIndex.update((i) => (list.length > 0 ? (i + 1) % list.length : 0));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.activePopoverIndex.update((i) =>
          list.length > 0 ? (i - 1 + list.length) % list.length : 0,
        );
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && list.length > 0) {
        event.preventDefault();
        const chosen = list[this.activePopoverIndex()] ?? list[0];
        if (chosen) {
          this.selectMentionItem(chosen);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.mentionMenuOpen.set(false);
        return;
      }
    }

    if (this.slashMenuOpen()) {
      const list = this.filteredSlashCommands();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.activePopoverIndex.update((i) => (list.length > 0 ? (i + 1) % list.length : 0));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.activePopoverIndex.update((i) =>
          list.length > 0 ? (i - 1 + list.length) % list.length : 0,
        );
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && list.length > 0) {
        event.preventDefault();
        const chosen = list[this.activePopoverIndex()] ?? list[0];
        if (chosen) {
          void this.selectSlashCommand(chosen);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.slashMenuOpen.set(false);
        return;
      }
    }

    if (event.key === 'Enter' && (!event.shiftKey || event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.submit();
    }
  }

  submit(): void {
    if (!this.canSend()) return;
    const body = this.text().trim();
    const attachments = this.attachments();
    const directives = this.directives();
    this.send.emit({
      body,
      attachments,
      directives,
    });
    this.text.set('');
    this.attachments.set([]);
    this.directives.set([]);
    this.mentionMenuOpen.set(false);
    this.slashMenuOpen.set(false);
  }
}
