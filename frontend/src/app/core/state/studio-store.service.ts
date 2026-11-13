import { Injectable, type Signal, computed, inject, signal } from '@angular/core';
import {
  AGENT_BY_KEY,
  ROLE_RANK,
  type AgentDto,
  type AgentKey,
  type AgentScreenDto,
  type GameDto,
  type HumanRequestDto,
  type LiveRunDto,
  type MembershipRole,
  type ReviewItemDto,
  type ReviewStatus,
  type ReviewTab,
  type StudioCountsDto,
  type StudioDto,
  type StudioFreshnessDto,
  type StudioLaneDto,
  type StudioSetupDto,
  type TaskDto,
  type TaskOutputDto,
} from '@robdev/shared';
import { type Observable, Subscription, filter, firstValueFrom } from 'rxjs';
import { StudioApiService } from '../api/studio-api.service';
import { TasksApiService } from '../api/tasks-api.service';
import { SocketService } from '../realtime/socket.service';
import { upsertById } from './upsert';

export const EMPTY_COUNTS: StudioCountsDto = {
  needsYou: 0,
  working: 0,
  queued: 0,
  openTasks: 0,
  review: {
    toReview: 0,
    changesAsked: 0,
    approved: 0,
    rejected: 0,
    all: 0,
    byTab: {
      IMAGES_VIDEO: { toReview: 0, all: 0 },
      STAGES_PUBLISH: { toReview: 0, all: 0 },
    },
  },
};

@Injectable({ providedIn: 'root' })
export class StudioStoreService {
  private readonly api = inject(StudioApiService);
  private readonly tasksApi = inject(TasksApiService);
  private readonly socket = inject(SocketService);

  // ── state ─────────────────────────────────────────────
  readonly studio = signal<StudioDto | null>(null);
  readonly myRole = signal<MembershipRole>('VIEWER');
  readonly loadState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly selectedGameId = signal<string | 'all'>('all');
  private readonly agentsByKey = signal<ReadonlyMap<AgentKey, AgentDto>>(new Map());
  readonly games = signal<GameDto[]>([]);
  readonly lanes = signal<StudioLaneDto[]>([]);
  readonly liveRuns = signal<LiveRunDto[]>([]);
  readonly humanRequests = signal<HumanRequestDto[]>([]);
  readonly tasks = signal<TaskDto[]>([]);
  readonly completedOutputs = signal<TaskOutputDto[]>([]);
  readonly reviewItems = signal<ReviewItemDto[]>([]);
  readonly logBuffers = signal<ReadonlyMap<string, string>>(new Map());
  readonly counts = signal<StudioCountsDto>(EMPTY_COUNTS);
  readonly setup = signal<StudioSetupDto>({ hasAnyLlmConnection: false, unboundAgentKeys: [] });
  readonly freshness = signal<StudioFreshnessDto>({
    marketLastSuccessAt: null,
    vaultDocCount: 0,
    vaultLastUpdatedAt: null,
    assetCount: 0,
    assetLastUpdatedAt: null,
  });
  readonly agentScreens = signal<AgentScreenDto[]>([]);
  readonly newTaskModalOpen = signal<boolean>(false);
  readonly newTaskDefaultAgent = signal<AgentKey>('lead');

  openNewTaskModal(agentKey: AgentKey = 'lead'): void {
    this.newTaskDefaultAgent.set(agentKey);
    this.newTaskModalOpen.set(true);
  }

  // ── derived ───────────────────────────────────────────
  readonly studioId = computed(() => this.studio()?.id ?? null);
  readonly agents = computed(() =>
    [...this.agentsByKey().values()].sort((a, b) => a.order - b.order),
  );
  readonly workingAgents = computed(() => this.agents().filter((a) => a.status === 'WORKING'));
  readonly selectedGame = computed(() => {
    const id = this.selectedGameId();
    return id === 'all' ? null : (this.games().find((g) => g.id === id) ?? null);
  });
  readonly visibleGames = computed(() => {
    const g = this.selectedGame();
    return g ? [g] : this.games();
  });
  readonly filteredLiveRuns = computed(() => this.byGame(this.liveRuns(), (r) => r.gameId));
  readonly filteredRequests = computed(() => this.byGame(this.humanRequests(), (r) => r.gameId));
  readonly filteredTasks = computed(() => this.byGame(this.tasks(), (t) => t.gameId));
  readonly filteredOutputs = computed(() => this.byGame(this.completedOutputs(), (o) => o.gameId));
  readonly filteredReviewItems = computed(() => this.byGame(this.reviewItems(), (r) => r.gameId));
  readonly canEdit = computed(() => ROLE_RANK[this.myRole()] >= ROLE_RANK.PRODUCER);
  readonly isAdmin = computed(() => ROLE_RANK[this.myRole()] >= ROLE_RANK.ADMIN);
  readonly isPaused = computed(() => this.studio()?.isPaused ?? false);
  readonly navBadges = computed(() => ({
    home: 4,
    lead: this.agentsByKey().get('lead')?.status === 'WAITING_ON_HUMAN' ? 1 : 0,
    team: this.workingAgents().length,
    tasks: 0,
    review: 5,
    pitches: 2,
    output: this.filteredOutputs().length,
  }));

  reviewCountForFilter(filterStatus: ReviewStatus | 'ALL', tab?: ReviewTab): number {
    const items = this.filteredReviewItems().filter((item) => (tab ? item.tab === tab : true));
    if (items.length > 0 || this.reviewItems().length > 0) {
      return filterStatus === 'ALL'
        ? items.length
        : items.filter((item) => item.status === filterStatus).length;
    }
    const c = this.counts().review;
    if (tab && (filterStatus === 'TO_REVIEW' || filterStatus === 'ALL')) {
      return filterStatus === 'TO_REVIEW' ? c.byTab[tab].toReview : c.byTab[tab].all;
    }
    switch (filterStatus) {
      case 'TO_REVIEW':
        return c.toReview;
      case 'CHANGES_ASKED':
        return c.changesAsked;
      case 'APPROVED':
        return c.approved;
      case 'REJECTED':
        return c.rejected;
      case 'ALL':
        return c.all;
    }
  }

  /** "2 agents working · Playtest has Studio" */
  readonly executionSummary = computed(() => {
    const n = this.workingAgents().length;
    const held = this.lanes().filter((l) => l.heldByAgentKey);
    const left = n === 0 ? 'All agents idle' : `${n} agent${n === 1 ? '' : 's'} working`;
    const right =
      held.length === 0
        ? 'Studio free'
        : held.map((l) => `${AGENT_BY_KEY[l.heldByAgentKey!].name} has Studio`).join(' · ');
    return `${left} · ${right}`;
  });

  agent(key: AgentKey): Signal<AgentDto | undefined> {
    return computed(() => this.agentsByKey().get(key));
  }

  private activeStudioId: string | null = null;
  private subscriptions: Subscription | null = null;

  async activate(studioId: string): Promise<void> {
    if (this.activeStudioId === studioId && this.loadState() === 'ready') return;
    this.deactivate();
    this.activeStudioId = studioId;
    this.loadState.set('loading');
    this.socket.connect();
    await this.hydrate(studioId);
    await this.socket.emitWithAck('studio:join', { studioId }).catch(() => undefined);
    this.subscriptions = this.wireEvents();
    const saved = this.readStorage(`rd.selectedGame.${studioId}`);
    this.selectedGameId.set(saved && this.games().some((g) => g.id === saved) ? saved : 'all');
  }

  selectGame(id: string | 'all'): void {
    this.selectedGameId.set(id);
    if (this.activeStudioId) {
      this.writeStorage(`rd.selectedGame.${this.activeStudioId}`, id);
    }
  }

  async reloadSnapshot(): Promise<void> {
    if (!this.activeStudioId) return;
    await this.hydrate(this.activeStudioId);
  }

  async reloadOutputs(): Promise<void> {
    if (!this.activeStudioId) return;
    try {
      const res = await firstValueFrom(this.tasksApi.listOutputs(this.activeStudioId));
      this.completedOutputs.set(res.items);
    } catch {
      // ignore
    }
  }

  private async hydrate(studioId: string): Promise<void> {
    try {
      const s = await firstValueFrom(this.api.snapshot(studioId));
      this.studio.set(s.studio);
      this.myRole.set(s.myRole);
      this.agentsByKey.set(new Map(s.agents.map((a) => [a.key, a])));
      this.games.set(s.games);
      this.lanes.set(s.lanes);
      this.liveRuns.set(s.liveRuns);
      this.humanRequests.set(s.humanRequests);
      this.counts.set(s.counts);
      this.setup.set(s.setup);
      if (s.freshness) {
        this.freshness.set(s.freshness);
      }
      if (s.agentScreens) {
        this.agentScreens.set(s.agentScreens);
      }
      this.loadState.set('ready');
      void this.reloadOutputs();
    } catch (e) {
      this.loadState.set('error');
      throw e;
    }
  }

  private wireEvents(): Subscription {
    const sub = new Subscription();
    const mine = <T extends { studioId: string }>(src: Observable<T>): Observable<T> =>
      src.pipe(filter((e) => e.studioId === this.activeStudioId));

    sub.add(
      mine(this.socket.on('agent:status')).subscribe((e) =>
        this.patchAgent(e.agentKey, {
          status: e.status,
          currentTaskId: e.currentTaskId,
          currentTaskTitle: e.currentTaskTitle,
          currentRunId: e.currentRunId,
          currentGameId: e.currentGameId,
          lastSnippet: e.lastSnippet,
          lastErrorCode: e.lastErrorCode,
          lastActivityAt: e.at,
        }),
      ),
    );
    sub.add(
      mine(this.socket.on('agent:activity')).subscribe((e) => {
        this.patchAgent(e.agentKey, { lastSnippet: e.snippet, lastActivityAt: e.at });
        this.liveRuns.update((runs) =>
          runs.map((r) => (r.runId === e.runId ? { ...r, lastSnippet: e.snippet } : r)),
        );
      }),
    );
    sub.add(
      mine(this.socket.on('run:started')).subscribe((e) => {
        if (e.live) {
          this.liveRuns.update((r) => [e.live!, ...r.filter((x) => x.runId !== e.live!.runId)]);
        }
      }),
    );
    sub.add(
      mine(this.socket.on('run:finished')).subscribe((e) =>
        this.liveRuns.update((r) => r.filter((x) => x.runId !== e.run.id)),
      ),
    );
    sub.add(mine(this.socket.on('studio:counts')).subscribe((e) => this.counts.set(e.counts)));
    sub.add(
      mine(this.socket.on('studio:paused')).subscribe((e) =>
        this.studio.update((s) =>
          s ? { ...s, isPaused: e.isPaused, pausedAt: e.isPaused ? e.at : null } : s,
        ),
      ),
    );
    sub.add(
      mine(this.socket.on('lane:updated')).subscribe((e) =>
        this.lanes.update((l) => upsertById(l, e.lane)),
      ),
    );
    sub.add(
      mine(this.socket.on('agent:screen')).subscribe((e) =>
        this.agentScreens.update((list) => [
          e.screen,
          ...list.filter((s) => s.agentKey !== e.screen.agentKey),
        ]),
      ),
    );
    sub.add(
      mine(this.socket.on('asset:updated')).subscribe((e) =>
        this.freshness.update((f) => ({
          ...f,
          assetCount:
            e.change === 'created'
              ? f.assetCount + 1
              : e.change === 'deleted'
                ? Math.max(0, f.assetCount - 1)
                : f.assetCount,
          assetLastUpdatedAt: e.asset.createdAt,
        })),
      ),
    );
    sub.add(
      mine(this.socket.on('vault:document-updated')).subscribe(() =>
        this.freshness.update((f) => ({
          ...f,
          vaultLastUpdatedAt: new Date().toISOString(),
        })),
      ),
    );
    sub.add(
      this.socket.on('market:ingested').subscribe((e) =>
        this.freshness.update((f) => ({
          ...f,
          marketLastSuccessAt: e.at,
        })),
      ),
    );
    sub.add(
      mine(this.socket.on('game:updated')).subscribe((e) =>
        this.games.update((g) => upsertById(g, e.game)),
      ),
    );
    sub.add(
      mine(this.socket.on('human-request:updated')).subscribe((e) =>
        this.humanRequests.update((list) =>
          e.request.status === 'OPEN'
            ? upsertById(list, e.request, 'prepend')
            : list.filter((x) => x.id !== e.request.id),
        ),
      ),
    );
    sub.add(
      mine(this.socket.on('agent:log-chunk')).subscribe((e) => {
        if (!e.delta) return;
        const key = `${e.runId}:${e.entryId}`;
        this.logBuffers.update((m) => {
          const next = new Map(m);
          next.set(key, (m.get(key) ?? '') + e.delta);
          return next;
        });
      }),
    );
    sub.add(
      mine(this.socket.on('task:updated')).subscribe((e) => {
        this.tasks.update((list) =>
          e.change === 'deleted'
            ? list.filter((x) => x.id !== e.task.id)
            : upsertById(list, e.task, e.change === 'created' ? 'prepend' : 'replace-or-append'),
        );
        if (e.change === 'deleted') {
          this.completedOutputs.update((list) =>
            list.filter((o) => o.rootTaskId !== e.task.id),
          );
        } else if (e.task.status === 'DONE') {
          void this.reloadOutputs();
        }
      }),
    );
    sub.add(
      mine(this.socket.on('task:output-ready')).subscribe((e) => {
        this.completedOutputs.update((list) => [
          e.output,
          ...list.filter((o) => o.rootTaskId !== e.output.rootTaskId),
        ]);
      }),
    );
    sub.add(
      mine(this.socket.on('review:item')).subscribe((e) => {
        this.reviewItems.update((list) =>
          upsertById(list, e.item, e.change === 'created' ? 'prepend' : 'replace-or-append'),
        );
      }),
    );
    sub.add(
      mine(this.socket.on('review:verdict')).subscribe((e) => {
        this.reviewItems.update((list) =>
          list.map((item) =>
            item.id === e.reviewItemId ? { ...item, status: e.status, updatedAt: e.at } : item,
          ),
        );
      }),
    );
    sub.add(
      this.socket.onReconnect$.subscribe(async () => {
        if (!this.activeStudioId) return;
        await this.socket
          .emitWithAck('studio:join', { studioId: this.activeStudioId })
          .catch(() => undefined);
        await this.hydrate(this.activeStudioId);
      }),
    );
    return sub;
  }

  private patchAgent(key: AgentKey, patch: Partial<AgentDto>): void {
    this.agentsByKey.update((m) => {
      const cur = m.get(key);
      if (!cur) return m;
      const next = new Map(m);
      next.set(key, { ...cur, ...patch });
      return next;
    });
  }

  private byGame<T>(items: T[], gameOf: (t: T) => string | null): T[] {
    const id = this.selectedGameId();
    return id === 'all' ? items : items.filter((t) => gameOf(t) === id);
  }

  deactivate(): void {
    this.subscriptions?.unsubscribe();
    this.subscriptions = null;
    if (this.activeStudioId) {
      void this.socket
        .emitWithAck('studio:leave', { studioId: this.activeStudioId })
        .catch(() => undefined);
    }
    this.activeStudioId = null;
    this.loadState.set('idle');
  }

  private readStorage(key: string): string | null {
    try {
      return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
    } catch {
      // ignore storage errors
    }
  }
}
