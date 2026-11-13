import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PitchMetric } from '@robdev/shared';

@Component({
  selector: 'rd-metric-callout',
  standalone: true,
  styleUrl: './metric-callout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="callout" [attr.data-tone]="metric().tone">
      <span class="callout__label">{{ metric().label }}</span>
      <span class="callout__value">{{ metric().value }}</span>
    </div>
  `,
})
export class MetricCalloutComponent {
  readonly metric = input.required<PitchMetric>();
}
