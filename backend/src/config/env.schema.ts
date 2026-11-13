import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
  .pipe(z.boolean());

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  FRONTEND_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  ALLOW_REGISTRATION: bool.default(true),
  COOKIE_SECURE: bool.default(false),
  SECRETS_MASTER_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'Must be base64 of 32 bytes'),
  MEDIA_URL_SIGNING_SECRET: z.string().min(32),
  ORCHESTRATOR_AUTOSTART: bool.default(true),
  ORCHESTRATOR_TICK_MS: z.coerce.number().int().min(500).default(2000),
  MAX_CONCURRENT_RUNS_PER_STUDIO: z.coerce.number().int().min(1).max(15).default(4),
  AGENT_MAX_TOOL_ITERATIONS: z.coerce.number().int().min(1).max(60).default(30),
  AGENT_RUN_TIMEOUT_MS: z.coerce.number().int().min(30_000).default(1_200_000),
  VAULT_TOKEN_BUDGET: z.coerce.number().int().min(2000).default(24_000),
  MEDIA_STORAGE_ROOT: z.string().default('./storage/media'),
  VAULT_DISK_ROOT: z.string().default('./vault'),
  VAULT_DISK_SYNC: bool.default(true),
  MARKET_INGEST_ENABLED: bool.default(true),
  MARKET_INGEST_CRON: z.string().default('*/30 * * * *'),
  MARKET_INGEST_ON_BOOT: bool.default(true),
  ROBLOX_REQUESTS_PER_SECOND: z.coerce.number().min(0.2).max(5).default(1),
  ROBLOX_USER_AGENT: z.string().min(5),
});

export type Env = z.infer<typeof EnvSchema>;
