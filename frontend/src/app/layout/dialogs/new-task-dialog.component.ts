import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AGENT_BY_KEY, AGENT_ROSTER, type AgentKey, type TaskPriority } from '@robdev/shared';
import { firstValueFrom } from 'rxjs';
import { TasksApiService } from '../../core/api/tasks-api.service';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { DialogComponent } from '../../shared/ui/dialog/dialog.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { ToastService } from '../../shared/ui/toast/toast.service';

@Component({
  selector: 'rd-new-task-dialog',
  standalone: true,
  imports: [FormsModule, DialogComponent, AgentAvatarComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-task-dialog.component.html',
  styleUrl: './new-task-dialog.component.scss',
})
export class NewTaskDialogComponent {
  readonly store = inject(StudioStoreService);
  private readonly tasksApi = inject(TasksApiService);
  private readonly toast = inject(ToastService);

  readonly roster = AGENT_ROSTER;
  readonly open = model<boolean>(false);

  readonly agentKey = signal<AgentKey>('lead');
  readonly title = signal('');
  readonly brief = signal('');
  readonly gameId = signal<string>('');
  readonly priority = signal<TaskPriority>('NORMAL');
  readonly tagsText = signal('');
  readonly submitting = signal(false);

  readonly selectedAgentMeta = computed(() => AGENT_BY_KEY[this.agentKey()]);

  constructor() {
    effect(() => {
      if (this.open()) {
        this.agentKey.set(this.store.newTaskDefaultAgent() || 'lead');
        this.title.set('');
        this.brief.set('');
        const sel = this.store.selectedGameId();
        const firstGameId = this.store.games()[0]?.id ?? '';
        this.gameId.set(sel === 'all' ? firstGameId : sel);
        this.priority.set('NORMAL');
        this.tagsText.set('');
      }
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void this.submit();
    }
  }

  async submit(): Promise<void> {
    const studio = this.store.studio();
    const briefVal = this.brief().trim();
    if (!studio || briefVal.length < 3 || this.submitting()) return;

    const titleVal =
      this.title().trim() ||
      (briefVal.length > 52 ? `${briefVal.slice(0, 52)}...` : briefVal);

    this.submitting.set(true);
    try {
      const tags = this.tagsText()
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .slice(0, 8);

      const agentKey = this.agentKey();
      await firstValueFrom(
        this.tasksApi.create(studio.id, {
          agentKey,
          title: titleVal,
          brief: briefVal,
          gameId: this.gameId() || null,
          priority: this.priority(),
          tags,
        }),
      );
      this.open.set(false);
      this.toast.success(`Task queued for ${AGENT_BY_KEY[agentKey].name}`);
    } finally {
      this.submitting.set(false);
    }
  }
}
