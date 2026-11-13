import { normalizeVaultPath, parseWikilinks } from '@robdev/shared';

export interface VaultDocIndexEntry {
  id: string;
  path: string;
  title: string;
}

export interface ResolvedVaultLink {
  targetPath: string;
  toDocumentId: string | null;
}

/**
 * Extracts unique wikilinks from a document's markdown and resolves each against the studio's
 * document index (exact normalized path first, then case-insensitive title match).
 */
export function extractAndResolveVaultLinks(
  markdown: string,
  documents: readonly VaultDocIndexEntry[],
): ResolvedVaultLink[] {
  const byPath = new Map<string, VaultDocIndexEntry>();
  const byTitleLower = new Map<string, VaultDocIndexEntry>();

  for (const doc of documents) {
    byPath.set(doc.path, doc);
    const key = doc.title.toLowerCase();
    if (!byTitleLower.has(key)) {
      byTitleLower.set(key, doc);
    }
  }

  const seenTargetPaths = new Set<string>();
  const out: ResolvedVaultLink[] = [];

  for (const link of parseWikilinks(markdown)) {
    const normalizedPath = normalizeVaultPath(link.target);
    if (seenTargetPaths.has(normalizedPath)) {
      continue;
    }
    seenTargetPaths.add(normalizedPath);

    const resolved =
      byPath.get(normalizedPath) ??
      byTitleLower.get(link.target.trim().toLowerCase()) ??
      null;

    out.push({
      targetPath: normalizedPath,
      toDocumentId: resolved ? resolved.id : null,
    });
  }

  return out;
}
