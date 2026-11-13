// wikilinks.ts — Obsidian syntax: [[Target]], [[Target|Alias]], [[Target#Heading]]
export interface ParsedWikilink { raw: string; target: string; heading: string | null; alias: string | null; }
const WIKILINK = /\[\[([^\]|#\n]+)(?:#([^\]|\n]+))?(?:\|([^\]\n]+))?\]\]/g;
export function parseWikilinks(markdown: string): ParsedWikilink[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const out: ParsedWikilink[] = [];
  for (const m of withoutCode.matchAll(WIKILINK)) {
    out.push({ raw: m[0], target: m[1]!.trim(), heading: m[2]?.trim() ?? null, alias: m[3]?.trim() ?? null });
  }
  return out;
}
/** Resolve "[[05 UI and HUD]]" → "05 UI and HUD/05 UI and HUD.md"; "[[08 Mobile/Safe Zones]]" → "08 Mobile/Safe Zones.md". */
export function normalizeVaultPath(target: string): string {
  const t = target.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.md$/i, '');
  return t.includes('/') ? `${t}.md` : `${t}/${t}.md`;
}
