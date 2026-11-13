import { Module } from '@nestjs/common';
import { AntigravityAdapter } from './adapters/antigravity.adapter.js';
import { AnthropicAdapter } from './adapters/anthropic.adapter.js';
import { ChatGptWebBrowserAdapter } from './adapters/chatgpt-web.adapter.js';
import { ClaudeCodeAdapter } from './adapters/claude-code.adapter.js';
import { ClaudeWebBrowserAdapter } from './adapters/claude-web.adapter.js';
import { CodexCliAdapter } from './adapters/codex-cli.adapter.js';
import { GoogleWebBrowserAdapter } from './adapters/google-web.adapter.js';
import { GoogleAdapter } from './adapters/google.adapter.js';
import { OpenAiCompatibleAdapter } from './adapters/openai-compatible.adapter.js';
import { GoogleImagesAdapter } from './image/google-images.adapter.js';
import { LocalSvgImagesAdapter } from './image/local-svg-images.adapter.js';
import { OpenAiImagesAdapter } from './image/openai-images.adapter.js';
import { LlmAdapterFactory } from './llm-adapter.factory.js';
import { LlmConnectionsController } from './llm-connections.controller.js';
import { LlmConnectionsService } from './llm-connections.service.js';
import { LocalAiService } from './local-ai.service.js';
import { LocalRuntimeDiscoveryService } from './local-runtime-discovery.service.js';
import { RunpodService } from './runpod.service.js';

@Module({
  controllers: [LlmConnectionsController],
  providers: [
    OpenAiCompatibleAdapter,
    AnthropicAdapter,
    GoogleAdapter,
    GoogleWebBrowserAdapter,
    ClaudeWebBrowserAdapter,
    ChatGptWebBrowserAdapter,
    CodexCliAdapter,
    ClaudeCodeAdapter,
    AntigravityAdapter,
    LocalRuntimeDiscoveryService,
    OpenAiImagesAdapter,
    GoogleImagesAdapter,
    LocalSvgImagesAdapter,
    LocalAiService,
    RunpodService,
    LlmAdapterFactory,
    LlmConnectionsService,
  ],
  exports: [
    LlmAdapterFactory,
    LlmConnectionsService,
    GoogleWebBrowserAdapter,
    ClaudeWebBrowserAdapter,
    ChatGptWebBrowserAdapter,
    LocalRuntimeDiscoveryService,
  ],
})
export class LlmModule {}
