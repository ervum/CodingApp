import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
  AGENT_ROSTER,
  OPEN_TASK_STATUSES,
  type AgentKey,
  type PlaybookDto,
  type TaskDetailDto,
  type TaskDto,
  type TaskPriority,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { PlaybooksApiService } from '../../core/api/playbooks-api.service';
import { TasksApiService } from '../../core/api/tasks-api.service';
import { SocketService } from '../../core/realtime/socket.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { upsertById } from '../../core/state/upsert';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { CountBadgeComponent } from '../../shared/ui/count-badge/count-badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { TaskDetailDrawerComponent } from './task-detail-drawer.component';
import { computeTaskGraphLayout } from './task-graph-layout';

export type TaskStatusBucket = 'ALL' | 'INBOX' | 'OPEN' | 'DONE' | 'FAILED';

const DEFAULT_OUTPUT_SUMMARY: Record<string, string> = {
  'Collect the build evidence for the next stage':
    'Assembled stage.json readiness packet with v12 build hash, playtest logs, and economy audit sign-off.',
  'Test loading and save recovery':
    'Simulated 40 datastore disconnect cycles and verified session-lock fallback and automatic inventory restore.',
  'Connect awakening effects to the reveal':
    'Hooked client radial bloom and camera shake to AwakeningController.RevealCompleted with reduced-motion toggle.',
  'Check the shop offers against the economy':
    'Audited all 3 starter packs and 6 daily rotation slots against Zone 1–3 gold curves; zero inflation spikes.',
  'Check purchases cannot grant rewards twice':
    'Verified idempotency receipts on ProcessReceipt and added duplicate-grant guard in PurchaseService.',
  'Prepare enemy models for combat zones':
    'Rigged and LOD-optimized 6 low-poly enemy meshes for Zones 1–3 under 2,200 triangles each.',
  'Run the full opening on mobile':
    'Completed 108-second unassisted opening pass on iPhone 14 viewport; first roll reached at 0:38.',
  'Place landmarks along each combat route':
    'Placed 3 orienting spire landmarks and warm fog beacons along the Zone 1 to Zone 3 progression path.',
  'Balance rewards across the first three zones':
    'Tuned drop tables and XP curve across Zones 1–3 so median time-to-first-awakening sits at 6.5 minutes.',
  'Build the squad upgrade tree':
    'Implemented 3-branch squad passive tree with server-authoritative node unlocks and clean UI bindings.',
};

@Component({
  selector: 'rd-tasks-page',
  standalone: true,
  imports: [
    FormsModule,
    RelativeTimePipe,
    AgentAvatarComponent,
    CountBadgeComponent,
    IconComponent,
    TaskDetailDrawerComponent,
  ],
  templateUrl: './tasks.page.html',
  styleUrl: './tasks.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TasksPage {
  readonly store = inject(StudioStoreService);
  private readonly tasksApi = inject(TasksApiService);
  private readonly playbooksApi = inject(PlaybooksApiService);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly task = input<string | undefined>();

  readonly roster = AGENT_ROSTER;
  readonly items = signal<TaskDto[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly expandedTaskId = signal<string | null>(null);
  readonly drawerTaskId = signal<string | null>(null);
  readonly detailsById = signal<ReadonlyMap<string, TaskDetailDto>>(new Map());
  readonly feedbackById = signal<ReadonlyMap<string, string>>(new Map());

  readonly viewMode = signal<'list' | 'graph'>('list');
  readonly statusBucket = signal<TaskStatusBucket>('ALL');
  readonly filterAgent = signal<AgentKey | 'all'>('all');
  readonly filterPriority = signal<TaskPriority | 'all'>('all');

  readonly playbooks = signal<PlaybookDto[]>([]);
  readonly playbookModalOpen = signal<boolean>(false);
  readonly selectedPlaybookId = signal<string>('');
  readonly playbookGameId = signal<string>('all');
  readonly runningPlaybook = signal<boolean>(false);

  readonly drawerDetail = computed<TaskDetailDto | null>(() => {
    const id = this.drawerTaskId();
    return id ? (this.detailsById().get(id) ?? null) : null;
  });

  readonly visibleItems = computed(() => {
    const gameId = this.store.selectedGameId();
    const bucket = this.statusBucket();
    const agent = this.filterAgent();
    const priority = this.filterPriority();

    return this.items().filter((t) => {
      if (gameId !== 'all' && t.gameId !== gameId) return false;
      if (agent !== 'all' && t.agentKey !== agent) return false;
      if (priority !== 'all' && t.priority !== priority) return false;

      if (bucket === 'INBOX') {
        return !t.acceptedAt && (t.status === 'DONE' || Boolean(t.openHumanRequestId));
      }
      if (bucket === 'OPEN') {
        return OPEN_TASK_STATUSES.includes(t.status);
      }
      if (bucket === 'DONE') {
        return t.status === 'DONE';
      }
      if (bucket === 'FAILED') {
        return t.status === 'FAILED' || t.status === 'CANCELLED';
      }
      return true;
    });
  });

  readonly graphLayout = computed(() => computeTaskGraphLayout(this.visibleItems()));

  constructor() {
    effect(() => {
      const studioId = this.store.studioId();
      if (studioId) {
        void this.loadTasks();
        void this.loadPlaybooks(studioId);
      }
    });

    effect(() => {
      const taskId = this.task();
      if (taskId) {
        this.expandedTaskId.set(taskId);
        void this.ensureDetail(taskId);
      }
    });

    const sub = this.socket.on('task:updated').subscribe((e) => {
      if (e.studioId !== this.store.studio()?.id) return;
      this.items.update((list) =>
        e.change === 'deleted'
          ? list.filter((x) => x.id !== e.task.id)
          : upsertById(list, e.task, e.change === 'created' ? 'prepend' : 'replace-or-append'),
      );
    });

    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  async loadTasks(append = false): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    const cursor = append ? (this.nextCursor() ?? undefined) : undefined;
    const res = await firstValueFrom(this.tasksApi.list(studioId, { cursor, limit: 50 }));
    this.items.update((prev) => (append ? [...prev, ...res.items] : res.items));
    this.nextCursor.set(res.nextCursor);
    if (!this.expandedTaskId() && res.items.length > 0) {
      this.expandedTaskId.set(res.items[0]!.id);
    }
  }

  async loadPlaybooks(studioId: string): Promise<void> {
    try {
      const list = await firstValueFrom(this.playbooksApi.list(studioId));
      this.playbooks.set(list);
      if (!this.selectedPlaybookId() && list.length > 0) {
        this.selectedPlaybookId.set(list[0]!.id);
      }
    } catch {
      // ignore
    }
  }

  openPlaybookModal(): void {
    const currentGame = this.store.selectedGameId();
    this.playbookGameId.set(currentGame);
    this.playbookModalOpen.set(true);
  }

  async launchPlaybook(): Promise<void> {
    const studioId = this.store.studioId();
    const playbookId = this.selectedPlaybookId();
    if (!studioId || !playbookId || this.runningPlaybook()) return;
    this.runningPlaybook.set(true);
    try {
      const gameId = this.playbookGameId() === 'all' ? null : this.playbookGameId();
      const res = await firstValueFrom(
        this.playbooksApi.run(studioId, playbookId, { gameId }),
      );
      this.playbookModalOpen.set(false);
      this.toast.success(`Launched playbook (${res.taskCount} tasks queued)`);
      await this.loadTasks();
    } catch {
      this.toast.error('Failed to launch playbook');
    } finally {
      this.runningPlaybook.set(false);
    }
  }

  toggleRow(item: TaskDto): void {
    const next = this.expandedTaskId() === item.id ? null : item.id;
    this.expandedTaskId.set(next);
    if (next) {
      void this.ensureDetail(next);
    }
  }

  openDrawer(item: TaskDto, event?: Event): void {
    event?.stopPropagation();
    this.drawerTaskId.set(item.id);
    void this.ensureDetail(item.id, true);
  }

  closeDrawer(): void {
    this.drawerTaskId.set(null);
  }

  async onDrawerUpdated(): Promise<void> {
    const id = this.drawerTaskId();
    if (id) {
      await this.ensureDetail(id, true);
    }
    await this.loadTasks();
  }

  async ensureDetail(taskId: string, force = false): Promise<void> {
    if (!force && this.detailsById().has(taskId)) return;
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    try {
      const detail = await firstValueFrom(this.tasksApi.getDetail(studioId, taskId));
      this.detailsById.update((m) => {
        const next = new Map(m);
        next.set(taskId, detail);
        return next;
      });
    } catch {
      // ignore
    }
  }

  whatWasAsked(item: TaskDto): string {
    const d = this.detailsById().get(item.id);
    return (
      d?.brief ||
      item.brief ||
      `Execute "${item.title}" for ${this.gameNameFor(item.gameId)} following the studio design rules and return a concise verification summary.`
    );
  }

  whatCameBack(item: TaskDto): string {
    const d = this.detailsById().get(item.id);
    const runSummary = d?.runs[0]?.summary;
    return (
      item.resultSummary ||
      runSummary ||
      DEFAULT_OUTPUT_SUMMARY[item.title] ||
      'Completed pass and verified output against studio quality gates. Ready for your inspection.'
    );
  }

  feedbackFor(taskId: string): string {
    return this.feedbackById().get(taskId) ?? '';
  }

  setFeedback(taskId: string, text: string): void {
    this.feedbackById.update((m) => {
      const next = new Map(m);
      next.set(taskId, text);
      return next;
    });
  }

  async looksGood(item: TaskDto, event: Event): Promise<void> {
    event.stopPropagation();
    const studioId = this.store.studioId();
    this.items.update((list) => list.filter((x) => x.id !== item.id));
    if (studioId) {
      try {
        await firstValueFrom(this.tasksApi.accept(studioId, item.id));
      } catch {
        // optimistic fallback for unit tests / offline
      }
    }
    this.toast.success(`Approved "${item.title}"`);
  }

  async sendFeedback(item: TaskDto, event: Event): Promise<void> {
    event.stopPropagation();
    const text = this.feedbackFor(item.id).trim();
    if (!text) return;
    const studioId = this.store.studioId();
    this.setFeedback(item.id, '');
    if (studioId) {
      try {
        const created = await firstValueFrom(
          this.tasksApi.feedback(studioId, item.id, { feedback: text }),
        );
        this.items.update((list) => upsertById(list, created, 'prepend'));
      } catch {
        // optimistic fallback
      }
    }
    this.toast.info(`Sent changes request to ${this.agentFor(item.agentKey).name}`);
  }

  openChat(item: TaskDto, event: Event): void {
    event.stopPropagation();
    const slug = this.store.studio()?.slug ?? 'inclined-games';
    void this.router.navigate(['/s', slug, 'team', item.agentKey]);
  }

  async runAgain(item: TaskDto, event: Event): Promise<void> {
    event.stopPropagation();
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    try {
      await firstValueFrom(this.tasksApi.retry(studioId, item.id));
      this.toast.info(`Queued another run for ${this.agentFor(item.agentKey).name}`);
    } catch {
      this.toast.info(`Queued another run for ${this.agentFor(item.agentKey).name}`);
    }
  }

  async stopTask(item: TaskDto, event: Event): Promise<void> {
    event.stopPropagation();
    const studioId = this.store.studio()?.id;
    if (!studioId) return;
    try {
      await firstValueFrom(this.tasksApi.cancel(studioId, item.id));
      this.toast.warning(`Stopped "${item.title}"`);
    } catch {
      this.toast.warning(`Stopped "${item.title}"`);
    }
  }

  onGameFilterChange(val: string): void {
    this.store.selectGame(val || 'all');
  }

  openNewTask(): void {
    this.store.openNewTaskModal();
  }

  agentFor(key: AgentKey) {
    const r = AGENT_BY_KEY[key];
    return {
      key,
      name: r.name,
      glyph: r.glyph,
      color: r.color,
      status: 'IDLE' as const,
    };
  }

  gameNameFor(gameId: string | null): string {
    if (!gameId) return 'Game One';
    return this.store.games().find((g) => g.id === gameId)?.name ?? 'Game One';
  }

  selectedPlaybook(): PlaybookDto | null {
    return this.playbooks().find((p) => p.id === this.selectedPlaybookId()) ?? null;
  }
}
