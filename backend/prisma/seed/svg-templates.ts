import { mulberry32 } from './prng.js';

export interface IconSvgParams {
  title: string;
  accent: string;
  glyph: string;
  seed: number;
}

export interface ThumbnailSvgParams {
  headline: string;
  sub: string;
  accent: string;
  seed: number;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function starPolygonPoints(cx: number, cy: number, outerR: number, innerR: number, points = 8): string {
  const coords: string[] = [];
  const total = points * 2;
  for (let i = 0; i < total; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = (cx + Math.cos(angle) * r).toFixed(1);
    const y = (cy + Math.sin(angle) * r).toFixed(1);
    coords.push(`${x},${y}`);
  }
  return coords.join(' ');
}

export const svgTemplates = {
  icon({ title, accent, glyph, seed }: IconSvgParams): string {
    const rng = mulberry32(seed);
    const sparkles: string[] = [];
    for (let i = 0; i < 18; i++) {
      const cx = (36 + rng() * 440).toFixed(1);
      const cy = (36 + rng() * 440).toFixed(1);
      const r = (2 + rng() * 4).toFixed(1);
      const op = (0.15 + rng() * 0.45).toFixed(2);
      sparkles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFFFFF" opacity="${op}" />`);
    }
    const starPts = starPolygonPoints(256, 256, 150, 72, 8);
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`,
      `  <title>${escapeXml(title)}</title>`,
      `  <defs>`,
      `    <radialGradient id="bg" cx="50%" cy="45%" r="65%">`,
      `      <stop offset="0%" stop-color="${escapeXml(accent)}" />`,
      `      <stop offset="100%" stop-color="#0B0C10" />`,
      `    </radialGradient>`,
      `  </defs>`,
      `  <rect width="512" height="512" fill="url(#bg)" />`,
      `  ${sparkles.join('\n  ')}`,
      `  <polygon points="${starPts}" fill="${escapeXml(accent)}" stroke="#FFFFFF" stroke-width="6" stroke-linejoin="round" />`,
      `  <text x="256" y="312" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="160" fill="#FFFFFF" stroke="#000000" stroke-width="8" paint-order="stroke fill">${escapeXml(glyph)}</text>`,
      `</svg>`,
    ].join('\n');
  },

  thumbnail({ headline, sub, accent, seed }: ThumbnailSvgParams): string {
    const rng = mulberry32(seed);
    const circles: string[] = [];
    for (let i = 0; i < 3; i++) {
      const cx = (980 + rng() * 760).toFixed(0);
      const cy = (180 + rng() * 720).toFixed(0);
      const r = (180 + rng() * 220).toFixed(0);
      const op = (0.12 + rng() * 0.16).toFixed(2);
      circles.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${escapeXml(accent)}" opacity="${op}" />`);
    }
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">`,
      `  <defs>`,
      `    <linearGradient id="tbg" x1="0%" y1="0%" x2="100%" y2="100%">`,
      `      <stop offset="0%" stop-color="${escapeXml(accent)}" />`,
      `      <stop offset="100%" stop-color="#12131A" />`,
      `    </linearGradient>`,
      `  </defs>`,
      `  <rect width="1920" height="1080" fill="url(#tbg)" />`,
      `  <polygon points="1180,0 1620,0 1040,1080 600,1080" fill="#FFFFFF" opacity="0.08" />`,
      `  ${circles.join('\n  ')}`,
      `  <text x="120" y="520" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="150" fill="#FFFFFF" stroke="#000000" stroke-width="10" paint-order="stroke fill">${escapeXml(headline)}</text>`,
      `  <text x="124" y="620" font-family="Arial, sans-serif" font-weight="700" font-size="56" fill="#E5E7EB" stroke="#000000" stroke-width="5" paint-order="stroke fill">${escapeXml(sub)}</text>`,
      `</svg>`,
    ].join('\n');
  },
};
