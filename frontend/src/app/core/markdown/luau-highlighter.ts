// Control flow, branching, and loop statements (Red / Coral)
const CONTROL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elseif',
  'elif',
  'while',
  'repeat',
  'until',
  'for',
  'in',
  'of',
  'do',
  'end',
  'break',
  'continue',
  'return',
  'switch',
  'case',
  'default',
  'try',
  'catch',
  'finally',
  'throw',
  'raise',
  'except',
  'with',
  'yield',
  'await',
  'async',
  'match',
  'when',
  'goto',
  'pass',
  'defer',
  'fallthrough',
]);

// Declarations, storage, module & logical keywords (Blue)
const DECLARATION_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'class',
  'const',
  'def',
  'del',
  'delete',
  'enum',
  'export',
  'extends',
  'final',
  'fn',
  'from',
  'func',
  'function',
  'global',
  'impl',
  'implements',
  'import',
  'infer',
  'instanceof',
  'interface',
  'internal',
  'is',
  'keyof',
  'lambda',
  'let',
  'local',
  'mod',
  'module',
  'mut',
  'namespace',
  'new',
  'nonlocal',
  'not',
  'or',
  'override',
  'package',
  'private',
  'protected',
  'pub',
  'public',
  'readonly',
  ' sealed',
  'static',
  'struct',
  'trait',
  'type',
  'typeof',
  'use',
  'using',
  'val',
  'var',
  'virtual',
  'where',
]);

// Booleans, nullish & self/this literals (Orange)
const BOOLEAN_AND_LITERAL_KEYWORDS = new Set([
  'true',
  'false',
  'True',
  'False',
  'nil',
  'null',
  'undefined',
  'None',
  'NaN',
  'Infinity',
  'self',
  'this',
  'super',
  'Self',
]);

// Built-in engine & runtime globals (Pink / Magenta)
const GLOBALS = new Set([
  'game',
  'workspace',
  'script',
  'Instance',
  'Vector3',
  'Vector2',
  'CFrame',
  'Color3',
  'UDim',
  'UDim2',
  'Enum',
  'task',
  'math',
  'string',
  'table',
  'os',
  'require',
  'tick',
  'wait',
  'spawn',
  'delay',
  'TweenInfo',
  'RaycastParams',
  'OverlapParams',
  'BrickColor',
  'NumberSequence',
  'ColorSequence',
  'NumberRange',
  'Random',
  'Rect',
  'Region3',
  'PhysicalProperties',
  'utf8',
  'bit32',
  'buffer',
  'debug',
  'coroutine',
  'shared',
  '_G',
  'print',
  'warn',
  'error',
  'pcall',
  'xpcall',
  'tonumber',
  'tostring',
  'ipairs',
  'pairs',
  'next',
  'select',
  'unpack',
  'rawget',
  'rawset',
  'rawequal',
  'setmetatable',
  'getmetatable',
  'console',
  'window',
  'document',
  'process',
  'Buffer',
  'Math',
  'JSON',
  'Object',
  'Array',
  'Promise',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Date',
  'RegExp',
  'Error',
  'Symbol',
  'BigInt',
  'fetch',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
]);

// Primitive & built-in type names (Teal / Mint)
const TYPE_KEYWORDS = new Set([
  'number',
  'boolean',
  'any',
  'unknown',
  'never',
  'void',
  'object',
  'symbol',
  'bigint',
  'int',
  'float',
  'bool',
  'str',
  'bytes',
  'dict',
  'list',
  'tuple',
  'u8',
  'u16',
  'u32',
  'u64',
  'usize',
  'i8',
  'i16',
  'i32',
  'i64',
  'isize',
  'f32',
  'f64',
  'char',
]);

const HASH_COMMENT_LANGS = new Set([
  'python',
  'py',
  'yaml',
  'yml',
  'sh',
  'bash',
  'shell',
  'zsh',
  'powershell',
  'ps1',
  'pwsh',
  'toml',
  'dockerfile',
  'ruby',
  'rb',
  'perl',
  'r',
]);

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapSpan(cls: string, text: string): string {
  return `<span class="${cls}">${escapeHtml(text)}</span>`;
}

export class LuauHighlighter {
  static highlight(src: string, lang?: string): string {
    const normLang = (lang ?? '').trim().toLowerCase();
    const isLuau =
      !normLang ||
      normLang === 'luau' ||
      normLang === 'lua' ||
      /\b(?:local\s+function|elseif|game:GetService|--!strict)\b/.test(src);
    const supportsSlashComments = !isLuau;
    const supportsHashComments = HASH_COMMENT_LANGS.has(normLang);

    let out = '';
    let i = 0;
    const len = src.length;

    while (i < len) {
      const ch = src[i]!;
      const next = src[i + 1];

      // 1a. Luau/SQL comments: --[[ ... ]] or --!... directive or -- ...
      if (ch === '-' && next === '-') {
        if (src[i + 2] === '[' && src[i + 3] === '[') {
          const closeIdx = src.indexOf(']]', i + 4);
          const end = closeIdx >= 0 ? closeIdx + 2 : len;
          out += wrapSpan('tok-com', src.slice(i, end));
          i = end;
          continue;
        }
        const nl = src.indexOf('\n', i + 2);
        const end = nl >= 0 ? nl : len;
        const text = src.slice(i, end);
        if (src[i + 2] === '!') {
          out += wrapSpan('tok-dec', text);
        } else {
          out += wrapSpan('tok-com', text);
        }
        i = end;
        continue;
      }

      // 1b. C/TS/JS/C#/Rust/Go comments: // ... or /* ... */
      if (supportsSlashComments && ch === '/' && next === '/') {
        const nl = src.indexOf('\n', i + 2);
        const end = nl >= 0 ? nl : len;
        out += wrapSpan('tok-com', src.slice(i, end));
        i = end;
        continue;
      }
      if (supportsSlashComments && ch === '/' && next === '*') {
        const closeIdx = src.indexOf('*/', i + 2);
        const end = closeIdx >= 0 ? closeIdx + 2 : len;
        out += wrapSpan('tok-com', src.slice(i, end));
        i = end;
        continue;
      }

      // 1c. Python/YAML/Shell/PowerShell # comments
      if (
        supportsHashComments &&
        ch === '#' &&
        (i === 0 || src[i - 1] === '\n' || src[i - 1] === ' ' || src[i - 1] === '\t')
      ) {
        const nl = src.indexOf('\n', i + 1);
        const end = nl >= 0 ? nl : len;
        out += wrapSpan('tok-com', src.slice(i, end));
        i = end;
        continue;
      }

      // 1d. Decorators / attributes (@Component, @native, etc.)
      if (ch === '@' && next !== undefined && /[a-zA-Z_]/.test(next)) {
        let j = i + 1;
        while (j < len && /[a-zA-Z0-9_.]/.test(src[j]!)) j++;
        out += wrapSpan('tok-dec', src.slice(i, j));
        i = j;
        continue;
      }

      // 2. Multi-line string [[ ... ]]
      if (ch === '[' && next === '[') {
        const closeIdx = src.indexOf(']]', i + 2);
        const end = closeIdx >= 0 ? closeIdx + 2 : len;
        out += wrapSpan('tok-str', src.slice(i, end));
        i = end;
        continue;
      }

      // 3. Quoted strings "...", '...', `...`
      if (ch === '"' || ch === "'" || ch === '`') {
        const quote = ch;
        let j = i + 1;
        while (j < len) {
          const c = src[j]!;
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === quote) {
            j++;
            break;
          }
          j++;
        }
        // Check if this is a JSON object key followed by ':'
        let k = j;
        while (k < len && (src[k] === ' ' || src[k] === '\t')) k++;
        if (quote === '"' && src[k] === ':' && src[k + 1] !== ':') {
          out += wrapSpan('tok-prop', src.slice(i, j));
        } else {
          out += wrapSpan('tok-str', src.slice(i, j));
        }
        i = j;
        continue;
      }

      // 4. Numbers (hex 0x..., binary 0b..., decimal with optional _ and exponent)
      if (
        (ch >= '0' && ch <= '9') ||
        (ch === '.' && next !== undefined && next >= '0' && next <= '9')
      ) {
        let j = i;
        if (ch === '0' && (next === 'x' || next === 'X' || next === 'b' || next === 'B')) {
          j += 2;
          while (j < len && /[0-9a-fA-F_]/.test(src[j]!)) j++;
        } else {
          while (j < len && /[0-9_.]/.test(src[j]!)) j++;
          if (j < len && (src[j] === 'e' || src[j] === 'E')) {
            j++;
            if (j < len && (src[j] === '+' || src[j] === '-')) j++;
            while (j < len && /[0-9_]/.test(src[j]!)) j++;
          }
        }
        out += wrapSpan('tok-num', src.slice(i, j));
        i = j;
        continue;
      }

      // 5. Identifiers, control statements, keywords, globals, types, properties, function calls
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i + 1;
        while (j < len && /[a-zA-Z0-9_]/.test(src[j]!)) j++;
        const word = src.slice(i, j);

        // Look ahead for '(' or ':' (skipping spaces/tabs)
        let k = j;
        while (k < len && (src[k] === ' ' || src[k] === '\t')) k++;
        const followedByParen = src[k] === '(';
        const followedByColon = src[k] === ':' && src[k + 1] !== ':';

        // Check preceding non-space character
        const prevChar = i > 0 ? src[i - 1] : '';
        const precededByMemberOp =
          prevChar === '.' || (prevChar === ':' && (i < 2 || src[i - 2] !== ':'));

        if (CONTROL_KEYWORDS.has(word)) {
          out += wrapSpan('tok-ctrl', word);
        } else if (DECLARATION_KEYWORDS.has(word)) {
          out += wrapSpan('tok-kw', word);
        } else if (BOOLEAN_AND_LITERAL_KEYWORDS.has(word)) {
          out += wrapSpan('tok-bool', word);
        } else if (GLOBALS.has(word)) {
          out += wrapSpan('tok-glob', word);
        } else if (followedByParen) {
          out += wrapSpan('tok-fn', word);
        } else if (TYPE_KEYWORDS.has(word)) {
          out += wrapSpan('tok-type', word);
        } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word) && /[a-z]/.test(word)) {
          // PascalCase class / type / service / module name
          out += wrapSpan('tok-type', word);
        } else if (precededByMemberOp) {
          // Member property access (.Position, .Parent, .Humanoid)
          out += wrapSpan('tok-prop', word);
        } else if (
          followedByColon &&
          (normLang === 'yaml' || normLang === 'yml' || i === 0 || src[i - 1] === '\n' || src[i - 1] === ' ')
        ) {
          // YAML key or parameter/field key before ':'
          out += wrapSpan('tok-prop', word);
        } else {
          out += escapeHtml(word);
        }
        i = j;
        continue;
      }

      // 6. Operators
      if ('+-*/%^#=<>~:.|&!?'.includes(ch)) {
        let j = i + 1;
        while (j < len && '+-*/%^#=<>~:.|&!?'.includes(src[j]!)) j++;
        out += wrapSpan('tok-op', src.slice(i, j));
        i = j;
        continue;
      }

      // 7. Whitespace & punctuation
      out += escapeHtml(ch);
      i++;
    }

    return out;
  }
}
