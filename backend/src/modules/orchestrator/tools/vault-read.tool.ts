import { Injectable } from '@nestjs/common';
import { normalizeVaultPath, type ToolArgsOf } from '@robdev/shared';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class VaultReadTool implements ToolHandler<'vault_read'> {
  readonly name = 'vault_read' as const;

  async execute(
    args: ToolArgsOf<'vault_read'>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const rawPath = args.path.trim();
    const normalized = normalizeVaultPath(rawPath);
    const titleCandidate = rawPath.replace(/\.md$/i, '').split('/').pop() ?? rawPath;

    const doc = await ctx.prisma.vaultDocument.findFirst({
      where: {
        studioId: ctx.studioId,
        OR: [
          { path: rawPath },
          { path: normalized },
          { title: { equals: rawPath.replace(/\.md$/i, ''), mode: 'insensitive' } },
          { title: { equals: titleCandidate, mode: 'insensitive' } },
        ],
      },
      select: {
        path: true,
        title: true,
        version: true,
        markdown: true,
      },
    });

    if (!doc) {
      return {
        payload: {
          ok: false,
          error: 'NOT_FOUND',
          message: `Vault document not found: ${args.path}`,
        },
      };
    }

    return {
      payload: {
        ok: true,
        path: doc.path,
        title: doc.title,
        version: doc.version,
        markdown: doc.markdown.slice(0, 60_000),
      },
    };
  }
}
