import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { AgentKey, BrowserVisibilityStatusDto } from '@robdev/shared';
import { LlmApiService } from '../../core/api/llm-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { agentIconFor } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import type { IconName } from '../../shared/ui/icon/icons';
import { STATUS_LABELS } from '../../shared/ui/status-pill/status-pill.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-agent-matrix',
  standalone: true,
  imports: [RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-matrix.component.html',
  styleUrl: './agent-matrix.component.scss',
})
export class AgentMatrixComponent {
  readonly store = inject(StudioStoreService);
  private readonly llmApi = inject(LlmApiService);
  private readonly toast = inject(ToastService);

  readonly browserVisibility = signal<BrowserVisibilityStatusDto | null>(null);
  readonly togglingBrowser = signal(false);

  readonly isBrowserVisible = computed(() => {
    const status = this.browserVisibility();
    if (status) return status.visible;
    return !(this.store.studio()?.browserHeadless ?? true);
  });

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (!studioId) return;
      untracked(() => {
        this.llmApi.getBrowserVisibility(studioId).subscribe({
          next: (status) => this.browserVisibility.set(status),
          error: () => {},
        });
      });
    });
  }

  agentIcon(key: AgentKey): IconName {
    return agentIconFor({ key });
  }

  cellTitle(name: string, status: string): string {
    return `${name} · ${STATUS_LABELS[status] ?? status}`;
  }

  async onToggleBrowserVisibility(): Promise<void> {
    const studioId = this.store.studioId();
    if (!studioId || this.togglingBrowser()) return;
    this.togglingBrowser.set(true);
    const nextVisible = !this.isBrowserVisible();
    try {
      const res = await firstValueFrom(this.llmApi.setBrowserVisibility(studioId, nextVisible));
      this.browserVisibility.set(res);
      this.toast.success(res.message);
    } catch {
      this.toast.error('Could not toggle agent browser window.');
    } finally {
      this.togglingBrowser.set(false);
    }
  }
}
