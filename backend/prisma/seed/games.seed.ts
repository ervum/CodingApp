import type { Game, PrismaClient } from '../../src/generated/prisma/client.js';
import { SEED_IDS, ago } from './ids.js';
import type { SeededStudioContext } from './studios.seed.js';

export const DEFAULT_MILESTONE_TEMPLATE: ReadonlyArray<{
  key: string;
  title: string;
  sortOrder: number;
}> = [
  { key: 'concept', title: 'Concept locked', sortOrder: 1 },
  { key: 'blueprint', title: '12-step blueprint', sortOrder: 2 },
  { key: 'core-loop', title: 'Core loop playable', sortOrder: 3 },
  { key: 'ui-hud', title: 'UI & HUD pass', sortOrder: 4 },
  { key: 'world', title: 'World & lighting pass', sortOrder: 5 },
  { key: 'economy', title: 'Economy & monetisation', sortOrder: 6 },
  { key: 'qa-mobile', title: 'QA & mobile passes', sortOrder: 7 },
  { key: 'publish', title: 'First publish', sortOrder: 8 },
];

export interface SeededGames {
  aar: Game;
  dino: Game;
}

export async function seedGames(
  prisma: PrismaClient,
  studioCtx: SeededStudioContext,
  now: Date,
): Promise<SeededGames> {
  const studioId = studioCtx.inclined.id;
  const producer = studioCtx.agentsByKey.producer;
  const builder = studioCtx.agentsByKey.builder;

  const aar = await prisma.game.create({
    data: {
      id: SEED_IDS.games.aar,
      studioId,
      slug: 'game-one',
      name: 'Game One',
      genre: 'Awakening · Action',
      status: 'BUILDING',
      accentColor: '#A855F7',
      description:
        'Built: Balance, Scenic and Librarian finished; Frame and Merchant have updates waiting for your review',
      robloxUniverseId: null,
      robloxPlaceId: null,
      latestPublishedVersion: 10,
      latestSavedVersion: 12,
    },
  });

  const dino = await prisma.game.create({
    data: {
      id: SEED_IDS.games.dino,
      studioId,
      slug: 'game-two',
      name: 'Game Two',
      genre: 'Blueprint · Co-op',
      status: 'BLUEPRINT',
      accentColor: '#8B5CF6',
      description:
        'Designed: Architect wrote the 12-step guide; waiting on you to kick off Builder',
      robloxUniverseId: null,
      robloxPlaceId: null,
      latestPublishedVersion: null,
      latestSavedVersion: 3,
    },
  });

  // Game One milestones: 13 of 20 DONE -> 13/20 = 65%
  for (let i = 1; i <= 20; i++) {
    const templateItem = DEFAULT_MILESTONE_TEMPLATE[i - 1];
    const isDone = i <= 13;
    const isInProgress = i === 14;
    await prisma.gameMilestone.create({
      data: {
        gameId: aar.id,
        key: templateItem ? templateItem.key : `stage-step-${i}`,
        title: templateItem ? templateItem.title : `Stage check ${i}`,
        sortOrder: i,
        status: isDone ? 'DONE' : isInProgress ? 'IN_PROGRESS' : 'TODO',
        completedAt: isDone ? ago(now, { days: Math.max(1, 30 - i) }) : null,
      },
    });
  }

  // Game Two milestones: first 2 DONE, 3rd IN_PROGRESS, rest TODO -> 2/8 = 25%
  const dinoCompletedDays = [14, 7];
  for (let i = 0; i < DEFAULT_MILESTONE_TEMPLATE.length; i++) {
    const m = DEFAULT_MILESTONE_TEMPLATE[i]!;
    const isDone = i < 2;
    const isInProgress = i === 2;
    await prisma.gameMilestone.create({
      data: {
        gameId: dino.id,
        key: m.key,
        title: m.title,
        sortOrder: m.sortOrder,
        status: isDone ? 'DONE' : isInProgress ? 'IN_PROGRESS' : 'TODO',
        completedAt: isDone ? ago(now, { days: dinoCompletedDays[i]! }) : null,
      },
    });
  }

  // Builds for Game One (v10 published, v11 & v12 saved) and Game Two (v1-v3 saved)
  await prisma.gameBuild.createMany({
    data: [
      {
        gameId: aar.id,
        version: 10,
        kind: 'PUBLISHED',
        notes: 'Core roll & reveal loop + initial Zone 1 arena',
        createdByAgentId: producer.id,
        mobilePassA: 'PASSED',
        mobilePassB: 'PASSED',
        createdAt: ago(now, { days: 4 }),
      },
      {
        gameId: aar.id,
        version: 11,
        kind: 'SAVED',
        notes: 'Balance rewards across the first three zones + Scenic landmarks',
        createdByAgentId: builder.id,
        mobilePassA: 'PASSED',
        mobilePassB: 'NOT_STARTED',
        createdAt: ago(now, { hours: 6 }),
      },
      {
        gameId: aar.id,
        version: 12,
        kind: 'SAVED',
        notes: 'Awakening reveal flow connected + darkened shop UI pass',
        createdByAgentId: builder.id,
        mobilePassA: 'PASSED',
        mobilePassB: 'PASSED',
        createdAt: ago(now, { minutes: 14 }),
      },
      {
        gameId: dino.id,
        version: 1,
        kind: 'SAVED',
        notes: 'Initial concept & greybox place',
        createdByAgentId: producer.id,
        mobilePassA: 'PASSED',
        mobilePassB: 'NOT_STARTED',
        createdAt: ago(now, { days: 3 }),
      },
      {
        gameId: dino.id,
        version: 2,
        kind: 'SAVED',
        notes: 'Shared Luau types & core loop contract',
        createdByAgentId: builder.id,
        mobilePassA: 'PASSED',
        mobilePassB: 'NOT_STARTED',
        createdAt: ago(now, { days: 1 }),
      },
      {
        gameId: dino.id,
        version: 3,
        kind: 'SAVED',
        notes: 'Architect 12-step guide locked; ready for Builder kickoff',
        createdByAgentId: producer.id,
        mobilePassA: 'PASSED',
        mobilePassB: 'NOT_STARTED',
        createdAt: ago(now, { hours: 3 }),
      },
    ],
  });

  return { aar, dino };
}
