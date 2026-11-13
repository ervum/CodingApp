import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSecretBox } from './secret-box.service.js';

describe('SecretBoxService', () => {
  const validKey = randomBytes(32).toString('base64');

  it('seals and opens a secret round-trip with distinct IVs', () => {
    const box = createSecretBox(validKey);
    const plain = 'sk-proj-super-secret-api-key-123456';
    const sealed1 = box.seal(plain);
    const sealed2 = box.seal(plain);

    expect(sealed1.iv).not.toBe(sealed2.iv);
    expect(sealed1.ciphertext).not.toBe(sealed2.ciphertext);
    expect(box.open(sealed1)).toBe(plain);
    expect(box.open(sealed2)).toBe(plain);
  });

  it('rejects tampered ciphertext or auth tag', () => {
    const box = createSecretBox(validKey);
    const sealed = box.seal('sk-ant-secret');

    const badTag = Buffer.from(sealed.tag, 'base64');
    badTag[0] = (badTag[0] ?? 0) ^ 0xff;
    expect(() =>
      box.open({
        ...sealed,
        tag: badTag.toString('base64'),
      }),
    ).toThrow();
  });

  it('rejects keys that do not decode to 32 bytes', () => {
    expect(() => createSecretBox(Buffer.from('short').toString('base64'))).toThrow(
      /exactly 32 bytes/,
    );
  });
});
