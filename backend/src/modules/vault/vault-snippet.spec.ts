import { describe, expect, it } from 'vitest';
import { buildVaultSnippet } from './vault-snippet.js';

describe('buildVaultSnippet', () => {
  it('centers snippet on exact or token match for multi-word queries', () => {
    const longDoc = `${'intro '.repeat(60)}The DataStore session lock prevents duplicate currency writes across servers.${' outro'.repeat(60)}`;
    const snippet = buildVaultSnippet(longDoc, 'session lock currency');
    expect(snippet).toContain('session lock');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('returns full text when shorter than maxLen', () => {
    expect(buildVaultSnippet('Short note about UI', 'UI')).toBe('Short note about UI');
  });
});
