import { Injectable } from '@nestjs/common';
import type { ToolArgsOf } from '@robdev/shared';
import { VaultSearchService } from '../../vault/vault-search.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class VaultSearchTool implements ToolHandler<'vault_search'> {
  readonly name = 'vault_search' as const;

  constructor(private readonly searchService: VaultSearchService) {}

  async execute(
    args: ToolArgsOf<'vault_search'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const hits = await this.searchService.search(
      ctx.studioId,
      args.query,
      args.limit,
    );
    return {
      payload: {
        ok: true,
        hits,
      },
    };
  }
}
