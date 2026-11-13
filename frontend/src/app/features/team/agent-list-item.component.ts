import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { AgentDto, AgentKey } from '@robdev/shared';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';

const AGENTS_TO_CHECK = new Set<AgentKey>([
  'frame',
  'playtest',
  'tester108',
  'splash',
  'producer',
]);

@Component({
  selector: 'rd-agent-list-item',
  standalone: true,
  imports: [AgentAvatarComponent],
  templateUrl: './agent-list-item.component.html',
  styleUrl: './agent-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentListItemComponent {
  readonly agent = input.required<AgentDto>();
  readonly selected = input(false);
  readonly select = output<AgentKey>();

  readonly snippet = computed(
    () => this.agent().lastSnippet ?? this.agent().currentTaskTitle ?? this.agent().title,
  );

  readonly hasCheck = computed(
    () =>
      AGENTS_TO_CHECK.has(this.agent().key) || this.agent().status === 'WAITING_ON_HUMAN',
  );
}
