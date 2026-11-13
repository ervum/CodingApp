import { REVIEW_KIND_TAB, type ReviewKind, type ReviewStatus } from '@robdev/shared';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import type { SeededGames } from './games.seed.js';
import { SEED_IDS, ago } from './ids.js';
import type { MediaKey, SeededMedia } from './media.seed.js';
import type { SeededStudioContext } from './studios.seed.js';
import type { SeededTasks, TaskSeedKey } from './tasks.seed.js';
import type { SeededUsers } from './users.seed.js';

interface ReviewSeedSpec {
  idKey: keyof typeof SEED_IDS.reviewItems;
  game: 'aar' | 'dino';
  kind: ReviewKind;
  title: string;
  description: string;
  status: ReviewStatus;
  madeBy: 'splash' | 'reviewer' | 'producer' | 'frame';
  mediaKey: MediaKey | null;
  iteration: number;
  prevIdKey?: keyof typeof SEED_IDS.reviewItems;
  taskKey?: TaskSeedKey;
  runKey?: keyof typeof SEED_IDS.runs;
  payload?: Prisma.InputJsonValue;
  createdAt: Date;
}

export async function seedReview(
  prisma: PrismaClient,
  studioCtx: SeededStudioContext,
  games: SeededGames,
  tasks: SeededTasks,
  media: SeededMedia,
  users: SeededUsers,
  now: Date,
): Promise<void> {
  const studioId = studioCtx.inclined.id;

  const specs: readonly ReviewSeedSpec[] = [
    {
      idKey: 'ri01',
      game: 'aar',
      kind: 'THUMBNAIL',
      title: 'Use this shop layout: hero, 3-card...',
      description:
        'Screenshot · Game One — Dark-theme awakening shop layout with hero banner and 3 offer cards sized for mobile landscape safe zones.',
      status: 'TO_REVIEW',
      madeBy: 'frame',
      mediaKey: 'thumb-aar-boss',
      iteration: 1,
      taskKey: 't11',
      runKey: 'r11',
      createdAt: ago(now, { minutes: 14 }),
    },
    {
      idKey: 'ri02',
      game: 'aar',
      kind: 'ICON',
      title: 'Awakening Crest — Direction A (Violet Rim)',
      description:
        'Pushed the rim light and removed background clutter so the silhouette reads cleanly at 64×64 px on the Charts page.',
      status: 'TO_REVIEW',
      madeBy: 'splash',
      mediaKey: 'icon-aar-v3',
      iteration: 1,
      taskKey: 't12',
      runKey: 'r12',
      createdAt: ago(now, { minutes: 28 }),
    },
    {
      idKey: 'ri03',
      game: 'aar',
      kind: 'ICON',
      title: 'Static Bloom Sigil — Direction B (Crimson Core)',
      description: 'High-contrast crimson-and-obsidian emblem focusing on the Static Bloom reveal beam.',
      status: 'TO_REVIEW',
      madeBy: 'splash',
      mediaKey: 'icon-aar-v2',
      iteration: 1,
      taskKey: 't12',
      runKey: 'r12',
      createdAt: ago(now, { minutes: 27 }),
    },
    {
      idKey: 'ri06',
      game: 'aar',
      kind: 'ICON',
      title: 'Void Emperor Mask — Direction C (Gold Trim)',
      description: '512×512 square game icon highlighting the 1-in-10M Void Emperor mask silhouette.',
      status: 'TO_REVIEW',
      madeBy: 'splash',
      mediaKey: 'icon-dino-v1',
      iteration: 1,
      taskKey: 't12',
      runKey: 'r12',
      createdAt: ago(now, { minutes: 26 }),
    },
    {
      idKey: 'ri09',
      game: 'aar',
      kind: 'PUBLISH',
      title: 'Review verdicts — reversible (stage_verdict: approve / request_changes / reject)',
      description: 'Pre-publish QA checkpoint for Game One build v12 in "OVERDRIVE V4 - THE AI STUDIO".',
      status: 'TO_REVIEW',
      madeBy: 'reviewer',
      mediaKey: null,
      iteration: 1,
      taskKey: 't05',
      runKey: 'r05',
      payload: {
        buildVersion: 12,
        checklist: [
          { label: 'Mobile pass A (108 Tester)', done: true },
          { label: 'Mobile pass B (108 Tester)', done: true },
          { label: 'Save recovery & session lock (Playtest)', done: true },
          { label: 'Server authority & ProcessReceipt audit', done: true },
          { label: 'Shop UI & awakening reveal check', done: false },
        ],
      },
      createdAt: ago(now, { minutes: 19 }),
    },
    {
      idKey: 'ri10',
      game: 'aar',
      kind: 'STAGE',
      title: 'Picked task — context, not your queue (review_status == "in_review")',
      description: 'Stage progression check for Game One (Built · Approved -> next: Balance).',
      status: 'APPROVED',
      madeBy: 'producer',
      mediaKey: null,
      iteration: 1,
      taskKey: 't01',
      runKey: 'r01',
      payload: {
        buildVersion: 12,
        stagePath: 'games/game-one/stage.json',
        checklist: [
          { label: 'HUD safe zones on 844×390', done: true },
          { label: 'Shop & Index screens', done: true },
          { label: 'Tap targets ≥ 44 px', done: true },
        ],
      },
      createdAt: ago(now, { minutes: 14 }),
    },
  ];

  for (const spec of specs) {
    await prisma.reviewItem.create({
      data: {
        id: SEED_IDS.reviewItems[spec.idKey],
        studioId,
        gameId: spec.game === 'aar' ? games.aar.id : games.dino.id,
        kind: spec.kind,
        tab: REVIEW_KIND_TAB[spec.kind],
        status: spec.status,
        title: spec.title,
        description: spec.description,
        madeByAgentId: studioCtx.agentsByKey[spec.madeBy].id,
        mediaId: spec.mediaKey ? media[spec.mediaKey].id : null,
        taskId: spec.taskKey ? tasks[spec.taskKey].id : null,
        runId: spec.runKey ? SEED_IDS.runs[spec.runKey] : null,
        ...(spec.payload !== undefined ? { payload: spec.payload } : {}),
        iteration: spec.iteration,
        previousItemId: spec.prevIdKey ? SEED_IDS.reviewItems[spec.prevIdKey] : null,
        createdAt: spec.createdAt,
        updatedAt: spec.createdAt,
      },
    });
  }

  // Verdicts per Section 6.7
  await prisma.reviewVerdict.createMany({
    data: [
      {
        reviewItemId: SEED_IDS.reviewItems.ri10,
        userId: users.ervum.id,
        verdict: 'APPROVE',
        feedback: null,
        createdAt: ago(now, { minutes: 10 }),
      },
    ],
  });

  // Blockers B1-B3 per Section 6.7 (linked to ri09)
  await prisma.blocker.createMany({
    data: [
      {
        id: SEED_IDS.blockers.b1,
        studioId,
        gameId: games.aar.id,
        taskId: tasks.t05.id,
        runId: SEED_IDS.runs.r05,
        reviewItemId: SEED_IDS.reviewItems.ri09,
        agentId: studioCtx.agentsByKey.reviewer.id,
        severity: 'SHOULD_FIX',
        status: 'OPEN',
        title: 'Shop breadcrumb arrow fades 2s before first roll completes on 844×390',
        detail:
          'Extend the onboarding breadcrumb arrow fade timer from 6s to 8s so phone players see the shop entry after their first awakening reveal.',
        buildVersion: 12,
        createdAt: ago(now, { minutes: 19 }),
      },
    ],
  });
}
