import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import type {
  CreateStudioAssetRequest,
  ListStudioAssetsQuery,
  StudioAssetDto,
  UpdateStudioAssetRequest,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import { bigIntToString } from '../../common/serialization/bigint.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MediaService } from '../media/media.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const ASSET_INCLUDE = {
  media: true,
  curatedByAgent: { select: { id: true, key: true } },
} satisfies Prisma.StudioAssetInclude;

type AssetWithRelations = Prisma.StudioAssetGetPayload<{
  include: typeof ASSET_INCLUDE;
}>;

@Injectable()
export class AssetsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly realtime: RealtimeService,
  ) {}

  async onModuleInit(): Promise<void> {
    const studios = await this.prisma.studio
      .findMany({ select: { id: true } })
      .catch(() => []);
    for (const s of studios) {
      const count = await this.prisma.studioAsset
        .count({ where: { studioId: s.id } })
        .catch(() => 1);
      if (count === 0) {
        await this.prisma.studioAsset
          .createMany({
            data: [
              {
                studioId: s.id,
                kind: 'AUDIO',
                name: 'Coin Pickup Chime',
                notes: 'Bright 2-note synth arpeggio for currency collection',
                robloxAssetId: BigInt('9118823101'),
                tags: ['sfx', 'ui', 'currency'],
              },
              {
                studioId: s.id,
                kind: 'IMAGE',
                name: '9-Slice Neon Frame',
                notes:
                  'High-contrast rounded HUD panel border for 108s mobile readability',
                robloxAssetId: BigInt('10847291042'),
                tags: ['hud', '9-slice', 'mobile'],
              },
              {
                studioId: s.id,
                kind: 'MESH',
                name: 'Modular Speed Pad',
                notes:
                  'Low-poly glowing booster pad with attachment points for trails',
                robloxAssetId: BigInt('12490817230'),
                tags: ['obby', 'prop', 'gameplay'],
              },
            ],
          })
          .catch(() => {});
      }
    }
  }

  async list(
    studioId: string,
    query: ListStudioAssetsQuery,
  ): Promise<StudioAssetDto[]> {
    const q = query.q?.trim();
    const tag = query.tag?.trim().toLowerCase();
    const numericId = this.parseRobloxAssetBigInt(q);
    const rows = await this.prisma.studioAsset.findMany({
      where: {
        studioId,
        ...(query.kind ? { kind: query.kind } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { notes: { contains: q, mode: 'insensitive' } },
                { tags: { has: q.toLowerCase() } },
                ...(numericId !== null ? [{ robloxAssetId: numericId }] : []),
              ],
            }
          : {}),
      },
      include: ASSET_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    studioId: string,
    body: CreateStudioAssetRequest,
    createdByAgentId?: string | null,
  ): Promise<StudioAssetDto> {
    const created = await this.prisma.studioAsset.create({
      data: {
        studioId,
        kind: body.kind,
        name: body.name.trim(),
        notes: body.notes?.trim() ?? '',
        robloxAssetId: this.parseRobloxAssetBigInt(body.robloxAssetId),
        mediaId: body.mediaId ?? null,
        curatedByAgentId: createdByAgentId ?? null,
        tags: body.tags ?? [],
      },
      include: ASSET_INCLUDE,
    });

    const dto = this.toDto(created);
    this.realtime.emitToStudio(studioId, 'asset:updated', {
      asset: dto,
      change: 'created',
    });
    return dto;
  }

  async upload(
    studioId: string,
    file: { buffer: Buffer; mimetype: string; size: number } | undefined,
    body: CreateStudioAssetRequest,
  ): Promise<StudioAssetDto> {
    let mediaId = body.mediaId ?? null;
    if (file) {
      const stored = await this.media.store(studioId, file.buffer, file.mimetype);
      mediaId = stored.id;
    }
    return this.create(studioId, { ...body, mediaId });
  }

  async update(
    studioId: string,
    assetId: string,
    body: UpdateStudioAssetRequest,
  ): Promise<StudioAssetDto> {
    const existing = await this.prisma.studioAsset.findFirst({
      where: { id: assetId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio asset not found');
    }

    const updated = await this.prisma.studioAsset.update({
      where: { id: existing.id },
      data: {
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.notes !== undefined
          ? { notes: body.notes.trim() }
          : {}),
        ...(body.robloxAssetId !== undefined
          ? { robloxAssetId: this.parseRobloxAssetBigInt(body.robloxAssetId) }
          : {}),
        ...(body.tags !== undefined ? { tags: body.tags } : {}),
      },
      include: ASSET_INCLUDE,
    });

    const dto = this.toDto(updated);
    this.realtime.emitToStudio(studioId, 'asset:updated', {
      asset: dto,
      change: 'updated',
    });
    return dto;
  }

  async delete(studioId: string, assetId: string): Promise<{ deletedId: string }> {
    const existing = await this.prisma.studioAsset.findFirst({
      where: { id: assetId, studioId },
      include: ASSET_INCLUDE,
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Studio asset not found');
    }
    const dto = this.toDto(existing);
    await this.prisma.studioAsset.delete({ where: { id: existing.id } });
    this.realtime.emitToStudio(studioId, 'asset:updated', {
      asset: dto,
      change: 'deleted',
    });
    return { deletedId: existing.id };
  }

  private parseRobloxAssetBigInt(raw?: string | null): bigint | null {
    if (!raw) return null;
    const digits = raw.replace(/^rbxassetid:\/\//i, '').trim();
    if (!/^\d+$/.test(digits)) return null;
    try {
      return BigInt(digits);
    } catch {
      return null;
    }
  }

  toDto(row: AssetWithRelations): StudioAssetDto {
    const rawId = bigIntToString(row.robloxAssetId);
    const mediaDto = this.media.toDto(row.media);
    return {
      id: row.id,
      studioId: row.studioId,
      kind: row.kind,
      name: row.name,
      tags: row.tags,
      mediaId: row.mediaId,
      mediaUrl: mediaDto?.url ?? null,
      mimeType: mediaDto?.mimeType ?? null,
      robloxAssetId: rawId,
      notes: row.notes,
      curatedByAgentKey: row.curatedByAgent?.key ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
