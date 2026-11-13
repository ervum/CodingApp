import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CountBadgeComponent } from '../../shared/ui/count-badge/count-badge.component';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import type { IconName } from '../../shared/ui/icon/icons';

@Component({
  selector: 'rd-nav-link',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent, CountBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nav-link.component.html',
  styleUrl: './nav-link.component.scss',
})
export class NavLinkComponent {
  readonly icon = input.required<IconName>();
  readonly label = input.required<string>();
  readonly link = input.required<string[]>();
  readonly badge = input<number>(0);
  readonly badgeTone = input<'neutral' | 'accent' | 'warning'>('neutral');
}
