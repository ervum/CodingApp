import {
  ChangeDetectionStrategy,
  Component,
  input,
  model,
  output,
} from '@angular/core';
import type { MarketRowDto } from '@robdev/shared';
import { CompactNumberPipe } from '../../shared/pipes/compact-number.pipe';
import { DeltaComponent } from '../../shared/ui/delta/delta.component';
import { SparklineComponent } from '../../shared/ui/sparkline/sparkline.component';
import type { MarketColumn } from './market.store';

@Component({
  selector: 'rd-market-table',
  standalone: true,
  imports: [CompactNumberPipe, DeltaComponent, SparklineComponent],
  templateUrl: './market-table.component.html',
  styleUrl: './market-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketTableComponent {
  readonly rows = input.required<MarketRowDto[]>();
  readonly sortColumn = model<MarketColumn>('rank');
  readonly sortDir = model<'asc' | 'desc'>('asc');

  readonly openGame = output<MarketRowDto>();

  toggleSort(col: MarketColumn): void {
    if (this.sortColumn() === col) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(col);
      this.sortDir.set(col === 'rank' || col === 'name' || col === 'genre' ? 'asc' : 'desc');
    }
  }

  ariaSort(col: MarketColumn): 'ascending' | 'descending' | null {
    if (this.sortColumn() !== col) return null;
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  initialsFor(name: string): string {
    const words = name
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0);
    if (words.length === 0) return 'RB';
    if (words.length === 1) return (words[0] ?? 'RB').slice(0, 2).toUpperCase();
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }

  likeTone(ratio: number | null): 'pos' | 'warn' | 'flat' {
    if (ratio === null) return 'flat';
    if (ratio >= 0.85) return 'pos';
    if (ratio < 0.7) return 'warn';
    return 'flat';
  }

  likePct(ratio: number | null): string {
    if (ratio === null) return '—';
    return `${Math.round(ratio * 100)}%`;
  }
}
