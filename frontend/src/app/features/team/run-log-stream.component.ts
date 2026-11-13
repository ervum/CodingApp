import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import type { RunArtifactDto, RunLogEntryDto } from '@robdev/shared';
import { LuauHighlighter } from '../../core/markdown/luau-highlighter';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { LogEntryComponent } from './log-entry.component';

const COLLAPSE_HEIGHT_THRESHOLD_PX = 80;
const DEFAULT_RESTORE_HEIGHT_PX = 320;

@Component({
  selector: 'rd-run-log-stream',
  standalone: true,
  imports: [BytesPipe, LogEntryComponent],
  templateUrl: './run-log-stream.component.html',
  styleUrl: './run-log-stream.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-collapsed]': 'isCollapsed()',
    '[class.has-custom-height]': 'streamHeightPx() !== null && !isCollapsed()',
    '[class.is-resizing]': 'isResizing()',
  },
})
export class RunLogStreamComponent {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly entries = input.required<RunLogEntryDto[]>();
  readonly streamingEntryId = input<string | null>(null);
  readonly artifacts = input<RunArtifactDto[]>([]);
  readonly wikilinkClick = output<string>();

  readonly isStuckToBottom = signal(true);
  readonly isCollapsed = signal(false);
  readonly streamHeightPx = signal<number | null>(null);
  readonly isResizing = signal(false);

  private lastExpandedHeightPx = DEFAULT_RESTORE_HEIGHT_PX;
  private cleanupDragListeners: (() => void) | null = null;
  private readonly streamEl = viewChild<ElementRef<HTMLElement>>('streamContainer');

  constructor() {
    effect(() => {
      const len = this.entries().length;
      const streaming = this.streamingEntryId();
      if ((len > 0 || streaming) && this.isStuckToBottom() && !this.isCollapsed()) {
        queueMicrotask(() => {
          this.scrollToBottom();
        });
      }
    });

    this.destroyRef.onDestroy(() => {
      this.cleanupDragListeners?.();
    });
  }

  toggleCollapse(): void {
    if (this.isCollapsed()) {
      this.expandStream();
    } else {
      const currentH = this.streamEl()?.nativeElement?.offsetHeight;
      if (currentH && currentH >= COLLAPSE_HEIGHT_THRESHOLD_PX) {
        this.lastExpandedHeightPx = currentH;
      }
      this.isCollapsed.set(true);
    }
  }

  expandStream(): void {
    this.isCollapsed.set(false);
    const current = this.streamHeightPx();
    if (current !== null && current < COLLAPSE_HEIGHT_THRESHOLD_PX) {
      this.streamHeightPx.set(
        Math.max(this.lastExpandedHeightPx, DEFAULT_RESTORE_HEIGHT_PX),
      );
    }
  }

  resetStreamHeight(event?: Event): void {
    event?.stopPropagation();
    this.isCollapsed.set(false);
    this.streamHeightPx.set(null);
  }

  startResize(event: PointerEvent, edge: 'top' | 'bottom'): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    this.cleanupDragListeners?.();

    const startY = event.clientY;
    const el = this.streamEl()?.nativeElement;
    const startHeight = this.isCollapsed()
      ? 0
      : (el?.offsetHeight ?? this.streamHeightPx() ?? DEFAULT_RESTORE_HEIGHT_PX);

    this.isResizing.set(true);

    const onMove = (moveEvent: PointerEvent): void => {
      const deltaY = moveEvent.clientY - startY;
      const rawNextHeight =
        edge === 'top' ? startHeight - deltaY : startHeight + deltaY;

      if (rawNextHeight < COLLAPSE_HEIGHT_THRESHOLD_PX) {
        this.isCollapsed.set(true);
        return;
      }

      const maxH = Math.max(240, window.innerHeight - 160);
      const clamped = Math.min(Math.max(Math.round(rawNextHeight), COLLAPSE_HEIGHT_THRESHOLD_PX), maxH);
      this.isCollapsed.set(false);
      this.streamHeightPx.set(clamped);
      this.lastExpandedHeightPx = clamped;
    };

    const onUp = (): void => {
      this.isResizing.set(false);
      this.cleanupDragListeners?.();
      this.cleanupDragListeners = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    this.cleanupDragListeners = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }

  onScroll(): void {
    const el = this.streamEl()?.nativeElement;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.isStuckToBottom.set(distance <= 48);
  }

  jumpToLive(): void {
    this.isStuckToBottom.set(true);
    this.scrollToBottom();
  }

  highlightArtifact(art: RunArtifactDto): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(
      LuauHighlighter.highlight(art.content, art.language),
    );
  }

  private scrollToBottom(): void {
    const el = this.streamEl()?.nativeElement;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }
}
