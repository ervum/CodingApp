import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'rd-progress-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './progress-bar.component.scss',
  host: {
    '[style.--game-accent]': 'accent() || null',
  },
  template: `
    <div
      class="progress"
      role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      [attr.aria-valuenow]="clamped()"
    >
      <div class="progress__fill" [style.width.%]="clamped()"></div>
    </div>
  `,
})
export class ProgressBarComponent {
  readonly value = input.required<number>();
  readonly accent = input<string>();
  readonly clamped = computed(() => Math.max(0, Math.min(100, Math.round(this.value()))));
}
