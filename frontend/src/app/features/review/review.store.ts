import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import {
  VERDICT_TO_STATUS,
  type ReviewAnnotationDto,
  type ReviewCountsDto,
  type ReviewItemDetailDto,
  type ReviewItemDto,
  type ReviewStatus,
  type ReviewTab,
  type Verdict,
  type VerdictRequest,
} from '@robdev/shared';
import { Subscription, firstValueFrom } from 'rxjs';
import { ReviewApiService, type UploadReviewMeta } from '../../core/api/review-api.service';
import { SocketService } from '../../core/realtime/socket.service';
import { EMPTY_COUNTS, StudioStoreService } from '../../core/state/studio-store.service';
import { upsertById } from '../../core/state/upsert';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Injectable()
export class ReviewStore {
  private readonly reviewApi = inject(ReviewApiService);
  private readonly socket = inject(SocketService);
  private readonly studioStore = inject(StudioStoreService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly tab = signal<ReviewTab>('IMAGES_VIDEO');
  readonly status = signal<ReviewStatus | 'ALL'>('TO_REVIEW');
  readonly items = signal<ReviewItemDto[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly detail = signal<ReviewItemDetailDto | null>(null);
  readonly counts = signal<ReviewCountsDto>(EMPTY_COUNTS.review);
  readonly busy = signal<boolean>(false);
  readonly loading = signal<boolean>(false);

  readonly visibleItems = computed<ReviewItemDto[]>(() => {
    const tab = this.tab();
    const status = this.status();
    const gameId = this.studioStore.selectedGameId();
    return this.items().filter(
      (item) =>
        item.tab === tab &&
        (status === 'ALL' || item.status === status) &&
        (gameId === 'all' || item.gameId === gameId),
    );
  });

  readonly tabCounts = computed(() => {
    const gameId = this.studioStore.selectedGameId();
    const filtered = this.items().filter((i) => gameId === 'all' || i.gameId === gameId);
    const imagesToReview = filtered.filter(
      (i) => i.tab === 'IMAGES_VIDEO' && i.status === 'TO_REVIEW',
    ).length;
    const stagesToReview = filtered.filter(
      (i) => i.tab === 'STAGES_PUBLISH' && i.status === 'TO_REVIEW',
    ).length;
    return {
      IMAGES_VIDEO: imagesToReview,
      STAGES_PUBLISH: stagesToReview,
    };
  });

  readonly statusCounts = computed(() => {
    const tab = this.tab();
    const gameId = this.studioStore.selectedGameId();
    const inTab = this.items().filter(
      (i) => i.tab === tab && (gameId === 'all' || i.gameId === gameId),
    );
    return {
      TO_REVIEW: inTab.filter((i) => i.status === 'TO_REVIEW').length,
      CHANGES_ASKED: inTab.filter((i) => i.status === 'CHANGES_ASKED').length,
      APPROVED: inTab.filter((i) => i.status === 'APPROVED').length,
      REJECTED: inTab.filter((i) => i.status === 'REJECTED').length,
      ALL: inTab.length,
    };
  });

  private readonly subs = new Subscription();

  constructor() {
    this.wireSocket();
    this.destroyRef.onDestroy(() => this.subs.unsubscribe());
  }

  async load(): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId) return;
    this.loading.set(true);
    try {
      const [items, counts] = await Promise.all([
        firstValueFrom(this.reviewApi.list(studioId)),
        firstValueFrom(this.reviewApi.counts(studioId, this.studioStore.selectedGameId())),
      ]);
      this.items.set(items);
      this.counts.set(counts);
    } finally {
      this.loading.set(false);
    }
  }

  async open(id: string | null): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    if (!id || !studioId) {
      this.selectedId.set(null);
      this.detail.set(null);
      return;
    }
    this.selectedId.set(id);
    try {
      const d = await firstValueFrom(this.reviewApi.getDetail(studioId, id));
      this.detail.set(d);
    } catch {
      this.selectedId.set(null);
      this.detail.set(null);
    }
  }

  close(): void {
    this.selectedId.set(null);
    this.detail.set(null);
  }

  async verdict(
    v: Verdict,
    feedback: string,
    annotations?: ReviewAnnotationDto[],
  ): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const current = this.detail();
    if (!studioId || !current || this.busy()) return;

    const prevItems = this.items();
    const prevDetail = this.detail();
    const nextStatus = VERDICT_TO_STATUS[v];

    // Optimistic update
    this.busy.set(true);
    this.items.update((list) =>
      list.map((i) => (i.id === current.id ? { ...i, status: nextStatus } : i)),
    );
    this.detail.update((d) => (d ? { ...d, status: nextStatus } : d));

    try {
      const trimmed = feedback.trim();
      const body: VerdictRequest =
        v === 'ASK_CHANGES'
          ? {
              verdict: 'ASK_CHANGES',
              feedback: trimmed,
              ...(annotations && annotations.length > 0 ? { annotations } : {}),
            }
          : {
              verdict: v,
              ...(trimmed.length > 0 ? { feedback: trimmed } : {}),
              ...(annotations && annotations.length > 0 ? { annotations } : {}),
            };
      const updated = await firstValueFrom(
        this.reviewApi.submitVerdict(studioId, current.id, body),
      );
      this.detail.set(updated);
      this.items.update((list) => upsertById(list, updated));
      const newCounts = await firstValueFrom(
        this.reviewApi.counts(studioId, this.studioStore.selectedGameId()),
      );
      this.counts.set(newCounts);
      this.toast.success(
        v === 'APPROVE'
          ? 'Approved'
          : v === 'ASK_CHANGES'
            ? 'Requested changes'
            : 'Rejected item',
      );
    } catch {
      this.items.set(prevItems);
      this.detail.set(prevDetail);
      this.toast.error('Could not record verdict');
    } finally {
      this.busy.set(false);
    }
  }

  async resolveBlocker(id: string, status: 'RESOLVED' | 'WAIVED'): Promise<void> {
    const studioId = this.studioStore.studio()?.id;
    const current = this.detail();
    if (!studioId || !current || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.reviewApi.resolveBlocker(studioId, id, { status }));
      const refreshed = await firstValueFrom(this.reviewApi.getDetail(studioId, current.id));
      this.detail.set(refreshed);
      this.items.update((list) => upsertById(list, refreshed));
      this.toast.success(`Blocker ${status.toLowerCase()}`);
    } finally {
      this.busy.set(false);
    }
  }

  next(): string | null {
    const list = this.visibleItems();
    const curId = this.selectedId();
    if (list.length === 0) return null;
    const idx = list.findIndex((x) => x.id === curId);
    const nextItem = list[(idx + 1) % list.length];
    return nextItem?.id ?? null;
  }

  prev(): string | null {
    const list = this.visibleItems();
    const curId = this.selectedId();
    if (list.length === 0) return null;
    const idx = list.findIndex((x) => x.id === curId);
    const prevIdx = idx <= 0 ? list.length - 1 : idx - 1;
    return list[prevIdx]?.id ?? null;
  }

  async upload(file: File, meta: UploadReviewMeta): Promise<ReviewItemDto | null> {
    const studioId = this.studioStore.studio()?.id;
    if (!studioId || this.busy()) return null;
    this.busy.set(true);
    try {
      const created = await firstValueFrom(this.reviewApi.upload(studioId, file, meta));
      this.items.update((list) => upsertById(list, created, 'prepend'));
      this.toast.success(`Uploaded ${created.title}`);
      return created;
    } finally {
      this.busy.set(false);
    }
  }

  private wireSocket(): void {
    this.subs.add(
      this.socket.on('review:item').subscribe((e) => {
        if (e.studioId !== this.studioStore.studio()?.id) return;
        this.items.update((list) =>
          upsertById(list, e.item, e.change === 'created' ? 'prepend' : 'replace-or-append'),
        );
      }),
    );

    this.subs.add(
      this.socket.on('review:verdict').subscribe((e) => {
        if (e.studioId !== this.studioStore.studio()?.id) return;
        this.items.update((list) =>
          list.map((i) =>
            i.id === e.reviewItemId ? { ...i, status: e.status, updatedAt: e.at } : i,
          ),
        );
      }),
    );

    this.subs.add(
      this.socket.on('studio:counts').subscribe((e) => {
        if (e.studioId !== this.studioStore.studio()?.id) return;
        this.counts.set(e.counts.review);
      }),
    );
  }
}
