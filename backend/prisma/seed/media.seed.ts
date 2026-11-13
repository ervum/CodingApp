import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { MediaFile, PrismaClient } from '../../src/generated/prisma/client.js';
import type { SeededGames } from './games.seed.js';
import { SEED_IDS } from './ids.js';
import type { Prng } from './prng.js';
import type { SeededStudioContext } from './studios.seed.js';
import { svgTemplates } from './svg-templates.js';

export type MediaKey = keyof typeof SEED_IDS.media;
export type SeededMedia = Record<MediaKey, MediaFile>;

export async function seedMedia(
  prisma: PrismaClient,
  studioCtx: SeededStudioContext,
  games: SeededGames,
  _rng: Prng,
): Promise<SeededMedia> {
  const storageRoot = path.resolve(process.env['MEDIA_STORAGE_ROOT'] || './storage/media');
  const studioId = studioCtx.inclined.id;
  const studioMediaDir = path.join(storageRoot, studioId);
  fs.mkdirSync(studioMediaDir, { recursive: true });

  const specs: ReadonlyArray<{
    key: MediaKey;
    svg: string;
  }> = [
    {
      key: 'icon-aar-v2',
      svg: svgTemplates.icon({ title: 'Shogun Awakening', accent: '#A855F7', glyph: 'AW', seed: 2 }),
    },
    {
      key: 'icon-aar-v3',
      svg: svgTemplates.icon({ title: 'Shogun Awakening', accent: '#7C3AED', glyph: 'AW', seed: 3 }),
    },
    {
      key: 'thumb-aar-boss',
      svg: svgTemplates.thumbnail({
        headline: 'RAID BOSS',
        sub: 'Hollow Shogun has awakened',
        accent: '#A855F7',
        seed: 11,
      }),
    },
    {
      key: 'thumb-aar-10m',
      svg: svgTemplates.thumbnail({
        headline: '1 IN 10M',
        sub: 'Roll the Void Emperor',
        accent: '#EC4899',
        seed: 12,
      }),
    },
    {
      key: 'board-aar-trailer',
      svg: svgTemplates.thumbnail({
        headline: 'SHOT 3',
        sub: 'Shogun draws his blade · 2.5s',
        accent: '#6366F1',
        seed: 13,
      }),
    },
    {
      key: 'icon-dino-v1',
      svg: svgTemplates.icon({ title: 'Dig Up a Dino', accent: '#F59E0B', glyph: 'DD', seed: 21 }),
    },
    {
      key: 'thumb-dino-sunset',
      svg: svgTemplates.thumbnail({
        headline: 'DIG DEEP',
        sub: 'Amber Canyon at sunset',
        accent: '#F97316',
        seed: 22,
      }),
    },
    {
      key: 'thumb-dino-museum',
      svg: svgTemplates.thumbnail({
        headline: 'BUILD YOUR MUSEUM',
        sub: '40+ dinosaurs to uncover',
        accent: '#EAB308',
        seed: 23,
      }),
    },
  ];

  const out = {} as SeededMedia;

  for (const spec of specs) {
    const mediaId = SEED_IDS.media[spec.key];
    const pngBuffer = await sharp(Buffer.from(spec.svg, 'utf8'))
      .png({ compressionLevel: 9 })
      .toBuffer();
    const metadata = await sharp(pngBuffer).metadata();
    const sha256 = createHash('sha256').update(pngBuffer).digest('hex');
    const storageKey = `${studioId}/${mediaId}.png`;
    const diskPath = path.join(storageRoot, storageKey);
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, pngBuffer);

    const record = await prisma.mediaFile.create({
      data: {
        id: mediaId,
        studioId,
        storageKey,
        mimeType: 'image/png',
        width: metadata.width ?? null,
        height: metadata.height ?? null,
        bytes: pngBuffer.byteLength,
        durationSec: null,
        sha256,
      },
    });
    out[spec.key] = record;
  }

  // Link game icons per Section 6.4
  await prisma.game.update({
    where: { id: games.aar.id },
    data: { iconMediaId: out['icon-aar-v3'].id },
  });
  await prisma.game.update({
    where: { id: games.dino.id },
    data: { iconMediaId: out['icon-dino-v1'].id },
  });

  // Seed the 4 StudioAssets for Library (Assets 4)
  const librarian = studioCtx.agentsByKey.librarian;
  await prisma.studioAsset.createMany({
    data: [
      {
        studioId,
        kind: 'IMAGE',
        name: 'Aura Rarity Ladder',
        tags: ['ui', 'rarity', 'awakening', 'game-one'],
        mediaId: out['thumb-aar-10m'].id,
        robloxAssetId: 14892019482n,
        notes: '7-tier rarity badge ladder & colour tokens (Common to Secret)',
        curatedByAgentId: librarian.id,
      },
      {
        studioId,
        kind: 'MESH',
        name: 'Zone 1 Arena Scaffold',
        tags: ['model', 'arena', 'zone-1', 'low-poly'],
        mediaId: out['board-aar-trailer'].id,
        robloxAssetId: 14892033104n,
        notes: 'Modular 3D combat ring & landmark obelisk under 1,400 tris',
        curatedByAgentId: librarian.id,
      },
      {
        studioId,
        kind: 'IMAGE',
        name: 'Shop Layout',
        tags: ['ui', 'shop', 'monetisation', 'mobile-safe'],
        mediaId: out['thumb-aar-boss'].id,
        robloxAssetId: 14892058911n,
        notes: 'Darkened Awakening 3-card shop modal with 844×390 safe insets',
        curatedByAgentId: librarian.id,
      },
      {
        studioId,
        kind: 'AUDIO',
        name: 'Static Boom Sound',
        tags: ['audio', 'sfx', 'reveal', 'impact'],
        mediaId: null,
        robloxAssetId: 14892089120n,
        notes: 'Sub-drop + crystalline chime transient for Mythic/Secret rolls (1.8s)',
        curatedByAgentId: librarian.id,
      },
    ],
  });

  return out;
}
