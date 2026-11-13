import {
  estimateTokens,
  type AgentKey,
  type LlmProvider,
  type RunStatus,
  type TaskOrigin,
  type TaskPriority,
  type TaskStatus,
} from '@robdev/shared';
import type { Prisma, PrismaClient, Task } from '../../src/generated/prisma/client.js';
import { AGENT_VAULT_BINDINGS } from './agent-personas.js';
import type { SeededGames } from './games.seed.js';
import { SEED_IDS, ago } from './ids.js';
import type { SeededLlmBinding } from './llm.seed.js';
import {
  R01_LEAD_LOGS,
  R02_FRAME_LOGS,
  R04_BUILDER_LOGS,
  R05_PLAYTEST_LOGS,
  R07_REVIEWER_LOGS,
  SEED_ARTIFACTS_BY_RUN,
  type SeedLogEntrySpec,
} from './seed-logs.js';
import type { SeededStudioContext } from './studios.seed.js';
import type { SeededUsers } from './users.seed.js';

export type TaskSeedKey = keyof typeof SEED_IDS.tasks;
export type SeededTasks = Record<TaskSeedKey, Task>;

interface TaskRunSeedSpec {
  taskKey: TaskSeedKey;
  runKey: keyof typeof SEED_IDS.runs;
  agentKey: AgentKey;
  game: 'aar' | 'dino' | null;
  title: string;
  brief: string;
  status: TaskStatus;
  runStatus: RunStatus;
  priority: TaskPriority;
  origin: TaskOrigin;
  parentKey?: TaskSeedKey;
  dependsOnKeys?: readonly TaskSeedKey[];
  createdByUser?: 'ervum' | 'maya';
  createdByAgent?: AgentKey;
  queuedAt: Date;
  startedAt: Date;
  completedAt: Date | null;
  metadata?: Prisma.InputJsonValue;
  summary: string | null;
  customLogs?: readonly SeedLogEntrySpec[];
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
}

export async function seedTasksRunsLogs(
  prisma: PrismaClient,
  studioCtx: SeededStudioContext,
  games: SeededGames,
  users: SeededUsers,
  llmBinding: SeededLlmBinding | null,
  now: Date,
): Promise<SeededTasks> {
  const studioId = studioCtx.inclined.id;
  const provider: LlmProvider = llmBinding?.provider ?? 'ANTHROPIC';
  const modelId: string = llmBinding?.modelId ?? 'seed-history';

  const specs: readonly TaskRunSeedSpec[] = [
    {
      taskKey: 't01',
      runKey: 'r01',
      agentKey: 'producer',
      game: 'aar',
      title: 'Collect the build evidence for the next stage',
      brief:
        'Gather the v12 build checklist, mobile pass screenshots, and server authority logs across Balance, Scenic, Librarian, Frame, and Builder so Game One can advance from Built to Balanced.',
      status: 'NEEDS_HUMAN',
      runStatus: 'AWAITING_HUMAN',
      priority: 'HIGH',
      origin: 'SYSTEM',
      queuedAt: ago(now, { minutes: 18 }),
      startedAt: ago(now, { minutes: 16 }),
      completedAt: ago(now, { minutes: 14 }),
      summary:
        'Compiled 6 stage verification artifacts for Game One (v12). Balance, Scenic, and Librarian checks passed; waiting on your sign-off for Frame shop UI and Builder reveal flow.',
      customLogs: R01_LEAD_LOGS,
      inputTokens: 6812,
      outputTokens: 1204,
      toolCallCount: 4,
    },
    {
      taskKey: 't02',
      runKey: 'r02',
      agentKey: 'playtest',
      game: 'aar',
      title: 'Test loading and save recovery',
      brief:
        'Run 4-client concurrent join, mid-roll disconnect, and ProfileService session-lock recovery checks on Game One v12.',
      status: 'NEEDS_HUMAN',
      runStatus: 'AWAITING_HUMAN',
      priority: 'HIGH',
      origin: 'AGENT_DELEGATION',
      createdByAgent: 'producer',
      queuedAt: ago(now, { minutes: 24 }),
      startedAt: ago(now, { minutes: 21 }),
      completedAt: ago(now, { minutes: 19 }),
      summary:
        '4-client join and 200ms latency disconnect recovery passed with zero data loss. Confirm whether the 3-second session lock retry toast feels clear before closing.',
      customLogs: R05_PLAYTEST_LOGS,
      inputTokens: 5420,
      outputTokens: 1480,
      toolCallCount: 2,
    },
    {
      taskKey: 't03',
      runKey: 'r03',
      agentKey: 'builder',
      game: 'aar',
      title: 'Connect awakening effects to the reveal',
      brief:
        'Wire the server-validated roll tier outcome to the client camera shake, static bloom post-processing, and beam VFX sequence in v12.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'HIGH',
      origin: 'LEAD_DELEGATION',
      createdByAgent: 'lead',
      queuedAt: ago(now, { minutes: 32 }),
      startedAt: ago(now, { minutes: 28 }),
      completedAt: ago(now, { minutes: 24 }),
      summary:
        'Connected AwakeningRevealClient.luau to RollOutcomeRemote with tier-scaled camera shake and 1.4s anticipation beam.',
      customLogs: R04_BUILDER_LOGS,
      inputTokens: 4890,
      outputTokens: 1150,
      toolCallCount: 3,
    },
    {
      taskKey: 't04',
      runKey: 'r04',
      agentKey: 'merchant',
      game: 'aar',
      title: 'Check the shop offers against the economy',
      brief:
        'Verify the 3-card darkened awakening shop offers (Starter Pack 99 R$, 2× Luck 199 R$, Auto-Roll 249 R$) against Zone 1–3 coin earn rates.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'NORMAL',
      origin: 'LEAD_DELEGATION',
      createdByAgent: 'lead',
      queuedAt: ago(now, { minutes: 40 }),
      startedAt: ago(now, { minutes: 35 }),
      completedAt: ago(now, { minutes: 31 }),
      summary:
        'Verified shop offer pricing and EV ratios against Balance Zone 1–3 curve; Starter Pack sits at 1.8× 15-minute coin earn.',
      inputTokens: 6120,
      outputTokens: 940,
      toolCallCount: 2,
    },
    {
      taskKey: 't05',
      runKey: 'r05',
      agentKey: 'reviewer',
      game: 'aar',
      title: 'Check purchases cannot grant rewards twice',
      brief:
        'Audit ProcessReceipt idempotency keys, receipt history ring buffer, and DataStore session lock checks on Game One v12.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'HIGH',
      origin: 'SYSTEM',
      queuedAt: ago(now, { minutes: 48 }),
      startedAt: ago(now, { minutes: 42 }),
      completedAt: ago(now, { minutes: 38 }),
      summary:
        'Verified ProcessReceipt records purchaseId before granting items and returns PurchaseGranted only after DataStore flush.',
      customLogs: R07_REVIEWER_LOGS,
      inputTokens: 4310,
      outputTokens: 620,
      toolCallCount: 2,
    },
    {
      taskKey: 't06',
      runKey: 'r06',
      agentKey: 'librarian',
      game: 'aar',
      title: 'Prepare enemy models for combat zones',
      brief:
        'Curate, rig-verify, and index the 10 low-poly Zone 1–3 enemy and environment assets with triangle budgets under 1,800 tris.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'NORMAL',
      origin: 'LEAD_DELEGATION',
      createdByAgent: 'lead',
      queuedAt: ago(now, { minutes: 55 }),
      startedAt: ago(now, { minutes: 49 }),
      completedAt: ago(now, { minutes: 45 }),
      summary:
        'Indexed 10 low-poly 3D assets into ReplicatedStorage.AssetRegistry with quality scores 92–99% and mobile LOD tags.',
      inputTokens: 3920,
      outputTokens: 890,
      toolCallCount: 2,
    },
    {
      taskKey: 't07',
      runKey: 'r07',
      agentKey: 'tester108',
      game: 'aar',
      title: 'Run the full opening on mobile',
      brief:
        'Play the first 90 seconds of Game One v12 on iPhone 14 (844×390) and 800×360 landscape without reading the brief.',
      status: 'NEEDS_HUMAN',
      runStatus: 'AWAITING_HUMAN',
      priority: 'HIGH',
      origin: 'SYSTEM',
      queuedAt: ago(now, { minutes: 60 }),
      startedAt: ago(now, { minutes: 55 }),
      completedAt: ago(now, { minutes: 52 }),
      summary:
        'First roll happened at 18s and thumbstick safe-zones passed on 844×390; breadcrumb arrow to the shop fades 2s early—check if you want it extended.',
      inputTokens: 7140,
      outputTokens: 1120,
      toolCallCount: 3,
    },
    {
      taskKey: 't08',
      runKey: 'r08',
      agentKey: 'scenic',
      game: 'aar',
      title: 'Place landmarks along each combat route',
      brief:
        'Place high-silhouette focal landmarks along the three combat routes in Game One so players can orient without a minimap.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'NORMAL',
      origin: 'LEAD_DELEGATION',
      createdByAgent: 'lead',
      queuedAt: ago(now, { hours: 1, minutes: 20 }),
      startedAt: ago(now, { hours: 1, minutes: 12 }),
      completedAt: ago(now, { hours: 1, minutes: 5 }),
      summary:
        'Placed the Shattered Obelisk, Neon Torii Arch, and Astral Spire landmarks along Routes A–C under the 14k instance cap.',
      inputTokens: 6540,
      outputTokens: 2180,
      toolCallCount: 3,
    },
    {
      taskKey: 't09',
      runKey: 'r09',
      agentKey: 'balance',
      game: 'aar',
      title: 'Balance rewards across the first three zones',
      brief:
        'Tune soft-currency drop weights and upgrade costs across Zones 1–3 so median session reaches Zone 2 at 6m and Zone 3 at 16m.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'HIGH',
      origin: 'LEAD_DELEGATION',
      createdByAgent: 'lead',
      queuedAt: ago(now, { hours: 1, minutes: 45 }),
      startedAt: ago(now, { hours: 1, minutes: 35 }),
      completedAt: ago(now, { hours: 1, minutes: 25 }),
      summary:
        'Locked 1.15^n upgrade curve and 60-roll Mythic pity timer across Zones 1–3 in BalanceConfig.luau.',
      inputTokens: 4210,
      outputTokens: 780,
      toolCallCount: 2,
    },
    {
      taskKey: 't10',
      runKey: 'r10',
      agentKey: 'builder',
      game: 'aar',
      title: 'Build the squad upgrade tree',
      brief:
        'Implement the server-authoritative 3-branch squad upgrade tree with party aura multipliers and persistence.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'NORMAL',
      origin: 'LEAD_DELEGATION',
      createdByAgent: 'lead',
      queuedAt: ago(now, { hours: 2, minutes: 15 }),
      startedAt: ago(now, { hours: 2, minutes: 5 }),
      completedAt: ago(now, { hours: 1, minutes: 55 }),
      summary:
        'Shipped SquadUpgradeService.luau with server-side cost verification and live party attribute replication.',
      inputTokens: 4050,
      outputTokens: 740,
      toolCallCount: 2,
    },
    {
      taskKey: 't11',
      runKey: 'r11',
      agentKey: 'frame',
      game: 'aar',
      title: 'Check the awakening and shop UI on a phone',
      brief:
        'Build the STATIC BLOOM dark-theme awakening reveal banner and 3-card SHOP — DARKENED AWAKENING layout for mobile landscape.',
      status: 'NEEDS_HUMAN',
      runStatus: 'AWAITING_HUMAN',
      priority: 'HIGH',
      origin: 'LEAD_DELEGATION',
      createdByAgent: 'lead',
      queuedAt: ago(now, { minutes: 22 }),
      startedAt: ago(now, { minutes: 18 }),
      completedAt: ago(now, { minutes: 14 }),
      summary:
        'Rendered STATIC BLOOM reveal banner and 3-card Shop UI mockup respecting 58px topbar and thumbstick safe zones. Ready to inspect on a phone.',
      customLogs: R02_FRAME_LOGS,
      inputTokens: 4680,
      outputTokens: 960,
      toolCallCount: 2,
    },
    {
      taskKey: 't12',
      runKey: 'r12',
      agentKey: 'splash',
      game: 'aar',
      title: 'Prepare launch thumbnail directions',
      brief:
        'Create 3 high-contrast 512×512 square icon candidates and launch key art directions for Game One.',
      status: 'NEEDS_HUMAN',
      runStatus: 'AWAITING_HUMAN',
      priority: 'NORMAL',
      origin: 'USER',
      createdByUser: 'ervum',
      queuedAt: ago(now, { minutes: 35 }),
      startedAt: ago(now, { minutes: 30 }),
      completedAt: ago(now, { minutes: 28 }),
      summary:
        'Submitted 3 square icon candidates to the Review queue with high-contrast rim lighting readable at 64px.',
      inputTokens: 3920,
      outputTokens: 890,
      toolCallCount: 3,
    },
    {
      taskKey: 't13',
      runKey: 'r13',
      agentKey: 'builder',
      game: 'aar',
      title: 'Try the awakening reveal flow',
      brief:
        'Package build v12 with the end-to-end roll, anticipation beam, and static bloom reveal flow for interactive studio inspection.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'HIGH',
      origin: 'USER',
      createdByUser: 'ervum',
      queuedAt: ago(now, { hours: 2, minutes: 30 }),
      startedAt: ago(now, { hours: 2, minutes: 20 }),
      completedAt: ago(now, { hours: 2, minutes: 10 }),
      summary:
        'Recorded saved build v12 with full roll-to-reveal sequence and handed off to human review.',
      inputTokens: 4120,
      outputTokens: 920,
      toolCallCount: 2,
    },
    {
      taskKey: 't14',
      runKey: 'r14',
      agentKey: 'architect',
      game: 'dino',
      title: 'Write the 12-step technical and design guide',
      brief:
        'Author the complete 12-step technical and systems blueprint for Game Two and lock shared Luau contracts.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'HIGH',
      origin: 'USER',
      createdByUser: 'ervum',
      queuedAt: ago(now, { hours: 3, minutes: 20 }),
      startedAt: ago(now, { hours: 3, minutes: 10 }),
      completedAt: ago(now, { hours: 3 }),
      summary:
        'Authored the 12-step guide for Game Two; waiting on you to kick off Builder.',
      inputTokens: 7850,
      outputTokens: 2640,
      toolCallCount: 2,
    },
    {
      taskKey: 't15',
      runKey: 'r15',
      agentKey: 'pulse',
      game: null,
      title: 'Propose 2 new pitches from this week’s charts',
      brief:
        'Scan Roblox velocity and breakout charts to propose Rooftop deliveries and Pocket workshop.',
      status: 'DONE',
      runStatus: 'SUCCEEDED',
      priority: 'NORMAL',
      origin: 'SYSTEM',
      queuedAt: ago(now, { hours: 4, minutes: 15 }),
      startedAt: ago(now, { hours: 4, minutes: 5 }),
      completedAt: ago(now, { hours: 4 }),
      summary:
        'Proposed "Rooftop deliveries" (obby / runner, rank #64) and "Pocket workshop" (tycoon / builder, rank #142) from chart velocity.',
      inputTokens: 6540,
      outputTokens: 2180,
      toolCallCount: 4,
    },
  ];

  const createdTasks = {} as SeededTasks;

  // 1. Create all 14 tasks
  for (const spec of specs) {
    const taskId = SEED_IDS.tasks[spec.taskKey];
    const agent = studioCtx.agentsByKey[spec.agentKey];
    const gameId = spec.game === 'aar' ? games.aar.id : spec.game === 'dino' ? games.dino.id : null;
    const parentTaskId = spec.parentKey ? SEED_IDS.tasks[spec.parentKey] : null;
    const createdByUserId = spec.createdByUser ? users[spec.createdByUser].id : null;
    const createdByAgentId = spec.createdByAgent ? studioCtx.agentsByKey[spec.createdByAgent].id : null;

    const task = await prisma.task.create({
      data: {
        id: taskId,
        studioId,
        gameId,
        agentId: agent.id,
        parentTaskId,
        createdByUserId,
        createdByAgentId,
        origin: spec.origin,
        title: spec.title,
        brief: spec.brief,
        status: spec.status,
        priority: spec.priority,
        tags: [],
        attempts: 1,
        resultSummary: spec.summary,
        ...(spec.metadata !== undefined ? { metadata: spec.metadata } : {}),
        queuedAt: spec.queuedAt,
        startedAt: spec.startedAt,
        completedAt: spec.completedAt,
        createdAt: spec.queuedAt,
        updatedAt: spec.completedAt ?? spec.startedAt,
      },
    });
    createdTasks[spec.taskKey] = task;
  }

  // 2. Create task dependencies (t04 depends on t03)
  for (const spec of specs) {
    if (!spec.dependsOnKeys) continue;
    for (const depKey of spec.dependsOnKeys) {
      await prisma.taskDependency.create({
        data: {
          taskId: SEED_IDS.tasks[spec.taskKey],
          dependsOnId: SEED_IDS.tasks[depKey],
        },
      });
    }
  }

  // 3. Create runs, vault injections, log entries, and artifacts
  const alwaysDoc = studioCtx.docsByFolder['00 For Any AI']!;

  for (const spec of specs) {
    const runId = SEED_IDS.runs[spec.runKey];
    const taskId = SEED_IDS.tasks[spec.taskKey];
    const agent = studioCtx.agentsByKey[spec.agentKey];

    await prisma.agentRun.create({
      data: {
        id: runId,
        studioId,
        taskId,
        agentId: agent.id,
        status: spec.runStatus,
        provider,
        modelId,
        attempt: 1,
        startedAt: spec.startedAt,
        finishedAt: spec.completedAt,
        heartbeatAt: spec.completedAt ?? now,
        inputTokens: spec.inputTokens,
        outputTokens: spec.outputTokens,
        toolCallCount: spec.toolCallCount,
        summary: spec.summary,
      },
    });

    // Build injected docs list: 00 For Any AI + agent's bound vault docs
    const boundSpecs = AGENT_VAULT_BINDINGS[spec.agentKey];
    const injectedDocs = [
      alwaysDoc,
      ...boundSpecs.map((b) => studioCtx.docsByFolder[b.folder]!).filter(Boolean),
    ];

    const injectedDocRefs = [];
    for (const doc of injectedDocs) {
      const estTokens = estimateTokens(doc.markdown);
      await prisma.runVaultInjection.create({
        data: {
          runId,
          documentId: doc.id,
          documentVersion: doc.version,
          estimatedTokens: estTokens,
          truncated: false,
          createdAt: spec.startedAt,
        },
      });
      injectedDocRefs.push({
        documentId: doc.id,
        path: doc.path,
        version: doc.version,
        estimatedTokens: estTokens,
        truncated: false,
      });
    }

    // Entry seq 1 is always CONTEXT
    const entries: SeedLogEntrySpec[] = [
      {
        kind: 'CONTEXT',
        content: `Loaded ${injectedDocRefs.length} vault documents`,
        meta: { docs: injectedDocRefs },
      },
    ];

    if (spec.customLogs) {
      entries.push(...spec.customLogs);
    } else {
      entries.push(
        {
          kind: 'TEXT',
          content: `${spec.summary ?? spec.title}\n\n## Result\n- Completed **${spec.title}** adhering to studio vault rules.\n- Verified outputs and updated task status.`,
        },
        {
          kind: 'USAGE',
          content: `Input: ${spec.inputTokens.toLocaleString('en-US')} tokens · Output: ${spec.outputTokens.toLocaleString('en-US')} tokens`,
          meta: { usage: { inputTokens: spec.inputTokens, outputTokens: spec.outputTokens } },
        },
      );
    }

    let lastTextSnippet: string | null = null;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const entryTime = new Date(spec.startedAt.getTime() + (i + 1) * 1000);
      await prisma.runLogEntry.create({
        data: {
          runId,
          seq: i + 1,
          kind: e.kind,
          content: e.content,
          ...(e.meta ? { meta: e.meta as Prisma.InputJsonValue } : {}),
          createdAt: entryTime,
          updatedAt: entryTime,
        },
      });
      if (e.kind === 'TEXT') {
        lastTextSnippet = e.content.replace(/\s+/g, ' ').trim().slice(-140);
      }
    }

    // Create RunArtifact rows if specified for this run
    const artifacts = SEED_ARTIFACTS_BY_RUN[runId] ?? [];
    for (const art of artifacts) {
      await prisma.runArtifact.create({
        data: {
          runId,
          path: art.path,
          language: art.language,
          content: art.content,
          bytes: Buffer.byteLength(art.content, 'utf8'),
          createdAt: spec.completedAt ?? spec.startedAt,
        },
      });
    }

    // Update agent's activity pointer (and currentTaskId/currentRunId for RUNNING tasks)
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        currentTaskId: spec.status === 'RUNNING' ? taskId : null,
        currentRunId: spec.status === 'RUNNING' ? runId : null,
        lastActivityAt: spec.completedAt ?? spec.startedAt,
        lastSnippet: lastTextSnippet ?? spec.summary,
      },
    });
  }

  // 4. Link pitches p1 and p2 to r15
  await prisma.pitch.updateMany({
    where: { id: { in: [SEED_IDS.pitches.p1, SEED_IDS.pitches.p2] } },
    data: { runId: SEED_IDS.runs.r15 },
  });

  // 5. Keep Studio Lane A idle (Home · Lane 1 · game-one -> Idle)
  const laneA = studioCtx.lanesByName['Studio Lane A'];
  if (laneA) {
    await prisma.studioLane.update({
      where: { id: laneA.id },
      data: {
        name: 'Home · Lane 1 · game-one',
        heldByAgentId: null,
        heldForGameId: null,
        heldByRunId: null,
        heldSince: null,
      },
    });
  }

  return createdTasks;
}
