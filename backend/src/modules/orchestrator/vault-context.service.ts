import { Injectable } from '@nestjs/common';
import {
  estimateTokens,
  type ContextMode,
  type InjectedDocRef,
} from '@robdev/shared';
import { PrismaService } from '../../prisma/prisma.service.js';
import { extractAndResolveVaultLinks } from '../vault/vault-links.core.js';

export interface VaultDocCandidate {
  id: string;
  path: string;
  title: string;
  version: number;
  markdown: string;
  priority: number;
}

export interface SelectedVaultContext {
  vaultBlock: string;
  injected: InjectedDocRef[];
}

const TRUNCATION_MIN_REMAINING_TOKENS = 1500;

export function truncateMarkdownByH2(
  markdown: string,
  path: string,
  maxTokens: number,
): string | null {
  const notice = `\n\n> [Truncated for context budget — call vault_read("${path}") for the full document.]`;
  const noticeTokens = estimateTokens(notice);
  const availableTokens = maxTokens - noticeTokens;
  if (availableTokens <= 0) return null;

  const parts = markdown.split(/(?=\n##\s)/);
  let accumulated = '';
  for (const part of parts) {
    const candidate = accumulated + part;
    if (estimateTokens(candidate) <= availableTokens) {
      accumulated = candidate;
    } else {
      break;
    }
  }

  if (!accumulated.trim()) {
    const maxChars = Math.max(200, availableTokens * 4);
    accumulated = markdown.slice(0, maxChars).trimEnd();
  }

  return `${accumulated}${notice}`;
}

export function budgetVaultCandidates(
  candidates: VaultDocCandidate[],
  budgetTokens: number,
): SelectedVaultContext {
  const deduped = new Map<string, VaultDocCandidate>();
  for (const c of candidates) {
    const existing = deduped.get(c.id);
    if (!existing || c.priority < existing.priority) {
      deduped.set(c.id, c);
    }
  }

  const sorted = [...deduped.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.path.localeCompare(b.path);
  });

  let usedTokens = 0;
  const injected: InjectedDocRef[] = [];
  const docBlocks: string[] = [];
  const skippedPaths: string[] = [];

  for (const doc of sorted) {
    const fullTokens = estimateTokens(doc.markdown);
    const remaining = budgetTokens - usedTokens;

    if (fullTokens <= remaining) {
      usedTokens += fullTokens;
      injected.push({
        documentId: doc.id,
        path: doc.path,
        version: doc.version,
        estimatedTokens: fullTokens,
        truncated: false,
      });
      docBlocks.push(
        `<vault_document path="${doc.path}" version="${doc.version}" title="${doc.title}">\n${doc.markdown}\n</vault_document>`,
      );
    } else if (remaining >= TRUNCATION_MIN_REMAINING_TOKENS) {
      const truncatedMd = truncateMarkdownByH2(doc.markdown, doc.path, remaining);
      if (truncatedMd) {
        const truncTokens = estimateTokens(truncatedMd);
        usedTokens += truncTokens;
        injected.push({
          documentId: doc.id,
          path: doc.path,
          version: doc.version,
          estimatedTokens: truncTokens,
          truncated: true,
        });
        docBlocks.push(
          `<vault_document path="${doc.path}" version="${doc.version}" title="${doc.title}">\n${truncatedMd}\n</vault_document>`,
        );
      } else {
        skippedPaths.push(doc.path);
      }
    } else {
      skippedPaths.push(doc.path);
    }
  }

  const lines: string[] = ['<vault>', ...docBlocks];
  if (skippedPaths.length > 0) {
    lines.push(`Other relevant docs (use vault_read): ${skippedPaths.join(', ')}`);
  }
  lines.push('</vault>');

  return {
    vaultBlock: lines.join('\n'),
    injected,
  };
}

@Injectable()
export class VaultContextService {
  constructor(private readonly prisma: PrismaService) {}

  async selectDocuments(params: {
    studioId: string;
    runId: string;
    agentId: string;
    taskBrief: string;
    taskTags: string[];
    budgetTokens: number;
    contextMode?: ContextMode;
  }): Promise<SelectedVaultContext> {
    const isGeneralMode = params.contextMode === 'GENERAL';
    const [rawDocs, agentBindings] = await Promise.all([
      this.prisma.vaultDocument.findMany({
        where: { studioId: params.studioId },
        select: {
          id: true,
          path: true,
          title: true,
          version: true,
          markdown: true,
          tags: true,
          alwaysInject: true,
          updatedByKind: true,
        },
      }),
      this.prisma.agentVaultBinding.findMany({
        where: { agentId: params.agentId },
        select: { documentId: true, priority: true },
      }),
    ]);

    const allDocs = isGeneralMode
      ? rawDocs.filter((d) => d.updatedByKind !== 'SEED')
      : rawDocs;

    const docById = new Map(allDocs.map((d) => [d.id, d]));
    const candidates: VaultDocCandidate[] = [];

    // 1. alwaysInject=true -> priority 0
    for (const d of allDocs) {
      if (d.alwaysInject) {
        candidates.push({
          id: d.id,
          path: d.path,
          title: d.title,
          version: d.version,
          markdown: d.markdown,
          priority: 0,
        });
      }
    }

    // 2. AgentVaultBinding rows -> priority 1..99
    for (const b of agentBindings) {
      const doc = docById.get(b.documentId);
      if (doc) {
        candidates.push({
          id: doc.id,
          path: doc.path,
          title: doc.title,
          version: doc.version,
          markdown: doc.markdown,
          priority: b.priority,
        });
      }
    }

    // 3. Wikilinks found in task.brief -> priority 5
    const briefLinks = extractAndResolveVaultLinks(params.taskBrief, allDocs);
    for (const wl of briefLinks) {
      if (wl.toDocumentId) {
        const doc = docById.get(wl.toDocumentId);
        if (doc) {
          candidates.push({
            id: doc.id,
            path: doc.path,
            title: doc.title,
            version: doc.version,
            markdown: doc.markdown,
            priority: 5,
          });
        }
      }
    }

    // 4. Docs whose tags intersect task.tags -> priority 20
    if (params.taskTags.length > 0) {
      const taskTagSet = new Set(params.taskTags.map((t) => t.toLowerCase()));
      for (const d of allDocs) {
        if (d.tags.some((t) => taskTagSet.has(t.toLowerCase()))) {
          candidates.push({
            id: d.id,
            path: d.path,
            title: d.title,
            version: d.version,
            markdown: d.markdown,
            priority: 20,
          });
        }
      }
    }

    const result = budgetVaultCandidates(candidates, params.budgetTokens);

    if (result.injected.length > 0) {
      await this.prisma.runVaultInjection.createMany({
        data: result.injected.map((inj) => ({
          runId: params.runId,
          documentId: inj.documentId,
          documentVersion: inj.version,
          estimatedTokens: inj.estimatedTokens,
          truncated: inj.truncated,
        })),
        skipDuplicates: true,
      });
    }

    return result;
  }
}
