import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createE2eApp } from './setup-e2e.js';

describe('Snapshot E2E', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const setup = await createE2eApp();
    app = setup.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns complete StudioSnapshotDto for a newly provisioned studio', async () => {
    const server = app.getHttpServer();

    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        email: 'owner@snapshot.test',
        password: 'Password123!',
        displayName: 'Snapshot Owner',
        studioName: 'Snapshot Studio',
      })
      .expect(201);

    const token: string = reg.body.accessToken;
    const studioId: string = reg.body.memberships[0].studioId;

    const snapRes = await request(server)
      .get(`/api/studios/${studioId}/snapshot`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(snapRes.body.studio.id).toBe(studioId);
    expect(snapRes.body.myRole).toBe('OWNER');
    expect(snapRes.body.agents).toHaveLength(15);
    expect(snapRes.body.agents[0].key).toBe('lead');
    expect(snapRes.body.agents[14].key).toBe('reviewer');
    expect(snapRes.body.lanes).toHaveLength(2);
    expect(snapRes.body.counts).toMatchObject({
      needsYou: 0,
      working: 0,
      queued: 0,
      openTasks: 0,
    });
    expect(snapRes.body.setup.hasAnyLlmConnection).toBe(false);
    expect(snapRes.body.setup.unboundAgentKeys).toHaveLength(15);
  });
});
