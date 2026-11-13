import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { Injectable, Logger } from '@nestjs/common';
import { LlmProvider, type LlmModelInfoDto } from '@robdev/shared';
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
  extractToolCallsFromText,
  formatSinglePromptForWebUi,
  injectToolsIntoMessages,
} from './prompt-tool-bridge.js';

export const CLAUDE_CODE_MODELS: LlmModelInfoDto[] = [
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6 (via Claude Code)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-opus-4-6',
    displayName: 'Claude Opus 4.6 (via Claude Code)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5 (via Claude Code)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'sonnet',
    displayName: 'Claude Code — Sonnet Alias (Latest)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'opus',
    displayName: 'Claude Code — Opus Alias (Latest)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'haiku',
    displayName: 'Claude Code — Haiku Alias (Fast)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
];

@Injectable()
export class ClaudeCodeAdapter implements LlmAdapter {
  private readonly logger = new Logger(ClaudeCodeAdapter.name);

  constructor(private readonly discovery: LocalRuntimeDiscoveryService) {}

  bind(connection: ResolvedConnection): BoundLlmAdapter {
    return {
      listModels: () => this.listModels(connection),
      stream: (req, signal) => this.stream(connection, req, signal),
    };
  }

  async listModels(connection: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    const bin = await this.discovery.resolveExecutable(LlmProvider.CLAUDE_CODE, connection.baseUrl);
    if (!bin) {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        'Claude Code CLI was not found. Install it via `npm install -g @anthropic-ai/claude-code` or configure the executable path in Base URL.',
      );
    }
    return CLAUDE_CODE_MODELS;
  }

  async *stream(
    connection: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const bin = await this.discovery.resolveExecutable(LlmProvider.CLAUDE_CODE, connection.baseUrl);
    if (!bin) {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        'Claude Code CLI was not found on this machine.',
      );
    }

    const hasTools = req.tools.length > 0;
    const bridgedMessages = injectToolsIntoMessages(req.messages, req.tools);
    const basePrompt = formatSinglePromptForWebUi(bridgedMessages, hasTools);
    const fullPrompt = [
      'IMPORTANT RUNTIME DIRECTIVE: You are executing as a specialist agent inside the RobDev Control Room multi-agent orchestrator.',
      'Do NOT invoke Claude Code built-in bash/file tools. Instead, respond directly in text and invoke any needed RobDev studio tools strictly by emitting <tool_call>{"name": "...", "arguments": {...}}</tool_call> XML blocks in your response.',
      '',
      basePrompt,
    ].join('\n');

    const rawModel = (req.model || '').trim();
    const cleanModel = rawModel.split(':')[0] ?? '';

    const args: string[] = [
      ...(bin.argsPrefix ?? []),
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      '1',
    ];
    if (
      cleanModel &&
      cleanModel !== 'claude-code-default' &&
      cleanModel !== 'auto' &&
      !cleanModel.startsWith('gemini-') &&
      !cleanModel.startsWith('gpt-')
    ) {
      args.push('--model', cleanModel);
    }

    yield {
      type: 'status',
      statusText: `Launching Claude Code CLI (${cleanModel || 'default'})...`,
    };

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (connection.apiKey) {
      env.ANTHROPIC_API_KEY = connection.apiKey;
    }

    const isCmdFile =
      process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin.executablePath);

    const child = spawn(bin.executablePath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: isCmdFile,
    });

    const onAbort = () => {
      try {
        child.kill();
      } catch {
        // ignore
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });

    child.stdin.write(fullPrompt, 'utf8');
    child.stdin.end();

    let stderrBuf = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString('utf8');
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let accumulatedText = '';
    let thinkingText = '';
    const thinkingStartedAt = new Date().toISOString();
    const turnStartMs = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      for await (const line of rl) {
        if (signal.aborted) break;
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          // Plain text fallback
          accumulatedText += (accumulatedText ? '\n' : '') + trimmed;
          yield { type: 'text-delta', text: accumulatedText, replace: true };
          continue;
        }

        const evType = String(parsed.type ?? '');
        if (evType === 'system') {
          yield {
            type: 'status',
            statusText: 'Claude Code session initialized...',
          };
          continue;
        }

        if (evType === 'assistant') {
          const message = (parsed.message ?? {}) as Record<string, unknown>;
          const contentBlocks = Array.isArray(message.content) ? message.content : [];
          for (const block of contentBlocks) {
            if (!block || typeof block !== 'object') continue;
            const b = block as Record<string, unknown>;
            if (b.type === 'thinking' && typeof b.thinking === 'string') {
              thinkingText = b.thinking;
              yield {
                type: 'thinking',
                text: thinkingText,
                startedAt: thinkingStartedAt,
                durationMs: Math.max(0, Date.now() - turnStartMs),
                done: false,
              };
            } else if (b.type === 'text' && typeof b.text === 'string') {
              accumulatedText = b.text;
              const preview = extractToolCallsFromText(accumulatedText);
              if (preview.cleanText) {
                yield { type: 'text-delta', text: preview.cleanText, replace: true };
              }
            }
          }
          continue;
        }

        if (evType === 'result') {
          if (typeof parsed.result === 'string' && parsed.result.trim()) {
            accumulatedText = parsed.result;
          }
          const usage = (parsed.usage ?? {}) as Record<string, unknown>;
          inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
          outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
          if (parsed.is_error === true) {
            throw new LlmError(
              'PROVIDER_UNAVAILABLE',
              String(parsed.result ?? parsed.error ?? 'Claude Code returned an error'),
            );
          }
          continue;
        }
      }

      const exitCode = await new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.once('close', (code) => resolve(code));
      });

      if (exitCode !== 0 && !accumulatedText.trim()) {
        throw new LlmError(
          'PROVIDER_UNAVAILABLE',
          `Claude Code CLI exited with code ${String(exitCode)}: ${stderrBuf.trim() || 'Run `claude login` in your terminal to authenticate.'}`,
        );
      }

      if (thinkingText) {
        yield {
          type: 'thinking',
          text: thinkingText,
          startedAt: thinkingStartedAt,
          durationMs: Math.max(0, Date.now() - turnStartMs),
          done: true,
        };
      }

      const { cleanText, toolCalls } = extractToolCallsFromText(accumulatedText);
      if (cleanText !== accumulatedText) {
        yield { type: 'text-delta', text: cleanText, replace: true };
      }

      for (const tc of toolCalls) {
        yield { type: 'tool-call', call: tc };
      }

      if (inputTokens > 0 || outputTokens > 0) {
        yield { type: 'usage', inputTokens, outputTokens };
      }

      yield {
        type: 'finish',
        reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
      };
    } finally {
      signal.removeEventListener('abort', onAbort);
      rl.close();
      try {
        if (child.exitCode === null) child.kill();
      } catch {
        // ignore
      }
    }
  }
}
