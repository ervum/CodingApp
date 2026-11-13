import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { ReviewItemDto } from '@robdev/shared';
import { CountBadgeComponent } from '../../shared/ui/count-badge/count-badge.component';
import { ReviewCardComponent } from './review-card.component';

interface ReviewGroup {
  gameName: string;
  items: ReviewItemDto[];
}

@Component({
  selector: 'rd-review-grid',
  standalone: true,
  imports: [CountBadgeComponent, ReviewCardComponent],
  templateUrl: './review-grid.component.html',
  styleUrl: './review-grid.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewGridComponent {
  readonly items = input.required<ReviewItemDto[]>();
  readonly groupByGame = input(true);
  readonly selectedId = input<string | null>(null);
  readonly open = output<string>();

  readonly isStagesTab = computed(() =>
    this.items().some((i) => i.tab === 'STAGES_PUBLISH'),
  );

  readonly groups = computed<ReviewGroup[]>(() => {
    const all = this.items();
    if (!this.groupByGame()) {
      return [{ gameName: 'All items', items: all }];
    }
    const map = new Map<string, ReviewItemDto[]>();
    for (const item of all) {
      const key = item.gameName ?? 'Unassigned';
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    const entries = [...map.entries()].sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
    return entries.map(([gameName, items]) => ({ gameName, items }));
  });
}
