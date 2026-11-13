import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AGENT_ROSTER, type AgentDto, type AgentKey } from '@robdev/shared';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentListItemComponent } from './agent-list-item.component';

@Component({
  selector: 'rd-agent-list',
  standalone: true,
  imports: [AgentListItemComponent],
  templateUrl: './agent-list.component.html',
  styleUrl: './agent-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentListComponent {
  readonly store = inject(StudioStoreService);
  readonly selected = input<AgentKey | null>(null);
  readonly select = output<AgentKey>();

  readonly agents = computed<AgentDto[]>(() => {
    const live = this.store.agents();
    if (live.length > 0) return live;
    return AGENT_ROSTER.map((r) => ({
      id: r.key,
      key: r.key,
      name: r.name,
      title: r.title,
      color: r.color,
      glyph: r.glyph,
      order: r.order,
      status: 'IDLE' as const,
      isEnabled: true,
      currentTaskId: null,
      currentTaskTitle: null,
      currentRunId: null,
      currentGameId: null,
      lastActivityAt: null,
      lastSnippet: r.title,
      modelLabel: null,
      lastErrorCode: null,
    }));
  });
}
