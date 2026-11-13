import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { StudioStoreService } from '../../core/state/studio-store.service';

@Component({
  selector: 'rd-game-filter-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './game-filter-tabs.component.html',
  styleUrl: './game-filter-tabs.component.scss',
})
export class GameFilterTabsComponent {
  readonly store = inject(StudioStoreService);

  selectGame(id: string | 'all'): void {
    this.store.selectGame(id);
  }
}
