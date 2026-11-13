export function buildVaultSnippet(markdown: string, query: string, maxLen = 240): string {
  const clean = markdown.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) {
    return clean;
  }

  const lowerClean = clean.toLowerCase();
  const lowerQuery = query.trim().toLowerCase();
  let idx = lowerQuery ? lowerClean.indexOf(lowerQuery) : -1;

  if (idx === -1 && lowerQuery) {
    const tokens = lowerQuery
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9_-]/gi, ''))
      .filter((t) => t.length >= 2);
    for (const tok of tokens) {
      const tokIdx = lowerClean.indexOf(tok);
      if (tokIdx !== -1) {
        idx = tokIdx;
        break;
      }
    }
  }

  if (idx === -1) {
    return `${clean.slice(0, maxLen)}…`;
  }

  const halfWindow = Math.floor((maxLen - Math.min(lowerQuery.length, maxLen)) / 2);
  const start = Math.max(0, idx - halfWindow);
  const end = Math.min(clean.length, start + maxLen);
  const adjustedStart = Math.max(0, end - maxLen);

  const prefix = adjustedStart > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return `${prefix}${clean.slice(adjustedStart, end)}${suffix}`;
}
