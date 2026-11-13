import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { CountBadgeComponent } from '../count-badge/count-badge.component';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

@Component({
  selector: 'rd-tabs',
  standalone: true,
  imports: [CountBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tabs.component.html',
  styleUrl: './tabs.component.scss',
})
export class TabsComponent<T extends string = string> {
  readonly tabs = input.required<TabItem<T>[]>();
  readonly active = model.required<T>();

  select(id: T): void {
    this.active.set(id);
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    const items = this.tabs();
    if (items.length === 0) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = items[(index + 1) % items.length];
      if (next) this.active.set(next.id);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev = items[(index - 1 + items.length) % items.length];
      if (prev) this.active.set(prev.id);
    }
  }
}
