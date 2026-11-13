import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrchestratorService } from '../src/modules/orchestrator/orchestrator.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { ScriptedLlmAdapter } from '../src/test-support/scripted-llm.adapter.js';
import { createE2eApp } from './setup-e2e.js';

describe('Orchestrator E2E (ScriptedLlmAdapter run execution)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const scriptedLlm = new ScriptedLlmAdapter();

  beforeAll(async () => {
    const setup = await createE2eApp({ scriptedLlm });
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await app.close();
  });

  it('claims a QUEUED task, injects vault docs, executes tool calls (delegate_task + save_artifact), and finishes with ordered log seq', async () => {
    const server = app.getHttpServer();

    const reg = await request(server)
      .post('/api/auth/register')
      .send({
        email: 'lead@orchestrator.test',
        password: 'Password123!',
        displayName: 'Studio Director',
        studioName: 'Orchestrator Studio',
      })
      .expect(201);

    const token: string = reg.body.accessToken;
    const studioId: string = reg.body.memberships[0].studioId;

    // 1. Create an LLM connection and bind Lead to it (granting save_artifact as well for the test)
    const connRes = await request(server)
      .post(`/api/studios/${studioId}/llm/connections`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'OPENAI',
        label: 'Scripted Test Provider',
        apiKey: 'sk-test-scripted-key-123456',
      })
      .expect(201);

    const connectionId: string = connRes.body.id;

    await request(server)
      .patch(`/api/studios/${studioId}/agents/lead`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        llmConnectionId: connectionId,
        modelId: 'scripted-model-v1',
      })
      .expect(200);

    await prisma.agent.update({
      where: { studioId_key: { studioId, key: 'lead' } },
      data: {
        tools: ['vault_search', 'vault_read', 'request_human', 'delegate_task', 'save_artifact'],
      },
    });

    // 2. Script 2 turns on ScriptedLlmAdapter
    scriptedLlm.setTurns([
      [
        { type: 'text-delta', text: 'Planning the combat system and delegating to Builder.\n' },
        {
          type: 'tool-call',
          call: {
            id: 'call_delegate_1',
            name: 'delegate_task',
            argumentsJson: JSON.stringify({
              agentKey: 'builder',
              title: 'Build Hollow Shogun server combat script',
              brief: 'Implement strict server-authoritative combat state machine per [13 Building It Right].',
              priority: 'HIGH',
              tags: ['combat', 'luau'],
            }),
          },
        },
        {
          type: 'tool-call',
          call: {
            id: 'call_artifact_1',
            name: 'save_artifact',
            argumentsJson: JSON.stringify({
              path: 'Blueprints/CombatPlan.md',
              language: 'markdown',
              content: '# Combat Plan\n\n- Phase 1: Parry window\n- Phase 2: Boss telegraph',
            }),
          },
        },
        { type: 'usage', inputTokens: 450, outputTokens: 120 },
        { type: 'finish', reason: 'tool_calls' },
      ],
      [
        {
          type: 'text-delta',
          text: '## Result\n- Delegated combat script to Builder.\n- Saved `Blueprints/CombatPlan.md`.',
        },
        { type: 'usage', inputTokens: 620, outputTokens: 80 },
        { type: 'finish', reason: 'stop' },
      ],
    ]);

    // 3. Create task via /lead/ask
    const askRes = await request(server)
      .post(`/api/studios/${studioId}/lead/ask`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        prompt: 'Plan the Hollow Shogun boss fight and delegate the Luau implementation to Builder.',
      })
      .expect(201);

    const parentTaskId: string = askRes.body.task.id;

    // 4. Trigger orchestrator tick and wait for run completion
    const orchestrator = app.get(OrchestratorService);
    const startedRunIds = await orchestrator.tick();
    expect(startedRunIds).toHaveLength(1);
    const runId = startedRunIds[0]!;

    // Poll until run status is SUCCEEDED
    for (let i = 0; i < 50; i++) {
      const r = await prisma.agentRun.findUnique({ where: { id: runId } });
      if (r && r.status !== 'RUNNING') break;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }

    // 5. Verify run detail via GET /runs/:runId
    const runDetailRes = await request(server)
      .get(`/api/studios/${studioId}/runs/${runId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const runDetail = runDetailRes.body;
    expect(runDetail.status).toBe('SUCCEEDED');
    expect(runDetail.toolCallCount).toBe(2);
    expect(runDetail.injectedDocs.length).toBeGreaterThanOrEqual(2);
    expect(runDetail.artifacts).toHaveLength(1);
    expect(runDetail.artifacts[0].path).toBe('Blueprints/CombatPlan.md');

    const seqs = (runDetail.entries as Array<{ seq: number }>).map((e) => e.seq);
    expect(seqs).toEqual(seqs.map((_, idx) => idx + 1));

    // 6. Verify parent task is DONE and child task for builder is QUEUED
    const taskDetailRes = await request(server)
      .get(`/api/studios/${studioId}/tasks/${parentTaskId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(taskDetailRes.body.status).toBe('DONE');
    expect(taskDetailRes.body.subtasks).toHaveLength(1);
    expect(taskDetailRes.body.subtasks[0].agentKey).toBe('builder');
    expect(taskDetailRes.body.subtasks[0].status).toBe('QUEUED');
  });
});
