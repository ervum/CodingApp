import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { TasksApiService } from '../../core/api/tasks-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { DrawerComponent } from '../../shared/ui/drawer/drawer.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { MarketStore } from './market.store';

export type MarketSubTab = 'CHARTS' | 'CORPUS' | 'BENCHMARKS' | 'BREAKOUTS';

export interface MarketVelocityCard {
  name: string;
  velocityPct: string;
  sort: 'top-trending' | 'up-and-coming';
  snap: string;
  sparkline: number[];
  points: string;
}

export interface MarketChartRow {
  rank: number;
  universeId: string;
  name: string;
  genre: string;
  playing: number;
  likeRatio: number | null;
  sort: 'top-trending' | 'up-and-coming' | string;
  velocity: string;
  delta7dPct: number | null;
  snap: string;
}

export interface MarketCorpusRow {
  name: string;
  genre: string;
  mechanic: string;
  loop: string;
  notes: string;
}

export interface MarketBenchmarkRow {
  metric: string;
  target: string;
  floor: string;
  source: string;
  notes: string;
  tier: 'must-hit' | 'strong';
}

export interface MarketBreakoutRow {
  game: string;
  age: string;
  peakPlayers: string;
  monetisation: string;
  retentionHook: string;
}

const VELOCITY_CARDS: readonly MarketVelocityCard[] = [
  {
    name: 'Sample Obby',
    velocityPct: '+42%',
    sort: 'top-trending',
    snap: '3/3',
    sparkline: [28, 34, 41, 49, 62, 78, 94],
    points: '0,34 25,29 50,25 75,20 100,14 125,8 150,3',
  },
  {
    name: 'Sample Workshop',
    velocityPct: '+31%',
    sort: 'top-trending',
    snap: '3/3',
    sparkline: [32, 36, 40, 48, 55, 66, 78],
    points: '0,32 25,28 50,25 75,20 100,15 125,10 150,5',
  },
  {
    name: 'Sample Relay',
    velocityPct: '+19%',
    sort: 'up-and-coming',
    snap: '3/3',
    sparkline: [40, 42, 46, 51, 56, 61, 68],
    points: '0,30 25,27 50,24 75,20 100,16 125,12 150,8',
  },
  {
    name: 'Sample Harbor',
    velocityPct: '+14%',
    sort: 'up-and-coming',
    snap: '3/3',
    sparkline: [44, 46, 49, 51, 55, 58, 63],
    points: '0,28 25,26 50,23 75,20 100,17 125,14 150,10',
  },
  {
    name: 'Sample Tower',
    velocityPct: '+11%',
    sort: 'top-trending',
    snap: '3/3',
    sparkline: [50, 52, 53, 56, 58, 61, 65],
    points: '0,26 25,24 50,22 75,19 100,17 125,14 150,11',
  },
];

const CHART_ROWS: readonly MarketChartRow[] = [
  { rank: 1, universeId: 'sample-1', name: 'Sample Obby', genre: 'Action', playing: 12400, likeRatio: 0.93, sort: 'top-trending', velocity: '+42%', delta7dPct: 42, snap: '3/3' },
  { rank: 2, universeId: 'sample-2', name: 'Sample Workshop', genre: 'Tycoon', playing: 7600, likeRatio: 0.91, sort: 'top-trending', velocity: '+31%', delta7dPct: 31, snap: '3/3' },
  { rank: 3, universeId: 'sample-3', name: 'Sample Relay', genre: 'Sports', playing: 5200, likeRatio: 0.89, sort: 'up-and-coming', velocity: '+19%', delta7dPct: 19, snap: '3/3' },
  { rank: 4, universeId: 'sample-4', name: 'Sample Harbor', genre: 'Simulation', playing: 4100, likeRatio: 0.92, sort: 'up-and-coming', velocity: '+14%', delta7dPct: 14, snap: '3/3' },
  { rank: 5, universeId: 'sample-5', name: 'Sample Tower', genre: 'Action', playing: 3800, likeRatio: 0.88, sort: 'top-trending', velocity: '+11%', delta7dPct: 11, snap: '3/3' },
];

const CORPUS_ROWS: readonly MarketCorpusRow[] = [
  {
    name: 'Sample Obby',
    genre: 'Action · Parkour',
    mechanic: 'Co-op relay handoff',
    loop: '3m sprint → catch pass → bank streak',
    notes: 'Fastest 14d velocity in movement cohort',
  },
  {
    name: 'Sample Workshop',
    genre: 'Tycoon · Crafting',
    mechanic: '6x6 snap-grid contraptions',
    loop: 'Build → obstacle test → blueprint trade',
    notes: 'High tablet retention and player market liquidity',
  },
  {
    name: 'Sample Relay',
    genre: 'Sports · Co-op',
    mechanic: 'Momentum baton pass',
    loop: 'Queue 4p → chain boosts → podium chest',
    notes: 'Strong friend-invite viral coefficient',
  },
  {
    name: 'Sample Harbor',
    genre: 'Simulation · Trade',
    mechanic: 'Dock crane + weather routing',
    loop: 'Load cargo → dodge squalls → upgrade hull',
    notes: 'Steady 11.2m median session length',
  },
  {
    name: 'Sample Tower',
    genre: 'Action · Defense',
    mechanic: 'Vertical trap placement',
    loop: 'Wave clear → draft relic → ascend floor',
    notes: 'Top 15% ARPPU via cosmetic tower skins',
  },
];

const BENCHMARK_ROWS: readonly MarketBenchmarkRow[] = [
  {
    metric: 'First roll / action time',
    target: '<= 45s',
    floor: '60s',
    source: '108 Tester corpus',
    notes: 'Players must complete 1 core verb before 45s',
    tier: 'must-hit',
  },
  {
    metric: 'Day 1 retention',
    target: '14.0%+',
    floor: '11.5%',
    source: 'Roblox top-200 median',
    notes: 'Required before unlocking paid acquisition',
    tier: 'must-hit',
  },
  {
    metric: 'Day 7 retention',
    target: '4.5%+',
    floor: '3.2%',
    source: 'Studio benchmark v4',
    notes: 'Driven by 3-zone progression & collection ladder',
    tier: 'strong',
  },
  {
    metric: 'Median session length',
    target: '9.0 min+',
    floor: '6.5 min',
    source: 'Telemetry cohort',
    notes: 'Mobile sessions must survive first shop visit',
    tier: 'must-hit',
  },
  {
    metric: 'Like ratio',
    target: '90.0%+',
    floor: '85.0%',
    source: 'Discovery sort gate',
    notes: 'Protects Up-and-Coming recommendation eligibility',
    tier: 'strong',
  },
];

const BREAKOUT_ROWS: readonly MarketBreakoutRow[] = [
  {
    game: 'Sample Obby',
    age: '34d',
    peakPlayers: '12,400',
    monetisation: 'Courier trails + 99 R$ starter relay pack',
    retentionHook: 'Daily storm-wall modifiers & 4p streak badges',
  },
  {
    game: 'Sample Workshop',
    age: '51d',
    peakPlayers: '7,600',
    monetisation: 'Blueprint stall slots + clockwork part crates',
    retentionHook: 'Passive Robux/coin royalties on shared contraptions',
  },
  {
    game: 'Sample Relay',
    age: '68d',
    peakPlayers: '5,200',
    monetisation: 'Season relay pass + team banner emotes',
    retentionHook: 'Squad rank decay & weekend tournament brackets',
  },
  {
    game: 'Sample Harbor',
    age: '82d',
    peakPlayers: '4,100',
    monetisation: 'Instant crane speedups + captain cosmetics',
    retentionHook: 'Co-op convoy contracts every 20 minutes',
  },
];

@Component({
  selector: 'rd-market-page',
  standalone: true,
  imports: [FormsModule, DecimalPipe, DrawerComponent],
  providers: [MarketStore],
  templateUrl: './market.page.html',
  styleUrl: './market.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketPage implements OnInit {
  readonly studioStore = inject(StudioStoreService);
  readonly marketStore = inject(MarketStore);
  private readonly tasksApi = inject(TasksApiService);
  private readonly toast = inject(ToastService);

  readonly activeTab = signal<MarketSubTab>('CHARTS');
  readonly chartFilter = signal<'all' | 'top-trending' | 'up-and-coming'>('all');
  readonly dispatchingAction = signal(false);

  readonly velocityCards = VELOCITY_CARDS;
  readonly corpusRows = CORPUS_ROWS;
  readonly benchmarkRows = BENCHMARK_ROWS;
  readonly breakoutRows = BREAKOUT_ROWS;

  readonly filteredChartRows = computed< readonly MarketChartRow[]>(() => {
    const liveRows = this.marketStore.sortedRows();
    const f = this.chartFilter();
    const q = this.marketStore.search().trim().toLowerCase();
    const genre = this.marketStore.genre().trim().toLowerCase();

    if (liveRows.length > 0) {
      const mapped: MarketChartRow[] = liveRows.map((r) => ({
        rank: r.rank,
        universeId: r.universeId,
        name: r.name,
        genre: r.genre ?? 'General',
        playing: r.playing,
        likeRatio: r.likeRatio,
        sort: this.marketStore.sort(),
        velocity:
          r.delta7dPct !== null
            ? `${r.delta7dPct >= 0 ? '+' : ''}${r.delta7dPct.toFixed(0)}%`
            : '0%',
        delta7dPct: r.delta7dPct,
        snap: `${r.sparkline.length || 3}/3`,
      }));
      if (f === 'all') return mapped;
      return mapped.filter((r) => r.sort === f);
    }

    return CHART_ROWS.filter((r) => {
      if (f !== 'all' && r.sort !== f) return false;
      if (genre && r.genre.toLowerCase() !== genre) return false;
      if (q && !r.name.toLowerCase().includes(q) && !r.genre.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  readonly historySvgPoints = computed<string>(() => {
    const pts = this.marketStore.historyPoints();
    const vals = pts.length >= 2 ? pts.map((p) => p.playing) : [3200, 3800, 4100, 4600, 5200, 5800];
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const span = Math.max(1, max - min);
    return vals
      .map((v, idx) => {
        const x = Math.round((idx / Math.max(1, vals.length - 1)) * 320);
        const y = Math.round(90 - ((v - min) / span) * 76);
        return `${x},${y}`;
      })
      .join(' ');
  });

  ngOnInit(): void {
    void this.marketStore.load();
  }

  toggleChartFilter(sort: 'top-trending' | 'up-and-coming'): void {
    this.chartFilter.update((cur) => (cur === sort ? 'all' : sort));
  }

  openRowDrawer(row: MarketChartRow): void {
    void this.marketStore.openHistoryForGame({
      universeId: row.universeId,
      name: row.name,
      genre: row.genre,
      playing: row.playing,
      likeRatio: row.likeRatio,
      delta7dPct: row.delta7dPct,
    });
  }

  onDrawerOpenChange(open: boolean): void {
    if (!open) {
      this.marketStore.closeHistory();
    }
  }

  async pitchCompetitor(): Promise<void> {
    const studioId = this.studioStore.studioId();
    const game = this.marketStore.selectedGame();
    if (!studioId || !game || this.dispatchingAction()) return;

    this.dispatchingAction.set(true);
    try {
      await firstValueFrom(
        this.tasksApi.create(studioId, {
          agentKey: 'pulse',
          title: `Pitch a competitor to ${game.name}`,
          brief: `Analyze Roblox market title "${game.name}" (universeId: ${game.universeId}, genre: ${game.genre ?? 'General'}, CCU: ${game.playing}) and write a differentiated competitor pitch using create_pitch with cited market metrics.`,
          gameId: null,
          priority: 'HIGH',
          tags: ['market', 'pitch', 'competitor'],
        }),
      );
      this.toast.success(`Delegated competitor pitch for "${game.name}" to Pulse`);
      this.marketStore.closeHistory();
    } catch {
      this.toast.error('Failed to dispatch competitor pitch task');
    } finally {
      this.dispatchingAction.set(false);
    }
  }

  async sendToPulseTeardown(): Promise<void> {
    const studioId = this.studioStore.studioId();
    const game = this.marketStore.selectedGame();
    if (!studioId || !game || this.dispatchingAction()) return;

    this.dispatchingAction.set(true);
    try {
      await firstValueFrom(
        this.tasksApi.create(studioId, {
          agentKey: 'pulse',
          title: `Market teardown: ${game.name}`,
          brief: `Perform a deep retention, core-loop, and monetization teardown of "${game.name}" (universeId: ${game.universeId}, CCU: ${game.playing}) and document key benchmarks in the Knowledge Vault.`,
          gameId: null,
          priority: 'NORMAL',
          tags: ['market', 'teardown'],
        }),
      );
      this.toast.success(`Sent "${game.name}" to Pulse for teardown`);
      this.marketStore.closeHistory();
    } catch {
      this.toast.error('Failed to dispatch teardown task');
    } finally {
      this.dispatchingAction.set(false);
    }
  }
}
