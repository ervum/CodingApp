import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createE2eApp } from './setup-e2e.js';

describe('Vault E2E (save, 409 version conflict, backlinks)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const setup = await createE2eApp();
    app = setup.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('saves vault document revisions, enforces 409 VERSION_CONFLICT on stale baseVersion, and updates backlinks', async () => {
    const server = app.getHttpServer();

    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        email: 'vault@studio.test',
        password: 'Password123!',
        displayName: 'Vault Editor',
        studioName: 'Vault Studio',
      })
      .expect(201);

    const token: string = reg.body.accessToken;
    const studioId: string = reg.body.memberships[0].studioId;

    // 1. Load 05 UI and HUD by path
    const uiDocRes = await request(server)
      .get(`/api/studios/${studioId}/vault/by-path`)
      .query({ path: '05 UI and HUD/05 UI and HUD.md' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const uiDoc = uiDocRes.body;
    const initialVersion: number = uiDoc.version;

    // 2. Save a revision adding a wikilink to [[11 Thumbnails, Icons and the Store Page]]
    const updatedMarkdown = `${uiDoc.markdown}\n\nSee also [[11 Thumbnails, Icons and the Store Page]].\n`;
    const saveRes = await request(server)
      .put(`/api/studios/${studioId}/vault/documents/${uiDoc.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        markdown: updatedMarkdown,
        baseVersion: initialVersion,
        reason: 'Added store page cross-link',
      })
      .expect(200);

    expect(saveRes.body.version).toBe(initialVersion + 1);

    // 3. Stale baseVersion returns 409 VERSION_CONFLICT with currentVersion and currentMarkdown
    const conflictRes = await request(server)
      .put(`/api/studios/${studioId}/vault/documents/${uiDoc.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        markdown: '# Stale overwrite attempt',
        baseVersion: initialVersion,
      })
      .expect(409);

    expect(conflictRes.body.code).toBe('VERSION_CONFLICT');
    expect(conflictRes.body.details.currentVersion).toBe(initialVersion + 1);

    // 4. Verify backlinks on 11 Thumbnails, Icons and the Store Page include 05 UI and HUD
    const storeDocRes = await request(server)
      .get(`/api/studios/${studioId}/vault/by-path`)
      .query({ path: '11 Thumbnails, Icons and the Store Page/11 Thumbnails, Icons and the Store Page.md' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const backlinkTitles = (storeDocRes.body.backlinks as Array<{ title: string }>).map(
      (b) => b.title,
    );
    expect(backlinkTitles).toContain('05 UI and HUD');
  });
});
