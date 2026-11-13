import { describe, expect, it } from 'vitest';
import {
  budgetVaultCandidates,
  type VaultDocCandidate,
} from './vault-context.service.js';

describe('VaultContextService (budgetVaultCandidates)', () => {
  it('deduplicates by document id keeping the lowest priority number and sorts by priority then path', () => {
    const candidates: VaultDocCandidate[] = [
      {
        id: 'doc_b',
        path: '05 UI and HUD/05 UI and HUD.md',
        title: '05 UI and HUD',
        version: 2,
        markdown: 'UI rules here',
        priority: 20,
      },
      {
        id: 'doc_a',
        path: '00 For Any AI/00 For Any AI.md',
        title: '00 For Any AI',
        version: 1,
        markdown: 'Global rules',
        priority: 0,
      },
      {
        id: 'doc_b',
        path: '05 UI and HUD/05 UI and HUD.md',
        title: '05 UI and HUD',
        version: 2,
        markdown: 'UI rules here',
        priority: 5,
      },
    ];

    const res = budgetVaultCandidates(candidates, 10_000);
    expect(res.injected.map((i) => i.documentId)).toEqual(['doc_a', 'doc_b']);
    expect(res.injected.every((i) => !i.truncated)).toBe(true);
    expect(res.vaultBlock).toContain('<vault_document path="00 For Any AI/00 For Any AI.md"');
  });

  it('truncates by H2 sections when doc exceeds budget but >= 1500 tokens remain, and skips when < 1500 remain', () => {
    const sec1 = `# Title\n\nIntro paragraph.\n\n## Section One\n${'word '.repeat(600)}`;
    const sec2 = `\n## Section Two\n${'word '.repeat(2500)}`;
    const largeMarkdown = sec1 + sec2;

    const candidates: VaultDocCandidate[] = [
      {
        id: 'doc_large',
        path: '05 UI and HUD/05 UI and HUD.md',
        title: '05 UI and HUD',
        version: 3,
        markdown: largeMarkdown,
        priority: 1,
      },
      {
        id: 'doc_skipped',
        path: '12 Live Ops/12 Live Ops.md',
        title: '12 Live Ops',
        version: 1,
        markdown: 'word '.repeat(1200),
        priority: 10,
      },
    ];

    // Budget = 2000 tokens (~8000 chars): doc_large (~3900 tokens) will be truncated to Section One, leaving <1500 tokens so doc_skipped is skipped
    const res = budgetVaultCandidates(candidates, 2000);
    expect(res.injected).toHaveLength(1);
    expect(res.injected[0]?.documentId).toBe('doc_large');
    expect(res.injected[0]?.truncated).toBe(true);
    expect(res.vaultBlock).toContain(
      '[Truncated for context budget — call vault_read("05 UI and HUD/05 UI and HUD.md") for the full document.]',
    );
    expect(res.vaultBlock).toContain(
      'Other relevant docs (use vault_read): 12 Live Ops/12 Live Ops.md',
    );
  });
});
