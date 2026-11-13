import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'rd-small-preview-strip',
  standalone: true,
  templateUrl: './small-preview-strip.component.html',
  styleUrl: './small-preview-strip.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmallPreviewStripComponent {
  readonly src = input.required<string>();
  readonly aspect = input.required<'1:1' | '16:9'>();
  readonly sizes = [512, 150, 64] as const;
}
