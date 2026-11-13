import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  LlmProvider,
  type BrowserSessionStatusDto,
  type BrowserVisibilityStatusDto,
  type DeleteWebChatsResultDto,
  type LlmModelInfoDto,
} from '@robdev/shared';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { LocalRuntimeDiscoveryService } from '../local-runtime-discovery.service.js';
import {
  LlmError,
  type BoundLlmAdapter,
  type LlmAdapter,
  type LlmStreamEvent,
  type LlmStreamRequest,
  type ResolvedConnection,
} from './llm-adapter.interface.js';
import {
  PromptToolBridge,
  extractToolCallsFromText,
  formatFollowUpUserPromptForWebUi,
  formatSinglePromptForWebUi,
  injectToolsIntoMessages,
} from './prompt-tool-bridge.js';

export const CLAUDE_WEB_MODELS: LlmModelInfoDto[] = [
  {
    id: 'claude-web-sonnet-4-6',
    displayName: 'Claude Web · Sonnet 4.6',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-web-sonnet-4-6:thinking',
    displayName: 'Claude Web · Sonnet 4.6 (Extended Thinking)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-web-opus-4-6',
    displayName: 'Claude Web · Opus 4.6',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-web-opus-4-6:thinking',
    displayName: 'Claude Web · Opus 4.6 (Extended Thinking)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-web-haiku-4-5',
    displayName: 'Claude Web · Haiku 4.5 (Fast)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-web-default',
    displayName: 'Claude Web · Default Model',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
];

export const CLAUDE_APP_MODELS: LlmModelInfoDto[] = [
  {
    id: 'claude-app-sonnet-4-6',
    displayName: 'Claude App · Sonnet 4.6',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-app-sonnet-4-6:thinking',
    displayName: 'Claude App · Sonnet 4.6 (Extended Thinking)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-app-opus-4-6',
    displayName: 'Claude App · Opus 4.6',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-app-opus-4-6:thinking',
    displayName: 'Claude App · Opus 4.6 (Extended Thinking)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-app-haiku-4-5',
    displayName: 'Claude App · Haiku 4.5 (Fast)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-app-default',
    displayName: 'Claude App · Default Model',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
];

interface ActiveClaudeRunPage {
  page: Page;
  ctx: BrowserContext;
  runId: string;
  studioId?: string;
  webChatSessionId: string | null;
  isAppMode: boolean;
}

@Injectable()
export class ClaudeWebBrowserAdapter implements LlmAdapter, OnModuleDestroy {
  private readonly logger = new Logger(ClaudeWebBrowserAdapter.name);
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly activeRunPages = new Map<string, ActiveClaudeRunPage>();
  private desktopAppProcess: ChildProcess | null = null;
  private manualVisibilityOverride: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: LocalRuntimeDiscoveryService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    for (const ctx of this.contexts.values()) {
      await ctx.close().catch(() => {});
    }
    this.contexts.clear();
    if (this.desktopAppProcess) {
      try {
        this.desktopAppProcess.kill();
      } catch {
        // ignore
      }
      this.desktopAppProcess = null;
    }
  }

  bind(connection: ResolvedConnection): BoundLlmAdapter {
    return {
      listModels: () => this.listModels(connection),
      stream: (req, signal) => this.stream(connection, req, signal),
    };
  }

  async listModels(connection: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    return connection.provider === LlmProvider.CLAUDE_APP
      ? CLAUDE_APP_MODELS
      : CLAUDE_WEB_MODELS;
  }

  private profileDirFor(isAppMode: boolean): string {
    const base = path.resolve(process.cwd(), '.browser-profiles');
    return path.join(base, isAppMode ? 'claude-app' : 'claude-web');
  }

  async getSessionStatus(conn: ResolvedConnection): Promise<BrowserSessionStatusDto> {
    const isApp = conn.provider === LlmProvider.CLAUDE_APP;
    const profileDir = this.profileDirFor(isApp);
    const markerPath = path.join(profileDir, '.session-verified.json');
    let authenticated = false;

    try {
      await fs.access(markerPath);
      authenticated = true;
    } catch {
      if (isApp) {
        const bin = await this.discovery.findClaudeAppBinary();
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const hasClaudeData = await fs
          .access(path.join(appData, 'Claude'))
          .then(() => true)
          .catch(() => false);
        authenticated = Boolean(bin && hasClaudeData);
      }
    }

    return {
      authenticated,
      targetUrl: 'https://claude.ai/new',
      profileDir,
      message: authenticated
        ? isApp
          ? 'Claude Desktop App session is ready.'
          : 'Claude Web browser session is signed in and ready.'
        : 'Click "Sign In" to authenticate with your Claude account in the persistent browser window.',
    };
  }

  async launchInteractiveSignIn(conn: ResolvedConnection): Promise<BrowserSessionStatusDto> {
    const isApp = conn.provider === LlmProvider.CLAUDE_APP;
    const profileDir = this.profileDirFor(isApp);
    await fs.mkdir(profileDir, { recursive: true });

    const { ctx, page } = await this.acquireContextAndPage(isApp, profileDir, true);
    await this.applyWindowVisibility(ctx, page, true);
    await page.goto('https://claude.ai/new', {
      waitUntil: 'domcontentloaded',
      timeout: 45_000,
    });

    const startMs = Date.now();
    let authenticated = false;
    while (Date.now() - startMs < 240_000 && !page.isClosed()) {
      const hasComposer = await this.isComposerReady(page);
      if (hasComposer) {
        authenticated = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (authenticated) {
      await fs.writeFile(
        path.join(profileDir, '.session-verified.json'),
        JSON.stringify({ verifiedAt: new Date().toISOString() }),
        'utf8',
      );
    }

    return {
      authenticated,
      targetUrl: 'https://claude.ai/new',
      profileDir,
      message: authenticated
        ? 'Claude session verified and saved to persistent profile.'
        : 'Sign-in window closed before composer was detected.',
    };
  }

  async setBrowserVisibility(
    _studioId: string,
    visible: boolean,
  ): Promise<BrowserVisibilityStatusDto> {
    this.manualVisibilityOverride = visible;
    for (const ctx of this.contexts.values()) {
      const pages = ctx.pages().filter((p) => !p.isClosed());
      const activePage = pages[pages.length - 1] ?? pages[0];
      if (activePage) {
        await this.applyWindowVisibility(ctx, activePage, visible);
      }
    }
    return {
      visible,
      browserHeadlessSetting: !visible,
      activeContexts: this.contexts.size,
      message: visible ? 'Claude window is now visible.' : 'Claude window is now hidden.',
    };
  }

  async finalizeRunSession(runId: string, _studioId: string): Promise<void> {
    const entry = this.activeRunPages.get(runId);
    if (!entry) return;
    this.activeRunPages.delete(runId);
    try {
      if (!entry.page.isClosed() && entry.ctx.pages().length > 1) {
        await entry.page.close().catch(() => {});
      }
    } catch {
      // ignore
    }
  }

  async deleteWebChatSessions(
    studioId: string,
    sessionIds?: string[],
  ): Promise<DeleteWebChatsResultDto> {
    const where: Record<string, unknown> = {
      studioId,
      platform: { in: ['claude-web', 'claude-app'] },
      status: 'ACTIVE',
    };
    if (sessionIds && sessionIds.length > 0) {
      where.id = { in: sessionIds };
    }

    const sessions = await this.prisma.webChatSession.findMany({ where });
    let deletedCount = 0;

    for (const s of sessions) {
      await this.prisma.webChatSession
        .update({
          where: { id: s.id },
          data: { status: 'DELETED', deletedFromWebAt: new Date() },
        })
        .catch(() => {});
      deletedCount++;
    }

    return {
      deletedFromWebCount: deletedCount,
      totalProcessed: sessions.length,
      message: `Removed ${deletedCount} Claude chat session(s).`,
    };
  }

  async *stream(
    connection: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const isApp = connection.provider === LlmProvider.CLAUDE_APP;
    const profileDir = this.profileDirFor(isApp);
    await fs.mkdir(profileDir, { recursive: true });

    const showWindow = await this.shouldShowWindow(req.studioId);
    const hasTools = req.tools.length > 0;
    const bridgedMessages = injectToolsIntoMessages(req.messages, req.tools);
    const isFollowUpTurn = (req.turnIndex ?? 0) > 0 && Boolean(req.runId);
    const promptText = isFollowUpTurn
      ? formatFollowUpUserPromptForWebUi(bridgedMessages, hasTools)
      : formatSinglePromptForWebUi(bridgedMessages, hasTools);

    yield {
      type: 'status',
      statusText: isApp
        ? 'Opening Claude Desktop App session...'
        : 'Opening Claude Web browser session...',
    };

    let page: Page;
    let ctx: BrowserContext;
    const existingRunEntry = req.runId ? this.activeRunPages.get(req.runId) : undefined;

    if (existingRunEntry && !existingRunEntry.page.isClosed()) {
      page = existingRunEntry.page;
      ctx = existingRunEntry.ctx;
    } else {
      const acquired = await this.acquireContextAndPage(isApp, profileDir, showWindow);
      ctx = acquired.ctx;
      page = acquired.page;
      await this.applyWindowVisibility(ctx, page, showWindow);
      await page.goto('https://claude.ai/new', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
    }

    const ready = await this.waitForComposer(page, 25_000);
    if (!ready) {
      // Make window visible so user can sign in if needed
      await this.applyWindowVisibility(ctx, page, true);
      yield {
        type: 'status',
        statusText: 'Waiting for Claude sign-in in browser window...',
      };
      const signedIn = await this.waitForComposer(page, 180_000);
      if (!signedIn) {
        throw new LlmError(
          'PROVIDER_AUTH_FAILED',
          'Claude session is not signed in. Click "Sign In" on the Claude connection in Settings → Models.',
        );
      }
      await fs.writeFile(
        path.join(profileDir, '.session-verified.json'),
        JSON.stringify({ verifiedAt: new Date().toISOString() }),
        'utf8',
      );
    }

    if (!isFollowUpTurn) {
      await this.trySelectClaudeModel(page, req.model);
    }

    const previousAssistantCount = await this.countAssistantMessages(page);

    yield {
      type: 'status',
      statusText: 'Submitting prompt to Claude...',
    };

    await this.fillAndSubmitComposer(page, promptText);

    // Record WebChatSession in DB if needed
    if (req.runId && req.studioId && req.agentId && req.agentKey && !existingRunEntry) {
      const currentUrl = page.url();
      const externalId = currentUrl.split('/').pop() || `claude-${Date.now()}`;
      const created = await this.prisma.webChatSession
        .create({
          data: {
            studioId: req.studioId,
            runId: req.runId,
            taskId: req.taskId ?? null,
            rootTaskId: req.rootTaskId ?? null,
            agentId: req.agentId,
            agentKey: req.agentKey,
            platform: isApp ? 'claude-app' : 'claude-web',
            guestMode: false,
            externalChatId: externalId,
            chatTitle: req.taskTitle || `${req.agentName || req.agentKey} — Claude Session`,
            chatUrl: currentUrl,
            status: 'ACTIVE',
          },
        })
        .catch(() => null);

      this.activeRunPages.set(req.runId, {
        page,
        ctx,
        runId: req.runId,
        studioId: req.studioId,
        webChatSessionId: created?.id ?? null,
        isAppMode: isApp,
      });
    }

    // Stream response
    let lastText = '';
    let stableTicks = 0;
    const startMs = Date.now();
    const thinkingStartedAt = new Date().toISOString();

    while (Date.now() - startMs < 240_000 && !signal.aborted) {
      await new Promise((r) => setTimeout(r, 800));

      const state = await this.readLatestResponseState(page, previousAssistantCount);
      if (state.thinkingText) {
        yield {
          type: 'thinking',
          text: state.thinkingText,
          startedAt: thinkingStartedAt,
          durationMs: Math.max(0, Date.now() - startMs),
          done: !state.isStreaming,
        };
      }

      if (state.text && state.text !== lastText) {
        lastText = state.text;
        stableTicks = 0;
        const streamable = PromptToolBridge.computeStreamableText(lastText);
        yield { type: 'text-delta', text: streamable, replace: true };
      } else if (lastText.length > 0 && !state.isStreaming) {
        stableTicks++;
        if (stableTicks >= 3) break;
      }
    }

    // Update chat URL if it changed from /new to /chat/<uuid>
    const activeEntry = req.runId ? this.activeRunPages.get(req.runId) : undefined;
    if (activeEntry?.webChatSessionId && page.url().includes('/chat/')) {
      const chatUrl = page.url();
      const externalChatId = chatUrl.split('/chat/')[1]?.split('?')[0] ?? chatUrl;
      await this.prisma.webChatSession
        .update({
          where: { id: activeEntry.webChatSessionId },
          data: { chatUrl, externalChatId },
        })
        .catch(() => {});
    }

    const { cleanText, toolCalls } = extractToolCallsFromText(lastText);
    if (cleanText !== lastText) {
      yield { type: 'text-delta', text: cleanText, replace: true };
    }

    for (const tc of toolCalls) {
      yield { type: 'tool-call', call: tc };
    }

    yield {
      type: 'finish',
      reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  private async acquireContextAndPage(
    isAppMode: boolean,
    profileDir: string,
    visible: boolean,
  ): Promise<{ ctx: BrowserContext; page: Page }> {
    const key = isAppMode ? 'claude-app' : 'claude-web';
    const existing = this.contexts.get(key);
    if (existing) {
      const openPages = existing.pages().filter((p) => !p.isClosed());
      if (openPages.length > 0) {
        return { ctx: existing, page: openPages[openPages.length - 1]! };
      }
      try {
        const page = await existing.newPage();
        return { ctx: existing, page };
      } catch {
        this.contexts.delete(key);
      }
    }

    // If Claude Desktop App mode is selected, try launching/attaching to claude.exe via CDP first
    if (isAppMode) {
      const cdpConnected = await this.tryConnectClaudeDesktopApp(profileDir);
      if (cdpConnected) {
        this.contexts.set(key, cdpConnected.ctx);
        return cdpConnected;
      }
    }

    const args = [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--test-type=',
      ...(isAppMode ? ['--app=https://claude.ai/new'] : []),
      ...(visible ? ['--window-position=80,60', '--window-size=1280,860'] : ['--window-position=-32000,-32000']),
    ];

    const channels: Array<'chrome' | 'msedge' | undefined> = ['chrome', 'msedge', undefined];
    let ctx: BrowserContext | null = null;
    let lastErr: unknown = null;

    for (const channel of channels) {
      try {
        ctx = await chromium.launchPersistentContext(profileDir, {
          headless: false,
          chromiumSandbox: true,
          viewport: null,
          colorScheme: 'dark',
          ignoreDefaultArgs: ['--no-sandbox', '--enable-automation'],
          ...(channel ? { channel } : {}),
          args,
        });
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!ctx) {
      this.logger.error(`Could not launch browser context for Claude: ${String(lastErr)}`);
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        'Could not launch Chrome or Edge for Claude session. Ensure Google Chrome or Microsoft Edge is installed.',
      );
    }

    this.contexts.set(key, ctx);
    const pages = ctx.pages();
    const page = pages[0] ?? (await ctx.newPage());
    return { ctx, page };
  }

  private async seedProfileFromClaudeDesktopAppData(profileDir: string): Promise<void> {
    try {
      const seedMarker = path.join(profileDir, '.seeded-from-claude-desktop');
      const alreadySeeded = await fs
        .access(seedMarker)
        .then(() => true)
        .catch(() => false);
      if (alreadySeeded) return;

      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const claudeAppData = path.join(appData, 'Claude');
      const hasClaudeData = await fs
        .access(claudeAppData)
        .then(() => true)
        .catch(() => false);
      if (!hasClaudeData) return;

      await fs.mkdir(profileDir, { recursive: true });
      for (const item of ['Local State', 'Preferences', 'Network', 'Local Storage', 'Session Storage']) {
        const src = path.join(claudeAppData, item);
        const dest = path.join(profileDir, item);
        await fs.cp(src, dest, { recursive: true, force: false }).catch(() => {});
      }
      await fs.writeFile(seedMarker, new Date().toISOString(), 'utf8').catch(() => {});
    } catch {
      // non-fatal if files are locked
    }
  }

  private async tryConnectClaudeDesktopApp(
    profileDir: string,
  ): Promise<{ ctx: BrowserContext; page: Page } | null> {
    await this.seedProfileFromClaudeDesktopAppData(profileDir);
    const bin = await this.discovery.findClaudeAppBinary();
    if (!bin) return null;

    const cdpPort = 9234;
    try {
      if (!this.desktopAppProcess || this.desktopAppProcess.exitCode !== null) {
        this.desktopAppProcess = spawn(
          bin.executablePath,
          [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`],
          { detached: false, stdio: 'ignore', windowsHide: false },
        );
        await new Promise((r) => setTimeout(r, 2500));
      }

      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
        timeout: 4000,
      });
      const ctx = browser.contexts()[0];
      if (!ctx) return null;
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      return { ctx, page };
    } catch (err) {
      this.logger.debug(
        `Claude Desktop App direct CDP attachment unavailable (${String(err)}), using Chrome/Edge app-mode window.`,
      );
      return null;
    }
  }

  private async shouldShowWindow(studioId?: string): Promise<boolean> {
    if (this.manualVisibilityOverride !== null) return this.manualVisibilityOverride;
    if (!studioId) return false;
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { browserHeadless: true },
    });
    return studio ? !studio.browserHeadless : false;
  }

  private async applyWindowVisibility(
    ctx: BrowserContext,
    page: Page,
    visible: boolean,
  ): Promise<void> {
    try {
      const cdp = await ctx.newCDPSession(page);
      const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as {
        windowId: number;
      };
      if (visible) {
        await cdp
          .send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'normal', left: 100, top: 70, width: 1280, height: 860 },
          })
          .catch(() => {});
        await page.bringToFront().catch(() => {});
      } else {
        await cdp
          .send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'minimized' },
          })
          .catch(() => {});
      }
      await cdp.detach().catch(() => {});
    } catch {
      // ignore if CDP bounds unsupported
    }
  }

  private async isComposerReady(page: Page): Promise<boolean> {
    try {
      const count = await page
        .locator(
          'div.ProseMirror[contenteditable="true"], fieldset div[contenteditable="true"], [data-testid="chat-input"]',
        )
        .count();
      return count > 0;
    } catch {
      return false;
    }
  }

  private async waitForComposer(page: Page, timeoutMs: number): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs && !page.isClosed()) {
      if (await this.isComposerReady(page)) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  private async trySelectClaudeModel(page: Page, modelId: string): Promise<void> {
    try {
      const lower = (modelId || '').toLowerCase();
      if (!lower || lower.endsWith('-default')) return;

      let targetLabel = 'Sonnet';
      if (lower.includes('opus')) targetLabel = 'Opus';
      else if (lower.includes('haiku')) targetLabel = 'Haiku';

      const selectorBtn = page
        .locator('button[data-testid="model-selector-dropdown"], button:has-text("Claude"), button:has-text("Sonnet"), button:has-text("Opus")')
        .first();
      if ((await selectorBtn.count()) > 0) {
        await selectorBtn.click({ timeout: 2000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        const option = page
          .locator(`[role="menuitem"]:has-text("${targetLabel}"), [role="option"]:has-text("${targetLabel}")`)
          .first();
        if ((await option.count()) > 0) {
          await option.click({ timeout: 2000 }).catch(() => {});
        } else {
          await page.keyboard.press('Escape').catch(() => {});
        }
      }
    } catch {
      // Non-fatal if model selector UI differs
    }
  }

  private async countAssistantMessages(page: Page): Promise<number> {
    return page
      .locator('.font-claude-message, [data-testid="assistant-message"], [data-is-streaming]')
      .count()
      .catch(() => 0);
  }

  private async fillAndSubmitComposer(page: Page, promptText: string): Promise<void> {
    const composer = page
      .locator(
        'div.ProseMirror[contenteditable="true"], fieldset div[contenteditable="true"], [data-testid="chat-input"]',
      )
      .first();

    await composer.click({ timeout: 5000 });
    await composer.fill(promptText).catch(async () => {
      await page.keyboard.insertText(promptText);
    });

    await new Promise((r) => setTimeout(r, 300));

    const sendBtn = page
      .locator(
        'button[aria-label="Send message"], button[aria-label="Send Message"], button[data-testid="send-button"]',
      )
      .first();
    if ((await sendBtn.count()) > 0 && (await sendBtn.isEnabled().catch(() => false))) {
      await sendBtn.click();
    } else {
      await page.keyboard.press('Enter');
    }
  }

  private async readLatestResponseState(
    page: Page,
    previousCount: number,
  ): Promise<{ text: string; thinkingText: string; isStreaming: boolean }> {
    return page
      .evaluate((prevCount) => {
        interface DomNode {
          innerText?: string;
        }
        const doc = (
          globalThis as unknown as {
            document?: {
              querySelector: (s: string) => DomNode | null;
              querySelectorAll: (s: string) => ArrayLike<DomNode>;
            };
          }
        ).document;
        if (!doc) return { text: '', thinkingText: '', isStreaming: false };

        const stopBtn = doc.querySelector(
          'button[aria-label="Stop response"], button[aria-label="Stop Response"], [data-is-streaming="true"]',
        );
        const isStreaming = Boolean(stopBtn);

        const msgNodes = Array.from(
          doc.querySelectorAll(
            '.font-claude-message, [data-testid="assistant-message"], [data-is-streaming]',
          ),
        );
        if (msgNodes.length <= prevCount && msgNodes.length === 0) {
          return { text: '', thinkingText: '', isStreaming };
        }
        const latest = msgNodes[msgNodes.length - 1];
        const text = latest ? (latest.innerText || '').trim() : '';

        const thinkingNodes = Array.from(
          doc.querySelectorAll('[data-testid*="thinking"], details summary'),
        );
        const lastThinking = thinkingNodes[thinkingNodes.length - 1];
        const thinkingText = lastThinking ? (lastThinking.innerText || '').trim() : '';

        return { text, thinkingText, isStreaming };
      }, previousCount)
      .catch(() => ({ text: '', thinkingText: '', isStreaming: false }));
  }
}
