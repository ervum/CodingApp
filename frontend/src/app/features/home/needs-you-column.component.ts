import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { GameDto, HumanRequestDto, PitchDto } from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { HumanRequestsApiService } from '../../core/api/human-requests-api.service';
import { PitchesApiService } from '../../core/api/pitches-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { CountBadgeComponent } from '../../shared/ui/count-badge/count-badge.component';
import { EmptyStateComponent } from '../../shared/ui/empty-state/empty-state.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { NeedsYouCardComponent } from './needs-you-card.component';

@Component({
  selector: 'rd-needs-you-column',
  standalone: true,
  imports: [CountBadgeComponent, EmptyStateComponent, NeedsYouCardComponent],
  templateUrl: './needs-you-column.component.html',
  styleUrl: './needs-you-column.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NeedsYouColumnComponent {
  readonly store = inject(StudioStoreService);
  private readonly humanRequestsApi = inject(HumanRequestsApiService);
  private readonly pitchesApi = inject(PitchesApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly pitches = signal<PitchDto[]>([]);

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (!studioId) return;
      void firstValueFrom(this.pitchesApi.list(studioId))
        .then((list) => this.pitches.set(list))
        .catch(() => undefined);
    });
  }

  gameFor(req: HumanRequestDto): GameDto | null {
    if (!req.gameId) return null;
    return this.store.games().find((g) => g.id === req.gameId) ?? null;
  }

  async onReply(payload: { id: string; body: string; optionId?: string }): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    try {
      const updated = await firstValueFrom(
        this.humanRequestsApi.reply(studioId, payload.id, {
          body: payload.body,
          optionId: payload.optionId,
        }),
      );
      if (updated.status !== 'OPEN') {
        this.store.humanRequests.update((list) => list.filter((x) => x.id !== payload.id));
        this.store.counts.update((c) => ({ ...c, needsYou: Math.max(0, c.needsYou - 1) }));
      }
      this.toast.success('Reply sent');
    } catch {
      this.toast.error('Failed to send reply');
    }
  }

  async onDone(requestId: string): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;

    const prevList = this.store.humanRequests();
    const prevCounts = this.store.counts();

    // Optimistic update
    this.store.humanRequests.update((list) => list.filter((x) => x.id !== requestId));
    this.store.counts.update((c) => ({ ...c, needsYou: Math.max(0, c.needsYou - 1) }));

    try {
      await firstValueFrom(
        this.humanRequestsApi.resolve(studioId, requestId, { outcome: 'RESOLVED' }),
      );
      this.toast.success('Marked as done');
    } catch {
      this.store.humanRequests.set(prevList);
      this.store.counts.set(prevCounts);
      this.toast.error('Could not resolve item');
    }
  }

  onDetails(req: HumanRequestDto): void {
    const slug = this.store.studio()?.slug ?? 'inclined-games';
    const agentKey = req.agentKey ?? 'lead';
    void this.router.navigate(['/s', slug, 'team', agentKey]);
  }
}
