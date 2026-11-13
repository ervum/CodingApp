import { describe, expect, it } from 'vitest';
import { countChars, countWords, estimateTokens } from './text-stats.js';

describe('text-stats', () => {
  it('counts words in prose and treats fenced code tokens as words', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('Hello world — mobile-first UI!')).toBe(4);
    const md = 'One two\n```luau\nlocal x = 10\n```\nthree';
    // "One", "two", "```luau", "local", "x", "=", "10", "```", "three" -> 9 tokens
    expect(countWords(md)).toBe(9);
  });

  it('counts Unicode code points rather than UTF-16 surrogates', () => {
    expect(countChars('abc')).toBe(3);
    expect(countChars('🎲🪙💎')).toBe(3);
  });

  it('estimates tokens as ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('1234')).toBe(1);
    expect(estimateTokens('12345')).toBe(2);
  });
});
