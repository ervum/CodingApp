import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { CountBadgeComponent } from '../count-badge/count-badge.component';

export interface FilterPillOption<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

@Component({
  selector: 'rd-filter-pills',
  standalone: true,
  imports: [CountBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filter-pills.component.html',
  styleUrl: './filter-pills.component.scss',
})
export class FilterPillsComponent<T extends string = string> {
  readonly options = input.required<FilterPillOption<T>[]>();
  readonly value = model.required<T>();

  select(id: T): void {
    this.value.set(id);
  }
}
