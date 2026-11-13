export interface DiffLine {
  readonly kind: 'same' | 'add' | 'del';
  readonly oldLineNum: number | null;
  readonly newLineNum: number | null;
  readonly text: string;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.replace(/\r\n/g, '\n').split('\n');
  const b = newText.replace(/\r\n/g, '\n').split('\n');
  const m = a.length;
  const n = b.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = 1 + (dp[i + 1]?.[j + 1] ?? 0);
      } else {
        dp[i]![j] = Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0);
      }
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({
        kind: 'same',
        oldLineNum: i + 1,
        newLineNum: j + 1,
        text: a[i] ?? '',
      });
      i += 1;
      j += 1;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      out.push({
        kind: 'del',
        oldLineNum: i + 1,
        newLineNum: null,
        text: a[i] ?? '',
      });
      i += 1;
    } else {
      out.push({
        kind: 'add',
        oldLineNum: null,
        newLineNum: j + 1,
        text: b[j] ?? '',
      });
      j += 1;
    }
  }
  while (i < m) {
    out.push({
      kind: 'del',
      oldLineNum: i + 1,
      newLineNum: null,
      text: a[i] ?? '',
    });
    i += 1;
  }
  while (j < n) {
    out.push({
      kind: 'add',
      oldLineNum: null,
      newLineNum: j + 1,
      text: b[j] ?? '',
    });
    j += 1;
  }
  return out;
}
