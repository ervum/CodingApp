import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'rd-spinner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './spinner.component.scss',
  template: `
    <span
      class="spinner"
      [style.width.px]="size()"
      [style.height.px]="size()"
      role="status"
      aria-label="Loading"
    ></span>
  `,
})
export class SpinnerComponent {
  readonly size = input<number>(16);
}
