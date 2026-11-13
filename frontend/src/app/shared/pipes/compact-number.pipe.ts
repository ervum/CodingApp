import { Pipe, type PipeTransform } from '@angular/core';

@Pipe({
  name: 'compactNumber',
  standalone: true,
})
export class CompactNumberPipe implements PipeTransform {
  transform(value: number | string | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—';
    const num = typeof value === 'string' ? Number(value) : value;
    if (!Number.isFinite(num)) return '—';

    const abs = Math.abs(num);
    const sign = num < 0 ? '−' : '';

    if (abs < 1000) {
      return `${sign}${Math.round(abs)}`;
    }
    if (abs < 1_000_000) {
      const scaled = abs / 1000;
      const formatted = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
      return `${sign}${formatted}K`;
    }
    if (abs < 1_000_000_000) {
      const scaled = abs / 1_000_000;
      const formatted = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
      return `${sign}${formatted}M`;
    }
    const scaled = abs / 1_000_000_000;
    const formatted = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1).replace(/\.0$/, '');
    return `${sign}${formatted}B`;
  }
}
