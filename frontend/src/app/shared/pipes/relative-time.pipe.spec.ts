import { Injector, runInInjectionContext, signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { ClockService } from '../../core/time/clock.service';
import { RelativeTimePipe } from './relative-time.pipe';

describe('RelativeTimePipe', () => {
  const fixedNow = new Date('2026-04-20T12:00:00.000Z').getTime();
  const injector = Injector.create({
    providers: [
      {
        provide: ClockService,
        useValue: { now: signal(fixedNow).asReadonly() },
      },
    ],
  });

  const pipe = runInInjectionContext(injector, () => new RelativeTimePipe());

  it('formats null/undefined as em-dash and recent timestamps as "just now"', () => {
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined)).toBe('—');
    expect(pipe.transform(new Date(fixedNow - 15_000).toISOString())).toBe('just now');
  });

  it('formats minutes, hours, and days accurately', () => {
    expect(pipe.transform(new Date(fixedNow - 3 * 60_000).toISOString())).toBe('3m ago');
    expect(pipe.transform(new Date(fixedNow - 2 * 3_600_000).toISOString())).toBe('2h ago');
    expect(pipe.transform(new Date(fixedNow - 5 * 86_400_000).toISOString())).toBe('5d ago');
  });
});
