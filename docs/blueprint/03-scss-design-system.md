# Section 3 — SCSS Design System (`/frontend/src/styles`)

**Principles:** dark obsidian surfaces, 1px hairline borders, violet primary, neon-purple glow reserved for "live" states, high data density. Everything is built on Sass maps, and the maps emit CSS custom properties (`--rd-*`) so values can be read at runtime (agent colours, themes). Components **never** hard-code hex values; they call `rd.color()`, `rd.space()` and so on.

**Module graph**
```text
styles.scss  ──@use──▶ styles/tokens (emit :root vars) · reset · typography · layout · animations · controls · markdown
styles/_rd.scss ──@forward──▶ tokens (functions + maps) · mixins          ← components: @use 'rd';
styles/_mixins.scss ──@use──▶ tokens
```

## 3.1 `_tokens.scss` (exact)
```scss
@use 'sass:map';
@use 'sass:meta';

// ── Colour palette ───────────────────────────────────────────────
$colors: (
  'bg-0': #0B0C10,            // app canvas
  'bg-1': #12131A,            // sidebar, top bar, panels
  'bg-2': #181A24,            // cards, raised surfaces
  'bg-3': #1F2230,            // inputs, hover
  'bg-4': #272B3B,            // active / pressed
  'border': #262938,
  'border-strong': #343850,
  'border-focus': #7C3AED,
  'text-1': #ECEDF3,          // primary
  'text-2': #A9ADC1,          // secondary
  'text-3': #6E7390,          // muted / placeholders
  'text-inverse': #0B0C10,
  'primary': #7C3AED,
  'primary-hover': #6D28D9,
  'primary-active': #5B21B6,
  'primary-soft': rgba(124, 58, 237, 0.16),
  'neon': #A855F7,
  'neon-soft': rgba(168, 85, 247, 0.22),
  'success': #22C55E,
  'success-soft': rgba(34, 197, 94, 0.14),
  'warning': #F59E0B,
  'warning-soft': rgba(245, 158, 11, 0.14),
  'danger': #EF4444,
  'danger-soft': rgba(239, 68, 68, 0.14),
  'info': #38BDF8,
  'info-soft': rgba(56, 189, 248, 0.14),
  'overlay': rgba(5, 6, 9, 0.64),
  'glass': rgba(24, 26, 36, 0.72),
  // Roblox UI semantic colours (vault 05 colour table) – used for previews/badges
  'rbx-green': rgb(68, 214, 72),
  'rbx-red': rgb(235, 82, 82),
  'rbx-gold': rgb(255, 206, 68),
);

// ── Status semantics (agent / task / review) ─────────────────────
// fg = text/dot colour, bg = pill fill, glow = whether the dot pulses
$status: (
  'WORKING':          (fg: #22C55E, bg: rgba(34, 197, 94, 0.14),  glow: true),
  'IDLE':             (fg: #6E7390, bg: rgba(110, 115, 144, 0.14), glow: false),
  'WAITING_ON_HUMAN': (fg: #F59E0B, bg: rgba(245, 158, 11, 0.14),  glow: false),
  'BLOCKED':          (fg: #EF4444, bg: rgba(239, 68, 68, 0.14),   glow: false),
  'PAUSED':           (fg: #A855F7, bg: rgba(168, 85, 247, 0.14),  glow: false),
  'ERROR':            (fg: #EF4444, bg: rgba(239, 68, 68, 0.14),   glow: true),
  'OFFLINE':          (fg: #4B5068, bg: transparent,               glow: false),
  'QUEUED':           (fg: #38BDF8, bg: rgba(56, 189, 248, 0.14),  glow: false),
  'RUNNING':          (fg: #22C55E, bg: rgba(34, 197, 94, 0.14),   glow: true),
  'NEEDS_HUMAN':      (fg: #F59E0B, bg: rgba(245, 158, 11, 0.14),  glow: false),
  'DONE':             (fg: #A9ADC1, bg: rgba(169, 173, 193, 0.10), glow: false),
  'FAILED':           (fg: #EF4444, bg: rgba(239, 68, 68, 0.14),   glow: false),
  'CANCELLED':        (fg: #6E7390, bg: rgba(110, 115, 144, 0.10), glow: false),
  'TO_REVIEW':        (fg: #A855F7, bg: rgba(168, 85, 247, 0.16),  glow: false),
  'CHANGES_ASKED':    (fg: #F59E0B, bg: rgba(245, 158, 11, 0.14),  glow: false),
  'APPROVED':         (fg: #22C55E, bg: rgba(34, 197, 94, 0.14),   glow: false),
  'REJECTED':         (fg: #EF4444, bg: rgba(239, 68, 68, 0.14),   glow: false),
  'FIX_FIRST':        (fg: #EF4444, bg: rgba(239, 68, 68, 0.18),   glow: false),
  'SHOULD_FIX':       (fg: #F59E0B, bg: rgba(245, 158, 11, 0.14),  glow: false),
  'NIT':              (fg: #A9ADC1, bg: rgba(169, 173, 193, 0.10), glow: false),
);

// ── Spacing (4px base) ───────────────────────────────────────────
$space: (0: 0, 0.5: 2px, 1: 4px, 1.5: 6px, 2: 8px, 2.5: 10px, 3: 12px, 4: 16px, 5: 20px, 6: 24px, 8: 32px, 10: 40px, 12: 48px, 16: 64px);

// ── Radii ────────────────────────────────────────────────────────
$radii: ('xs': 4px, 'sm': 6px, 'md': 8px, 'lg': 12px, 'xl': 16px, 'pill': 999px);

// ── Typography ───────────────────────────────────────────────────
$font-ui: 'Inter Variable', 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
$font-mono: 'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SFMono-Regular', 'Cascadia Code', Consolas, 'Liberation Mono', monospace;
$font-sizes: ('2xs': 10px, 'xs': 11px, 'sm': 12px, 'md': 13px, 'base': 14px, 'lg': 16px, 'xl': 18px, '2xl': 22px, '3xl': 28px, '4xl': 36px);
$line-heights: ('tight': 1.2, 'snug': 1.35, 'normal': 1.5, 'relaxed': 1.65);
$font-weights: ('regular': 400, 'medium': 500, 'semibold': 600, 'bold': 700);
$letter-spacing: ('caps': 0.08em, 'tight': -0.01em, 'display': -0.02em);

// ── Elevation ────────────────────────────────────────────────────
$shadows: (
  'sm': 0 1px 2px rgba(0, 0, 0, 0.4),
  'md': 0 4px 16px rgba(0, 0, 0, 0.45),
  'lg': 0 16px 48px rgba(0, 0, 0, 0.55),
  'drawer': -24px 0 64px rgba(0, 0, 0, 0.55),
  'glow-primary': (0 0 0 1px rgba(124, 58, 237, 0.5), 0 0 24px rgba(168, 85, 247, 0.35)),
  'glow-success': 0 0 8px rgba(34, 197, 94, 0.85),
  'inset-top': inset 0 1px 0 rgba(255, 255, 255, 0.04),
);

// ── Z-index scale ────────────────────────────────────────────────
$z: ('base': 0, 'raised': 1, 'sticky': 10, 'sidebar': 20, 'topbar': 30, 'dropdown': 40, 'drawer-backdrop': 80, 'drawer': 90, 'dialog': 100, 'palette': 110, 'toast': 120);

// ── Motion ───────────────────────────────────────────────────────
$durations: ('instant': 80ms, 'fast': 120ms, 'base': 200ms, 'slow': 320ms, 'pulse': 1800ms);
$easings: ('standard': cubic-bezier(0.2, 0, 0, 1), 'emphasized': cubic-bezier(0.2, 0.8, 0.2, 1), 'exit': cubic-bezier(0.4, 0, 1, 1));

// ── Layout constants ─────────────────────────────────────────────
$layout: (
  'sidebar-w': 248px,
  'sidebar-w-collapsed': 72px,
  'topbar-h': 52px,
  'drawer-w': 480px,
  'telemetry-h': 28px,
  'content-max': 1440px,
  'list-pane-w': 340px,
  'tree-pane-w': 264px,
);

// ── Breakpoints (min-width) ──────────────────────────────────────
$breakpoints: ('sm': 640px, 'md': 900px, 'lg': 1200px, 'xl': 1536px);

// ── Accessors (throw on unknown keys so typos fail the build) ─────
@function _get($map, $key, $label) {
  @if not map.has-key($map, $key) { @error 'Unknown #{$label} token: #{$key}'; }
  @return map.get($map, $key);
}
@function color($key)    { $_: _get($colors, $key, 'color');   @return var(--rd-color-#{$key}); }
@function raw-color($key){ @return _get($colors, $key, 'color'); }
@function space($key)    { @return _get($space, $key, 'space'); }
@function radius($key)   { $_: _get($radii, $key, 'radius');   @return var(--rd-radius-#{$key}); }
@function fs($key)       { @return _get($font-sizes, $key, 'font-size'); }
@function lh($key)       { @return _get($line-heights, $key, 'line-height'); }
@function fw($key)       { @return _get($font-weights, $key, 'font-weight'); }
@function shadow($key)   { $_: _get($shadows, $key, 'shadow'); @return var(--rd-shadow-#{$key}); }
@function z($key)        { @return _get($z, $key, 'z-index'); }
@function dur($key)      { @return _get($durations, $key, 'duration'); }
@function ease($key)     { @return _get($easings, $key, 'easing'); }
@function layout($key)   { $_: _get($layout, $key, 'layout');  @return var(--rd-#{$key}); }
@function status($key, $prop) { @return map.get(_get($status, $key, 'status'), $prop); }

// ── Emit CSS custom properties (called once from styles.scss) ─────
@mixin emit-custom-properties {
  :root {
    color-scheme: dark;
    @each $k, $v in $colors  { --rd-color-#{$k}: #{$v}; }
    @each $k, $v in $radii   { --rd-radius-#{$k}: #{$v}; }
    @each $k, $v in $shadows { --rd-shadow-#{$k}: #{meta.inspect($v)}; }
    @each $k, $v in $layout  { --rd-#{$k}: #{$v}; }
    --rd-font-ui: #{meta.inspect($font-ui)};
    --rd-font-mono: #{meta.inspect($font-mono)};
    --rd-agent-color: #{map.get($colors, 'primary')}; // overridden inline per agent
  }
}
```

## 3.2 `_mixins.scss` (exact)
```scss
@use 'sass:map';
@use 'sass:math';
@use 'tokens' as t;

// Media query by token
@mixin respond($bp) {
  @media (min-width: map.get(t.$breakpoints, $bp)) { @content; }
}
@mixin respond-below($bp) {
  @media (max-width: (map.get(t.$breakpoints, $bp) - 0.02px)) { @content; }
}

// Glassmorphism panel — used by command palette, drawer header, dialogs
@mixin glass-panel($alpha: 0.72, $blur: 18px, $border: true) {
  background: rgba(24, 26, 36, $alpha);
  backdrop-filter: blur($blur) saturate(140%);
  -webkit-backdrop-filter: blur($blur) saturate(140%);
  @if $border { border: 1px solid rgba(255, 255, 255, 0.06); }
  box-shadow: t.shadow('lg'), t.shadow('inset-top');
}

// Standard opaque card surface
@mixin surface($level: 2, $radius: 'lg', $bordered: true) {
  background: t.color('bg-#{$level}');
  border-radius: t.radius($radius);
  @if $bordered { border: 1px solid t.color('border'); }
}

// Custom scrollbars (WebKit + Firefox)
@mixin scrollbar($size: 8px, $thumb: t.raw-color('border-strong'), $track: transparent) {
  scrollbar-width: thin;
  scrollbar-color: $thumb $track;
  &::-webkit-scrollbar { width: $size; height: $size; }
  &::-webkit-scrollbar-track { background: $track; }
  &::-webkit-scrollbar-thumb {
    background: $thumb; border-radius: 999px; border: 2px solid transparent; background-clip: padding-box;
    &:hover { background-color: t.raw-color('text-3'); }
  }
}

// Status pill — `$status` is a key of t.$status
@mixin status-pill($status, $with-dot: true) {
  display: inline-flex; align-items: center; gap: t.space(1.5);
  height: 20px; padding: 0 t.space(2);
  border-radius: t.radius('pill');
  font: #{t.fw('semibold')} #{t.fs('2xs')}/1 var(--rd-font-ui);
  letter-spacing: map.get(t.$letter-spacing, 'caps');
  text-transform: uppercase; white-space: nowrap;
  color: t.status($status, fg);
  background: t.status($status, bg);
  @if t.status($status, bg) == transparent { box-shadow: inset 0 0 0 1px t.raw-color('border-strong'); }
  @if $with-dot {
    &::before {
      content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none;
      @if t.status($status, glow) { @include glow-indicator(currentColor, 6px, $pulse: true, $as-self: true); }
    }
  }
}

// Glowing active indicator (status dots on avatars, live badges)
@mixin glow-indicator($color: t.raw-color('success'), $size: 8px, $pulse: true, $as-self: false) {
  @if not $as-self { width: $size; height: $size; border-radius: 50%; background: $color; }
  box-shadow: 0 0 0 2px t.raw-color('bg-1'), 0 0 8px $color;
  @if $pulse {
    animation: rd-pulse-glow t.dur('pulse') t.ease('standard') infinite;
    @media (prefers-reduced-motion: reduce) { animation: none; }
  }
}

// Responsive auto-fill card grid
@mixin auto-fill-grid($min: 220px, $gap: t.space(4), $max: 1fr) {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min($min, 100%), $max));
  gap: $gap;
}

// Text truncation — single or multi-line
@mixin truncate($lines: 1) {
  @if $lines == 1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @else { display: -webkit-box; -webkit-line-clamp: $lines; line-clamp: $lines; -webkit-box-orient: vertical; overflow: hidden; }
}

// Focus ring (keyboard only)
@mixin focus-ring($offset: 2px, $color: t.raw-color('neon')) {
  &:focus-visible { outline: 2px solid $color; outline-offset: $offset; }
}

// Interactive surface: hover/active/selected tints
@mixin interactive($hover: 'bg-3', $active: 'bg-4') {
  cursor: pointer;
  transition: background-color t.dur('fast') t.ease('standard'), border-color t.dur('fast') t.ease('standard'), color t.dur('fast') t.ease('standard');
  &:hover { background: t.color($hover); }
  &:active { background: t.color($active); }
  &[aria-current='page'], &.is-selected, &[aria-selected='true'] {
    background: t.color('primary-soft'); color: t.color('text-1');
    box-shadow: inset 2px 0 0 t.color('neon');
  }
  @include focus-ring(-2px);
}

// Caps micro-label ("WORKSPACE", "NEEDS YOU", "WHERE EACH GAME IS")
@mixin section-label {
  font: #{t.fw('semibold')} #{t.fs('2xs')}/1 var(--rd-font-ui);
  letter-spacing: map.get(t.$letter-spacing, 'caps');
  text-transform: uppercase; color: t.color('text-3');
}

// Keyboard key chip
@mixin kbd {
  display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px;
  font: #{t.fw('medium')} #{t.fs('2xs')}/1 var(--rd-font-mono); color: t.color('text-2');
  background: t.color('bg-3'); border: 1px solid t.color('border-strong'); border-bottom-width: 2px; border-radius: t.radius('xs');
}

// Buttons
$_button-sizes: (
  'sm': (height: 28px, pad: t.space(2.5), font: t.fs('sm')),
  'md': (height: 32px, pad: t.space(3), font: t.fs('md')),
  'lg': (height: 40px, pad: t.space(4), font: t.fs('base')),
);
@mixin button($variant: 'secondary', $size: 'md') {
  @if not map.has-key($_button-sizes, $size) { @error 'Unknown button size #{$size}'; }
  $s: map.get($_button-sizes, $size);
  display: inline-flex; align-items: center; justify-content: center; gap: t.space(2);
  height: map.get($s, height);
  padding: 0 map.get($s, pad);
  border-radius: t.radius('md'); border: 1px solid transparent;
  font: #{t.fw('medium')} #{map.get($s, font)}/1 var(--rd-font-ui);
  white-space: nowrap; cursor: pointer; user-select: none;
  transition: background-color t.dur('fast') t.ease('standard'), box-shadow t.dur('fast') t.ease('standard'), transform t.dur('instant') t.ease('standard');
  &:active:not(:disabled) { transform: translateY(1px); }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
  @include focus-ring;
  @if $variant == 'primary' {
    background: t.color('primary'); color: #fff;
    &:hover:not(:disabled) { background: t.color('primary-hover'); box-shadow: t.shadow('glow-primary'); }
  } @else if $variant == 'secondary' {
    background: t.color('bg-3'); color: t.color('text-1'); border-color: t.color('border');
    &:hover:not(:disabled) { background: t.color('bg-4'); border-color: t.color('border-strong'); }
  } @else if $variant == 'ghost' {
    background: transparent; color: t.color('text-2');
    &:hover:not(:disabled) { background: t.color('bg-3'); color: t.color('text-1'); }
  } @else if $variant == 'success' {
    background: t.color('success-soft'); color: t.color('success'); border-color: rgba(34, 197, 94, 0.35);
    &:hover:not(:disabled) { background: rgba(34, 197, 94, 0.24); }
  } @else if $variant == 'warning' {
    background: t.color('warning-soft'); color: t.color('warning'); border-color: rgba(245, 158, 11, 0.35);
    &:hover:not(:disabled) { background: rgba(245, 158, 11, 0.24); }
  } @else if $variant == 'danger' {
    background: t.color('danger-soft'); color: t.color('danger'); border-color: rgba(239, 68, 68, 0.35);
    &:hover:not(:disabled) { background: rgba(239, 68, 68, 0.24); }
  } @else { @error 'Unknown button variant #{$variant}'; }
}

// Visually hidden (a11y)
@mixin visually-hidden {
  position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

// Tabular numbers for data tables / counters
@mixin numeric { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum' 1, 'zero' 1; }
```
> [!NOTE]
> The design system avoids the legacy global Sass `if()` function (deprecated in recent Dart Sass) and uses `@if` and maps throughout. Argon must keep it that way.

## 3.3 `_reset.scss`, `_typography.scss`, `_layout.scss`, `_animations.scss`, `_controls.scss`, `_markdown.scss`
```scss
// _reset.scss
@use 'tokens' as t;
*, *::before, *::after { box-sizing: border-box; }
* { margin: 0; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
html, body { height: 100%; }
body {
  background: t.color('bg-0'); color: t.color('text-1');
  font-family: var(--rd-font-ui); font-size: t.fs('base'); line-height: t.lh('normal');
  -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; overflow: hidden;
}
img, picture, video, canvas, svg { display: block; max-width: 100%; }
input, button, textarea, select { font: inherit; color: inherit; }
button { background: none; border: 0; padding: 0; }
a { color: inherit; text-decoration: none; }
p, h1, h2, h3, h4, h5, h6 { overflow-wrap: break-word; }
table { border-collapse: collapse; border-spacing: 0; }
ul[role='list'], ol[role='list'] { list-style: none; padding: 0; }
::selection { background: t.color('neon-soft'); color: t.color('text-1'); }
:focus:not(:focus-visible) { outline: none; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}

// _typography.scss
@use 'sass:map';
@use 'tokens' as t;
.rd-display { font-size: t.fs('3xl'); font-weight: t.fw('semibold'); letter-spacing: map.get(t.$letter-spacing, 'display'); line-height: t.lh('tight'); }
.rd-h1 { font-size: t.fs('2xl'); font-weight: t.fw('semibold'); letter-spacing: map.get(t.$letter-spacing, 'tight'); line-height: t.lh('tight'); }
.rd-h2 { font-size: t.fs('xl'); font-weight: t.fw('semibold'); line-height: t.lh('snug'); }
.rd-h3 { font-size: t.fs('lg'); font-weight: t.fw('semibold'); line-height: t.lh('snug'); }
.rd-body { font-size: t.fs('base'); line-height: t.lh('normal'); }
.rd-small { font-size: t.fs('sm'); color: t.color('text-2'); }
.rd-muted { color: t.color('text-3'); }
.rd-label { font-size: t.fs('2xs'); font-weight: t.fw('semibold'); letter-spacing: map.get(t.$letter-spacing, 'caps'); text-transform: uppercase; color: t.color('text-3'); }
.rd-mono { font-family: var(--rd-font-mono); font-size: t.fs('sm'); }
.rd-num { font-variant-numeric: tabular-nums; }

// _layout.scss
@use 'tokens' as t;
@use 'mixins' as m;
.rd-page { height: 100%; overflow: auto; padding: t.space(6) t.space(8); @include m.scrollbar; }
.rd-page__inner { max-width: t.layout('content-max'); margin-inline: auto; }
.rd-stack { display: flex; flex-direction: column; gap: var(--rd-stack-gap, #{t.space(3)}); }
.rd-row { display: flex; align-items: center; gap: var(--rd-row-gap, #{t.space(2)}); }
.rd-spacer { flex: 1 1 auto; }
.rd-divider { height: 1px; background: t.color('border'); border: 0; }
.rd-scroll { overflow: auto; @include m.scrollbar; }
.rd-sr-only { @include m.visually-hidden; }

// _animations.scss
@use 'tokens' as t;
@keyframes rd-pulse-glow { 0%, 100% { opacity: 1; filter: brightness(1); } 50% { opacity: 0.55; filter: brightness(1.4); } }
@keyframes rd-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes rd-slide-in-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes rd-slide-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes rd-scale-in { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: scale(1); } }
@keyframes rd-caret-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@keyframes rd-shimmer { from { background-position: -400px 0; } to { background-position: 400px 0; } }
@keyframes rd-spin { to { transform: rotate(360deg); } }
.rd-anim-slide-up { animation: rd-slide-up t.dur('base') t.ease('emphasized') both; }
.rd-skeleton {
  background: linear-gradient(90deg, t.raw-color('bg-2') 0, t.raw-color('bg-3') 40px, t.raw-color('bg-2') 80px);
  background-size: 800px 100%; animation: rd-shimmer 1.4s linear infinite; border-radius: t.radius('sm');
}
.rd-streaming-caret::after { content: '▍'; margin-left: 2px; color: t.color('neon'); animation: rd-caret-blink 1s steps(1) infinite; }

// _controls.scss
@use 'tokens' as t;
@use 'mixins' as m;
.rd-btn { @include m.button('secondary'); }
.rd-btn--primary { @include m.button('primary'); }
.rd-btn--ghost { @include m.button('ghost'); }
.rd-btn--success { @include m.button('success'); }
.rd-btn--warning { @include m.button('warning'); }
.rd-btn--danger { @include m.button('danger'); }
.rd-btn--sm { height: 28px; padding: 0 t.space(2.5); font-size: t.fs('sm'); }
.rd-btn--lg { height: 40px; padding: 0 t.space(4); font-size: t.fs('base'); }
.rd-btn--icon { width: 32px; padding: 0; }
.rd-input, .rd-select, .rd-textarea {
  width: 100%; background: t.color('bg-3'); border: 1px solid t.color('border'); border-radius: t.radius('md');
  color: t.color('text-1'); padding: t.space(2) t.space(3); font-size: t.fs('md');
  transition: border-color t.dur('fast') t.ease('standard'), box-shadow t.dur('fast') t.ease('standard');
  &::placeholder { color: t.color('text-3'); }
  &:hover { border-color: t.color('border-strong'); }
  &:focus { outline: none; border-color: t.color('primary'); box-shadow: 0 0 0 3px t.color('primary-soft'); }
  &[aria-invalid='true'] { border-color: t.color('danger'); }
}
.rd-input, .rd-select { height: 34px; }
.rd-textarea { min-height: 88px; resize: vertical; line-height: t.lh('normal'); @include m.scrollbar(6px); }
.rd-select { appearance: none; padding-right: t.space(8);
  background-image: linear-gradient(45deg, transparent 50%, t.raw-color('text-3') 50%), linear-gradient(135deg, t.raw-color('text-3') 50%, transparent 50%);
  background-position: calc(100% - 16px) 50%, calc(100% - 11px) 50%; background-size: 5px 5px; background-repeat: no-repeat; }
.rd-field { display: grid; gap: t.space(1.5); }
.rd-field__label { font-size: t.fs('sm'); font-weight: t.fw('medium'); color: t.color('text-2'); }
.rd-field__error { font-size: t.fs('xs'); color: t.color('danger'); }
.rd-kbd { @include m.kbd; }

// _markdown.scss — shared prose for vault preview + agent logs
@use 'tokens' as t;
@use 'mixins' as m;
.rd-prose {
  color: t.color('text-1'); font-size: t.fs('base'); line-height: t.lh('relaxed');
  > * + * { margin-top: t.space(3); }
  h1 { font-size: t.fs('2xl'); font-weight: t.fw('semibold'); margin-top: t.space(6); }
  h2 { font-size: t.fs('xl'); font-weight: t.fw('semibold'); margin-top: t.space(6); padding-bottom: t.space(1.5); border-bottom: 1px solid t.color('border'); }
  h3 { font-size: t.fs('lg'); font-weight: t.fw('semibold'); margin-top: t.space(5); }
  a { color: t.color('neon'); text-decoration: underline; text-decoration-color: t.color('neon-soft'); text-underline-offset: 3px; }
  a.rd-wikilink { text-decoration: none; background: t.color('primary-soft'); padding: 0 t.space(1); border-radius: t.radius('xs'); }
  a.rd-wikilink--missing { color: t.color('text-3'); background: none; border-bottom: 1px dashed t.color('text-3'); }
  ul, ol { padding-left: t.space(6); }
  li + li { margin-top: t.space(1); }
  blockquote { border-left: 3px solid t.color('neon'); padding: t.space(2) t.space(4); background: t.color('bg-2'); border-radius: 0 t.radius('md') t.radius('md') 0; color: t.color('text-2'); }
  code { font-family: var(--rd-font-mono); font-size: 0.92em; background: t.color('bg-3'); padding: 1px t.space(1); border-radius: t.radius('xs'); }
  pre { position: relative; background: #0E0F15; border: 1px solid t.color('border'); border-radius: t.radius('md'); padding: t.space(3) t.space(4); overflow: auto; @include m.scrollbar(6px);
    code { background: none; padding: 0; font-size: t.fs('sm'); line-height: 1.6; } }
  pre[data-lang]::before { content: attr(data-lang); position: absolute; top: t.space(1.5); right: t.space(3); @include m.section-label; }
  pre.rd-ascii { white-space: pre; font-variant-ligatures: none; line-height: 1.25; color: #C9CCDA; background: #0A0B0F; }
  table { width: 100%; font-size: t.fs('md'); border: 1px solid t.color('border'); border-radius: t.radius('md'); overflow: hidden; display: block; overflow-x: auto; }
  th { background: t.color('bg-2'); text-align: left; font-weight: t.fw('semibold'); color: t.color('text-2'); }
  th, td { padding: t.space(2) t.space(3); border-bottom: 1px solid t.color('border'); }
  hr { border: 0; height: 1px; background: t.color('border'); margin: t.space(6) 0; }
  .rd-swatch { display: inline-block; width: 12px; height: 12px; border-radius: 3px; vertical-align: -1px; margin-right: t.space(1.5); box-shadow: inset 0 0 0 1px rgba(255,255,255,.15); }
  // Luau highlighter token classes
  .tok-kw { color: #C084FC; } .tok-str { color: #86EFAC; } .tok-num { color: #FCD34D; }
  .tok-com { color: #6E7390; font-style: italic; } .tok-fn { color: #7DD3FC; } .tok-glob { color: #F9A8D4; } .tok-op { color: #A9ADC1; }
}
```

## 3.4 `_rd.scss` and `styles.scss`
```scss
// styles/_rd.scss — the ONLY module components import (via includePaths ["src/styles"])
@forward 'tokens';
@forward 'mixins';

// src/styles.scss — global entry
@use 'styles/tokens' as t;
@use 'styles/reset';
@use 'styles/typography';
@use 'styles/layout';
@use 'styles/animations';
@use 'styles/controls';
@use 'styles/markdown';
@include t.emit-custom-properties;
```
**Component usage contract** (every component stylesheet starts like this):
```scss
@use 'rd';
:host { display: block; }
```

## 3.5 Component-Level Layout Blueprints

### Studio Shell (`studio-shell.component.scss`)
```scss
@use 'rd';
:host {
  display: grid; height: 100dvh; overflow: hidden;
  grid-template-columns: rd.layout('sidebar-w') minmax(0, 1fr);
  grid-template-rows: rd.layout('topbar-h') minmax(0, 1fr);
  grid-template-areas: 'sidebar topbar' 'sidebar main';
  background: rd.color('bg-0');
  @include rd.respond-below('lg') { grid-template-columns: rd.layout('sidebar-w-collapsed') minmax(0, 1fr); }
  @include rd.respond-below('md') {
    grid-template-columns: minmax(0, 1fr); grid-template-areas: 'topbar' 'main';
  }
}
.shell__sidebar { grid-area: sidebar; z-index: rd.z('sidebar'); min-height: 0;
  @include rd.respond-below('md') {
    position: fixed; inset: 0 auto 0 0; width: rd.layout('sidebar-w'); transform: translateX(-100%);
    transition: transform rd.dur('slow') rd.ease('emphasized'); box-shadow: rd.shadow('lg');
    &.is-open { transform: translateX(0); }
  }
}
.shell__topbar { grid-area: topbar; z-index: rd.z('topbar'); }
.shell__main { grid-area: main; min-width: 0; min-height: 0; overflow: hidden; position: relative; }
.shell__scrim { position: fixed; inset: 0; background: rd.color('overlay'); z-index: rd.z('sidebar') - 1; animation: rd-fade-in rd.dur('base') both; }
```

### Sidebar (`sidebar.component.scss`)
```scss
@use 'rd';
:host {
  display: grid; height: 100%;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto; // switcher, search, nav (scroll), matrix, execution widget
  background: rd.color('bg-1'); border-right: 1px solid rd.color('border');
}
.sidebar__search {
  margin: 0 rd.space(3) rd.space(3); height: 32px; display: flex; align-items: center; gap: rd.space(2);
  padding: 0 rd.space(2.5); border-radius: rd.radius('md'); background: rd.color('bg-2'); border: 1px solid rd.color('border');
  color: rd.color('text-3'); font-size: rd.fs('sm'); @include rd.interactive('bg-3', 'bg-4');
  .rd-kbd { margin-left: auto; }
}
.sidebar__nav { overflow-y: auto; padding: 0 rd.space(2); @include rd.scrollbar(6px); }
.sidebar__section-label { @include rd.section-label; padding: rd.space(4) rd.space(2) rd.space(1.5); }
.sidebar__footer { border-top: 1px solid rd.color('border'); }
:host-context(.is-collapsed) .sidebar__label, :host-context(.is-collapsed) .sidebar__section-label { @include rd.visually-hidden; }
```
**`nav-link.component.scss`:** a 32px-high row in a `grid-template-columns: 18px 1fr auto` grid (icon, label, badge), radius `md`, using `@include rd.interactive`. Badge: `count-badge` with `min-width: 18px; height: 18px; font-size: 10px; border-radius: pill; background: bg-4`. The badge uses the `--accent` variant (`primary` bg, white text) when `tone="accent"`. Review always uses accent when its count is > 0.

### Agent Matrix (`agent-matrix.component.scss`)
```scss
@use 'rd';
:host { display: block; padding: rd.space(3); border-top: 1px solid rd.color('border'); }
.matrix { display: grid; grid-template-columns: repeat(4, 1fr); gap: rd.space(2); }
.matrix__cell {
  position: relative; aspect-ratio: 1; border-radius: rd.radius('md');
  background: var(--rd-agent-color); color: #fff; display: grid; place-items: center;
  font: #{rd.fw('bold')} #{rd.fs('xs')}/1 var(--rd-font-ui); letter-spacing: 0.02em;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12), inset 0 -10px 16px rgba(0, 0, 0, 0.18);
  transition: transform rd.dur('fast') rd.ease('standard'), filter rd.dur('fast') rd.ease('standard');
  &:hover { transform: translateY(-1px); filter: brightness(1.12); }
  @include rd.focus-ring;
  &[data-status='OFFLINE'] { filter: grayscale(0.85) brightness(0.6); }
  &--team { background: rd.color('bg-3'); color: rd.color('text-2'); box-shadow: inset 0 0 0 1px rd.color('border-strong'); }
}
.matrix__dot {
  position: absolute; top: -3px; right: -3px;
  &[data-status='WORKING'] { @include rd.glow-indicator(rd.raw-color('success'), 9px, true); }
  &[data-status='WAITING_ON_HUMAN'] { @include rd.glow-indicator(rd.raw-color('warning'), 9px, false); }
  &[data-status='ERROR'], &[data-status='BLOCKED'] { @include rd.glow-indicator(rd.raw-color('danger'), 9px, true); }
}
```
Matrix cells are ordered by `AgentRosterEntry.order` (15 agents). **Cell 16** is a "Team" tile (grid icon) linking to `/team`. Each cell sets `[style.--rd-agent-color]="agent.color"`. The `title` attribute reads `"{name} · {status label}"`, and clicking routes to `/team/{key}`.

### Context Bar (`context-bar.component.scss`)
```scss
@use 'rd';
:host { display: flex; align-items: center; gap: rd.space(3); height: 100%; padding: 0 rd.space(4);
  background: rd.color('bg-1'); border-bottom: 1px solid rd.color('border'); }
.context__tabs { display: flex; gap: rd.space(1); overflow-x: auto; scrollbar-width: none; min-width: 0; }
.context__tab { height: 30px; padding: 0 rd.space(3); border-radius: rd.radius('md'); color: rd.color('text-2'); font-size: rd.fs('md');
  display: inline-flex; align-items: center; gap: rd.space(2); white-space: nowrap; @include rd.interactive;
  &.is-active { background: rd.color('bg-3'); color: rd.color('text-1'); box-shadow: inset 0 0 0 1px rd.color('border-strong'); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--game-accent); } }
.context__actions { margin-left: auto; display: flex; gap: rd.space(2); }
```

### Home (`home.page.scss`)
```scss
@use 'rd';
:host { display: block; height: 100%; overflow: auto; @include rd.scrollbar; }
.home { max-width: rd.layout('content-max'); margin: 0 auto; padding: rd.space(6) rd.space(8) rd.space(10);
  display: grid; gap: rd.space(6);
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-template-areas: 'header header' 'prompt prompt' 'needs live';
  @include rd.respond-below('lg') { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'header' 'prompt' 'needs' 'live'; padding: rd.space(5); }
}
.home__header { grid-area: header; } .home__prompt { grid-area: prompt; }
.home__needs { grid-area: needs; display: grid; gap: rd.space(3); align-content: start; }
.home__live { grid-area: live; display: grid; gap: rd.space(5); align-content: start; }
.home__pills { display: flex; gap: rd.space(2); margin-top: rd.space(3); }
```
**`prompt-bar.component.scss`:** `@include rd.surface(2, 'xl')`, 52px tall, with a 1px gradient border on focus (`border-image` is not allowed; use a `::before` mask ring with `background: linear-gradient(90deg, primary, neon)` and `padding: 1px`). The textarea autosizes up to 6 lines, and `Enter` submits (`Shift+Enter` inserts a newline).
**`needs-you-card.component.scss`:** `@include rd.surface(2, 'lg')` with padding `space(4)`. Its kind label (`PICK THE NEXT GAME`, `TRY IT`) uses `section-label` in `neon` for PICK and `warning` for TRY_IT. The action row is `display:flex; gap: space(2)`.
**`game-progress-card.component.scss`:** a grid of `auto 1fr auto` rows. Progress bar: 6px high, `bg-3` track, fill `linear-gradient(90deg, var(--game-accent), neon)`. Version chips use the mono font. The CTA `.rd-btn--primary` is full width and reads "Play the newest build".

### Team / Lead Console (`team.page.scss`)
```scss
@use 'rd';
:host { display: grid; height: 100%; min-height: 0;
  grid-template-columns: rd.layout('list-pane-w') minmax(0, 1fr);
  @include rd.respond-below('md') { grid-template-columns: minmax(0, 1fr); }
}
.team__list { min-height: 0; overflow-y: auto; border-right: 1px solid rd.color('border'); background: rd.color('bg-1'); @include rd.scrollbar(6px);
  @include rd.respond-below('md') { &.is-hidden-mobile { display: none; } } }
.team__console { min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; } // header, stream, chat bar
```
**`agent-list-item.component.scss`:** grid `36px 1fr auto` × 2 rows (avatar spanning both rows, name + pill, snippet + timestamp). The snippet uses `truncate(1)` in `text-3` at `fs(sm)`. The selected state comes from `interactive`.
**`run-log-stream.component.scss`:** `overflow-y: auto; padding: space(5) space(6); scroll-behavior: smooth` with an auto-stick-to-bottom flag. Entries are spaced `space(3)` apart. A `TOOL_CALL` entry is a compact 32px row in mono with a left 2px border in `info`. `TOOL_RESULT` rows collapse by default (`<details>`). `CONTEXT` entries show injected docs as chips. `ERROR` rows use `danger-soft`. `HANDOFF` shows a pill with the target agent's colour.
**`agent-chat-bar.component.scss`:** sticky bottom, `border-top`, padding `space(3) space(4)`. The textarea autosizes (max 160px) and the send button is primary.

### Review (`review.page.scss`, `review-drawer.component.scss`)
```scss
// review.page.scss
@use 'rd';
:host { display: block; height: 100%; overflow: auto; @include rd.scrollbar; }
.review { padding: rd.space(6) rd.space(8); max-width: rd.layout('content-max'); margin: 0 auto; }
.review__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: rd.space(3); margin-bottom: rd.space(5); }
.review__group + .review__group { margin-top: rd.space(8); }
.review__group-title { @include rd.section-label; margin-bottom: rd.space(3); display: flex; align-items: center; gap: rd.space(2); }
.review__grid { @include rd.auto-fill-grid(220px, rd.space(4)); }
.review__grid--stages { @include rd.auto-fill-grid(360px, rd.space(4)); }

// review-drawer.component.scss  (rendered inside rd-drawer)
@use 'rd';
:host { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; }
.drawer__header { padding: rd.space(4) rd.space(5); border-bottom: 1px solid rd.color('border'); @include rd.glass-panel(0.85, 12px, false); position: sticky; top: 0; }
.drawer__body { overflow-y: auto; padding: rd.space(5); display: grid; gap: rd.space(5); align-content: start; @include rd.scrollbar(6px); }
.drawer__hero { border-radius: rd.radius('lg'); overflow: hidden; background: repeating-conic-gradient(#1a1c26 0% 25%, #14161e 0% 50%) 50% / 16px 16px; }
.drawer__meta { font-size: rd.fs('sm'); color: rd.color('text-2'); @include rd.numeric; }
.drawer__footer { display: grid; grid-template-columns: repeat(3, 1fr); gap: rd.space(2); padding: rd.space(4) rd.space(5); border-top: 1px solid rd.color('border'); background: rd.color('bg-1'); }
```
**`drawer.component.scss`** (generic, reused by Tasks):
```scss
@use 'rd';
:host { position: fixed; inset: 0; z-index: rd.z('drawer'); pointer-events: none; }
.drawer__backdrop { position: absolute; inset: 0; background: rd.color('overlay'); opacity: 0;
  transition: opacity rd.dur('slow') rd.ease('standard'); }
.drawer__panel { position: absolute; top: 0; right: 0; bottom: 0; width: min(#{rd.layout('drawer-w')}, 100vw);
  background: rd.color('bg-1'); border-left: 1px solid rd.color('border'); box-shadow: rd.shadow('drawer');
  transform: translateX(100%); transition: transform rd.dur('slow') rd.ease('emphasized'); }
:host(.is-open) { pointer-events: auto;
  .drawer__backdrop { opacity: 1; }
  .drawer__panel { transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) { .drawer__panel, .drawer__backdrop { transition: none; } }
```
**`small-preview-strip.component.scss`:** flex row, `align-items: flex-end`, gap `space(4)`. Each frame shows a `<figure>` with the image at an exact CSS size (`512px` scaled to fit the drawer width via `max-width: 100%`, then `150px` and `64px`), a `figcaption` in mono `text-3`, a checkerboard background and `image-rendering: auto`. For 16:9 assets the three widths are `512/150/64px`, with height following the aspect ratio.

### Market (`market-table.component.scss`)
```scss
@use 'rd';
:host { display: block; @include rd.surface(1, 'lg'); overflow: hidden; }
.table-wrap { overflow: auto; max-height: calc(100dvh - 220px); @include rd.scrollbar(8px); }
table { width: 100%; font-size: rd.fs('md'); @include rd.numeric; }
thead th { position: sticky; top: 0; z-index: rd.z('sticky'); background: rd.color('bg-2'); @include rd.section-label;
  text-align: left; padding: rd.space(2.5) rd.space(3); border-bottom: 1px solid rd.color('border'); cursor: pointer; white-space: nowrap;
  &.num { text-align: right; } &[aria-sort] { color: rd.color('text-1'); } }
tbody tr { border-bottom: 1px solid rd.color('border'); transition: background-color rd.dur('instant');
  &:hover { background: rd.color('bg-2'); } }
td { padding: rd.space(2) rd.space(3); height: 44px; white-space: nowrap; &.num { text-align: right; font-family: var(--rd-font-mono); font-size: rd.fs('sm'); } }
.rank { color: rd.color('text-3'); width: 48px; }
.game { display: flex; align-items: center; gap: rd.space(2.5); min-width: 260px; img { width: 28px; height: 28px; border-radius: rd.radius('sm'); } }
.pos { color: rd.color('success'); } .neg { color: rd.color('danger'); } .flat { color: rd.color('text-3'); }
```

### Pitches (`pitches.page.scss`, `pitch-detail.component.scss`)
```scss
@use 'rd';
:host { display: grid; height: 100%; grid-template-columns: 320px minmax(0, 1fr); min-height: 0;
  @include rd.respond-below('md') { grid-template-columns: minmax(0, 1fr); } }
.pitches__list { border-right: 1px solid rd.color('border'); overflow-y: auto; background: rd.color('bg-1'); @include rd.scrollbar(6px); }
.pitches__detail { overflow-y: auto; @include rd.scrollbar; }
// pitch-detail
.pitch { max-width: 960px; margin: 0 auto; padding: rd.space(6) rd.space(8) rd.space(12); display: grid; gap: rd.space(5); }
.pitch__metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: rd.space(3); }
.pitch__banners { display: grid; grid-template-columns: 1fr 1fr; gap: rd.space(3); @include rd.respond-below('md') { grid-template-columns: 1fr; } }
.pitch__actions { position: sticky; bottom: 0; display: flex; gap: rd.space(2); padding: rd.space(3) 0; background: linear-gradient(transparent, rd.color('bg-0') 30%); }
```
**`metric-callout.component.scss`:** `surface(2,'lg')`, padding `space(4)`. The label is `section-label` and the value is `fs('2xl')` semibold mono. Tone `positive` adds a 2px top border in `success`, and `warning` adds one in `warning`.
**`pitch-banner.component.scss`:** `WHAT CHANGED` uses an `info-soft` bg with an `info` left border. `HOW WE'RE DIFFERENT` uses a `primary-soft` bg with a `neon` left border.
**`accordion.component.scss`:** `<details>`/`<summary>`. The summary is a 44px row with a chevron rotating 90° on `[open]`. The content area uses `.rd-prose`.

### Library (`library.page.scss`)
```scss
@use 'rd';
:host { display: grid; height: 100%; min-height: 0;
  grid-template-columns: rd.layout('tree-pane-w') minmax(0, 1fr) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr) rd.layout('telemetry-h');
  grid-template-areas: 'tree editor preview' 'telemetry telemetry telemetry'; }
:host(.mode-view)  { grid-template-columns: rd.layout('tree-pane-w') 0 minmax(0, 1fr); .library__editor { display: none; } }
:host(.mode-edit)  { grid-template-columns: rd.layout('tree-pane-w') minmax(0, 1fr) 0; .library__preview { display: none; } }
:host(.tree-collapsed) { grid-template-columns: 0 minmax(0, 1fr) minmax(0, 1fr); .library__tree { display: none; } }
@include rd.respond-below('lg') { :host { grid-template-columns: rd.layout('tree-pane-w') minmax(0, 1fr) 0; } }
.library__tree { grid-area: tree; overflow-y: auto; background: rd.color('bg-1'); border-right: 1px solid rd.color('border'); @include rd.scrollbar(6px); }
.library__editor { grid-area: editor; min-height: 0; border-right: 1px solid rd.color('border'); display: grid; grid-template-rows: auto minmax(0, 1fr); }
.library__preview { grid-area: preview; overflow-y: auto; padding: rd.space(6) rd.space(8); @include rd.scrollbar; }
.library__telemetry { grid-area: telemetry; }
```
**`vault-editor.component.scss`:** a toolbar row (title input, mode segmented control `View | Split | Edit`, a save-state indicator: "Saved v4" / "Saving…" / "Unsaved" / "Conflict"). The textarea fills the rest: `font-family: mono; font-size: 13px; line-height: 1.6; tab-size: 2; padding: space(5); background: bg-0; border: 0; resize: none; white-space: pre; overflow: auto`.
**`telemetry-bar.component.scss`:** 28px, `bg-1`, `border-top`, mono `fs(xs)` `text-3`, `display:flex; gap: space(5); padding: 0 space(4); align-items:center`. Items: `1,284 words · 7,912 chars · 3 backlinks · linked: [avatar chips]`. On the right: `v4 · updated 3m ago by Operator`.

### Status Pill (`status-pill.component.scss`) — generated variants
```scss
@use 'sass:map';
@use 'rd';
:host { display: inline-flex; }
@each $key, $_ in rd.$status {
  :host([data-status='#{$key}']) .pill { @include rd.status-pill($key); }
}
```
