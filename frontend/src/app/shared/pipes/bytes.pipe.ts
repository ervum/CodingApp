import { Pipe, type PipeTransform } from '@angular/core';

@Pipe({
  name: 'bytes',
  standalone: true,
})
export class BytesPipe implements PipeTransform {
  transform(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
      return '—';
    }
    if (value < 1024) {
      return `${Math.round(value)} B`;
    }
    const kb = value / 1024;
    if (kb < 1024) {
      return `${Math.round(kb)} KB`;
    }
    const mb = kb / 1024;
    return `${mb.toFixed(1).replace(/\.0$/, '')} MB`;
  }
}
