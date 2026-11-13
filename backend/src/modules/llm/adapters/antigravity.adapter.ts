import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, type BrowserSessionStatusDto, type LlmModelInfoDto } from '@robdev/shared';
import { chromium } from 'playwright-core';
import { LocalRuntimeDiscoveryService } from '../local-runtime-discovery.service.js';
import { ClaudeCodeAdapter } from './claude-code.adapter.js';
import { CodexCliAdapter } from './codex-cli.adapter.js';
import { GoogleWebBrowserAdapter } from './google-web.adapter.js';
import {
  LlmError,
  type BoundLlmAdapter,
  type LlmAdapter,
  type LlmStreamEvent,
  type LlmStreamRequest,
  type ResolvedConnection,
} from './llm-adapter.interface.js';
import {
  extractToolCallsFromText,
  formatSinglePromptForWebUi,
  injectToolsIntoMessages,
} from './prompt-tool-bridge.js';

export const ANTIGRAVITY_MODELS: LlmModelInfoDto[] = [
  {
    id: 'agy-auto',
    displayName: 'Antigravity Auto (Recommended)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gemini-3.1-pro-high',
    displayName: 'Gemini 3.1 Pro (High Reasoning — Antigravity)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gemini-3.1-pro-low',
    displayName: 'Gemini 3.1 Pro (Low Reasoning — Antigravity)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gemini-3-flash',
    displayName: 'Gemini 3 Flash (Fast — Antigravity)',
    contextWindow: 1_000_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6 (via Antigravity)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-opus-4-6-thinking',
    displayName: 'Claude Opus 4.6 Thinking (via Antigravity)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gpt-oss-120b-medium',
    displayName: 'GPT-OSS 120B Medium (via Antigravity)',
    contextWindow: 128_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
];

@Injectable()
export class AntigravityAdapter implements LlmAdapter {
  private readonly logger = new Logger(AntigravityAdapter.name);

  constructor(
    private readonly discovery: LocalRuntimeDiscoveryService,
    private readonly googleWeb: GoogleWebBrowserAdapter,
    private readonly claudeCode: ClaudeCodeAdapter,
    private readonly codexCli: CodexCliAdapter,
  ) {}

  bind(connection: ResolvedConnection): BoundLlmAdapter {
    return {
      listModels: () => this.listModels(connection),
      stream: (req, signal) => this.stream(connection, req, signal),
    };
  }

  async listModels(_connection: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    return ANTIGRAVITY_MODELS;
  }

  async getSessionStatus(connection: ResolvedConnection): Promise<BrowserSessionStatusDto> {
    const bin = await this.discovery.resolveExecutable(LlmProvider.ANTIGRAVITY, connection.baseUrl);
    return {
      authenticated: Boolean(bin),
      targetUrl: bin?.executablePath ?? 'antigravity://local',
      profileDir: path.join(process.env.APPDATA || '', 'Antigravity'),
      message: bin
        ? `Antigravity detected at ${bin.executablePath} (${bin.version || 'ready'}).`
        : 'Antigravity desktop app or agy CLI not found; will route via connected Antigravity model engines.',
    };
  }

  async *stream(
    connection: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const bin = await this.discovery.resolveExecutable(LlmProvider.ANTIGRAVITY, connection.baseUrl);
    const exeName = bin ? path.basename(bin.executablePath).toLowerCase() : '';

    // 1. If the standalone `agy` CLI is available, execute `agy -p` directly
    if (bin && (exeName === 'agy' || exeName === 'agy.exe' || exeName === 'agy.cmd')) {
      yield* this.streamViaAgyCli(bin.executablePath, req, signal);
      return;
    }

    // 2. If a custom CDP endpoint is provided in baseUrl (e.g., http://localhost:9222)
    if (
      connection.baseUrl &&
      (connection.baseUrl.startsWith('http://127.0.0.1:') ||
        connection.baseUrl.startsWith('http://localhost:'))
    ) {
      const cdpWorked = yield* this.tryStreamViaCdp(connection.baseUrl, req, signal);
      if (cdpWorked) return;
    }

    // 3. Route through the selected Antigravity model engine (Gemini 3.1 Pro/Flash, Claude 4.6, or Codex)
    const modelId = (req.model || 'gemini-3.1-pro-high').toLowerCase();
    yield {
      type: 'status',
      statusText: `Antigravity Agent Bridge (${req.model || 'gemini-3.1-pro-high'})...`,
    };

    if (modelId.includes('claude')) {
      const claudeBin = await this.discovery.findClaudeCodeBinary();
      if (claudeBin) {
        const mappedModel = modelId.includes('opus') ? 'claude-opus-4-6' : 'claude-sonnet-4-6';
        yield* this.claudeCode.stream(
          { ...connection, provider: LlmProvider.CLAUDE_CODE },
          { ...req, model: mappedModel },
          signal,
        );
        return;
      }
    }

    if (modelId.includes('gpt') || modelId.includes('codex')) {
      const codexBin = await this.discovery.findCodexBinary();
      if (codexBin) {
        yield* this.codexCli.stream(
          { ...connection, provider: LlmProvider.CODEX },
          { ...req, model: 'gpt-5.3-codex' },
          signal,
        );
        return;
      }
    }

    // Map Antigravity Gemini models to GoogleWebBrowserAdapter
    let webModel = 'gemini-web:3.1-pro?thinking=high';
    if (modelId.includes('flash')) {
      webModel = 'gemini-web:3.8-flash?thinking=medium';
    } else if (modelId.includes('low')) {
      webModel = 'gemini-web:3.1-pro?thinking=low';
    }

    yield* this.googleWeb.stream(
      {
        ...connection,
        provider: LlmProvider.GOOGLE_WEB,
        baseUrl: 'https://gemini.google.com/app',
      },
      { ...req, model: webModel },
      signal,
    );
  }

  private async *streamViaAgyCli(
    executablePath: string,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const hasTools = req.tools.length > 0;
    const bridgedMessages = injectToolsIntoMessages(req.messages, req.tools);
    const fullPrompt = formatSinglePromptForWebUi(bridgedMessages, hasTools);

    const rawModel = (req.model || '').trim().split(':')[0] || '';
    const args = ['-p', fullPrompt, '--mode', 'agent'];
    if (rawModel && rawModel !== 'agy-auto') {
      args.push('-m', rawModel);
    }

    yield {
      type: 'status',
      statusText: `Running Antigravity CLI (${rawModel || 'auto'})...`,
    };

    const isCmd = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executablePath);
    const child = spawn(executablePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: isCmd,
    });

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });

    let stderrBuf = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let accumulatedText = '';
    try {
      for await (const line of rl) {
        if (signal.aborted) break;
        accumulatedText += (accumulatedText ? '\n' : '') + line;
        const preview = extractToolCallsFromText(accumulatedText);
        if (preview.cleanText) {
          yield { type: 'text-delta', text: preview.cleanText, replace: true };
        }
      }

      const exitCode = await new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.once('close', (code) => resolve(code));
      });

      if (exitCode !== 0 && !accumulatedText.trim()) {
        throw new LlmError(
          'PROVIDER_UNAVAILABLE',
          `Antigravity CLI exited with code ${String(exitCode)}: ${stderrBuf.trim()}`,
        );
      }

      const { cleanText, toolCalls } = extractToolCallsFromText(accumulatedText);
      if (cleanText !== accumulatedText) {
        yield { type: 'text-delta', text: cleanText, replace: true };
      }
      for (const tc of toolCalls) {
        yield { type: 'tool-call', call: tc };
      }
      yield {
        type: 'finish',
        reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
      rl.close();
    }
  }

  private async *tryStreamViaCdp(
    cdpEndpoint: string,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncGenerator<LlmStreamEvent, boolean, void> {
    try {
      const browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 3000 });
      const contexts = browser.contexts();
      const page = contexts[0]?.pages()[0];
      if (!page) return false;

      const hasTools = req.tools.length > 0;
      const bridgedMessages = injectToolsIntoMessages(req.messages, req.tools);
      const fullPrompt = formatSinglePromptForWebUi(bridgedMessages, hasTools);

      const inputLocator = page
        .locator('textarea, div[contenteditable="true"], [role="textbox"]')
        .last();
      if ((await inputLocator.count()) === 0) return false;

      yield {
        type: 'status',
        statusText: 'Connected to Antigravity Window via CDP — sending prompt...',
      };

      await inputLocator.click();
      await inputLocator.fill(fullPrompt);
      await page.keyboard.press('Enter');

      let lastText = '';
      let stableTicks = 0;
      const startMs = Date.now();

      while (Date.now() - startMs < 180_000 && !signal.aborted) {
        await new Promise((r) => setTimeout(r, 1000));
        const currentText = await page.evaluate(() => {
          const doc = (
            globalThis as unknown as {
              document?: {
                querySelectorAll: (s: string) => ArrayLike<{ innerText?: string }>;
              };
            }
          ).document;
          if (!doc) return '';
          const nodes = doc.querySelectorAll(
            '.markdown-body, [data-message-author-role="assistant"], .prose',
          );
          const last = nodes[nodes.length - 1];
          return last?.innerText || '';
        });

        if (currentText && currentText !== lastText) {
          lastText = currentText;
          stableTicks = 0;
          const preview = extractToolCallsFromText(lastText);
          if (preview.cleanText) {
            yield { type: 'text-delta', text: preview.cleanText, replace: true };
          }
        } else if (lastText.length > 0) {
          stableTicks++;
          if (stableTicks >= 4) break;
        }
      }

      if (!lastText) return false;

      const { cleanText, toolCalls } = extractToolCallsFromText(lastText);
      yield { type: 'text-delta', text: cleanText, replace: true };
      for (const tc of toolCalls) {
        yield { type: 'tool-call', call: tc };
      }
      yield {
        type: 'finish',
        reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      };
      return true;
    } catch (err) {
      this.logger.debug(`CDP connection to ${cdpEndpoint} skipped: ${String(err)}`);
      return false;
    }
  }
}
