import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { MediaDto } from '@robdev/shared';
import sharp from 'sharp';
import { UrlSignerService } from '../../common/crypto/url-signer.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { AppConfigService } from '../../config/app-config.service.js';
import type { MediaFile } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
};

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly signer: UrlSignerService,
  ) {}

  async store(
    studioId: string,
    buffer: Buffer,
    mimeType: string,
    durationSec?: number | null,
  ): Promise<MediaFile> {
    const ext = MIME_TO_EXT[mimeType];
    if (!ext) {
      throw new AppError(
        'VALIDATION_FAILED',
        HttpStatus.BAD_REQUEST,
        `Unsupported media mimeType: ${mimeType}`,
      );
    }

    let width: number | null = null;
    let height: number | null = null;
    if (mimeType.startsWith('image/')) {
      const meta = await sharp(buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
    }

    const mediaId = `med_${randomUUID().replace(/-/g, '')}`;
    const storageKey = `${studioId}/${mediaId}.${ext}`;
    const absPath = this.resolvePath(storageKey);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, buffer);

    const sha256 = createHash('sha256').update(buffer).digest('hex');

    return this.prisma.mediaFile.create({
      data: {
        id: mediaId,
        studioId,
        storageKey,
        mimeType,
        width,
        height,
        bytes: buffer.byteLength,
        durationSec: durationSec ?? null,
        sha256,
      },
    });
  }

  toDto(file: MediaFile | null | undefined): MediaDto | null {
    if (!file) return null;
    return {
      id: file.id,
      url: this.signer.sign(file.id),
      mimeType: file.mimeType,
      width: file.width,
      height: file.height,
      bytes: file.bytes,
      durationSec: file.durationSec,
    };
  }

  signUrl(mediaId: string | null | undefined): string | null {
    if (!mediaId) return null;
    return this.signer.sign(mediaId);
  }

  resolvePath(storageKey: string): string {
    return path.resolve(this.config.mediaStorageRoot, storageKey);
  }
}
