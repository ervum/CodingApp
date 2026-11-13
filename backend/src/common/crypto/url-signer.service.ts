import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';

@Injectable()
export class UrlSignerService {
  constructor(private readonly config: AppConfigService) {}

  sign(mediaId: string, ttlSec = 3600): string {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const sig = this.computeSignature(mediaId, exp);
    return `/api/media/${encodeURIComponent(mediaId)}?exp=${exp}&sig=${sig}`;
  }

  verify(mediaId: string, expRaw: string | undefined, sigRaw: string | undefined): boolean {
    if (!expRaw || !sigRaw) return false;
    const exp = Number(expRaw);
    if (!Number.isInteger(exp) || exp < Math.floor(Date.now() / 1000)) {
      return false;
    }
    const expectedHex = this.computeSignature(mediaId, exp);
    const actualBuf = Buffer.from(sigRaw, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (actualBuf.length !== expectedBuf.length || actualBuf.length === 0) {
      return false;
    }
    return timingSafeEqual(actualBuf, expectedBuf);
  }

  private computeSignature(mediaId: string, exp: number): string {
    return createHmac('sha256', this.config.mediaUrlSigningSecret)
      .update(`${mediaId}.${exp}`)
      .digest('hex');
  }
}
