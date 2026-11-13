import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AGENT_BY_KEY,
  OPEN_TASK_STATUSES,
  type TaskDetailDto,
  type TaskPriority,
} from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { TasksApiService } from '../../core/api/tasks-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { MarkdownViewComponent } from '../../shared/ui/markdown-view/markdown-view.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-task-detail-drawer',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    RelativeTimePipe,
    AgentAvatarComponent,
    IconComponent,
    MarkdownViewComponent,
    StatusPillComponent,
  ],
  templateUrl: './task-detail-drawer.component.html',
  styleUrl: './task-detail-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaskDetailDrawerComponent {
  readonly store = inject(StudioStoreService);
  private readonly tasksApi = inject(TasksApiService);
  private readonly toast = inject(ToastService);

  readonly detail = input.required<TaskDetailDto>();
  readonly close = output<void>();
  readonly updated = output<void>();

  readonly editing = signal(false);
  readonly editTitle = signal('');
  readonly editBrief = signal('');
  readonly editPriority = signal<TaskPriority>('NORMAL');
  readonly busy = signal(false);

  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');

  readonly agentInfo = computed(() => {
    const key = this.detail().agentKey;
    const live = this.store.agent(key)();
    if (live) return live;
    const r = AGENT_BY_KEY[key];
    return {
      name: r.name,
      glyph: r.glyph,
      color: r.color,
      status: 'IDLE' as const,
    };
  });

  readonly canCancel = computed(() =>
    OPEN_TASK_STATUSES.includes(this.detail().status),
  );

  readonly canRetry = computed(
    () =>
      this.detail().status === 'FAILED' ||
      this.detail().status === 'CANCELLED' ||
      this.detail().status === 'BLOCKED',
  );

  constructor() {
    effect(() => {
      const d = this.detail();
      this.editTitle.set(d.title);
      this.editBrief.set(d.brief);
      this.editPriority.set(d.priority);
      this.editing.set(false);
    });
  }

  async saveEdit(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.tasksApi.update(studioId, this.detail().id, {
          title: this.editTitle().trim(),
          brief: this.editBrief().trim(),
          priority: this.editPriority(),
        }),
      );
      this.editing.set(false);
      this.toast.success('Task updated');
      this.updated.emit();
    } finally {
      this.busy.set(false);
    }
  }

  async cancelTask(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.tasksApi.cancel(studioId, this.detail().id));
      this.toast.warning('Task cancelled');
      this.updated.emit();
    } finally {
      this.busy.set(false);
    }
  }

  async retryTask(): Promise<void> {
    const studioId = this.store.studio()?.id;
    if (!studioId || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.tasksApi.retry(studioId, this.detail().id));
      this.toast.success('Task re-queued');
      this.updated.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
