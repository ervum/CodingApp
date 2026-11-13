import { Injectable } from '@nestjs/common';
import type { VaultSearchHitDto } from '@robdev/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buildVaultSnippet } from './vault-snippet.js';

interface RawSearchRow {
  id: string;
  path: string;
  title: string;
  markdown: string;
  score: number;
}

@Injectable()
export class VaultSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(studioId: string, query: string, limit = 10): Promise<VaultSearchHitDto[]> {
    const q = query.trim();
    if (!q) return [];

    const rows = await this.prisma.$queryRaw<RawSearchRow[]>`
      SELECT
        id,
        path,
        title,
        markdown,
        (
          3 * GREATEST(similarity(title, ${q}), word_similarity(${q}, title))
          + GREATEST(similarity(left(markdown, 20000), ${q}), word_similarity(${q}, left(markdown, 20000)))
          + ts_rank(
              to_tsvector('simple', coalesce(title, '') || ' ' || left(coalesce(markdown, ''), 20000)),
              websearch_to_tsquery('simple', ${q})
            )
        )::float8 AS score
      FROM "VaultDocument"
      WHERE "studioId" = ${studioId}
        AND (
          title ILIKE ('%' || ${q} || '%')
          OR markdown ILIKE ('%' || ${q} || '%')
          OR word_similarity(${q}, title) > 0.25
          OR word_similarity(${q}, left(markdown, 20000)) > 0.25
          OR to_tsvector('simple', coalesce(title, '') || ' ' || left(coalesce(markdown, ''), 20000))
             @@ websearch_to_tsquery('simple', ${q})
        )
      ORDER BY score DESC, path ASC
      LIMIT ${limit}
    `;

    return rows.map((row) => ({
      documentId: row.id,
      path: row.path,
      title: row.title,
      snippet: buildVaultSnippet(row.markdown, q),
      score: Math.round(row.score * 1000) / 1000,
    }));
  }
}
