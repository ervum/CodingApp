import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AGENT_ROSTER,
  AGENT_TOOL_DEFINITIONS,
  type AgentDetailDto,
  type AgentKey,
  type AgentTool,
  type AgentToolDefinition,
  type LlmConnectionDto,
  type LlmModelInfoDto,
  type UpdateAgentRequest,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { AgentsApiService } from '../../core/api/agents-api.service';
import { LlmApiService } from '../../core/api/llm-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-agent-model-bindings',
  standalone: true,
  imports: [FormsModule, AgentAvatarComponent, DialogComponent],
  templateUrl: './agent-model-bindings.component.html',
  styleUrl: './agent-model-bindings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentModelBindingsComponent {
  readonly store = inject(StudioStoreService);
  private readonly agentsApi = inject(AgentsApiService);
  private readonly llmApi = inject(LlmApiService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly connections = input<LlmConnectionDto[]>([]);
  readonly rows = signal<AgentDetailDto[]>([]);
  readonly modelsByConn = signal<ReadonlyMap<string, LlmModelInfoDto[]>>(new Map());
  readonly applyingAll = signal(false);

  readonly allToolDefs: readonly AgentToolDefinition[] = Object.values(AGENT_TOOL_DEFINITIONS);
  readonly personaDialogOpen = signal(false);
  readonly editingAgent = signal<AgentDetailDto | null>(null);
  readonly draftSystemPrompt = signal('');
  readonly draftTools = signal<Set<AgentTool>>(new Set());
  readonly savingPersona = signal(false);

  private readonly debounceTimers = new Map<AgentKey, ReturnType<typeof setTimeout>>();
  private readonly loadingModels = new Set<string>();

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        untracked(() => {
          void this.loadAllAgents(studioId);
        });
      }
    });

    effect(() => {
      const conns = this.connections();
      const studioId = this.store.studioId();
      if (studioId && conns.length > 0) {
        untracked(() => {
          for (const c of conns) {
            void this.ensureModelsLoaded(studioId, c.id);
          }
        });
      }
    });

    this.destroyRef.onDestroy(() => {
      for (const t of this.debounceTimers.values()) clearTimeout(t);
    });
  }

  async loadAllAgents(studioId: string): Promise<void> {
    const details = await Promise.all(
      AGENT_ROSTER.map((r) => firstValueFrom(this.agentsApi.getDetail(studioId, r.key))),
    );
    this.rows.set(details.sort((a, b) => a.order - b.order));
    for (const d of details) {
      if (d.llmConnectionId) {
        void this.ensureModelsLoaded(studioId, d.llmConnectionId);
      }
      if (d.imageConnectionId) {
        void this.ensureModelsLoaded(studioId, d.imageConnectionId);
      }
    }
  }

  async ensureModelsLoaded(studioId: string, connId: string): Promise<void> {
    const alreadyLoaded = untracked(() => this.modelsByConn().has(connId));
    if (alreadyLoaded || this.loadingModels.has(connId)) return;
    this.loadingModels.add(connId);
    try {
      const list = await firstValueFrom(this.llmApi.listModels(studioId, connId));
      this.modelsByConn.update((m) => {
        const next = new Map(m);
        next.set(connId, list);
        return next;
      });
    } catch {
      this.modelsByConn.update((m) => {
        const next = new Map(m);
        next.set(connId, []);
        return next;
      });
    } finally {
      this.loadingModels.delete(connId);
    }
  }

  modelsFor(connId: string | null): LlmModelInfoDto[] {
    if (!connId) return [];
    return this.modelsByConn().get(connId) ?? [];
  }

  onConnectionChange(row: AgentDetailDto, connId: string): void {
    const normalized = connId || null;
    const studioId = this.store.studio()?.id;
    if (studioId && normalized) {
      void this.ensureModelsLoaded(studioId, normalized);
    }
    this.patchRow(row.key, { llmConnectionId: normalized });
  }

  onModelChange(row: AgentDetailDto, modelId: string): void {
    this.patchRow(row.key, { modelId: modelId.trim() || null });
  }

  onTempChange(row: AgentDetailDto, temp: number): void {
    const val = Math.min(2, Math.max(0, Number(temp)));
    this.patchRow(row.key, { temperature: val });
  }

  onMaxTokensChange(row: AgentDetailDto, tokens: number): void {
    const val = Math.min(64_000, Math.max(256, Math.round(Number(tokens))));
    this.patchRow(row.key, { maxOutputTokens: val });
  }

  onImageConnChange(row: AgentDetailDto, connId: string): void {
    const normalized = connId || null;
    const studioId = this.store.studio()?.id;
    if (studioId && normalized) {
      void this.ensureModelsLoaded(studioId, normalized);
    }
    this.patchRow(row.key, { imageConnectionId: normalized });
  }

  onImageModelChange(row: AgentDetailDto, modelId: string): void {
    this.patchRow(row.key, { imageModelId: modelId.trim() || null });
  }

  async applyToAll(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const first = this.rows()[0];
    if (!studioId || !first || this.applyingAll()) return;
    this.applyingAll.set(true);
    try {
      const updated = await Promise.all(
        this.rows().map((r) =>
          firstValueFrom(
            this.agentsApi.update(studioId, r.key, {
              llmConnectionId: first.llmConnectionId,
              modelId: first.modelId,
            }),
          ),
        ),
      );
      this.rows.set(updated.sort((a, b) => a.order - b.order));
      await this.store.reloadSnapshot();
      this.toast.success('Applied Lead connection & model to all agents');
    } finally {
      this.applyingAll.set(false);
    }
  }

  openPersonaEditor(row: AgentDetailDto): void {
    this.editingAgent.set(row);
    this.draftSystemPrompt.set(row.systemPrompt);
    this.draftTools.set(new Set(row.tools));
    this.personaDialogOpen.set(true);
  }

  toggleDraftTool(tool: AgentTool): void {
    this.draftTools.update((prev) => {
      const next = new Set(prev);
      if (next.has(tool)) {
        next.delete(tool);
      } else {
        next.add(tool);
      }
      return next;
    });
  }

  resetDraftToolsToDefault(): void {
    const agent = this.editingAgent();
    if (!agent) return;
    const rosterEntry = AGENT_ROSTER.find((r) => r.key === agent.key);
    if (rosterEntry) {
      this.draftTools.set(new Set(rosterEntry.defaultTools));
    }
  }

  async savePersonaAndTools(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const agent = this.editingAgent();
    const prompt = this.draftSystemPrompt().trim();
    if (!studioId || !agent || prompt.length < 50 || this.savingPersona()) return;

    this.savingPersona.set(true);
    try {
      const saved = await firstValueFrom(
        this.agentsApi.update(studioId, agent.key, {
          systemPrompt: prompt,
          tools: Array.from(this.draftTools()),
        }),
      );
      this.rows.update((list) => list.map((r) => (r.key === agent.key ? saved : r)));
      this.personaDialogOpen.set(false);
      await this.store.reloadSnapshot();
      this.toast.success(`Updated ${agent.name} persona & tools (${saved.tools.length} tools)`);
    } catch {
      this.toast.error(`Failed to save ${agent.name} persona & tools`);
    } finally {
      this.savingPersona.set(false);
    }
  }

  private patchRow(key: AgentKey, patch: UpdateAgentRequest): void {
    this.rows.update((list) =>
      list.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );

    const prevTimer = this.debounceTimers.get(key);
    if (prevTimer) clearTimeout(prevTimer);

    const timer = setTimeout(async () => {
      const studioId = this.store.studio()?.id;
      if (!studioId) return;
      try {
        const saved = await firstValueFrom(this.agentsApi.update(studioId, key, patch));
        this.rows.update((list) => list.map((r) => (r.key === key ? saved : r)));
        await this.store.reloadSnapshot();
      } catch {
        this.toast.error(`Failed to update ${key}`);
      }
    }, 400);

    this.debounceTimers.set(key, timer);
  }
}
