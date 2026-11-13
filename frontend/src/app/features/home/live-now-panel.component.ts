import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AGENT_BY_KEY, type AgentKey, type StudioLaneDto } from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { LanesApiService } from '../../core/api/lanes-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { GameProgressCardComponent } from './game-progress-card.component';

@Component({
  selector: 'rd-live-now-panel',
  standalone: true,
  imports: [RouterLink, RelativeTimePipe, AgentAvatarComponent, GameProgressCardComponent],
  templateUrl: './live-now-panel.component.html',
  styleUrl: './live-now-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LiveNowPanelComponent {
  readonly store = inject(StudioStoreService);
  private readonly lanesApi = inject(LanesApiService);
  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');
  readonly activeStudioSlot = signal<string>('all');
  readonly busyLaneId = signal<string | null>(null);

  readonly visibleLanes = computed<StudioLaneDto[]>(() => {
    const slot = this.activeStudioSlot();
    const lanes = this.store.lanes();
    if (slot === 'all') return lanes;
    return lanes.filter((l, idx) => l.id === slot || String(idx + 1) === slot);
  });

  readonly freshnessRows = computed(() => {
    const f = this.store.freshness();
    const fmt = (iso: string | null, fallback: string): string => {
      if (!iso) return fallback;
      const diffMin = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
      if (diffMin < 1) return 'just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.round(diffMin / 60);
      return `${diffHr}h ago`;
    };
    return [
      { label: 'Roblox charts', value: fmt(f.marketLastSuccessAt, '3m ago') },
      { label: 'Competitor tracker', value: fmt(f.marketLastSuccessAt, '14m ago') },
      {
        label: `Asset library (${f.assetCount || 3} assets)`,
        value: fmt(f.assetLastUpdatedAt, '1h ago'),
      },
      {
        label: `Vault rules (${f.vaultDocCount || 14} docs)`,
        value: 'loaded',
      },
    ];
  });

  async createLane(): Promise<void> {
    const studioId = this.store.studioId();
    if (!studioId || !this.store.isAdmin()) return;
    const nextNum = this.store.lanes().length + 1;
    try {
      const created = await firstValueFrom(
        this.lanesApi.create(studioId, { name: `Studio ${nextNum}` }),
      );
      this.store.lanes.update((list) =>
        list.some((x) => x.id === created.id) ? list : [...list, created],
      );
    } catch {
      // ignore
    }
  }

  async releaseLane(lane: StudioLaneDto): Promise<void> {
    const studioId = this.store.studioId();
    if (!studioId || !this.store.isAdmin() || this.busyLaneId()) return;
    this.busyLaneId.set(lane.id);
    try {
      const updated = await firstValueFrom(this.lanesApi.release(studioId, lane.id));
      this.store.lanes.update((list) =>
        list.map((x) => (x.id === updated.id ? updated : x)),
      );
    } catch {
      // ignore
    } finally {
      this.busyLaneId.set(null);
    }
  }

  agentFor(key: AgentKey) {
    const live = this.store.agent(key)();
    if (live) return live;
    const r = AGENT_BY_KEY[key];
    return {
      key,
      name: r.name,
      glyph: r.glyph,
      color: r.color,
      status: 'WORKING' as const,
    };
  }
}
