import { Pipe, type PipeTransform, inject } from '@angular/core';
import { ClockService } from '../../core/time/clock.service';

@Pipe({
  name: 'relativeTime',
  standalone: true,
})
export class RelativeTimePipe implements PipeTransform {
  private readonly clock = inject(ClockService, { optional: true });

  transform(value: string | Date | null | undefined, now?: Date | number): string {
    if (!value) return '—';
    const target = typeof value === 'string' ? new Date(value) : value;
    const targetMs = target.getTime();
    if (Number.isNaN(targetMs)) return '—';

    const clockVal = this.clock?.now();
    const nowMs =
      now !== undefined
        ? typeof now === 'number'
          ? now
          : now.getTime()
        : clockVal instanceof Date
          ? clockVal.getTime()
          : typeof clockVal === 'number'
            ? clockVal
            : Date.now();

    const diffSec = Math.max(0, Math.floor((nowMs - targetMs) / 1000));
    if (diffSec < 45) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo ago`;
  }
}
