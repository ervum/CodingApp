import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import {
  MarkdownService,
  convertMarkdownToPlainText,
} from '../../../core/markdown/markdown.service';
import { IconComponent } from '../icon/icon.component';

export type CopyFormatMode = 'md' | 'raw';

const STORAGE_KEY = 'rd.chat.copyDefault';

function readStoredCopyDefault(): CopyFormatMode {
  try {
    const val = localStorage.getItem(STORAGE_KEY);
    return val === 'raw' ? 'raw' : 'md';
  } catch {
    return 'md';
  }
}

function writeStoredCopyDefault(mode: CopyFormatMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors
  }
}

@Component({
  selector: 'rd-copy-split-button',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="copy-split"
      [class.copy-split--sm]="size() === 'sm'"
      [class.is-copied]="copiedMode() !== null"
    >
      <button
        type="button"
        class="copy-split__main"
        [attr.aria-label]="ariaLabel()"
        [title]="mainTooltip()"
        (click)="onMainClick($event)"
      >
        <rd-icon [name]="copiedMode() ? 'check' : 'copy'" [size]="11" />
        <span class="copy-split__label">{{ buttonLabel() }}</span>
      </button>
      <button
        type="button"
        class="copy-split__caret"
        aria-label="Choose copy format (Markdown or Plain text)"
        title="Choose copy format (Markdown or Plain text)"
        [attr.aria-expanded]="menuOpen()"
        (click)="toggleMenu($event)"
      >
        <rd-icon name="chevron-down" [size]="10" />
      </button>

      @if (menuOpen()) {
        <div class="copy-split__menu" role="menu" (click)="$event.stopPropagation()">
          <button
            type="button"
            class="copy-split__item"
            role="menuitem"
            [class.is-default]="defaultMode() === 'md'"
            (click)="selectAndCopy('md', $event)"
          >
            <span class="copy-split__item-title">Copy Markdown</span>
            <span class="copy-split__item-badge">
              {{ defaultMode() === 'md' ? 'Default' : 'Set default' }}
            </span>
          </button>
          <button
            type="button"
            class="copy-split__item"
            role="menuitem"
            [class.is-default]="defaultMode() === 'raw'"
            (click)="selectAndCopy('raw', $event)"
          >
            <span class="copy-split__item-title">Copy plain text</span>
            <span class="copy-split__item-badge">
              {{ defaultMode() === 'raw' ? 'Default' : 'Set default' }}
            </span>
          </button>
          <div class="copy-split__hint">Shift+click main button for alternative format</div>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        position: relative;
      }

      .copy-split {
        position: relative;
        display: inline-flex;
        align-items: stretch;
        border-radius: 6px;
        background: #171a26;
        border: 1px solid #262a3e;
        transition:
          border-color 120ms ease,
          background-color 120ms ease;

        &:hover {
          border-color: rgba(139, 92, 246, 0.5);
        }

        &.is-copied {
          border-color: rgba(34, 197, 94, 0.55);
          background: rgba(34, 197, 94, 0.12);
        }
      }

      .copy-split__main,
      .copy-split__caret {
        appearance: none;
        background: transparent;
        border: 0;
        color: #cbd5e1;
        font-family: var(--rd-font-mono);
        font-size: 10px;
        font-weight: 600;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 7px;
        transition:
          color 120ms ease,
          background-color 120ms ease;

        &:hover {
          color: #ffffff;
          background: rgba(139, 92, 246, 0.18);
        }
      }

      .copy-split--sm .copy-split__main,
      .copy-split--sm .copy-split__caret {
        height: 25px;
        font-size: 11px;
      }

      .copy-split__caret {
        padding: 0 5px;
        border-left: 1px solid #262a3e;
      }

      .copy-split__label {
        white-space: nowrap;
      }

      .copy-split__menu {
        position: absolute;
        top: calc(100% + 5px);
        right: 0;
        z-index: 60;
        min-width: 196px;
        padding: 5px;
        border-radius: 8px;
        background: #111420;
        border: 1px solid #2b314b;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.65);
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .copy-split__item {
        appearance: none;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 6px 8px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #e2e8f0;
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        text-align: left;

        &:hover {
          background: rgba(139, 92, 246, 0.18);
          border-color: rgba(139, 92, 246, 0.4);
          color: #ffffff;
        }

        &.is-default .copy-split__item-badge {
          background: rgba(139, 92, 246, 0.24);
          color: #c4b5fd;
          border-color: rgba(139, 92, 246, 0.45);
        }
      }

      .copy-split__item-badge {
        font-family: var(--rd-font-mono);
        font-size: 9px;
        font-weight: 600;
        padding: 1px 5px;
        border-radius: 4px;
        background: #1a1e2e;
        border: 1px solid #2a3048;
        color: #94a3b8;
      }

      .copy-split__hint {
        padding: 4px 6px 2px;
        border-top: 1px solid #1e2336;
        font-size: 9.5px;
        color: #64748b;
        text-align: center;
      }
    `,
  ],
})
export class CopySplitButtonComponent {
  private readonly hostRef = inject(ElementRef<HTMLElement>);
  private readonly markdownService = inject(MarkdownService, { optional: true });

  readonly markdown = input.required<string>();
  readonly plainText = input<string | null>(null);
  readonly size = input<'xs' | 'sm'>('xs');
  readonly ariaLabel = input<string>('Copy message');

  readonly defaultMode = signal<CopyFormatMode>(readStoredCopyDefault());
  readonly menuOpen = signal<boolean>(false);
  readonly copiedMode = signal<CopyFormatMode | null>(null);

  readonly buttonLabel = computed(() => {
    const copied = this.copiedMode();
    if (copied === 'md') return 'Copied MD';
    if (copied === 'raw') return 'Copied text';
    return this.defaultMode() === 'md' ? 'Copy MD' : 'Copy text';
  });

  readonly mainTooltip = computed(() => {
    const def = this.defaultMode();
    return def === 'md'
      ? 'Copy Markdown (Shift+click to copy plain text)'
      : 'Copy plain text (Shift+click to copy Markdown)';
  });

  onMainClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.defaultMode.set(readStoredCopyDefault());
    const def = this.defaultMode();
    const targetMode: CopyFormatMode = event.shiftKey
      ? def === 'md'
        ? 'raw'
        : 'md'
      : def;
    this.performCopy(targetMode);
  }

  toggleMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.defaultMode.set(readStoredCopyDefault());
    this.menuOpen.update((v) => !v);
  }

  selectAndCopy(mode: CopyFormatMode, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.defaultMode.set(mode);
    writeStoredCopyDefault(mode);
    this.menuOpen.set(false);
    this.performCopy(mode);
  }

  private performCopy(mode: CopyFormatMode): void {
    const rawMd = this.markdown() ?? '';
    const textToCopy =
      mode === 'md'
        ? rawMd
        : (this.plainText() ??
          (this.markdownService
            ? this.markdownService.markdownToPlainText(rawMd)
            : convertMarkdownToPlainText(rawMd)));

    void navigator.clipboard?.writeText(textToCopy).then(() => {
      this.copiedMode.set(mode);
      setTimeout(() => {
        if (this.copiedMode() === mode) {
          this.copiedMode.set(null);
        }
      }, 1500);
    });
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.menuOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.hostRef.nativeElement.contains(target)) {
      this.menuOpen.set(false);
    }
  }
}
