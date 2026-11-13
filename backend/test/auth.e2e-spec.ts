import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createE2eApp } from './setup-e2e.js';

function extractCookie(setCookieHeader: string | string[] | undefined, name: string): string | null {
  if (!setCookieHeader) return null;
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const item of list) {
    if (item.startsWith(`${name}=`)) {
      return item.split(';')[0] ?? null;
    }
  }
  return null;
}

describe('Auth E2E (register, login, refresh rotation, reuse detection)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const setup = await createE2eApp();
    app = setup.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a user with studio provisioning, rotates refresh tokens, and revokes family on reuse', async () => {
    const server = app.getHttpServer();

    // 1. Register
    const regRes = await request(server)
      .post('/api/auth/register')
      .send({
        email: 'founder@inclined.test',
        password: 'Password123!',
        displayName: 'Founder',
        studioName: 'Test Studio',
      })
      .expect(201);

    expect(regRes.body.accessToken).toBeDefined();
    expect(regRes.body.user.email).toBe('founder@inclined.test');
    expect(regRes.body.memberships).toHaveLength(1);
    expect(regRes.body.memberships[0].role).toBe('OWNER');

    const cookie1 = extractCookie(regRes.headers['set-cookie'], 'rd_refresh');
    expect(cookie1).toBeTruthy();

    // 2. Invalid login returns 401 INVALID_CREDENTIALS
    const badLogin = await request(server)
      .post('/api/auth/login')
      .send({
        email: 'founder@inclined.test',
        password: 'WrongPassword999!',
      })
      .expect(401);
    expect(badLogin.body.code).toBe('INVALID_CREDENTIALS');

    // 3. Refresh token rotation (cookie1 -> cookie2)
    const refresh1 = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', [cookie1!])
      .expect(200);

    expect(refresh1.body.accessToken).toBeDefined();
    const cookie2 = extractCookie(refresh1.headers['set-cookie'], 'rd_refresh');
    expect(cookie2).toBeTruthy();
    expect(cookie2).not.toBe(cookie1);

    // 4. Reuse detection: presenting already-used cookie1 revokes the entire token family!
    const reuseRes = await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', [cookie1!])
      .expect(401);
    expect(reuseRes.body.code).toBe('UNAUTHENTICATED');

    // 5. Verify cookie2 is now also revoked because the family was compromised
    await request(server)
      .post('/api/auth/refresh')
      .set('Cookie', [cookie2!])
      .expect(401);
  });
});
