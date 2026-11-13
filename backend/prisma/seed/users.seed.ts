import { hash, type Algorithm } from '@node-rs/argon2';
import type { PrismaClient, User } from '../../src/generated/prisma/client.js';
import { SEED_IDS } from './ids.js';

export interface SeededUsers {
  ervum: User;
  maya: User;
}

export async function seedUsers(prisma: PrismaClient): Promise<SeededUsers> {
  const operatorEmail = (process.env['SEED_OPERATOR_EMAIL'] || 'operator@robdev.local').toLowerCase();
  const operatorPassword = process.env['SEED_OPERATOR_PASSWORD'] || 'robdev-dev-2026!';

  const passwordHash = await hash(operatorPassword, {
    algorithm: 2 as Algorithm,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const ervum = await prisma.user.create({
    data: {
      id: SEED_IDS.users.ervum,
      email: operatorEmail,
      passwordHash,
      displayName: process.env['SEED_OPERATOR_NAME'] || 'Ervum',
      avatarColor: '#A855F7',
    },
  });

  const maya = await prisma.user.create({
    data: {
      id: SEED_IDS.users.maya,
      email: 'producer@robdev.local',
      passwordHash,
      displayName: 'Maya',
      avatarColor: '#14B8A6',
    },
  });

  return { ervum, maya };
}
