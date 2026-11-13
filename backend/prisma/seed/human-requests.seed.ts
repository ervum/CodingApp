import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { SeededGames } from './games.seed.js';
import { SEED_IDS, ago } from './ids.js';
import type { SeededPitches } from './pitches.seed.js';
import type { SeededStudioContext } from './studios.seed.js';
import type { SeededTasks } from './tasks.seed.js';

export async function seedHumanRequests(
  prisma: PrismaClient,
  studioCtx: SeededStudioContext,
  games: SeededGames,
  tasks: SeededTasks,
  pitches: SeededPitches,
  now: Date,
): Promise<void> {
  const studioId = studioCtx.inclined.id;

  await prisma.humanRequest.createMany({
    data: [
      {
        id: SEED_IDS.humanRequests.hr1,
        studioId,
        kind: 'TRY_IT',
        status: 'OPEN',
        title: 'Try the awakening reveal flow',
        body: 'Connected the server roll outcome to the client camera shake and beam sequence in build v12. Roll three times in Studio to confirm the anticipation timing and reveal transition.',
        gameId: games.aar.id,
        agentId: studioCtx.agentsByKey.builder.id,
        taskId: tasks.t13.id,
        options: [{ id: 'header', label: 'BUILDER FINISHED · CHECK IT' }],
        pitchIds: [],
        buildVersion: 12,
        createdAt: ago(now, { minutes: 12 }),
      },
      {
        id: SEED_IDS.humanRequests.hr2,
        studioId,
        kind: 'TRY_IT',
        status: 'OPEN',
        title: 'Check the awakening and shop UI on a phone',
        body: 'Updated the darkened awakening reveal banner and 3-card shop layout for 844×390 mobile safe zones. Check that the right-thumb Roll button and shop cards feel comfortable on a phone.',
        gameId: games.aar.id,
        agentId: studioCtx.agentsByKey.frame.id,
        taskId: tasks.t11.id,
        options: [{ id: 'header', label: 'FRAME FINISHED · CHECK IT' }],
        pitchIds: [],
        buildVersion: 12,
        createdAt: ago(now, { minutes: 14 }),
      },
      {
        id: SEED_IDS.humanRequests.hr3,
        studioId,
        kind: 'TRY_IT',
        status: 'OPEN',
        title: 'Verify purchase checks and save recovery',
        body: 'Audited ProcessReceipt idempotency and profile session-lock release on disconnect so purchases cannot grant rewards twice. Confirm the recovery fallback before stage sign-off.',
        gameId: games.aar.id,
        agentId: studioCtx.agentsByKey.reviewer.id,
        taskId: tasks.t05.id,
        options: [{ id: 'header', label: 'REVIEWER FINISHED · CHECK IT' }],
        pitchIds: [],
        buildVersion: 12,
        createdAt: ago(now, { minutes: 19 }),
      },
      {
        id: SEED_IDS.humanRequests.hr4,
        studioId,
        kind: 'TRY_IT',
        status: 'OPEN',
        title: 'Play the opening without reading the brief',
        body: 'Ran an unguided first-session pass on the mobile emulator. The first roll happens within 18 seconds, but check whether the breadcrumb arrow to the shop fades too quickly.',
        gameId: games.aar.id,
        agentId: studioCtx.agentsByKey.tester108.id,
        taskId: tasks.t07.id,
        options: [{ id: 'header', label: '108 TESTER FINISHED · CHECK IT' }],
        pitchIds: [],
        buildVersion: 12,
        createdAt: ago(now, { minutes: 25 }),
      },
      {
        id: SEED_IDS.humanRequests.hr5,
        studioId,
        kind: 'DECISION',
        status: 'OPEN',
        title: 'Prepare launch thumbnail directions',
        body: 'Rendered 3 square game icon candidates and initial launch thumbnail compositions for Game One. Review the directions and pick which silhouette to lock for publish.',
        gameId: games.aar.id,
        agentId: studioCtx.agentsByKey.splash.id,
        taskId: tasks.t12.id,
        options: [{ id: 'header', label: 'SPLASH FINISHED · CHECK IT' }],
        pitchIds: [pitches.p1.id, pitches.p2.id],
        buildVersion: 12,
        createdAt: ago(now, { minutes: 28 }),
      },
    ],
  });
}
