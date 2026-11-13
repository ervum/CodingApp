import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import type { MarketIngestionRunDto, MarketLeaderboardDto } from '@robdev/shared';
import { RelativeTimePipe } from '../../shared/pipes/relative-time.pipe';
import { IconComponent } from '../../shared/ui/icon/icon.component';

@Component({
  selector: 'rd-ingestion-status',
  standalone: true,
  imports: [RelativeTimePipe, IconComponent],
  templateUrl: './ingestion-status.component.html',
  styleUrl: './ingestion-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IngestionStatusComponent {
  readonly board = input.required<MarketLeaderboardDto>();
  readonly runs = input<MarketIngestionRunDto[]>([]);
  readonly canRefresh = input(false);
  readonly refreshing = input(false);

  readonly refresh = output<void>();

  readonly latestRun = computed(() => this.runs()[0] ?? null);

  readonly isLiveHealthy = computed(
    () => this.board().source === 'LIVE' && !this.board().isStale && !this.board().lastError,
  );

  readonly isSeed = computed(() => this.board().source === 'SEED' && !this.board().lastError);

  readonly showWarningBanner = computed(
    () => this.board().isStale || Boolean(this.board().lastError),
  );
}
