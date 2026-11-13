import { Injectable } from '@nestjs/common';
import type { MarketSortId } from '@robdev/shared';
import { AppConfigService } from '../../../config/app-config.service.js';
import { TokenBucketRateLimiter } from './rate-limiter.js';
import {
  GamesResponse,
  IconsResponse,
  SortContentResponse,
  SortsResponse,
  VotesResponse,
  type GamesResponseData,
  type IconsResponseData,
  type SortsResponseData,
  type VotesResponseData,
} from './roblox-schemas.js';

export interface RobloxCallContext {
  onRequest: () => void;
}

@Injectable()
export class RobloxClient {
  private readonly limiter: TokenBucketRateLimiter;

  constructor(private readonly cfg: AppConfigService) {
    this.limiter = new TokenBucketRateLimiter(cfg.robloxRequestsPerSecond, 2);
  }

  async getSorts(
    sessionId: string,
    ctx: RobloxCallContext,
  ): Promise<{ ok: true; data: SortsResponseData } | { ok: false; reason: 'http' | 'parse' }> {
    const url = `https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${encodeURIComponent(sessionId)}&device=computer&country=all`;
    const raw = await this.fetchJson(url, ctx);
    if (!raw.ok) return { ok: false, reason: 'http' };
    const parsed = SortsResponse.safeParse(raw.json);
    if (!parsed.success) return { ok: false, reason: 'parse' };
    return { ok: true, data: parsed.data };
  }

  async getSortContent(
    sessionId: string,
    sortId: MarketSortId,
    ctx: RobloxCallContext,
  ): Promise<{ ok: true; universeIds: string[] } | { ok: false; reason: 'http' | 'parse' }> {
    const url = `https://apis.roblox.com/explore-api/v1/get-sort-content?sessionId=${encodeURIComponent(sessionId)}&sortId=${encodeURIComponent(sortId)}&device=computer&country=all`;
    const raw = await this.fetchJson(url, ctx);
    if (!raw.ok) return { ok: false, reason: 'http' };
    const parsed = SortContentResponse.safeParse(raw.json);
    if (!parsed.success) return { ok: false, reason: 'parse' };
    return { ok: true, universeIds: parsed.data.slice(0, 100) };
  }

  async getGames(
    universeIds: string[],
    ctx: RobloxCallContext,
  ): Promise<GamesResponseData['data']> {
    const out: GamesResponseData['data'] = [];
    for (const chunk of this.chunkIds(universeIds, 50)) {
      const url = `https://games.roblox.com/v1/games?universeIds=${chunk.join(',')}`;
      const raw = await this.fetchJson(url, ctx);
      if (raw.ok) {
        const parsed = GamesResponse.safeParse(raw.json);
        if (parsed.success) {
          out.push(...parsed.data.data);
        }
      }
    }
    return out;
  }

  async getVotes(
    universeIds: string[],
    ctx: RobloxCallContext,
  ): Promise<VotesResponseData['data']> {
    const out: VotesResponseData['data'] = [];
    for (const chunk of this.chunkIds(universeIds, 50)) {
      const url = `https://games.roblox.com/v1/games/votes?universeIds=${chunk.join(',')}`;
      const raw = await this.fetchJson(url, ctx);
      if (raw.ok) {
        const parsed = VotesResponse.safeParse(raw.json);
        if (parsed.success) {
          out.push(...parsed.data.data);
        }
      }
    }
    return out;
  }

  async getIcons(
    universeIds: string[],
    ctx: RobloxCallContext,
  ): Promise<IconsResponseData['data']> {
    const out: IconsResponseData['data'] = [];
    for (const chunk of this.chunkIds(universeIds, 50)) {
      const url = `https://thumbnails.roblox.com/v1/games/icons?universeIds=${chunk.join(',')}&returnPolicy=PlaceHolder&size=150x150&format=Png&isCircular=false`;
      const raw = await this.fetchJson(url, ctx);
      if (raw.ok) {
        const parsed = IconsResponse.safeParse(raw.json);
        if (parsed.success) {
          out.push(...parsed.data.data);
        }
      }
    }
    return out;
  }

  private async fetchJson(
    url: string,
    ctx: RobloxCallContext,
  ): Promise<{ ok: true; json: unknown } | { ok: false }> {
    const maxRetries = 4;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.limiter.acquire();
      ctx.onRequest();

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': this.cfg.robloxUserAgent,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
          const json: unknown = await res.json();
          return { ok: true, json };
        }

        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const retryAfter = res.headers.get('retry-after');
          const retrySec = retryAfter ? Number(retryAfter) : Number.NaN;
          const baseMs =
            Number.isFinite(retrySec) && retrySec > 0
              ? retrySec * 1000
              : 2000 * Math.pow(2, attempt);
          const jitter = 0.75 + Math.random() * 0.5;
          await new Promise<void>((r) => setTimeout(r, Math.round(baseMs * jitter)));
          continue;
        }

        return { ok: false };
      } catch {
        if (attempt < maxRetries) {
          const baseMs = 2000 * Math.pow(2, attempt);
          const jitter = 0.75 + Math.random() * 0.5;
          await new Promise<void>((r) => setTimeout(r, Math.round(baseMs * jitter)));
          continue;
        }
        return { ok: false };
      }
    }
    return { ok: false };
  }

  private chunkIds(ids: string[], size: number): string[][] {
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += size) {
      chunks.push(ids.slice(i, i + size));
    }
    return chunks;
  }
}
