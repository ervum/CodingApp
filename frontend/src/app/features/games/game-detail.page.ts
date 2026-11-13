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
import { RouterLink } from '@angular/router';
import {
  AGENT_BY_KEY,
  type BuildKind,
  type GameDetailDto,
  type GameMilestoneDto,
  type GameStatus,
  type MilestoneStatus,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { GamesApiService } from '../../core/api/games-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { upsertById } from '../../core/state/upsert';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ProgressBarComponent } from '../../shared/ui/progress-bar/progress-bar.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-game-detail-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    RelativeTimePipe,
    EmptyStateComponent,
    IconComponent,
    ProgressBarComponent,
    StatusPillComponent,
  ],
  templateUrl: './game-detail.page.html',
  styleUrl: './game-detail.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameDetailPage {
  readonly store = inject(StudioStoreService);
  private readonly gamesApi = inject(GamesApiService);
  private readonly toast = inject(ToastService);

  readonly gameSlug = input<string | undefined>();

  readonly detail = signal<GameDetailDto | null>(null);
  readonly status = signal<GameStatus>('BUILDING');
  readonly accentColor = signal('#A855F7');
  readonly robloxUniverseId = signal('');
  readonly robloxPlaceId = signal('');
  readonly saving = signal(false);

  readonly buildVersion = signal<number>(1);
  readonly buildKind = signal<BuildKind>('SAVED');
  readonly buildNotes = signal('');
  readonly recordingBuild = signal(false);
  readonly publishing = signal(false);

  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');

  constructor() {
    effect(() => {
      const slug = this.gameSlug();
      const studioId = this.store.studio()?.id;
      const games = this.store.games();
      if (!studioId || !slug || games.length === 0) return;
      const match = games.find((g) => g.slug === slug || g.id === slug);
      if (match) {
        void this.loadDetail(studioId, match.id);
      }
    });
  }

  async loadDetail(studioId: string, gameId: string): Promise<void> {
    const d = await firstValueFrom(this.gamesApi.getDetail(studioId, gameId));
    this.detail.set(d);
    this.status.set(d.status);
    this.accentColor.set(d.accentColor);
    this.robloxUniverseId.set(d.robloxUniverseId ?? '');
    this.robloxPlaceId.set(d.robloxPlaceId ?? '');
    this.buildVersion.set((d.latestSavedVersion ?? 0) + 1);
  }

  async saveSettings(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const d = this.detail();
    if (!studioId || !d || this.saving()) return;
    this.saving.set(true);
    try {
      const updated = await firstValueFrom(
        this.gamesApi.update(studioId, d.id, {
          status: this.status(),
          accentColor: this.accentColor().trim(),
          robloxUniverseId: this.robloxUniverseId().trim() || null,
          robloxPlaceId: this.robloxPlaceId().trim() || null,
        }),
      );
      this.store.games.update((list) => upsertById(list, updated));
      await this.loadDetail(studioId, d.id);
      this.toast.success('Game settings saved');
    } catch {
      this.toast.error('Failed to save game settings');
    } finally {
      this.saving.set(false);
    }
  }

  async toggleMilestone(m: GameMilestoneDto): Promise<void> {
    const studioId = this.store.studio()?.id;
    const d = this.detail();
    if (!studioId || !d || !this.store.canEdit()) return;
    const nextStatus: MilestoneStatus = m.status === 'DONE' ? 'TODO' : 'DONE';
    await firstValueFrom(
      this.gamesApi.updateMilestone(studioId, d.id, m.id, { status: nextStatus }),
    );
    await this.loadDetail(studioId, d.id);
  }

  async recordBuild(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const d = this.detail();
    if (!studioId || !d || this.recordingBuild()) return;
    this.recordingBuild.set(true);
    try {
      await firstValueFrom(
        this.gamesApi.recordBuild(studioId, d.id, {
          version: Number(this.buildVersion()),
          kind: this.buildKind(),
          notes: this.buildNotes().trim(),
        }),
      );
      this.buildNotes.set('');
      await this.loadDetail(studioId, d.id);
      this.toast.success(`Recorded v${this.buildVersion()}`);
    } finally {
      this.recordingBuild.set(false);
    }
  }

  async publishViaOpenCloud(): Promise<void> {
    const studioId = this.store.studio()?.id;
    const d = this.detail();
    if (!studioId || !d || this.publishing()) return;
    this.publishing.set(true);
    try {
      const res = await firstValueFrom(
        this.gamesApi.publishOpenCloud(studioId, d.id, {
          versionType: 'Published',
          reviewItemId: 'latest',
          notes: this.buildNotes().trim(),
        }),
      );
      await this.loadDetail(studioId, d.id);
      this.toast.success(res.message);
    } catch (err) {
      const msg =
        (err as { error?: { message?: string } })?.error?.message ??
        'Open Cloud publish failed (ensure an APPROVED Publish review item and Open Cloud credentials exist)';
      this.toast.error(msg);
    } finally {
      this.publishing.set(false);
    }
  }

  agentName(key: string | null): string {
    if (!key) return 'Operator';
    return AGENT_BY_KEY[key as keyof typeof AGENT_BY_KEY]?.name ?? key;
  }
}
