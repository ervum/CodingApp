import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type {
  DetectedLocalRuntimeDto,
  DetectedLocalServerDto,
  LlmConnectionDto,
  LlmProvider,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { LlmApiService } from '../../core/api/llm-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  GOOGLE_WEB: 'Google AI Subscription (Gemini Web / AI Studio — No API Key)',
  CLAUDE_WEB: 'Claude Web (claude.ai Browser Session — No API Key)',
  CHATGPT_WEB: 'ChatGPT Web (chatgpt.com Browser Session — No API Key)',
  ANTIGRAVITY: 'Antigravity (IDE / Agent CLI — No API Key)',
  CLAUDE_CODE: 'Claude Code (CLI Agent — Subscription / Key)',
  CODEX: 'OpenAI Codex (CLI Agent — Subscription / Key)',
  GEMINI_APP: 'Gemini Desktop App (Local App Session)',
  CLAUDE_APP: 'Claude Desktop App (Local App Session)',
  GPT_APP: 'ChatGPT Desktop App / GPT App (Local App Session)',
  OLLAMA: 'Local AI (Ollama / LM Studio / llama.cpp — No API Key)',
  RUNPOD: 'RunPod / Cloud GPU Server (Pod Proxy or Serverless vLLM)',
  GOOGLE: 'Google Gemini API (Token Key)',
  OPENAI: 'OpenAI API (Token Key)',
  ANTHROPIC: 'Anthropic API (Token Key)',
  XAI: 'xAI Grok API (Token Key)',
  OPENAI_COMPATIBLE: 'Other OpenAI-Compatible Endpoint',
};

export type RunpodMode = 'pod-proxy' | 'serverless' | 'custom';

@Component({
  selector: 'rd-connection-form-dialog',
  standalone: true,
  imports: [FormsModule, DialogComponent, IconComponent],
  templateUrl: './connection-form-dialog.component.html',
  styleUrl: './connection-form-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionFormDialogComponent {
  readonly store = inject(StudioStoreService);
  private readonly llmApi = inject(LlmApiService);
  private readonly toast = inject(ToastService);

  readonly connection = input<LlmConnectionDto | null>(null);
  readonly open = model(false);
  readonly saved = output<LlmConnectionDto>();

  readonly providers: Array<{ id: LlmProvider; label: string }> = [
    { id: 'GOOGLE_WEB', label: PROVIDER_LABEL.GOOGLE_WEB },
    { id: 'CLAUDE_WEB', label: PROVIDER_LABEL.CLAUDE_WEB },
    { id: 'CHATGPT_WEB', label: PROVIDER_LABEL.CHATGPT_WEB },
    { id: 'ANTIGRAVITY', label: PROVIDER_LABEL.ANTIGRAVITY },
    { id: 'CLAUDE_CODE', label: PROVIDER_LABEL.CLAUDE_CODE },
    { id: 'CODEX', label: PROVIDER_LABEL.CODEX },
    { id: 'GEMINI_APP', label: PROVIDER_LABEL.GEMINI_APP },
    { id: 'CLAUDE_APP', label: PROVIDER_LABEL.CLAUDE_APP },
    { id: 'GPT_APP', label: PROVIDER_LABEL.GPT_APP },
    { id: 'OLLAMA', label: PROVIDER_LABEL.OLLAMA },
    { id: 'RUNPOD', label: PROVIDER_LABEL.RUNPOD },
    { id: 'GOOGLE', label: PROVIDER_LABEL.GOOGLE },
    { id: 'OPENAI', label: PROVIDER_LABEL.OPENAI },
    { id: 'ANTHROPIC', label: PROVIDER_LABEL.ANTHROPIC },
    { id: 'XAI', label: PROVIDER_LABEL.XAI },
    { id: 'OPENAI_COMPATIBLE', label: PROVIDER_LABEL.OPENAI_COMPATIBLE },
  ];

  readonly provider = signal<LlmProvider>('GOOGLE_WEB');
  readonly label = signal('Google AI Subscription (Web)');
  readonly baseUrl = signal('https://gemini.google.com/app');
  readonly apiKey = signal('');
  readonly inputCostPerMTok = signal<number | null>(null);
  readonly outputCostPerMTok = signal<number | null>(null);
  readonly submitting = signal(false);

  // Local AI & Local Runtime detection state
  readonly detectingLocal = signal(false);
  readonly detectedServers = signal<DetectedLocalServerDto[]>([]);
  readonly detectedRuntimes = signal<DetectedLocalRuntimeDto[]>([]);
  readonly selectedRuntime = computed(() =>
    this.detectedRuntimes().find((r) => r.provider === this.provider()) ?? null,
  );

  // RunPod builder state
  readonly runpodMode = signal<RunpodMode>('pod-proxy');
  readonly runpodPodId = signal('');
  readonly runpodPort = signal<number>(8000);
  readonly runpodEndpointId = signal('');

  readonly isEditing = computed(() => !!this.connection());
  readonly isBrowserSessionProvider = computed(() =>
    [
      'GOOGLE_WEB',
      'CLAUDE_WEB',
      'CHATGPT_WEB',
      'GEMINI_APP',
      'CLAUDE_APP',
      'GPT_APP',
      'ANTIGRAVITY',
    ].includes(this.provider()),
  );
  readonly isCliProvider = computed(() =>
    ['ANTIGRAVITY', 'CLAUDE_CODE', 'CODEX'].includes(this.provider()),
  );
  readonly hideApiKey = computed(() =>
    [
      'OLLAMA',
      'GOOGLE_WEB',
      'CLAUDE_WEB',
      'CHATGPT_WEB',
      'GEMINI_APP',
      'CLAUDE_APP',
      'GPT_APP',
      'ANTIGRAVITY',
    ].includes(this.provider()),
  );
  readonly apiKeyOptional = computed(() =>
    ['RUNPOD', 'OPENAI_COMPATIBLE', 'CLAUDE_CODE', 'CODEX'].includes(this.provider()),
  );
  readonly dialogTitle = computed(() =>
    this.isEditing() ? 'Edit model connection' : 'Add model connection',
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const studioId = this.store.studio()?.id;
      if (studioId) {
        void firstValueFrom(this.llmApi.detectLocalRuntimes(studioId))
          .then((list) => this.detectedRuntimes.set(list))
          .catch(() => {});
      }
      const conn = this.connection();
      if (conn) {
        this.provider.set(conn.provider);
        this.label.set(conn.label);
        this.baseUrl.set(conn.baseUrl ?? '');
        this.apiKey.set('');
        this.inputCostPerMTok.set(conn.inputCostPerMTok ?? null);
        this.outputCostPerMTok.set(conn.outputCostPerMTok ?? null);
      } else {
        this.provider.set('GOOGLE_WEB');
        this.label.set('Google AI Subscription (Web)');
        this.baseUrl.set('https://gemini.google.com/app');
        this.apiKey.set('');
        this.inputCostPerMTok.set(null);
        this.outputCostPerMTok.set(null);
        this.detectedServers.set([]);
      }
    });
  }

  onProviderChange(p: LlmProvider): void {
    this.provider.set(p);
    if (!this.isEditing()) {
      switch (p) {
        case 'GOOGLE_WEB':
          this.label.set('Google AI Subscription (Web)');
          this.baseUrl.set('https://gemini.google.com/app');
          break;
        case 'CLAUDE_WEB':
          this.label.set('Claude Web (Browser Session)');
          this.baseUrl.set('https://claude.ai/new');
          break;
        case 'CHATGPT_WEB':
          this.label.set('ChatGPT Web (Browser Session)');
          this.baseUrl.set('https://chatgpt.com');
          break;
        case 'ANTIGRAVITY':
          this.label.set('Antigravity Agent');
          this.baseUrl.set('antigravity://local');
          break;
        case 'CLAUDE_CODE':
          this.label.set('Claude Code (CLI)');
          this.baseUrl.set('claude-code://local');
          break;
        case 'CODEX':
          this.label.set('OpenAI Codex (CLI)');
          this.baseUrl.set('codex://local');
          break;
        case 'GEMINI_APP':
          this.label.set('Gemini Desktop App');
          this.baseUrl.set('gemini-app://local');
          break;
        case 'CLAUDE_APP':
          this.label.set('Claude Desktop App');
          this.baseUrl.set('claude-app://local');
          break;
        case 'GPT_APP':
          this.label.set('ChatGPT Desktop App (GPT App)');
          this.baseUrl.set('gpt-app://local');
          break;
        case 'OLLAMA':
          this.label.set('Local AI (Ollama)');
          this.baseUrl.set('http://localhost:11434/v1');
          break;
        case 'RUNPOD':
          this.label.set('RunPod Cloud GPU');
          this.runpodMode.set('pod-proxy');
          this.updateRunpodUrl();
          break;
        default:
          this.label.set(PROVIDER_LABEL[p]);
          this.baseUrl.set('');
          break;
      }
    }
  }

  applyGoogleWebTarget(url: string, labelText: string): void {
    this.baseUrl.set(url);
    if (!this.isEditing()) {
      this.label.set(labelText);
    }
  }

  applyLocalPreset(url: string, labelText: string): void {
    this.baseUrl.set(url);
    if (!this.isEditing()) {
      this.label.set(labelText);
    }
  }

  async detectLocal(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.detectingLocal()) return;
    this.detectingLocal.set(true);
    try {
      const found = await firstValueFrom(this.llmApi.detectLocalServers(studioId));
      this.detectedServers.set(found);
      if (found.length > 0 && found[0]) {
        this.baseUrl.set(found[0].baseUrl);
        this.label.set(found[0].name);
        this.toast.success(`Detected ${found.length} running local AI server(s)`);
      } else {
        this.toast.info(
          'No running local server detected on ports 11434, 1234, 8080, 8000, or 5001.',
        );
      }
    } catch {
      this.toast.error('Failed to scan local ports.');
    } finally {
      this.detectingLocal.set(false);
    }
  }

  onRunpodBuilderChange(): void {
    this.updateRunpodUrl();
  }

  private updateRunpodUrl(): void {
    const mode = this.runpodMode();
    if (mode === 'pod-proxy') {
      const pod = this.runpodPodId().trim() || '<pod-id>';
      const port = this.runpodPort() || 8000;
      this.baseUrl.set(`https://${pod}-${port}.proxy.runpod.net/v1`);
    } else if (mode === 'serverless') {
      const ep = this.runpodEndpointId().trim() || '<endpoint-id>';
      this.baseUrl.set(`https://api.runpod.ai/v2/${ep}/openai/v1`);
    }
  }

  async submit(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const labelVal = this.label().trim();
    if (!studioId || labelVal.length < 2 || this.submitting()) return;

    this.submitting.set(true);
    try {
      const existing = this.connection();
      let result: LlmConnectionDto;
      const inCost =
        this.inputCostPerMTok() !== null &&
        String(this.inputCostPerMTok()).trim() !== '' &&
        Number.isFinite(Number(this.inputCostPerMTok()))
          ? Math.max(0, Number(this.inputCostPerMTok()))
          : null;
      const outCost =
        this.outputCostPerMTok() !== null &&
        String(this.outputCostPerMTok()).trim() !== '' &&
        Number.isFinite(Number(this.outputCostPerMTok()))
          ? Math.max(0, Number(this.outputCostPerMTok()))
          : null;

      if (existing) {
        result = await firstValueFrom(
          this.llmApi.updateConnection(studioId, existing.id, {
            label: labelVal,
            baseUrl: this.baseUrl().trim() || null,
            inputCostPerMTok: inCost,
            outputCostPerMTok: outCost,
            ...(this.apiKey().trim().length > 0 ? { apiKey: this.apiKey().trim() } : {}),
          }),
        );
      } else {
        result = await firstValueFrom(
          this.llmApi.createConnection(studioId, {
            provider: this.provider(),
            label: labelVal,
            baseUrl: this.baseUrl().trim() || null,
            apiKey: this.hideApiKey() ? null : this.apiKey().trim() || null,
            inputCostPerMTok: inCost,
            outputCostPerMTok: outCost,
          }),
        );
      }

      if (
        this.provider() === 'GOOGLE_WEB' ||
        this.provider() === 'CLAUDE_WEB' ||
        this.provider() === 'CHATGPT_WEB'
      ) {
        this.toast.info(
          `Saved ${result.label}. Click "Sign in with Browser" on the row to log into your account.`,
        );
      } else {
        const testRes = await firstValueFrom(
          this.llmApi.testConnection(studioId, result.id),
        ).catch(() => null);
        if (testRes?.ok) {
          this.toast.success(
            `Saved & verified (${testRes.modelCount} models in ${testRes.latencyMs}ms)`,
          );
        } else if (testRes) {
          this.toast.warning(`Saved connection, test failed: ${testRes.error ?? 'unreachable'}`);
        } else {
          this.toast.success('Connection saved');
        }
      }

      this.open.set(false);
      this.saved.emit(result);
    } finally {
      this.submitting.set(false);
    }
  }
}
