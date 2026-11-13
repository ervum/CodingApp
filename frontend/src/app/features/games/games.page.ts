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
  AGENT_BY_KEY,
  type AgentKey,
  type GameStatus,
  type MarketHistoryPointDto,
  type TaskDto,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { GamesApiService } from '../../core/api/games-api.service';
import { MarketApiService } from '../../core/api/market-api.service';
import { TasksApiService } from '../../core/api/tasks-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { upsertById } from '../../core/state/upsert';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { GameDetailPage } from './game-detail.page';

export type GameSelectorMode = string;
export type GameSubTab = 'OVERVIEW' | 'LIVE_NUMBERS' | 'PIPELINE' | 'SETTINGS_BUILDS';

export interface TelemetryChartSpec {
  title: string;
  latest: string;
  delta: string;
  color: string;
  points: string;
  areaPoints: string;
}

export interface BreakdownCardSpec {
  title: string;
  rows: Array<{ label: string; value: string; pct: number }>;
}

export interface KanbanCardSpec {
  id?: string;
  slug: string;
  name: string;
  version: string;
  stageLabel: string;
  statusLabel: string;
  filePath: string;
  nextLabel: string;
  summary: string;
}

export interface KanbanColumnSpec {
  stage: string;
  targetStatus: GameStatus;
  cards: KanbanCardSpec[];
}

const TELEMETRY_CHARTS: readonly TelemetryChartSpec[] = [
  {
    title: 'Daily active users',
    latest: '1,420',
    delta: '+18.4% vs 7d',
    color: '#A855F7',
    points: '0,48 40,42 80,44 120,34 160,28 200,22 240,12',
    areaPoints: '0,60 0,48 40,42 80,44 120,34 160,28 200,22 240,12 240,60',
  },
  {
    title: 'Players online',
    latest: '96 CCU',
    delta: 'Peak 142 today',
    color: '#38BDF8',
    points: '0,44 40,38 80,30 120,35 160,20 200,24 240,14',
    areaPoints: '0,60 0,44 40,38 80,30 120,35 160,20 200,24 240,14 240,60',
  },
  {
    title: 'Robux spent',
    latest: '18.4K R$',
    delta: 'ARPPU 214 R$',
    color: '#22C55E',
    points: '0,50 40,46 80,38 120,32 160,29 200,19 240,15',
    areaPoints: '0,60 0,50 40,46 80,38 120,32 160,29 200,19 240,15 240,60',
  },
  {
    title: 'The first minute',
    latest: '84.6%',
    delta: 'Reach first roll < 45s',
    color: '#F59E0B',
    points: '0,10 40,14 80,18 120,21 160,24 200,26 240,27',
    areaPoints: '0,60 0,10 40,14 80,18 120,21 160,24 200,26 240,27 240,60',
  },
  {
    title: 'Session time',
    latest: '9.2 min',
    delta: '+1.4 min vs v11',
    color: '#EC4899',
    points: '0,46 40,40 80,36 120,30 160,26 200,20 240,16',
    areaPoints: '0,60 0,46 40,40 80,36 120,30 160,26 200,20 240,16 240,60',
  },
  {
    title: 'Playtime per daily user',
    latest: '16.8 min',
    delta: '1.82 sessions / DAU',
    color: '#8B5CF6',
    points: '0,44 40,41 80,35 120,31 160,25 200,21 240,15',
    areaPoints: '0,60 0,44 40,41 80,35 120,31 160,25 200,21 240,15 240,60',
  },
  {
    title: 'Day 1 retention by source',
    latest: '14.2%',
    delta: 'Home rec 15.6%',
    color: '#14B8A6',
    points: '0,42 40,39 80,37 120,30 160,26 200,22 240,18',
    areaPoints: '0,60 0,42 40,39 80,37 120,30 160,26 200,22 240,18 240,60',
  },
  {
    title: 'Plays by source',
    latest: '68% Home',
    delta: '21% Search · 11% Friends',
    color: '#60A5FA',
    points: '0,48 40,43 80,36 120,28 160,24 200,18 240,12',
    areaPoints: '0,60 0,48 40,43 80,36 120,28 160,24 200,18 240,12 240,60',
  },
];

const BREAKDOWN_CARDS: readonly BreakdownCardSpec[] = [
  {
    title: 'Spend per paying player',
    rows: [
      { label: 'Starter Pack (99 R$)', value: '48%', pct: 48 },
      { label: 'Awakened Roll ×10 (399 R$)', value: '36%', pct: 36 },
      { label: 'Aura Vault Pass (799 R$)', value: '16%', pct: 16 },
    ],
  },
  {
    title: 'Performance',
    rows: [
      { label: 'Client FPS (median)', value: '59.4 fps', pct: 96 },
      { label: 'Server heartbeat', value: '59.9 Hz', pct: 99 },
      { label: 'Crash-free sessions', value: '99.6%', pct: 99 },
    ],
  },
  {
    title: 'Country',
    rows: [
      { label: 'United States', value: '44%', pct: 44 },
      { label: 'United Kingdom', value: '14%', pct: 14 },
      { label: 'Brazil', value: '12%', pct: 12 },
    ],
  },
  {
    title: 'Age',
    rows: [
      { label: '13–17', value: '52%', pct: 52 },
      { label: '9–12', value: '29%', pct: 29 },
      { label: '18+', value: '19%', pct: 19 },
    ],
  },
  {
    title: 'Language',
    rows: [
      { label: 'English', value: '74%', pct: 74 },
      { label: 'Portuguese', value: '13%', pct: 13 },
      { label: 'Spanish', value: '9%', pct: 9 },
    ],
  },
  {
    title: 'Device and gender',
    rows: [
      { label: 'Phone / Tablet', value: '64%', pct: 64 },
      { label: 'Desktop', value: '28%', pct: 28 },
      { label: 'Console', value: '8%', pct: 8 },
    ],
  },
];

const DEFAULT_KANBAN_COLUMNS: readonly KanbanColumnSpec[] = [
  { stage: 'Pitched', targetStatus: 'CONCEPT', cards: [] },
  {
    stage: 'Designed',
    targetStatus: 'BLUEPRINT',
    cards: [
      {
        slug: 'game-two',
        name: 'Game Two',
        version: 'v3 saved',
        stageLabel: 'Designed · Approved',
        statusLabel: '✓ Approved · next: Builder',
        filePath: 'games/game-two/stage.json',
        nextLabel: 'Builder',
        summary: 'Architect wrote the 12-step guide; waiting on you to kick off Builder.',
      },
    ],
  },
  { stage: 'Assets ready', targetStatus: 'BUILDING', cards: [] },
  {
    stage: 'Built',
    targetStatus: 'BUILDING',
    cards: [
      {
        slug: 'game-one',
        name: 'Game One',
        version: 'v12 saved',
        stageLabel: 'Built · Approved',
        statusLabel: '✓ Approved · next: Balance',
        filePath: 'games/game-one/stage.json',
        nextLabel: 'Balance',
        summary:
          'Balance, Scenic and Librarian finished; Frame and Merchant have updates waiting for your review.',
      },
    ],
  },
  { stage: 'Balanced', targetStatus: 'TESTING', cards: [] },
  { stage: 'Art done', targetStatus: 'TESTING', cards: [] },
  { stage: 'Ready to publish', targetStatus: 'TESTING', cards: [] },
  { stage: 'Live', targetStatus: 'LIVE', cards: [] },
  { stage: 'Cooled', targetStatus: 'PAUSED', cards: [] },
];

@Component({
  selector: 'rd-games-page',
  standalone: true,
  imports: [FormsModule, AgentAvatarComponent, DialogComponent, GameDetailPage],
  templateUrl: './games.page.html',
  styleUrl: './games.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GamesPage {
  readonly store = inject(StudioStoreService);
  private readonly tasksApi = inject(TasksApiService);
  private readonly gamesApi = inject(GamesApiService);
  private readonly marketApi = inject(MarketApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly gameSlug = input<string | undefined>();

  readonly selector = signal<GameSelectorMode>('all');
  readonly subTab = signal<GameSubTab>('OVERVIEW');
  readonly liveSubNav = signal<string>('Charts');
  readonly tasks = signal<TaskDto[]>([]);
  readonly liveMarketHistory = signal<MarketHistoryPointDto[]>([]);
  readonly draggingGameSlug = signal<string | null>(null);

  readonly kanbanModalOpen = signal<boolean>(false);
  readonly inspectedKanbanCard = signal<KanbanCardSpec | null>(null);

  readonly gameTabs = computed(() => {
    const liveGames = this.store.games();
    if (liveGames.length > 0) {
      return liveGames.map((g) => ({ slug: g.slug, name: g.name }));
    }
    return [
      { slug: 'game-one', name: 'Game One' },
      { slug: 'game-two', name: 'Game Two' },
    ];
  });

  readonly liveSubNavPills = [
    'Charts',
    'Where players leave',
    'Sessions, money & errors',
    'Trends',
    'Benchmarks',
    'Fixes & reports',
  ];

  readonly kpiCards = computed(() => {
    const pts = this.liveMarketHistory();
    const latestPoint = pts[pts.length - 1];
    const totalVotes = latestPoint ? latestPoint.upVotes + latestPoint.downVotes : 0;
    const likeRatioPct =
      latestPoint && totalVotes > 0 ? (latestPoint.upVotes / totalVotes) * 100 : null;
    return [
      { label: 'PLAYING NOW', value: latestPoint ? String(latestPoint.playing) : '96' },
      { label: 'VISITS', value: '1.4K' },
      {
        label: 'LIKE RATIO',
        value: likeRatioPct !== null ? `${likeRatioPct.toFixed(1)}%` : '91.4%',
      },
      { label: 'DAY 1 RETENTION', value: '14.2%' },
      { label: 'DAY 7 RETENTION', value: '4.8%' },
      { label: 'MEDIAN SESSION', value: '9.2 min' },
    ];
  });

  readonly telemetryCharts = computed<readonly TelemetryChartSpec[]>(() => {
    const allPts = this.liveMarketHistory();
    if (allPts.length < 2) {
      return TELEMETRY_CHARTS;
    }
    const pts = allPts.slice(-7);
    const maxCcu = Math.max(1, ...pts.map((p: MarketHistoryPointDto) => p.playing));
    const poly = pts
      .map((p: MarketHistoryPointDto, idx: number) => {
        const x = Math.round((idx / Math.max(1, pts.length - 1)) * 240);
        const y = Math.round(52 - (p.playing / maxCcu) * 40);
        return `${x},${y}`;
      })
      .join(' ');
    const latest = pts[pts.length - 1]!;
    return TELEMETRY_CHARTS.map((c) =>
      c.title === 'Players online'
        ? {
            ...c,
            latest: `${latest.playing} CCU`,
            delta: `Peak ${maxCcu} CCU`,
            points: poly,
            areaPoints: `0,60 ${poly} 240,60`,
          }
        : c,
    );
  });

  readonly breakdownCards = BREAKDOWN_CARDS;

  readonly kanbanColumns = computed<readonly KanbanColumnSpec[]>(() => {
    const liveGames = this.store.games();
    if (liveGames.length === 0) {
      return DEFAULT_KANBAN_COLUMNS;
    }

    const cols: KanbanColumnSpec[] = DEFAULT_KANBAN_COLUMNS.map((c) => ({
      stage: c.stage,
      targetStatus: c.targetStatus,
      cards: [],
    }));

    const stageForStatus = (status: GameStatus): string => {
      switch (status) {
        case 'CONCEPT':
          return 'Pitched';
        case 'BLUEPRINT':
          return 'Designed';
        case 'BUILDING':
          return 'Built';
        case 'TESTING':
          return 'Ready to publish';
        case 'LIVE':
          return 'Live';
        case 'PAUSED':
          return 'Cooled';
      }
    };

    for (const g of liveGames) {
      const targetStage = stageForStatus(g.status);
      const col = cols.find((c) => c.stage === targetStage) ?? cols[3]!;
      col.cards.push({
        id: g.id,
        slug: g.slug,
        name: g.name,
        version: `v${g.latestSavedVersion ?? 1} saved`,
        stageLabel: `${col.stage} · ${g.status}`,
        statusLabel: g.currentStage
          ? `✓ ${g.currentStage}`
          : `${g.milestonesDone}/${g.milestonesTotal} milestones`,
        filePath: `games/${g.slug}/stage.json`,
        nextLabel: g.currentStage ?? 'Next milestone',
        summary:
          g.currentStage ??
          `${g.milestonesDone} of ${g.milestonesTotal} milestones complete (${g.progressPct}%).`,
      });
    }

    return cols;
  });

  readonly liveChecklist = [
    'Roll and reveal loop',
    'A clear first objective',
    'Reward check ready for review',
  ];

  readonly filteredTasks = computed(() => {
    const sel = this.selector();
    const all = this.tasks();
    if (sel === 'all') return all;
    const game = this.store.games().find((g) => g.slug === sel);
    if (!game) return all;
    return all.filter((t) => !t.gameId || t.gameId === game.id);
  });

  readonly activeGameMeta = computed(() => {
    const sel = this.selector();
    const liveGame = this.store.games().find((g) => g.slug === sel);
    if (liveGame) {
      return {
        tileNumber: String(liveGame.progressPct || 53),
        name: liveGame.name,
        savedBadge: `v${liveGame.latestSavedVersion ?? 1} saved`,
        summary:
          liveGame.currentStage ||
          `${liveGame.milestonesDone} of ${liveGame.milestonesTotal} milestones complete (${liveGame.progressPct}%)`,
      };
    }
    if (sel === 'game-two') {
      return {
        tileNumber: '18',
        name: 'Game Two',
        savedBadge: 'v3 saved',
        summary: 'Designed: Architect wrote the 12-step guide; waiting on you to kick off Builder',
      };
    }
    return {
      tileNumber: '53',
      name: 'Game One',
      savedBadge: 'v12 saved',
      summary:
        'Built: Balance, Scenic and Librarian finished; Frame and Merchant have updates waiting for your review',
    };
  });

  constructor() {
    effect(() => {
      const slug = this.gameSlug();
      if (slug) {
        this.selector.set(slug);
      }
    });

    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        void firstValueFrom(this.tasksApi.list(studioId, { limit: 30 }))
          .then((res) => this.tasks.set(res.items))
          .catch(() => undefined);
      }
    });

    effect(() => {
      const studioId = this.store.studioId();
      const sel = this.selector();
      if (!studioId || sel === 'all') {
        this.liveMarketHistory.set([]);
        return;
      }
      const game = this.store.games().find((g) => g.slug === sel);
      if (!game) return;
      void firstValueFrom(this.gamesApi.getDetail(studioId, game.id))
        .then(async (detail) => {
          const uId = detail.robloxUniverseId?.trim();
          if (uId) {
            const hist = await firstValueFrom(this.marketApi.history(uId, 8));
            this.liveMarketHistory.set(hist);
          } else {
            this.liveMarketHistory.set([]);
          }
        })
        .catch(() => this.liveMarketHistory.set([]));
    });
  }

  selectMode(mode: GameSelectorMode): void {
    this.selector.set(mode);
  }

  handToLead(): void {
    const slug = this.store.studio()?.slug ?? 'inclined-games';
    this.toast.info('Handed first-session exit point inspection to Lead');
    void this.router.navigate(['/s', slug, 'lead']);
  }

  openKanbanCard(card: KanbanCardSpec): void {
    this.inspectedKanbanCard.set(card);
    this.kanbanModalOpen.set(true);
  }

  onCardDragStart(card: KanbanCardSpec): void {
    this.draggingGameSlug.set(card.slug);
  }

  onColumnDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  async onColumnDrop(col: KanbanColumnSpec, event: DragEvent): Promise<void> {
    event.preventDefault();
    const slug = this.draggingGameSlug();
    this.draggingGameSlug.set(null);
    if (!slug) return;
    const studioId = this.store.studioId();
    const game = this.store.games().find((g) => g.slug === slug);
    if (!studioId || !game || game.status === col.targetStatus) return;

    try {
      const updated = await firstValueFrom(
        this.gamesApi.update(studioId, game.id, { status: col.targetStatus }),
      );
      this.store.games.update((list) => upsertById(list, updated));
      this.toast.success(`Moved ${game.name} to ${col.stage} (${col.targetStatus})`);
    } catch {
      this.toast.error('Failed to update game stage');
    }
  }

  agentName(key: AgentKey): string {
    return AGENT_BY_KEY[key]?.name ?? key;
  }
}
