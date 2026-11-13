import { describe, expect, it } from 'vitest';
import { CompactNumberPipe } from './compact-number.pipe';

describe('CompactNumberPipe', () => {
  const pipe = new CompactNumberPipe();

  it('handles null, undefined, NaN, and sub-thousand numbers', () => {
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined)).toBe('—');
    expect(pipe.transform(Number.NaN)).toBe('—');
    expect(pipe.transform(0)).toBe('0');
    expect(pipe.transform(999)).toBe('999');
  });

  it('formats thousands, millions, and billions with compact suffixes', () => {
    expect(pipe.transform(6400)).toBe('6.4K');
    expect(pipe.transform(142800)).toBe('143K');
    expect(pipe.transform(2500000)).toBe('2.5M');
    expect(pipe.transform(1200000000)).toBe('1.2B');
  });
});
