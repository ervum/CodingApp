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

export const CODEX_CLI_MODELS: LlmModelInfoDto[] = [
  {
    id: 'codex-default',
    displayName: 'Codex Default (Auto)',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gpt-5.3-codex',
    displayName: 'GPT-5.3 Codex (Agentic Coding)',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gpt-5.2-codex',
    displayName: 'GPT-5.2 Codex',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gpt-5.4',
    displayName: 'GPT-5.4 (via Codex CLI)',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'gpt-5.4-mini',
    displayName: 'GPT-5.4 Mini (via Codex CLI)',
    contextWindow: 400_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'o3',
    displayName: 'OpenAI o3 (via Codex CLI)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
  {
    id: 'o4-mini',
    displayName: 'OpenAI o4-mini (via Codex CLI)',
    contextWindow: 200_000,
    supportsTools: true,
    supportsImageOutput: false,
  },
];

@Injectable()
export class CodexCliAdapter implements LlmAdapter {
  private readonly logger = new Logger(CodexCliAdapter.name);

  constructor(private readonly discovery: LocalRuntimeDiscoveryService) {}

  bind(connection: ResolvedConnection): BoundLlmAdapter {
    return {
      listModels: () => this.listModels(connection),
      stream: (req, signal) => this.stream(connection, req, signal),
    };
  }

  async listModels(connection: ResolvedConnection): Promise<LlmModelInfoDto[]> {
    const bin = await this.discovery.resolveExecutable(LlmProvider.CODEX, connection.baseUrl);
    if (!bin) {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        'OpenAI Codex CLI (codex.exe) was not found on this machine. Install @openai/codex or the OpenAI Codex Windows app, or set the executable path in Base URL.',
      );
    }
    return CODEX_CLI_MODELS;
  }

  async *stream(
    connection: ResolvedConnection,
    req: LlmStreamRequest,
    signal: AbortSignal,
  ): AsyncIterable<LlmStreamEvent> {
    const bin = await this.discovery.resolveExecutable(LlmProvider.CODEX, connection.baseUrl);
    if (!bin) {
      throw new LlmError(
        'PROVIDER_UNAVAILABLE',
        'OpenAI Codex CLI (codex.exe) was not found on this machine.',
      );
    }

    const hasTools = req.tools.length > 0;
    const bridgedMessages = injectToolsIntoMessages(req.messages, req.tools);
    const basePrompt = formatSinglePromptForWebUi(bridgedMessages, hasTools);
    const fullPrompt = [
      'IMPORTANT RUNTIME DIRECTIVE: You are executing inside the RobDev Control Room multi-agent orchestrator.',
      'Do NOT attempt to run local shell commands yourself. Answer directly in text and invoke any needed RobDev studio tools strictly by emitting <tool_call>{"name": "...", "arguments": {...}}</tool_call> XML blocks in your response.',
      '',
      basePrompt,
    ].join('\n');

    const rawModel = (req.model || '').trim();
    const cleanModel = rawModel.split(':')[0] ?? '';
    const args: string[] = [
      ...(bin.argsPrefix ?? []),
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-s',
      'read-only',
    ];
    if (
      cleanModel &&
      cleanModel !== 'codex-default' &&
      cleanModel !== 'auto' &&
      !cleanModel.startsWith('gemini-') &&
      !cleanModel.startsWith('claude-')
    ) {
      args.push('-m', cleanModel);
    }
    args.push('-'); // Read prompt from stdin

    yield {
      type: 'status',
      statusText: `Launching OpenAI Codex CLI (${cleanModel || 'default'})...`,
    };

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (connection.apiKey) {
      env.OPENAI_API_KEY = connection.apiKey;
    }

    const child = spawn(bin.executablePath, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
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
          // Plain text fallback line
          accumulatedText += (accumulatedText ? '\n' : '') + trimmed;
          yield { type: 'text-delta', text: accumulatedText, replace: true };
          continue;
        }

        const evType = String(parsed.type ?? '');
        if (evType === 'thread.started' || evType === 'turn.started') {
          yield {
            type: 'status',
            statusText: 'Codex agent reasoning...',
          };
          continue;
        }

        if (evType === 'item.started' || evType === 'item.updated' || evType === 'item.completed') {
          const item = (parsed.item ?? {}) as Record<string, unknown>;
          const itemType = String(item.type ?? '');

          if (itemType === 'reasoning') {
            const text = String(item.text ?? item.summary ?? '');
            if (text) {
              thinkingText = text;
              yield {
                type: 'thinking',
                text: thinkingText,
                startedAt: thinkingStartedAt,
                durationMs: Math.max(0, Date.now() - turnStartMs),
                done: evType === 'item.completed',
              };
            }
          } else if (itemType === 'agent_message' || itemType === 'message') {
            const msgText = this.extractItemText(item);
            if (msgText) {
              if (evType === 'item.completed') {
                accumulatedText = accumulatedText
                  ? accumulatedText.includes(msgText)
                    ? accumulatedText
                    : `${accumulatedText}\n${msgText}`
                  : msgText;
              } else {
                accumulatedText = msgText;
              }
              const preview = extractToolCallsFromText(accumulatedText);
              if (preview.cleanText) {
                yield { type: 'text-delta', text: preview.cleanText, replace: true };
              }
            }
          }
          continue;
        }

        if (evType === 'turn.completed') {
          const usage = (parsed.usage ?? {}) as Record<string, unknown>;
          inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0) || 0;
          outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0) || 0;
          continue;
        }

        if (evType === 'error' || evType === 'turn.failed') {
          const errMsg = String(
            parsed.message ??
              (parsed.error as Record<string, unknown> | undefined)?.message ??
              'Codex CLI execution failed',
          );
          throw new LlmError('PROVIDER_UNAVAILABLE', errMsg);
        }
      }

      const exitCode = await new Promise<number | null>((resolve) => {
        if (child.exitCode !== null) return resolve(child.exitCode);
        child.once('close', (code) => resolve(code));
      });

      if (exitCode !== 0 && !accumulatedText.trim()) {
        throw new LlmError(
          'PROVIDER_UNAVAILABLE',
          `Codex CLI exited with code ${String(exitCode)}: ${stderrBuf.trim() || 'No output received'}`,
        );
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

  private extractItemText(item: Record<string, unknown>): string {
    if (typeof item.text === 'string' && item.text.length > 0) {
      return item.text;
    }
    if (Array.isArray(item.content)) {
      return item.content
        .map((c: unknown) => {
          if (typeof c === 'string') return c;
          if (c && typeof c === 'object' && 'text' in c && typeof (c as { text: unknown }).text === 'string') {
            return (c as { text: string }).text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }
    return '';
  }
}
