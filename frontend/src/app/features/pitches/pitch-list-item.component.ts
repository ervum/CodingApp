import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import type { PitchDto } from '@robdev/shared';
import { StatusPillComponent } from '../../shared/ui/status-pill/status-pill.component';

@Component({
  selector: 'rd-pitch-list-item',
  standalone: true,
  imports: [StatusPillComponent],
  templateUrl: './pitch-list-item.component.html',
  styleUrl: './pitch-list-item.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PitchListItemComponent {
  readonly pitch = input.required<PitchDto>();
  readonly selected = input(false);
  readonly select = output<string>();

  readonly topMetrics = computed(() => this.pitch().metrics.slice(0, 2));
}
