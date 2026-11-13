import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'rd-sparkline',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sparkline.component.scss',
  template: `
    @if (points().length >= 2) {
      <svg
        [attr.width]="width()"
        [attr.height]="height()"
        [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
        class="sparkline"
        [class.sparkline--up]="isUp()"
        [class.sparkline--down]="!isUp()"
        aria-hidden="true"
      >
        <polyline [attr.points]="polylinePoints()" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    } @else {
      <span class="sparkline__empty">—</span>
    }
  `,
})
export class SparklineComponent {
  readonly points = input.required<number[]>();
  readonly width = input<number>(72);
  readonly height = input<number>(20);

  readonly isUp = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return true;
    return pts[pts.length - 1]! >= pts[0]!;
  });

  readonly polylinePoints = computed(() => {
    const pts = this.points();
    if (pts.length < 2) return '';
    const w = this.width();
    const h = this.height();
    const pad = 2;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const range = max - min || 1;

    return pts
      .map((val, idx) => {
        const x = pad + (idx / (pts.length - 1)) * (w - pad * 2);
        const y = h - pad - ((val - min) / range) * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });
}
