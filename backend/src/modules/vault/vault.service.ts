import { createHash } from 'node:crypto';
import {
  forwardRef,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  countChars,
  countWords,
  normalizeVaultPath,
  type AgentKey,
  type AuthorKind,
  type CreateVaultDocumentRequest,
  type CreateVaultFolderRequest,
  type VaultDocumentDto,
  type VaultGraphDto,
  type VaultLinkedAgentDto,
  type VaultRevisionDto,
  type VaultTreeNodeDto,
} from '@robdev/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { VaultDiskSyncService } from './vault-disk-sync.service.js';
import { VaultLinksService } from './vault-links.service.js';

export interface SaveVaultAuthor {
  kind: AuthorKind;
  userId?: string | null;
  agentId?: string | null;
  reason?: string | null;
  label: string;
}

export interface SaveVaultOptions {
  skipDiskExport?: boolean;
  diskMtime?: Date;
}

type ForwardRefType<T> = T;

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: VaultLinksService,
    private readonly realtime: RealtimeService,
    @Inject(forwardRef(() => VaultDiskSyncService))
    private readonly diskSync: ForwardRefType<VaultDiskSyncService>,
  ) {}

  async tree(studioId: string): Promise<VaultTreeNodeDto[]> {
    const [folders, documents] = await Promise.all([
      this.prisma.vaultFolder.findMany({
        where: { studioId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.vaultDocument.findMany({
        where: { studioId },
        orderBy: [{ title: 'asc' }],
      }),
    ]);

    const folderMap = new Map<string, VaultTreeNodeDto>();
    for (const f of folders) {
      folderMap.set(f.id, {
        type: 'folder',
        id: f.id,
        name: f.name,
        path: f.path,
        sortOrder: f.sortOrder,
        children: [],
      });
    }

    for (const doc of documents) {
      const parent = folderMap.get(doc.folderId);
      if (parent && parent.children) {
        parent.children.push({
          type: 'document',
          id: doc.id,
          name: doc.title,
          path: doc.path,
          sortOrder: 0,
          wordCount: doc.wordCount,
        });
      }
    }

    const roots: VaultTreeNodeDto[] = [];
    for (const f of folders) {
      const node = folderMap.get(f.id)!;
      if (f.parentId && folderMap.has(f.parentId)) {
        folderMap.get(f.parentId)!.children!.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async getGraph(studioId: string): Promise<VaultGraphDto> {
    const [documents, links] = await Promise.all([
      this.prisma.vaultDocument.findMany({
        where: { studioId },
        include: {
          agentBindings: {
            include: { agent: { select: { key: true } } },
          },
        },
        orderBy: { title: 'asc' },
      }),
      this.prisma.vaultLink.findMany({
        where: { fromDocument: { studioId } },
      }),
    ]);

    return {
      nodes: documents.map((d) => {
        const parts = d.path.split('/');
        const folderName = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
        return {
          id: d.id,
          title: d.title,
          path: d.path,
          folderName,
          wordCount: d.wordCount,
          alwaysInject: d.alwaysInject,
          boundAgents: d.agentBindings.map((b) => b.agent.key),
        };
      }),
      edges: links.map((l) => ({
        from: l.fromDocumentId,
        to: l.toDocumentId,
        targetPath: l.targetPath,
        broken: l.toDocumentId === null,
      })),
    };
  }

  async getDocument(studioId: string, docId: string): Promise<VaultDocumentDto> {
    const doc = await this.prisma.vaultDocument.findFirst({
      where: { id: docId, studioId },
      include: {
        incomingLinks: {
          include: {
            fromDocument: { select: { id: true, path: true, title: true } },
          },
        },
        outgoingLinks: true,
        agentBindings: {
          include: {
            agent: { select: { id: true, key: true } },
          },
          orderBy: { priority: 'asc' },
        },
        injections: {
          include: {
            run: {
              include: {
                agent: { select: { key: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        },
      },
    });

    if (!doc) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Vault document not found');
    }

    const updatedByLabel = await this.resolveAuthorLabel(
      doc.updatedByKind,
      doc.updatedByUserId,
      doc.updatedByAgentId,
    );

    const lastInjectedByAgent = new Map<AgentKey, string>();
    for (const inj of doc.injections) {
      const key = inj.run.agent.key;
      if (!lastInjectedByAgent.has(key)) {
        lastInjectedByAgent.set(key, inj.createdAt.toISOString());
      }
    }

    const linkedAgents: VaultLinkedAgentDto[] = [];
    const seenAgents = new Set<AgentKey>();

    if (doc.alwaysInject) {
      const allAgents = await this.prisma.agent.findMany({
        where: { studioId },
        select: { key: true },
        orderBy: { sortOrder: 'asc' },
      });
      for (const a of allAgents) {
        seenAgents.add(a.key);
        linkedAgents.push({
          agentKey: a.key,
          priority: 0,
          source: 'ALWAYS',
          lastInjectedAt: lastInjectedByAgent.get(a.key) ?? null,
        });
      }
    } else {
      for (const b of doc.agentBindings) {
        seenAgents.add(b.agent.key);
        linkedAgents.push({
          agentKey: b.agent.key,
          priority: b.priority,
          source: 'BINDING',
          lastInjectedAt: lastInjectedByAgent.get(b.agent.key) ?? null,
        });
      }
      for (const [agentKey, lastAt] of lastInjectedByAgent.entries()) {
        if (!seenAgents.has(agentKey)) {
          seenAgents.add(agentKey);
          linkedAgents.push({
            agentKey,
            priority: null,
            source: 'RECENT_INJECTION',
            lastInjectedAt: lastAt,
          });
        }
      }
    }

    return {
      id: doc.id,
      folderId: doc.folderId,
      path: doc.path,
      title: doc.title,
      markdown: doc.markdown,
      version: doc.version,
      wordCount: doc.wordCount,
      charCount: doc.charCount,
      tags: doc.tags,
      alwaysInject: doc.alwaysInject,
      updatedAt: doc.updatedAt.toISOString(),
      updatedBy: {
        kind: doc.updatedByKind,
        label: updatedByLabel,
      },
      backlinks: doc.incomingLinks.map((l) => ({
        documentId: l.fromDocument.id,
        path: l.fromDocument.path,
        title: l.fromDocument.title,
      })),
      outlinks: doc.outgoingLinks.map((l) => ({
        targetPath: l.targetPath,
        resolvedDocumentId: l.toDocumentId,
      })),
      linkedAgents,
    };
  }

  async getDocumentByPath(studioId: string, rawPath: string): Promise<VaultDocumentDto> {
    const trimmed = rawPath.trim();
    if (!trimmed) {
      throw new AppError('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, 'Path is required');
    }

    const normalized = normalizeVaultPath(trimmed);
    const doc = await this.prisma.vaultDocument.findFirst({
      where: {
        studioId,
        OR: [
          { path: trimmed },
          { path: normalized },
          { title: { equals: trimmed.replace(/\.md$/i, ''), mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });

    if (!doc) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Vault document not found: ${rawPath}`);
    }

    return this.getDocument(studioId, doc.id);
  }

  async createDocument(
    studioId: string,
    body: CreateVaultDocumentRequest,
    user: AuthenticatedUser,
  ): Promise<VaultDocumentDto> {
    const folder = await this.prisma.vaultFolder.findFirst({
      where: { id: body.folderId, studioId },
      include: { studio: { select: { slug: true } } },
    });
    if (!folder) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Vault folder not found');
    }

    const docPath = `${folder.path}/${body.title}.md`;
    const collision = await this.prisma.vaultDocument.findUnique({
      where: { studioId_path: { studioId, path: docPath } },
    });
    if (collision) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `A document already exists at path ${docPath}`,
      );
    }

    const markdown = body.markdown.replace(/\r\n/g, '\n');
    const contentHash = createHash('sha256').update(markdown, 'utf8').digest('hex');

    const created = await this.prisma.$transaction(async (tx) => {
      const doc = await tx.vaultDocument.create({
        data: {
          studioId,
          folderId: folder.id,
          path: docPath,
          title: body.title,
          markdown,
          version: 1,
          wordCount: countWords(markdown),
          charCount: countChars(markdown),
          tags: [],
          alwaysInject: false,
          contentHash,
          updatedByKind: 'USER',
          updatedByUserId: user.id,
        },
      });

      await tx.vaultDocumentRevision.create({
        data: {
          documentId: doc.id,
          version: 1,
          markdown,
          authorKind: 'USER',
          authorUserId: user.id,
          reason: 'Created document',
        },
      });

      await this.links.reindex(studioId, doc, tx);
      return doc;
    });

    await this.diskSync.exportDocument(folder.studio.slug, created);
    this.realtime.emitToStudio(studioId, 'vault:document-updated', {
      documentId: created.id,
      path: created.path,
      version: created.version,
      byLabel: user.displayName,
    });

    return this.getDocument(studioId, created.id);
  }

  async save(
    studioId: string,
    docId: string,
    input: {
      markdown: string;
      baseVersion?: number;
      title?: string;
      tags?: string[];
      alwaysInject?: boolean;
    },
    author: SaveVaultAuthor,
    opts?: SaveVaultOptions,
  ): Promise<VaultDocumentDto> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { slug: true },
    });
    if (!studio) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const markdown = input.markdown.replace(/\r\n/g, '\n');
    const contentHash = createHash('sha256').update(markdown, 'utf8').digest('hex');

    const result = await this.prisma.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<Array<{ id: string; version: number }>>`
        SELECT id, version
        FROM "VaultDocument"
        WHERE id = ${docId} AND "studioId" = ${studioId}
        FOR UPDATE
      `;

      const locked = lockedRows[0];
      if (!locked) {
        throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Vault document not found');
      }

      const current = await tx.vaultDocument.findUniqueOrThrow({
        where: { id: docId },
        include: { folder: true },
      });

      if (input.baseVersion !== undefined && current.version !== input.baseVersion) {
        throw new AppError(
          'VERSION_CONFLICT',
          HttpStatus.CONFLICT,
          `Vault document version conflict (expected v${input.baseVersion}, found v${current.version})`,
          {
            currentVersion: current.version,
            currentMarkdown: current.markdown,
          },
        );
      }

      const nextTitle = input.title ?? current.title;
      const nextTags = input.tags ?? current.tags;
      const nextAlwaysInject = input.alwaysInject ?? current.alwaysInject;
      const metadataChanged =
        nextTitle !== current.title ||
        nextAlwaysInject !== current.alwaysInject ||
        JSON.stringify(nextTags) !== JSON.stringify(current.tags);

      if (contentHash === current.contentHash && !metadataChanged) {
        return { doc: current, changed: false };
      }

      let nextPath = current.path;
      if (nextTitle !== current.title) {
        nextPath = `${current.folder.path}/${nextTitle}.md`;
        const collision = await tx.vaultDocument.findFirst({
          where: {
            studioId,
            path: nextPath,
            id: { not: current.id },
          },
        });
        if (collision) {
          throw new AppError(
            'CONFLICT',
            HttpStatus.CONFLICT,
            `A document already exists at path ${nextPath}`,
          );
        }
      }

      const nextVersion = current.version + 1;

      await tx.vaultDocumentRevision.create({
        data: {
          documentId: current.id,
          version: nextVersion,
          markdown,
          authorKind: author.kind,
          authorUserId: author.userId ?? null,
          authorAgentId: author.agentId ?? null,
          reason: author.reason ?? null,
        },
      });

      const updated = await tx.vaultDocument.update({
        where: { id: current.id },
        data: {
          title: nextTitle,
          path: nextPath,
          markdown,
          version: nextVersion,
          wordCount: countWords(markdown),
          charCount: countChars(markdown),
          tags: nextTags,
          alwaysInject: nextAlwaysInject,
          contentHash,
          updatedByKind: author.kind,
          updatedByUserId: author.userId ?? null,
          updatedByAgentId: author.agentId ?? null,
          ...(opts?.diskMtime ? { diskMtime: opts.diskMtime } : {}),
        },
      });

      await this.links.reindex(studioId, updated, tx);

      return { doc: updated, changed: true };
    });

    if (result.changed) {
      if (!opts?.skipDiskExport) {
        await this.diskSync.exportDocument(studio.slug, result.doc);
      }
      this.realtime.emitToStudio(studioId, 'vault:document-updated', {
        documentId: result.doc.id,
        path: result.doc.path,
        version: result.doc.version,
        byLabel: author.label,
      });
    }

    return this.getDocument(studioId, docId);
  }

  async deleteDocument(studioId: string, docId: string): Promise<void> {
    const existing = await this.prisma.vaultDocument.findFirst({
      where: { id: docId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Vault document not found');
    }
    await this.prisma.vaultDocument.delete({ where: { id: existing.id } });
  }

  async createFolder(
    studioId: string,
    body: CreateVaultFolderRequest,
  ): Promise<VaultTreeNodeDto> {
    let parentPath = '';
    if (body.parentId) {
      const parent = await this.prisma.vaultFolder.findFirst({
        where: { id: body.parentId, studioId },
      });
      if (!parent) {
        throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Parent vault folder not found');
      }
      parentPath = `${parent.path}/`;
    }

    const folderPath = `${parentPath}${body.name}`;
    const collision = await this.prisma.vaultFolder.findUnique({
      where: { studioId_path: { studioId, path: folderPath } },
    });
    if (collision) {
      throw new AppError('CONFLICT', HttpStatus.CONFLICT, 'Vault folder already exists');
    }

    const maxOrder = await this.prisma.vaultFolder.aggregate({
      where: { studioId, parentId: body.parentId },
      _max: { sortOrder: true },
    });

    const folder = await this.prisma.vaultFolder.create({
      data: {
        studioId,
        parentId: body.parentId,
        name: body.name,
        path: folderPath,
        sortOrder: (maxOrder._max.sortOrder ?? 17) + 1,
      },
    });

    return {
      type: 'folder',
      id: folder.id,
      name: folder.name,
      path: folder.path,
      sortOrder: folder.sortOrder,
      children: [],
    };
  }

  async getRevisions(studioId: string, docId: string): Promise<VaultRevisionDto[]> {
    const doc = await this.prisma.vaultDocument.findFirst({
      where: { id: docId, studioId },
      select: { id: true },
    });
    if (!doc) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Vault document not found');
    }

    const revisions = await this.prisma.vaultDocumentRevision.findMany({
      where: { documentId: doc.id },
      include: {
        authorUser: { select: { displayName: true } },
        authorAgent: { select: { name: true } },
      },
      orderBy: { version: 'desc' },
    });

    return revisions.map((rev) => ({
      version: rev.version,
      authorKind: rev.authorKind,
      authorLabel:
        rev.authorUser?.displayName ??
        rev.authorAgent?.name ??
        (rev.authorKind === 'DISK' ? 'Disk' : 'Seed'),
      reason: rev.reason,
      createdAt: rev.createdAt.toISOString(),
      wordCount: countWords(rev.markdown),
    }));
  }

  async getRevision(
    studioId: string,
    docId: string,
    version: number,
  ): Promise<{ version: number; markdown: string }> {
    const doc = await this.prisma.vaultDocument.findFirst({
      where: { id: docId, studioId },
      select: { id: true },
    });
    if (!doc) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Vault document not found');
    }

    const revision = await this.prisma.vaultDocumentRevision.findUnique({
      where: {
        documentId_version: {
          documentId: doc.id,
          version,
        },
      },
    });

    if (!revision) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, `Revision v${version} not found`);
    }

    return {
      version: revision.version,
      markdown: revision.markdown,
    };
  }

  private async resolveAuthorLabel(
    kind: AuthorKind,
    userId: string | null,
    agentId: string | null,
  ): Promise<string> {
    if (kind === 'USER' && userId) {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { displayName: true },
      });
      return u?.displayName ?? 'User';
    }
    if (kind === 'AGENT' && agentId) {
      const a = await this.prisma.agent.findUnique({
        where: { id: agentId },
        select: { name: true },
      });
      return a?.name ?? 'Agent';
    }
    if (kind === 'DISK') {
      return 'Disk';
    }
    return 'Seed';
  }
}
