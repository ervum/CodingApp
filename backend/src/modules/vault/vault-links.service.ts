import { Injectable } from '@nestjs/common';
import { normalizeVaultPath } from '@robdev/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { extractAndResolveVaultLinks } from './vault-links.core.js';

@Injectable()
export class VaultLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async reindex(
    studioId: string,
    doc: { id: string; path: string; title: string; markdown: string },
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = tx ?? this.prisma;

    const allDocs = await db.vaultDocument.findMany({
      where: { studioId },
      select: { id: true, path: true, title: true },
    });

    await db.vaultLink.deleteMany({
      where: { fromDocumentId: doc.id },
    });

    const resolvedLinks = extractAndResolveVaultLinks(doc.markdown, allDocs);
    if (resolvedLinks.length > 0) {
      await db.vaultLink.createMany({
        data: resolvedLinks.map((link) => ({
          fromDocumentId: doc.id,
          toDocumentId: link.toDocumentId,
          targetPath: link.targetPath,
        })),
      });
    }

    // Re-resolve any unresolved links across the studio that match this doc's path or title
    const normalizedTitlePath = normalizeVaultPath(doc.title).toLowerCase();
    const docPathLower = doc.path.toLowerCase();

    const unresolved = await db.vaultLink.findMany({
      where: {
        toDocumentId: null,
        fromDocument: { studioId },
      },
      select: { id: true, targetPath: true },
    });

    const matchingIds = unresolved
      .filter((u) => {
        const tp = u.targetPath.toLowerCase();
        return tp === docPathLower || tp === normalizedTitlePath;
      })
      .map((u) => u.id);

    if (matchingIds.length > 0) {
      await db.vaultLink.updateMany({
        where: { id: { in: matchingIds } },
        data: { toDocumentId: doc.id },
      });
    }
  }
}
