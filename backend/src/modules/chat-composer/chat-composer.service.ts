import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  AgentKey,
  ChatAttachment,
  ChatMentionItemDto,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { PcDesktopAutomationService } from '../orchestrator/tools/pc-desktop-automation.service.js';
import {
  collectWorkspaceFileEntries,
  getStudioCodingConfig,
} from '../orchestrator/tools/workspace-files.tools.js';
import type { ToolContext } from '../orchestrator/tools/tool-context.js';

export interface UploadFileItemInput {
  name: string;
  relPath?: string;
  mimeType?: string;
  base64: string;
}

export interface UploadChatFilesInput {
  mode?: 'files' | 'folder';
  folderName?: string;
  files: UploadFileItemInput[];
}

@Injectable()
export class ChatComposerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly pcAutomation: PcDesktopAutomationService,
  ) {}

  async listMentions(
    studioId: string,
    queryRaw = '',
    agentKey?: AgentKey,
  ): Promise<ChatMentionItemDto[]> {
    const q = queryRaw.trim().toLowerCase();
    const items: ChatMentionItemDto[] = [];

    const matchesQuery = (label: string, sublabel: string): boolean => {
      if (!q) return true;
      return (
        label.toLowerCase().includes(q) || sublabel.toLowerCase().includes(q)
      );
    };

    const [vaultDocs, games, tasks, recentArtifacts, workspaceEntries] =
      await Promise.all([
        this.prisma.vaultDocument.findMany({
          where: { studioId },
          orderBy: [{ alwaysInject: 'desc' }, { updatedAt: 'desc' }],
          take: 40,
          select: { id: true, path: true, title: true },
        }),
        this.prisma.game.findMany({
          where: { studioId, archivedAt: null },
          orderBy: { updatedAt: 'desc' },
          take: 20,
          select: { id: true, name: true, genre: true, status: true },
        }),
        this.prisma.task.findMany({
          where: { studioId },
          orderBy: { updatedAt: 'desc' },
          take: 25,
          select: { id: true, title: true, status: true },
        }),
        this.prisma.runArtifact.findMany({
          where: {
            run: {
              studioId,
              ...(agentKey ? { agent: { key: agentKey } } : {}),
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 40,
          select: { id: true, path: true, language: true },
        }),
        collectWorkspaceFileEntries(
          { studioId, prisma: this.prisma } as unknown as ToolContext,
          '',
          5,
        ).catch(() => []),
      ]);

    // 1. Vault Context Rules
    for (const doc of vaultDocs) {
      if (!matchesQuery(doc.title, doc.path)) continue;
      items.push({
        id: `vault:${doc.id}`,
        kind: 'vault_doc',
        group: 'vault',
        label: doc.title,
        detail: doc.path,
        sublabel: `Vault Rule · ${doc.path}`,
        attachment: {
          kind: 'vault_doc',
          documentId: doc.id,
          path: doc.path,
          title: doc.title,
        },
      });
    }

    // 2. Workspace Folders & Files
    const folderCounts = new Map<string, number>();
    for (const entry of workspaceEntries) {
      const norm = entry.path.replace(/\\/g, '/');
      if (norm.startsWith('.chat-uploads/')) continue;
      const parts = norm.split('/');
      for (let i = 1; i < parts.length; i++) {
        const folderRel = parts.slice(0, i).join('/');
        folderCounts.set(folderRel, (folderCounts.get(folderRel) ?? 0) + 1);
      }
    }

    for (const [folderRel, count] of Array.from(folderCounts.entries()).slice(0, 30)) {
      const folderName = folderRel.split('/').pop() ?? folderRel;
      if (!matchesQuery(folderName, folderRel)) continue;
      items.push({
        id: `ws-folder:${folderRel}`,
        kind: 'workspace_folder',
        group: 'workspace_folder',
        label: folderName,
        detail: `${folderRel} (${count} files)`,
        sublabel: `Folder · ${folderRel} (${count} files)`,
        attachment: {
          kind: 'workspace_folder',
          path: folderRel,
          relPath: folderRel,
          fileCount: count,
        },
      });
    }

    for (const entry of workspaceEntries.slice(0, 60)) {
      const norm = entry.path.replace(/\\/g, '/');
      if (norm.startsWith('.chat-uploads/')) continue;
      const base = norm.split('/').pop() ?? norm;
      if (!matchesQuery(base, norm)) continue;
      items.push({
        id: `ws-file:${norm}`,
        kind: 'workspace_file',
        group: 'workspace_file',
        label: base,
        detail: norm,
        sublabel: `Workspace File · ${norm}`,
        attachment: {
          kind: 'workspace_file',
          path: norm,
          relPath: norm,
          bytes: entry.bytes,
        },
      });
    }

    // 3. Chat Artifacts (deduplicated by path)
    const seenArtifactPaths = new Set<string>();
    for (const art of recentArtifacts) {
      const norm = art.path.replace(/\\/g, '/');
      if (seenArtifactPaths.has(norm)) continue;
      seenArtifactPaths.add(norm);
      const base = norm.split('/').pop() ?? norm;
      if (!matchesQuery(base, norm)) continue;
      items.push({
        id: `artifact:${art.id}`,
        kind: 'chat_artifact',
        group: 'artifact',
        label: base,
        detail: `${art.language} · ${norm}`,
        sublabel: `Chat Artifact (${art.language}) · ${norm}`,
        attachment: {
          kind: 'chat_artifact',
          artifactId: art.id,
          runId: null,
          path: norm,
          language: art.language,
        },
      });
    }

    // 4. Games
    for (const g of games) {
      if (!matchesQuery(g.name, `${g.genre} ${g.status}`)) continue;
      items.push({
        id: `game:${g.id}`,
        kind: 'game',
        group: 'game',
        label: g.name,
        detail: `${g.genre} (${g.status})`,
        sublabel: `Game · ${g.genre} (${g.status})`,
        attachment: {
          kind: 'game',
          gameId: g.id,
          name: g.name,
        },
      });
    }

    // 5. Tasks
    for (const t of tasks) {
      if (!matchesQuery(t.title, t.status)) continue;
      items.push({
        id: `task:${t.id}`,
        kind: 'task',
        group: 'task',
        label: t.title,
        detail: t.status,
        sublabel: `Task · ${t.status}`,
        attachment: {
          kind: 'task',
          taskId: t.id,
          title: t.title,
        },
      });
    }

    return items.slice(0, 60);
  }

  async uploadFiles(
    studioId: string,
    input: UploadChatFilesInput,
  ): Promise<{ attachments: ChatAttachment[] }> {
    if (!Array.isArray(input.files) || input.files.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'No files provided for upload',
      );
    }

    const codingCfg = await getStudioCodingConfig({
      studioId,
      prisma: this.prisma,
    });
    const uploadId = `upl_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const uploadRoot = path.resolve(
      codingCfg.workspaceRoot,
      '.chat-uploads',
      uploadId,
    );
    await fs.mkdir(uploadRoot, { recursive: true });

    const attachments: ChatAttachment[] = [];
    let totalBytes = 0;
    let writtenCount = 0;

    for (const f of input.files.slice(0, 250)) {
      const rawRel = (f.relPath || f.name || 'file.txt')
        .replace(/\\/g, '/')
        .split('/')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s !== '.' && s !== '..')
        .join('/');
      const safeRel = rawRel || 'file.txt';
      const targetAbs = path.resolve(uploadRoot, safeRel);
      if (!targetAbs.startsWith(uploadRoot)) {
        continue;
      }

      const buf = Buffer.from(f.base64, 'base64');
      await fs.mkdir(path.dirname(targetAbs), { recursive: true });
      await fs.writeFile(targetAbs, buf);
      totalBytes += buf.byteLength;
      writtenCount += 1;

      if (input.mode !== 'folder') {
        const mimeType = (f.mimeType || 'application/octet-stream').toLowerCase();
        if (
          mimeType === 'image/png' ||
          mimeType === 'image/jpeg' ||
          mimeType === 'image/webp'
        ) {
          const mediaFile = await this.media.store(studioId, buf, mimeType);
          const dto = this.media.toDto(mediaFile);
          attachments.push({
            kind: 'image',
            mediaId: mediaFile.id,
            name: f.name || path.basename(safeRel),
            mimeType: mediaFile.mimeType,
            ...(mediaFile.width ? { width: mediaFile.width } : {}),
            ...(mediaFile.height ? { height: mediaFile.height } : {}),
            ...(dto?.url ? { previewUrl: dto.url } : {}),
          });
        } else {
          attachments.push({
            kind: 'upload_file',
            uploadId,
            relPath: safeRel,
            name: f.name || path.basename(safeRel),
            bytes: buf.byteLength,
            mimeType,
          });
        }
      }
    }

    if (input.mode === 'folder') {
      const folderName =
        (input.folderName || '').trim() ||
        input.files[0]?.relPath?.replace(/\\/g, '/').split('/')[0] ||
        'Folder';
      attachments.push({
        kind: 'upload_folder',
        uploadId,
        rootName: folderName,
        name: folderName,
        fileCount: writtenCount,
        bytes: totalBytes,
        totalBytes,
      });
    }

    return { attachments };
  }

  async pickLocalFolder(): Promise<{
    attachment: ChatAttachment | null;
    cancelled: boolean;
  }> {
    if (process.platform !== 'win32') {
      return { attachment: null, cancelled: true };
    }

    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.StartPosition = 'CenterScreen'
$owner.Width = 0
$owner.Height = 0
$owner.ShowInTaskbar = $false
$owner.Opacity = 0
$owner.Show()
$owner.Activate()
$dlg = New-Object System.Windows.Forms.FolderBrowserDialog
$dlg.Description = 'Select a folder to link to this chat (read-only access for the agent)'
$dlg.ShowNewFolderButton = $false
$res = $dlg.ShowDialog($owner)
$owner.Close()
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dlg.SelectedPath
}
`.trim();

    const selectedPath = await new Promise<string>((resolve) => {
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-Sta', '-Command', psScript],
        {
          stdio: ['ignore', 'pipe', 'ignore'],
          windowsHide: false,
        },
      );
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
      });
      child.on('error', () => resolve(''));
      child.on('close', () => resolve(out.trim()));
    });

    if (!selectedPath) {
      return { attachment: null, cancelled: true };
    }

    const absPath = path.resolve(selectedPath);
    const name = path.basename(absPath) || absPath;
    return {
      attachment: {
        kind: 'local_folder',
        absPath,
        name,
      },
      cancelled: false,
    };
  }

  async captureScreenshotAttachment(
    studioId: string,
    windowTitle?: string,
  ): Promise<{ attachment: ChatAttachment }> {
    const studio = await this.prisma.studio.findUnique({
      where: { id: studioId },
      select: { slug: true },
    });
    const obs = await this.pcAutomation.observeMainPc({
      studioId,
      studioSlug: studio?.slug ?? 'default',
      prisma: this.prisma,
      target: windowTitle?.trim() ? windowTitle.trim() : 'FULL_SCREEN',
      annotate: false,
    });

    if (!obs.mediaId) {
      throw new AppError(
        'INTERNAL',
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Failed to capture screenshot media file',
      );
    }

    const previewUrl = this.media.signUrl(obs.mediaId);
    const label =
      windowTitle?.trim() ||
      (obs.windowTitle && obs.windowTitle !== 'Desktop'
        ? obs.windowTitle
        : 'Desktop Screenshot');

    return {
      attachment: {
        kind: 'image',
        mediaId: obs.mediaId,
        name: `${label}.png`,
        mimeType: 'image/png',
        width: obs.width,
        height: obs.height,
        ...(previewUrl ? { previewUrl } : {}),
      },
    };
  }
}
