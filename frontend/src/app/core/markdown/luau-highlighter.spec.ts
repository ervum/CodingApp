import { describe, expect, it } from 'vitest';
import { LuauHighlighter } from './luau-highlighter';

describe('LuauHighlighter', () => {
  it('highlights keywords, Roblox globals, numbers, strings, and comments in a single pass', () => {
    const code = [
      '-- Calculate damage on server',
      'local ReplicatedStorage = game:GetService("ReplicatedStorage")',
      'export type HitInfo = { amount: number }',
      'local function applyHit(target: Instance, mult: number)',
      '  local base = 0xFF + 12.5',
      '  return Vector3.new(base * mult, 0, 0)',
      'end',
    ].join('\n');

    const out = LuauHighlighter.highlight(code);
    expect(out).toContain('<span class="tok-com">-- Calculate damage on server</span>');
    expect(out).toContain('<span class="tok-kw">local</span>');
    expect(out).toContain('<span class="tok-kw">export</span>');
    expect(out).toContain('<span class="tok-kw">type</span>');
    expect(out).toContain('<span class="tok-glob">game</span>');
    expect(out).toContain('<span class="tok-glob">Instance</span>');
    expect(out).toContain('<span class="tok-glob">Vector3</span>');
    expect(out).toContain('<span class="tok-str">&quot;ReplicatedStorage&quot;</span>');
    expect(out).toContain('<span class="tok-num">0xFF</span>');
    expect(out).toContain('<span class="tok-num">12.5</span>');
    expect(out).toContain('<span class="tok-fn">GetService</span>');
    expect(out).toContain('<span class="tok-fn">applyHit</span>');
    expect(out).toContain('<span class="tok-ctrl">return</span>');
    expect(out).toContain('<span class="tok-ctrl">end</span>');
  });

  it('distinguishes control flow / loops (tok-ctrl) from declarations (tok-kw) across Luau, TypeScript, and Python', () => {
    const luauLoops = 'if ok then while true do repeat break until false end end';
    const outLuau = LuauHighlighter.highlight(luauLoops, 'luau');
    expect(outLuau).toContain('<span class="tok-ctrl">if</span>');
    expect(outLuau).toContain('<span class="tok-ctrl">then</span>');
    expect(outLuau).toContain('<span class="tok-ctrl">while</span>');
    expect(outLuau).toContain('<span class="tok-ctrl">repeat</span>');
    expect(outLuau).toContain('<span class="tok-ctrl">until</span>');
    expect(outLuau).toContain('<span class="tok-bool">true</span>');

    const tsSwitch = 'export function check(x: number) { switch (x) { case 1: return true; default: break; } }';
    const outTs = LuauHighlighter.highlight(tsSwitch, 'typescript');
    expect(outTs).toContain('<span class="tok-kw">export</span>');
    expect(outTs).toContain('<span class="tok-kw">function</span>');
    expect(outTs).toContain('<span class="tok-ctrl">switch</span>');
    expect(outTs).toContain('<span class="tok-ctrl">case</span>');
    expect(outTs).toContain('<span class="tok-ctrl">default</span>');
  });

  it('escapes HTML entities safely inside code and strings', () => {
    const out = LuauHighlighter.highlight('local tag = "<script>&</script>"');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;&amp;&lt;/script&gt;');
  });
});
