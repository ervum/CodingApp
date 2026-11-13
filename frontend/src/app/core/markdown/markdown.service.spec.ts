import { describe, expect, it } from 'vitest';
import {
  MarkdownService,
  convertMarkdownToPlainText,
  extractReferencedFilesFromMarkdown,
} from './markdown.service';

describe('MarkdownService', () => {
  const service = new MarkdownService();

  it('sanitizes XSS payloads (<script>, onerror, javascript: URIs, arbitrary style)', () => {
    const dirty = [
      'Hello <script>alert(1)</script>',
      '<img src="x" onerror="alert(2)">',
      '[bad](javascript:alert(3))',
      '<span style="position:fixed;inset:0;background:red">evil</span>',
    ].join('\n\n');

    const html = service.render(dirty);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('position:fixed');
  });

  it('resolves [[Wikilinks]] to .rd-wikilink and missing targets to .rd-wikilink--missing', () => {
    const html = service.render('See [[05 UI and HUD|UI Spec]] and [[99 Missing Doc]].', {
      studioSlug: 'inclined-games',
      resolveLink: (target) => (target === '05 UI and HUD' ? 'doc-05' : null),
    });

    expect(html).toContain('class="rd-wikilink"');
    expect(html).toContain('data-wikilink="05 UI and HUD"');
    expect(html).toContain('href="/s/inclined-games/library?doc=doc-05"');
    expect(html).toContain('>UI Spec</a>');
    expect(html).toContain('class="rd-wikilink rd-wikilink--missing"');
    expect(html).toContain('data-wikilink="99 Missing Doc"');
  });

  it('renders ```ascii blocks with .rd-ascii and ```luau blocks with syntax tokens', () => {
    const md = ['```ascii', '+---+', '| X |', '+---+', '```', '', '```luau', 'local x = 42', '```'].join(
      '\n',
    );
    const html = service.render(md);

    expect(html).toContain('<pre class="rd-ascii" data-lang="ascii">');
    expect(html).toContain('<pre data-lang="luau">');
    expect(html).toContain('<span class="tok-kw">local</span>');
    expect(html).toContain('<span class="tok-num">42</span>');
  });

  it('auto-closes unterminated code fences when streaming is true', () => {
    const partial = 'Streaming code:\n```luau\nlocal hp = 100';
    const html = service.render(partial, { streaming: true });

    expect(html).toContain('<pre data-lang="luau">');
    expect(html).toContain('<span class="tok-kw">local</span>');
    expect(html).toContain('<span class="tok-num">100</span>');
  });

  it('injects .rd-swatch spans for rgb(R, G, B) inside table cells and preserves swatch style', () => {
    const tableMd = [
      '| Semantic | RGB |',
      '| --- | --- |',
      '| Buy / Confirm | rgb(68, 214, 72) |',
      '| Close | rgb(235, 82, 82) |',
    ].join('\n');

    const html = service.render(tableMd);
    expect(html).toContain('<span class="rd-swatch" style="background:rgb(68,214,72)"></span>');
    expect(html).toContain('<span class="rd-swatch" style="background:rgb(235,82,82)"></span>');
  });

  it('hyperlinks file paths with data-filepath and embeds previewable files inline', () => {
    const text =
      'Captured Screenshot Artifact: Saved to C:\\Dev\\App\\workspace\\ervum-games\\Screenshots\\pc_observe_1793065564874.png (Media ID:cmvq0xygv00smfwfslxfmauz9).';
    const html = service.render(text, { studioSlug: 'ervum-games' });

    expect(html).toContain('class="rd-filepath-link"');
    expect(html).toContain(
      'data-filepath="C:\\Dev\\App\\workspace\\ervum-games\\Screenshots\\pc_observe_1793065564874.png"',
    );
    expect(html).toContain('class="rd-file-embed"');
    expect(html).toContain('class="rd-file-embed__img"');
    expect(html).toContain('/api/media/by-path?path=');

    const extracted = extractReferencedFilesFromMarkdown(text, 'ervum-games');
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.filePath).toBe(
      'C:\\Dev\\App\\workspace\\ervum-games\\Screenshots\\pc_observe_1793065564874.png',
    );
    expect(extracted[0]?.previewKind).toBe('image');
    expect(extracted[0]?.mediaId).toBe('cmvq0xygv00smfwfslxfmauz9');
  });

  it('deduplicates bare filenames against full paths and extracts filenames with spaces or #', () => {
    const text = [
      'Saved to C:\\Dev\\App\\workspace\\ervum-games\\Screenshots\\pc_observe_1793072059300.png.',
      'See `pc_observe_1793072059300.png`, `URLs.txt`, and `# CAMBIOS.txt`.',
    ].join('\n');

    const extracted = extractReferencedFilesFromMarkdown(text, 'ervum-games');
    expect(extracted.map((f) => f.filePath)).toEqual([
      'C:\\Dev\\App\\workspace\\ervum-games\\Screenshots\\pc_observe_1793072059300.png',
      'URLs.txt',
      '# CAMBIOS.txt',
    ]);
  });

  it('converts markdown to clean plain text while preserving code blocks, lists, and wikilink labels', () => {
    const md = [
      '# Release Plan',
      '',
      'Use **bold** and *italic* with `inlineCode()` and [[05 UI and HUD|UI Spec]].',
      'Check [Roblox Docs](https://create.roblox.com).',
      '',
      '- First item',
      '- Second item',
      '',
      '```luau',
      'local speed = 32',
      '```',
    ].join('\n');

    const plain = convertMarkdownToPlainText(md);
    expect(plain).toContain('Release Plan');
    expect(plain).toContain('Use bold and italic with inlineCode() and UI Spec.');
    expect(plain).toContain('Check Roblox Docs (https://create.roblox.com).');
    expect(plain).toContain('• First item');
    expect(plain).toContain('local speed = 32');
    expect(plain).not.toContain('**bold**');
    expect(plain).not.toContain('```');
    expect(service.markdownToPlainText(md)).toBe(plain);
  });
});
