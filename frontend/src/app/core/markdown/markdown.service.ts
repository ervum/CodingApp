import { Injectable } from '@angular/core';
import { estimateTokens } from '@robdev/shared';
import DOMPurify from 'dompurify';
import { Marked, type TokenizerAndRendererExtension } from 'marked';
import { LuauHighlighter } from './luau-highlighter';

export interface MarkdownRenderOptions {
  streaming?: boolean;
  studioSlug?: string;
  resolveLink?: (target: string) => string | null;
  renderCodeAsArtifact?: boolean;
}

export interface ExtractedInlineArtifact {
  readonly index: number;
  readonly path: string;
  readonly headingTitle: string | null;
  readonly language: string;
  readonly content: string;
  readonly bytes: number;
  readonly tokens: number;
}

export interface ExtractedReferencedFile {
  readonly filePath: string;
  readonly fileName: string;
  readonly extension: string;
  readonly language: string;
  readonly previewKind: 'image' | 'video' | 'audio' | 'code' | null;
  readonly previewUrl: string;
  readonly mediaId: string | null;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a']);
const CODE_EXT_TO_LANG: Readonly<Record<string, string>> = {
  py: 'python',
  luau: 'luau',
  lua: 'lua',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  md: 'markdown',
  txt: 'text',
  html: 'html',
  css: 'css',
  scss: 'scss',
  xml: 'xml',
  rbxlx: 'xml',
  rbxmx: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  ps1: 'powershell',
  sh: 'bash',
  sql: 'sql',
  csv: 'text',
  rs: 'rust',
  go: 'go',
  cpp: 'cpp',
  c: 'c',
  cs: 'csharp',
};

export function classifyFilePath(
  rawPath: string,
  studioSlug = 'inclined-games',
  mediaId: string | null = null,
): ExtractedReferencedFile | null {
  let cleaned = (rawPath ?? '').trim().replace(/^["'`]+|["'`]+$/g, '');
  if (/^file:\/\//i.test(cleaned)) {
    try {
      cleaned = decodeURIComponent(cleaned.replace(/^file:\/\/\/?/i, ''));
    } catch {
      cleaned = cleaned.replace(/^file:\/\/\/?/i, '');
    }
  }
  cleaned = cleaned.replace(/[.,;:!?]+$/, '');
  if (!cleaned) return null;

  const isWinDrive = /^[A-Za-z]:[\\/]/.test(cleaned);
  const hasSlash = /[\\/]/.test(cleaned);
  const fileName = cleaned.split(/[\\/]/).pop() ?? cleaned;
  const extMatch = /\.([A-Za-z0-9]{1,8})$/.exec(fileName);
  const ext = extMatch?.[1]?.toLowerCase() ?? '';

  const isKnownPreviewExt =
    IMAGE_EXTS.has(ext) ||
    VIDEO_EXTS.has(ext) ||
    AUDIO_EXTS.has(ext) ||
    ext in CODE_EXT_TO_LANG;

  if (!isWinDrive && !(hasSlash && ext) && !isKnownPreviewExt) {
    return null;
  }
  if (!isWinDrive && !hasSlash && !/^[A-Za-z0-9_.# -]+\.[A-Za-z0-9]{1,8}$/.test(cleaned)) {
    return null;
  }

  let previewKind: 'image' | 'video' | 'audio' | 'code' | null = null;
  let language = ext || 'file';
  if (IMAGE_EXTS.has(ext)) {
    previewKind = 'image';
    language = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  } else if (VIDEO_EXTS.has(ext)) {
    previewKind = 'video';
    language = `video/${ext}`;
  } else if (AUDIO_EXTS.has(ext)) {
    previewKind = 'audio';
    language = `audio/${ext}`;
  } else if (ext in CODE_EXT_TO_LANG) {
    previewKind = 'code';
    language = CODE_EXT_TO_LANG[ext] ?? 'text';
  }

  const previewUrl = `/api/media/by-path?path=${encodeURIComponent(cleaned)}&studioSlug=${encodeURIComponent(studioSlug)}`;

  return {
    filePath: cleaned,
    fileName,
    extension: ext,
    language,
    previewKind,
    previewUrl,
    mediaId,
  };
}

const FILE_PATH_IN_TEXT_RE =
  /(?:[A-Za-z]:[\\/](?:[^\s<>:"|?*`()[\]]+)|(?:\.{0,2}[\\/])?(?:workspace|Screenshots|Build|ServerScriptService|ReplicatedStorage|StarterPlayer|StarterGui|Workspace|ServerStorage|SoundService|Lighting)[\\/][^\s<>:"|?*`()[\]]+\.[A-Za-z0-9]{1,8})/g;

export function extractReferencedFilesFromMarkdown(
  markdown: string,
  studioSlug = 'inclined-games',
): ExtractedReferencedFile[] {
  if (!markdown || !markdown.trim()) return [];

  // Strip fenced code blocks before scanning prose for file paths
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, '');
  const mediaIdMatch = /\bMedia\s*ID\s*:\s*([A-Za-z0-9_-]{8,64})/i.exec(withoutFences);
  const fallbackMediaId = mediaIdMatch?.[1] ?? null;

  const seenPaths = new Set<string>();
  const byFileName = new Map<string, number>();
  const results: ExtractedReferencedFile[] = [];

  const recordCandidate = (rawCandidate: string, nearbyText?: string): void => {
    const trimmed = rawCandidate.replace(/[.,;:!?]+$/, '').trim();
    if (!trimmed || /^https?:\/\//i.test(trimmed)) return;
    const localMediaMatch = nearbyText
      ? /\bMedia\s*ID\s*:\s*([A-Za-z0-9_-]{8,64})/i.exec(nearbyText)
      : null;
    const info = classifyFilePath(
      trimmed,
      studioSlug,
      localMediaMatch?.[1] ?? fallbackMediaId,
    );
    if (!info) return;
    const pathKey = info.filePath.toLowerCase().replace(/\//g, '\\');
    if (seenPaths.has(pathKey)) return;
    seenPaths.add(pathKey);

    const nameKey = info.fileName.toLowerCase();
    const existingIdx = byFileName.get(nameKey);
    if (existingIdx !== undefined) {
      const existing = results[existingIdx]!;
      const newHasDir = /[\\/]/.test(info.filePath);
      const existingHasDir = /[\\/]/.test(existing.filePath);
      if (newHasDir && !existingHasDir) {
        results[existingIdx] = info;
      }
      return;
    }

    byFileName.set(nameKey, results.length);
    results.push(info);
  };

  // 1. Markdown links to file:// or Windows paths
  const mdLinkRe = /\[([^\]]+)\]\((file:\/\/\/?[^)\s]+|[A-Za-z]:[\\/][^)\s]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = mdLinkRe.exec(withoutFences)) !== null) {
    recordCandidate(m[2] ?? '', withoutFences.slice(m.index, m.index + 240));
  }

  // 2. Bare Windows/workspace paths in prose
  FILE_PATH_IN_TEXT_RE.lastIndex = 0;
  while ((m = FILE_PATH_IN_TEXT_RE.exec(withoutFences)) !== null) {
    recordCandidate(m[0], withoutFences.slice(m.index, m.index + 240));
  }

  // 3. Inline backtick code spans containing a file path
  const inlineCodeRe = /`([^`\n]{3,260})`/g;
  while ((m = inlineCodeRe.exec(withoutFences)) !== null) {
    const inner = (m[1] ?? '').trim();
    if (
      /^[A-Za-z]:[\\/]/.test(inner) ||
      /^[A-Za-z0-9_./\\# -]+\.[A-Za-z0-9]{1,8}$/.test(inner)
    ) {
      recordCandidate(inner, withoutFences.slice(m.index, m.index + 240));
    }
  }

  return results;
}

const LANG_EXT_MAP: Record<string, string> = {
  python: 'py',
  py: 'py',
  luau: 'luau',
  lua: 'lua',
  typescript: 'ts',
  ts: 'ts',
  javascript: 'js',
  js: 'js',
  json: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  bash: 'sh',
  sh: 'sh',
  shell: 'sh',
  powershell: 'ps1',
  rust: 'rs',
  go: 'go',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  csharp: 'cs',
  'c#': 'cs',
  yaml: 'yaml',
  yml: 'yml',
  xml: 'xml',
  markdown: 'md',
  md: 'md',
};

export function defaultFilenameForArtifact(
  fileTitle: string,
  lang: string,
  index: number,
): string {
  const cleanTitle = fileTitle.trim();
  if (cleanTitle && /\.[A-Za-z0-9]+$/.test(cleanTitle)) {
    return cleanTitle;
  }
  const ext = LANG_EXT_MAP[lang.trim().toLowerCase()] ?? 'txt';
  return `artifact-${index}.${ext}`;
}

export function extractMarkdownArtifactsAndProse(markdown: string): {
  artifacts: ExtractedInlineArtifact[];
  proseTokens: number;
  artifactsTokens: number;
} {
  if (!markdown || !markdown.trim()) {
    return { artifacts: [], proseTokens: 0, artifactsTokens: 0 };
  }
  const repaired = repairLegacyAiStudioMarkdown(markdown);
  const closed = closeUnterminatedFence(repaired);

  const artifacts: ExtractedInlineArtifact[] = [];
  let idx = 0;

  const fenceRe =
    /(?:(#{1,6}\s+[^\n]+)\n+)?```([^\n]*)\n([\s\S]*?)```/g;
  const proseOnly = closed.replace(
    fenceRe,
    (full, headingLine: string | undefined, infoRaw: string, bodyRaw: string) => {
      const [rawLangPart = '', rawTitlePart = ''] = (infoRaw ?? '').trim().split('|');
      const normalizedLang = rawLangPart.trim().toLowerCase();
      if (normalizedLang === 'ascii') {
        return full;
      }
      idx += 1;
      const displayLang = rawLangPart.trim() || 'text';
      const fileTitle = rawTitlePart.trim();
      const path = defaultFilenameForArtifact(fileTitle, displayLang, idx);
      const headingTitle = headingLine
        ? headingLine.replace(/^#{1,6}\s+/, '').trim()
        : null;
      const content = (bodyRaw ?? '').replace(/^\n+|\n+$/g, '');
      const bytes = new TextEncoder().encode(content).length;
      const tokens = estimateTokens(content);
      artifacts.push({
        index: idx,
        path,
        headingTitle,
        language: displayLang,
        content,
        bytes,
        tokens,
      });
      return headingLine ? `${headingLine}\n` : '';
    },
  );

  const proseTokens = estimateTokens(proseOnly.trim());
  const artifactsTokens = artifacts.reduce((sum, a) => sum + a.tokens, 0);
  return { artifacts, proseTokens, artifactsTokens };
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function repairLegacyAiStudioMarkdown(markdown: string): string {
  let out = markdown;

  // 1. Repair legacy flattened AI Studio code blocks (`Heading (file.py)\ncode\nPython\ndownload\ncontent_copy\nexpand_less\n...`)
  const legacyBlockRe =
    /(?:^|\n)(?:#{1,6}\s+)?([^\n`]*?)\n+code\s*\n+([A-Za-z0-9_+#-]+)\s*\n+download\s*\n+content_copy\s*\n+expand_(?:less|more)\s*\n+([\s\S]*?)(?=\n+(?:(?:#{1,6}\s+)?[^\n`]*?\n+code\s*\n+[A-Za-z0-9_+#-]+\s*\n+download\s*\n+content_copy|\*\(Note:|#{1,6}\s|$))/gi;

  out = out.replace(
    legacyBlockRe,
    (_full, rawHeading: string, rawLang: string, rawCode: string) => {
      const headingTrim = (rawHeading ?? '').trim();
      const langTrim = (rawLang ?? 'text').trim();
      const codeTrim = (rawCode ?? '').replace(/^\n+|\n+$/g, '');
      let cleanHeading = headingTrim;
      let fileLabel = '';
      const fileMatch = /^(.*?)\s*\(`?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`?\)\s*$/.exec(
        headingTrim,
      );
      if (fileMatch) {
        cleanHeading = (fileMatch[1] ?? '').trim();
        fileLabel = (fileMatch[2] ?? '').trim();
      }
      const fenceInfo = fileLabel ? `${langTrim}|${fileLabel}` : langTrim;
      const headingBlock = cleanHeading ? `\n\n### ${cleanHeading}\n\n` : '\n\n';
      return `${headingBlock}\`\`\`${fenceInfo}\n${codeTrim}\n\`\`\`\n\n`;
    },
  );

  // 2. Also strip any standalone `code <Lang> download content_copy expand_less` header lines if no heading preceded them
  out = out.replace(
    /(?:^|\n)code\s*\n+([A-Za-z0-9_+#-]+)\s*\n+download\s*\n+content_copy\s*\n+expand_(?:less|more)\s*\n+([\s\S]*?)(?=\n+(?:code\s*\n+[A-Za-z0-9_+#-]+\s*\n+download|\*\(Note:|#{1,6}\s|$))/gi,
    (_full, rawLang: string, rawCode: string) => {
      const langTrim = (rawLang ?? 'text').trim();
      const codeTrim = (rawCode ?? '').replace(/^\n+|\n+$/g, '');
      return `\n\n\`\`\`${langTrim}\n${codeTrim}\n\`\`\`\n\n`;
    },
  );

  // 3. If a markdown heading has a parenthetical filename immediately before a fenced code block, e.g.:
  // `### Minimal Script (`hello_bye.py`)\n\n```python` -> `### Minimal Script\n\n```python|hello_bye.py`
  out = out.replace(
    /(#{1,6}\s+[^\n]*?)\s*\(`?([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)`?\)[ \t]*\n+```([A-Za-z0-9_+#-]*)[ \t]*\n/g,
    (_full, headingPrefix: string, fileName: string, fenceLang: string) => {
      const lang = (fenceLang || 'text').trim();
      return `${headingPrefix.trim()}\n\n\`\`\`${lang}|${fileName.trim()}\n`;
    },
  );

  return out;
}

function closeUnterminatedFence(markdown: string): string {
  const matches = markdown.match(/^```/gm);
  if (matches && matches.length % 2 === 1) {
    return `${markdown}\n\`\`\``;
  }
  return markdown;
}

function injectRgbSwatchesInTables(html: string): string {
  return html.replace(
    /(<td\b[^>]*>[\s\S]*?<\/td>)/gi,
    (cellHtml) =>
      cellHtml.replace(/\brgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/gi, (full, rStr, gStr, bStr) => {
        const r = Number(rStr);
        const g = Number(gStr);
        const b = Number(bStr);
        if (r < 0 || r > 255 || g < 0 || g > 255 || b < 0 || b > 255) {
          return full;
        }
        return `<span class="rd-swatch" style="background:rgb(${r},${g},${b})"></span>${full}`;
      }),
  );
}

function injectFilePathLinksInHtml(html: string, studioSlug: string): string {
  // Tokenize HTML into protected blocks (<pre>...</pre>, <code>...</code>, <a>...</a>, or any HTML tag <...>) vs plain text
  const tokenRe =
    /(<pre\b[^>]*>[\s\S]*?<\/pre>|<code\b[^>]*>[\s\S]*?<\/code>|<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>)/gi;
  const parts = html.split(tokenRe);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (!part || part.startsWith('<')) continue;
    FILE_PATH_IN_TEXT_RE.lastIndex = 0;
    parts[i] = part.replace(FILE_PATH_IN_TEXT_RE, (fullMatch) => {
      const trailingMatch = /([.,;:!?]+)$/.exec(fullMatch);
      const trailing = trailingMatch?.[1] ?? '';
      const core = trailing ? fullMatch.slice(0, -trailing.length) : fullMatch;
      const info = classifyFilePath(core, studioSlug);
      if (!info) return fullMatch;
      const escapedPath = escapeHtml(info.filePath);
      return `<a class="rd-filepath-link" href="#" data-filepath="${escapedPath}" title="Click to choose which app opens ${escapedPath}">${escapeHtml(core)}</a>${trailing}`;
    });
  }
  return parts.join('');
}

function buildPreviewEmbedsHtml(
  referencedFiles: readonly ExtractedReferencedFile[],
  inlineArtifactPaths: ReadonlySet<string>,
): string {
  if (referencedFiles.length === 0) return '';
  const blocks: string[] = [];

  for (const file of referencedFiles) {
    if (!file.previewKind) continue;
    const baseLower = file.fileName.toLowerCase();
    const fullLower = file.filePath.toLowerCase().replace(/\\/g, '/');
    if (
      file.previewKind === 'code' &&
      (inlineArtifactPaths.has(baseLower) || inlineArtifactPaths.has(fullLower))
    ) {
      continue;
    }

    const escapedPath = escapeHtml(file.filePath);
    const escapedName = escapeHtml(file.fileName);
    const escapedUrl = escapeHtml(file.previewUrl);

    if (file.previewKind === 'image') {
      blocks.push(
        `<div class="rd-file-embed"><div class="rd-file-embed__header"><span class="rd-file-embed__badge">IMAGE ARTIFACT</span><a class="rd-filepath-link rd-file-embed__path" href="#" data-filepath="${escapedPath}" title="Click to choose which app opens ${escapedPath}">${escapedPath}</a><button type="button" class="rd-file-embed__btn" data-filepath="${escapedPath}" title="Choose an application to open this file">Open with…</button></div><div class="rd-file-embed__body"><img class="rd-file-embed__img" src="${escapedUrl}" alt="${escapedName}" loading="lazy" /></div></div>`,
      );
    } else if (file.previewKind === 'video') {
      blocks.push(
        `<div class="rd-file-embed"><div class="rd-file-embed__header"><span class="rd-file-embed__badge">VIDEO ARTIFACT</span><a class="rd-filepath-link rd-file-embed__path" href="#" data-filepath="${escapedPath}" title="Click to choose which app opens ${escapedPath}">${escapedPath}</a><button type="button" class="rd-file-embed__btn" data-filepath="${escapedPath}" title="Choose an application to open this file">Open with…</button></div><div class="rd-file-embed__body"><video class="rd-file-embed__video" controls preload="metadata" src="${escapedUrl}"></video></div></div>`,
      );
    } else if (file.previewKind === 'audio') {
      blocks.push(
        `<div class="rd-file-embed"><div class="rd-file-embed__header"><span class="rd-file-embed__badge">AUDIO ARTIFACT</span><a class="rd-filepath-link rd-file-embed__path" href="#" data-filepath="${escapedPath}" title="Click to choose which app opens ${escapedPath}">${escapedPath}</a><button type="button" class="rd-file-embed__btn" data-filepath="${escapedPath}" title="Choose an application to open this file">Open with…</button></div><div class="rd-file-embed__body"><audio class="rd-file-embed__audio" controls preload="metadata" src="${escapedUrl}"></audio></div></div>`,
      );
    } else if (file.previewKind === 'code') {
      const escapedLang = escapeHtml(file.language);
      blocks.push(
        `<details class="rd-file-embed rd-file-embed--code" data-embed-code-path="${escapedPath}" data-embed-code-lang="${escapedLang}" open><summary class="rd-file-embed__header"><span class="rd-file-embed__badge">FILE ARTIFACT</span><a class="rd-filepath-link rd-file-embed__path" href="#" data-filepath="${escapedPath}" title="Click to choose which app opens ${escapedPath}">${escapedPath}</a><button type="button" class="rd-file-embed__btn" data-filepath="${escapedPath}" title="Choose an application to open this file">Open with…</button></summary><pre class="rd-file-embed__code" data-lang="${escapedLang}"><code>Loading file preview…</code></pre></details>`,
      );
    }
  }

  return blocks.join('\n');
}

export function convertMarkdownToPlainText(markdown: string): string {
  if (!markdown) return '';
  let text = markdown.replace(/\r\n/g, '\n');

  // Preserve inner code of fenced code blocks
  text = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, code: string) => {
    return `${code.replace(/^\n+|\n+$/g, '')}\n`;
  });

  // Images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');

  // Markdown links: [label](url) -> label (url) or label if internal/file
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const cleanLabel = label.trim();
    const cleanUrl = url.trim();
    if (!cleanUrl || cleanUrl.startsWith('#') || cleanUrl.startsWith('file:') || cleanLabel === cleanUrl) {
      return cleanLabel;
    }
    return `${cleanLabel} (${cleanUrl})`;
  });

  // Wikilinks: [[target|alias]] -> alias, [[target]] -> target
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');

  // Inline code: `code` -> code
  text = text.replace(/`([^`\n]+)`/g, '$1');

  // Bold & italic
  text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '$1');
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1');
  text = text.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1');
  text = text.replace(/~~([^~]+)~~/g, '$1');

  // Headings: ### Title -> Title
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');

  // Blockquotes: > quote -> quote
  text = text.replace(/^\s{0,3}>\s?/gm, '');

  // Unordered list bullets: - item / * item -> • item
  text = text.replace(/^(\s*)[-*+]\s+/gm, '$1• ');

  // Horizontal rules
  text = text.replace(/^\s*(?:[-*_]\s*){3,}$/gm, '');

  // Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private hookInstalled = false;

  render(markdown: string, options: MarkdownRenderOptions = {}): string {
    this.ensureDomPurifyHook();

    const repaired = repairLegacyAiStudioMarkdown(markdown);
    const source = options.streaming ? closeUnterminatedFence(repaired) : repaired;
    const resolveLink = options.resolveLink;
    const studioSlug = options.studioSlug ?? 'inclined-games';
    const renderCodeAsArtifact = Boolean(options.renderCodeAsArtifact);
    let artifactIndex = 0;

    const wikilinkExtension: TokenizerAndRendererExtension = {
      name: 'wikilink',
      level: 'inline',
      start(src: string) {
        return src.indexOf('[[');
      },
      tokenizer(src: string) {
        const match = /^\[\[([^[\]|#]+?)(?:#[^[\]|]+)?(?:\|([^[\]]+))?\]\]/.exec(src);
        if (!match) return undefined;
        const target = (match[1] ?? '').trim();
        const alias = match[2] !== undefined ? match[2].trim() : null;
        if (!target) return undefined;
        return {
          type: 'wikilink',
          raw: match[0],
          target,
          alias,
        };
      },
      renderer(token) {
        const target = String((token as { target?: string }).target ?? '');
        const alias = (token as { alias?: string | null }).alias ?? null;
        const label = escapeHtml(alias && alias.length > 0 ? alias : target);
        const escapedTarget = escapeHtml(target);
        const docId = resolveLink ? resolveLink(target) : null;
        if (docId) {
          const href = `/s/${encodeURIComponent(studioSlug)}/library?doc=${encodeURIComponent(docId)}`;
          return `<a class="rd-wikilink" data-wikilink="${escapedTarget}" href="${href}">${label}</a>`;
        }
        return `<a class="rd-wikilink rd-wikilink--missing" data-wikilink="${escapedTarget}" href="#">${label}</a>`;
      },
    };

    const inlineArtifactPaths = new Set<string>();
    const markedInstance = new Marked({ gfm: true, breaks: false });
    markedInstance.use({
      extensions: [wikilinkExtension],
      renderer: {
        codespan({ text }): string {
          const info = classifyFilePath(text, studioSlug);
          if (info) {
            const escapedPath = escapeHtml(info.filePath);
            return `<a class="rd-filepath-link rd-filepath-link--code" href="#" data-filepath="${escapedPath}" title="Click to choose which app opens ${escapedPath}"><code>${escapeHtml(text)}</code></a>`;
          }
          return `<code>${escapeHtml(text)}</code>`;
        },
        link({ href, text }): string | false {
          const rawHref = (href ?? '').trim();
          if (/^file:\/\//i.test(rawHref) || /^[A-Za-z]:[\\/]/.test(rawHref)) {
            const info = classifyFilePath(rawHref, studioSlug);
            if (info) {
              const escapedPath = escapeHtml(info.filePath);
              return `<a class="rd-filepath-link" href="#" data-filepath="${escapedPath}" title="Click to choose which app opens ${escapedPath}">${escapeHtml(text)}</a>`;
            }
          }
          return false;
        },
        code({ text, lang }): string {
          const rawInfo = (lang ?? '').trim();
          const [rawLangPart = '', rawTitlePart = ''] = rawInfo.split('|');
          const normalizedLang = rawLangPart.trim().toLowerCase();
          const fileTitle = rawTitlePart.trim();

          if (fileTitle) {
            inlineArtifactPaths.add(fileTitle.toLowerCase().replace(/\\/g, '/'));
            const base = fileTitle.split(/[\\/]/).pop();
            if (base) inlineArtifactPaths.add(base.toLowerCase());
          }

          if (normalizedLang === 'ascii') {
            return `<pre class="rd-ascii" data-lang="ascii"><code>${escapeHtml(text)}</code></pre>`;
          }

          const highlighted = LuauHighlighter.highlight(text, normalizedLang);

          if (renderCodeAsArtifact) {
            artifactIndex += 1;
            const displayLang = rawLangPart.trim() || 'text';
            const pathLabel = fileTitle || displayLang;
            const downloadFilename = defaultFilenameForArtifact(
              fileTitle,
              displayLang,
              artifactIndex,
            );
            const byteCount = new TextEncoder().encode(text).length;
            const metaText = fileTitle
              ? `${displayLang} · ${byteCount} B`
              : `${byteCount} B`;
            const dataLangAttr = normalizedLang
              ? ` data-lang="${escapeHtml(normalizedLang)}"`
              : '';
            const pathHtml = fileTitle
              ? `<a class="rd-filepath-link rd-code-artifact__path" href="#" data-filepath="${escapeHtml(fileTitle)}" title="Click to choose which app opens ${escapeHtml(fileTitle)}">${escapeHtml(pathLabel)}</a>`
              : `<span class="rd-code-artifact__path">${escapeHtml(pathLabel)}</span>`;
            const openWithBtnHtml = fileTitle
              ? `<button type="button" class="rd-code-artifact__btn" data-filepath="${escapeHtml(fileTitle)}" title="Choose an application to open this file">Open with…</button>`
              : '';
            return `<details class="rd-code-artifact" open><summary class="rd-code-artifact__header"><span class="rd-code-artifact__badge">ARTIFACT N°${artifactIndex}</span>${pathHtml}<span class="rd-code-artifact__meta">${escapeHtml(metaText)}</span><span class="rd-code-artifact__actions">${openWithBtnHtml}<button type="button" class="rd-code-artifact__btn" data-artifact-action="copy" data-artifact-filename="${escapeHtml(downloadFilename)}" title="Copy raw code">Copy raw</button><button type="button" class="rd-code-artifact__btn" data-artifact-action="download" data-artifact-filename="${escapeHtml(downloadFilename)}" title="Download artifact file">Download</button></span></summary><pre class="rd-code-artifact__code"${dataLangAttr}><code>${highlighted}</code></pre></details>`;
          }

          if (normalizedLang === 'luau' || normalizedLang === 'lua') {
            return `<pre data-lang="luau"><code>${highlighted}</code></pre>`;
          }
          const attr = normalizedLang ? ` data-lang="${escapeHtml(normalizedLang)}"` : '';
          return `<pre${attr}><code>${highlighted}</code></pre>`;
        },
      },
    });

    const rawHtml = markedInstance.parse(source, { async: false }) as string;
    const withSwatches = injectRgbSwatchesInTables(rawHtml);
    const withPathLinks = injectFilePathLinksInHtml(withSwatches, studioSlug);
    const referencedFiles = extractReferencedFilesFromMarkdown(source, studioSlug);
    const embedsHtml = buildPreviewEmbedsHtml(referencedFiles, inlineArtifactPaths);
    const combinedHtml = embedsHtml ? `${withPathLinks}\n${embedsHtml}` : withPathLinks;

    if (typeof DOMPurify?.sanitize === 'function') {
      return DOMPurify.sanitize(combinedHtml, {
        ADD_ATTR: [
          'data-wikilink',
          'data-filepath',
          'data-embed-code-path',
          'data-embed-code-lang',
          'data-lang',
          'data-artifact-action',
          'data-artifact-filename',
          'controls',
          'preload',
          'loading',
          'type',
          'title',
          'target',
          'style',
          'open',
        ],
        FORBID_TAGS: ['style', 'iframe', 'form'],
        ALLOWED_URI_REGEXP: /^(?:https?:|\/|#)/i,
      });
    }

    return this.sanitizeFallback(combinedHtml);
  }

  markdownToPlainText(markdown: string): string {
    return convertMarkdownToPlainText(markdown);
  }

  private ensureDomPurifyHook(): void {
    if (this.hookInstalled || typeof DOMPurify?.addHook !== 'function') return;
    this.hookInstalled = true;
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      if (data.attrName === 'style') {
        const isSwatch =
          typeof Element !== 'undefined' &&
          node instanceof Element &&
          node.classList.contains('rd-swatch');
        const validBg = /^background:rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(
          data.attrValue.replace(/\s+/g, ''),
        );
        if (!isSwatch || !validBg) {
          data.keepAttr = false;
        } else {
          data.attrValue = data.attrValue.replace(/\s+/g, '');
        }
      }
    });
  }

  private sanitizeFallback(html: string): string {
    return html
      .replace(/<(script|style|iframe|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<(script|style|iframe|form)\b[^>]*\/?>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, '')
      .replace(/<([a-z0-9-]+)([^>]*)>/gi, (full, tag: string, attrs: string) => {
        if (!/\bstyle\s*=/i.test(attrs)) return full;
        const isSwatch = /\bclass\s*=\s*["'][^"']*\brd-swatch\b[^"']*["']/i.test(attrs);
        const cleanedAttrs = attrs.replace(
          /\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
          (_m, dq: string | undefined, sq: string | undefined) => {
            const val = (dq ?? sq ?? '').replace(/\s+/g, '');
            if (isSwatch && /^background:rgb\(\d{1,3},\d{1,3},\d{1,3}\)$/.test(val)) {
              return ` style="${val}"`;
            }
            return '';
          },
        );
        return `<${tag}${cleanedAttrs}>`;
      });
  }
}
