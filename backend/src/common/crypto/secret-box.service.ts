import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';

export interface SealedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

export interface SecretBox {
  seal(plain: string): SealedSecret;
  open(sealed: SealedSecret): string;
}

export function createSecretBox(masterKeyB64: string): SecretBox {
  const key = Buffer.from(masterKeyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('SECRETS_MASTER_KEY must decode to exactly 32 bytes');
  }
  return {
    seal(plain: string): SealedSecret {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        ciphertext: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
      };
    },
    open(sealed: SealedSecret): string {
      const iv = Buffer.from(sealed.iv, 'base64');
      const tag = Buffer.from(sealed.tag, 'base64');
      const encrypted = Buffer.from(sealed.ciphertext, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    },
  };
}

@Injectable()
export class SecretBoxService implements SecretBox {
  private readonly box: SecretBox;

  constructor(@Optional() config?: AppConfigService) {
    const masterKey = config?.secretsMasterKey ?? process.env['SECRETS_MASTER_KEY'];
    if (!masterKey) {
      throw new Error('SECRETS_MASTER_KEY is required');
    }
    this.box = createSecretBox(masterKey);
  }

  seal(plain: string): SealedSecret {
    return this.box.seal(plain);
  }

  open(sealed: SealedSecret): string {
    return this.box.open(sealed);
  }
}
