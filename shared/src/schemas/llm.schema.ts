import { z } from 'zod';

export const CreateLlmConnectionSchema = z.object({
  provider: z.enum([
    'OPENAI',
    'ANTHROPIC',
    'GOOGLE',
    'GOOGLE_WEB',
    'CLAUDE_WEB',
    'CHATGPT_WEB',
    'GEMINI_APP',
    'CLAUDE_APP',
    'GPT_APP',
    'ANTIGRAVITY',
    'CLAUDE_CODE',
    'CODEX',
    'XAI',
    'OLLAMA',
    'RUNPOD',
    'OPENAI_COMPATIBLE',
  ]),
  label: z.string().trim().min(2).max(60),
  baseUrl: z.string().trim().min(1).max(500).nullable().default(null),
  apiKey: z.string().min(4).max(400).nullable().default(null),
  inputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
  outputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
}).superRefine((v, ctx) => {
  const needsKey = ['OPENAI', 'ANTHROPIC', 'GOOGLE', 'XAI'].includes(v.provider);
  if (needsKey && !v.apiKey) {
    ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'API key required for this provider' });
  }
  if ((v.provider === 'OPENAI_COMPATIBLE' || v.provider === 'RUNPOD') && !v.baseUrl) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Base URL required' });
  }
});
export type CreateLlmConnectionRequest = z.infer<typeof CreateLlmConnectionSchema>;

export const UpdateLlmConnectionSchema = z.object({
  label: z.string().trim().min(2).max(60).optional(),
  baseUrl: z.string().trim().min(1).max(500).nullable().optional(),
  apiKey: z.string().min(4).max(400).optional(),
  isEnabled: z.boolean().optional(),
  inputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
  outputCostPerMTok: z.number().min(0).max(1000).nullable().optional(),
});
export type UpdateLlmConnectionRequest = z.infer<typeof UpdateLlmConnectionSchema>;

export const PullLocalModelSchema = z.object({
  model: z.string().trim().min(2).max(120),
});
export type PullLocalModelRequest = z.infer<typeof PullLocalModelSchema>;

export const RunpodPodActionSchema = z.object({
  podId: z.string().trim().min(4).max(64),
  action: z.enum(['RESUME', 'STOP']),
  port: z.coerce.number().int().min(1).max(65535).default(8000),
});
export type RunpodPodActionRequest = z.infer<typeof RunpodPodActionSchema>;

export const SetBrowserVisibilitySchema = z.object({
  visible: z.boolean(),
});
export type SetBrowserVisibilityRequest = z.infer<typeof SetBrowserVisibilitySchema>;
