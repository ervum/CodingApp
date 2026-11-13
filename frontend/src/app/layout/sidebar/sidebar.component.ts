import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { IconComponent } from '../../shared/ui/icon/icon.component';
import { KbdComponent } from '../../shared/ui/kbd/kbd.component';
import { AgentMatrixComponent } from './agent-matrix.component';
import { ExecutionWidgetComponent } from './execution-widget.component';
import { NavLinkComponent } from './nav-link.component';
import { StudioSwitcherComponent } from './studio-switcher.component';

@Component({
  selector: 'rd-sidebar',
  standalone: true,
  imports: [
    StudioSwitcherComponent,
    NavLinkComponent,
    AgentMatrixComponent,
    ExecutionWidgetComponent,
    IconComponent,
    KbdComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  readonly store = inject(StudioStoreService);
  readonly openPalette = output<void>();
  readonly navigate = output<void>();

  readonly slug = computed(() => this.store.studio()?.slug ?? 'inclined-games');
  readonly badges = this.store.navBadges;
}
