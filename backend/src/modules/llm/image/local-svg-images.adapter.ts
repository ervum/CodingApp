import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { LlmError, type ResolvedConnection } from '../adapters/llm-adapter.interface.js';
import {
  normalizeGeneratedImage,
  type ImageAdapter,
  type ImageGenerateRequest,
  type ImageGenerateResult,
} from './image-adapter.interface.js';

@Injectable()
export class LocalSvgImagesAdapter implements ImageAdapter {
  async generate(
    conn: ResolvedConnection,
    req: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageGenerateResult> {
    const width = req.width || 512;
    const height = req.height || 512;

    if (conn.baseUrl) {
      const sdBytes = await this.tryAutomatic1111(conn.baseUrl, req.prompt, width, height, signal);
      if (sdBytes) {
        return normalizeGeneratedImage(sdBytes, width, height);
      }
    }

    const svg = this.buildProceduralGameArtSvg(req.prompt, width, height);
    try {
      const data = await sharp(Buffer.from(svg, 'utf-8'))
        .resize(width, height, { fit: 'cover' })
        .png({ compressionLevel: 8 })
        .toBuffer();

      return {
        data,
        mimeType: 'image/png',
      };
    } catch (err) {
      throw new LlmError(
        'PROVIDER_BAD_REQUEST',
        `Local image synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async tryAutomatic1111(
    baseUrl: string,
    prompt: string,
    width: number,
    height: number,
    signal: AbortSignal,
  ): Promise<Buffer | null> {
    try {
      const root = baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
      const res = await fetch(`${root}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt,
          steps: 20,
          width: Math.min(width, 1024),
          height: Math.min(height, 1024),
        }),
        signal,
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { images?: string[] };
      const b64 = data.images?.[0];
      if (!b64) return null;
      return Buffer.from(b64, 'base64');
    } catch {
      return null;
    }
  }

  private buildProceduralGameArtSvg(
    prompt: string,
    width: number,
    height: number,
  ): string {
    const cleanTitle = prompt
      .replace(/[<>&"']/g, '')
      .trim()
      .slice(0, 42)
      .toUpperCase();
    const cx = Math.round(width / 2);
    const cy = Math.round(height / 2);
    const r = Math.round(Math.min(width, height) * 0.32);
    const fontSize = Math.round(Math.min(width, height) * 0.068);

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0B0C10"/>
          <stop offset="50%" stop-color="#1E1B4B"/>
          <stop offset="100%" stop-color="#4C1D95"/>
        </linearGradient>
        <radialGradient id="flare" cx="50%" cy="45%" r="48%">
          <stop offset="0%" stop-color="#A855F7" stop-opacity="0.85"/>
          <stop offset="55%" stop-color="#7C3AED" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#0B0C10" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#bg)"/>
      <circle cx="${cx}" cy="${cy}" r="${r * 1.4}" fill="url(#flare)"/>
      <polygon points="${cx},${cy - r} ${cx + r * 0.88},${cy + r * 0.62} ${cx - r * 0.88},${cy + r * 0.62}" fill="#22C55E" fill-opacity="0.22" stroke="#A855F7" stroke-width="6"/>
      <circle cx="${cx}" cy="${cy - r * 0.1}" r="${r * 0.42}" fill="#F59E0B" stroke="#FFFFFF" stroke-width="5"/>
      <text x="${cx}" y="${height - Math.round(height * 0.12)}" text-anchor="middle" fill="#FFFFFF" font-family="Impact, Arial Black, sans-serif" font-weight="900" font-size="${fontSize}" stroke="#0B0C10" stroke-width="4">${cleanTitle || 'ROBDEV STUDIO'}</text>
    </svg>`;
  }
}
