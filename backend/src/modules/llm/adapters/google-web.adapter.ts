import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type {
  AgentKey,
  BrowserSessionStatusDto,
  BrowserVisibilityStatusDto,
  DeleteWebChatsResultDto,
  LlmModelInfoDto,
  WebChatPlatform,
  WebChatSessionDto,
} from '@robdev/shared';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  LlmError,
  type LlmAdapter,
  type LlmStreamEvent,
  type LlmStreamRequest,
  type ResolvedConnection,
} from './llm-adapter.interface.js';
import { PromptToolBridge } from './prompt-tool-bridge.js';

export type ThinkingLevel = 'low' | 'medium' | 'high';
export type MediaResolutionLevel = 'default' | 'low' | 'medium' | 'high';
export type CreateNewChatMode = 'always' | 'per-run' | 'first-run';
export type AiStudioToolKey =
  | 'structuredOutputs'
  | 'codeExecution'
  | 'functionCalling'
  | 'googleSearch'
  | 'googleMaps'
  | 'urlContext';

export interface ParsedWebModelSpec {
  platform: 'gemini' | 'aistudio';
  guestMode: boolean;
  baseModelId: string;
  apiModelSlug: string;
  geminiMenuLabel: string;
  thinkingLevel: ThinkingLevel;
  mediaResolution: MediaResolutionLevel;
  aiStudioTools: ReadonlySet<AiStudioToolKey>;
  createNewChatMode: CreateNewChatMode;
}

interface ActiveRunPageEntry {
  page: Page;
  ctx: BrowserContext;
  runningOnAiStudio: boolean;
  effectiveGuestMode: boolean;
  spec: ParsedWebModelSpec;
  studioId?: string;
  runId: string;
  taskId?: string;
  rootTaskId?: string;
  agentId?: string;
  agentKey?: AgentKey;
  agentName?: string;
  taskTitle?: string;
  webChatSessionId: string | null;
}

export const WEB_MODELS: readonly LlmModelInfoDto[] = [
  // Gemini Web (Signed-in) — 4 models x 3 thinking levels
  {
    id: 'gemini-web:3.5-flash-lite?thinking=low',
    displayName: 'Gemini Web · 3.5 Flash-Lite (Thinking: Low)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.5-flash-lite?thinking=medium',
    displayName: 'Gemini Web · 3.5 Flash-Lite (Thinking: Medium)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.5-flash-lite?thinking=high',
    displayName: 'Gemini Web · 3.5 Flash-Lite (Thinking: High)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.8-flash?thinking=low',
    displayName: 'Gemini Web · 3.8 Flash (Thinking: Low)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.8-flash?thinking=medium',
    displayName: 'Gemini Web · 3.8 Flash (Thinking: Medium)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.8-flash?thinking=high',
    displayName: 'Gemini Web · 3.8 Flash (Thinking: High)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.1-pro?thinking=low',
    displayName: 'Gemini Web · 3.1 Pro (Thinking: Low)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.1-pro?thinking=medium',
    displayName: 'Gemini Web · 3.1 Pro (Thinking: Medium)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:3.1-pro?thinking=high',
    displayName: 'Gemini Web · 3.1 Pro (Thinking: High)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:4.0-argon?thinking=low',
    displayName: 'Gemini Web · 4.0 Argon (Thinking: Low)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:4.0-argon?thinking=medium',
    displayName: 'Gemini Web · 4.0 Argon (Thinking: Medium)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'gemini-web:4.0-argon?thinking=high',
    displayName: 'Gemini Web · 4.0 Argon (Thinking: High)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },

  // Gemini Web (Guest Mode — No Login — 3.5 Flash-Lite with automatic thinking)
  {
    id: 'gemini-web-guest:3.5-flash-lite',
    displayName: 'Gemini Guest · 3.5 Flash-Lite (Thinking: Auto)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },

  // Google AI Studio — 6 models (3.0 Flash, 3.1 Flash Lite, 3.1 Pro, 3.5 Flash Lite, 3.8 Flash, 4.0 Argon)
  {
    id: 'aistudio:gemini-3.0-flash?thinking=medium&tools=googleSearch&mediaRes=default',
    displayName: 'AI Studio · Gemini 3.0 Flash (Thinking: Medium)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'aistudio:gemini-3.1-flash-lite?thinking=low&tools=googleSearch&mediaRes=default',
    displayName: 'AI Studio · Gemini 3.1 Flash Lite (Thinking: Low)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'aistudio:gemini-3.1-pro?thinking=high&tools=googleSearch,urlContext&mediaRes=default',
    displayName: 'AI Studio · Gemini 3.1 Pro (Thinking: High)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'aistudio:gemini-3.5-flash-lite?thinking=low&tools=googleSearch&mediaRes=default',
    displayName: 'AI Studio · Gemini 3.5 Flash Lite (Thinking: Low)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'aistudio:gemini-3.8-flash?thinking=medium&tools=googleSearch,urlContext&mediaRes=default',
    displayName: 'AI Studio · Gemini 3.8 Flash (Thinking: Medium)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'aistudio:gemini-3.8-flash?thinking=high&tools=googleSearch,urlContext,codeExecution&mediaRes=default',
    displayName: 'AI Studio · Gemini 3.8 Flash (Thinking: High)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
  {
    id: 'aistudio:gemini-4-argon?thinking=high&tools=googleSearch,urlContext,codeExecution&mediaRes=default',
    displayName: 'AI Studio · Gemini 4.0 Argon (Thinking: High)',
    contextWindow: 2_000_000,
    supportsTools: true,
    supportsImageOutput: true,
  },
];

const SESSION_MARKER_FILE = '.robdev-session.json';

const COMPOSER_SELECTOR =
  'div.ql-editor[contenteditable="true"], rich-textarea div[contenteditable="true"], ms-autosize-textarea textarea, textarea[aria-label*="prompt" i], textarea[aria-label*="Type" i], textarea[placeholder*="Type" i], textarea[placeholder*="Start typing" i], div[contenteditable="true"][role="textbox"], footer textarea';

const SIGN_IN_BUTTON_SELECTOR =
  'a[href*="accounts.google.com/ServiceLogin"], a[aria-label*="Sign in" i], button[aria-label*="Sign in" i]';

const GEMINI_WEB_ERROR_REPLY_REGEX =
  /I seem to be encountering an error|Can I try something else for you\??|Something went wrong\b/i;

const AI_STUDIO_TOOL_LABELS: Record<AiStudioToolKey, string> = {
  structuredOutputs: 'Structured outputs',
  codeExecution: 'Code execution',
  functionCalling: 'Function calling',
  googleSearch: 'Grounding with Google Search',
  googleMaps: 'Grounding with Google Maps',
  urlContext: 'URL context',
};

@Injectable()
export class GoogleWebBrowserAdapter implements LlmAdapter, OnModuleDestroy {
  private readonly logger = new Logger(GoogleWebBrowserAdapter.name);
  private readonly headlessContexts = new Map<string, BrowserContext>();
  private readonly activeRunPages = new Map<string, ActiveRunPageEntry>();
  private readonly savedChatPages = new Map<string, ActiveRunPageEntry>();
  private browserLock: Promise<void> = Promise.resolve();
  private manualVisibilityOverride: boolean | null = null;
  private lastGuestRequestFinishedAt = 0;

  private launchingContextPromise: Promise<BrowserContext> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async acquireBrowserLock(): Promise<() => void> {
    let release!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prevLock = this.browserLock;
    this.browserLock = prevLock.then(() => nextLock);
    await prevLock;
    return release;
  }

  async onModuleDestroy(): Promise<void> {
    for (const entry of this.activeRunPages.values()) {
      await entry.page.close().catch(() => {});
    }
    this.activeRunPages.clear();
    for (const ctx of this.headlessContexts.values()) {
      await ctx.close().catch(() => {});
    }
    this.headlessContexts.clear();
  }

  profileDirFor(_guestMode = false): string {
    // Always use a single unified browser profile directory so a second browser is never launched
    return path.resolve(process.cwd(), '.browser-profiles', 'google-shared');
  }

  parseWebModelSpec(conn: ResolvedConnection, rawModelId?: string): ParsedWebModelSpec {
    const raw = (rawModelId || 'gemini-web:3.8-flash?thinking=medium').trim();
    const [modelPartRaw = raw, queryPart = ''] = raw.split('?');
    const modelPart = modelPartRaw.toLowerCase();
    const params = new URLSearchParams(queryPart);

    const legacyThinking = modelPart.includes(':thinking-')
      ? modelPart.split(':thinking-')[1] ?? ''
      : '';
    const cleanBaseModel = modelPart.split(':thinking-')[0] ?? modelPart;

    const thinkingParam = (params.get('thinking') || legacyThinking || 'medium').toLowerCase();
    const thinkingLevel: ThinkingLevel =
      thinkingParam === 'low' ? 'low' : thinkingParam === 'high' ? 'high' : 'medium';

    const mediaParam = (params.get('mediaRes') || 'default').toLowerCase();
    const mediaResolution: MediaResolutionLevel =
      mediaParam === 'low' || mediaParam === 'medium' || mediaParam === 'high'
        ? mediaParam
        : 'default';

    const toolsRaw = params.get('tools');
    const aiStudioTools = new Set<AiStudioToolKey>();
    if (toolsRaw === null) {
      aiStudioTools.add('googleSearch');
    } else if (toolsRaw.trim().length > 0) {
      for (const item of toolsRaw.split(',')) {
        const k = item.trim() as AiStudioToolKey;
        if (k in AI_STUDIO_TOOL_LABELS) {
          aiStudioTools.add(k);
        }
      }
    }

    const guestMode = cleanBaseModel.startsWith('gemini-web-guest');
    const isAiStudio =
      cleanBaseModel.startsWith('aistudio') ||
      Boolean(
        conn.baseUrl?.includes('aistudio.google.com') &&
          !cleanBaseModel.startsWith('gemini-web'),
      );

    let apiModelSlug = 'gemini-3.8-flash';
    let geminiMenuLabel = '3.8 Flash';

    if (guestMode) {
      apiModelSlug = 'gemini-3.5-flash-lite';
      geminiMenuLabel = '3.5 Flash-Lite';
    } else if (cleanBaseModel.includes('3.0-flash')) {
      apiModelSlug = 'gemini-3.0-flash';
      geminiMenuLabel = '3.8 Flash';
    } else if (cleanBaseModel.includes('3.1-flash-lite')) {
      apiModelSlug = 'gemini-3.1-flash-lite';
      geminiMenuLabel = '3.5 Flash-Lite';
    } else if (cleanBaseModel.includes('3.1-pro')) {
      apiModelSlug = 'gemini-3.1-pro';
      geminiMenuLabel = '3.1 Pro';
    } else if (
      cleanBaseModel.includes('3.5-flash-lite') ||
      cleanBaseModel.includes('3.5-flash')
    ) {
      apiModelSlug = 'gemini-3.5-flash-lite';
      geminiMenuLabel = '3.5 Flash-Lite';
    } else if (
      cleanBaseModel.includes('4.0-argon') ||
      cleanBaseModel.includes('4-argon') ||
      cleanBaseModel.includes('argon')
    ) {
      apiModelSlug = 'gemini-4-argon';
      geminiMenuLabel = '4 Argon';
    } else {
      apiModelSlug = 'gemini-3.8-flash';
      geminiMenuLabel = '3.8 Flash';
    }

    const normalizedBaseId = isAiStudio
      ? `aistudio:${apiModelSlug}`
      : guestMode
        ? `gemini-web-guest:${apiModelSlug.replace(/^gemini-/, '')}`
        : `gemini-web:${apiModelSlug.replace(/^gemini-/, '')}`;

    const chatModeParam = (params.get('chatMode') || 'per-run').toLowerCase();
    const createNewChatMode: CreateNewChatMode =
      chatModeParam === 'always'
        ? 'always'
        : chatModeParam === 'first-run'
          ? 'first-run'
          : 'per-run';

    return {
      platform: isAiStudio && !guestMode ? 'aistudio' : 'gemini',
      guestMode,
      baseModelId: normalizedBaseId,
      apiModelSlug,
      geminiMenuLabel,
      thinkingLevel,
      mediaResolution,
      aiStudioTools,
      createNewChatMode,
    };
  }

  targetUrlFor(conn: ResolvedConnection, modelId?: string): string {
    const spec = this.parseWebModelSpec(conn, modelId);
    if (spec.platform === 'aistudio') {
      return `https://aistudio.google.com/prompts/new_chat?model=${encodeURIComponent(spec.apiModelSlug)}`;
    }
    return 'https://gemini.google.com/app';
  }

  async listModels(_conn: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    return [...WEB_MODELS];
  }

  /**
   * Returns current browser visibility status for a studio.
   */
  async getBrowserVisibilityStatus(studioId: string): Promise<BrowserVisibilityStatusDto> {
    await this.pruneClosedContexts();
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { browserHeadless: true },
    });
    const browserHeadlessSetting = studio?.browserHeadless ?? true;
    const hasOpenBrowser = this.headlessContexts.size > 0;
    const visible =
      hasOpenBrowser &&
      (this.manualVisibilityOverride !== null
        ? this.manualVisibilityOverride
        : !browserHeadlessSetting);

    return {
      visible,
      browserHeadlessSetting,
      activeContexts: this.headlessContexts.size,
      message: visible
        ? 'Agent browser window is currently visible.'
        : 'Agent browser is running in hidden/headless mode.',
    };
  }

  /**
   * Dynamically shows or hides the browser window where agents run,
   * even if the studio setting is set to headless.
   */
  async setBrowserVisibility(
    studioId: string,
    visible: boolean,
  ): Promise<BrowserVisibilityStatusDto> {
    this.manualVisibilityOverride = visible;

    await this.prisma.studio
      .update({
        where: { id: studioId },
        data: { browserHeadless: !visible },
      })
      .catch(() => {});
    const browserHeadlessSetting = !visible;

    await this.pruneClosedContexts();

    let appliedCount = 0;
    for (const [key, ctx] of this.headlessContexts.entries()) {
      try {
        const pages = ctx.pages().filter((p) => !p.isClosed());
        const activePage = pages[pages.length - 1] ?? pages[0];
        if (activePage) {
          await this.applyWindowVisibility(ctx, activePage, visible, true);
          appliedCount++;
        }
      } catch {
        this.evictClosedContext(ctx, key);
      }
    }

    // If user asks to show browser and no live page was shown, open the shared/guest context so they can see it immediately
    if (visible && appliedCount === 0) {
      const leadAgent = await this.prisma.agent.findUnique({
        where: { studioId_key: { studioId, key: 'lead' } },
        select: { modelId: true },
      });
      const useGuest = Boolean(leadAgent?.modelId?.startsWith('gemini-web-guest'));
      const profileDir = this.profileDirFor(useGuest);
      await fs.mkdir(profileDir, { recursive: true });
      const { ctx, page } = await this.acquirePageInContext(useGuest, profileDir, true);
      await this.applyWindowVisibility(ctx, page, true, true);
      if (page.url() === 'about:blank') {
        await page
          .goto('https://gemini.google.com/app', {
            waitUntil: 'domcontentloaded',
            timeout: 25_000,
          })
          .catch(() => {});
      }
      await this.applyWindowVisibility(ctx, page, true, true);
    }

    return {
      visible,
      browserHeadlessSetting,
      activeContexts: this.headlessContexts.size,
      message: visible
        ? 'Browser window is now shown on screen.'
        : 'Browser window is now hidden.',
    };
  }

  /**
   * Syncs manual override when studio default `browserHeadless` setting is updated.
   */
  async onStudioBrowserSettingChanged(
    studioId: string,
    browserHeadless: boolean,
  ): Promise<void> {
    const visible = !browserHeadless;
    this.manualVisibilityOverride = null;
    for (const ctx of this.headlessContexts.values()) {
      const pages = ctx.pages().filter((p) => !p.isClosed());
      const activePage = pages[pages.length - 1] ?? pages[0];
      if (activePage) {
        await this.applyWindowVisibility(ctx, activePage, visible, true);
      }
    }
    void studioId;
  }

  private async shouldShowBrowserWindow(studioId?: string): Promise<boolean> {
    if (this.manualVisibilityOverride !== null) {
      return this.manualVisibilityOverride;
    }
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
    forcePosition = false,
  ): Promise<void> {
    try {
      await page.emulateMedia({ colorScheme: 'dark' }).catch(() => {});
      await this.ensureDarkThemeOnPage(page);

      const cdp = await ctx.newCDPSession(page);
      // Clear any fixed device metrics override so the page dynamically fills the window (including maximized/fullscreen)
      await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});

      const { windowId } = (await cdp.send('Browser.getWindowForTarget')) as {
        windowId: number;
      };
      if (visible) {
        const current = (await cdp
          .send('Browser.getWindowBounds', { windowId })
          .catch(() => null)) as {
          bounds?: { left?: number; top?: number; windowState?: string };
        } | null;
        const state = current?.bounds?.windowState;
        const isOffscreenOrMinimized =
          forcePosition ||
          !current?.bounds ||
          state === 'minimized' ||
          (current.bounds.left ?? 0) < 0 ||
          (current.bounds.top ?? 0) < 0;

        if (state === 'minimized' || isOffscreenOrMinimized) {
          await cdp
            .send('Browser.setWindowBounds', {
              windowId,
              bounds: { windowState: 'normal' },
            })
            .catch(() => {});
        }
        if (isOffscreenOrMinimized) {
          await cdp
            .send('Browser.setWindowBounds', {
              windowId,
              bounds: { left: 80, top: 60, width: 1280, height: 860 },
            })
            .catch(() => {});
        }
        await page.bringToFront().catch(() => {});
      } else {
        await cdp
          .send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'normal' },
          })
          .catch(() => {});
        await cdp
          .send('Browser.setWindowBounds', {
            windowId,
            bounds: { left: -32000, top: -32000 },
          })
          .catch(() => {});
        await cdp
          .send('Browser.setWindowBounds', {
            windowId,
            bounds: { windowState: 'minimized' },
          })
          .catch(() => {});
      }
      await cdp.detach().catch(() => {});
    } catch {
      // Non-fatal if CDP window bounds unsupported
    }
  }

  private async ensureDarkThemeContext(ctx: BrowserContext): Promise<void> {
    try {
      await ctx.addInitScript(() => {
        try {
          const doc = (
            globalThis as unknown as {
              document?: {
                documentElement?: {
                  classList?: { add: (c: string) => void; remove: (c: string) => void };
                  style?: { colorScheme?: string };
                };
                body?: {
                  classList?: { add: (c: string) => void; remove: (c: string) => void };
                };
              };
              localStorage?: {
                getItem: (k: string) => string | null;
                setItem: (k: string, v: string) => void;
              };
              location?: { hostname?: string };
            }
          ).document;
          const ls = (
            globalThis as unknown as {
              localStorage?: {
                getItem: (k: string) => string | null;
                setItem: (k: string, v: string) => void;
              };
            }
          ).localStorage;
          const host =
            (globalThis as unknown as { location?: { hostname?: string } }).location
              ?.hostname ?? '';

          if (ls) {
            if (host.includes('aistudio.google.com')) {
              const raw = ls.getItem('aiStudioUserPreference');
              const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
              if (parsed['theme'] !== 'dark') {
                parsed['theme'] = 'dark';
                ls.setItem('aiStudioUserPreference', JSON.stringify(parsed));
              }
            } else if (host.includes('gemini.google.com')) {
              ls.setItem('theme', 'dark');
              ls.setItem('bard-color-theme', 'Bard-Dark-Theme');
            }
          }
          if (doc?.documentElement?.style) {
            doc.documentElement.style.colorScheme = 'dark';
          }
          doc?.documentElement?.classList?.remove('light-theme');
          doc?.documentElement?.classList?.add('dark-theme');
          doc?.body?.classList?.remove('light-theme');
          doc?.body?.classList?.add('dark-theme');
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }

  private async ensureDarkThemeOnPage(page: Page): Promise<void> {
    try {
      await page.emulateMedia({ colorScheme: 'dark' }).catch(() => {});
      await page
        .evaluate(() => {
          const g = globalThis as unknown as {
            document?: {
              documentElement?: {
                classList?: { add: (c: string) => void; remove: (c: string) => void };
                style?: { colorScheme?: string };
              };
              body?: {
                classList?: { add: (c: string) => void; remove: (c: string) => void };
              };
            };
            localStorage?: {
              getItem: (k: string) => string | null;
              setItem: (k: string, v: string) => void;
            };
            location?: { hostname?: string };
          };
          const host = g.location?.hostname ?? '';
          if (g.localStorage) {
            if (host.includes('aistudio.google.com')) {
              const raw = g.localStorage.getItem('aiStudioUserPreference');
              const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
              if (parsed['theme'] !== 'dark') {
                parsed['theme'] = 'dark';
                g.localStorage.setItem('aiStudioUserPreference', JSON.stringify(parsed));
              }
            } else if (host.includes('gemini.google.com')) {
              g.localStorage.setItem('theme', 'dark');
              g.localStorage.setItem('bard-color-theme', 'Bard-Dark-Theme');
            }
          }
          if (g.document?.documentElement?.style) {
            g.document.documentElement.style.colorScheme = 'dark';
          }
          g.document?.documentElement?.classList?.remove('light-theme');
          g.document?.documentElement?.classList?.add('dark-theme');
          g.document?.body?.classList?.remove('light-theme');
          g.document?.body?.classList?.add('dark-theme');
        })
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  async launchInteractiveSignIn(
    conn: ResolvedConnection,
  ): Promise<BrowserSessionStatusDto> {
    const profileDir = this.profileDirFor(false);
    await fs.mkdir(profileDir, { recursive: true });
    const targetUrl = conn.baseUrl?.trim() || 'https://gemini.google.com/app';

    const { ctx, page } = await this.acquirePageInContext(false, profileDir, true);
    try {
      await this.closeExtraBlankTabs(ctx, page);
      await this.applyWindowVisibility(ctx, page, true);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      const authenticated = await this.waitForInteractiveSignIn(
        ctx,
        page,
        targetUrl,
        300_000,
      );

      if (authenticated) {
        await this.writeSessionMarker(profileDir, targetUrl);
      }

      const showByDefault = await this.shouldShowBrowserWindow();
      if (!showByDefault) {
        await this.applyWindowVisibility(ctx, page, false);
      }

      return {
        authenticated,
        targetUrl,
        profileDir,
        message: authenticated
          ? 'Google browser session verified and saved to persistent profile.'
          : 'Browser session ready in Guest mode. Gemini Web will work in Guest mode without an account.',
      };
    } catch (err) {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        `Browser sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Clicks Gemini Web's "Answer now" button on the currently active agent browser tab
   * to immediately stop recursive thinking and start generating the final answer.
   */
  async triggerAnswerNow(
    studioId: string,
    runId?: string,
    agentKey?: AgentKey,
  ): Promise<{ ok: boolean; message: string }> {
    let targetEntry: ActiveRunPageEntry | undefined;
    if (runId && this.activeRunPages.has(runId)) {
      targetEntry = this.activeRunPages.get(runId);
    }
    if (!targetEntry && agentKey) {
      for (const entry of this.activeRunPages.values()) {
        if (entry.agentKey === agentKey && (!studioId || entry.studioId === studioId)) {
          targetEntry = entry;
          break;
        }
      }
    }
    if (!targetEntry) {
      for (const entry of this.activeRunPages.values()) {
        if (!studioId || entry.studioId === studioId) {
          targetEntry = entry;
          break;
        }
      }
    }

    let page: Page | undefined = targetEntry?.page;
    if (!page || page.isClosed()) {
      for (const ctx of this.headlessContexts.values()) {
        const openPages = ctx.pages().filter((p) => !p.isClosed());
        if (openPages.length > 0) {
          page = openPages[openPages.length - 1];
          break;
        }
      }
    }

    if (!page || page.isClosed()) {
      return {
        ok: false,
        message: 'No active browser tab found for this run.',
      };
    }

    try {
      // Strategy 1: Direct Playwright locator for "Answer now" / "Skip" button
      const directSelector =
        'button:has-text("Answer now"), [role="button"]:has-text("Answer now"), button[aria-label*="Answer now" i], [data-test-id*="answer-now" i], mat-chip:has-text("Answer now"), button:has-text("Responder ahora"), button:has-text("Skip thinking")';
      const directBtn = page.locator(directSelector).first();
      if ((await directBtn.count().catch(() => 0)) > 0) {
        await directBtn.click({ timeout: 2000, force: true }).catch(() => {});
        return {
          ok: true,
          message: 'Clicked "Answer now" — forcing immediate answer.',
        };
      }

      // Strategy 2: DOM + Shadow DOM scan (including expanding collapsed thinking panel if needed)
      interface DomLikeNode {
        textContent?: string | null;
        offsetParent?: unknown;
        shadowRoot?: DomLikeRoot | null;
        getAttribute?: (name: string) => string | null;
        click?: () => void;
      }
      interface DomLikeRoot {
        querySelectorAll: (selector: string) => ArrayLike<DomLikeNode>;
      }
      const clicked = await page
        .evaluate(() => {
          const doc = (globalThis as unknown as { document?: DomLikeRoot }).document;
          if (!doc) return false;

          const matchAnswerNow = (el: DomLikeNode): boolean => {
            const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
            const aria = el.getAttribute?.('aria-label') || '';
            const testId = el.getAttribute?.('data-test-id') || '';
            return (
              /^(answer\s*now|skip\s*thinking|responder\s*ahora|skip)$/i.test(text) ||
              /answer\s*now|skip\s*thinking|responder\s*ahora/i.test(aria) ||
              /answer-now/i.test(testId)
            );
          };

          const collectInteractives = (root: DomLikeRoot): DomLikeNode[] => {
            const results: DomLikeNode[] = [];
            const nodes = root.querySelectorAll(
              'button, [role="button"], mat-chip, a, span[role="button"]',
            );
            for (const n of Array.from(nodes)) {
              if (typeof n.click === 'function') results.push(n);
            }
            const all = root.querySelectorAll('*');
            for (const el of Array.from(all)) {
              if (el.shadowRoot) {
                results.push(...collectInteractives(el.shadowRoot));
              }
            }
            return results;
          };

          const candidates = collectInteractives(doc);
          for (const btn of candidates) {
            if (matchAnswerNow(btn) && btn.offsetParent !== null) {
              btn.click?.();
              return true;
            }
          }

          // If thinking header is collapsed, click it to reveal "Answer now"
          for (const btn of candidates) {
            const t = (btn.textContent || '').trim();
            if (/^(thinking|show\s*thinking|thoughts)/i.test(t)) {
              btn.click?.();
              break;
            }
          }

          const afterExpand = collectInteractives(doc);
          for (const btn of afterExpand) {
            if (matchAnswerNow(btn)) {
              btn.click?.();
              return true;
            }
          }
          return false;
        })
        .catch(() => false);

      if (clicked) {
        return {
          ok: true,
          message: 'Clicked "Answer now" — forcing immediate answer.',
        };
      }

      return {
        ok: false,
        message:
          '"Answer now" button is not currently visible on the Gemini page (model may already be outputting the response).',
      };
    } catch (err) {
      return {
        ok: false,
        message: `Could not click "Answer now": ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  async *stream(
    conn: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const agentLabel = req.agentName || req.agentKey || 'agent';
    yield { type: 'status', statusText: `Initializing ${agentLabel}...` };

    const releaseLock = await this.acquireBrowserLock();
    const rawSpec = this.parseWebModelSpec(conn, req.model);
    const spec: ParsedWebModelSpec =
      req.tools && req.tools.length > 0
        ? {
            ...rawSpec,
            // Disable AI Studio native Google Search grounding & Function Calling when Studio <tool_call>
            // tools are active so Gemini does not emit native `fx google:*` function call widgets.
            aiStudioTools: new Set(
              [...rawSpec.aiStudioTools].filter(
                (t) =>
                  t !== 'googleSearch' &&
                  t !== 'functionCalling' &&
                  t !== 'urlContext',
              ),
            ),
          }
        : rawSpec;
    const showWindow = await this.shouldShowBrowserWindow(req.studioId);

    try {
      for (let browserAttempt = 0; browserAttempt < 2; browserAttempt++) {
        try {
          // Check if we already have an open, alive page for this runId (multi-turn tool loop!)
          const existingEntry =
            browserAttempt === 0 && req.runId
              ? this.activeRunPages.get(req.runId)
              : undefined;
          const existingAlive =
            existingEntry !== undefined &&
            (await this.isPageAndContextAlive(existingEntry.ctx, existingEntry.page));
          const canReuseExistingPage =
            existingAlive &&
            existingEntry !== undefined &&
            (req.turnIndex ?? 0) > 0;

          if (existingEntry && !existingAlive && req.runId) {
            this.activeRunPages.delete(req.runId);
            this.evictClosedContext(existingEntry.ctx);
          }

          let page: Page;
          let ctx: BrowserContext;
          let runningOnAiStudio: boolean;
          let effectiveGuestMode: boolean;
          let resumedExistingChat = false;
          let resumedSameTask = false;

          if (canReuseExistingPage && existingEntry) {
            page = existingEntry.page;
            ctx = existingEntry.ctx;
            runningOnAiStudio = existingEntry.runningOnAiStudio;
            effectiveGuestMode = existingEntry.effectiveGuestMode;
            await this.applyWindowVisibility(
              ctx,
              page,
              await this.shouldShowBrowserWindow(req.studioId),
            );
            yield {
              type: 'status',
              statusText: `Sending tool results to ${agentLabel}...`,
            };
          } else {
            yield {
              type: 'status',
              statusText:
                browserAttempt > 0
                  ? 'Browser was closed — restarting browser session...'
                  : 'Starting browser session...',
            };

            const profileDir = this.profileDirFor(false);
            await fs.mkdir(profileDir, { recursive: true });
            const acquired = await this.acquirePageInContext(
              false,
              profileDir,
              await this.shouldShowBrowserWindow(req.studioId),
            );
            ctx = acquired.ctx;
            page = acquired.page;

            // Determine if shared profile actually has Google auth cookies; if not, avoid 22s AI Studio timeout and use Guest mode
            let useGuestProfile = spec.guestMode;
            if (!useGuestProfile) {
              const hasCookies = await this.hasGoogleAuthCookiesInContext(ctx);
              if (!hasCookies) {
                this.logger.log(
                  `No Google auth cookies in browser profile for ${agentLabel}; using Guest Mode automatically.`,
                );
                useGuestProfile = true;
              }
            }

            effectiveGuestMode = useGuestProfile;
            await this.applyWindowVisibility(
              ctx,
              page,
              await this.shouldShowBrowserWindow(req.studioId),
            );

            const isAiStudio = spec.platform === 'aistudio' && !effectiveGuestMode;
            runningOnAiStudio = isAiStudio;

            // Check if we can continue an existing Gemini Web / AI Studio chat according to `spec.createNewChatMode`
            const resumed =
              browserAttempt === 0 &&
              spec.createNewChatMode !== 'always' &&
              !req.forceNewWebChat
                ? await this.tryResumeSyncedWebChat(
                    page,
                    isAiStudio,
                    effectiveGuestMode,
                    spec,
                    req,
                  )
                : null;

            if (resumed) {
              resumedExistingChat = true;
              resumedSameTask = resumed.sameTask;
              await this.ensureDarkThemeOnPage(page);
              await this.closeExtraBlankTabs(ctx, page);
              yield {
                type: 'status',
                statusText: `Continuing ${agentLabel} chat...`,
              };

              if (runningOnAiStudio) {
                await this.applyAiStudioControls(page, spec);
              } else if (!effectiveGuestMode) {
                await this.applyGeminiWebControls(page, spec);
              }

              const lingeringMenus = await page
                .locator(
                  '.cdk-overlay-backdrop-showing, [data-test-id="bard-mode-menu-button"][aria-expanded="true"], gem-menu[data-visible="true"]',
                )
                .count()
                .catch(() => 0);
              if (lingeringMenus > 0) {
                await page.keyboard.press('Escape').catch(() => {});
                await new Promise((r) => setTimeout(r, 150));
              }

              if (req.runId) {
                this.activeRunPages.set(req.runId, {
                  page,
                  ctx,
                  runningOnAiStudio,
                  effectiveGuestMode,
                  spec,
                  studioId: req.studioId,
                  runId: req.runId,
                  taskId: req.taskId,
                  rootTaskId: req.rootTaskId,
                  agentId: req.agentId,
                  agentKey: req.agentKey,
                  agentName: agentLabel,
                  taskTitle: req.taskTitle,
                  webChatSessionId: resumed.sessionId,
                });
              }
            } else {
              // Pace back-to-back Guest Mode new chat creations to avoid Google Guest burst rate-limiting
              if (effectiveGuestMode) {
                const elapsedSinceLastGuest = Date.now() - this.lastGuestRequestFinishedAt;
                if (elapsedSinceLastGuest < 1800) {
                  await new Promise((r) => setTimeout(r, 1800 - elapsedSinceLastGuest));
                }
              }

              const targetUrl = isAiStudio
                ? this.targetUrlFor(conn, req.model)
                : 'https://gemini.google.com/app';

              yield {
                type: 'status',
                statusText: isAiStudio
                  ? 'Opening Google AI Studio...'
                  : effectiveGuestMode
                    ? 'Opening Gemini Web (Guest Mode)...'
                    : 'Opening Gemini Web...',
              };

              await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
              await this.ensureDarkThemeOnPage(page);
              await this.closeExtraBlankTabs(ctx, page);

              // Fast check if redirected to accounts.google.com
              const redirectedToLogin = page.url().includes('accounts.google.com');
              let hasComposer = false;
              if (!redirectedToLogin) {
                hasComposer = await page
                  .locator(COMPOSER_SELECTOR)
                  .first()
                  .waitFor({ state: 'visible', timeout: 15_000 })
                  .then(() => true)
                  .catch(() => false);
              }

              if ((!hasComposer || redirectedToLogin) && isAiStudio) {
                this.logger.warn(
                  'AI Studio composer not available (sign-in required); falling back to Gemini Web.',
                );
                runningOnAiStudio = false;
                effectiveGuestMode = true;
                await page.goto('https://gemini.google.com/app', {
                  waitUntil: 'domcontentloaded',
                  timeout: 45_000,
                });
                hasComposer = await page
                  .locator(COMPOSER_SELECTOR)
                  .first()
                  .waitFor({ state: 'visible', timeout: 15_000 })
                  .then(() => true)
                  .catch(() => false);
              }

              if (!hasComposer) {
                await this.releasePageSafely(ctx, page);
                throw new LlmError(
                  'PROVIDER_UNAVAILABLE',
                  'Could not find prompt composer on Google Web UI.',
                );
              }

              // Check if page shows Sign In button on Gemini Web (meaning unauthenticated Guest session)
              if (!runningOnAiStudio && !effectiveGuestMode) {
                const signInVisible =
                  (await page
                    .locator(SIGN_IN_BUTTON_SELECTOR)
                    .count()
                    .catch(() => 0)) > 0;
                if (signInVisible) {
                  effectiveGuestMode = true;
                }
              }

              // Apply model/thinking controls ONLY when authenticated (Guest Mode has no thinking/model options!)
              if (runningOnAiStudio) {
                yield {
                  type: 'status',
                  statusText: 'Configuring AI Studio run settings...',
                };
                await this.applyAiStudioControls(page, spec);
              } else if (!effectiveGuestMode) {
                yield {
                  type: 'status',
                  statusText: `Selecting ${spec.geminiMenuLabel} (Thinking: ${spec.thinkingLevel})...`,
                };
                await this.applyGeminiWebControls(page, spec);
              }

              // Close any lingering CDK/Material menu overlay
              const openMenuCount = await page
                .locator(
                  '.cdk-overlay-backdrop-showing, [data-test-id="bard-mode-menu-button"][aria-expanded="true"], gem-menu[data-visible="true"]',
                )
                .count()
                .catch(() => 0);
              if (openMenuCount > 0) {
                await page.keyboard.press('Escape').catch(() => {});
                await new Promise((r) => setTimeout(r, 150));
              }

              if (req.runId) {
                this.activeRunPages.set(req.runId, {
                  page,
                  ctx,
                  runningOnAiStudio,
                  effectiveGuestMode,
                  spec,
                  studioId: req.studioId,
                  runId: req.runId,
                  taskId: req.taskId,
                  rootTaskId: req.rootTaskId,
                  agentId: req.agentId,
                  agentKey: req.agentKey,
                  agentName: agentLabel,
                  taskTitle: req.taskTitle,
                  webChatSessionId: null,
                });
              }
            }
          }

          const promptToSend = canReuseExistingPage
            ? PromptToolBridge.formatFollowUpTurnForWebUi(req.messages)
            : resumedExistingChat
              ? PromptToolBridge.formatFollowUpUserPromptForWebUi(
                  req.messages,
                  !resumedSameTask,
                )
              : PromptToolBridge.formatSinglePromptForWebUi(
                  req.messages,
                  req.tools,
                  effectiveGuestMode,
                );
          const trailingImages = PromptToolBridge.extractTrailingImagesForWebUi(
            req.messages,
          );

          yield {
            type: 'status',
            statusText: `Sending prompt to ${agentLabel}...`,
          };

          let guestErrorReply = '';
          const liveEventsAttempt1 = this.submitPromptAndStream(
            page,
            runningOnAiStudio,
            effectiveGuestMode,
            promptToSend,
            agentLabel,
            signal,
            (statusText) => ({ type: 'status', statusText }),
            (cannedErr) => {
              guestErrorReply = cannedErr;
            },
            trailingImages,
          );

          for await (const ev of liveEventsAttempt1) {
            yield ev;
          }

          // If Guest Mode returned a canned error reply, refresh guest session and retry once
          if (
            effectiveGuestMode &&
            !runningOnAiStudio &&
            guestErrorReply.length > 0 &&
            GEMINI_WEB_ERROR_REPLY_REGEX.test(guestErrorReply)
          ) {
            this.logger.warn(
              `Gemini Web Guest Mode returned canned error reply ("${guestErrorReply.slice(0, 80)}"). Refreshing guest session and retrying once...`,
            );
            yield {
              type: 'status',
              statusText: 'Refreshing guest session and retrying...',
            };

            await this.releasePageSafely(ctx, page);
            await ctx.clearCookies().catch(() => {});
            await new Promise((r) => setTimeout(r, 2000));

            const profileDir = this.profileDirFor(true);
            const acquiredRetry = await this.acquirePageInContext(
              true,
              profileDir,
              showWindow,
            );
            ctx = acquiredRetry.ctx;
            page = acquiredRetry.page;
            await this.applyWindowVisibility(ctx, page, showWindow);
            await page.goto('https://gemini.google.com/app', {
              waitUntil: 'domcontentloaded',
              timeout: 45_000,
            });
            await page
              .locator(COMPOSER_SELECTOR)
              .first()
              .waitFor({ state: 'visible', timeout: 15_000 });

            if (req.runId) {
              const cur = this.activeRunPages.get(req.runId);
              if (cur) {
                cur.page = page;
                cur.ctx = ctx;
              }
            }

            // Retry with full prompt (compact for guest)
            const retryPrompt = PromptToolBridge.formatSinglePromptForWebUi(
              req.messages,
              req.tools,
              true,
            );
            let retryGuestError = '';
            const liveEventsRetry = this.submitPromptAndStream(
              page,
              false,
              true,
              retryPrompt,
              agentLabel,
              signal,
              (statusText) => ({ type: 'status', statusText }),
              (cannedErr) => {
                retryGuestError = cannedErr;
              },
            );

            for await (const ev of liveEventsRetry) {
              yield ev;
            }

            if (
              retryGuestError.length > 0 &&
              GEMINI_WEB_ERROR_REPLY_REGEX.test(retryGuestError)
            ) {
              throw new LlmError(
                'PROVIDER_RATE_LIMITED',
                'Gemini Web Guest Mode returned an error ("I seem to be encountering an error"). Your IP or guest session is likely rate-limited by Google. Try signing into a Google account in Settings or wait a moment.',
              );
            }
          }

          if (effectiveGuestMode) {
            this.lastGuestRequestFinishedAt = Date.now();
          }

          // In "Create on first run" mode, when an agent creates a new chat on Gemini Web / AI Studio,
          // rename the chat to the agent's own display name (e.g., "Lead", "Splash", "Pulse").
          if (
            spec.createNewChatMode === 'first-run' &&
            !canReuseExistingPage &&
            !resumedExistingChat &&
            !effectiveGuestMode
          ) {
            await this.renameWebChatOnPage(
              page,
              runningOnAiStudio,
              agentLabel,
            ).catch((err: unknown) => {
              this.logger.warn(
                `Could not rename web chat to "${agentLabel}": ${String(err)}`,
              );
            });
          }

          // Record or update the created WebChatSession in the database
          if (req.runId && req.studioId && req.agentId && req.agentKey) {
            await this.recordWebChatSession(req.runId).catch((err: unknown) => {
              this.logger.warn(`Could not record WebChatSession: ${String(err)}`);
            });
          }

          // If there was no runId provided, release the page safely
          if (!req.runId) {
            await this.releasePageSafely(ctx, page);
          }

          break;
        } catch (err) {
          if (
            browserAttempt === 0 &&
            !signal.aborted &&
            this.isBrowserClosedError(err)
          ) {
            this.logger.warn(
              `Browser or page was closed (${err instanceof Error ? err.message : String(err)}). Relaunching browser automatically...`,
            );
            if (req.runId) {
              const stale = this.activeRunPages.get(req.runId);
              this.activeRunPages.delete(req.runId);
              if (stale) {
                this.evictClosedContext(stale.ctx);
              }
            }
            this.evictClosedContext();
            continue;
          }
          throw err;
        }
      }
    } finally {
      releaseLock();
    }
  }

  private async readModelTurnState(
    page: Page,
    runningOnAiStudio: boolean,
    initialResponseCount: number,
    initialModelResponseCount = 0,
  ): Promise<{
    count: number;
    modelRespCount: number;
    text: string;
    thoughtText: string;
    isGenerating: boolean;
    openFunctionResponseCount: number;
  }> {
    return page
      .evaluate(
        ({ isAiStudio, initCount, initModelCount }) => {
          interface EvalNode {
            nodeType?: number;
            nodeValue?: string | null;
            tagName?: string;
            innerText?: string;
            textContent?: string | null;
            className?: string;
            value?: string;
            disabled?: boolean;
            offsetParent?: unknown;
            offsetWidth?: number;
            offsetHeight?: number;
            parentElement?: EvalNode | null;
            previousElementSibling?: EvalNode | null;
            childNodes?: ArrayLike<EvalNode>;
            contains?: (other: EvalNode) => boolean;
            cloneNode?: (deep?: boolean) => EvalNode;
            remove?: () => void;
            getAttribute?: (name: string) => string | null;
            click?: () => void;
            closest?: (selector: string) => unknown;
            querySelector?: (selector: string) => EvalNode | null;
            querySelectorAll?: (selector: string) => ArrayLike<EvalNode>;
          }
          const doc = (
            globalThis as unknown as {
              document?: { querySelectorAll: (s: string) => ArrayLike<EvalNode> };
            }
          ).document;
          if (!doc) {
            return {
              count: 0,
              modelRespCount: 0,
              text: '',
              thoughtText: '',
              isGenerating: false,
              openFunctionResponseCount: 0,
            };
          }

          const isVisible = (el: EvalNode): boolean =>
            el.offsetParent !== null &&
            (el.offsetWidth ?? 0) > 0 &&
            (el.offsetHeight ?? 0) > 0;

          const UI_CHROME_LINE_RE =
            /^(thoughts?|thinking\.{0,3}|collapse to hide model thoughts|expand to view model thoughts|show thinking|hide thinking|answer now|skip thinking|chevron_up|chevron_down|expand_less|expand_more|spark|auto_awesome)$/i;

          const extractThoughtMarkdown = (root: EvalNode): string => {
            const walk = (node: EvalNode, inBold: boolean, inPre: boolean): string => {
              const nt = node.nodeType ?? 1;
              if (nt === 3) {
                const raw = node.nodeValue ?? '';
                return inPre ? raw : raw.replace(/[ \t\r\n]+/g, ' ');
              }
              if (nt !== 1) return '';

              const tag = (node.tagName ?? '').toUpperCase();
              if (
                tag === 'BUTTON' ||
                tag === 'MAT-ICON' ||
                tag === 'SVG' ||
                tag === 'STYLE' ||
                tag === 'SCRIPT' ||
                tag === 'MAT-EXPANSION-PANEL-HEADER'
              ) {
                return '';
              }

              const cls = typeof node.className === 'string' ? node.className : '';
              if (
                /\b(mat-expansion-panel-header|mat-expansion-indicator|thoughts-header|thought-header|thinking-header)\b/i.test(
                  cls,
                )
              ) {
                return '';
              }

              const children = node.childNodes ? Array.from(node.childNodes) : [];
              const hasElementChild = children.some((c) => (c.nodeType ?? 0) === 1);
              if (!hasElementChild) {
                const leafText = (node.textContent ?? '').trim();
                if (!leafText || UI_CHROME_LINE_RE.test(leafText)) {
                  return '';
                }
              }

              const walkChildren = (nextBold: boolean, nextPre: boolean): string =>
                children.map((c) => walk(c, nextBold, nextPre)).join('');

              if (tag === 'BR') {
                return '\n\n';
              }
              if (tag === 'PRE') {
                const code = (node.textContent ?? '').trim();
                return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : '';
              }
              if (tag === 'CODE') {
                if (inPre) return node.textContent ?? '';
                const code = (node.textContent ?? '').trim();
                return code ? `\`${code}\`` : '';
              }
              if (tag === 'STRONG' || tag === 'B') {
                const inner = walkChildren(true, inPre).trim();
                if (!inner || UI_CHROME_LINE_RE.test(inner)) return '';
                return inBold ? inner : `**${inner}**`;
              }
              if (tag === 'EM' || tag === 'I') {
                const inner = walkChildren(inBold, inPre).trim();
                return inner ? `*${inner}*` : '';
              }
              if (/^H[1-6]$/.test(tag)) {
                const inner = walkChildren(true, inPre)
                  .replace(/^\*\*|\*\*$/g, '')
                  .trim();
                if (!inner || UI_CHROME_LINE_RE.test(inner)) return '';
                return `\n\n**${inner}**\n\n`;
              }
              if (tag === 'LI') {
                const inner = walkChildren(inBold, inPre).trim();
                return inner ? `\n- ${inner}` : '';
              }
              if (
                tag === 'P' ||
                tag === 'UL' ||
                tag === 'OL' ||
                tag === 'BLOCKQUOTE'
              ) {
                const inner = walkChildren(inBold, inPre).trim();
                if (!inner || UI_CHROME_LINE_RE.test(inner)) return '';
                return `\n\n${inner}\n\n`;
              }

              return walkChildren(inBold, inPre);
            };

            const rawMd = walk(root, false, false);
            const paragraphs = rawMd
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter((p) => {
                if (!p) return false;
                const plain = p.replace(/^\*\*|\*\*$/g, '').trim();
                return plain.length > 0 && !UI_CHROME_LINE_RE.test(plain);
              });

            const formatted: string[] = [];
            for (const p of paragraphs) {
              // Separate inline bold section titles from body text with a blank line
              const splitInline = p
                .replace(
                  /^\*\*([^*\n]{2,90})\*\*[ \t]+(?=[A-Z0-9"'`(])/g,
                  '**$1**\n\n',
                )
                .replace(
                  /([.?!])[ \t]+(\*\*[^*\n]{2,90}\*\*)[ \t]+(?=[A-Z0-9"'`(])/g,
                  '$1\n\n$2\n\n',
                );
              formatted.push(splitInline);
            }

            return formatted.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
          };

          const CODE_CHROME_TOKEN_RE =
            /^(?:code|content_copy|copy|download|expand_less|expand_more|check|wrap_text|play_arrow|terminal|open_in_new|share|thumb_up|thumb_down|more_vert|edit|refresh|spark|auto_awesome)$/i;
          const KNOWN_CODE_LANG_RE =
            /^(?:python|py|luau|lua|typescript|ts|javascript|js|tsx|jsx|json|bash|sh|shell|zsh|powershell|ps1|html|css|scss|sql|rust|rs|go|golang|cpp|c\+\+|c|csharp|c#|cs|java|kotlin|swift|yaml|yml|toml|xml|markdown|md|text|plaintext|txt|diff|graphql|prisma|dockerfile)$/i;

          const extractCodeText = (node: EvalNode): string => {
            const nt = node.nodeType ?? 1;
            if (nt === 3) {
              return node.nodeValue ?? '';
            }
            if (nt !== 1) return '';
            const tag = (node.tagName ?? '').toUpperCase();
            if (tag === 'BR') return '\n';
            if (
              tag === 'BUTTON' ||
              tag === 'MAT-ICON' ||
              tag === 'SVG' ||
              tag === 'STYLE' ||
              tag === 'SCRIPT'
            ) {
              return '';
            }
            const cls = typeof node.className === 'string' ? node.className : '';
            if (
              /\b(mat-icon|material-icons|material-symbols-outlined|google-symbols|code-block-decoration|header-formatted|code-header|code-block-header|code-toolbar|copy-button|download-button)\b/i.test(
                cls,
              )
            ) {
              return '';
            }
            const children = node.childNodes ? Array.from(node.childNodes) : [];
            return children.map((c) => extractCodeText(c)).join('');
          };

          const detectCodeBlockLanguage = (
            container: EvalNode,
            preEl: EvalNode | null,
            codeEl: EvalNode | null,
          ): string => {
            const candidates = [codeEl, preEl, container, preEl?.parentElement ?? null];
            for (const cand of candidates) {
              if (!cand) continue;
              const dataLang = cand.getAttribute?.('data-lang') ?? cand.getAttribute?.('language');
              if (dataLang && KNOWN_CODE_LANG_RE.test(dataLang.trim())) {
                return dataLang.trim();
              }
              const cls = typeof cand.className === 'string' ? cand.className : '';
              const langMatch = /\blanguage-([a-z0-9_+#-]+)\b/i.exec(cls);
              if (langMatch?.[1]) {
                return langMatch[1];
              }
            }

            const searchRoots: EvalNode[] = [container];
            if (preEl?.previousElementSibling) {
              searchRoots.push(preEl.previousElementSibling);
            }
            if (preEl?.parentElement && preEl.parentElement !== container) {
              searchRoots.push(preEl.parentElement);
            }

            const collectHeaderTokens = (n: EvalNode, out: string[]): void => {
              const nt = n.nodeType ?? 1;
              if (nt === 3) {
                const val = (n.nodeValue ?? '').trim();
                if (val) {
                  for (const tok of val.split(/\s+/)) {
                    if (tok) out.push(tok);
                  }
                }
                return;
              }
              if (nt !== 1) return;
              const tag = (n.tagName ?? '').toUpperCase();
              if (tag === 'PRE' || tag === 'CODE' || tag === 'STYLE' || tag === 'SCRIPT') {
                return;
              }
              const kids = n.childNodes ? Array.from(n.childNodes) : [];
              for (const k of kids) {
                collectHeaderTokens(k, out);
              }
            };

            const tokens: string[] = [];
            for (const sr of searchRoots) {
              collectHeaderTokens(sr, tokens);
            }
            for (const tok of tokens) {
              if (CODE_CHROME_TOKEN_RE.test(tok)) continue;
              if (KNOWN_CODE_LANG_RE.test(tok)) {
                return tok;
              }
            }
            return '';
          };

          const isCodeToolbarElement = (node: EvalNode): boolean => {
            const cls = typeof node.className === 'string' ? node.className : '';
            if (
              /\b(code-block-decoration|header-formatted|code-header|code-block-header|code-toolbar)\b/i.test(
                cls,
              )
            ) {
              return true;
            }
            if (node.querySelector?.('pre, code')) {
              return false;
            }
            const rawText = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
            if (!rawText || rawText.length > 80) return false;
            return (
              /\bcontent_copy\b/i.test(rawText) &&
              /\b(download|expand_less|expand_more|code)\b/i.test(rawText)
            );
          };

          const extractResponseMarkdown = (root: EvalNode): string => {
            const walk = (node: EvalNode, inBold: boolean): string => {
              const nt = node.nodeType ?? 1;
              if (nt === 3) {
                const raw = node.nodeValue ?? '';
                return raw.replace(/[\r\n]+/g, ' ');
              }
              if (nt !== 1) return '';

              const tag = (node.tagName ?? '').toUpperCase();
              if (tag === 'TOOL_CALL') {
                return `<tool_call>${(node.childNodes ? Array.from(node.childNodes) : []).map((c) => walk(c, inBold)).join('')}</tool_call>`;
              }
              if (
                tag === 'BUTTON' ||
                tag === 'MAT-ICON' ||
                tag === 'SVG' ||
                tag === 'STYLE' ||
                tag === 'SCRIPT' ||
                tag === 'MAT-EXPANSION-PANEL-HEADER' ||
                tag === 'MS-THOUGHT-CHUNK' ||
                tag === 'MODEL-THOUGHTS'
              ) {
                return '';
              }

              const cls = typeof node.className === 'string' ? node.className : '';
              if (
                /\b(mat-icon|material-icons|material-symbols-outlined|google-symbols|mat-expansion-panel-header|mat-expansion-indicator|thoughts-header|thought-header|thinking-header|thought-chunk|copy-button|download-button)\b/i.test(
                  cls,
                )
              ) {
                return '';
              }

              if (isCodeToolbarElement(node)) {
                return '';
              }

              if (
                tag === 'MS-CODE-BLOCK' ||
                tag === 'CODE-BLOCK' ||
                tag === 'PRE' ||
                /\b(code-block-container|code-block-internal|code-block|code-container)\b/i.test(
                  cls,
                )
              ) {
                const preEl =
                  tag === 'PRE' ? node : (node.querySelector?.('pre') ?? null);
                const codeEl = preEl
                  ? (preEl.querySelector?.('code') ?? preEl)
                  : (node.querySelector?.('code') ?? null);
                if (preEl || codeEl) {
                  const lang = detectCodeBlockLanguage(node, preEl, codeEl);
                  const rawCode = extractCodeText(codeEl ?? preEl ?? node)
                    .replace(/\r\n/g, '\n')
                    .replace(/^\n+|\n+$/g, '');
                  return rawCode
                    ? `\n\n\`\`\`${lang}\n${rawCode}\n\`\`\`\n\n`
                    : '';
                }
              }

              const children = node.childNodes ? Array.from(node.childNodes) : [];
              const hasElementChild = children.some((c) => (c.nodeType ?? 0) === 1);
              if (!hasElementChild) {
                const leafText = (node.textContent ?? '').trim();
                if (!leafText || CODE_CHROME_TOKEN_RE.test(leafText)) {
                  return '';
                }
              }

              const walkChildren = (nextBold: boolean): string =>
                children.map((c) => walk(c, nextBold)).join('');

              if (tag === 'BR') return '\n';
              if (tag === 'HR') return '\n\n---\n\n';
              if (tag === 'CODE') {
                const code = (node.textContent ?? '').trim();
                return code ? `\`${code}\`` : '';
              }
              if (tag === 'STRONG' || tag === 'B') {
                const inner = walkChildren(true).trim();
                if (!inner) return '';
                return inBold ? inner : `**${inner}**`;
              }
              if (tag === 'EM' || tag === 'I') {
                const inner = walkChildren(inBold).trim();
                return inner ? `*${inner}*` : '';
              }
              if (/^H[1-6]$/.test(tag)) {
                const level = Number(tag.slice(1));
                const inner = walkChildren(true)
                  .replace(/^\*\*|\*\*$/g, '')
                  .replace(/\n+/g, ' ')
                  .trim();
                if (!inner) return '';
                return `\n\n${'#'.repeat(level)} ${inner}\n\n`;
              }
              if (tag === 'UL') {
                const items = children
                  .filter((c) => (c.tagName ?? '').toUpperCase() === 'LI')
                  .map((li) => {
                    const liKids = li.childNodes ? Array.from(li.childNodes) : [];
                    return liKids.map((k) => walk(k, inBold)).join('').trim();
                  })
                  .filter(Boolean);
                return items.length > 0
                  ? `\n\n${items.map((it) => `- ${it}`).join('\n')}\n\n`
                  : walkChildren(inBold);
              }
              if (tag === 'OL') {
                const items = children
                  .filter((c) => (c.tagName ?? '').toUpperCase() === 'LI')
                  .map((li) => {
                    const liKids = li.childNodes ? Array.from(li.childNodes) : [];
                    return liKids.map((k) => walk(k, inBold)).join('').trim();
                  })
                  .filter(Boolean);
                return items.length > 0
                  ? `\n\n${items.map((it, idx) => `${idx + 1}. ${it}`).join('\n')}\n\n`
                  : walkChildren(inBold);
              }
              if (tag === 'LI') {
                const inner = walkChildren(inBold).trim();
                return inner ? `\n- ${inner}` : '';
              }
              if (tag === 'BLOCKQUOTE') {
                const inner = walkChildren(inBold).trim();
                if (!inner) return '';
                const quoted = inner
                  .split('\n')
                  .map((l) => `> ${l}`)
                  .join('\n');
                return `\n\n${quoted}\n\n`;
              }
              if (tag === 'TABLE') {
                const trs = node.querySelectorAll
                  ? Array.from(node.querySelectorAll('tr'))
                  : [];
                if (trs.length === 0) return walkChildren(inBold);
                const rows: string[][] = [];
                for (const tr of trs) {
                  const cells = tr.querySelectorAll
                    ? Array.from(tr.querySelectorAll('th, td'))
                    : [];
                  if (cells.length === 0) continue;
                  rows.push(
                    cells.map((cell) => {
                      const cKids = cell.childNodes
                        ? Array.from(cell.childNodes)
                        : [];
                      return cKids
                        .map((k) => walk(k, false))
                        .join('')
                        .replace(/\n+/g, ' ')
                        .replace(/\|/g, '\\|')
                        .trim();
                    }),
                  );
                }
                if (rows.length === 0) return '';
                const colCount = Math.max(...rows.map((r) => r.length));
                const padRow = (r: string[]): string =>
                  `| ${Array.from({ length: colCount }, (_, i) => r[i] ?? '').join(' | ')} |`;
                const headerLine = padRow(rows[0]!);
                const sepLine = `| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`;
                const bodyLines = rows.slice(1).map((r) => padRow(r));
                return `\n\n${[headerLine, sepLine, ...bodyLines].join('\n')}\n\n`;
              }
              if (tag === 'P') {
                const inner = walkChildren(inBold).trim();
                return inner ? `\n\n${inner}\n\n` : '';
              }

              return walkChildren(inBold);
            };

            return walk(root, false)
              .replace(/[ \t]+\n/g, '\n')
              .replace(/\n{3,}/g, '\n\n')
              .trim();
          };

          if (isAiStudio) {
            const rawTurns = Array.from(
              doc.querySelectorAll(
                'ms-chat-turn .model-prompt-container, ms-chat-turn[data-turn-role="Model"]',
              ),
            );
            const turns = rawTurns.filter(
              (el) =>
                !rawTurns.some(
                  (other) => other !== el && Boolean(other.contains?.(el)),
                ),
            );
            const count = turns.length;
            let text = '';
            let thoughtText = '';
            if (count > initCount && count > 0) {
              const lastTurn = turns[count - 1];
              const rawThoughtContainers = lastTurn?.querySelectorAll
                ? Array.from(
                    lastTurn.querySelectorAll(
                      'ms-thought-chunk, .thought-chunk',
                    ),
                  )
                : [];
              const thoughtContainers = rawThoughtContainers.filter(
                (el) =>
                  !rawThoughtContainers.some(
                    (other) => other !== el && Boolean(other.contains?.(el)),
                  ),
              );
              const thoughtParts: string[] = [];
              for (const tc of thoughtContainers) {
                // Only click expand if the thought chunk is actually collapsed (aria-expanded="false" or mat-expansion-panel not expanded)
                const expandBtn = tc.querySelector?.(
                  'mat-expansion-panel-header[aria-expanded="false"], button[aria-expanded="false"], mat-expansion-panel:not(.mat-expanded) mat-expansion-panel-header',
                );
                if (expandBtn && typeof expandBtn.click === 'function') {
                  expandBtn.click();
                }
                const cleaned = extractThoughtMarkdown(tc);
                if (cleaned) {
                  thoughtParts.push(cleaned);
                }
              }
              thoughtText = thoughtParts.join('\n\n').trim();

              const textChunks = lastTurn?.querySelectorAll
                ? Array.from(lastTurn.querySelectorAll('ms-text-chunk')).filter(
                    (chunk) =>
                      !chunk.closest?.(
                        'ms-thought-chunk, .thought-chunk, mat-expansion-panel',
                      ),
                  )
                : [];
              if (textChunks.length > 0) {
                text = textChunks
                  .map((c) => extractResponseMarkdown(c))
                  .filter(Boolean)
                  .join('\n\n')
                  .trim();
              }

              // Also detect native AI Studio Function Call cards (e.g. `fx google:read_workspace_file`)
              // rendered outside `ms-text-chunk` when Grounding with Google Search is active, and
              // synthesize `<tool_call>{"name": "...", "arguments": {...}}</tool_call>` blocks.
              const turnClone = lastTurn?.cloneNode?.(true);
              if (turnClone?.querySelectorAll) {
                const stripNodes = Array.from(
                  turnClone.querySelectorAll(
                    'ms-thought-chunk, .thought-chunk, ms-text-chunk, mat-icon, .material-icons, .material-symbols-outlined, .google-symbols',
                  ),
                );
                for (const sn of stripNodes) {
                  sn.remove?.();
                }
                const nonThoughtText = (
                  turnClone.innerText ??
                  turnClone.textContent ??
                  ''
                ).trim();
                const fnRegex =
                  /(?:google:|\b)(read_workspace_file|list_workspace_files|grep_workspace|edit_workspace_file|comment_workspace_file|run_terminal_command|save_artifact|vault_search|vault_read|delegate_task|update_milestone|request_human|record_playtest_finding|propose_fix|create_build|promote_build|market_query|generate_image|studio_inspect_tree|studio_read_script|studio_run_diagnostics|studio_run_playtest|pc_observe|pc_act|pc_window|pc_sandbox|studio_direct)\b/g;
                const synthesizedCalls: string[] = [];
                let fnMatch: RegExpExecArray | null;
                while ((fnMatch = fnRegex.exec(nonThoughtText)) !== null) {
                  const fnName = fnMatch[1]!;
                  const searchFrom = fnMatch.index + fnMatch[0].length;
                  const braceStart = nonThoughtText.indexOf('{', searchFrom);
                  if (braceStart === -1 || braceStart - searchFrom > 140) {
                    continue;
                  }
                  let depth = 0;
                  let inStr = false;
                  let esc = false;
                  let braceEnd = -1;
                  for (let k = braceStart; k < nonThoughtText.length; k++) {
                    const ch = nonThoughtText[k];
                    if (esc) {
                      esc = false;
                      continue;
                    }
                    if (ch === '\\' && inStr) {
                      esc = true;
                      continue;
                    }
                    if (ch === '"') {
                      inStr = !inStr;
                      continue;
                    }
                    if (!inStr) {
                      if (ch === '{') depth++;
                      else if (ch === '}') {
                        depth--;
                        if (depth === 0) {
                          braceEnd = k;
                          break;
                        }
                      }
                    }
                  }
                  if (braceEnd !== -1) {
                    const candidateJson = nonThoughtText.slice(
                      braceStart,
                      braceEnd + 1,
                    );
                    try {
                      const parsedArgs = JSON.parse(candidateJson) as unknown;
                      if (
                        typeof parsedArgs === 'object' &&
                        parsedArgs !== null &&
                        !Array.isArray(parsedArgs)
                      ) {
                        synthesizedCalls.push(
                          `<tool_call>${JSON.stringify({
                            name: fnName,
                            arguments: parsedArgs,
                          })}</tool_call>`,
                        );
                        fnRegex.lastIndex = braceEnd + 1;
                      }
                    } catch {
                      // JSON object still streaming or invalid
                    }
                  }
                }
                if (synthesizedCalls.length > 0) {
                  text = [text, ...synthesizedCalls].filter(Boolean).join('\n').trim();
                }
              }
            }

            const lastTurnForInputs =
              count > 0 ? turns[count - 1] : undefined;
            const openFnInputs = lastTurnForInputs?.querySelectorAll
              ? Array.from(
                  lastTurnForInputs.querySelectorAll(
                    'input[placeholder*="function response" i], textarea[placeholder*="function response" i]',
                  ),
                ).filter((inp) => isVisible(inp) && !inp.disabled)
              : [];
            const openFunctionResponseCount = openFnInputs.length;

            const runButtons = Array.from(
              doc.querySelectorAll('ms-run-button button, run-button button'),
            );
            const hasStopButton = runButtons.some((btn) => {
              if (btn.disabled) return false;
              const btnText = (btn.textContent ?? '').replace(/\s+/g, ' ').trim();
              const cls = typeof btn.className === 'string' ? btn.className : '';
              const aria = btn.getAttribute?.('aria-label') ?? '';
              return (
                /\bstop\b/i.test(btnText) ||
                /\bstoppable\b/i.test(cls) ||
                /\bstop\b/i.test(aria) ||
                Boolean(btn.querySelector?.('.spin, mat-progress-spinner, mat-spinner'))
              );
            });
            const hasTurnSpinner = Boolean(
              lastTurnForInputs?.querySelector?.(
                'mat-progress-spinner, mat-spinner, .thinking-progress, .loading-indicator',
              ),
            );
            const isGenerating = hasStopButton || hasTurnSpinner;

            return {
              count,
              modelRespCount: count,
              text,
              thoughtText,
              isGenerating,
              openFunctionResponseCount,
            };
          }

          const modelResponses = Array.from(doc.querySelectorAll('model-response'));
          const modelRespCount = modelResponses.length;

          const allMsgNodes = Array.from(
            doc.querySelectorAll(
              'message-content.model-response-text, model-response message-content, message-content',
            ),
          );
          const turns = allMsgNodes.filter(
            (el) =>
              !el.closest?.('model-thoughts, .model-thoughts, .thoughts-container'),
          );
          const count = turns.length;
          let text = '';
          if (count > initCount && count > 0) {
            const lastTurn = turns[count - 1];
            text = lastTurn
              ? extractResponseMarkdown(lastTurn)
              : '';
          }

          let thoughtText = '';
          if (
            modelRespCount > 0 &&
            (modelRespCount > initModelCount || count > initCount)
          ) {
            const lastModelResp = modelResponses[modelRespCount - 1];
            if (lastModelResp?.querySelectorAll) {
              const rawFullThoughts = Array.from(
                lastModelResp.querySelectorAll(
                  'model-thoughts, .model-thoughts, .thoughts-container',
                ),
              );
              const fullThoughts = rawFullThoughts.filter(
                (el) =>
                  !rawFullThoughts.some(
                    (other) => other !== el && Boolean(other.contains?.(el)),
                  ),
              );
              const fullParts: string[] = [];
              for (const ft of fullThoughts) {
                const cleaned = extractThoughtMarkdown(ft);
                if (cleaned) fullParts.push(cleaned);
              }
              if (fullParts.length > 0) {
                thoughtText = fullParts.join('\n\n').trim();
              } else {
                const overlay = lastModelResp.querySelector?.(
                  'thinking-overlay, .response-container-header-processing-state',
                );
                if (overlay) {
                  thoughtText = extractThoughtMarkdown(overlay);
                }
              }
            }
          }

          const stopButtons = Array.from(
            doc.querySelectorAll(
              'button[aria-label*="Stop" i], button[mattooltip*="Stop" i], button.stop',
            ),
          );
          const isGenerating = stopButtons.some((btn) => !btn.disabled);

          return {
            count,
            modelRespCount,
            text,
            thoughtText,
            isGenerating,
            openFunctionResponseCount: 0,
          };
        },
        {
          isAiStudio: runningOnAiStudio,
          initCount: initialResponseCount,
          initModelCount: initialModelResponseCount,
        },
      )
      .catch(() => ({
        count: 0,
        modelRespCount: 0,
        text: '',
        thoughtText: '',
        isGenerating: false,
        openFunctionResponseCount: 0,
      }));
  }

  private async stopGenerationIfRunning(
    page: Page,
    runningOnAiStudio: boolean,
  ): Promise<void> {
    try {
      await page
        .evaluate((isAiStudio) => {
          const doc = (
            globalThis as unknown as {
              document?: {
                querySelectorAll: (s: string) => ArrayLike<{
                  textContent?: string | null;
                  className?: string;
                  offsetParent?: unknown;
                  offsetWidth?: number;
                  offsetHeight?: number;
                  click?: () => void;
                }>;
              };
            }
          ).document;
          if (!doc) return;
          const isVisible = (el: {
            offsetParent?: unknown;
            offsetWidth?: number;
            offsetHeight?: number;
          }): boolean =>
            el.offsetParent !== null &&
            (el.offsetWidth ?? 0) > 0 &&
            (el.offsetHeight ?? 0) > 0;

          if (isAiStudio) {
            const btns = Array.from(
              doc.querySelectorAll(
                'ms-run-button button, run-button button, button[aria-label*="Stop" i], button.stop',
              ),
            );
            for (const btn of btns) {
              if (!isVisible(btn)) continue;
              const txt = (btn.textContent ?? '').replace(/\s+/g, ' ').trim();
              const cls = typeof btn.className === 'string' ? btn.className : '';
              if (/\bstop\b/i.test(txt) || /\bstoppable\b/i.test(cls)) {
                btn.click?.();
                return;
              }
            }
          } else {
            const stopBtns = Array.from(
              doc.querySelectorAll(
                'button[aria-label*="Stop" i], button[mattooltip*="Stop" i], button.stop',
              ),
            );
            for (const btn of stopBtns) {
              if (isVisible(btn)) {
                btn.click?.();
                return;
              }
            }
          }
        }, runningOnAiStudio)
        .catch(() => {});

      const deadline = Date.now() + 3_500;
      while (Date.now() < deadline) {
        const state = await this.readModelTurnState(page, runningOnAiStudio, -1, -1);
        if (!state.isGenerating) {
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch {
      // ignore
    }
  }

  private async *submitPromptAndStream(
    page: Page,
    runningOnAiStudio: boolean,
    effectiveGuestMode: boolean,
    promptToSend: string,
    agentLabel: string,
    signal: AbortSignal,
    makeStatusEvent: (text: string) => LlmStreamEvent,
    onGuestCannedError?: (errorText: string) => void,
    imagesToAttach: Array<{ mimeType: string; base64: string }> = [],
  ): AsyncIterable<LlmStreamEvent> {
    // Ensure any previous turn's generation is completely stopped before filling and clicking Run
    let initialState = await this.readModelTurnState(page, runningOnAiStudio, -1, -1);
    if (initialState.isGenerating) {
      await this.stopGenerationIfRunning(page, runningOnAiStudio);
      await new Promise((r) => setTimeout(r, 250));
      initialState = await this.readModelTurnState(page, runningOnAiStudio, -1, -1);
    }
    const initialResponseCount = initialState.count;
    const initialModelResponseCount = initialState.modelRespCount;

    // If the existing AI Studio chat already has unanswered native `fx google:*` function call
    // cards from an interrupted turn and this prompt is not yet carrying `[TOOL_RESULT]`,
    // immediately emit those recovered tool calls so RunExecutorService executes them and
    // returns with `[TOOL_RESULT]` on the next turn!
    if (
      runningOnAiStudio &&
      initialState.openFunctionResponseCount > 0 &&
      initialState.text.includes('<tool_call>') &&
      !promptToSend.includes('[TOOL_RESULT')
    ) {
      const recovered = PromptToolBridge.extractToolCallsFromText(
        initialState.text,
      );
      if (recovered.toolCalls.length > 0) {
        if (initialState.thoughtText) {
          yield {
            type: 'thinking',
            text: initialState.thoughtText,
            startedAt: new Date().toISOString(),
            durationMs: 1200,
            done: true,
          };
        }
        if (recovered.cleanText) {
          yield { type: 'text-delta', text: recovered.cleanText };
        }
        yield makeStatusEvent('Executing studio tool call...');
        for (const call of recovered.toolCalls) {
          yield { type: 'tool-call', call };
        }
        yield {
          type: 'usage',
          inputTokens: Math.ceil(promptToSend.length / 4),
          outputTokens: Math.ceil(initialState.text.length / 4),
        };
        yield { type: 'finish', reason: 'tool_calls' };
        return;
      }
    }

    // Small settle delay in Guest Mode so Gemini Web's initial token handshake completes before filling
    if (effectiveGuestMode) {
      await new Promise((r) => setTimeout(r, 350));
    }

    const composerLocator = page.locator(COMPOSER_SELECTOR).first();
    await composerLocator.waitFor({ state: 'visible', timeout: 15_000 });

    const getComposerText = async (): Promise<string> =>
      composerLocator
        .evaluate((el) => {
          const domEl = el as {
            value?: string;
            innerText?: string;
            textContent?: string | null;
          };
          return (
            typeof domEl.value === 'string'
              ? domEl.value
              : (domEl.innerText ?? domEl.textContent ?? '')
          ).trim();
        })
        .catch(() => '');

    const getComposerTextLength = async (): Promise<number> =>
      (await getComposerText()).length;

    // If an unsent [TOOL_RESULT] draft is still sitting in the composer from an interrupted turn
    // and the new prompt is a user continuation (e.g. "Continue") that doesn't already include [TOOL_RESULT],
    // preserve and compact that [TOOL_RESULT] draft and append the user's message to it!
    let effectivePromptToSend = promptToSend;
    const existingDraft = await getComposerText();
    if (
      !effectivePromptToSend.includes('[TOOL_RESULT') &&
      existingDraft.includes('[TOOL_RESULT')
    ) {
      let compactedDraft = existingDraft.replace(
        /,"rawContent":"(?:\\.|[^"\\])*"/g,
        '',
      );
      // If the draft in the composer was accidentally doubled back-to-back, deduplicate it
      const firstHeaderMatch = /^\[TOOL_RESULT\s+name="[^"]+"\s+id="[^"]+"\]/.exec(
        compactedDraft,
      );
      if (firstHeaderMatch) {
        const secondIdx = compactedDraft.indexOf(
          firstHeaderMatch[0],
          firstHeaderMatch[0].length,
        );
        if (secondIdx > 0) {
          compactedDraft = compactedDraft.slice(0, secondIdx).trim();
        }
      }
      effectivePromptToSend = `${compactedDraft}\n\n${promptToSend}`;
    }

    // If the previous AI Studio turn rendered native `fx google:*` function call cards with
    // "Enter function response" inputs and we are now submitting `[TOOL_RESULT]` payloads,
    // fill those function response inputs directly and click their "Send" buttons!
    let submittedViaFnCards = false;
    if (
      runningOnAiStudio &&
      initialState.openFunctionResponseCount > 0 &&
      effectivePromptToSend.includes('[TOOL_RESULT')
    ) {
      const toolResultChunks = effectivePromptToSend
        .split(/(?=\[TOOL_RESULT\s+name=)/)
        .map((c) => c.trim())
        .filter(Boolean);

      const filledCount = await page
        .evaluate((chunks: string[]) => {
          interface FnDomEl {
            tagName?: string;
            value?: string;
            disabled?: boolean;
            offsetParent?: unknown;
            offsetWidth?: number;
            offsetHeight?: number;
            parentElement?: FnDomEl | null;
            focus?: () => void;
            click?: () => void;
            dispatchEvent?: (ev: Event) => boolean;
            querySelectorAll?: (s: string) => ArrayLike<FnDomEl>;
            textContent?: string | null;
          }
          const doc = (
            globalThis as unknown as {
              document?: { querySelectorAll: (s: string) => ArrayLike<FnDomEl> };
            }
          ).document;
          if (!doc) return 0;

          const isVis = (el: FnDomEl): boolean =>
            el.offsetParent !== null &&
            (el.offsetWidth ?? 0) > 0 &&
            (el.offsetHeight ?? 0) > 0;

          const inputs = Array.from(
            doc.querySelectorAll(
              'input[placeholder*="function response" i], textarea[placeholder*="function response" i]',
            ),
          ).filter((inp) => isVis(inp) && !inp.disabled);

          if (inputs.length === 0) return 0;

          for (let idx = 0; idx < inputs.length; idx++) {
            const inp = inputs[idx]!;
            const rawChunk =
              idx < inputs.length - 1
                ? (chunks[idx] ?? chunks[0] ?? '')
                : chunks.slice(idx).join('\n\n') ||
                  chunks[chunks.length - 1] ||
                  '';
            const singleLinePayload = JSON.stringify({
              ok: true,
              toolResult: rawChunk,
            });
            inp.focus?.();
            const tag = (inp.tagName ?? '').toUpperCase();
            const proto =
              tag === 'TEXTAREA'
                ? (
                    globalThis as unknown as {
                      HTMLTextAreaElement?: { prototype: object };
                    }
                  ).HTMLTextAreaElement?.prototype
                : (
                    globalThis as unknown as {
                      HTMLInputElement?: { prototype: object };
                    }
                  ).HTMLInputElement?.prototype;
            const nativeSetter = proto
              ? Object.getOwnPropertyDescriptor(proto, 'value')?.set
              : undefined;
            if (nativeSetter) {
              nativeSetter.call(inp, singleLinePayload);
            } else {
              inp.value = singleLinePayload;
            }
            inp.dispatchEvent?.(new Event('input', { bubbles: true }));
            inp.dispatchEvent?.(new Event('change', { bubbles: true }));
          }
          return inputs.length;
        }, toolResultChunks)
        .catch(() => 0);

      if (filledCount > 0) {
        await new Promise((r) => setTimeout(r, 200));
        // Click each "Send" button next to the filled function response inputs
        for (let clickIdx = 0; clickIdx < filledCount; clickIdx++) {
          const sendFnBtn = page
            .locator(
              'ms-chat-turn button:has-text("Send"):not([disabled]), .model-prompt-container button:has-text("Send"):not([disabled])',
            )
            .first();
          if ((await sendFnBtn.count().catch(() => 0)) > 0) {
            await sendFnBtn.scrollIntoViewIfNeeded().catch(() => {});
            await sendFnBtn.click({ timeout: 2_500 }).catch(async () => {
              await sendFnBtn.click({ timeout: 2_000, force: true }).catch(() => {});
            });
            await new Promise((r) => setTimeout(r, 320));
          }
        }

        for (let checkTick = 0; checkTick < 6; checkTick++) {
          await new Promise((r) => setTimeout(r, 250));
          const postFnState = await this.readModelTurnState(
            page,
            runningOnAiStudio,
            initialResponseCount,
            initialModelResponseCount,
          );
          if (
            postFnState.count > initialResponseCount ||
            postFnState.isGenerating
          ) {
            submittedViaFnCards = true;
            break;
          }
          if (
            postFnState.openFunctionResponseCount === 0 &&
            checkTick === 2
          ) {
            const runBtnAfterFn = page
              .locator(
                'ms-run-button button:has-text("Run"), run-button button:has-text("Run")',
              )
              .first();
            if ((await runBtnAfterFn.count().catch(() => 0)) > 0) {
              await runBtnAfterFn.click({ timeout: 2_000 }).catch(() => {});
            }
          }
        }
      }
    }

    if (!submittedViaFnCards) {
      await composerLocator.click({ timeout: 8_000 }).catch(async () => {
        await composerLocator.focus().catch(() => {});
      });

      // If any screenshot/tool images are attached to this turn, paste them into the composer
      if (imagesToAttach.length > 0) {
        await composerLocator
          .evaluate(
            (el, imgs) => {
              const g = globalThis as unknown as {
                atob?: (b64: string) => string;
                DataTransfer?: new () => {
                  items: { add: (file: unknown) => void };
                };
                File?: new (
                  parts: unknown[],
                  name: string,
                  opts: { type: string },
                ) => unknown;
                ClipboardEvent?: new (
                  type: string,
                  init: {
                    clipboardData: unknown;
                    bubbles: boolean;
                    cancelable: boolean;
                  },
                ) => Event;
              };
              if (!g.atob || !g.DataTransfer || !g.File || !g.ClipboardEvent) {
                return false;
              }
              const dt = new g.DataTransfer();
              imgs.slice(0, 3).forEach((img, idx) => {
                const bin = g.atob!(img.base64);
                const bytes = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) {
                  bytes[i] = bin.charCodeAt(i);
                }
                const file = new g.File!(
                  [bytes],
                  `pc_observe_${idx + 1}.png`,
                  { type: img.mimeType || 'image/png' },
                );
                dt.items.add(file);
              });
              const pasteEv = new g.ClipboardEvent('paste', {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
              });
              (el as { dispatchEvent?: (e: Event) => boolean }).dispatchEvent?.(
                pasteEv,
              );
              return true;
            },
            imagesToAttach.map((i) => ({
              mimeType: i.mimeType,
              base64: i.base64,
            })),
          )
          .catch(() => false);
        await new Promise((r) => setTimeout(r, 850));
      }

      // Set the composer value atomically via the native prototype setter + InputEvent
      // and cap max-height to 220px so <ms-autosize-textarea> never expands to 20,000px
      // or times out on large [TOOL_RESULT] payloads, and NEVER duplicates the text!
      const setViaDomOk = await composerLocator
        .evaluate((el, textToSet) => {
          const domEl = el as {
            tagName?: string;
            value?: string;
            textContent?: string | null;
            style?: { maxHeight?: string; overflowY?: string };
            focus?: () => void;
            dispatchEvent?: (ev: Event) => boolean;
          };
          domEl.focus?.();
          if (domEl.style) {
            domEl.style.maxHeight = '220px';
            domEl.style.overflowY = 'auto';
          }
          const tag = (domEl.tagName ?? '').toUpperCase();
          if (tag === 'TEXTAREA' || tag === 'INPUT') {
            const proto =
              tag === 'TEXTAREA'
                ? (globalThis as unknown as { HTMLTextAreaElement?: { prototype: object } })
                    .HTMLTextAreaElement?.prototype
                : (globalThis as unknown as { HTMLInputElement?: { prototype: object } })
                    .HTMLInputElement?.prototype;
            const nativeSetter = proto
              ? Object.getOwnPropertyDescriptor(proto, 'value')?.set
              : undefined;
            if (nativeSetter) {
              nativeSetter.call(domEl, textToSet);
            } else {
              domEl.value = textToSet;
            }
          } else {
            domEl.textContent = textToSet;
          }
          if (typeof domEl.dispatchEvent === 'function') {
            domEl.dispatchEvent(new Event('input', { bubbles: true }));
            domEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          return true;
        }, effectivePromptToSend)
        .catch(() => false);

      if (!setViaDomOk) {
        await composerLocator.fill(effectivePromptToSend, { timeout: 10_000 }).catch(() => {});
      }

      // Send a single real keystroke (space + Backspace) at the end of the composer
      // so Angular's DefaultValueAccessor / FormControl updates dirty/valid state immediately
      await composerLocator.focus().catch(() => {});
      await page.keyboard.press('End').catch(() => {});
      await page.keyboard.type(' ').catch(() => {});
      await page.keyboard.press('Backspace').catch(() => {});
      await new Promise((r) => setTimeout(r, 220));
    }

    for (let submitAttempt = 0; !submittedViaFnCards && submitAttempt < 4; submitAttempt++) {
      if (signal.aborted) break;

      if (runningOnAiStudio) {
        if (submitAttempt > 0) {
          await composerLocator.focus().catch(() => {});
          await page.keyboard.press('End').catch(() => {});
          await page.keyboard.type(' ').catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          await new Promise((r) => setTimeout(r, 150));
        }

        // Wait briefly for Run button to become enabled and not in "Stop" state
        await page
          .waitForFunction(
            () => {
              const doc = (
                globalThis as unknown as {
                  document?: {
                    querySelectorAll: (s: string) => ArrayLike<{
                      disabled?: boolean;
                      textContent?: string | null;
                      className?: string;
                      getAttribute?: (n: string) => string | null;
                    }>;
                  };
                }
              ).document;
              if (!doc) return false;
              const btns = Array.from(
                doc.querySelectorAll('ms-run-button button, run-button button'),
              );
              return btns.some((b) => {
                const txt = (b.textContent ?? '').replace(/\s+/g, ' ').trim();
                const cls = typeof b.className === 'string' ? b.className : '';
                const isStop =
                  /\bstop\b/i.test(txt) || /\bstoppable\b/i.test(cls);
                const isDisabled =
                  Boolean(b.disabled) ||
                  b.getAttribute?.('disabled') !== null ||
                  b.getAttribute?.('aria-disabled') === 'true';
                return !isStop && !isDisabled && /\brun\b/i.test(txt);
              });
            },
            undefined,
            { timeout: 2_500 },
          )
          .catch(() => {});

        const runBtn = page
          .locator(
            'ms-run-button button:has-text("Run"), run-button button:has-text("Run"), ms-run-button button.ctrl-enter-submits, ms-run-button button[type="submit"]',
          )
          .first();

        if ((await runBtn.count().catch(() => 0)) > 0) {
          await runBtn.scrollIntoViewIfNeeded().catch(() => {});
          await runBtn.click({ timeout: 3_500 }).catch(async () => {
            await runBtn.click({ timeout: 2_500, force: true }).catch(() => {});
          });
        }

        // If composer still has text after 250ms, also fire Control+Enter and native DOM click
        await new Promise((r) => setTimeout(r, 250));
        if ((await getComposerTextLength()) > 0) {
          await composerLocator.focus().catch(() => {});
          await composerLocator.press('Control+Enter').catch(async () => {
            await page.keyboard.press('Control+Enter').catch(() => {});
          });
          await new Promise((r) => setTimeout(r, 180));
        }

        if ((await getComposerTextLength()) > 0) {
          await page
            .evaluate(() => {
              const doc = (
                globalThis as unknown as {
                  document?: {
                    querySelectorAll: (s: string) => ArrayLike<{
                      disabled?: boolean;
                      textContent?: string | null;
                      className?: string;
                      getAttribute?: (n: string) => string | null;
                      click?: () => void;
                    }>;
                  };
                }
              ).document;
              if (!doc) return;
              const btns = Array.from(
                doc.querySelectorAll('ms-run-button button, run-button button'),
              );
              for (const b of btns) {
                const txt = (b.textContent ?? '').replace(/\s+/g, ' ').trim();
                const cls = typeof b.className === 'string' ? b.className : '';
                const isDisabled =
                  Boolean(b.disabled) ||
                  b.getAttribute?.('disabled') !== null ||
                  b.getAttribute?.('aria-disabled') === 'true';
                if (
                  !isDisabled &&
                  !/\bstop\b/i.test(txt) &&
                  !/\bstoppable\b/i.test(cls) &&
                  (/\brun\b/i.test(txt) || btns.length === 1)
                ) {
                  b.click?.();
                  break;
                }
              }
            })
            .catch(() => {});
        }
      } else {
        if (submitAttempt > 0) {
          await composerLocator.focus().catch(() => {});
          await page.keyboard.press('End').catch(() => {});
          await page.keyboard.type(' ').catch(() => {});
          await page.keyboard.press('Backspace').catch(() => {});
          await new Promise((r) => setTimeout(r, 150));
        }

        const sendBtn = page
          .locator(
            'button.send-button, button[aria-label*="Send message" i], button[mattooltip*="Send" i]',
          )
          .first();
        if (submitAttempt === 0 && (await sendBtn.count().catch(() => 0)) > 0) {
          await sendBtn.click({ timeout: 5_000 }).catch(async () => {
            await composerLocator.focus().catch(() => {});
            await page.keyboard.press('Enter');
          });
        } else {
          await composerLocator.focus().catch(() => {});
          await page.keyboard.press('Enter').catch(() => {});
        }
      }

      // Strictly verify that the prompt was actually submitted:
      // The composer MUST have cleared (remainingLen === 0) OR a new model turn MUST have appeared in the DOM!
      let submitted = false;
      for (let checkTick = 0; checkTick < 6; checkTick++) {
        await new Promise((r) => setTimeout(r, 230));
        const postState = await this.readModelTurnState(
          page,
          runningOnAiStudio,
          initialResponseCount,
          initialModelResponseCount,
        );
        const remainingLen = await getComposerTextLength();
        if (
          remainingLen === 0 ||
          postState.count > initialResponseCount ||
          postState.modelRespCount > initialModelResponseCount
        ) {
          submitted = true;
          break;
        }
      }

      if (submitted) {
        break;
      }
    }

    const thinkingStartMs = Date.now();
    const thinkingStartedAt = new Date(thinkingStartMs).toISOString();
    let accumulatedThoughts = '';
    const geminiThinkingSteps: string[] = [];
    let lastEmittedThoughts = '';
    let lastThinkingEmitMs = thinkingStartMs;
    let thinkingFinalized = false;

    yield makeStatusEvent(`${agentLabel} is thinking...`);
    yield {
      type: 'thinking',
      text: '',
      startedAt: thinkingStartedAt,
      durationMs: 0,
      done: false,
    };

    let emittedSoFar = '';
    let yieldedText = '';
    let stableTicks = 0;
    let unchangedWhileGeneratingTicks = 0;
    let emittedDelegatingStatus = false;
    let finalThinkingDur = 100;
    const startTime = Date.now();

    const computeStreamableText = (rawText: string): string =>
      PromptToolBridge.computeStreamableText(rawText);

    while (!signal.aborted && Date.now() - startTime < 180_000) {
      await new Promise((r) => setTimeout(r, 200));

      const { text, thoughtText, isGenerating } = await this.readModelTurnState(
        page,
        runningOnAiStudio,
        initialResponseCount,
        initialModelResponseCount,
      );

      if (thoughtText.length > 0) {
        if (runningOnAiStudio || thoughtText.includes('\n') || thoughtText.length > 140) {
          if (thoughtText.length >= accumulatedThoughts.length) {
            if (thoughtText.length > accumulatedThoughts.length) {
              unchangedWhileGeneratingTicks = 0;
            }
            accumulatedThoughts = thoughtText;
          }
        } else {
          const stepLine = `• ${thoughtText}`;
          if (!geminiThinkingSteps.includes(stepLine)) {
            geminiThinkingSteps.push(stepLine);
            accumulatedThoughts = geminiThinkingSteps.join('\n');
            unchangedWhileGeneratingTicks = 0;
          }
        }
      }

      if (!thinkingFinalized) {
        const now = Date.now();
        const dur = Math.max(100, now - thinkingStartMs);
        finalThinkingDur = dur;
        if (text.length > 4 || text.includes('<tool_call')) {
          thinkingFinalized = true;
          lastEmittedThoughts = accumulatedThoughts;
          yield {
            type: 'thinking',
            text: accumulatedThoughts,
            startedAt: thinkingStartedAt,
            durationMs: dur,
            done: true,
          };
        } else if (
          accumulatedThoughts !== lastEmittedThoughts ||
          now - lastThinkingEmitMs >= 600
        ) {
          lastEmittedThoughts = accumulatedThoughts;
          lastThinkingEmitMs = now;
          yield {
            type: 'thinking',
            text: accumulatedThoughts,
            startedAt: thinkingStartedAt,
            durationMs: dur,
            done: false,
          };
        }
      } else if (accumulatedThoughts !== lastEmittedThoughts) {
        lastEmittedThoughts = accumulatedThoughts;
        yield {
          type: 'thinking',
          text: accumulatedThoughts,
          startedAt: thinkingStartedAt,
          durationMs: finalThinkingDur,
          done: true,
        };
      }

      if (text.length > 0 && text !== emittedSoFar) {
        emittedSoFar = text;
        stableTicks = 0;
        unchangedWhileGeneratingTicks = 0;

        const isPotentialGuestError =
          effectiveGuestMode &&
          !runningOnAiStudio &&
          GEMINI_WEB_ERROR_REPLY_REGEX.test(emittedSoFar);

        if (!isPotentialGuestError) {
          const streamable = computeStreamableText(text);
          if (streamable !== yieldedText) {
            if (streamable.length === 0) {
              yieldedText = '';
              yield { type: 'text-delta', text: '', replace: true };
            } else if (yieldedText.length === 0) {
              yieldedText = streamable;
              yield { type: 'text-delta', text: streamable };
            } else if (
              streamable.length > yieldedText.length &&
              streamable.startsWith(yieldedText)
            ) {
              const nextDelta = streamable.slice(yieldedText.length);
              yieldedText = streamable;
              yield { type: 'text-delta', text: nextDelta };
            } else {
              yieldedText = streamable;
              yield { type: 'text-delta', text: streamable, replace: true };
            }
          }

          if (emittedSoFar.includes('<tool_call>') && !emittedDelegatingStatus) {
            emittedDelegatingStatus = true;
            yield makeStatusEvent(
              emittedSoFar.includes('delegate_task')
                ? 'Delegating tasks to specialist agents...'
                : 'Executing studio tool call...',
            );
          }

          // Mid-thought tool call interception for inspection/read tools:
          // If the model emitted a completed read/search/diagnostics <tool_call> and is starting
          // to write speculative text after </tool_call> instead of waiting for [TOOL_RESULT],
          // stop the browser generation immediately and execute the tool!
          const hasNoUnclosedTag =
            emittedSoFar.lastIndexOf('</tool_call>') >
            emittedSoFar.lastIndexOf('<tool_call>');
          if (
            hasNoUnclosedTag &&
            PromptToolBridge.containsInspectionToolCall(emittedSoFar)
          ) {
            const closeIdx = emittedSoFar
              .toLowerCase()
              .lastIndexOf('</tool_call>');
            const trailingAfterClose = emittedSoFar
              .slice(closeIdx + '</tool_call>'.length)
              .replace(/^[\s`]+/, '')
              .trim();
            if (
              trailingAfterClose.length > 40 &&
              !trailingAfterClose.includes('<tool_call')
            ) {
              emittedSoFar =
                PromptToolBridge.truncateAfterLastToolCall(emittedSoFar);
              await this.stopGenerationIfRunning(page, runningOnAiStudio);
              break;
            }
          }
        }
      } else if (emittedSoFar.length > 0) {
        if (!isGenerating) {
          stableTicks += 1;
          const hasUnclosedToolCall =
            emittedSoFar.lastIndexOf('<tool_call>') >
            emittedSoFar.lastIndexOf('</tool_call>');
          const requiredStableTicks = hasUnclosedToolCall ? 20 : 12;
          if (stableTicks >= requiredStableTicks) {
            break;
          }
        } else {
          unchangedWhileGeneratingTicks += 1;
          const hasClosedToolCall =
            emittedSoFar.includes('</tool_call>') &&
            emittedSoFar.lastIndexOf('</tool_call>') >
              emittedSoFar.lastIndexOf('<tool_call>');
          const isInspectionCall =
            hasClosedToolCall &&
            PromptToolBridge.containsInspectionToolCall(emittedSoFar);
          if (
            (isInspectionCall && unchangedWhileGeneratingTicks >= 5) ||
            (hasClosedToolCall && unchangedWhileGeneratingTicks >= 35) ||
            unchangedWhileGeneratingTicks >= 60
          ) {
            if (isInspectionCall) {
              emittedSoFar =
                PromptToolBridge.truncateAfterLastToolCall(emittedSoFar);
            }
            await this.stopGenerationIfRunning(page, runningOnAiStudio);
            break;
          }
        }
      }
    }

    if (!signal.aborted) {
      const finalState = await this.readModelTurnState(
        page,
        runningOnAiStudio,
        initialResponseCount,
        initialModelResponseCount,
      );
      if (finalState.thoughtText.length > accumulatedThoughts.length) {
        accumulatedThoughts = finalState.thoughtText;
      }
      if (
        finalState.text.length > 0 &&
        finalState.text !== emittedSoFar &&
        finalState.text.length >= emittedSoFar.length
      ) {
        emittedSoFar = finalState.text;
      }
    }

    if (!thinkingFinalized || accumulatedThoughts !== lastEmittedThoughts) {
      thinkingFinalized = true;
      lastEmittedThoughts = accumulatedThoughts;
      yield {
        type: 'thinking',
        text: accumulatedThoughts,
        startedAt: thinkingStartedAt,
        durationMs: finalThinkingDur || Math.max(100, Date.now() - thinkingStartMs),
        done: true,
      };
    }

    // If this was a Gemini Web canned error reply, notify caller so it can retry
    if (
      effectiveGuestMode &&
      !runningOnAiStudio &&
      GEMINI_WEB_ERROR_REPLY_REGEX.test(emittedSoFar)
    ) {
      onGuestCannedError?.(emittedSoFar);
      return;
    }

    const extracted = PromptToolBridge.extractToolCallsFromText(emittedSoFar);
    if (
      !signal.aborted &&
      emittedSoFar.trim().length === 0 &&
      extracted.toolCalls.length === 0
    ) {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        `${runningOnAiStudio ? 'Google AI Studio' : 'Gemini Web'} did not produce a response for this turn (prompt may still be in composer). Type "Continue" to resume from this exact step.`,
      );
    }

    if (extracted.cleanText !== yieldedText) {
      if (extracted.cleanText.length === 0) {
        yieldedText = '';
        yield {
          type: 'text-delta',
          text: '',
          replace: true,
        };
      } else if (yieldedText.length === 0) {
        yield { type: 'text-delta', text: extracted.cleanText };
      } else if (
        extracted.cleanText.length > yieldedText.length &&
        extracted.cleanText.startsWith(yieldedText)
      ) {
        yield {
          type: 'text-delta',
          text: extracted.cleanText.slice(yieldedText.length),
        };
      } else {
        yield {
          type: 'text-delta',
          text: extracted.cleanText,
          replace: true,
        };
      }
    }

    for (const call of extracted.toolCalls) {
      yield { type: 'tool-call', call };
    }

    yield {
      type: 'finish',
      reason: extracted.toolCalls.length > 0 ? 'tool_calls' : 'stop',
    };
  }

  /**
   * Records or updates the WebChatSession in the database for an active run.
   */
  private async recordWebChatSession(runId: string): Promise<string | null> {
    const entry = this.activeRunPages.get(runId);
    if (!entry || !entry.studioId || !entry.agentId || !entry.agentKey) {
      return null;
    }

    const currentUrl = entry.page.url();
    const platform: 'gemini' | 'aistudio' = entry.runningOnAiStudio
      ? 'aistudio'
      : 'gemini';

    let externalChatId = '';
    if (platform === 'gemini') {
      const match = /\/app\/([a-zA-Z0-9_-]{6,})/i.exec(currentUrl);
      externalChatId = match?.[1] ?? (entry.effectiveGuestMode ? `guest-${runId}` : '');
    } else {
      const match = /\/prompts\/([a-zA-Z0-9_-]{6,})/i.exec(currentUrl);
      const candidate = match?.[1] ?? '';
      externalChatId = candidate && candidate !== 'new_chat' ? candidate : `unsaved-${runId}`;
    }

    if (!externalChatId) {
      return entry.webChatSessionId;
    }

    const pageTitle = await entry.page.title().catch(() => '');
    const cleanedTitle =
      entry.spec.createNewChatMode === 'first-run' && entry.agentName
        ? entry.agentName
        : pageTitle
            .replace(/\s*[-–|·]\s*(Google\s+Gemini|Gemini|Google\s+AI\s+Studio).*$/i, '')
            .trim() ||
          entry.taskTitle ||
          `${entry.agentKey.toUpperCase()} chat`;

    const chatUrl =
      platform === 'gemini' && !externalChatId.startsWith('guest-')
        ? `https://gemini.google.com/app/${externalChatId}`
        : platform === 'aistudio' && !externalChatId.startsWith('unsaved-')
          ? `https://aistudio.google.com/prompts/${externalChatId}`
          : currentUrl;

    if (entry.webChatSessionId) {
      await this.prisma.webChatSession.update({
        where: { id: entry.webChatSessionId },
        data: {
          runId: entry.runId,
          ...(entry.taskId ? { taskId: entry.taskId } : {}),
          ...(entry.rootTaskId ? { rootTaskId: entry.rootTaskId } : {}),
          externalChatId,
          chatTitle: cleanedTitle,
          chatUrl,
          status: 'ACTIVE',
        },
      });
      return entry.webChatSessionId;
    }

    const created = await this.prisma.webChatSession.create({
      data: {
        studioId: entry.studioId,
        runId: entry.runId,
        taskId: entry.taskId ?? null,
        rootTaskId: entry.rootTaskId ?? entry.taskId ?? null,
        agentId: entry.agentId,
        agentKey: entry.agentKey,
        platform,
        guestMode: entry.effectiveGuestMode,
        externalChatId,
        chatTitle: cleanedTitle,
        chatUrl,
        status: 'ACTIVE',
      },
    });
    entry.webChatSessionId = created.id;
    return created.id;
  }

  /**
   * Attempts to resume an existing Gemini Web / AI Studio chat session according to `spec.createNewChatMode`:
   * - `'per-run'`: Resumes the chat synced with the current app chat (`runId` / `taskId`) if it was not deleted.
   * - `'first-run'`: Resumes the chat assigned to the current agent (`studioId` + `agentKey` + `platform`) if it exists and was not deleted.
   */
  private async tryResumeSyncedWebChat(
    page: Page,
    isAiStudio: boolean,
    effectiveGuestMode: boolean,
    spec: ParsedWebModelSpec,
    req: LlmStreamRequest,
  ): Promise<{ sessionId: string | null; sameTask: boolean } | null> {
    if (!req.studioId) return null;
    const platform: 'gemini' | 'aistudio' = isAiStudio ? 'aistudio' : 'gemini';

    let session: {
      id: string;
      runId: string | null;
      taskId: string | null;
      externalChatId: string;
      chatUrl: string;
      chatTitle: string;
    } | null = null;
    let savedEntry: ActiveRunPageEntry | undefined;

    if (spec.createNewChatMode === 'per-run') {
      if (!req.runId && !req.taskId) return null;
      savedEntry =
        (req.runId ? this.savedChatPages.get(`run:${req.runId}`) : undefined) ??
        (req.taskId ? this.savedChatPages.get(`task:${req.taskId}`) : undefined);
      session = await this.prisma.webChatSession
        ?.findFirst?.({
          where: {
            studioId: req.studioId,
            platform,
            status: 'ACTIVE',
            OR: [
              ...(req.runId ? [{ runId: req.runId }] : []),
              ...(req.taskId ? [{ taskId: req.taskId }] : []),
            ],
          },
          orderBy: { createdAt: 'desc' },
        })
        .catch(() => null);
    } else if (spec.createNewChatMode === 'first-run') {
      if (!req.agentKey) return null;
      savedEntry = this.savedChatPages.get(
        `agent:${req.studioId}:${req.agentKey}:${platform}`,
      );
      session = await this.prisma.webChatSession
        ?.findFirst?.({
          where: {
            studioId: req.studioId,
            agentKey: req.agentKey,
            platform,
            status: 'ACTIVE',
          },
          orderBy: { createdAt: 'desc' },
        })
        .catch(() => null);
    }

    if (!session && !savedEntry) {
      return null;
    }

    const markSessionDeleted = async (): Promise<void> => {
      if (session?.id) {
        await this.prisma.webChatSession
          ?.update?.({
            where: { id: session.id },
            data: { status: 'DELETED', deletedFromWebAt: new Date() },
          })
          .catch(() => {});
      }
      for (const [k, v] of this.savedChatPages.entries()) {
        if (
          v === savedEntry ||
          (session?.id && v.webChatSessionId === session.id)
        ) {
          this.savedChatPages.delete(k);
        }
      }
    };

    const extId = (session?.externalChatId ?? '').trim();
    const isPersistentId =
      extId.length >= 6 &&
      !extId.startsWith('guest-') &&
      !extId.startsWith('unsaved-') &&
      extId !== 'new_chat' &&
      extId !== 'app';

    if (isPersistentId && !effectiveGuestMode) {
      const targetUrl = isAiStudio
        ? `https://aistudio.google.com/prompts/${encodeURIComponent(extId)}`
        : `https://gemini.google.com/app/${encodeURIComponent(extId)}`;

      try {
        if (!page.url().includes(extId)) {
          await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 35_000,
          });
          await new Promise((r) => setTimeout(r, 900));
        }

        const hasComposer = await page
          .locator(COMPOSER_SELECTOR)
          .first()
          .waitFor({ state: 'visible', timeout: 10_000 })
          .then(() => true)
          .catch(() => false);

        if (!hasComposer || !page.url().includes(extId)) {
          await markSessionDeleted();
          return null;
        }

        const chatStillValid = await page
          .evaluate(
            ({ checkExtId, onAiStudio }) => {
              const doc = (
                globalThis as unknown as {
                  document?: {
                    body?: { innerText?: string };
                    querySelectorAll: (s: string) => ArrayLike<unknown>;
                  };
                  location?: { href?: string };
                }
              ).document;
              if (!doc) return false;
              const href =
                (globalThis as unknown as { location?: { href?: string } })
                  .location?.href ?? '';
              if (!href.includes(checkExtId)) return false;

              const turnSelector = onAiStudio
                ? 'ms-chat-turn, ms-cmark-node, .chat-turn-container, .turn-content'
                : 'model-response, user-query, message-content, [data-message-author-role]';
              const turnCount = doc.querySelectorAll(turnSelector).length;

              if (!onAiStudio) {
                const sidebarLinks = doc.querySelectorAll('a[href*="/app/"]');
                if (sidebarLinks.length > 0) {
                  const matchingSidebar = doc.querySelectorAll(
                    `a[href*="/app/${checkExtId}"]`,
                  );
                  if (matchingSidebar.length === 0 && turnCount === 0) {
                    return false;
                  }
                }
              }

              const dialogText = Array.from(
                doc.querySelectorAll(
                  'mat-dialog-container, [role="dialog"], [role="alert"], simple-snack-bar',
                ),
              )
                .map(
                  (el) =>
                    (el as { innerText?: string }).innerText?.trim() ?? '',
                )
                .join(' ');
              if (
                /conversation not found|prompt not found|was deleted|doesn't exist|unable to load/i.test(
                  dialogText,
                )
              ) {
                return false;
              }

              return turnCount > 0;
            },
            { checkExtId: extId, onAiStudio: isAiStudio },
          )
          .catch(() => false);

        if (!chatStillValid) {
          await markSessionDeleted();
          return null;
        }

        const sameTask = Boolean(
          (session?.taskId && session.taskId === req.taskId) ||
            (savedEntry?.taskId && savedEntry.taskId === req.taskId),
        );
        return {
          sessionId: session?.id ?? savedEntry?.webChatSessionId ?? null,
          sameTask,
        };
      } catch {
        await markSessionDeleted();
        return null;
      }
    }

    // Fallback for in-memory guest or unsaved AI Studio tab that is still open on the same page
    if (savedEntry && savedEntry.page === page && !page.isClosed()) {
      const urlOk = isAiStudio
        ? page.url().includes('aistudio.google.com')
        : page.url().includes('gemini.google.com');
      if (urlOk) {
        const hasComposer = await page
          .locator(COMPOSER_SELECTOR)
          .first()
          .isVisible()
          .catch(() => false);
        const turnState = await this.readModelTurnState(
          page,
          isAiStudio,
          0,
          0,
        ).catch(() => ({ count: 0 }));
        if (hasComposer && turnState.count > 0) {
          const sameTask = Boolean(
            (session?.taskId && session.taskId === req.taskId) ||
              (savedEntry.taskId && savedEntry.taskId === req.taskId),
          );
          return {
            sessionId: session?.id ?? savedEntry.webChatSessionId ?? null,
            sameTask,
          };
        }
      }
    }

    await markSessionDeleted();
    return null;
  }

  /**
   * Renames the currently active Gemini Web or Google AI Studio chat to `newTitle`
   * (used by "Create on first run" mode so each agent's persistent chat is named e.g. "Lead" or "Splash").
   */
  private async renameWebChatOnPage(
    page: Page,
    runningOnAiStudio: boolean,
    newTitle: string,
  ): Promise<boolean> {
    const cleanTitle = newTitle.trim();
    if (!cleanTitle) return false;

    try {
      if (!runningOnAiStudio) {
        const currentUrl = page.url();
        const match = /\/app\/([a-zA-Z0-9_-]{6,})/i.exec(currentUrl);
        const extId = match?.[1] ?? '';

        let menuOpened = false;

        // Strategy 1: Top conversation title button
        const topTitleBtn = page
          .locator(
            '[data-test-id="conversation-title-button"], conversation-actions-icon button',
          )
          .first();
        if ((await topTitleBtn.count().catch(() => 0)) > 0) {
          await topTitleBtn.click({ timeout: 2000 }).catch(() => {});
          menuOpened = true;
        }

        // Strategy 2: Sidebar conversation item matching extId or selected conversation
        if (!menuOpened && extId) {
          const exactSidebarLink = page
            .locator(`a[href*="/app/${extId}"]`)
            .first();
          if ((await exactSidebarLink.count().catch(() => 0)) > 0) {
            await exactSidebarLink.hover({ timeout: 1500 }).catch(() => {});
            const actionsBtn = exactSidebarLink
              .locator('..')
              .locator(
                'button[data-test-id="actions-menu-button"], button[aria-label*="More" i], button.conversation-actions-menu-button',
              )
              .first();
            if ((await actionsBtn.count().catch(() => 0)) > 0) {
              await actionsBtn.click({ timeout: 2000 }).catch(() => {});
              menuOpened = true;
            }
          }
        }

        if (!menuOpened) {
          const selectedMenuBtn = page
            .locator(
              '.conversation.selected button[data-test-id="actions-menu-button"], [data-test-id="conversation"].selected button[aria-label*="More" i]',
            )
            .first();
          if ((await selectedMenuBtn.count().catch(() => 0)) > 0) {
            await selectedMenuBtn.hover({ timeout: 1500 }).catch(() => {});
            await selectedMenuBtn.click({ timeout: 2000 }).catch(() => {});
            menuOpened = true;
          }
        }

        if (!menuOpened) return false;
        await new Promise((r) => setTimeout(r, 250));

        const renameMenuItem = page
          .locator(
            '[data-test-id="rename-button"], [role="menuitem"]:has-text("Rename"), button:has-text("Rename")',
          )
          .first();
        if ((await renameMenuItem.count().catch(() => 0)) === 0) {
          await page.keyboard.press('Escape').catch(() => {});
          return false;
        }

        await renameMenuItem.click({ timeout: 2000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 300));

        const renameInput = page
          .locator(
            'mat-dialog-container input, [role="dialog"] input, input[data-test-id="rename-input"], input[aria-label*="Rename" i], input[aria-label*="title" i], .conversation.selected input, input[type="text"]',
          )
          .first();
        if ((await renameInput.count().catch(() => 0)) > 0) {
          await renameInput.fill(cleanTitle, { timeout: 2000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 150));

          const confirmBtn = page
            .locator(
              'button[data-test-id="confirm-button"], mat-dialog-container button:has-text("Rename"), mat-dialog-container button:has-text("Save"), [role="dialog"] button:has-text("Rename"), [role="dialog"] button:has-text("Save")',
            )
            .first();
          if ((await confirmBtn.count().catch(() => 0)) > 0) {
            await confirmBtn.click({ timeout: 2000 }).catch(() => {});
          } else {
            await renameInput.press('Enter').catch(() => {});
          }
          await new Promise((r) => setTimeout(r, 400));
          return true;
        }

        await page.keyboard.press('Escape').catch(() => {});
        return false;
      }

      // Google AI Studio rename
      const editTitleTrigger = page
        .locator(
          'ms-toolbar button[aria-label*="Rename" i], ms-toolbar button[aria-label*="Edit" i], ms-toolbar button[iconname="edit"], ms-toolbar .prompt-title, ms-toolbar .title',
        )
        .first();

      if ((await editTitleTrigger.count().catch(() => 0)) > 0) {
        await editTitleTrigger.click({ timeout: 2000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));
      } else {
        const moreBtn = page
          .locator(
            'ms-toolbar button[aria-label*="More" i], button[aria-label*="More actions" i], button[iconname="more_vert"]',
          )
          .first();
        if ((await moreBtn.count().catch(() => 0)) > 0) {
          await moreBtn.click({ timeout: 2000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 250));
          const renameItem = page
            .locator(
              '[role="menuitem"]:has-text("Rename"), button:has-text("Rename")',
            )
            .first();
          if ((await renameItem.count().catch(() => 0)) > 0) {
            await renameItem.click({ timeout: 2000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 250));
          } else {
            await page.keyboard.press('Escape').catch(() => {});
          }
        }
      }

      const aiStudioInput = page
        .locator(
          'ms-toolbar input, mat-dialog-container input, [role="dialog"] input, input[aria-label*="title" i], input[aria-label*="name" i]',
        )
        .first();
      if ((await aiStudioInput.count().catch(() => 0)) > 0) {
        await aiStudioInput.fill(cleanTitle, { timeout: 2000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
        const saveBtn = page
          .locator(
            'mat-dialog-container button:has-text("Save"), mat-dialog-container button:has-text("Rename"), [role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("Rename")',
          )
          .first();
        if ((await saveBtn.count().catch(() => 0)) > 0) {
          await saveBtn.click({ timeout: 2000 }).catch(() => {});
        } else {
          await aiStudioInput.press('Enter').catch(() => {});
        }
        await new Promise((r) => setTimeout(r, 400));
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Called by RunExecutorService when an AgentRun finishes.
   * Captures final chat URL/ID, optionally auto-deletes the chat if `studio.autoDeleteCreatedChats` is enabled,
   * and closes or preserves the run's browser tab for continuation.
   */
  async finalizeRunSession(runId: string, studioId: string): Promise<void> {
    const entry = this.activeRunPages.get(runId);
    if (!entry) return;

    const releaseLock = await this.acquireBrowserLock();
    try {
      const alive = await this.isPageAndContextAlive(entry.ctx, entry.page);
      const sessionId = alive
        ? await this.recordWebChatSession(runId).catch(() => entry.webChatSessionId)
        : entry.webChatSessionId;

      const studio = await this.prisma.studio.findUnique({
        where: { id: studioId },
        select: { autoDeleteCreatedChats: true },
      });

      if (studio?.autoDeleteCreatedChats && sessionId) {
        const session = await this.prisma.webChatSession.findUnique({
          where: { id: sessionId },
        });
        if (session && session.status === 'ACTIVE') {
          if (alive) {
            await this.deleteWebChatSessionOnPage(entry.page, session).catch(
              (err: unknown) => {
                this.logger.warn(
                  `Auto-delete web chat failed for ${session.id}: ${String(err)}`,
                );
              },
            );
          } else {
            // Browser was closed before auto-delete; relaunch page to delete the chat
            const showWindow = await this.shouldShowBrowserWindow(studioId);
            const profileDir = this.profileDirFor(session.guestMode);
            await fs.mkdir(profileDir, { recursive: true });
            const acquired = await this.acquirePageInContext(
              session.guestMode,
              profileDir,
              showWindow,
            );
            try {
              await this.applyWindowVisibility(
                acquired.ctx,
                acquired.page,
                showWindow,
              );
              await this.deleteWebChatSessionOnPage(acquired.page, session);
            } catch (err) {
              this.logger.warn(
                `Auto-delete web chat (relaunched) failed for ${session.id}: ${String(err)}`,
              );
            } finally {
              await this.releasePageSafely(acquired.ctx, acquired.page);
            }
          }
        }
      } else if (alive && entry.spec.createNewChatMode !== 'always') {
        const platform = entry.runningOnAiStudio ? 'aistudio' : 'gemini';
        this.savedChatPages.set(`run:${runId}`, entry);
        if (entry.taskId) {
          this.savedChatPages.set(`task:${entry.taskId}`, entry);
        }
        if (entry.studioId && entry.agentKey) {
          this.savedChatPages.set(
            `agent:${entry.studioId}:${entry.agentKey}:${platform}`,
            entry,
          );
        }
      }
    } finally {
      this.activeRunPages.delete(runId);
      await this.releasePageSafely(entry.ctx, entry.page);
      releaseLock();
    }
  }

  /**
   * Lists tracked web chats created by agents in this studio.
   */
  async listWebChatSessions(
    studioId: string,
    agentKey?: AgentKey,
  ): Promise<WebChatSessionDto[]> {
    const rows = await this.prisma.webChatSession.findMany({
      where: {
        studioId,
        ...(agentKey ? { agentKey } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.toWebChatDto(r));
  }

  /**
   * Detaches any cached or active WebChatSession for an agent (or specific task) so the next
   * run starts a fresh web chat without deleting the remote conversation.
   */
  async detachAgentWebChatCache(
    studioId: string,
    agentKey: AgentKey,
    taskId?: string | null,
  ): Promise<void> {
    for (const [k, v] of this.savedChatPages.entries()) {
      const matchAgent = v.studioId === studioId && v.agentKey === agentKey;
      const matchTask = taskId ? v.taskId === taskId : true;
      if (matchAgent && (matchTask || k.startsWith(`agent:${studioId}:${agentKey}:`))) {
        this.savedChatPages.delete(k);
      }
    }
    await this.prisma.webChatSession
      ?.updateMany?.({
        where: {
          studioId,
          agentKey,
          status: 'ACTIVE',
        },
        data: {
          status: 'DELETED',
          deletedFromWebAt: new Date(),
        },
      })
      .catch(() => {});
  }

  /**
   * Deletes all active web chats created by a specific agent (e.g., Lead) from Gemini Web / AI Studio.
   * Strictly only deletes chats recorded in `WebChatSession` for that agent.
   */
  async deleteAgentWebChats(
    studioId: string,
    agentKey: AgentKey,
  ): Promise<DeleteWebChatsResultDto> {
    const sessions = await this.prisma.webChatSession.findMany({
      where: {
        studioId,
        agentKey,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.deleteSessionsBatch(studioId, sessions);
  }

  /**
   * Deletes all active web chats created across all agents in the last run / task workflow.
   */
  async deleteLastRunWebChats(studioId: string): Promise<DeleteWebChatsResultDto> {
    const latestSession = await this.prisma.webChatSession.findFirst({
      where: { studioId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestSession) {
      return {
        deletedFromWebCount: 0,
        totalProcessed: 0,
        message: 'No active agent-created web chats to delete.',
      };
    }

    const sessions = latestSession.rootTaskId
      ? await this.prisma.webChatSession.findMany({
          where: {
            studioId,
            rootTaskId: latestSession.rootTaskId,
            status: 'ACTIVE',
          },
          orderBy: { createdAt: 'desc' },
        })
      : [latestSession];

    return this.deleteSessionsBatch(studioId, sessions);
  }

  /**
   * Deletes a single tracked web chat session by its database ID.
   */
  async deleteSingleWebChat(
    studioId: string,
    chatId: string,
  ): Promise<DeleteWebChatsResultDto> {
    const session = await this.prisma.webChatSession.findFirst({
      where: { id: chatId, studioId },
    });
    if (!session) {
      return {
        deletedFromWebCount: 0,
        totalProcessed: 0,
        message: 'Web chat record not found.',
      };
    }
    return this.deleteSessionsBatch(studioId, [session]);
  }

  private async deleteSessionsBatch(
    studioId: string,
    sessions: Array<{
      id: string;
      platform: string;
      guestMode: boolean;
      externalChatId: string;
      chatUrl: string;
      chatTitle: string;
      agentKey: AgentKey;
    }>,
  ): Promise<DeleteWebChatsResultDto> {
    if (sessions.length === 0) {
      return {
        deletedFromWebCount: 0,
        totalProcessed: 0,
        message: 'No active agent-created web chats found.',
      };
    }

    const releaseLock = await this.acquireBrowserLock();
    const showWindow = await this.shouldShowBrowserWindow(studioId);
    let deletedCount = 0;

    try {
      for (const session of sessions) {
        if (session.platform !== 'gemini' && session.platform !== 'aistudio') {
          await this.prisma.webChatSession
            .update({
              where: { id: session.id },
              data: { status: 'DELETED', deletedFromWebAt: new Date() },
            })
            .catch(() => {});
          deletedCount += 1;
          continue;
        }
        const profileDir = this.profileDirFor(session.guestMode);
        await fs.mkdir(profileDir, { recursive: true });
        const { ctx, page } = await this.acquirePageInContext(
          session.guestMode,
          profileDir,
          showWindow,
        );
        try {
          await this.applyWindowVisibility(ctx, page, showWindow);
          const ok = await this.deleteWebChatSessionOnPage(page, session);
          if (ok) {
            deletedCount += 1;
          }
        } finally {
          await this.releasePageSafely(ctx, page);
        }
      }
    } finally {
      releaseLock();
    }

    return {
      deletedFromWebCount: deletedCount,
      totalProcessed: sessions.length,
      message: `Deleted ${deletedCount} of ${sessions.length} agent-created chat(s) from Gemini Web / AI Studio.`,
    };
  }

  /**
   * Strictly deletes ONLY the specified agent-created chat identified by `session.externalChatId`.
   * Never touches any chat whose URL/ID does not match `session.externalChatId`.
   */
  private async deleteWebChatSessionOnPage(
    page: Page,
    session: {
      id: string;
      platform: string;
      guestMode: boolean;
      externalChatId: string;
      chatUrl: string;
    },
  ): Promise<boolean> {
    for (const [k, v] of this.savedChatPages.entries()) {
      if (v.webChatSessionId === session.id) {
        this.savedChatPages.delete(k);
      }
    }
    const extId = session.externalChatId.trim();

    // Ephemeral guest or unsaved AI Studio chats have no persistent cloud entry
    if (
      extId.startsWith('guest-') ||
      extId.startsWith('unsaved-') ||
      extId === 'new_chat' ||
      extId === 'app' ||
      extId.length < 6
    ) {
      if (session.guestMode) {
        await page.context().clearCookies().catch(() => {});
      }
      await this.prisma.webChatSession.update({
        where: { id: session.id },
        data: { status: 'DELETED', deletedFromWebAt: new Date() },
      });
      return true;
    }

    if (session.platform === 'gemini') {
      const targetUrl = `https://gemini.google.com/app/${encodeURIComponent(extId)}`;
      if (!page.url().includes(`/app/${extId}`)) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 1200));
      }

      // SAFETY CHECK: Ensure the page URL still contains the exact `extId` created by the agent!
      if (!page.url().includes(extId)) {
        // Redirected back to /app because conversation no longer exists
        await this.prisma.webChatSession.update({
          where: { id: session.id },
          data: { status: 'DELETED', deletedFromWebAt: new Date() },
        });
        return true;
      }

      let menuOpened = false;

      // Strategy 1: Sidebar conversation item whose href explicitly contains `extId`
      const exactSidebarLink = page.locator(`a[href*="/app/${extId}"]`).first();
      if ((await exactSidebarLink.count().catch(() => 0)) > 0) {
        await exactSidebarLink.hover({ timeout: 2000 }).catch(() => {});
        const parentItem = exactSidebarLink.locator('..');
        const actionsBtn = parentItem
          .locator(
            'button[data-test-id="actions-menu-button"], button[aria-label*="More" i], button.conversation-actions-menu-button',
          )
          .first();
        if ((await actionsBtn.count().catch(() => 0)) > 0) {
          await actionsBtn.click({ timeout: 2000 }).catch(() => {});
          menuOpened = true;
        }
      }

      // Strategy 2: Currently selected conversation item in sidebar or top conversation title menu (only while page.url() === targetUrl)
      if (!menuOpened && page.url().includes(`/app/${extId}`)) {
        const selectedMenuBtn = page
          .locator(
            '[data-test-id="conversation-title-button"], .conversation.selected button[data-test-id="actions-menu-button"], [data-test-id="conversation"].selected button[aria-label*="More" i]',
          )
          .first();
        if ((await selectedMenuBtn.count().catch(() => 0)) > 0) {
          await selectedMenuBtn.hover({ timeout: 1500 }).catch(() => {});
          await selectedMenuBtn.click({ timeout: 2000 }).catch(() => {});
          menuOpened = true;
        }
      }

      if (menuOpened) {
        await new Promise((r) => setTimeout(r, 250));
        const deleteMenuItem = page
          .locator(
            '[data-test-id="delete-button"], [role="menuitem"]:has-text("Delete"), button:has-text("Delete")',
          )
          .first();
        if ((await deleteMenuItem.count().catch(() => 0)) > 0) {
          await deleteMenuItem.click({ timeout: 2000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 300));

          const confirmBtn = page
            .locator(
              'button[data-test-id="confirm-button"], mat-dialog-container button:has-text("Delete"), [role="dialog"] button:has-text("Delete")',
            )
            .first();
          if ((await confirmBtn.count().catch(() => 0)) > 0) {
            await confirmBtn.click({ timeout: 2000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      }

      await this.prisma.webChatSession.update({
        where: { id: session.id },
        data: { status: 'DELETED', deletedFromWebAt: new Date() },
      });
      return true;
    }

    if (session.platform === 'aistudio') {
      const targetUrl = `https://aistudio.google.com/prompts/${encodeURIComponent(extId)}`;
      if (!page.url().includes(`/prompts/${extId}`)) {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 1200));
      }

      // SAFETY CHECK: Verify URL strictly contains `extId`
      if (!page.url().includes(`/prompts/${extId}`)) {
        await this.prisma.webChatSession.update({
          where: { id: session.id },
          data: { status: 'DELETED', deletedFromWebAt: new Date() },
        });
        return true;
      }

      const moreBtn = page
        .locator(
          'ms-toolbar button[aria-label*="More" i], button[aria-label*="More actions" i], button[iconname="more_vert"]',
        )
        .first();
      if ((await moreBtn.count().catch(() => 0)) > 0) {
        await moreBtn.click({ timeout: 2000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 250));

        const deleteItem = page
          .locator('[role="menuitem"]:has-text("Delete"), button:has-text("Delete prompt")')
          .first();
        if ((await deleteItem.count().catch(() => 0)) > 0) {
          await deleteItem.click({ timeout: 2000 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 300));

          const confirmBtn = page
            .locator(
              'mat-dialog-container button:has-text("Delete"), [role="dialog"] button:has-text("Delete")',
            )
            .first();
          if ((await confirmBtn.count().catch(() => 0)) > 0) {
            await confirmBtn.click({ timeout: 2000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 600));
          }
        }
      }

      await this.prisma.webChatSession.update({
        where: { id: session.id },
        data: { status: 'DELETED', deletedFromWebAt: new Date() },
      });
      return true;
    }

    return false;
  }

  private toWebChatDto(row: {
    id: string;
    studioId: string;
    runId: string | null;
    taskId: string | null;
    rootTaskId: string | null;
    agentId: string;
    agentKey: AgentKey;
    platform: string;
    guestMode: boolean;
    externalChatId: string;
    chatTitle: string;
    chatUrl: string;
    status: string;
    createdAt: Date;
    deletedFromWebAt: Date | null;
  }): WebChatSessionDto {
    return {
      id: row.id,
      studioId: row.studioId,
      runId: row.runId,
      taskId: row.taskId,
      rootTaskId: row.rootTaskId,
      agentId: row.agentId,
      agentKey: row.agentKey,
      platform: ([
        'gemini',
        'aistudio',
        'claude-web',
        'chatgpt-web',
        'gemini-app',
        'claude-app',
        'gpt-app',
        'antigravity',
      ].includes(row.platform)
        ? row.platform
        : 'gemini') as WebChatPlatform,
      guestMode: row.guestMode,
      externalChatId: row.externalChatId,
      chatTitle: row.chatTitle,
      chatUrl: row.chatUrl,
      status:
        row.status === 'DELETED'
          ? 'DELETED'
          : row.status === 'FAILED'
            ? 'FAILED'
            : 'ACTIVE',
      createdAt: row.createdAt.toISOString(),
      deletedFromWebAt: row.deletedFromWebAt
        ? row.deletedFromWebAt.toISOString()
        : null,
    };
  }

  /**
   * Selects model ("3.5 Flash-Lite", "3.8 Flash", "3.1 Pro", "4 Argon")
   * and Thinking level ("Low", "Medium", "High") on gemini.google.com/app (signed-in only)
   */
  private async applyGeminiWebControls(
    page: Page,
    spec: ParsedWebModelSpec,
  ): Promise<void> {
    if (spec.guestMode) return;

    try {
      const pillSelector =
        '[data-test-id="bard-mode-menu-button"], bard-mode-switcher button.input-area-switch, bard-mode-switcher button, div.model-picker-container button, button.input-area-switch';
      const pillBtn = page.locator(pillSelector).first();

      // Wait for the mode picker button to finish hydrating (it mounts slightly after the composer)
      const pillVisible = await pillBtn
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!pillVisible) {
        return;
      }

      const ensureMenuOpen = async (): Promise<boolean> => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const expanded = await pillBtn.getAttribute('aria-expanded').catch(() => null);
          if (expanded === 'true') {
            return true;
          }
          await pillBtn.click({ timeout: 2500 }).catch(async () => {
            await pillBtn.click({ timeout: 2500, force: true }).catch(() => {});
          });
          await new Promise((r) => setTimeout(r, 380));
          const nowExpanded = await pillBtn.getAttribute('aria-expanded').catch(() => null);
          if (nowExpanded === 'true') {
            return true;
          }
        }
        return false;
      };

      const ensureMenuClosed = async (): Promise<void> => {
        const expanded = await pillBtn.getAttribute('aria-expanded').catch(() => null);
        if (expanded === 'true') {
          await page.keyboard.press('Escape').catch(() => {});
          await new Promise((r) => setTimeout(r, 200));
          if ((await pillBtn.getAttribute('aria-expanded').catch(() => null)) === 'true') {
            await pillBtn.click({ timeout: 1500, force: true }).catch(() => {});
            await new Promise((r) => setTimeout(r, 200));
          }
        }
      };

      // Build menu item matcher and pill label matcher for the requested model
      let menuModelRegex = /3\.8\s*Flash/i;
      let pillModelRegex = /^Flash(\s+(Low|Medium|High))?$/i;
      if (spec.apiModelSlug.includes('3.5-flash-lite')) {
        menuModelRegex = /3\.5\s*Flash[- ]?Lite/i;
        pillModelRegex = /Flash[- ]?Lite/i;
      } else if (spec.apiModelSlug.includes('3.1-pro')) {
        menuModelRegex = /3\.1\s*Pro/i;
        pillModelRegex = /\bPro\b/i;
      } else if (
        spec.apiModelSlug.includes('4.0-argon') ||
        spec.apiModelSlug.includes('4-argon') ||
        spec.apiModelSlug.includes('argon')
      ) {
        menuModelRegex = /4(\.0)?\s*Argon/i;
        pillModelRegex = /\bArgon\b/i;
      } else {
        menuModelRegex = /3\.8\s*Flash/i;
        pillModelRegex = /^Flash(\s+(Low|Medium|High))?$/i;
      }

      // 1. Select the target model
      const currentPillText = (await pillBtn.innerText().catch(() => ''))
        .replace(/\s+/g, ' ')
        .trim();
      const alreadyOnTargetModel = pillModelRegex.test(currentPillText);

      if (!alreadyOnTargetModel) {
        await ensureMenuOpen();

        const modelOption = page
          .locator(
            'gem-menu-item[data-mode-id], gem-menu-item[data-test-id^="bard-mode-option"], gem-menu-item, .cdk-overlay-pane [role^="menuitem"]',
          )
          .filter({ hasText: menuModelRegex })
          .first();

        if ((await modelOption.count().catch(() => 0)) > 0) {
          await modelOption.click({ timeout: 2500 }).catch(async () => {
            await modelOption.click({ timeout: 2500, force: true }).catch(() => {});
          });
          await new Promise((r) => setTimeout(r, 450));
        }
      }

      // 2. Select the target Thinking level ("Low" | "Medium" | "High")
      const thinkingCap =
        spec.thinkingLevel === 'low'
          ? 'Low'
          : spec.thinkingLevel === 'high'
            ? 'High'
            : 'Medium';

      await ensureMenuOpen();

      const thinkingMenuTrigger = page
        .locator('gem-menu-item, .cdk-overlay-pane [role^="menuitem"]')
        .filter({ hasText: /Thinking level/i })
        .first();

      if ((await thinkingMenuTrigger.count().catch(() => 0)) > 0) {
        const levelOption = page
          .locator('gem-menu-item, .cdk-overlay-pane [role^="menuitem"], [role="option"]')
          .filter({ hasText: new RegExp(`^\\s*${thinkingCap}\\b`, 'i') })
          .first();

        await thinkingMenuTrigger.hover({ timeout: 1500 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 280));

        if (!(await levelOption.isVisible().catch(() => false))) {
          await thinkingMenuTrigger.click({ timeout: 1500 }).catch(async () => {
            await thinkingMenuTrigger.click({ timeout: 1500, force: true }).catch(() => {});
          });
          await new Promise((r) => setTimeout(r, 280));
        }

        if ((await levelOption.count().catch(() => 0)) > 0) {
          await levelOption.click({ timeout: 2000 }).catch(async () => {
            await levelOption.click({ timeout: 2000, force: true }).catch(() => {});
          });
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      await ensureMenuClosed();
    } catch {
      // Non-fatal if menu is already closed or unavailable
    }
  }

  /**
   * Configures Run settings on aistudio.google.com
   */
  private async applyAiStudioControls(
    page: Page,
    spec: ParsedWebModelSpec,
  ): Promise<void> {
    try {
      const settingsPanelLocator = page
        .locator(
          'ms-run-settings, ms-prompt-run-settings, .settings-model-selector, .settings-group-header',
        )
        .first();

      // Wait briefly for the Run settings panel to mount; if collapsed/closed, reopen it
      let settingsVisible = await settingsPanelLocator
        .waitFor({ state: 'visible', timeout: 2_500 })
        .then(() => true)
        .catch(() => false);

      if (!settingsVisible) {
        const openPanelBtn = page
          .locator(
            'button[aria-label*="Open run settings" i], button[aria-label*="run settings" i]:not([aria-label*="Close" i]), button[mattooltip*="Run settings" i], button[iconname="tune"]',
          )
          .first();
        if ((await openPanelBtn.count().catch(() => 0)) > 0) {
          await openPanelBtn.click({ timeout: 1500 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 400));
          settingsVisible = await settingsPanelLocator
            .waitFor({ state: 'visible', timeout: 2_500 })
            .then(() => true)
            .catch(() => false);
        }
      }

      const thinkingCap =
        spec.thinkingLevel === 'low'
          ? 'Low'
          : spec.thinkingLevel === 'high'
            ? 'High'
            : 'Medium';

      await this.ensureAiStudioGroupExpanded(page, 'Thinking');
      await this.selectAiStudioDropdownByLabel(page, 'Thinking level', thinkingCap);

      await this.ensureAiStudioGroupExpanded(page, 'Tools');
      for (const [toolKey, labelText] of Object.entries(AI_STUDIO_TOOL_LABELS) as Array<
        [AiStudioToolKey, string]
      >) {
        const shouldBeEnabled = spec.aiStudioTools.has(toolKey);
        await this.setAiStudioToggleByLabel(page, labelText, shouldBeEnabled);
      }

      await this.ensureAiStudioGroupExpanded(page, 'Advanced settings');
      const mediaCap =
        spec.mediaResolution === 'low'
          ? 'Low'
          : spec.mediaResolution === 'medium'
            ? 'Medium'
            : spec.mediaResolution === 'high'
              ? 'High'
              : 'Default';
      await this.selectAiStudioDropdownByLabel(page, 'Media resolution', mediaCap);
    } catch {
      // Non-fatal if Run settings panel is collapsed
    }
  }

  private async ensureAiStudioGroupExpanded(
    page: Page,
    headerLabel: string,
  ): Promise<void> {
    try {
      const header = page
        .locator('.settings-group-header')
        .filter({ hasText: new RegExp(headerLabel, 'i') })
        .first();
      if ((await header.count().catch(() => 0)) === 0) return;

      const cls = (await header.getAttribute('class').catch(() => '')) ?? '';
      const ariaExpanded = await header.getAttribute('aria-expanded').catch(() => null);
      const isExpanded =
        cls.split(/\s+/).includes('expanded') || ariaExpanded === 'true';
      if (!isExpanded) {
        await header.click({ timeout: 1500 }).catch(async () => {
          await header.click({ timeout: 1500, force: true }).catch(() => {});
        });
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch {
      // ignore
    }
  }

  private async selectAiStudioDropdownByLabel(
    page: Page,
    sectionLabel: string,
    optionLabel: string,
  ): Promise<void> {
    try {
      const isThinkingControl = /thinking/i.test(sectionLabel);
      const tagAttr = isThinkingControl
        ? 'thinking-level-select'
        : 'media-res-select';

      // Tag the target mat-select / combobox in DOM using aria-label, aria-labelledby,
      // surrounding container label text, or known thinking-level option values.
      await page
        .evaluate(
          ({ label, isThinking, attrValue }) => {
            interface DomEl {
              tagName?: string;
              textContent?: string | null;
              innerText?: string;
              offsetParent?: unknown;
              offsetWidth?: number;
              offsetHeight?: number;
              getAttribute?: (n: string) => string | null;
              setAttribute?: (n: string, v: string) => void;
              removeAttribute?: (n: string) => void;
              closest?: (s: string) => DomEl | null;
              parentElement?: DomEl | null;
            }
            const doc = (
              globalThis as unknown as {
                document?: {
                  getElementById: (id: string) => DomEl | null;
                  querySelectorAll: (s: string) => ArrayLike<DomEl>;
                };
              }
            ).document;
            if (!doc) return;

            for (const prev of Array.from(
              doc.querySelectorAll(`[data-robdev-target="${attrValue}"]`),
            )) {
              prev.removeAttribute?.('data-robdev-target');
            }

            const isVis = (el: DomEl): boolean =>
              el.offsetParent !== null &&
              (el.offsetWidth ?? 0) > 0 &&
              (el.offsetHeight ?? 0) > 0;

            const labelRe = isThinking
              ? /thinking\s*(level|mode|budget)?/i
              : new RegExp(label, 'i');

            const selects = Array.from(
              doc.querySelectorAll('mat-select, [role="combobox"], select'),
            ).filter(isVis);

            for (const sel of selects) {
              const ariaLabel = sel.getAttribute?.('aria-label') ?? '';
              if (labelRe.test(ariaLabel)) {
                sel.setAttribute?.('data-robdev-target', attrValue);
                return;
              }
              const labelledBy = sel.getAttribute?.('aria-labelledby') ?? '';
              if (labelledBy) {
                const refText = labelledBy
                  .split(/\s+/)
                  .map((id) => doc.getElementById(id)?.textContent ?? '')
                  .join(' ');
                if (labelRe.test(refText)) {
                  sel.setAttribute?.('data-robdev-target', attrValue);
                  return;
                }
              }
            }

            for (const sel of selects) {
              let container: DomEl | null | undefined = sel.parentElement;
              for (let depth = 0; depth < 5 && container; depth++) {
                const txt = (
                  container.innerText ??
                  container.textContent ??
                  ''
                ).replace(/\s+/g, ' ');
                if (labelRe.test(txt) && txt.length < 260) {
                  sel.setAttribute?.('data-robdev-target', attrValue);
                  return;
                }
                container = container.parentElement;
              }
            }

            if (isThinking) {
              for (const sel of selects) {
                const valTxt = (sel.innerText ?? sel.textContent ?? '')
                  .replace(/\s+/g, ' ')
                  .trim();
                if (/^(Minimal|Low|Medium|High|Dynamic)$/i.test(valTxt)) {
                  sel.setAttribute?.('data-robdev-target', attrValue);
                  return;
                }
              }
            }
          },
          {
            label: sectionLabel,
            isThinking: isThinkingControl,
            attrValue: tagAttr,
          },
        )
        .catch(() => {});

      const selectTrigger = page
        .locator(
          `[data-robdev-target="${tagAttr}"], mat-select[aria-label*="${sectionLabel}" i], select[aria-label*="${sectionLabel}" i]${isThinkingControl ? ', ms-thinking-budget mat-select, ms-thinking-level mat-select, mat-select[aria-label*="Thinking" i]' : ''}`,
        )
        .first();

      if ((await selectTrigger.count().catch(() => 0)) > 0) {
        await selectTrigger.scrollIntoViewIfNeeded().catch(() => {});
        const currentText = (await selectTrigger.innerText().catch(() => ''))
          .replace(/\s+/g, ' ')
          .trim();
        if (new RegExp(`^${optionLabel}$`, 'i').test(currentText)) {
          return;
        }

        await selectTrigger.click({ timeout: 2000 }).catch(async () => {
          await selectTrigger.click({ timeout: 2000, force: true }).catch(() => {});
        });
        await new Promise((r) => setTimeout(r, 280));

        const allOptions = page.locator(
          '.cdk-overlay-pane mat-option, .cdk-overlay-pane [role="option"], mat-option, [role="option"]',
        );
        const exactOpt = allOptions
          .filter({ hasText: new RegExp(`^\\s*${optionLabel}\\s*$`, 'i') })
          .first();
        const prefixOpt = allOptions
          .filter({
            hasText: new RegExp(
              `^(?:\\s*(?:check|done)\\s*)?${optionLabel}\\b`,
              'i',
            ),
          })
          .first();
        const wordOpt = allOptions
          .filter({ hasText: new RegExp(`\\b${optionLabel}\\b`, 'i') })
          .first();

        const targetOpt =
          (await exactOpt.count().catch(() => 0)) > 0
            ? exactOpt
            : (await prefixOpt.count().catch(() => 0)) > 0
              ? prefixOpt
              : wordOpt;

        if ((await targetOpt.count().catch(() => 0)) > 0) {
          await targetOpt.click({ timeout: 2000 }).catch(async () => {
            await targetOpt.click({ timeout: 2000, force: true }).catch(() => {});
          });
          await new Promise((r) => setTimeout(r, 220));
        } else {
          await page.keyboard.press('Escape').catch(() => {});
        }
        return;
      }

      // Fallback if Thinking level is rendered as segmented toggle buttons instead of mat-select
      if (isThinkingControl) {
        const toggleBtn = page
          .locator(
            'mat-button-toggle, button[role="radio"], button[role="tab"], ms-thinking-budget button, ms-thinking-level button',
          )
          .filter({ hasText: new RegExp(`^\\s*${optionLabel}\\s*$`, 'i') })
          .first();
        if ((await toggleBtn.count().catch(() => 0)) > 0) {
          await toggleBtn.click({ timeout: 1500 }).catch(() => {});
          await new Promise((r) => setTimeout(r, 200));
        }
      }
    } catch {
      // ignore
    }
  }

  private async setAiStudioToggleByLabel(
    page: Page,
    labelText: string,
    enabled: boolean,
  ): Promise<void> {
    try {
      await page
        .evaluate(
          ({ targetLabel, shouldEnable }) => {
            interface SwitchDomEl {
              textContent?: string | null;
              className?: string;
              offsetParent?: unknown;
              offsetWidth?: number;
              offsetHeight?: number;
              parentElement?: SwitchDomEl | null;
              getAttribute?: (n: string) => string | null;
              click?: () => void;
              querySelector?: (s: string) => SwitchDomEl | null;
              querySelectorAll?: (s: string) => ArrayLike<SwitchDomEl>;
            }
            const doc = (
              globalThis as unknown as {
                document?: { querySelectorAll: (s: string) => ArrayLike<SwitchDomEl> };
              }
            ).document;
            if (!doc) return;

            const isVis = (el: SwitchDomEl): boolean =>
              el.offsetParent !== null &&
              (el.offsetWidth ?? 0) > 0 &&
              (el.offsetHeight ?? 0) > 0;

            const labelRe = new RegExp(targetLabel, 'i');

            // 1. Find any switch in the right-hand Run Settings panel whose row label matches targetLabel
            const switches = Array.from(
              doc.querySelectorAll(
                'button[role="switch"], mat-slide-toggle button, mat-slide-toggle input[type="checkbox"]',
              ),
            ).filter(isVis);

            for (const sw of switches) {
              const ariaLabel = sw.getAttribute?.('aria-label') ?? '';
              let matched = labelRe.test(ariaLabel);
              if (!matched) {
                let ancestor: SwitchDomEl | null | undefined = sw.parentElement;
                for (let depth = 0; depth < 5 && ancestor; depth++) {
                  const txt = (ancestor.textContent ?? '').replace(/\s+/g, ' ').trim();
                  if (txt.length > 0 && txt.length < 180 && labelRe.test(txt)) {
                    matched = true;
                    break;
                  }
                  ancestor = ancestor.parentElement;
                }
              }
              if (matched) {
                const ariaChecked = sw.getAttribute?.('aria-checked');
                const cls =
                  typeof sw.className === 'string'
                    ? sw.className
                    : typeof sw.parentElement?.className === 'string'
                      ? sw.parentElement.className
                      : '';
                const isCurrentlyOn =
                  ariaChecked === 'true' ||
                  /\b(mat-mdc-slide-toggle-checked|mdc-switch--selected|mdc-switch--checked)\b/i.test(
                    cls,
                  );
                if (isCurrentlyOn !== shouldEnable) {
                  sw.click?.();
                }
                break;
              }
            }

            // 2. If disabling Grounding with Google Search, also dismiss the active composer chip if present
            if (!shouldEnable && /Google Search/i.test(targetLabel)) {
              const chipButtons = Array.from(
                doc.querySelectorAll(
                  'ms-prompt-input-wrapper button, .prompt-input-wrapper button, mat-chip-row button, .tool-chip button',
                ),
              ).filter(isVis);
              for (const btn of chipButtons) {
                const btnText = (btn.textContent ?? '').replace(/\s+/g, ' ').trim();
                const parentText = (btn.parentElement?.textContent ?? '')
                  .replace(/\s+/g, ' ')
                  .trim();
                if (
                  /Grounding with Google Search/i.test(btnText) ||
                  (/Grounding with Google Search/i.test(parentText) &&
                    (/\b(close|cancel|clear|remove|×|x)\b/i.test(btnText) ||
                      /remove|close|disable/i.test(
                        btn.getAttribute?.('aria-label') ?? '',
                      )))
                ) {
                  const innerClose = btn.querySelector?.(
                    'mat-icon, .close-button, [aria-label*="Remove" i], [aria-label*="Close" i]',
                  );
                  if (innerClose && typeof innerClose.click === 'function') {
                    innerClose.click();
                  } else {
                    btn.click?.();
                  }
                  break;
                }
              }
            }
          },
          { targetLabel: labelText, shouldEnable: enabled },
        )
        .catch(() => {});
    } catch {
      // ignore
    }
  }

  private isBrowserClosedError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /Target page, context or browser has been closed|Browser has been closed|Context.*closed|Session closed|Target closed|Connection closed/i.test(
      msg,
    );
  }

  private evictClosedContext(targetCtx?: BrowserContext, targetKey?: string): void {
    if (targetKey) {
      this.headlessContexts.delete(targetKey);
    }
    for (const [key, ctx] of this.headlessContexts.entries()) {
      if (!targetCtx || ctx === targetCtx) {
        this.headlessContexts.delete(key);
        void ctx.close().catch(() => {});
      }
    }
    for (const [runId, entry] of this.activeRunPages.entries()) {
      if (!targetCtx || entry.ctx === targetCtx || entry.page.isClosed()) {
        this.activeRunPages.delete(runId);
      }
    }
    for (const [key, entry] of this.savedChatPages.entries()) {
      if (!targetCtx || entry.ctx === targetCtx || entry.page.isClosed()) {
        this.savedChatPages.delete(key);
      }
    }
  }

  private async isContextAlive(ctx: BrowserContext): Promise<boolean> {
    try {
      const browser = ctx.browser();
      if (browser && !browser.isConnected()) {
        return false;
      }
      await ctx.cookies(['https://gemini.google.com']);
      return true;
    } catch {
      return false;
    }
  }

  private async isPageAndContextAlive(
    ctx: BrowserContext,
    page: Page,
  ): Promise<boolean> {
    if (page.isClosed()) return false;
    if (!(await this.isContextAlive(ctx))) return false;
    try {
      await page.evaluate(() => true);
      return true;
    } catch {
      return false;
    }
  }

  private async pruneClosedContexts(): Promise<void> {
    for (const [key, ctx] of this.headlessContexts.entries()) {
      if (!(await this.isContextAlive(ctx))) {
        this.evictClosedContext(ctx, key);
      }
    }
  }

  /**
   * Closes any extra `about:blank` or `chrome://newtab` / `edge://newtab` tabs in the browser
   * so only the active agent tab(s) remain visible.
   */
  private async closeExtraBlankTabs(
    ctx: BrowserContext,
    keepPage: Page,
  ): Promise<void> {
    try {
      const busyPages = new Set<Page>([keepPage]);
      for (const entry of this.activeRunPages.values()) {
        busyPages.add(entry.page);
      }
      for (const p of ctx.pages()) {
        if (p.isClosed() || busyPages.has(p)) continue;
        const u = p.url();
        if (
          u === 'about:blank' ||
          u === '' ||
          u.startsWith('chrome://newtab') ||
          u.startsWith('edge://newtab')
        ) {
          await p.close().catch(() => {});
        }
      }
    } catch {
      // Ignore if closing extra blank tab fails
    }
  }

  /**
   * Releases a page when a run or task finishes without closing the last tab in a persistent context
   * and without navigating to `about:blank` (so the user never sees an `about:blank` tab).
   */
  private async releasePageSafely(
    ctx: BrowserContext,
    page: Page,
  ): Promise<void> {
    try {
      if (page.isClosed()) return;
      const openPages = ctx.pages().filter((p) => !p.isClosed());
      if (openPages.length > 1) {
        await page.close().catch(() => {});
      }
      // If it is the last remaining tab in the window, keep it open on its current page
      // so the browser stays alive without creating an about:blank tab.
    } catch {
      // Ignore if context or page is already closed
    }
  }

  /**
   * Guarantees returning an open, live BrowserContext and Page in the single shared browser.
   * Reuses any idle existing tab (including the initial tab) so no extra `about:blank` tab is left open.
   */
  private async acquirePageInContext(
    _guestMode: boolean,
    profileDir: string,
    visible: boolean,
  ): Promise<{ ctx: BrowserContext; page: Page }> {
    const key = 'google-shared';
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctx = await this.getOrCreateBrowserContext(
        false,
        profileDir,
        visible,
      );
      try {
        const busyPages = new Set<Page>();
        for (const entry of this.activeRunPages.values()) {
          if (!entry.page.isClosed()) {
            busyPages.add(entry.page);
          }
        }
        const idlePage = ctx
          .pages()
          .find((p) => !p.isClosed() && !busyPages.has(p));
        if (idlePage && (await this.isPageAndContextAlive(ctx, idlePage))) {
          await this.closeExtraBlankTabs(ctx, idlePage);
          return { ctx, page: idlePage };
        }
        const page = await ctx.newPage();
        await this.closeExtraBlankTabs(ctx, page);
        return { ctx, page };
      } catch (err) {
        this.logger.warn(
          `Failed to open page in existing browser context (${key}): ${err instanceof Error ? err.message : String(err)}. Relaunching browser...`,
        );
        this.evictClosedContext(ctx, key);
      }
    }

    const freshCtx = await this.getOrCreateBrowserContext(false, profileDir, visible);
    const page = freshCtx.pages()[0] ?? (await freshCtx.newPage());
    await this.closeExtraBlankTabs(freshCtx, page);
    return { ctx: freshCtx, page };
  }

  private registerContextLifecycle(key: string, ctx: BrowserContext): void {
    this.headlessContexts.set(key, ctx);
    void this.ensureDarkThemeContext(ctx);
    ctx.on('close', () => {
      if (this.headlessContexts.get(key) === ctx) {
        this.headlessContexts.delete(key);
      }
      for (const [runId, entry] of this.activeRunPages.entries()) {
        if (entry.ctx === ctx) {
          this.activeRunPages.delete(runId);
        }
      }
    });
  }

  private async getOrCreateBrowserContext(
    _guestMode: boolean,
    profileDir: string,
    visible: boolean,
  ): Promise<BrowserContext> {
    const key = 'google-shared';
    for (const [k, existing] of this.headlessContexts.entries()) {
      if (await this.isContextAlive(existing)) {
        return existing;
      }
      this.evictClosedContext(existing, k);
    }

    if (this.launchingContextPromise) {
      return this.launchingContextPromise;
    }

    this.launchingContextPromise = (async () => {
      try {
        const ctx = await this.launchPersistentContext(profileDir, visible);
        this.registerContextLifecycle(key, ctx);
        return ctx;
      } finally {
        this.launchingContextPromise = null;
      }
    })();

    return this.launchingContextPromise;
  }

  private async launchPersistentContext(
    profileDir: string,
    visible: boolean,
  ): Promise<BrowserContext> {
    const channels: Array<'chrome' | 'msedge' | undefined> = ['chrome', 'msedge', undefined];
    let lastErr: unknown = null;

    for (const channel of channels) {
      try {
        return await chromium.launchPersistentContext(profileDir, {
          headless: false,
          chromiumSandbox: true,
          colorScheme: 'dark',
          ignoreDefaultArgs: ['--no-sandbox', '--enable-automation'],
          ...(channel ? { channel } : {}),
          viewport: null,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--test-type=',
            ...(visible
              ? ['--window-position=80,60', '--window-size=1280,860']
              : ['--window-position=-32000,-32000']),
          ],
        });
      } catch (err) {
        lastErr = err;
      }
    }

    this.logger.error(`Could not launch browser context: ${String(lastErr)}`);
    throw new LlmError(
      'PROVIDER_UNAVAILABLE',
      'Could not launch Chrome or Edge for Google Web session. Ensure Google Chrome or Microsoft Edge is installed.',
    );
  }

  private async waitForInteractiveSignIn(
    ctx: BrowserContext,
    page: Page,
    _targetUrl: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let clickedSignIn = false;
    let authenticatedTicks = 0;

    await new Promise((r) => setTimeout(r, 1500));

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        return this.hasGoogleAuthCookiesInContext(ctx);
      }

      const currentUrl = page.url();
      const onAccountsPage = currentUrl.includes('accounts.google.com');
      const hasAuthCookie = await this.hasGoogleAuthCookiesInContext(ctx);

      if (!onAccountsPage && !hasAuthCookie && !clickedSignIn) {
        const signInBtn = page.locator(SIGN_IN_BUTTON_SELECTOR).first();
        if ((await signInBtn.count().catch(() => 0)) > 0) {
          clickedSignIn = true;
          await signInBtn.click().catch(() => {});
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      }

      if (!onAccountsPage && hasAuthCookie) {
        const signInBtnCount = await page
          .locator(SIGN_IN_BUTTON_SELECTOR)
          .count()
          .catch(() => 0);
        const composerCount = await page
          .locator(COMPOSER_SELECTOR)
          .count()
          .catch(() => 0);

        if (signInBtnCount === 0 && composerCount > 0) {
          authenticatedTicks += 1;
          if (authenticatedTicks >= 3) {
            return true;
          }
        } else {
          authenticatedTicks = 0;
        }
      } else {
        authenticatedTicks = 0;
      }

      await new Promise((r) => setTimeout(r, 900));
    }

    return this.hasGoogleAuthCookiesInContext(ctx);
  }

  private async hasGoogleAuthCookiesInContext(ctx: BrowserContext): Promise<boolean> {
    try {
      const cookies = await ctx.cookies([
        'https://google.com',
        'https://www.google.com',
        'https://accounts.google.com',
        'https://gemini.google.com',
        'https://aistudio.google.com',
      ]);
      return cookies.some(
        (c) =>
          (c.name === 'SID' ||
            c.name === '__Secure-1PSID' ||
            c.name === '__Secure-3PSID' ||
            c.name === 'LSID') &&
          Boolean(c.value),
      );
    } catch {
      return false;
    }
  }

  private async writeSessionMarker(profileDir: string, targetUrl: string): Promise<void> {
    const markerPath = path.join(profileDir, SESSION_MARKER_FILE);
    await fs.writeFile(
      markerPath,
      JSON.stringify({ verifiedAt: new Date().toISOString(), targetUrl }, null, 2),
      'utf-8',
    );
  }
}
