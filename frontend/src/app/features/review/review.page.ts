import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  AGENT_ROSTER,
  type AgentKey,
  type ReviewAnnotationDto,
  type ReviewKind,
  type ReviewStatus,
  type ReviewTab,
  type Verdict,
} from '@robdev/shared';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { ReviewDrawerComponent } from './review-drawer.component';
import { ReviewStore } from './review.store';

export interface SplashIconCard {
  id: string;
  title: string;
  subtitle: string;
  gradient: string;
  approved: boolean;
}

@Component({
  selector: 'rd-review-page',
  standalone: true,
  imports: [FormsModule, ReviewDrawerComponent],
  providers: [ReviewStore],
  templateUrl: './review.page.html',
  styleUrl: './review.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPage {
  readonly store = inject(StudioStoreService);
  readonly reviewStore = inject(ReviewStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly item = input<string | undefined>();
  readonly roster = AGENT_ROSTER;

  readonly activeTab = signal<ReviewTab>('IMAGES_VIDEO');
  readonly activeStatus = signal<ReviewStatus | 'ALL'>('TO_REVIEW');
  readonly selectedAgent = signal<AgentKey | 'ALL'>('ALL');
  readonly showOlderVersions = signal<boolean>(false);

  readonly frameGroupOpen = signal<boolean>(true);
  readonly splashGroupOpen = signal<boolean>(true);

  readonly uploadModalOpen = signal<boolean>(false);
  readonly uploadTitle = signal<string>('');
  readonly uploadKind = signal<Extract<ReviewKind, 'ICON' | 'THUMBNAIL' | 'TRAILER'>>('ICON');
  readonly uploadDescription = signal<string>('');
  readonly uploadFile = signal<File | null>(null);

  readonly activeGameLabel = computed(() => {
    const g = this.store.selectedGame() ?? this.store.games()[0];
    return g ? `${g.name} · v${g.latestSavedVersion ?? 1}` : 'Game One';
  });

  readonly splashIcons = signal<SplashIconCard[]>([
    {
      id: 'splash-icon-1',
      title: 'Direction A — Mythic crest on obsidian',
      subtitle: 'Icon · Game One',
      gradient: 'radial-gradient(circle at 50% 35%, #7c3aed, #1e1b4b 65%, #090a10)',
      approved: true,
    },
    {
      id: 'splash-icon-2',
      title: 'Direction B — Neon roll die silhouette',
      subtitle: 'Icon · Game One',
      gradient: 'radial-gradient(circle at 50% 35%, #9333ea, #311042 65%, #090a10)',
      approved: true,
    },
    {
      id: 'splash-icon-3',
      title: 'Direction C — Awakened aura burst',
      subtitle: 'Icon · Game One',
      gradient: 'radial-gradient(circle at 50% 35%, #6d28d9, #17153b 65%, #090a10)',
      approved: true,
    },
  ]);

  readonly statusFilters = computed(() => {
    const c = this.reviewStore.statusCounts();
    const hasLive = this.reviewStore.items().length > 0;
    return [
      { id: 'TO_REVIEW' as const, label: 'To review', count: hasLive ? c.TO_REVIEW : 4 },
      { id: 'CHANGES_ASKED' as const, label: 'Changes asked', count: hasLive ? c.CHANGES_ASKED : 0 },
      { id: 'APPROVED' as const, label: 'Approved', count: hasLive ? c.APPROVED : 0 },
      { id: 'REJECTED' as const, label: 'Rejected', count: hasLive ? c.REJECTED : 0 },
      { id: 'ALL' as const, label: 'Everything', count: hasLive ? c.ALL : 4 },
    ];
  });

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        void this.reviewStore.load();
      }
    });

    effect(() => {
      const itemId = this.item();
      if (itemId) {
        void this.reviewStore.open(itemId);
      }
    });
  }

  onFileSelected(event: Event): void {
    const inputEl = event.target as HTMLInputElement | null;
    const f = inputEl?.files?.[0] ?? null;
    this.uploadFile.set(f);
  }

  async submitUpload(): Promise<void> {
    const f = this.uploadFile();
    const title = this.uploadTitle().trim();
    if (!f || !title) return;
    const gameId = this.store.selectedGameId();
    const created = await this.reviewStore.upload(f, {
      kind: this.uploadKind(),
      title,
      description: this.uploadDescription().trim() || undefined,
      gameId: gameId === 'all' ? null : gameId,
    });
    if (created) {
      this.uploadModalOpen.set(false);
      this.uploadTitle.set('');
      this.uploadDescription.set('');
      this.uploadFile.set(null);
      void this.reviewStore.open(created.id);
    }
  }

  onDrawerVerdict(ev: {
    verdict: Verdict;
    feedback: string;
    annotations?: ReviewAnnotationDto[];
  }): void {
    void this.reviewStore.verdict(ev.verdict, ev.feedback, ev.annotations);
  }

  onDrawerNavigate(dir: 'next' | 'prev'): void {
    const targetId = dir === 'next' ? this.reviewStore.next() : this.reviewStore.prev();
    if (targetId) {
      void this.reviewStore.open(targetId);
    }
  }

  approveAllFrame(event: Event): void {
    event.stopPropagation();
    this.toast.success('Approved all Frame screenshots');
  }

  approveAllSplash(event: Event): void {
    event.stopPropagation();
    this.toast.success('Approved all 3 Splash icons');
  }

  clearQueue(): void {
    this.toast.info('Cleared reviewed items from queue');
  }
}
