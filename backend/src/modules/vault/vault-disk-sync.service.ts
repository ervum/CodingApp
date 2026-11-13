import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { countChars, countWords } from '@robdev/shared';
import chokidar, { type FSWatcher } from 'chokidar';
import { AppConfigService } from '../../config/app-config.service.js';
import type { VaultDocument } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { VaultLinksService } from './vault-links.service.js';
import { VaultService } from './vault.service.js';

interface RecentWriteEntry {
  hash: string;
  at: number;
}

type ForwardRefType<T> = T;

@Injectable()
export class VaultDiskSyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(VaultDiskSyncService.name);
  private readonly recentWrites = new Map<string, RecentWriteEntry>();
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly links: VaultLinksService,
    @Inject(forwardRef(() => VaultService))
    private readonly vault: ForwardRefType<VaultService>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.vaultDiskSync) {
      return;
    }
    try {
      await this.reconcileAllStudios();
      await this.startWatcher();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Vault disk sync bootstrap warning: ${msg}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  async reconcileAllStudios(): Promise<void> {
    const studios = await this.prisma.studio.findMany({ select: { id: true } });
    for (const studio of studios) {
      await this.reconcileStudio(studio.id);
    }
  }

  async reconcileStudio(studioId: string): Promise<{ exported: number; imported: number }> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      include: {
        vaultFolders: true,
        vaultDocuments: true,
      },
    });
    if (!studio) {
      return { exported: 0, imported: 0 };
    }

    let exported = 0;
    let imported = 0;

    const studioRoot = path.resolve(this.config.vaultDiskRoot, studio.slug);
    await fs.mkdir(studioRoot, { recursive: true });

    const docsByPath = new Map<string, VaultDocument>();
    for (const doc of studio.vaultDocuments) {
      docsByPath.set(doc.path, doc);
    }

    // 1. Check existing DB documents against disk
    for (const doc of studio.vaultDocuments) {
      const absPath = path.resolve(studioRoot, doc.path);
      try {
        const stat = await fs.stat(absPath);
        const diskRaw = await fs.readFile(absPath, 'utf8');
        const diskMarkdown = diskRaw.replace(/\r\n/g, '\n');
        const diskHash = createHash('sha256').update(diskMarkdown, 'utf8').digest('hex');

        const isNewerOnDisk =
          !doc.diskMtime || stat.mtime.getTime() > doc.diskMtime.getTime() + 50;

        if (isNewerOnDisk && diskHash !== doc.contentHash) {
          await this.vault.save(
            studio.id,
            doc.id,
            { markdown: diskMarkdown },
            { kind: 'DISK', label: 'Disk', reason: 'Edited on disk' },
            { skipDiskExport: true, diskMtime: stat.mtime },
          );
          imported++;
        }
      } catch {
        // File does not exist on disk -> export it
        await this.exportDocument(studio.slug, doc);
        exported++;
      }
    }

    // 2. Scan disk for new .md files not yet in DB
    const diskMdPaths = await this.walkMarkdownFiles(studioRoot, studioRoot);
    for (const relPath of diskMdPaths) {
      if (docsByPath.has(relPath)) {
        continue;
      }
      const importedDoc = await this.importNewDiskFile(studio.id, studioRoot, relPath);
      if (importedDoc) {
        imported++;
      }
    }

    return { exported, imported };
  }

  async exportDocument(studioSlug: string, doc: VaultDocument): Promise<void> {
    if (!this.config.vaultDiskSync) {
      return;
    }

    const studioRoot = path.resolve(this.config.vaultDiskRoot, studioSlug);
    const absPath = path.resolve(studioRoot, doc.path);
    const tmpPath = `${absPath}.tmp`;

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    this.recentWrites.set(path.normalize(absPath), {
      hash: doc.contentHash,
      at: Date.now(),
    });

    await fs.writeFile(tmpPath, doc.markdown, 'utf8');
    await fs.rename(tmpPath, absPath);

    const stat = await fs.stat(absPath);
    await this.prisma.vaultDocument.update({
      where: { id: doc.id },
      data: { diskMtime: stat.mtime },
    });
  }

  private async startWatcher(): Promise<void> {
    const root = path.resolve(this.config.vaultDiskRoot);
    await fs.mkdir(root, { recursive: true });

    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 400,
        pollInterval: 100,
      },
    });

    this.watcher.on('add', (filePath: string) => void this.handleDiskUpsert(filePath));
    this.watcher.on('change', (filePath: string) => void this.handleDiskUpsert(filePath));
    this.watcher.on('unlink', (filePath: string) => {
      if (!this.shouldProcessPath(filePath)) return;
      this.logger.warn(
        `Vault file removed on disk (${filePath}); retaining database record and will re-export on next save`,
      );
    });
  }

  private shouldProcessPath(filePath: string): boolean {
    const normalized = filePath.replace(/\\/g, '/');
    if (normalized.includes('/.obsidian/') || normalized.includes('/.trash/')) {
      return false;
    }
    return normalized.endsWith('.md');
  }

  private async handleDiskUpsert(filePath: string): Promise<void> {
    if (!this.shouldProcessPath(filePath)) {
      return;
    }

    const absNormalized = path.normalize(path.resolve(filePath));
    let raw: string;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absNormalized);
      raw = await fs.readFile(absNormalized, 'utf8');
    } catch {
      return;
    }

    const markdown = raw.replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(markdown, 'utf8').digest('hex');

    const recent = this.recentWrites.get(absNormalized);
    if (recent && recent.hash === hash && Date.now() - recent.at < 3000) {
      return;
    }

    const root = path.resolve(this.config.vaultDiskRoot);
    const relFromRoot = path.relative(root, absNormalized).replace(/\\/g, '/');
    const slashIdx = relFromRoot.indexOf('/');
    if (slashIdx <= 0) {
      return;
    }

    const studioSlug = relFromRoot.slice(0, slashIdx);
    const docRelPath = relFromRoot.slice(slashIdx + 1);

    const studio = await this.prisma.studio.findUnique({ where: { slug: studioSlug } });
    if (!studio) {
      return;
    }

    const existing = await this.prisma.vaultDocument.findUnique({
      where: { studioId_path: { studioId: studio.id, path: docRelPath } },
    });

    if (existing) {
      if (existing.contentHash === hash) {
        return;
      }
      await this.vault.save(
        studio.id,
        existing.id,
        { markdown },
        { kind: 'DISK', label: 'Disk', reason: 'Edited on disk' },
        { skipDiskExport: true, diskMtime: stat.mtime },
      );
    } else {
      const studioRoot = path.resolve(root, studioSlug);
      await this.importNewDiskFile(studio.id, studioRoot, docRelPath);
    }
  }

  private async importNewDiskFile(
    studioId: string,
    studioRoot: string,
    relPath: string,
  ): Promise<VaultDocument | null> {
    const absPath = path.resolve(studioRoot, relPath);
    let raw: string;
    let stat: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stat = await fs.stat(absPath);
      raw = await fs.readFile(absPath, 'utf8');
    } catch {
      return null;
    }

    const markdown = raw.replace(/\r\n/g, '\n');
    const hash = createHash('sha256').update(markdown, 'utf8').digest('hex');

    const folderRel = path.posix.dirname(relPath);
    const folderPath = folderRel === '.' ? 'Uncategorized' : folderRel;
    const folderName = path.posix.basename(folderPath);
    const title = path.posix.basename(relPath, '.md');

    let folder = await this.prisma.vaultFolder.findUnique({
      where: { studioId_path: { studioId, path: folderPath } },
    });
    if (!folder) {
      const maxOrder = await this.prisma.vaultFolder.aggregate({
        where: { studioId },
        _max: { sortOrder: true },
      });
      folder = await this.prisma.vaultFolder.create({
        data: {
          studioId,
          parentId: null,
          name: folderName,
          path: folderPath,
          sortOrder: (maxOrder._max.sortOrder ?? 17) + 1,
        },
      });
    }

    const created = await this.prisma.vaultDocument.create({
      data: {
        studioId,
        folderId: folder.id,
        path: relPath,
        title,
        markdown,
        version: 1,
        wordCount: countWords(markdown),
        charCount: countChars(markdown),
        tags: [],
        alwaysInject: false,
        contentHash: hash,
        diskMtime: stat.mtime,
        updatedByKind: 'DISK',
      },
    });

    await this.prisma.vaultDocumentRevision.create({
      data: {
        documentId: created.id,
        version: 1,
        markdown,
        authorKind: 'DISK',
        reason: 'Imported from disk',
      },
    });

    await this.links.reindex(studioId, created);
    return created;
  }

  private async walkMarkdownFiles(dir: string, baseDir: string): Promise<string[]> {
    const out: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.obsidian' || entry.name === '.trash') {
          continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.walkMarkdownFiles(full, baseDir);
          out.push(...sub);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const rel = path.relative(baseDir, full).replace(/\\/g, '/');
          out.push(rel);
        }
      }
    } catch {
      return out;
    }
    return out;
  }
}
