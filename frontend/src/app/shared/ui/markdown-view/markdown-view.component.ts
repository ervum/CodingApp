import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { API_PATHS } from '../../../core/api/api-paths';
import { LuauHighlighter } from '../../../core/markdown/luau-highlighter';
import { MarkdownService } from '../../../core/markdown/markdown.service';
import { StudioStoreService } from '../../../core/state/studio-store.service';
import { ToastService } from '../toast/toast.service';

export async function openFileWithSystemDialog(
  filePath: string,
  studioSlug?: string,
  toast?: ToastService,
): Promise<boolean> {
  const cleaned = (filePath ?? '').trim();
  if (!cleaned) return false;
  try {
    const resp = await fetch(API_PATHS.media.openWith(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: cleaned, studioSlug }),
    });
    if (!resp.ok) {
      const errJson = (await resp.json().catch(() => null)) as {
        error?: { message?: string };
        message?: string;
      } | null;
      const msg =
        errJson?.error?.message ||
        errJson?.message ||
        `Could not open "${cleaned}" (file not found on disk).`;
      toast?.error(msg);
      return false;
    }
    return true;
  } catch {
    toast?.error(`Failed to launch "Open with…" dialog for "${cleaned}".`);
    return false;
  }
}

@Component({
  selector: 'rd-markdown-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './markdown-view.component.scss',
  template: `
    <div
      class="rd-prose"
      [class.rd-streaming-caret]="streaming()"
      [innerHTML]="safeHtml()"
      (click)="onContentClick($event)"
    ></div>
  `,
})
export class MarkdownViewComponent {
  private readonly markdownService = inject(MarkdownService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly store = inject(StudioStoreService);
  private readonly toast = inject(ToastService);
  private readonly hostRef = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly markdown = input.required<string>();
  readonly streaming = input<boolean>(false);
  readonly renderCodeAsArtifact = input<boolean>(false);
  readonly resolveLink = input<(target: string) => string | null>();
  readonly wikilinkClick = output<string>();

  readonly safeHtml = computed<SafeHtml>(() => {
    const html = this.markdownService.render(this.markdown(), {
      streaming: this.streaming(),
      renderCodeAsArtifact: this.renderCodeAsArtifact(),
      studioSlug: this.store.studio()?.slug ?? 'inclined-games',
      resolveLink: this.resolveLink(),
    });
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  constructor() {
    effect(() => {
      // Trigger after safeHtml updates to hydrate any <details data-embed-code-path="..."> embeds
      this.safeHtml();
      const slug = this.store.studio()?.slug ?? 'inclined-games';
      queueMicrotask(() => {
        this.hydrateCodeEmbeds(slug);
      });
    });
  }

  private hydrateCodeEmbeds(studioSlug: string): void {
    const root = this.hostRef.nativeElement;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const embeds = Array.from(
      root.querySelectorAll<HTMLElement>('details[data-embed-code-path]'),
    );
    for (const el of embeds) {
      if (el.getAttribute('data-hydrated') === 'true') continue;
      const filePath = el.getAttribute('data-embed-code-path');
      const lang = el.getAttribute('data-embed-code-lang') || 'text';
      const codeEl = el.querySelector('pre code');
      if (!filePath || !codeEl) continue;
      el.setAttribute('data-hydrated', 'true');
      void fetch(API_PATHS.media.byPath(filePath, studioSlug))
        .then(async (r) => {
          if (!r.ok) {
            if (!/[\\/]/.test(filePath)) {
              el.style.display = 'none';
              return;
            }
            codeEl.textContent = `(Preview unavailable — file not found on disk: ${filePath})`;
            return;
          }
          const rawText = await r.text();
          codeEl.innerHTML = LuauHighlighter.highlight(rawText, lang);
        })
        .catch(() => {
          codeEl.textContent = `(Preview unavailable for ${filePath})`;
        });
    }
  }

  onContentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    const filePathEl = target?.closest<HTMLElement>('[data-filepath]');
    if (filePathEl) {
      event.preventDefault();
      event.stopPropagation();
      const filePath = filePathEl.getAttribute('data-filepath');
      if (filePath) {
        const slug = this.store.studio()?.slug ?? 'inclined-games';
        void openFileWithSystemDialog(filePath, slug, this.toast);
      }
      return;
    }

    const actionBtn = target?.closest<HTMLButtonElement>('button[data-artifact-action]');
    if (actionBtn) {
      event.preventDefault();
      event.stopPropagation();
      const action = actionBtn.getAttribute('data-artifact-action');
      const filename = actionBtn.getAttribute('data-artifact-filename') || 'artifact.txt';
      const detailsEl = actionBtn.closest('.rd-code-artifact');
      const rawCode = detailsEl?.querySelector('pre code')?.textContent ?? '';
      if (action === 'copy') {
        void navigator.clipboard?.writeText(rawCode).then(() => {
          const prevText = actionBtn.textContent ?? 'Copy raw';
          actionBtn.textContent = 'Copied!';
          actionBtn.classList.add('is-copied');
          setTimeout(() => {
            actionBtn.textContent = prevText;
            actionBtn.classList.remove('is-copied');
          }, 1500);
        });
      } else if (action === 'download') {
        const blob = new Blob([rawCode], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
      }
      return;
    }

    const targetEl = target?.closest('a[data-wikilink]');
    if (!targetEl) return;
    const wikilink = targetEl.getAttribute('data-wikilink');
    if (wikilink) {
      event.preventDefault();
      this.wikilinkClick.emit(wikilink);
    }
  }
}
