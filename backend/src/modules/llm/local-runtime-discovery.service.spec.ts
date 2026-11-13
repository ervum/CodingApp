import { describe, expect, it } from 'vitest';
import { LlmProvider } from '@robdev/shared';
import { LocalRuntimeDiscoveryService } from './local-runtime-discovery.service.js';
import { CodexCliAdapter, CODEX_CLI_MODELS } from './adapters/codex-cli.adapter.js';
import { ClaudeCodeAdapter, CLAUDE_CODE_MODELS } from './adapters/claude-code.adapter.js';
import { AntigravityAdapter, ANTIGRAVITY_MODELS } from './adapters/antigravity.adapter.js';
import { ClaudeWebBrowserAdapter, CLAUDE_WEB_MODELS, CLAUDE_APP_MODELS } from './adapters/claude-web.adapter.js';
import { ChatGptWebBrowserAdapter, CHATGPT_WEB_MODELS, GPT_APP_MODELS } from './adapters/chatgpt-web.adapter.js';

describe('Multi-Platform Agent Execution (8 New Providers)', () => {
  it('discovers all 8 requested platforms via LocalRuntimeDiscoveryService', async () => {
    const discovery = new LocalRuntimeDiscoveryService();
    const runtimes = await discovery.discoverAll(true);

    expect(runtimes).toHaveLength(8);
    const providers = runtimes.map((r) => r.provider);
    expect(providers).toEqual([
      LlmProvider.ANTIGRAVITY,
      LlmProvider.CLAUDE_CODE,
      LlmProvider.CODEX,
      LlmProvider.GEMINI_APP,
      LlmProvider.CLAUDE_APP,
      LlmProvider.GPT_APP,
      LlmProvider.CLAUDE_WEB,
      LlmProvider.CHATGPT_WEB,
    ]);

    for (const rt of runtimes) {
      expect(rt.models.length).toBeGreaterThan(0);
      expect(rt.defaultModel.length).toBeGreaterThan(0);
    }
  });

  it('exposes models for Antigravity, Claude Web, Claude App, ChatGPT Web, and GPT App', async () => {
    const discovery = new LocalRuntimeDiscoveryService();
    const dummyPrisma = {} as never;
    const dummyGoogleWeb = {} as never;
    const claudeCode = new ClaudeCodeAdapter(discovery);
    const codexCli = new CodexCliAdapter(discovery);
    const antigravity = new AntigravityAdapter(discovery, dummyGoogleWeb, claudeCode, codexCli);
    const claudeWeb = new ClaudeWebBrowserAdapter(dummyPrisma, discovery);
    const chatgptWeb = new ChatGptWebBrowserAdapter(dummyPrisma, discovery, codexCli);

    const agyModels = await antigravity.listModels({
      id: '1',
      provider: LlmProvider.ANTIGRAVITY,
      baseUrl: null,
      apiKey: null,
    });
    expect(agyModels).toEqual(ANTIGRAVITY_MODELS);

    const cwModels = await claudeWeb.listModels({
      id: '2',
      provider: LlmProvider.CLAUDE_WEB,
      baseUrl: null,
      apiKey: null,
    });
    expect(cwModels).toEqual(CLAUDE_WEB_MODELS);

    const caModels = await claudeWeb.listModels({
      id: '3',
      provider: LlmProvider.CLAUDE_APP,
      baseUrl: null,
      apiKey: null,
    });
    expect(caModels).toEqual(CLAUDE_APP_MODELS);

    const gwModels = await chatgptWeb.listModels({
      id: '4',
      provider: LlmProvider.CHATGPT_WEB,
      baseUrl: null,
      apiKey: null,
    });
    expect(gwModels).toEqual(CHATGPT_WEB_MODELS);

    const gaModels = await chatgptWeb.listModels({
      id: '5',
      provider: LlmProvider.GPT_APP,
      baseUrl: null,
      apiKey: null,
    });
    expect(gaModels).toEqual(GPT_APP_MODELS);

    expect(CODEX_CLI_MODELS.length).toBeGreaterThan(0);
    expect(CLAUDE_CODE_MODELS.length).toBeGreaterThan(0);
  });
});
