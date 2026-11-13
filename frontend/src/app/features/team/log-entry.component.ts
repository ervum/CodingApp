import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { AGENT_BY_KEY, AGENT_TOOL_DEFINITIONS, type RunLogEntryDto } from '@robdev/shared';
import { API_PATHS } from '../../core/api/api-paths';
import { LuauHighlighter } from '../../core/markdown/luau-highlighter';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import {
  MarkdownViewComponent,
  openFileWithSystemDialog,
} from '../../shared/ui/markdown-view/markdown-view.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-log-entry',
  standalone: true,
  imports: [DecimalPipe, BytesPipe, RouterLink, MarkdownViewComponent],
  templateUrl: './log-entry.component.html',
  styleUrl: './log-entry.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LogEntryComponent {
  readonly store = inject(StudioStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly toast = inject(ToastService);

  readonly entry = input.required<RunLogEntryDto>();
  readonly streaming = input(false);
  readonly collapseThinkingByDefault = input(false);
  readonly wikilinkClick = output<string>();

  readonly nowMs = signal(Date.now());
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');

  readonly isThinkingActive = computed(() => {
    const meta = this.entry().meta;
    return Boolean(meta?.isThinking && !meta.thinkingFinished);
  });

  readonly thinkingDurationMs = computed(() => {
    const meta = this.entry().meta;
    if (!meta?.isThinking) return 0;
    if (meta.thinkingFinished && typeof meta.thinkingDurationMs === 'number') {
      return Math.max(100, meta.thinkingDurationMs);
    }
    const startIso = meta.thinkingStartedAt ?? this.entry().createdAt;
    const startMs = Date.parse(startIso);
    const elapsed = Number.isFinite(startMs) ? this.nowMs() - startMs : 0;
    return Math.max(meta.thinkingDurationMs ?? 0, elapsed, 100);
  });

  readonly thinkingDurationLabel = computed(() => {
    const ms = this.thinkingDurationMs();
    if (ms < 10_000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }
    const totalSec = Math.round(ms / 1000);
    if (totalSec < 60) {
      return `${totalSec}s`;
    }
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins}m ${secs}s`;
  });

  readonly formattedThinkingMarkdown = computed(() => {
    const raw = (this.entry().content ?? '').trim();
    if (!raw) return '';

    // Ensure bold headers are separated by blank lines from adjacent text
    let normalized = raw
      .replace(/([^\n])\n(\*\*[^*\n]{2,90}\*\*)/g, '$1\n\n$2')
      .replace(/(\*\*[^*\n]{2,90}\*\*)[ \t]*\n(?!\n)/g, '$1\n\n')
      .replace(
        /(^|\n\n)(\*\*[^*\n]{2,90}\*\*)[ \t]+(?=[A-Z0-9"'`(])/g,
        '$1$2\n\n',
      )
      .replace(
        /([.?!])[ \t]+(\*\*[^*\n]{2,90}\*\*)[ \t]+(?=[A-Z0-9"'`(])/g,
        '$1\n\n$2\n\n',
      );

    // If legacy persisted thoughts had single newlines between short unbolded titles and body lines
    if (!normalized.includes('**')) {
      const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);
      const out: string[] = [];
      for (const line of lines) {
        const isShortTitle =
          line.length >= 4 &&
          line.length <= 65 &&
          !/[.?!:;]$/.test(line) &&
          /^[A-Z][A-Za-z0-9\s,'/-]+$/.test(line) &&
          line.split(/\s+/).length <= 8;
        if (isShortTitle) {
          out.push(`**${line}**`);
        } else {
          out.push(line);
        }
      }
      normalized = out.join('\n\n');
    }

    return normalized.replace(/\n{3,}/g, '\n\n').trim();
  });

  constructor() {
    effect(() => {
      const active = this.isThinkingActive();
      if (active && !this.timerHandle) {
        this.nowMs.set(Date.now());
        this.timerHandle = setInterval(() => {
          this.nowMs.set(Date.now());
        }, 200);
      } else if (!active && this.timerHandle) {
        clearInterval(this.timerHandle);
        this.timerHandle = null;
      }
    });

    this.destroyRef.onDestroy(() => {
      if (this.timerHandle) {
        clearInterval(this.timerHandle);
        this.timerHandle = null;
      }
    });
  }

  mediaUrlFor(mediaId: string | undefined): string | null {
    return mediaId ? API_PATHS.media.byId(mediaId) : null;
  }

  fileUrlFor(filePath: string | undefined): string | null {
    return filePath ? API_PATHS.media.byPath(filePath, this.studioSlug()) : null;
  }

  onOpenFilePath(filePath: string | undefined, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (!filePath) return;
    void openFileWithSystemDialog(filePath, this.studioSlug(), this.toast);
  }

  readonly toolLabel = computed(() => {
    const tool = this.entry().meta?.tool;
    if (!tool) return this.entry().content || 'tool';
    return AGENT_TOOL_DEFINITIONS[tool]?.label ?? tool;
  });

  readonly toolDesc = computed(() => {
    const tool = this.entry().meta?.tool;
    return tool ? (AGENT_TOOL_DEFINITIONS[tool]?.description ?? '') : '';
  });

  readonly compactArgs = computed(() => {
    const args = this.entry().meta?.args;
    if (!args) return this.entry().content;
    if (typeof args === 'string') return args;
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return this.entry().content;
    }
  });

  readonly humanRequestArgs = computed<{
    kind?: string;
    title?: string;
    body: string;
    options?: string[];
  } | null>(() => {
    const meta = this.entry().meta;
    if (meta?.tool !== 'request_human' || !meta.args || typeof meta.args !== 'object') {
      return null;
    }
    const raw = meta.args as Record<string, unknown>;
    const body = typeof raw['body'] === 'string' ? raw['body'].trim() : '';
    if (!body) return null;
    const title = typeof raw['title'] === 'string' ? raw['title'].trim() : undefined;
    const kind = typeof raw['kind'] === 'string' ? raw['kind'].trim() : undefined;
    const options = Array.isArray(raw['options'])
      ? raw['options'].filter((o): o is string => typeof o === 'string' && o.trim().length > 0)
      : undefined;
    return { kind, title, body, options };
  });

  readonly handoffAgent = computed(() => {
    const key = this.entry().meta?.handoffAgentKey;
    return key ? AGENT_BY_KEY[key] : null;
  });

  highlightCode(code: string | null | undefined, lang?: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      LuauHighlighter.highlight(code ?? '', lang),
    );
  }
}
