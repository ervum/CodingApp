import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './setup-e2e.js';

describe('Review E2E (verdict rules & FIX_FIRST gate)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await createE2eApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks APPROVE on STAGE item when a FIX_FIRST blocker is OPEN, allows APPROVE once RESOLVED, and creates follow-up task on ASK_CHANGES', async () => {
    const server = app.getHttpServer();

    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        email: 'reviewer@studio.test',
        password: 'Password123!',
        displayName: 'Review Lead',
        studioName: 'Review Studio',
      })
      .expect(201);

    const token: string = reg.body.accessToken;
    const studioId: string = reg.body.memberships[0].studioId;

    const reviewerAgent = await prisma.agent.findUniqueOrThrow({
      where: { studioId_key: { studioId, key: 'reviewer' } },
    });

    const stageItem = await prisma.reviewItem.create({
      data: {
        studioId,
        kind: 'STAGE',
        tab: 'STAGES_PUBLISH',
        status: 'TO_REVIEW',
        title: 'Pre-publish QA stage v405',
        description: 'Stage gate review',
        madeByAgentId: reviewerAgent.id,
        payload: {
          buildVersion: 405,
          checklist: [{ label: 'Safe zones verified', done: true }],
        },
        iteration: 1,
      },
    });

    const blocker = await prisma.blocker.create({
      data: {
        studioId,
        reviewItemId: stageItem.id,
        agentId: reviewerAgent.id,
        severity: 'FIX_FIRST',
        status: 'OPEN',
        title: 'Close button clipped at 800x360',
        detail: 'Top-right close button overlaps top bar inset',
        buildVersion: 405,
      },
    });

    // 1. Attempting to APPROVE with an OPEN FIX_FIRST blocker returns 409 FIX_FIRST_BLOCKERS_OPEN
    const blockedApprove = await request(server)
      .post(`/api/studios/${studioId}/review-items/${stageItem.id}/verdict`)
      .set('Authorization', `Bearer ${token}`)
      .send({ verdict: 'APPROVE' })
      .expect(409);

    expect(blockedApprove.body.code).toBe('FIX_FIRST_BLOCKERS_OPEN');

    // 2. Resolve the blocker via PATCH /blockers/:blockerId
    await request(server)
      .patch(`/api/studios/${studioId}/blockers/${blocker.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'RESOLVED' })
      .expect(200);

    // 3. Now APPROVE succeeds
    const approvedRes = await request(server)
      .post(`/api/studios/${studioId}/review-items/${stageItem.id}/verdict`)
      .set('Authorization', `Bearer ${token}`)
      .send({ verdict: 'APPROVE', feedback: 'Looks great now' })
      .expect(201);

    expect(approvedRes.body.status).toBe('APPROVED');

    // 4. Test ASK_CHANGES creates a follow-up task for madeByAgent
    const splashAgent = await prisma.agent.findUniqueOrThrow({
      where: { studioId_key: { studioId, key: 'splash' } },
    });

    const iconItem = await prisma.reviewItem.create({
      data: {
        studioId,
        kind: 'ICON',
        tab: 'IMAGES_VIDEO',
        status: 'TO_REVIEW',
        title: 'Game Icon v1',
        description: 'Initial icon',
        madeByAgentId: splashAgent.id,
        iteration: 1,
      },
    });

    const changesRes = await request(server)
      .post(`/api/studios/${studioId}/review-items/${iconItem.id}/verdict`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        verdict: 'ASK_CHANGES',
        feedback: 'Increase contrast on the silhouette rim light at 64px.',
      })
      .expect(201);

    expect(changesRes.body.status).toBe('CHANGES_ASKED');

    const followUpTask = await prisma.task.findFirst({
      where: {
        studioId,
        agentId: splashAgent.id,
        origin: 'REVIEW_FEEDBACK',
      },
    });
    expect(followUpTask).toBeTruthy();
    expect(followUpTask?.title).toContain('Revise: Game Icon v1');
  });
});
