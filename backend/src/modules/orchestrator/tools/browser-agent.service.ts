import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { AgentKey, ToolArgsOf } from '@robdev/shared';
import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { AppConfigService } from '../../../config/app-config.service.js';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import type { LlmImageAttachment } from '../../llm/adapters/llm-adapter.interface.js';

export interface BrowserInteractiveElement {
  ref: number;
  tag: string;
  role: string;
  text: string;
  type?: string;
  href?: string;
  placeholder?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserObservationResult {
  url: string;
  title: string;
  width: number;
  height: number;
  elements: BrowserInteractiveElement[];
  textExcerpt: string;
  consoleErrors: string[];
  mediaId?: string;
  screenshotPath: string;
  image?: LlmImageAttachment;
}

interface AgentBrowserSession {
  key: string;
  studioId: string;
  agentKey: AgentKey;
  ctx: BrowserContext;
  activeTabIndex: number;
  consoleErrorsByPage: WeakMap<Page, string[]>;
}

@Injectable()
export class BrowserAgentService implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserAgentService.name);
  private readonly sessions = new Map<string, AgentBrowserSession>();

  constructor(private readonly cfg: AppConfigService) {}

  async onModuleDestroy(): Promise<void> {
    for (const s of this.sessions.values()) {
      await s.ctx.close().catch(() => {});
    }
    this.sessions.clear();
  }

  private sessionKey(studioId: string, agentKey: AgentKey): string {
    return `${studioId}:${agentKey}`;
  }

  private async ensureSession(
    studioId: string,
    agentKey: AgentKey,
  ): Promise<{ session: AgentBrowserSession; page: Page }> {
    const key = this.sessionKey(studioId, agentKey);
    const existing = this.sessions.get(key);
    if (existing) {
      const openPages = existing.ctx.pages().filter((p) => !p.isClosed());
      if (openPages.length > 0) {
        const clampedIdx = Math.min(
          Math.max(0, existing.activeTabIndex),
          openPages.length - 1,
        );
        existing.activeTabIndex = clampedIdx;
        return { session: existing, page: openPages[clampedIdx]! };
      }
      await existing.ctx.close().catch(() => {});
      this.sessions.delete(key);
    }

    const profileDir = path.resolve(
      process.cwd(),
      '.browser-profiles',
      'agent-browser',
      `${studioId}-${agentKey}`,
    );
    await fs.mkdir(profileDir, { recursive: true });

    const channels: Array<'chrome' | 'msedge' | undefined> = [
      'chrome',
      'msedge',
      undefined,
    ];
    let ctx: BrowserContext | null = null;
    let lastErr: unknown = null;

    for (const channel of channels) {
      try {
        ctx = await chromium.launchPersistentContext(profileDir, {
          headless: true,
          ...(channel ? { channel } : {}),
          viewport: { width: 1280, height: 800 },
          args: ['--disable-blink-features=AutomationControlled'],
        });
        break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!ctx) {
      throw new Error(
        `Failed to launch browser for agent ${agentKey}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
      );
    }

    const consoleErrorsByPage = new WeakMap<Page, string[]>();
    const attachListeners = (p: Page): void => {
      const errs: string[] = [];
      consoleErrorsByPage.set(p, errs);
      p.on('console', (msg) => {
        if (msg.type() === 'error') {
          errs.push(msg.text().slice(0, 300));
          if (errs.length > 25) errs.shift();
        }
      });
      p.on('pageerror', (err) => {
        errs.push(err.message.slice(0, 300));
        if (errs.length > 25) errs.shift();
      });
    };

    for (const p of ctx.pages()) {
      attachListeners(p);
    }
    ctx.on('page', (p) => attachListeners(p));

    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const session: AgentBrowserSession = {
      key,
      studioId,
      agentKey,
      ctx,
      activeTabIndex: 0,
      consoleErrorsByPage,
    };
    this.sessions.set(key, session);
    return { session, page };
  }

  async navigate(params: {
    studioId: string;
    agentKey: AgentKey;
    prisma: PrismaService;
    args: ToolArgsOf<'browser_navigate'>;
  }): Promise<{
    url: string;
    title: string;
    status: number | null;
    observation?: BrowserObservationResult;
  }> {
    const { session, page } = await this.ensureSession(
      params.studioId,
      params.agentKey,
    );
    void session;

    let targetUrl = params.args.url.trim();
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(targetUrl)) {
      if (/^localhost(?::\d+)?(?:\/|$)|^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/|$)/.test(targetUrl)) {
        targetUrl = targetUrl.startsWith('localhost')
          ? `http://${targetUrl}`
          : `https://${targetUrl}`;
      } else {
        targetUrl = `https://www.google.com/search?q=${encodeURIComponent(targetUrl)}`;
      }
    }

    const resp = await page.goto(targetUrl, {
      waitUntil: params.args.waitUntil ?? 'domcontentloaded',
      timeout: 35_000,
    });
    await page.waitForTimeout(500).catch(() => {});

    const status = resp?.status() ?? null;
    const title = await page.title().catch(() => '');
    const currentUrl = page.url();

    let observation: BrowserObservationResult | undefined;
    if (params.args.observeAfter !== false) {
      observation = await this.observe({
        studioId: params.studioId,
        agentKey: params.agentKey,
        prisma: params.prisma,
        args: { annotate: true, includeText: true, maxElements: 60 },
      });
    }

    return {
      url: currentUrl,
      title,
      status,
      ...(observation ? { observation } : {}),
    };
  }

  async observe(params: {
    studioId: string;
    agentKey: AgentKey;
    prisma: PrismaService;
    args: ToolArgsOf<'browser_observe'>;
  }): Promise<BrowserObservationResult> {
    const { session, page } = await this.ensureSession(
      params.studioId,
      params.agentKey,
    );
    const maxElements = params.args.maxElements ?? 60;
    const annotate = params.args.annotate !== false;
    const includeText = params.args.includeText !== false;

    const harvested = await page
      .evaluate(
        ({ maxEls, drawBadges, wantText }) => {
          interface DomEl {
            tagName?: string;
            innerText?: string;
            textContent?: string | null;
            value?: string;
            href?: string;
            type?: string;
            placeholder?: string;
            getAttribute?: (n: string) => string | null;
            setAttribute?: (n: string, v: string) => void;
            remove?: () => void;
            getBoundingClientRect?: () => {
              left: number;
              top: number;
              width: number;
              height: number;
            };
            style?: Record<string, string>;
            appendChild?: (c: unknown) => void;
          }
          const g = globalThis as unknown as {
            innerWidth?: number;
            innerHeight?: number;
            document?: {
              title?: string;
              body?: DomEl;
              querySelectorAll: (s: string) => ArrayLike<DomEl>;
              createElement: (t: string) => DomEl;
            };
          };
          const doc = g.document;
          if (!doc || !doc.body) {
            return {
              width: 1280,
              height: 800,
              elements: [],
              textExcerpt: '',
            };
          }

          // Remove any old badges
          for (const old of Array.from(doc.querySelectorAll('[data-rd-badge]'))) {
            old.remove?.();
          }

          const candidates = Array.from(
            doc.querySelectorAll(
              'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [contenteditable="true"]',
            ),
          );

          const elements: Array<{
            ref: number;
            tag: string;
            role: string;
            text: string;
            type?: string;
            href?: string;
            placeholder?: string;
            x: number;
            y: number;
            width: number;
            height: number;
          }> = [];

          let refCounter = 1;
          for (const el of candidates) {
            if (refCounter > maxEls) break;
            const rect = el.getBoundingClientRect?.();
            if (!rect || rect.width < 6 || rect.height < 6) continue;
            if (
              rect.top + rect.height < 0 ||
              rect.left + rect.width < 0 ||
              rect.top > (g.innerHeight ?? 900) ||
              rect.left > (g.innerWidth ?? 1400)
            ) {
              continue;
            }

            const ref = refCounter++;
            el.setAttribute?.('data-rd-ref', String(ref));

            const tag = (el.tagName ?? 'div').toLowerCase();
            const role = el.getAttribute?.('role') ?? tag;
            const rawText =
              el.innerText ||
              el.value ||
              el.getAttribute?.('aria-label') ||
              el.getAttribute?.('title') ||
              el.placeholder ||
              '';
            const cleanText = rawText.replace(/\s+/g, ' ').trim().slice(0, 80);

            elements.push({
              ref,
              tag,
              role,
              text: cleanText,
              ...(el.type ? { type: el.type } : {}),
              ...(el.href ? { href: el.href.slice(0, 160) } : {}),
              ...(el.placeholder ? { placeholder: el.placeholder.slice(0, 60) } : {}),
              x: Math.round(rect.left + rect.width / 2),
              y: Math.round(rect.top + rect.height / 2),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            });

            if (drawBadges) {
              const badge = doc.createElement('div');
              badge.setAttribute?.('data-rd-badge', String(ref));
              if (badge.style) {
                badge.style['position'] = 'fixed';
                badge.style['left'] = `${Math.max(0, Math.round(rect.left))}px`;
                badge.style['top'] = `${Math.max(0, Math.round(rect.top))}px`;
                badge.style['zIndex'] = '2147483647';
                badge.style['background'] = '#06B6D4';
                badge.style['color'] = '#081018';
                badge.style['fontSize'] = '11px';
                badge.style['fontWeight'] = '700';
                badge.style['fontFamily'] = 'monospace';
                badge.style['padding'] = '1px 4px';
                badge.style['borderRadius'] = '3px';
                badge.style['pointerEvents'] = 'none';
                badge.style['boxShadow'] = '0 1px 3px rgba(0,0,0,0.6)';
              }
              badge.textContent = `#${ref}`;
              doc.body.appendChild?.(badge);
            }
          }

          const textExcerpt = wantText
            ? (doc.body.innerText ?? '')
                .replace(/\n{3,}/g, '\n\n')
                .trim()
                .slice(0, 4000)
            : '';

          return {
            width: g.innerWidth ?? 1280,
            height: g.innerHeight ?? 800,
            elements,
            textExcerpt,
          };
        },
        { maxEls: maxElements, drawBadges: annotate, wantText: includeText },
      )
      .catch(() => ({
        width: 1280,
        height: 800,
        elements: [] as BrowserInteractiveElement[],
        textExcerpt: '',
      }));

    const buf = await page.screenshot({ type: 'png' }).catch(() => null);

    if (annotate) {
      await page
        .evaluate(() => {
          const doc = (
            globalThis as unknown as {
              document?: {
                querySelectorAll: (s: string) => ArrayLike<{ remove?: () => void }>;
              };
            }
          ).document;
          if (!doc) return;
          for (const b of Array.from(doc.querySelectorAll('[data-rd-badge]'))) {
            b.remove?.();
          }
        })
        .catch(() => {});
    }

    let mediaId: string | undefined;
    let screenshotPath = '';
    let image: LlmImageAttachment | undefined;

    if (buf) {
      const id = `med_${randomUUID().replace(/-/g, '')}`;
      const storageKey = `${params.studioId}/${id}.png`;
      const absPath = path.resolve(this.cfg.mediaStorageRoot, storageKey);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, buf);
      const sha256 = createHash('sha256').update(buf).digest('hex');

      const createdMedia = await params.prisma.mediaFile
        ?.create?.({
          data: {
            id,
            studioId: params.studioId,
            storageKey,
            mimeType: 'image/png',
            width: harvested.width,
            height: harvested.height,
            bytes: buf.byteLength,
            sha256,
          },
        })
        .catch(() => null);

      mediaId = createdMedia?.id ?? id;
      screenshotPath = absPath;
      image = {
        mediaId,
        mimeType: 'image/png',
        base64: buf.toString('base64'),
        filePath: absPath,
        width: harvested.width,
        height: harvested.height,
      };
    }

    const consoleErrors = [
      ...(session.consoleErrorsByPage.get(page) ?? []),
    ].slice(-10);

    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      width: harvested.width,
      height: harvested.height,
      elements: harvested.elements,
      textExcerpt: harvested.textExcerpt,
      consoleErrors,
      ...(mediaId ? { mediaId } : {}),
      screenshotPath,
      ...(image ? { image } : {}),
    };
  }

  async act(params: {
    studioId: string;
    agentKey: AgentKey;
    prisma: PrismaService;
    args: ToolArgsOf<'browser_act'>;
  }): Promise<{
    ok: boolean;
    completedSteps: number;
    results: unknown[];
    failedStep?: { index: number; kind: string; error: string };
    observation?: BrowserObservationResult;
  }> {
    const { page } = await this.ensureSession(params.studioId, params.agentKey);
    const results: unknown[] = [];
    let completedSteps = 0;
    let failedStep: { index: number; kind: string; error: string } | undefined;

    const resolveLocator = (step: { ref?: number; selector?: string }) => {
      if (typeof step.ref === 'number') {
        return page.locator(`[data-rd-ref="${step.ref}"]`).first();
      }
      if (step.selector) {
        return page.locator(step.selector).first();
      }
      return null;
    };

    for (let i = 0; i < params.args.steps.length; i++) {
      const step = params.args.steps[i]!;
      const stepKind = step.kind ?? step.type ?? 'click';
      try {
        switch (stepKind) {
          case 'click': {
            const loc = resolveLocator(step);
            if (loc) {
              await loc.click({ timeout: 8_000 });
            } else if (typeof step.x === 'number' && typeof step.y === 'number') {
              await page.mouse.click(step.x, step.y);
            }
            break;
          }
          case 'type': {
            const loc = resolveLocator(step);
            if (loc) {
              if (step.clearFirst !== false) {
                await loc.fill(step.text ?? '', { timeout: 8_000 });
              } else {
                await loc.pressSequentially(step.text ?? '', { timeout: 8_000 });
              }
              if (step.pressEnter || step.submit) {
                await loc.press('Enter');
              }
            } else if (step.text) {
              await page.keyboard.type(step.text);
              if (step.pressEnter || step.submit) {
                await page.keyboard.press('Enter');
              }
            }
            break;
          }
          case 'press': {
            await page.keyboard.press(step.key || 'Enter');
            break;
          }
          case 'hover': {
            const loc = resolveLocator(step);
            if (loc) {
              await loc.hover({ timeout: 8_000 });
            } else if (typeof step.x === 'number' && typeof step.y === 'number') {
              await page.mouse.move(step.x, step.y);
            }
            break;
          }
          case 'scroll': {
            await page.mouse.wheel(0, step.deltaY ?? step.dy ?? 500);
            break;
          }
          case 'select': {
            const loc = resolveLocator(step);
            if (loc && step.value !== undefined) {
              await loc.selectOption(step.value, { timeout: 8_000 });
            }
            break;
          }
          case 'wait': {
            await page.waitForTimeout(Math.min(step.waitMs ?? step.ms ?? 1000, 15_000));
            break;
          }
          case 'goto': {
            if (step.url) {
              await page.goto(step.url, {
                waitUntil: 'domcontentloaded',
                timeout: 30_000,
              });
            }
            break;
          }
          case 'back': {
            await page.goBack({ timeout: 15_000 }).catch(() => {});
            break;
          }
          case 'forward': {
            await page.goForward({ timeout: 15_000 }).catch(() => {});
            break;
          }
          case 'reload': {
            await page.reload({ timeout: 20_000 }).catch(() => {});
            break;
          }
          case 'evaluate': {
            if (step.script) {
              const evalOut = await page.evaluate(step.script);
              results.push(evalOut);
            }
            break;
          }
        }
        completedSteps += 1;
      } catch (err) {
        failedStep = {
          index: i,
          kind: stepKind,
          error: err instanceof Error ? err.message : String(err),
        };
        break;
      }
    }

    const settleMs = params.args.settleMs ?? 450;
    if (settleMs > 0) {
      await page.waitForTimeout(settleMs).catch(() => {});
    }

    let observation: BrowserObservationResult | undefined;
    if (params.args.observeAfter !== false) {
      observation = await this.observe({
        studioId: params.studioId,
        agentKey: params.agentKey,
        prisma: params.prisma,
        args: { annotate: true, includeText: true, maxElements: 60 },
      });
    }

    return {
      ok: !failedStep,
      completedSteps,
      results,
      ...(failedStep ? { failedStep } : {}),
      ...(observation ? { observation } : {}),
    };
  }

  async extract(params: {
    studioId: string;
    agentKey: AgentKey;
    args: ToolArgsOf<'browser_extract'>;
  }): Promise<{
    url: string;
    title: string;
    mode: string;
    content: string;
  }> {
    const { page } = await this.ensureSession(params.studioId, params.agentKey);
    const mode = params.args.mode ?? 'markdown';
    const selector = params.args.selector;
    const maxChars = params.args.maxChars ?? 16_000;

    const content = await page
      .evaluate(
        ({ extractMode, sel, limit }) => {
          interface DomNode {
            tagName?: string;
            innerText?: string;
            outerHTML?: string;
            href?: string;
            querySelector?: (s: string) => DomNode | null;
            querySelectorAll?: (s: string) => ArrayLike<DomNode>;
          }
          const doc = (
            globalThis as unknown as {
              document?: {
                body?: DomNode;
                querySelector: (s: string) => DomNode | null;
                querySelectorAll: (s: string) => ArrayLike<DomNode>;
              };
            }
          ).document;
          if (!doc || !doc.body) return '';

          const root = (sel ? doc.querySelector(sel) : doc.body) ?? doc.body;
          if (extractMode === 'html') {
            return (root.outerHTML ?? '').slice(0, limit);
          }
          if (extractMode === 'links') {
            const anchors = Array.from(root.querySelectorAll?.('a[href]') ?? []);
            return anchors
              .slice(0, 120)
              .map(
                (a) =>
                  `- [${(a.innerText ?? '').replace(/\s+/g, ' ').trim() || a.href}](${a.href})`,
              )
              .join('\n')
              .slice(0, limit);
          }
          if (extractMode === 'tables') {
            const tables = Array.from(root.querySelectorAll?.('table') ?? []);
            const out: string[] = [];
            for (const tbl of tables.slice(0, 15)) {
              const rows = Array.from(tbl.querySelectorAll?.('tr') ?? []);
              for (const r of rows) {
                const cells = Array.from(r.querySelectorAll?.('th, td') ?? []).map(
                  (c) => (c.innerText ?? '').replace(/\s+/g, ' ').trim(),
                );
                if (cells.length > 0) {
                  out.push(`| ${cells.join(' | ')} |`);
                }
              }
              out.push('');
            }
            return out.join('\n').slice(0, limit);
          }
          return (root.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim().slice(0, limit);
        },
        { extractMode: mode, sel: selector, limit: maxChars },
      )
      .catch(() => '');

    return {
      url: page.url(),
      title: await page.title().catch(() => ''),
      mode,
      content,
    };
  }

  async manageTabs(params: {
    studioId: string;
    agentKey: AgentKey;
    args: ToolArgsOf<'browser_tabs'>;
  }): Promise<{
    activeTabIndex: number;
    tabs: Array<{ index: number; url: string; title: string; active: boolean }>;
  }> {
    const { session } = await this.ensureSession(params.studioId, params.agentKey);

    if (params.args.action === 'new') {
      const newPage = await session.ctx.newPage();
      if (params.args.url) {
        await newPage
          .goto(params.args.url, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          })
          .catch(() => {});
      }
      const openPages = session.ctx.pages().filter((p) => !p.isClosed());
      session.activeTabIndex = openPages.length - 1;
    } else if (
      params.args.action === 'switch' &&
      typeof params.args.tabIndex === 'number'
    ) {
      const openPages = session.ctx.pages().filter((p) => !p.isClosed());
      if (
        params.args.tabIndex >= 0 &&
        params.args.tabIndex < openPages.length
      ) {
        session.activeTabIndex = params.args.tabIndex;
        await openPages[params.args.tabIndex]?.bringToFront().catch(() => {});
      }
    } else if (params.args.action === 'close') {
      const openPages = session.ctx.pages().filter((p) => !p.isClosed());
      const targetIdx = params.args.tabIndex ?? session.activeTabIndex;
      if (openPages.length > 1 && openPages[targetIdx]) {
        await openPages[targetIdx]!.close().catch(() => {});
      }
      const remaining = session.ctx.pages().filter((p) => !p.isClosed());
      session.activeTabIndex = Math.min(
        session.activeTabIndex,
        Math.max(0, remaining.length - 1),
      );
    }

    const openPages = session.ctx.pages().filter((p) => !p.isClosed());
    const tabs: Array<{
      index: number;
      url: string;
      title: string;
      active: boolean;
    }> = [];
    for (let i = 0; i < openPages.length; i++) {
      const p = openPages[i]!;
      tabs.push({
        index: i,
        url: p.url(),
        title: await p.title().catch(() => ''),
        active: i === session.activeTabIndex,
      });
    }

    return {
      activeTabIndex: session.activeTabIndex,
      tabs,
    };
  }
}
