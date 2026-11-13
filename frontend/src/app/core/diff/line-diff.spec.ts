import { describe, expect, it } from 'vitest';
import { computeLineDiff } from './line-diff';

describe('computeLineDiff', () => {
  it('returns all same lines when texts match', () => {
    const res = computeLineDiff('alpha\nbeta', 'alpha\nbeta');
    expect(res).toEqual([
      { kind: 'same', oldLineNum: 1, newLineNum: 1, text: 'alpha' },
      { kind: 'same', oldLineNum: 2, newLineNum: 2, text: 'beta' },
    ]);
  });

  it('computes additions and deletions across modified lines', () => {
    const res = computeLineDiff('a\nb\nc', 'a\nx\nc\nd');
    expect(res.filter((l) => l.kind === 'del').map((l) => l.text)).toEqual(['b']);
    expect(res.filter((l) => l.kind === 'add').map((l) => l.text)).toEqual(['x', 'd']);
    expect(res.filter((l) => l.kind === 'same').map((l) => l.text)).toEqual(['a', 'c']);
  });
});
