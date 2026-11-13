import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AGENT_BY_KEY,
  countChars,
  countWords,
  estimateTokens,
  type AddWorkspaceFileCommentRequest,
  type AgentKey,
  type ContextMode,
  type SaveWorkspaceFileRequest,
  type WorkspaceFileCommentDto,
  type WorkspaceFileDetailDto,
  type WorkspaceFileVersionDto,
  type WorkspaceOverviewDto,
  type WorkspaceTreeNodeDto,
} from '@robdev/shared';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getWorkspaceRoots } from '../orchestrator/tools/terminal-and-permissions.helper.js';

interface DiskFileEntry {
  relPath: string;
  absPath: string;
  bytes: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(studioId: string): Promise<WorkspaceOverviewDto> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: {
        id: true,
        slug: true,
        contextMode: true,
      },
    });
    if (!studio) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const { studioWorkspaceRoot } = getWorkspaceRoots(studio.slug);
    await fs.mkdir(studioWorkspaceRoot, { recursive: true }).catch(() => {});

    // Load all RunArtifacts and WorkspaceFileComments for this studio
    const [artifacts, comments] = await Promise.all([
      this.prisma.runArtifact.findMany({
        where: { run: { studioId } },
        include: {
          run: {
            select: {
              id: true,
              summary: true,
              agent: { select: { key: true, name: true } },
              task: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.workspaceFileComment.findMany({
        where: { studioId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Group artifacts and comments by normalized relative path
    const artifactsByPath = new Map<string, typeof artifacts>();
    for (const art of artifacts) {
      const normPath = this.normalizeRelPath(art.path);
      if (!normPath) continue;
      const list = artifactsByPath.get(normPath) ?? [];
      list.push(art);
      artifactsByPath.set(normPath, list);
    }

    const commentsByPath = new Map<string, typeof comments>();
    for (const c of comments) {
      const normPath = this.normalizeRelPath(c.filePath);
      if (!normPath) continue;
      const list = commentsByPath.get(normPath) ?? [];
      list.push(c);
      commentsByPath.set(normPath, list);
    }

    // Walk disk files in /workspace/<studioSlug> (e.g. C:\Dev\App\workspace\ervum-games)
    const diskFiles = new Map<string, DiskFileEntry>();
    await this.walkWorkspaceDisk(studioWorkspaceRoot, '', 0, 12, diskFiles);

    // Only materialize DB artifacts if the disk workspace folder has no files yet
    if (diskFiles.size === 0) {
      for (const [normPath, pathArtifacts] of artifactsByPath.entries()) {
        if (!diskFiles.has(normPath) && !normPath.includes(':')) {
          const latest = pathArtifacts[pathArtifacts.length - 1]!;
          const absPath = path.resolve(
            studioWorkspaceRoot,
            normPath.split('/').join(path.sep),
          );
          if (absPath.startsWith(studioWorkspaceRoot)) {
            await fs
              .mkdir(path.dirname(absPath), { recursive: true })
              .catch(() => {});
            await fs
              .writeFile(absPath, latest.content, 'utf8')
              .catch(() => {});
          }
          diskFiles.set(normPath, {
            relPath: normPath,
            absPath,
            bytes: latest.bytes,
            createdAt: pathArtifacts[0]!.createdAt,
            updatedAt: latest.createdAt,
          });
        }
      }
    }

    // Read Silicon Properties.yaml ClassNames for folder/file annotations
    const classNamesByDir = new Map<string, string>();
    for (const [relPath, entry] of diskFiles.entries()) {
      if (relPath.toLowerCase().endsWith('/properties.yaml') || relPath.toLowerCase() === 'properties.yaml') {
        const rawYaml = await fs.readFile(entry.absPath, 'utf8').catch(() => '');
        const match = /^ClassName:\s*([A-Za-z0-9_]+)/m.exec(rawYaml);
        if (match?.[1]) {
          const parentDir = path.posix.dirname(relPath);
          classNamesByDir.set(parentDir === '.' ? '' : parentDir, match[1]);
        }
      }
    }

    // Build flat file metadata and nested tree
    const languageCounts = new Map<string, { count: number; bytes: number }>();
    let totalBytes = 0;
    let totalVersions = 0;
    let totalComments = 0;

    const rootFolderMap = new Map<string, WorkspaceTreeNodeDto>();
    const topLevelNodes: WorkspaceTreeNodeDto[] = [];

    const ensureFolderNode = (folderPath: string): WorkspaceTreeNodeDto => {
      const existing = rootFolderMap.get(folderPath);
      if (existing) return existing;

      const segments = folderPath.split('/');
      const name = segments[segments.length - 1]!;
      const node: WorkspaceTreeNodeDto = {
        path: folderPath,
        name,
        kind: 'folder',
        extension: '',
        language: 'folder',
        bytes: 0,
        lineCount: 0,
        versionCount: 0,
        commentCount: 0,
        createdAt: null,
        updatedAt: null,
        lastModifiedByAgentKey: null,
        lastModifiedByAgentName: null,
        lastTaskTitle: null,
        latestAgentComment: null,
        className: classNamesByDir.get(folderPath) ?? null,
        children: [],
      };
      rootFolderMap.set(folderPath, node);

      if (segments.length === 1) {
        topLevelNodes.push(node);
      } else {
        const parentPath = segments.slice(0, -1).join('/');
        const parentNode = ensureFolderNode(parentPath);
        parentNode.children = parentNode.children ?? [];
        parentNode.children.push(node);
      }
      return node;
    };

    const sortedPaths = [...diskFiles.keys()].sort((a, b) =>
      a.localeCompare(b),
    );

    for (const relPath of sortedPaths) {
      const diskEntry = diskFiles.get(relPath)!;
      const pathArts = artifactsByPath.get(relPath) ?? [];
      const pathComments = commentsByPath.get(relPath) ?? [];

      const firstArt = pathArts[0];
      const latestArt = pathArts[pathArts.length - 1];

      const createdAtDate =
        firstArt && firstArt.createdAt < diskEntry.createdAt
          ? firstArt.createdAt
          : diskEntry.createdAt;
      const updatedAtDate =
        latestArt && latestArt.createdAt > diskEntry.updatedAt
          ? latestArt.createdAt
          : diskEntry.updatedAt;

      const versionCount = Math.max(1, pathArts.length);
      const artifactCommentsCount = pathArts.filter((a) =>
        Boolean(a.agentComment?.trim()),
      ).length;
      const effectiveCommentCount = Math.max(
        pathComments.length,
        artifactCommentsCount,
        latestArt?.run?.summary ? 1 : 0,
      );

      const latestExplicitComment =
        pathComments[pathComments.length - 1]?.body ??
        [...pathArts].reverse().find((a) => Boolean(a.agentComment?.trim()))
          ?.agentComment ??
        (latestArt?.run?.summary
          ? this.cleanSummaryForComment(latestArt.run.summary)
          : null);

      const ext = path.posix.extname(relPath).replace(/^\./, '').toLowerCase();
      const language = latestArt?.language || this.inferLanguageFromPath(relPath);
      const parentDir = path.posix.dirname(relPath);
      const normalizedParent = parentDir === '.' ? '' : parentDir;

      const fileContent = await fs
        .readFile(diskEntry.absPath, 'utf8')
        .catch(() => latestArt?.content ?? '');
      const lineCount = fileContent ? fileContent.split(/\r?\n/).length : 0;

      totalBytes += diskEntry.bytes;
      totalVersions += versionCount;
      totalComments += effectiveCommentCount;

      const langStat = languageCounts.get(language) ?? { count: 0, bytes: 0 };
      langStat.count += 1;
      langStat.bytes += diskEntry.bytes;
      languageCounts.set(language, langStat);

      const fileNode: WorkspaceTreeNodeDto = {
        path: relPath,
        name: path.posix.basename(relPath),
        kind: 'file',
        extension: ext,
        language,
        bytes: diskEntry.bytes,
        lineCount,
        versionCount,
        commentCount: effectiveCommentCount,
        createdAt: createdAtDate.toISOString(),
        updatedAt: updatedAtDate.toISOString(),
        lastModifiedByAgentKey:
          (latestArt?.run?.agent?.key as AgentKey | undefined) ?? null,
        lastModifiedByAgentName: latestArt?.run?.agent?.name ?? null,
        lastTaskTitle: latestArt?.run?.task?.title ?? null,
        latestAgentComment: latestExplicitComment,
        className: classNamesByDir.get(normalizedParent) ?? null,
      };

      if (!normalizedParent) {
        topLevelNodes.push(fileNode);
      } else {
        const folderNode = ensureFolderNode(normalizedParent);
        folderNode.children = folderNode.children ?? [];
        folderNode.children.push(fileNode);
      }
    }

    // Roll up folder statistics and sort recursively
    let totalFolders = 0;
    const rollupFolder = (node: WorkspaceTreeNodeDto): { fileCount: number } => {
      if (node.kind === 'file') {
        return { fileCount: 1 };
      }
      totalFolders += 1;
      let folderBytes = 0;
      let folderLines = 0;
      let folderVersions = 0;
      let folderComments = 0;
      let folderFiles = 0;
      let earliestCreated: string | null = null;
      let latestUpdated: string | null = null;
      let latestAgentKey: AgentKey | null = null;
      let latestAgentName: string | null = null;

      const children = node.children ?? [];
      for (const child of children) {
        const sub = rollupFolder(child);
        folderFiles += sub.fileCount;
        folderBytes += child.bytes;
        folderLines += child.lineCount;
        folderVersions += child.versionCount;
        folderComments += child.commentCount;
        if (
          child.createdAt &&
          (!earliestCreated || child.createdAt < earliestCreated)
        ) {
          earliestCreated = child.createdAt;
        }
        if (
          child.updatedAt &&
          (!latestUpdated || child.updatedAt > latestUpdated)
        ) {
          latestUpdated = child.updatedAt;
          latestAgentKey = child.lastModifiedByAgentKey;
          latestAgentName = child.lastModifiedByAgentName;
        }
      }

      children.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      node.bytes = folderBytes;
      node.lineCount = folderLines;
      node.versionCount = folderVersions;
      node.commentCount = folderComments;
      node.fileCount = folderFiles;
      node.createdAt = earliestCreated;
      node.updatedAt = latestUpdated;
      node.lastModifiedByAgentKey = latestAgentKey;
      node.lastModifiedByAgentName = latestAgentName;
      return { fileCount: folderFiles };
    };

    for (const node of topLevelNodes) {
      rollupFolder(node);
    }
    topLevelNodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const languages = [...languageCounts.entries()]
      .map(([language, stat]) => ({
        language,
        count: stat.count,
        bytes: stat.bytes,
      }))
      .sort((a, b) => b.bytes - a.bytes);

    return {
      studioId: studio.id,
      studioSlug: studio.slug,
      workspaceRoot: studioWorkspaceRoot,
      contextMode: (studio.contextMode === 'GENERAL'
        ? 'GENERAL'
        : 'ROBLOX') as ContextMode,
      totalFiles: diskFiles.size,
      totalFolders,
      totalBytes,
      totalVersions,
      totalComments,
      languages,
      tree: topLevelNodes,
    };
  }

  async getFileDetail(
    studioId: string,
    requestedPath: string,
  ): Promise<WorkspaceFileDetailDto> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { id: true, slug: true },
    });
    if (!studio) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const normPath = this.normalizeRelPath(requestedPath);
    if (!normPath) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'File path is required',
      );
    }

    const { studioWorkspaceRoot } = getWorkspaceRoots(studio.slug);
    const absPath = path.resolve(
      studioWorkspaceRoot,
      normPath.split('/').join(path.sep),
    );

    const [artifacts, commentRows, diskStat, diskContent] = await Promise.all([
      this.prisma.runArtifact.findMany({
        where: {
          run: { studioId },
          path: normPath,
        },
        include: {
          run: {
            select: {
              id: true,
              summary: true,
              agent: { select: { id: true, key: true, name: true } },
              task: { select: { id: true, title: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.workspaceFileComment.findMany({
        where: { studioId, filePath: normPath },
        include: {
          agent: { select: { key: true, name: true } },
          user: { select: { displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      fs.stat(absPath).catch(() => null),
      fs.readFile(absPath, 'utf8').catch(() => null),
    ]);

    if (diskContent === null && artifacts.length === 0) {
      throw new AppError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        `Workspace file "${normPath}" not found`,
      );
    }

    const currentContent =
      diskContent ?? artifacts[artifacts.length - 1]?.content ?? '';
    const currentBytes = Buffer.byteLength(currentContent, 'utf8');
    const currentSha256 = this.computeSha256(currentContent);

    // Build chronological versions list (v1 .. vN)
    const versions: WorkspaceFileVersionDto[] = artifacts.map((art, idx) => {
      const vNum = idx + 1;
      const lines = art.content ? art.content.split(/\r?\n/).length : 0;
      const fallbackNote = art.run?.summary
        ? this.cleanSummaryForComment(art.run.summary)
        : art.run?.task?.title
          ? `Task: ${art.run.task.title}`
          : null;
      return {
        version: vNum,
        artifactId: art.id,
        runId: art.runId,
        taskId: art.run?.task?.id ?? null,
        taskTitle: art.run?.task?.title ?? null,
        agentKey: (art.run?.agent?.key as AgentKey | undefined) ?? null,
        agentName: art.run?.agent?.name ?? null,
        language: art.language || this.inferLanguageFromPath(normPath),
        bytes: art.bytes,
        lineCount: lines,
        sha256: this.computeSha256(art.content),
        content: art.content,
        agentComment: art.agentComment || fallbackNote,
        createdAt: art.createdAt.toISOString(),
        source: 'artifact',
      };
    });

    // If file exists on disk and either has 0 artifact rows OR disk content differs from latest artifact, add disk version
    const latestArtifactVersion = versions[versions.length - 1];
    if (
      diskContent !== null &&
      (!latestArtifactVersion || latestArtifactVersion.sha256 !== currentSha256)
    ) {
      versions.push({
        version: versions.length + 1,
        artifactId: null,
        runId: null,
        taskId: null,
        taskTitle:
          versions.length === 0 ? 'Workspace Disk File' : 'Modified on Disk',
        agentKey: null,
        agentName: versions.length === 0 ? 'Workspace Disk' : 'Local / Sync',
        language: this.inferLanguageFromPath(normPath),
        bytes: currentBytes,
        lineCount: currentContent ? currentContent.split(/\r?\n/).length : 0,
        sha256: currentSha256,
        content: currentContent,
        agentComment:
          versions.length === 0
            ? 'Synced from /workspace/ filesystem'
            : 'Updated directly on /workspace/ disk',
        createdAt: (diskStat?.mtime ?? new Date()).toISOString(),
        source: 'disk',
      });
    }

    // Build unified comments list (explicit WorkspaceFileComment rows + version comments)
    const comments: WorkspaceFileCommentDto[] = commentRows.map((c) => {
      const agentKey =
        (c.agent?.key as AgentKey | undefined) ??
        (c.agentKey as AgentKey | undefined) ??
        null;
      const authorName =
        c.authorKind === 'USER'
          ? (c.user?.displayName ?? 'Operator')
          : (c.agent?.name ??
            (agentKey ? AGENT_BY_KEY[agentKey]?.name : null) ??
            'Agent');
      return {
        id: c.id,
        filePath: normPath,
        authorKind: c.authorKind === 'USER' ? 'USER' : 'AGENT',
        agentKey,
        authorName,
        body: c.body,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        runId: c.runId,
        taskId: c.taskId,
        createdAt: c.createdAt.toISOString(),
      };
    });

    // Also surface version-level agent notes if not already duplicated in explicit comments
    const existingBodies = new Set(comments.map((c) => c.body.trim()));
    for (const v of [...versions].reverse()) {
      if (v.agentComment && !existingBodies.has(v.agentComment.trim())) {
        existingBodies.add(v.agentComment.trim());
        comments.push({
          id: `version_note_${v.version}`,
          filePath: normPath,
          authorKind: 'AGENT',
          agentKey: v.agentKey,
          authorName: v.agentName ?? 'Agent',
          body: `[v${v.version}${v.taskTitle ? ` · ${v.taskTitle}` : ''}] ${v.agentComment}`,
          lineStart: null,
          lineEnd: null,
          runId: v.runId,
          taskId: v.taskId,
          createdAt: v.createdAt,
        });
      }
    }

    // Check companion Properties.yaml in the same directory
    const parentDir = path.posix.dirname(normPath);
    const companionRel =
      parentDir === '.' ? 'Properties.yaml' : `${parentDir}/Properties.yaml`;
    let companionPropertiesYaml: string | null = null;
    let className: string | null = null;
    if (normPath.toLowerCase() !== companionRel.toLowerCase()) {
      const compAbs = path.resolve(
        studioWorkspaceRoot,
        companionRel.split('/').join(path.sep),
      );
      companionPropertiesYaml = await fs
        .readFile(compAbs, 'utf8')
        .catch(() => null);
      if (companionPropertiesYaml) {
        const m = /^ClassName:\s*([A-Za-z0-9_]+)/m.exec(companionPropertiesYaml);
        if (m?.[1]) className = m[1];
      }
    } else if (currentContent) {
      const m = /^ClassName:\s*([A-Za-z0-9_]+)/m.exec(currentContent);
      if (m?.[1]) className = m[1];
    }

    // Contributing agents summary
    const contribMap = new Map<
      AgentKey,
      {
        agentKey: AgentKey;
        agentName: string;
        versionCount: number;
        lastTouchedAt: string;
      }
    >();
    for (const v of versions) {
      if (!v.agentKey) continue;
      const prev = contribMap.get(v.agentKey);
      if (!prev) {
        contribMap.set(v.agentKey, {
          agentKey: v.agentKey,
          agentName: v.agentName ?? AGENT_BY_KEY[v.agentKey]?.name ?? v.agentKey,
          versionCount: 1,
          lastTouchedAt: v.createdAt,
        });
      } else {
        prev.versionCount += 1;
        if (v.createdAt > prev.lastTouchedAt) {
          prev.lastTouchedAt = v.createdAt;
        }
      }
    }

    const firstCreated =
      versions[0]?.createdAt ??
      (diskStat?.birthtime ?? new Date()).toISOString();
    const lastUpdated =
      versions[versions.length - 1]?.createdAt ??
      (diskStat?.mtime ?? new Date()).toISOString();

    const language =
      versions[versions.length - 1]?.language ??
      this.inferLanguageFromPath(normPath);

    return {
      path: normPath,
      name: path.posix.basename(normPath),
      extension: path.posix.extname(normPath).replace(/^\./, '').toLowerCase(),
      language,
      currentVersion: versions.length,
      content: currentContent,
      bytes: currentBytes,
      createdAt: firstCreated,
      updatedAt: lastUpdated,
      versions: [...versions].reverse(), // Newest first
      comments,
      misc: {
        diskPath: absPath,
        relativePath: normPath,
        existsOnDisk: diskContent !== null,
        encoding: 'utf-8',
        lineEndings: this.detectLineEndings(currentContent),
        sha256: currentSha256,
        lineCount: currentContent ? currentContent.split(/\r?\n/).length : 0,
        wordCount: countWords(currentContent),
        charCount: countChars(currentContent),
        estimatedTokens: estimateTokens(currentContent),
        className,
        companionPropertiesYaml,
        exportedSymbols: this.extractExportedSymbols(currentContent),
        contributingAgents: [...contribMap.values()],
      },
    };
  }

  async addComment(
    studioId: string,
    body: AddWorkspaceFileCommentRequest,
    user: AuthenticatedUser,
  ): Promise<WorkspaceFileCommentDto> {
    const normPath = this.normalizeRelPath(body.path);
    if (!normPath) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'Valid file path is required',
      );
    }

    const created = await this.prisma.workspaceFileComment.create({
      data: {
        studioId,
        filePath: normPath,
        authorKind: 'USER',
        userId: user.id,
        body: body.body.trim(),
        lineStart: body.lineStart ?? null,
        lineEnd: body.lineEnd ?? null,
      },
    });

    return {
      id: created.id,
      filePath: normPath,
      authorKind: 'USER',
      agentKey: null,
      authorName: user.displayName,
      body: created.body,
      lineStart: created.lineStart,
      lineEnd: created.lineEnd,
      runId: null,
      taskId: null,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async saveOrRestoreFile(
    studioId: string,
    body: SaveWorkspaceFileRequest,
    user: AuthenticatedUser,
  ): Promise<WorkspaceFileDetailDto> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { id: true, slug: true },
    });
    if (!studio) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio not found');
    }

    const normPath = this.normalizeRelPath(body.path);
    if (!normPath) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'Valid workspace file path is required',
      );
    }

    const { studioWorkspaceRoot } = getWorkspaceRoots(studio.slug);
    const absPath = path.resolve(
      studioWorkspaceRoot,
      normPath.split('/').join(path.sep),
    );
    if (!absPath.startsWith(studioWorkspaceRoot)) {
      throw new AppError(
        'FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'Workspace Explorer edits must remain inside /workspace/',
      );
    }

    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, body.content, 'utf8');

    // If there is an existing run for this studio, record a RunArtifact revision so version history tracks the save/restore
    const latestRun = await this.prisma.agentRun.findFirst({
      where: { studioId },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });

    const language = body.language || this.inferLanguageFromPath(normPath);
    const bytes = Buffer.byteLength(body.content, 'utf8');
    const note = body.comment?.trim() || `Saved by ${user.displayName} in Workspace Explorer`;

    if (latestRun) {
      await this.prisma.runArtifact.create({
        data: {
          runId: latestRun.id,
          path: normPath,
          language,
          content: body.content,
          bytes,
          agentComment: note,
        },
      });
    }

    if (body.comment?.trim()) {
      await this.prisma.workspaceFileComment.create({
        data: {
          studioId,
          filePath: normPath,
          authorKind: 'USER',
          userId: user.id,
          body: body.comment.trim(),
        },
      });
    }

    return this.getFileDetail(studioId, normPath);
  }

  private async walkWorkspaceDisk(
    rootDir: string,
    relPrefix: string,
    depth: number,
    maxDepth: number,
    out: Map<string, DiskFileEntry>,
  ): Promise<void> {
    if (depth > maxDepth || out.size >= 1500) return;
    const currentDir = relPrefix
      ? path.join(rootDir, relPrefix.split('/').join(path.sep))
      : rootDir;
    const entries = await fs
      .readdir(currentDir, { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      if (
        entry.name === '.git' ||
        entry.name === 'node_modules' ||
        entry.name === '__pycache__' ||
        entry.name === '.DS_Store'
      ) {
        continue;
      }
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await this.walkWorkspaceDisk(
          rootDir,
          relPath,
          depth + 1,
          maxDepth,
          out,
        );
      } else if (entry.isFile()) {
        const absPath = path.join(rootDir, relPath.split('/').join(path.sep));
        const st = await fs.stat(absPath).catch(() => null);
        if (st) {
          out.set(relPath, {
            relPath,
            absPath,
            bytes: st.size,
            createdAt: st.birthtime && st.birthtime.getTime() > 0 ? st.birthtime : st.ctime,
            updatedAt: st.mtime,
          });
        }
      }
    }
  }

  private normalizeRelPath(raw: string): string {
    return raw
      .replace(/\\/g, '/')
      .split('/')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '.' && s !== '..')
      .join('/');
  }

  private computeSha256(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  private detectLineEndings(
    content: string,
  ): 'LF' | 'CRLF' | 'MIXED' | 'NONE' {
    const crlfCount = (content.match(/\r\n/g) ?? []).length;
    const lfOnlyCount = (content.replace(/\r\n/g, '').match(/\n/g) ?? []).length;
    if (crlfCount === 0 && lfOnlyCount === 0) return 'NONE';
    if (crlfCount > 0 && lfOnlyCount > 0) return 'MIXED';
    return crlfCount > 0 ? 'CRLF' : 'LF';
  }

  private inferLanguageFromPath(relPath: string): string {
    const lower = relPath.toLowerCase();
    if (lower.endsWith('.luau') || lower.endsWith('.lua')) return 'luau';
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs'))
      return 'javascript';
    if (lower.endsWith('.py')) return 'python';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
    if (lower.endsWith('.css') || lower.endsWith('.scss')) return 'css';
    if (lower.endsWith('.sh') || lower.endsWith('.ps1') || lower.endsWith('.bat') || lower.endsWith('.cmd'))
      return 'shell';
    if (lower.endsWith('.sql')) return 'sql';
    if (lower.endsWith('.rs')) return 'rust';
    if (lower.endsWith('.go')) return 'go';
    if (lower.endsWith('.cs')) return 'csharp';
    if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.h'))
      return 'cpp';
    if (lower.endsWith('.csv')) return 'csv';
    return 'text';
  }

  private extractExportedSymbols(content: string): string[] {
    const symbols: string[] = [];
    const lines = content.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (
        /^export\s+(?:type|interface|class|function|const|enum)\s+([A-Za-z0-9_]+)/.test(
          line,
        ) ||
        /^function\s+[A-Za-z0-9_]+[:.][A-Za-z0-9_]+\s*\(/.test(line) ||
        /^(?:def|class)\s+[A-Za-z0-9_]+/.test(line)
      ) {
        const cleaned = line
          .replace(/\s*\{.*$/, '')
          .replace(/\s*=\s*\{.*$/, '')
          .slice(0, 100);
        if (!symbols.includes(cleaned)) {
          symbols.push(cleaned);
        }
        if (symbols.length >= 25) break;
      }
    }
    return symbols;
  }

  private cleanSummaryForComment(summary: string): string {
    const clean = summary
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, '')
      .replace(/^#+\s*Result\s*/im, '')
      .trim();
    return clean.slice(0, 320);
  }
}
