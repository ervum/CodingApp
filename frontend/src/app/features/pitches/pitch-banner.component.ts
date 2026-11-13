import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'rd-pitch-banner',
  standalone: true,
  styleUrl: './pitch-banner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="banner" [attr.data-kind]="kind()">
      <h3 class="banner__title">{{ heading() }}</h3>
      <p class="banner__body">{{ text() }}</p>
    </section>
  `,
})
export class PitchBannerComponent {
  readonly kind = input.required<'changed' | 'different'>();
  readonly text = input.required<string>();

  readonly heading = computed(() =>
    this.kind() === 'changed' ? 'WHAT CHANGED' : "HOW WE'RE DIFFERENT",
  );
}
