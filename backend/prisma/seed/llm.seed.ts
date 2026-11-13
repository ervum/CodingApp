import type { LlmProvider } from '@robdev/shared';
import type { LlmConnection, PrismaClient } from '../../src/generated/prisma/client.js';
import { createSecretBox } from '../../src/common/crypto/secret-box.service.js';
import type { SeededStudioContext } from './studios.seed.js';

export interface SeededLlmBinding {
  provider: LlmProvider;
  modelId: string;
}

export async function seedLlmConnections(
  prisma: PrismaClient,
  studioCtx: SeededStudioContext,
): Promise<SeededLlmBinding | null> {
  const masterKey = process.env['SECRETS_MASTER_KEY'];
  const secretBox = masterKey ? createSecretBox(masterKey) : null;

  const envSpecs: ReadonlyArray<{
    envVar: string;
    provider: LlmProvider;
    label: string;
    isUrl?: boolean;
  }> = [
    { envVar: 'OPENAI_API_KEY', provider: 'OPENAI', label: 'OpenAI' },
    { envVar: 'ANTHROPIC_API_KEY', provider: 'ANTHROPIC', label: 'Anthropic' },
    { envVar: 'GEMINI_API_KEY', provider: 'GOOGLE', label: 'Google Gemini' },
    { envVar: 'XAI_API_KEY', provider: 'XAI', label: 'xAI Grok' },
    { envVar: 'OLLAMA_BASE_URL', provider: 'OLLAMA', label: 'Ollama (local)', isUrl: true },
  ];

  const createdByLabel = new Map<string, LlmConnection>();

  for (const spec of envSpecs) {
    const raw = process.env[spec.envVar]?.trim();
    if (!raw) continue;

    if (spec.isUrl) {
      const conn = await prisma.llmConnection.create({
        data: {
          studioId: studioCtx.inclined.id,
          provider: spec.provider,
          label: spec.label,
          baseUrl: raw,
          isEnabled: true,
        },
      });
      createdByLabel.set(spec.label, conn);
    } else if (secretBox) {
      const sealed = secretBox.seal(raw);
      const conn = await prisma.llmConnection.create({
        data: {
          studioId: studioCtx.inclined.id,
          provider: spec.provider,
          label: spec.label,
          apiKeyCiphertext: sealed.ciphertext,
          apiKeyIv: sealed.iv,
          apiKeyTag: sealed.tag,
          apiKeyLast4: raw.slice(-4),
          isEnabled: true,
        },
      });
      createdByLabel.set(spec.label, conn);
    }
  }

  const bindLabel = process.env['SEED_LLM_CONNECTION']?.trim();
  const bindModel = process.env['SEED_LLM_MODEL']?.trim();

  if (bindLabel && bindModel) {
    const conn = createdByLabel.get(bindLabel);
    if (conn) {
      await prisma.agent.updateMany({
        where: { studioId: studioCtx.inclined.id },
        data: {
          llmConnectionId: conn.id,
          modelId: bindModel,
          temperature: 0.4,
          maxOutputTokens: 4096,
        },
      });
      return { provider: conn.provider, modelId: bindModel };
    }
  }

  const defaultWebConn = await prisma.llmConnection.create({
    data: {
      studioId: studioCtx.inclined.id,
      provider: 'GOOGLE_WEB',
      label: 'Google Gemini Web / AI Studio',
      baseUrl: 'https://gemini.google.com/app',
      isEnabled: true,
    },
  });
  const defaultModelId = 'gemini-web:3.8-flash?thinking=medium';
  await prisma.agent.updateMany({
    where: { studioId: studioCtx.inclined.id },
    data: {
      llmConnectionId: defaultWebConn.id,
      modelId: defaultModelId,
      temperature: 0.4,
      maxOutputTokens: 4096,
    },
  });

  return { provider: 'GOOGLE_WEB', modelId: defaultModelId };
}
