import { Injectable } from '@nestjs/common';
import { normalizeVaultPath, type ToolArgsOf } from '@robdev/shared';
import { VaultService } from '../../vault/vault.service.js';
import type { ToolContext, ToolHandler, ToolResult } from './tool-context.js';

@Injectable()
export class VaultUpdateDocumentTool implements ToolHandler<'vault_update_document'> {
  readonly name = 'vault_update_document' as const;

  constructor(private readonly vault: VaultService) {}

  async execute(
    args: ToolArgsOf<'vault_update_document'>,
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
      select: { id: true },
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

    const updated = await this.vault.save(
      ctx.studioId,
      doc.id,
      { markdown: args.markdown },
      {
        kind: 'AGENT',
        agentId: ctx.agent.id,
        reason: args.reason,
        label: ctx.userFacingAgentName,
      },
    );

    const bytes = Buffer.byteLength(args.markdown, 'utf8');
    await ctx.log.entry(
      'SYSTEM',
      `Updated vault document: ${updated.path} (v${updated.version})`,
      {
        createdArtifact: {
          kind: 'vault_doc',
          id: doc.id,
          path: updated.path,
          title: updated.title,
          language: 'markdown',
          content: args.markdown.slice(0, 12000),
          bytes,
          version: updated.version,
        },
      },
    );

    return {
      payload: {
        ok: true,
        path: updated.path,
        version: updated.version,
      },
    };
  }
}
