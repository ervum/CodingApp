import type { AgentKey } from '@robdev/shared';
import type { Agent, PrismaClient, Studio, StudioLane, VaultDocument } from '../../src/generated/prisma/client.js';
import { provisionStudio } from '../../src/modules/studios/provision-studio.js';
import { SEED_IDS } from './ids.js';
import type { SeededUsers } from './users.seed.js';

export interface SeededStudioContext {
  inclined: Studio;
  sandbox: Studio;
  agentsByKey: Record<AgentKey, Agent>;
  lanesByName: Record<string, StudioLane>;
  docsByFolder: Record<string, VaultDocument>;
}

export async function seedStudios(
  prisma: PrismaClient,
  users: SeededUsers,
): Promise<SeededStudioContext> {
  const inclined = await prisma.studio.create({
    data: {
      id: SEED_IDS.studios.inclined,
      slug: 'inclined-games',
      name: 'RoAutomation',
      workspaceLabel: 'RoAutomation',
      isPaused: false,
    },
  });

  await prisma.studioMembership.createMany({
    data: [
      { studioId: inclined.id, userId: users.ervum.id, role: 'OWNER' },
      { studioId: inclined.id, userId: users.maya.id, role: 'PRODUCER' },
    ],
  });

  const provisionedInclined = await provisionStudio(prisma, inclined.id);

  const sandbox = await prisma.studio.create({
    data: {
      id: SEED_IDS.studios.sandbox,
      slug: 'sandbox',
      name: 'Sandbox studio',
      workspaceLabel: 'robdev',
      isPaused: false,
    },
  });

  await prisma.studioMembership.create({
    data: {
      studioId: sandbox.id,
      userId: users.ervum.id,
      role: 'OWNER',
    },
  });

  await provisionStudio(prisma, sandbox.id);

  return {
    inclined,
    sandbox,
    agentsByKey: provisionedInclined.agentsByKey,
    lanesByName: provisionedInclined.lanesByName,
    docsByFolder: provisionedInclined.docsByFolder,
  };
}
