import { describe, expect, it } from 'vitest';
import { normalizeVaultPath, parseWikilinks } from './wikilinks.js';

describe('wikilinks', () => {
  it('parses target, heading, and alias while ignoring fenced/inline code', () => {
    const md = [
      'See [[05 UI and HUD]] and [[08 Mobile#Safe zones|mobile safe zones]].',
      'Inline `[[Ignored Inline]]` and fenced:',
      '```markdown',
      '[[Ignored Fence]]',
      '```',
    ].join('\n');

    const links = parseWikilinks(md);
    expect(links).toEqual([
      { raw: '[[05 UI and HUD]]', target: '05 UI and HUD', heading: null, alias: null },
      {
        raw: '[[08 Mobile#Safe zones|mobile safe zones]]',
        target: '08 Mobile',
        heading: 'Safe zones',
        alias: 'mobile safe zones',
      },
    ]);
  });

  it('normalizes both folder-note targets and explicit subpath targets', () => {
    expect(normalizeVaultPath('05 UI and HUD')).toBe('05 UI and HUD/05 UI and HUD.md');
    expect(normalizeVaultPath('08 Mobile/Safe Zones')).toBe('08 Mobile/Safe Zones.md');
    expect(normalizeVaultPath('/08 Mobile\\Safe Zones.md')).toBe('08 Mobile/Safe Zones.md');
  });
});
