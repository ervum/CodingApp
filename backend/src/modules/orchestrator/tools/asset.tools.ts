import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { AssetsService } from '../../assets/assets.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class AssetRegisterTool implements ToolHandler<'asset_register'> {
  readonly name = 'asset_register' as const;

  constructor(private readonly assets: AssetsService) {}

  async execute(
    args: ToolArgsOf<'asset_register'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const asset = await this.assets.create(
      ctx.studioId,
      {
        kind: args.kind,
        name: args.name,
        notes: args.notes ?? '',
        robloxAssetId: args.robloxAssetId ?? null,
        mediaId: args.mediaId ?? null,
        tags: args.tags ?? [],
      },
      ctx.agent.id,
    );

    return {
      payload: {
        ok: true,
        asset,
      },
    };
  }
}

@Injectable()
export class AssetSearchTool implements ToolHandler<'asset_search'> {
  readonly name = 'asset_search' as const;

  constructor(private readonly assets: AssetsService) {}

  async execute(
    args: ToolArgsOf<'asset_search'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const items = await this.assets.list(ctx.studioId, {
      q: args.query,
      kind: args.kind,
    });
    const limited = items.slice(0, args.limit ?? 10);
    return {
      payload: {
        ok: true,
        count: limited.length,
        assets: limited,
      },
    };
  }
}
