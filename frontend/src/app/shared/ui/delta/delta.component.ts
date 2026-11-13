import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'rd-delta',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './delta.component.scss',
  template: `
    @if (value() === null) {
      <span class="delta delta--flat" title="Collecting 7-day history">—</span>
    } @else {
      <span
        class="delta"
        [class.delta--pos]="value()! > 0"
        [class.delta--neg]="value()! < 0"
        [class.delta--flat]="value() === 0"
      >
        @if (value()! > 0) {
          <rd-icon name="trending-up" [size]="12" />
        } @else if (value()! < 0) {
          <rd-icon name="trending-down" [size]="12" />
        }
        <span>{{ formatted() }}</span>
      </span>
    }
  `,
})
export class DeltaComponent {
  readonly value = input.required<number | null>();

  readonly formatted = computed(() => {
    const v = this.value();
    if (v === null) return '—';
    const abs = Math.abs(v).toFixed(1).replace(/\.0$/, '');
    if (v > 0) return `+${abs}%`;
    if (v < 0) return `−${abs}%`;
    return '0%';
  });
}
