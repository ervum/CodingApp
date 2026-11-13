import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { AGENT_BY_KEY, type ReviewItemDto } from '@robdev/shared';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { AgentAvatarComponent } from '../../shared/ui/agent-avatar/agent-avatar.component';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';

@Component({
  selector: 'rd-review-card',
  standalone: true,
  imports: [AgentAvatarComponent, StatusPillComponent],
  templateUrl: './review-card.component.html',
  styleUrl: './review-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewCardComponent {
  readonly store = inject(StudioStoreService);
  readonly item = input.required<ReviewItemDto>();
  readonly selected = input(false);
  readonly open = output<string>();

  readonly isSquare = computed(() => this.item().kind === 'ICON');
  readonly isStage = computed(() => this.item().tab === 'STAGES_PUBLISH');

  readonly agentInfo = computed(() => {
    const key = this.item().madeByAgentKey ?? 'splash';
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
}
