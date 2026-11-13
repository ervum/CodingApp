import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';

export interface HotkeyOptions {
  scope?: string;
  when?: () => boolean;
  allowInInput?: boolean;
}

interface RegisteredHotkey {
  combo: string;
  handler: (event: KeyboardEvent) => void;
  options: HotkeyOptions;
}

function isTypingElement(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower === 'escape') return 'esc';
  return lower;
}

@Injectable({ providedIn: 'root' })
export class HotkeysService {
  private readonly doc = inject(DOCUMENT);
  private readonly bindings: RegisteredHotkey[] = [];
  private pendingChordPrefix: string | null = null;
  private chordTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.doc.addEventListener('keydown', (event: KeyboardEvent) => this.handleKeydown(event));
  }

  /**
   * Registers a keyboard shortcut.
   * Examples of `combo`:
   *   - `'mod+k'` (Ctrl+K or Cmd+K)
   *   - `'mod+s'`
   *   - `'mod+enter'`
   *   - `'esc'`
   *   - `'n'`
   *   - `'g h'` (sequence: G then H within 1000ms)
   */
  register(
    combo: string,
    handler: (event: KeyboardEvent) => void,
    options: HotkeyOptions = {},
  ): () => void {
    const entry: RegisteredHotkey = {
      combo: combo.trim().toLowerCase(),
      handler,
      options,
    };
    this.bindings.push(entry);
    return () => {
      const idx = this.bindings.indexOf(entry);
      if (idx >= 0) this.bindings.splice(idx, 1);
    };
  }

  private handleKeydown(event: KeyboardEvent): void {
    const typing = isTypingElement(this.doc.activeElement);
    const key = normalizeKey(event.key);
    const hasMod = event.ctrlKey || event.metaKey;

    // 1. Check modifier combos first (e.g. mod+k, mod+s, mod+enter)
    if (hasMod) {
      this.clearChord();
      const modCombo = `mod+${key}`;
      for (const b of [...this.bindings]) {
        if (b.combo !== modCombo) continue;
        if (typing && !b.options.allowInInput && key !== 'k' && key !== 's' && key !== 'enter') {
          continue;
        }
        if (b.options.when && !b.options.when()) continue;
        event.preventDefault();
        b.handler(event);
        return;
      }
      return;
    }

    if (event.altKey) return;

    // 2. Check active 2-key sequence (e.g. 'g h')
    if (this.pendingChordPrefix && !typing) {
      const seqCombo = `${this.pendingChordPrefix} ${key}`;
      this.clearChord();
      for (const b of [...this.bindings]) {
        if (b.combo !== seqCombo) continue;
        if (b.options.when && !b.options.when()) continue;
        event.preventDefault();
        b.handler(event);
        return;
      }
    }

    // 3. Check if this key starts a 2-key sequence when not typing
    if (!typing && key.length === 1) {
      const startsSequence = this.bindings.some((b) => b.combo.startsWith(`${key} `));
      if (startsSequence) {
        this.pendingChordPrefix = key;
        if (this.chordTimer) clearTimeout(this.chordTimer);
        this.chordTimer = setTimeout(() => {
          this.pendingChordPrefix = null;
          this.chordTimer = null;
        }, 1000);
        return;
      }
    }

    // 4. Single-key bindings (e.g. 'esc', 'n', 'a', 'c', 'x', 'j', 'k')
    for (const b of [...this.bindings]) {
      if (b.combo !== key) continue;
      if (typing && !b.options.allowInInput && key !== 'esc') continue;
      if (b.options.when && !b.options.when()) continue;
      event.preventDefault();
      b.handler(event);
      return;
    }
  }

  private clearChord(): void {
    this.pendingChordPrefix = null;
    if (this.chordTimer) {
      clearTimeout(this.chordTimer);
      this.chordTimer = null;
    }
  }
}
