import { HttpErrorResponse } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type {
  MarketHistoryPointDto,
  MarketIngestionRunDto,
  MarketLeaderboardDto,
  MarketRowDto,
  MarketSortId,
} from '@robdev/shared';
import { Subscription, firstValueFrom } from 'rxjs';
import { MarketApiService } from '../../core/api/market-api.service';
import { SocketService } from '../../core/realtime/socket.service';
import { ToastService } from '../../shared/ui/toast/toast.service';

export type MarketColumn =
  | 'rank'
  | 'name'
  | 'genre'
  | 'playing'
  | 'delta7dPct'
  | 'likeRatio'
  | 'visits'
  | 'favoritedCount';

@Injectable()
export class MarketStore {
  private readonly marketApi = inject(MarketApiService);
  private readonly socket = inject(SocketService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly sort = signal<MarketSortId>('top-earning');
  readonly genre = signal<string>('');
  readonly search = signal<string>('');
  readonly board = signal<MarketLeaderboardDto | null>(null);
  readonly sortColumn = signal<MarketColumn>('rank');
  readonly sortDir = signal<'asc' | 'desc'>('asc');
  readonly runs = signal<MarketIngestionRunDto[]>([]);
  readonly loading = signal<boolean>(false);
  readonly refreshing = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  readonly selectedGame = signal<{
    universeId: string;
    name: string;
    genre: string | null;
    playing: number;
    likeRatio: number | null;
    delta7dPct: number | null;
  } | null>(null);
  readonly historyPoints = signal<MarketHistoryPointDto[]>([]);
  readonly loadingHistory = signal<boolean>(false);

  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly sortedRows = computed<MarketRowDto[]>(() => {
    const b = this.board();
    if (!b) return [];
    const genreFilter = this.genre().trim().toLowerCase();
    const q = this.search().trim().toLowerCase();

    const filtered = b.rows.filter((r) => {
      if (genreFilter && (r.genre ?? '').toLowerCase() !== genreFilter) return false;
      if (
        q &&
        !r.name.toLowerCase().includes(q) &&
        !r.creatorName.toLowerCase().includes(q) &&
        !(r.genre ?? '').toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });

    const col = this.sortColumn();
    const dir = this.sortDir() === 'asc' ? 1 : -1;

    return [...filtered].sort((a, bRow) => {
      let cmp = 0;
      switch (col) {
        case 'rank':
          cmp = a.rank - bRow.rank;
          break;
        case 'name':
          cmp = a.name.localeCompare(bRow.name);
          break;
        case 'genre':
          cmp = (a.genre ?? '').localeCompare(bRow.genre ?? '');
          break;
        case 'playing':
          cmp = a.playing - bRow.playing;
          break;
        case 'delta7dPct':
          cmp = (a.delta7dPct ?? -999999) - (bRow.delta7dPct ?? -999999);
          break;
        case 'likeRatio':
          cmp = (a.likeRatio ?? -1) - (bRow.likeRatio ?? -1);
          break;
        case 'visits':
          cmp = a.visits - bRow.visits;
          break;
        case 'favoritedCount':
          cmp = a.favoritedCount - bRow.favoritedCount;
          break;
      }
      return cmp * dir;
    });
  });

  private readonly subs = new Subscription();

  constructor() {
    this.wireSocket();
    this.destroyRef.onDestroy(() => {
      this.subs.unsubscribe();
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
  }

  setSearch(query: string): void {
    this.search.set(query);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      void this.load();
    }, 280);
  }

  setGenre(genre: string): void {
    this.genre.set(genre);
    void this.load();
  }

  async openHistoryForGame(game: {
    universeId: string;
    name: string;
    genre: string | null;
    playing: number;
    likeRatio: number | null;
    delta7dPct: number | null;
  }): Promise<void> {
    this.selectedGame.set(game);
    this.loadingHistory.set(true);
    try {
      const pts = await firstValueFrom(this.marketApi.history(game.universeId, 14));
      this.historyPoints.set(pts);
    } catch {
      this.historyPoints.set([]);
    } finally {
      this.loadingHistory.set(false);
    }
  }

  closeHistory(): void {
    this.selectedGame.set(null);
    this.historyPoints.set([]);
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [board, runs] = await Promise.all([
        firstValueFrom(
          this.marketApi.leaderboard({
            sort: this.sort(),
            ...(this.genre() ? { genre: this.genre() } : {}),
            ...(this.search().trim() ? { search: this.search().trim() } : {}),
            limit: 100,
          }),
        ),
        firstValueFrom(this.marketApi.ingestionRuns()),
      ]);
      this.board.set(board);
      this.runs.set(runs);
    } catch {
      this.error.set('Could not load Roblox market leaderboard.');
    } finally {
      this.loading.set(false);
    }
  }

  async setSort(sort: MarketSortId): Promise<void> {
    if (this.sort() === sort && this.board()) return;
    this.sort.set(sort);
    this.sortColumn.set('rank');
    this.sortDir.set('asc');
    await this.load();
  }

  async refresh(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    try {
      const run = await firstValueFrom(this.marketApi.refresh());
      if (run.status === 'FAILED') {
        this.toast.warning(run.errorMessage ?? 'Live market ingest failed; using cached snapshot.');
      } else {
        this.toast.success(`Fetched ${run.gamesFetched} games from Roblox charts.`);
      }
      await this.load();
    } catch (err: unknown) {
      if (err instanceof HttpErrorResponse && err.status === 409) {
        this.toast.info('Market ingestion is already running.');
      } else {
        this.toast.error('Failed to trigger market refresh.');
      }
    } finally {
      this.refreshing.set(false);
    }
  }

  private wireSocket(): void {
    this.subs.add(
      this.socket.on('market:ingested').subscribe((e) => {
        if (e.status !== 'FAILED') {
          void this.load();
        } else {
          void firstValueFrom(this.marketApi.ingestionRuns())
            .then((runs) => this.runs.set(runs))
            .catch(() => undefined);
        }
      }),
    );
  }
}
