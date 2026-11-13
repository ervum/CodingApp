import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { GameDto } from '@robdev/shared';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'rd-game-progress-card',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './game-progress-card.component.html',
  styleUrl: './game-progress-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GameProgressCardComponent {
  readonly store = inject(StudioStoreService);
  readonly game = input.required<GameDto>();
  readonly play = output<GameDto>();

  readonly studioSlug = computed(() => this.store.studio()?.slug ?? 'inclined-games');

  readonly savedVersion = computed(() => this.game().latestSavedVersion ?? 1);

  readonly summaryText = computed(() => {
    const g = this.game();
    if (g.currentStage) return g.currentStage;
    if (g.milestonesTotal > 0) {
      return `${g.milestonesDone} of ${g.milestonesTotal} milestones complete (${g.progressPct}%)`;
    }
    return `Status: ${g.status}`;
  });
}
