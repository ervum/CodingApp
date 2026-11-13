import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { UrlSignerService } from '../../common/crypto/url-signer.service.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { AppError } from '../../common/errors/app-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { getWorkspaceRoots } from '../orchestrator/tools/terminal-and-permissions.helper.js';
import { MediaService } from './media.service.js';

const EXT_TO_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.luau': 'text/plain; charset=utf-8',
  '.lua': 'text/plain; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.tsx': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.xml': 'text/plain; charset=utf-8',
  '.rbxlx': 'text/plain; charset=utf-8',
  '.rbxmx': 'text/plain; charset=utf-8',
  '.yaml': 'text/plain; charset=utf-8',
  '.yml': 'text/plain; charset=utf-8',
  '.ps1': 'text/plain; charset=utf-8',
  '.sh': 'text/plain; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
};

@Controller('media')
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly signer: UrlSignerService,
  ) {}

  private async fileExists(candidatePath: string): Promise<boolean> {
    try {
      const st = await fs.stat(candidatePath);
      return st.isFile();
    } catch {
      return false;
    }
  }

  private async resolveRequestedFilePath(
    rawInputPath: string,
    studioSlug?: string,
  ): Promise<string | null> {
    let cleaned = (rawInputPath ?? '').trim();
    if (!cleaned) return null;

    cleaned = cleaned.replace(/^["'`]+|["'`]+$/g, '').trim();
    if (/^file:\/\//i.test(cleaned)) {
      cleaned = decodeURIComponent(cleaned.replace(/^file:\/\/\/?/i, ''));
    }

    const candidates: string[] = [];
    if (path.isAbsolute(cleaned) || /^[A-Za-z]:[\\/]/.test(cleaned)) {
      candidates.push(path.normalize(cleaned));
    }

    const { topWorkspaceRoot, studioWorkspaceRoot } = getWorkspaceRoots(
      studioSlug || 'default',
    );
    const relCleaned = cleaned.replace(/^[\\/]+/, '');
    const homeDir = os.homedir();
    candidates.push(
      path.resolve(studioWorkspaceRoot, relCleaned),
      path.resolve(topWorkspaceRoot, relCleaned),
      path.resolve(process.cwd(), relCleaned),
      path.resolve(process.cwd(), '..', relCleaned),
      path.resolve(process.cwd(), '..', '..', relCleaned),
      path.resolve(homeDir, relCleaned),
    );

    const baseName = path.basename(cleaned);
    if (baseName) {
      candidates.push(
        path.join(studioWorkspaceRoot, 'Screenshots', baseName),
        path.join(topWorkspaceRoot, 'ervum-games', 'Screenshots', baseName),
        path.join(topWorkspaceRoot, 'inclined-games', 'Screenshots', baseName),
        path.resolve(process.cwd(), 'storage', 'media', 'screenshots', baseName),
        path.resolve(process.cwd(), 'data', 'media', 'screenshots', baseName),
        path.resolve(process.cwd(), '..', 'storage', 'media', 'screenshots', baseName),
        path.resolve(process.cwd(), '..', 'data', 'media', 'screenshots', baseName),
        path.join(homeDir, 'Downloads', baseName),
        path.join(homeDir, 'Desktop', baseName),
        path.join(homeDir, 'Documents', baseName),
        path.join(homeDir, baseName),
      );
    }

    for (const cand of candidates) {
      if (await this.fileExists(cand)) {
        return cand;
      }
    }

    if (baseName) {
      const mediaRow = await this.prisma.mediaFile
        ?.findFirst?.({
          where: { storageKey: { endsWith: baseName } },
          orderBy: { createdAt: 'desc' },
        })
        .catch(() => null);
      if (mediaRow) {
        const resolvedMedia = await this.resolveMediaDiskPath(
          mediaRow.storageKey,
        );
        if (resolvedMedia) return resolvedMedia;
      }
    }

    return null;
  }

  private async resolveMediaDiskPath(storageKey: string): Promise<string | null> {
    const primary = this.media.resolvePath(storageKey);
    if (await this.fileExists(primary)) return primary;

    const legacyDataMedia = path.resolve(process.cwd(), 'data', 'media', storageKey);
    if (await this.fileExists(legacyDataMedia)) return legacyDataMedia;

    const baseName = path.basename(storageKey);
    const { topWorkspaceRoot } = getWorkspaceRoots('default');
    const studioDirs = await fs.readdir(topWorkspaceRoot).catch(() => [] as string[]);
    for (const dir of studioDirs) {
      const candidate = path.join(topWorkspaceRoot, dir, 'Screenshots', baseName);
      if (await this.fileExists(candidate)) return candidate;
    }

    return null;
  }

  @Public()
  @Get('by-path')
  async streamByPath(
    @Query('path') rawPath: string | undefined,
    @Query('studioSlug') studioSlug: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!rawPath || !rawPath.trim()) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'Missing `path` query parameter',
      );
    }

    const absPath = await this.resolveRequestedFilePath(rawPath, studioSlug);
    if (!absPath) {
      throw new AppError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        `File not found on disk: ${rawPath}`,
      );
    }

    const ext = path.extname(absPath).toLowerCase();
    const mimeType = EXT_TO_MIME[ext] ?? 'application/octet-stream';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(absPath);
  }

  @Public()
  @Post('open-with')
  async openWithDialog(
    @Body() body: { path?: string; studioSlug?: string } | undefined,
  ): Promise<{ ok: boolean; path: string }> {
    const rawPath = body?.path?.trim() ?? '';
    if (!rawPath) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        'Missing `path` in request body',
      );
    }

    const absPath = await this.resolveRequestedFilePath(
      rawPath,
      body?.studioSlug,
    );
    if (!absPath) {
      throw new AppError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        `File not found on disk: ${rawPath}`,
      );
    }

    const winPath = absPath.replace(/\//g, '\\');
    const child = spawn(
      'rundll32.exe',
      ['shell32.dll,OpenAs_RunDLL', winPath],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      },
    );
    child.unref();

    return {
      ok: true,
      path: winPath,
    };
  }

  @Public()
  @Get(':mediaId')
  async stream(
    @Param('mediaId') mediaId: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if ((exp !== undefined || sig !== undefined) && !this.signer.verify(mediaId, exp, sig)) {
      throw new AppError('FORBIDDEN', HttpStatus.FORBIDDEN, 'Invalid or expired media signature');
    }

    const file = await this.prisma.mediaFile.findUnique({ where: { id: mediaId } });
    if (!file) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Media file not found');
    }

    const absPath = await this.resolveMediaDiskPath(file.storageKey);
    if (!absPath) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Media file missing on disk');
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(absPath);
  }
}
