import type { LlmProvider } from '@robdev/shared';

export const DEFAULT_BASE_URL: Record<LlmProvider, string | null> = {
  OPENAI: 'https://api.openai.com/v1',
  XAI: 'https://api.x.ai/v1',
  OLLAMA: 'http://localhost:11434/v1',
  GOOGLE_WEB: 'https://gemini.google.com/app',
  CLAUDE_WEB: 'https://claude.ai/new',
  CHATGPT_WEB: 'https://chatgpt.com',
  GEMINI_APP: 'gemini-app://local',
  CLAUDE_APP: 'claude-app://local',
  GPT_APP: 'gpt-app://local',
  ANTIGRAVITY: 'antigravity://local',
  CLAUDE_CODE: 'claude-code://local',
  CODEX: 'codex://local',
  RUNPOD: null,
  OPENAI_COMPATIBLE: null,
  ANTHROPIC: null,
  GOOGLE: null,
};

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  OPENAI: 'OpenAI API',
  ANTHROPIC: 'Anthropic API',
  GOOGLE: 'Google Gemini API',
  GOOGLE_WEB: 'Google AI Subscription (Browser Session)',
  CLAUDE_WEB: 'Claude Web (Browser Session)',
  CHATGPT_WEB: 'ChatGPT Web (Browser Session)',
  GEMINI_APP: 'Gemini Desktop App',
  CLAUDE_APP: 'Claude Desktop App',
  GPT_APP: 'ChatGPT Desktop App (GPT App)',
  ANTIGRAVITY: 'Antigravity (IDE / Agent CLI)',
  CLAUDE_CODE: 'Claude Code (CLI Agent)',
  CODEX: 'OpenAI Codex (CLI Agent)',
  XAI: 'xAI Grok API',
  OLLAMA: 'Local AI (Ollama / LM Studio / llama.cpp)',
  RUNPOD: 'RunPod / Cloud GPU Server',
  OPENAI_COMPATIBLE: 'OpenAI-compatible Endpoint',
};
