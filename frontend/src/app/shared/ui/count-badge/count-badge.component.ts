import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'rd-count-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './count-badge.component.scss',
  host: {
    '[attr.data-tone]': 'tone()',
  },
  template: `
    @if (count() > 0) {
      <span class="badge">{{ formatted() }}</span>
    }
  `,
})
export class CountBadgeComponent {
  readonly count = input.required<number>();
  readonly tone = input<'neutral' | 'accent' | 'warning'>('neutral');
  readonly formatted = computed(() => (this.count() > 99 ? '99+' : String(this.count())));
}
