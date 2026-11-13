import { Injectable } from '@nestjs/common';
import type { LlmProvider } from '@robdev/shared';
import { AntigravityAdapter } from './adapters/antigravity.adapter.js';
import { AnthropicAdapter } from './adapters/anthropic.adapter.js';
import { ChatGptWebBrowserAdapter } from './adapters/chatgpt-web.adapter.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter.js';
import { ClaudeWebBrowserAdapter } from './adapters/claude-web.adapter.js';
import { CodexCliAdapter } from './adapters/codex-cli.adapter.js';
import { GoogleWebBrowserAdapter } from './adapters/google-web.adapter.js';
import { GoogleAdapter } from './adapters/google.adapter.js';
import {
  type BoundLlmAdapter,
  type LlmAdapter,
  type LlmStreamRequest,
  type ResolvedConnection,
} from './adapters/llm-adapter.interface.js';
import { OpenAiCompatibleAdapter } from './adapters/openai-compatible.adapter.js';
import { GoogleImagesAdapter } from './image/google-images.adapter.js';
import type {
  ImageAdapter,
  ImageGenerateRequest,
  ImageGenerateResult,
} from './image/image-adapter.interface.js';
import { LocalSvgImagesAdapter } from './image/local-svg-images.adapter.js';
import { OpenAiImagesAdapter } from './image/openai-images.adapter.js';

@Injectable()
export class LlmAdapterFactory {
  constructor(
    private readonly openai: OpenAiCompatibleAdapter,
    private readonly anthropic: AnthropicAdapter,
    private readonly google: GoogleAdapter,
    private readonly googleWeb: GoogleWebBrowserAdapter,
    private readonly openaiImages: OpenAiImagesAdapter,
    private readonly googleImages: GoogleImagesAdapter,
    private readonly localSvgImages: LocalSvgImagesAdapter,
    private readonly claudeWeb?: ClaudeWebBrowserAdapter,
    private readonly chatgptWeb?: ChatGptWebBrowserAdapter,
    private readonly codexCli?: CodexCliAdapter,
    private readonly claudeCode?: ClaudeCodeAdapter,
    private readonly antigravity?: AntigravityAdapter,
  ) {}

  getAdapter(provider: LlmProvider): LlmAdapter {
    switch (provider) {
      case 'ANTHROPIC':
        return this.anthropic;
      case 'GOOGLE':
        return this.google;
      case 'GOOGLE_WEB':
      case 'GEMINI_APP':
        return this.googleWeb;
      case 'CLAUDE_WEB':
      case 'CLAUDE_APP':
        return this.claudeWeb ?? this.googleWeb;
      case 'CHATGPT_WEB':
      case 'GPT_APP':
        return this.chatgptWeb ?? this.googleWeb;
      case 'CODEX':
        return this.codexCli ?? this.openai;
      case 'CLAUDE_CODE':
        return this.claudeCode ?? this.anthropic;
      case 'ANTIGRAVITY':
        return this.antigravity ?? this.googleWeb;
      case 'OPENAI':
      case 'XAI':
      case 'OLLAMA':
      case 'RUNPOD':
      case 'OPENAI_COMPATIBLE':
        return this.openai;
    }
  }

  forConnection(conn: ResolvedConnection): BoundLlmAdapter {
    const adapter = this.getAdapter(conn.provider);
    return {
      listModels: () => adapter.listModels(conn),
      stream: (req: LlmStreamRequest, signal: AbortSignal) => adapter.stream(conn, req, signal),
    };
  }

  getImageAdapter(provider: LlmProvider): ImageAdapter {
    switch (provider) {
      case 'GOOGLE':
        return this.googleImages;
      case 'OPENAI':
      case 'XAI':
        return this.openaiImages;
      case 'GOOGLE_WEB':
      case 'GEMINI_APP':
      case 'CLAUDE_WEB':
      case 'CLAUDE_APP':
      case 'CHATGPT_WEB':
      case 'GPT_APP':
      case 'ANTIGRAVITY':
      case 'CLAUDE_CODE':
      case 'CODEX':
      case 'OLLAMA':
      case 'RUNPOD':
      case 'OPENAI_COMPATIBLE':
      case 'ANTHROPIC':
        return this.localSvgImages;
    }
  }

  forImageConnection(conn: ResolvedConnection): {
    generate: (req: ImageGenerateRequest, signal: AbortSignal) => Promise<ImageGenerateResult>;
  } {
    const adapter = this.getImageAdapter(conn.provider);
    return {
      generate: (req: ImageGenerateRequest, signal: AbortSignal) =>
        adapter.generate(conn, req, signal),
    };
  }
}
