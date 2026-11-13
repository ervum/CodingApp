import sharp from 'sharp';
import type { ResolvedConnection } from '../adapters/llm-adapter.interface.js';

export interface ImageGenerateRequest {
  model: string;
  prompt: string;
  width: number;
  height: number;
}

export interface ImageGenerateResult {
  data: Buffer;
  mimeType: string;
}

export interface ImageAdapter {
  generate(
    conn: ResolvedConnection,
    req: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageGenerateResult>;
}

export async function normalizeGeneratedImage(
  raw: Buffer,
  width: number,
  height: number,
): Promise<ImageGenerateResult> {
  const normalized = await sharp(raw).resize(width, height, { fit: 'cover' }).png().toBuffer();
  return {
    data: normalized,
    mimeType: 'image/png',
  };
}
