import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { MarketService } from '../../market/market.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class MarketQueryTool implements ToolHandler<'market_query'> {
  readonly name = 'market_query' as const;

  constructor(private readonly market: MarketService) {}

  async execute(
    args: ToolArgsOf<'market_query'>,
    _ctx: ToolContext,
  ): Promise<ToolResult> {
    const lb = await this.market.leaderboard({
      sort: args.sort,
      genre: args.genre ?? undefined,
      limit: args.limit,
    });

    const rows = lb.rows.map((r) => ({
      rank: r.rank,
      name: r.name,
      universeId: r.universeId,
      genre: r.genre,
      playing: r.playing,
      delta7dPct: r.delta7dPct,
      likeRatio: r.likeRatio,
    }));

    return {
      payload: {
        ok: true,
        sort: lb.sort,
        capturedAt: lb.capturedAt,
        source: lb.source,
        rows,
      },
    };
  }
}
