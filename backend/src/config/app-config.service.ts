import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema.js';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get nodeEnv(): Env['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get frontendOrigin(): string {
    return this.config.get('FRONTEND_ORIGIN', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get jwtAccessSecret(): string {
    return this.config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  get jwtAccessTtlSeconds(): number {
    return this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }

  get refreshTokenTtlDays(): number {
    return this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
  }

  get allowRegistration(): boolean {
    return this.config.get('ALLOW_REGISTRATION', { infer: true });
  }

  get cookieSecure(): boolean {
    return this.config.get('COOKIE_SECURE', { infer: true });
  }

  get secretsMasterKey(): string {
    return this.config.get('SECRETS_MASTER_KEY', { infer: true });
  }

  get mediaUrlSigningSecret(): string {
    return this.config.get('MEDIA_URL_SIGNING_SECRET', { infer: true });
  }

  get orchestratorAutostart(): boolean {
    return this.config.get('ORCHESTRATOR_AUTOSTART', { infer: true });
  }

  get orchestratorTickMs(): number {
    return this.config.get('ORCHESTRATOR_TICK_MS', { infer: true });
  }

  get maxConcurrentRunsPerStudio(): number {
    return this.config.get('MAX_CONCURRENT_RUNS_PER_STUDIO', { infer: true });
  }

  get agentMaxToolIterations(): number {
    return this.config.get('AGENT_MAX_TOOL_ITERATIONS', { infer: true });
  }

  get agentRunTimeoutMs(): number {
    return this.config.get('AGENT_RUN_TIMEOUT_MS', { infer: true });
  }

  get vaultTokenBudget(): number {
    return this.config.get('VAULT_TOKEN_BUDGET', { infer: true });
  }

  get mediaStorageRoot(): string {
    return this.config.get('MEDIA_STORAGE_ROOT', { infer: true });
  }

  get vaultDiskRoot(): string {
    return this.config.get('VAULT_DISK_ROOT', { infer: true });
  }

  get vaultDiskSync(): boolean {
    return this.config.get('VAULT_DISK_SYNC', { infer: true });
  }

  get marketIngestEnabled(): boolean {
    return this.config.get('MARKET_INGEST_ENABLED', { infer: true });
  }

  get marketIngestCron(): string {
    return this.config.get('MARKET_INGEST_CRON', { infer: true });
  }

  get marketIngestOnBoot(): boolean {
    return this.config.get('MARKET_INGEST_ON_BOOT', { infer: true });
  }

  get robloxRequestsPerSecond(): number {
    return this.config.get('ROBLOX_REQUESTS_PER_SECOND', { infer: true });
  }

  get robloxUserAgent(): string {
    return this.config.get('ROBLOX_USER_AGENT', { infer: true });
  }
}
