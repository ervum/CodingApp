import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { LlmAdapterFactory } from '../src/modules/llm/llm-adapter.factory.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { ScriptedLlmAdapter } from '../src/test-support/scripted-llm.adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(__dirname, '..');

export function loadTestEnv(): void {
  const envFile = readFileSync(resolve(backendRoot, '.env.test'), 'utf8');
  for (const rawLine of envFile.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    process.env[key] = val;
  }
}

let migrated = false;

export async function ensureTestDatabaseMigrated(): Promise<void> {
  loadTestEnv();
  if (migrated) return;

  const adminAdapter = new PrismaPg({
    connectionString: 'postgresql://robdev:robdev@localhost:5433/postgres?schema=public',
  });
  const adminPrisma = new PrismaClient({ adapter: adminAdapter });
  await adminPrisma.$connect();
  try {
    const check = await adminPrisma.$queryRaw<Array<{ exists: number }>>`
      SELECT 1 AS exists FROM pg_database WHERE datname = 'robdev_test'
    `;
    if (check.length === 0) {
      await adminPrisma.$executeRawUnsafe(`CREATE DATABASE robdev_test`);
    }
  } finally {
    await adminPrisma.$disconnect();
  }

  execSync('pnpm exec prisma migrate deploy', {
    cwd: backendRoot,
    env: { ...process.env },
    stdio: 'pipe',
  });

  migrated = true;
}

export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "User",
      "Studio",
      "MarketGame",
      "MarketIngestionRun"
    RESTART IDENTITY CASCADE;
  `);
}

export async function createE2eApp(options?: {
  scriptedLlm?: ScriptedLlmAdapter;
}): Promise<{
  app: NestExpressApplication;
  prisma: PrismaService;
}> {
  await ensureTestDatabaseMigrated();

  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (options?.scriptedLlm) {
    builder = builder
      .overrideProvider(LlmAdapterFactory)
      .useValue(options.scriptedLlm.asFactory());
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: false,
  });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const prisma = app.get(PrismaService);
  await resetDatabase(prisma);

  return { app, prisma };
}
