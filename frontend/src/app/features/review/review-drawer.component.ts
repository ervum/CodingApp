import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  type OnChanges,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AGENT_BY_KEY,
  type ReviewAnnotationDto,
  type ReviewItemDetailDto,
  type Verdict,
} from '@robdev/shared';
import { HotkeysService } from '../../core/keyboard/hotkeys.service';
import { BytesPipe } from '../../shared/pipes/bytes.pipe';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view/markdown-view.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';
import { SmallPreviewStripComponent } from './small-preview-strip.component';
import { StageDetailComponent } from './stage-detail.component';

@Component({
  selector: 'rd-review-drawer',
  standalone: true,
  imports: [
    FormsModule,
    BytesPipe,
    RelativeTimePipe,
    IconComponent,
    MarkdownViewComponent,
    StatusPillComponent,
    SmallPreviewStripComponent,
    StageDetailComponent,
  ],
  templateUrl: './review-drawer.component.html',
  styleUrl: './review-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewDrawerComponent implements OnChanges {
  private readonly hotkeys = inject(HotkeysService);
  private readonly destroyRef = inject(DestroyRef);
  private lastDetailId: string | null = null;

  readonly detail = input.required<ReviewItemDetailDto>();
  readonly canAct = input(false);
  readonly busy = input(false);

  readonly verdict = output<{
    verdict: Verdict;
    feedback: string;
    annotations?: ReviewAnnotationDto[];
  }>();
  readonly navigate = output<'next' | 'prev'>();
  readonly close = output<void>();
  readonly resolveBlocker = output<{ id: string; status: 'RESOLVED' | 'WAIVED' }>();

  readonly feedback = signal('');
  readonly annotations = signal<ReviewAnnotationDto[]>([]);
  readonly compareMode = signal<boolean>(false);
  readonly selectedIteration = signal<number | null>(null);
  private readonly feedbackEl = viewChild<ElementRef<HTMLTextAreaElement>>('feedbackInput');

  readonly agentName = computed(() => {
    const key = this.detail().madeByAgentKey;
    return key ? AGENT_BY_KEY[key].name : 'Operator';
  });

  readonly isImage = computed(() => {
    const k = this.detail().kind;
    return (k === 'ICON' || k === 'THUMBNAIL' || k === 'STORYBOARD') && !!this.detail().media;
  });

  readonly isVideo = computed(() => this.detail().kind === 'TRAILER' && !!this.detail().media);

  readonly aspect = computed<'1:1' | '16:9'>(() =>
    this.detail().kind === 'ICON' ? '1:1' : '16:9',
  );

  readonly activeMediaUrl = computed(() => {
    const d = this.detail();
    const selIter = this.selectedIteration();
    if (selIter !== null && selIter !== d.iteration) {
      const prev = d.previousIterations.find((p) => p.iteration === selIter);
      if (prev?.media?.url) return prev.media.url;
    }
    return d.media?.url ?? null;
  });

  readonly previousMediaUrl = computed(() => {
    const d = this.detail();
    const prev = d.previousIterations[d.previousIterations.length - 1];
    return prev?.media?.url ?? null;
  });

  readonly hasFixFirstBlocker = computed(() => {
    const d = this.detail();
    const isStageOrPublish = d.kind === 'STAGE' || d.kind === 'PUBLISH';
    const openFixFirst =
      d.openFixFirst > 0 ||
      d.blockers.some((b) => b.severity === 'FIX_FIRST' && b.status === 'OPEN');
    return isStageOrPublish && openFixFirst;
  });

  readonly approveDisabled = computed(
    () => !this.canAct() || this.busy() || this.hasFixFirstBlocker(),
  );

  readonly approveTooltip = computed(() =>
    this.hasFixFirstBlocker() ? 'Resolve FIX FIRST blockers first' : '',
  );

  constructor() {
    const cleanups: Array<() => void> = [
      this.hotkeys.register('a', () => this.triggerApprove()),
      this.hotkeys.register('c', () => this.triggerAskChangesHotkey()),
      this.hotkeys.register('x', () => this.triggerReject()),
      this.hotkeys.register('j', () => this.navigate.emit('next')),
      this.hotkeys.register('k', () => this.navigate.emit('prev')),
    ];

    this.destroyRef.onDestroy(() => {
      for (const fn of cleanups) fn();
    });
  }

  ngOnChanges(): void {
    const id = this.detail().id;
    if (this.lastDetailId !== null && this.lastDetailId !== id) {
      this.feedback.set('');
      this.annotations.set([]);
      this.compareMode.set(false);
      this.selectedIteration.set(null);
    }
    this.lastDetailId = id;
  }

  onHeroImageClick(event: MouseEvent): void {
    if (!this.canAct() || !this.isImage()) return;
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const clickX = Math.max(0, Math.min(0.88, (event.clientX - rect.left) / rect.width));
    const clickY = Math.max(0, Math.min(0.88, (event.clientY - rect.top) / rect.height));
    if (this.annotations().length >= 12) return;
    this.annotations.update((list) => [
      ...list,
      {
        x: Math.round(clickX * 100) / 100,
        y: Math.round(clickY * 100) / 100,
        w: 0.12,
        h: 0.12,
        note: `Adjust region #${list.length + 1}`,
      },
    ]);
  }

  updateAnnotationNote(index: number, note: string): void {
    this.annotations.update((list) =>
      list.map((a, i) => (i === index ? { ...a, note } : a)),
    );
  }

  removeAnnotation(index: number): void {
    this.annotations.update((list) => list.filter((_, i) => i !== index));
  }

  triggerApprove(): void {
    if (this.approveDisabled()) return;
    const anns = this.annotations();
    this.verdict.emit({
      verdict: 'APPROVE',
      feedback: this.feedback().trim(),
      ...(anns.length > 0 ? { annotations: anns } : {}),
    });
  }

  triggerAskChangesHotkey(): void {
    if (!this.canAct() || this.busy()) return;
    const text = this.feedback().trim();
    if (!text) {
      this.feedbackEl()?.nativeElement.focus();
      return;
    }
    const anns = this.annotations();
    this.verdict.emit({
      verdict: 'ASK_CHANGES',
      feedback: text,
      ...(anns.length > 0 ? { annotations: anns } : {}),
    });
  }

  onAskChangesClick(): void {
    if (!this.canAct() || this.busy()) return;
    const text = this.feedback().trim();
    if (!text) {
      this.feedbackEl()?.nativeElement.focus();
      return;
    }
    const anns = this.annotations();
    this.verdict.emit({
      verdict: 'ASK_CHANGES',
      feedback: text,
      ...(anns.length > 0 ? { annotations: anns } : {}),
    });
  }

  triggerReject(): void {
    if (!this.canAct() || this.busy()) return;
    const anns = this.annotations();
    this.verdict.emit({
      verdict: 'REJECT',
      feedback: this.feedback().trim(),
      ...(anns.length > 0 ? { annotations: anns } : {}),
    });
  }

  onFeedbackKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      this.onAskChangesClick();
    }
  }
}
