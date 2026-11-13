import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, type DetectedLocalRuntimeDto } from '@robdev/shared';

const execFileAsync = promisify(execFile);

export interface ResolvedBinary {
  executablePath: string;
  argsPrefix?: string[];
  version: string | null;
  isNpxFallback?: boolean;
}

@Injectable()
export class LocalRuntimeDiscoveryService {
  private readonly logger = new Logger(LocalRuntimeDiscoveryService.name);
  private cachedRuntimes: { at: number; items: DetectedLocalRuntimeDto[] } | null = null;

  /**
   * Discover all locally installed CLI agents, desktop apps, and web browser runtimes.
   */
  async discoverAll(forceRefresh = false): Promise<DetectedLocalRuntimeDto[]> {
    if (!forceRefresh && this.cachedRuntimes && Date.now() - this.cachedRuntimes.at < 15_000) {
      return this.cachedRuntimes.items;
    }

    const results = await Promise.all([
      this.detectAntigravity(),
      this.detectClaudeCode(),
      this.detectCodexCli(),
      this.detectGeminiApp(),
      this.detectClaudeApp(),
      this.detectGptApp(),
      this.detectClaudeWeb(),
      this.detectChatGptWeb(),
    ]);

    this.cachedRuntimes = { at: Date.now(), items: results };
    return results;
  }

  /**
   * Resolve the best executable path for a given provider, optionally overriding with connection.baseUrl.
   */
  async resolveExecutable(
    provider: LlmProvider,
    customBaseUrl?: string | null,
  ): Promise<ResolvedBinary | null> {
    const trimmed = customBaseUrl?.trim() ?? '';
    if (
      trimmed &&
      !trimmed.startsWith('http://') &&
      !trimmed.startsWith('https://') &&
      !trimmed.endsWith('://local')
    ) {
      const cleaned = trimmed.replace(/^file:\/\//i, '');
      if (fs.existsSync(cleaned)) {
        return { executablePath: cleaned, version: null };
      }
    }

    switch (provider) {
      case LlmProvider.CODEX:
        return this.findCodexBinary();
      case LlmProvider.CLAUDE_CODE:
        return this.findClaudeCodeBinary();
      case LlmProvider.ANTIGRAVITY:
        return this.findAntigravityBinary();
      case LlmProvider.GEMINI_APP:
        return this.findGeminiAppBinary();
      case LlmProvider.CLAUDE_APP:
        return this.findClaudeAppBinary();
      case LlmProvider.GPT_APP:
        return this.findGptAppBinary();
      default:
        return null;
    }
  }

  async findCodexBinary(): Promise<ResolvedBinary | null> {
    const onPath = await this.whichBinary('codex');
    if (onPath) {
      const version = await this.probeVersion(onPath, ['--version']);
      return { executablePath: onPath, version };
    }

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const codexBinRoot = path.join(localAppData, 'OpenAI', 'Codex', 'bin');
    if (fs.existsSync(codexBinRoot)) {
      try {
        const subdirs = fs.readdirSync(codexBinRoot, { withFileTypes: true });
        for (const entry of subdirs) {
          if (entry.isDirectory()) {
            const candidate = path.join(codexBinRoot, entry.name, 'codex.exe');
            if (fs.existsSync(candidate)) {
              const version = await this.probeVersion(candidate, ['--version']);
              return { executablePath: candidate, version };
            }
          } else if (entry.isFile() && entry.name.toLowerCase() === 'codex.exe') {
            const candidate = path.join(codexBinRoot, entry.name);
            const version = await this.probeVersion(candidate, ['--version']);
            return { executablePath: candidate, version };
          }
        }
      } catch {
        // ignore read errors
      }
    }

    // Check WindowsApps OpenAI.Codex_*
    const winAppsCandidate = this.findWindowsAppsBinary('OpenAI.Codex_', path.join('app', 'resources', 'codex.exe'));
    if (winAppsCandidate) {
      const version = await this.probeVersion(winAppsCandidate, ['--version']);
      return { executablePath: winAppsCandidate, version };
    }

    return null;
  }

  async findClaudeCodeBinary(): Promise<ResolvedBinary | null> {
    const onPath = await this.whichBinary('claude');
    if (onPath) {
      const version = await this.probeVersion(onPath, ['--version']);
      return { executablePath: onPath, version };
    }

    const home = os.homedir();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    const candidates = [
      path.join(home, '.claude', 'local', process.platform === 'win32' ? 'claude.exe' : 'claude'),
      path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
      path.join(appData, 'npm', process.platform === 'win32' ? 'claude.cmd' : 'claude'),
      path.join(localAppData, 'Programs', 'claude-code', 'claude.exe'),
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const version = await this.probeVersion(candidate, ['--version']);
        return { executablePath: candidate, version };
      }
    }

    // Fallback to npx @anthropic-ai/claude-code if npx is available
    const npxPath = await this.whichBinary(process.platform === 'win32' ? 'npx.cmd' : 'npx');
    if (npxPath) {
      return {
        executablePath: npxPath,
        argsPrefix: ['--yes', '@anthropic-ai/claude-code'],
        version: 'npx (@anthropic-ai/claude-code)',
        isNpxFallback: true,
      };
    }

    return null;
  }

  async findAntigravityBinary(): Promise<ResolvedBinary | null> {
    const agyCli = await this.whichBinary('agy');
    if (agyCli) {
      const version = await this.probeVersion(agyCli, ['--version']);
      return { executablePath: agyCli, version };
    }

    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    const candidates = [
      path.join(localAppData, 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(localAppData, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(localAppData, 'Programs', 'Antigravity IDE', 'bin', 'antigravity-ide.cmd'),
      '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        const versionFile = path.join(path.dirname(candidate), 'version');
        let version: string | null = null;
        if (fs.existsSync(versionFile)) {
          try {
            version = fs.readFileSync(versionFile, 'utf8').trim();
          } catch {
            version = null;
          }
        }
        return { executablePath: candidate, version };
      }
    }

    return null;
  }

  async findGeminiAppBinary(): Promise<ResolvedBinary | null> {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const geminiDir = path.join(localAppData, 'Google', 'Gemini');

    const directExe = path.join(geminiDir, 'Gemini.exe');
    if (fs.existsSync(directExe)) {
      return { executablePath: directExe, version: this.findAppFolderVersion(geminiDir) };
    }

    if (fs.existsSync(geminiDir)) {
      try {
        const entries = fs.readdirSync(geminiDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory() && e.name.startsWith('app-')) {
            const candidate = path.join(geminiDir, e.name, 'Gemini.exe');
            if (fs.existsSync(candidate)) {
              return { executablePath: candidate, version: e.name.replace(/^app-/, '') };
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const macCandidate = '/Applications/Gemini.app/Contents/MacOS/Gemini';
    if (fs.existsSync(macCandidate)) {
      return { executablePath: macCandidate, version: null };
    }

    return null;
  }

  async findClaudeAppBinary(): Promise<ResolvedBinary | null> {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const username = os.userInfo().username;

    const dirsToCheck = [
      path.join('C:\\ProgramData', username, 'AnthropicClaude'),
      'C:\\ProgramData\\AnthropicClaude',
      path.join(localAppData, 'AnthropicClaude'),
      path.join(localAppData, 'Programs', 'claude-desktop'),
    ];

    for (const dir of dirsToCheck) {
      if (!fs.existsSync(dir)) continue;

      // Prefer the actual Electron binary inside the newest `app-<version>` folder
      // rather than the root Squirrel launcher stub (`claude.exe`), so CDP flags work directly.
      try {
        const appDirs = fs
          .readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && e.name.startsWith('app-'))
          .map((e) => e.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

        for (const appSub of appDirs) {
          const subExe = path.join(dir, appSub, 'claude.exe');
          if (fs.existsSync(subExe)) {
            return {
              executablePath: subExe,
              version: appSub.replace(/^app-/, ''),
            };
          }
          const subCapExe = path.join(dir, appSub, 'Claude.exe');
          if (fs.existsSync(subCapExe)) {
            return {
              executablePath: subCapExe,
              version: appSub.replace(/^app-/, ''),
            };
          }
        }
      } catch {
        // ignore directory scan errors
      }

      const exe = path.join(dir, 'claude.exe');
      if (fs.existsSync(exe)) {
        return { executablePath: exe, version: this.findAppFolderVersion(dir) };
      }
      const capExe = path.join(dir, 'Claude.exe');
      if (fs.existsSync(capExe)) {
        return { executablePath: capExe, version: this.findAppFolderVersion(dir) };
      }
    }

    const macCandidate = '/Applications/Claude.app/Contents/MacOS/Claude';
    if (fs.existsSync(macCandidate)) {
      return { executablePath: macCandidate, version: null };
    }

    return null;
  }

  async findGptAppBinary(): Promise<ResolvedBinary | null> {
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

    const directCandidates = [
      path.join(localAppData, 'Programs', 'ChatGPT', 'ChatGPT.exe'),
      path.join(localAppData, 'OpenAI', 'ChatGPT', 'ChatGPT.exe'),
      '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT',
    ];

    for (const candidate of directCandidates) {
      if (fs.existsSync(candidate)) {
        return { executablePath: candidate, version: null };
      }
    }

    const winAppsChatGpt =
      this.findWindowsAppsBinary('OpenAI.Codex_', path.join('app', 'ChatGPT.exe')) ||
      this.findWindowsAppsBinary('OpenAI.ChatGPT', path.join('app', 'ChatGPT.exe'));
    if (winAppsChatGpt) {
      return { executablePath: winAppsChatGpt, version: 'Windows Store App' };
    }

    return null;
  }

  private async detectAntigravity(): Promise<DetectedLocalRuntimeDto> {
    const bin = await this.findAntigravityBinary();
    const home = os.homedir();
    const hasConfig =
      fs.existsSync(path.join(home, '.gemini', 'antigravity')) ||
      fs.existsSync(path.join(process.env.APPDATA || '', 'Antigravity'));

    return {
      provider: LlmProvider.ANTIGRAVITY,
      name: 'Antigravity (IDE / Agent CLI)',
      category: 'desktop-app',
      installed: Boolean(bin),
      executablePath: bin?.executablePath ?? null,
      version: bin?.version ?? null,
      authenticated: Boolean(bin && hasConfig),
      defaultModel: 'gemini-3.1-pro-high',
      models: [
        'agy-auto',
        'gemini-3.1-pro-high',
        'gemini-3.1-pro-low',
        'gemini-3-flash',
        'claude-sonnet-4-6',
        'claude-opus-4-6-thinking',
        'gpt-oss-120b-medium',
      ],
      notes: bin
        ? `Detected at ${bin.executablePath}`
        : 'Install Google Antigravity IDE or agy CLI to run agents through Antigravity.',
    };
  }

  private async detectClaudeCode(): Promise<DetectedLocalRuntimeDto> {
    const bin = await this.findClaudeCodeBinary();
    const home = os.homedir();
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    const hasSession =
      fs.existsSync(path.join(home, '.claude.json')) ||
      fs.existsSync(path.join(home, '.claude')) ||
      fs.existsSync(path.join(appData, 'Claude', 'claude-code-sessions'));

    return {
      provider: LlmProvider.CLAUDE_CODE,
      name: 'Claude Code CLI',
      category: 'cli',
      installed: Boolean(bin),
      executablePath: bin
        ? bin.argsPrefix
          ? `${bin.executablePath} ${bin.argsPrefix.join(' ')}`
          : bin.executablePath
        : null,
      version: bin?.version ?? null,
      authenticated: Boolean(hasSession),
      defaultModel: 'claude-sonnet-4-6',
      models: [
        'claude-sonnet-4-6',
        'claude-opus-4-6',
        'claude-haiku-4-5',
        'sonnet',
        'opus',
        'haiku',
      ],
      notes: bin
        ? bin.isNpxFallback
          ? 'Ready via npx @anthropic-ai/claude-code (or install globally via npm i -g @anthropic-ai/claude-code).'
          : `Detected Claude Code CLI at ${bin.executablePath}`
        : 'Install Node.js/npx or run npm install -g @anthropic-ai/claude-code.',
    };
  }

  private async detectCodexCli(): Promise<DetectedLocalRuntimeDto> {
    const bin = await this.findCodexBinary();
    const home = os.homedir();
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const hasAuth =
      fs.existsSync(path.join(home, '.codex', 'auth.json')) ||
      fs.existsSync(path.join(localAppData, 'OpenAI', 'Codex'));

    return {
      provider: LlmProvider.CODEX,
      name: 'OpenAI Codex CLI',
      category: 'cli',
      installed: Boolean(bin),
      executablePath: bin?.executablePath ?? null,
      version: bin?.version ?? null,
      authenticated: Boolean(bin && hasAuth),
      defaultModel: 'gpt-5.3-codex',
      models: [
        'codex-default',
        'gpt-5.3-codex',
        'gpt-5.2-codex',
        'gpt-5.4',
        'gpt-5.4-mini',
        'o3',
        'o4-mini',
      ],
      notes: bin
        ? `Detected Codex CLI (${bin.version || 'installed'}) at ${bin.executablePath}`
        : 'Install OpenAI Codex CLI (npm i -g @openai/codex) or the ChatGPT/Codex Windows App.',
    };
  }

  private async detectGeminiApp(): Promise<DetectedLocalRuntimeDto> {
    const bin = await this.findGeminiAppBinary();
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const hasProfile = fs.existsSync(path.join(appData, 'gemini'));

    return {
      provider: LlmProvider.GEMINI_APP,
      name: 'Gemini Desktop App',
      category: 'desktop-app',
      installed: Boolean(bin),
      executablePath: bin?.executablePath ?? null,
      version: bin?.version ?? null,
      authenticated: Boolean(bin && hasProfile),
      defaultModel: 'gemini-web-default',
      models: [
        'gemini-web-default',
        'gemini-web-flash',
        'gemini-web-thinking',
        'gemini-web-pro',
      ],
      notes: bin
        ? `Detected Gemini Desktop App ${bin.version ? `v${bin.version}` : ''} at ${bin.executablePath}`
        : 'Gemini Desktop App not found in %LOCALAPPDATA%\\Google\\Gemini.',
    };
  }

  private async detectClaudeApp(): Promise<DetectedLocalRuntimeDto> {
    const bin = await this.findClaudeAppBinary();
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const hasProfile = fs.existsSync(path.join(appData, 'Claude'));

    return {
      provider: LlmProvider.CLAUDE_APP,
      name: 'Claude Desktop App',
      category: 'desktop-app',
      installed: Boolean(bin),
      executablePath: bin?.executablePath ?? null,
      version: bin?.version ?? null,
      authenticated: Boolean(bin && hasProfile),
      defaultModel: 'claude-app-sonnet-4-6',
      models: [
        'claude-app-default',
        'claude-app-sonnet-4-6',
        'claude-app-opus-4-6',
        'claude-app-haiku-4-5',
        'claude-app-sonnet-4-6:thinking',
        'claude-app-opus-4-6:thinking',
      ],
      notes: bin
        ? `Detected Claude Desktop App ${bin.version ? `v${bin.version}` : ''} at ${bin.executablePath}`
        : 'Claude Desktop App not found in %LOCALAPPDATA%\\AnthropicClaude.',
    };
  }

  private async detectGptApp(): Promise<DetectedLocalRuntimeDto> {
    const bin = await this.findGptAppBinary();
    return {
      provider: LlmProvider.GPT_APP,
      name: 'ChatGPT Desktop App (GPT App)',
      category: 'desktop-app',
      installed: Boolean(bin),
      executablePath: bin?.executablePath ?? null,
      version: bin?.version ?? null,
      authenticated: Boolean(bin),
      defaultModel: 'gpt-app-default',
      models: [
        'gpt-app-default',
        'gpt-app-gpt-5-4',
        'gpt-app-gpt-5-3-instant',
        'gpt-app-gpt-5-4-thinking',
        'gpt-app-gpt-5-4-pro',
        'gpt-app-o3',
        'gpt-app-o4-mini',
      ],
      notes: bin
        ? `Detected ChatGPT Desktop App at ${bin.executablePath}`
        : 'ChatGPT Desktop App not detected; will launch dedicated Chromium Desktop App window for chatgpt.com.',
    };
  }

  private async detectClaudeWeb(): Promise<DetectedLocalRuntimeDto> {
    return {
      provider: LlmProvider.CLAUDE_WEB,
      name: 'Claude Web (claude.ai Browser Session)',
      category: 'web-session',
      installed: true,
      executablePath: 'https://claude.ai/new',
      version: 'Playwright Chromium',
      authenticated: false,
      defaultModel: 'claude-web-sonnet-4-6',
      models: [
        'claude-web-default',
        'claude-web-sonnet-4-6',
        'claude-web-opus-4-6',
        'claude-web-haiku-4-5',
        'claude-web-sonnet-4-6:thinking',
        'claude-web-opus-4-6:thinking',
      ],
      notes: 'Uses persistent Playwright browser profile for https://claude.ai/new (no API key needed).',
    };
  }

  private async detectChatGptWeb(): Promise<DetectedLocalRuntimeDto> {
    return {
      provider: LlmProvider.CHATGPT_WEB,
      name: 'ChatGPT Web (chatgpt.com Browser Session)',
      category: 'web-session',
      installed: true,
      executablePath: 'https://chatgpt.com',
      version: 'Playwright Chromium',
      authenticated: false,
      defaultModel: 'chatgpt-web-default',
      models: [
        'chatgpt-web-default',
        'chatgpt-web-gpt-5-4',
        'chatgpt-web-gpt-5-3-instant',
        'chatgpt-web-gpt-5-4-thinking',
        'chatgpt-web-gpt-5-4-pro',
        'chatgpt-web-o3',
        'chatgpt-web-o4-mini',
      ],
      notes: 'Uses persistent Playwright browser profile for https://chatgpt.com (no API key needed).',
    };
  }

  private async whichBinary(name: string): Promise<string | null> {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    try {
      const { stdout } = await execFileAsync(cmd, [name], { timeout: 3000 });
      const firstLine = stdout
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0 && fs.existsSync(l));
      return firstLine ?? null;
    } catch {
      return null;
    }
  }

  private async probeVersion(exe: string, args: string[]): Promise<string | null> {
    try {
      const { stdout, stderr } = await execFileAsync(exe, args, {
        timeout: 4000,
        windowsHide: true,
      });
      const out = (stdout || stderr || '').trim().split(/\r?\n/)[0]?.trim();
      return out || null;
    } catch {
      return null;
    }
  }

  private findAppFolderVersion(appRootDir: string): string | null {
    if (!fs.existsSync(appRootDir)) return null;
    try {
      const entries = fs.readdirSync(appRootDir, { withFileTypes: true });
      const appDirs = entries
        .filter((e) => e.isDirectory() && e.name.startsWith('app-'))
        .map((e) => e.name.replace(/^app-/, ''))
        .sort();
      return appDirs.length > 0 ? appDirs[appDirs.length - 1]! : null;
    } catch {
      return null;
    }
  }

  private findWindowsAppsBinary(packagePrefix: string, relativeExePath: string): string | null {
    const winAppsRoot = 'C:\\Program Files\\WindowsApps';
    if (!fs.existsSync(winAppsRoot)) return null;
    try {
      const dirs = fs.readdirSync(winAppsRoot, { withFileTypes: true });
      for (const dir of dirs) {
        if (dir.isDirectory() && dir.name.startsWith(packagePrefix)) {
          const candidate = path.join(winAppsRoot, dir.name, relativeExePath);
          if (fs.existsSync(candidate)) {
            return candidate;
          }
        }
      }
    } catch {
      // If WindowsApps directory listing is restricted, try PowerShell Get-AppxPackage
    }
    return null;
  }
}
