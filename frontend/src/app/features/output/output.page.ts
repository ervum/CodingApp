import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import {
  AGENT_BY_KEY,
  type AgentKey,
  type TaskOutputArtifactDto,
  type TaskOutputDto,
} from '@robdev/shared';
import { API_PATHS } from '../../core/api/api-paths';
import { LuauHighlighter } from '../../core/markdown/luau-highlighter';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view/markdown-view.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-output-page',
  standalone: true,
  imports: [
    RouterLink,
    BytesPipe,
    RelativeTimePipe,
    AgentAvatarComponent,
    EmptyStateComponent,
    IconComponent,
    MarkdownViewComponent,
    StatusPillComponent,
  ],
  templateUrl: './output.page.html',
  styleUrl: './output.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OutputPage {
  readonly store = inject(StudioStoreService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly task = input<string | undefined>();
  readonly selectedTaskId = signal<string | null>(null);

  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');
  readonly outputs = this.store.filteredOutputs;

  readonly selectedOutput = computed<TaskOutputDto | null>(() => {
    const list = this.outputs();
    if (list.length === 0) return null;
    const id = this.selectedTaskId();
    if (id) {
      const found = list.find((o) => o.rootTaskId === id);
      if (found) return found;
    }
    return list[0] ?? null;
  });

  constructor() {
    effect(() => {
      const studioId = this.store.studio()?.id;
      if (studioId) {
        void this.store.reloadOutputs();
      }
    });

    effect(() => {
      const taskParam = this.task();
      if (taskParam) {
        this.selectedTaskId.set(taskParam);
      }
    });
  }

  selectOutput(item: TaskOutputDto): void {
    this.selectedTaskId.set(item.rootTaskId);
    void this.router.navigate(['/s', this.studioSlug(), 'output'], {
      queryParams: { task: item.rootTaskId },
    });
  }

  agentFor(key: AgentKey) {
    const live = this.store.agent(key)();
    if (live) return live;
    const r = AGENT_BY_KEY[key];
    return {
      name: r.name,
      glyph: r.glyph,
      color: r.color,
      status: 'IDLE' as const,
    };
  }

  formatDuration(ms: number | null | undefined): string {
    if (!ms || ms <= 0) return '0.1s';
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  }

  mediaUrlFor(mediaId: string): string {
    return API_PATHS.media.byId(mediaId);
  }

  highlightCode(art: TaskOutputArtifactDto): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      LuauHighlighter.highlight(art.content, art.language),
    );
  }

  async copyText(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.success(`${label} copied to clipboard`);
    } catch {
      this.toast.error('Could not copy to clipboard');
    }
  }
}
