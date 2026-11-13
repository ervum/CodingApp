import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'rd-accordion',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './accordion.component.html',
  styleUrl: './accordion.component.scss',
})
export class AccordionComponent {
  readonly title = input.required<string>();
  readonly open = model<boolean>(false);
  readonly badge = input<string>();

  onToggle(event: Event): void {
    const details = event.currentTarget as HTMLDetailsElement;
    this.open.set(details.open);
  }
}
