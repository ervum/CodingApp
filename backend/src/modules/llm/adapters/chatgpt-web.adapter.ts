import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs/promises';
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
import { CodexCliAdapter } from './codex-cli.adapter.js';
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

export const CHATGPT_WEB_MODELS: LlmModelInfoDto[] = [
  {
    id: 'chatgpt-web-default',
    displayName: 'ChatGPT Web · Auto (Default)',
    contextWindow: 256_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'chatgpt-web-gpt-5-4',
    displayName: 'ChatGPT Web · GPT-5.4',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'chatgpt-web-gpt-5-3-instant',
    displayName: 'ChatGPT Web · GPT-5.3 Instant (Fast)',
    contextWindow: 256_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'chatgpt-web-gpt-5-4-thinking',
    displayName: 'ChatGPT Web · GPT-5.4 Thinking (Deep Reasoning)',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'chatgpt-web-gpt-5-4-pro',
    displayName: 'ChatGPT Web · GPT-5.4 Pro',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'chatgpt-web-o3',
    displayName: 'ChatGPT Web · OpenAI o3',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'chatgpt-web-o4-mini',
    displayName: 'ChatGPT Web · OpenAI o4-mini',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
];

export const GPT_APP_MODELS: LlmModelInfoDto[] = [
  {
    id: 'gpt-app-default',
    displayName: 'GPT App · Auto (Default)',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gpt-app-gpt-5-4',
    displayName: 'GPT App · GPT-5.4',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gpt-app-gpt-5-3-instant',
    displayName: 'GPT App · GPT-5.3 Instant',
    contextWindow: 256_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gpt-app-gpt-5-4-thinking',
    displayName: 'GPT App · GPT-5.4 Thinking',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gpt-app-gpt-5-4-pro',
    displayName: 'GPT App · GPT-5.4 Pro',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gpt-app-o3',
    displayName: 'GPT App · OpenAI o3',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gpt-app-o4-mini',
    displayName: 'GPT App · OpenAI o4-mini',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
];

interface ActiveChatGptRunPage {
  page: Page;
  ctx: BrowserContext;
  runId: string;
  studioId?: string;
  webChatSessionId: string | null;
  isAppMode: boolean;
}

@Injectable()
export class ChatGptWebBrowserAdapter implements LlmAdapter, OnModuleDestroy {
  private readonly logger = new Logger(ChatGptWebBrowserAdapter.name);
  private readonly contexts = new Map<string, BrowserContext>();
  private readonly activeRunPages = new Map<string, ActiveChatGptRunPage>();
  private desktopAppProcess: ChildProcess | null = null;
  private manualVisibilityOverride: boolean | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: LocalRuntimeDiscoveryService,
    private readonly codexCli: CodexCliAdapter,
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
    return connection.provider === LlmProvider.GPT_APP
      ? GPT_APP_MODELS
      : CHATGPT_WEB_MODELS;
  }

  private profileDirFor(isAppMode: boolean): string {
    const base = path.resolve(process.cwd(), '.browser-profiles');
    return path.join(base, isAppMode ? 'gpt-app' : 'chatgpt-web');
  }

  async getSessionStatus(conn: ResolvedConnection): Promise<BrowserSessionStatusDto> {
    const isApp = conn.provider === LlmProvider.GPT_APP;
    const profileDir = this.profileDirFor(isApp);
    const markerPath = path.join(profileDir, '.session-verified.json');
    let authenticated = false;

    try {
      await fs.access(markerPath);
      authenticated = true;
    } catch {
      if (isApp) {
        const appBin = await this.discovery.findGptAppBinary();
        const codexBin = await this.discovery.findCodexBinary();
        authenticated = Boolean(appBin || codexBin);
      }
    }

    return {
      authenticated,
      targetUrl: 'https://chatgpt.com',
      profileDir,
      message: authenticated
        ? isApp
          ? 'ChatGPT Desktop App (GPT App) is detected and ready.'
          : 'ChatGPT Web browser session is signed in and ready.'
        : 'Click "Sign In" to authenticate with your ChatGPT account in the persistent browser window.',
    };
  }

  async launchInteractiveSignIn(conn: ResolvedConnection): Promise<BrowserSessionStatusDto> {
    const isApp = conn.provider === LlmProvider.GPT_APP;
    const profileDir = this.profileDirFor(isApp);
    await fs.mkdir(profileDir, { recursive: true });

    const { ctx, page } = await this.acquireContextAndPage(isApp, profileDir, true);
    await this.applyWindowVisibility(ctx, page, true);
    await page.goto('https://chatgpt.com', {
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
      targetUrl: 'https://chatgpt.com',
      profileDir,
      message: authenticated
        ? 'ChatGPT session verified and saved to persistent profile.'
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
      message: visible ? 'ChatGPT window is now visible.' : 'ChatGPT window is now hidden.',
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
      platform: { in: ['chatgpt-web', 'gpt-app'] },
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
      message: `Removed ${deletedCount} ChatGPT chat session(s).`,
    };
  }

  async *stream(
    connection: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const isApp = connection.provider === LlmProvider.GPT_APP;
    const profileDir = this.profileDirFor(isApp);
    await fs.mkdir(profileDir, { recursive: true });

    // For GPT_APP: if the user hasn't signed into the web profile yet, check if the bundled
    // OpenAI Desktop App runtime (`codex.exe` inside WindowsApps\OpenAI.Codex_*) is ready and authenticated!
    if (isApp) {
      const markerExists = await fs
        .access(path.join(profileDir, '.session-verified.json'))
        .then(() => true)
        .catch(() => false);
      const codexBin = await this.discovery.findCodexBinary();
      if (!markerExists && codexBin) {
        const mappedModel = this.mapGptAppModelToCodex(req.model);
        yield {
          type: 'status',
          statusText: `Running via installed ChatGPT Desktop App engine (${mappedModel})...`,
        };
        yield* this.codexCli.stream(
          { ...connection, provider: LlmProvider.CODEX },
          { ...req, model: mappedModel },
          signal,
        );
        return;
      }
    }

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
        ? 'Opening ChatGPT Desktop App window...'
        : 'Opening ChatGPT Web browser session...',
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
      await page.goto('https://chatgpt.com', {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
    }

    const ready = await this.waitForComposer(page, 25_000);
    if (!ready) {
      await this.applyWindowVisibility(ctx, page, true);
      yield {
        type: 'status',
        statusText: 'Waiting for ChatGPT sign-in in browser window...',
      };
      const signedIn = await this.waitForComposer(page, 180_000);
      if (!signedIn) {
        throw new LlmError(
          'PROVIDER_AUTH_FAILED',
          'ChatGPT session is not signed in. Click "Sign In" on the ChatGPT connection in Settings → Models.',
        );
      }
      await fs.writeFile(
        path.join(profileDir, '.session-verified.json'),
        JSON.stringify({ verifiedAt: new Date().toISOString() }),
        'utf8',
      );
    }

    const previousAssistantCount = await this.countAssistantMessages(page);

    yield {
      type: 'status',
      statusText: 'Submitting prompt to ChatGPT...',
    };

    await this.fillAndSubmitComposer(page, promptText);

    if (req.runId && req.studioId && req.agentId && req.agentKey && !existingRunEntry) {
      const currentUrl = page.url();
      const externalId = currentUrl.split('/').pop() || `chatgpt-${Date.now()}`;
      const created = await this.prisma.webChatSession
        .create({
          data: {
            studioId: req.studioId,
            runId: req.runId,
            taskId: req.taskId ?? null,
            rootTaskId: req.rootTaskId ?? null,
            agentId: req.agentId,
            agentKey: req.agentKey,
            platform: isApp ? 'gpt-app' : 'chatgpt-web',
            guestMode: false,
            externalChatId: externalId,
            chatTitle: req.taskTitle || `${req.agentName || req.agentKey} — ChatGPT Session`,
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

    const activeEntry = req.runId ? this.activeRunPages.get(req.runId) : undefined;
    if (activeEntry?.webChatSessionId && page.url().includes('/c/')) {
      const chatUrl = page.url();
      const externalChatId = chatUrl.split('/c/')[1]?.split('?')[0] ?? chatUrl;
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

  private mapGptAppModelToCodex(modelId: string): string {
    const lower = (modelId || '').toLowerCase();
    if (lower.includes('o3')) return 'o3';
    if (lower.includes('o4-mini')) return 'o4-mini';
    if (lower.includes('5-4')) return 'gpt-5.4';
    return 'gpt-5.3-codex';
  }

  private async acquireContextAndPage(
    isAppMode: boolean,
    profileDir: string,
    visible: boolean,
  ): Promise<{ ctx: BrowserContext; page: Page }> {
    const key = isAppMode ? 'gpt-app' : 'chatgpt-web';
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

    if (isAppMode) {
      const cdpConnected = await this.tryConnectGptDesktopApp(profileDir);
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
      ...(isAppMode ? ['--app=https://chatgpt.com'] : []),
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
      this.logger.error(`Could not launch browser context for ChatGPT: ${String(lastErr)}`);
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        'Could not launch Chrome or Edge for ChatGPT session. Ensure Google Chrome or Microsoft Edge is installed.',
      );
    }

    this.contexts.set(key, ctx);
    const pages = ctx.pages();
    const page = pages[0] ?? (await ctx.newPage());
    return { ctx, page };
  }

  private async tryConnectGptDesktopApp(
    profileDir: string,
  ): Promise<{ ctx: BrowserContext; page: Page } | null> {
    const bin = await this.discovery.findGptAppBinary();
    if (!bin) return null;

    // WindowsApps MSIX binaries disallow spawning directly without package activation or restrict CDP flags;
    // try gracefully and fall back to Chromium app mode if blocked.
    const cdpPort = 9235;
    try {
      if (!this.desktopAppProcess || this.desktopAppProcess.exitCode !== null) {
        this.desktopAppProcess = spawn(
          bin.executablePath,
          [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`],
          { detached: false, stdio: 'ignore', windowsHide: false },
        );
        await new Promise((r) => setTimeout(r, 2000));
      }

      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`, {
        timeout: 3000,
      });
      const ctx = browser.contexts()[0];
      if (!ctx) return null;
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      return { ctx, page };
    } catch {
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
            bounds: { windowState: 'normal', left: 120, top: 80, width: 1280, height: 860 },
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
      // ignore
    }
  }

  private async isComposerReady(page: Page): Promise<boolean> {
    try {
      const count = await page
        .locator(
          '#prompt-textarea, div#prompt-textarea[contenteditable="true"], textarea[name="prompt-textarea"]',
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

  private async countAssistantMessages(page: Page): Promise<number> {
    return page
      .locator('[data-message-author-role="assistant"]')
      .count()
      .catch(() => 0);
  }

  private async fillAndSubmitComposer(page: Page, promptText: string): Promise<void> {
    const composer = page
      .locator(
        '#prompt-textarea, div#prompt-textarea[contenteditable="true"], textarea[name="prompt-textarea"]',
      )
      .first();

    await composer.click({ timeout: 5000 });
    await composer.fill(promptText).catch(async () => {
      await page.keyboard.insertText(promptText);
    });

    await new Promise((r) => setTimeout(r, 300));

    const sendBtn = page
      .locator('button[data-testid="send-button"], button[aria-label="Send prompt"]')
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
          querySelector?: (s: string) => DomNode | null;
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
          'button[data-testid="stop-button"], button[aria-label="Stop streaming"]',
        );
        const isStreaming = Boolean(stopBtn);

        const msgNodes = Array.from(
          doc.querySelectorAll('[data-message-author-role="assistant"]'),
        );
        if (msgNodes.length <= prevCount && msgNodes.length === 0) {
          return { text: '', thinkingText: '', isStreaming };
        }
        const latest = msgNodes[msgNodes.length - 1];
        const markdown = latest?.querySelector?.('.markdown') ?? latest;
        const text = markdown ? (markdown.innerText || '').trim() : '';

        return { text, thinkingText: '', isStreaming };
      }, previousCount)
      .catch(() => ({ text: '', thinkingText: '', isStreaming: false }));
  }
}
