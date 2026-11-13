import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { finalizeAgentStatuses } from './seed/agents.seed.js';
import { seedGames } from './seed/games.seed.js';
import { seedHumanRequests } from './seed/human-requests.seed.js';
import { SEED_IDS } from './seed/ids.js';
import { seedLlmConnections } from './seed/llm.seed.js';
import { seedMarket } from './seed/market.seed.js';
import { seedMedia } from './seed/media.seed.js';
import { seedPitches } from './seed/pitches.seed.js';
import { mulberry32 } from './seed/prng.js';
import { seedReview } from './seed/review.seed.js';
import { seedStudios } from './seed/studios.seed.js';
import { seedTasksRunsLogs } from './seed/tasks.seed.js';
import { seedUsers } from './seed/users.seed.js';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function wipe(db: PrismaClient): Promise<void> {
  await db.marketSortEntry.deleteMany();
  await db.marketSnapshot.deleteMany();
  await db.marketIngestionRun.deleteMany();
  await db.marketGame.deleteMany();
  await db.studioAsset.deleteMany();
  await db.vaultLink.deleteMany();
  await db.vaultDocumentRevision.deleteMany();
  await db.runVaultInjection.deleteMany();
  await db.agentVaultBinding.deleteMany();
  await db.vaultDocument.deleteMany();
  await db.vaultFolder.deleteMany();
  await db.pitchSection.deleteMany();
  await db.blocker.deleteMany();
  await db.reviewVerdict.deleteMany();
  await db.reviewItem.deleteMany();
  await db.humanRequest.deleteMany();
  await db.agentMessage.deleteMany();
  await db.runArtifact.deleteMany();
  await db.runLogEntry.deleteMany();
  await db.agentRun.deleteMany();
  await db.taskDependency.deleteMany();
  await db.task.deleteMany();
  await db.studioLane.deleteMany();
  await db.gameBuild.deleteMany();
  await db.gameMilestone.deleteMany();
  await db.game.deleteMany();
  await db.pitch.deleteMany();
  await db.mediaFile.deleteMany();
  await db.agent.deleteMany();
  await db.llmConnection.deleteMany();
  await db.studioMembership.deleteMany();
  await db.studio.deleteMany();
  await db.refreshToken.deleteMany({
    where: { userId: { in: [SEED_IDS.users.ervum, SEED_IDS.users.maya] } },
  });
  await db.user.deleteMany({
    where: {
      OR: [
        { id: { in: [SEED_IDS.users.ervum, SEED_IDS.users.maya] } },
        { email: { in: ['operator@robdev.local', 'producer@robdev.local'] } },
      ],
    },
  });
}

async function main(): Promise<void> {
  const now = new Date();
  const rng = mulberry32(20261022);

  await wipe(prisma);

  const users = await seedUsers(prisma);
  const studio = await seedStudios(prisma, users);

  const customUsers = await prisma.user.findMany({
    where: { id: { notIn: [users.ervum.id, users.maya.id] } },
  });
  for (const cu of customUsers) {
    await prisma.studioMembership.upsert({
      where: { studioId_userId: { studioId: studio.inclined.id, userId: cu.id } },
      update: {},
      create: { studioId: studio.inclined.id, userId: cu.id, role: 'OWNER' },
    });
  }
  const llmBinding = await seedLlmConnections(prisma, studio);
  const games = await seedGames(prisma, studio, now);
  const media = await seedMedia(prisma, studio, games, rng);
  const pitches = await seedPitches(prisma, studio, now);
  const tasks = await seedTasksRunsLogs(prisma, studio, games, users, llmBinding, now);
  await seedHumanRequests(prisma, studio, games, tasks, pitches, now);
  await seedReview(prisma, studio, games, tasks, media, users, now);
  await seedMarket(prisma, now, rng);
  await finalizeAgentStatuses(prisma, studio.inclined.id);
  await finalizeAgentStatuses(prisma, studio.sandbox.id);

  console.log('Seed completed successfully for studios: inclined-games, sandbox');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e: unknown) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
