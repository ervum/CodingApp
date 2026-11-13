import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import type {
  CreatePlaybookRequest,
  GameStatus,
  PlaybookDto,
  PlaybookStepDto,
  RunPlaybookRequest,
  RunPlaybookResultDto,
  UpdatePlaybookRequest,
} from '@robdev/shared';
import { AppError } from '../../common/errors/app-error.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TasksService } from '../tasks/tasks.service.js';

export const BUILT_IN_PLAYBOOKS: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  suggestOnGameStatus: GameStatus | null;
  steps: PlaybookStepDto[];
}> = [
  {
    key: 'new-game-vertical-slice',
    name: 'New Game Vertical Slice',
    description:
      'End-to-end DAG from 12-step technical blueprint to playable core loop, mobile HUD, greybox world, and QA smoke test.',
    suggestOnGameStatus: 'BUILDING',
    steps: [
      {
        key: 'blueprint',
        agentKey: 'architect',
        title: 'Design 12-Step Technical Blueprint & DataStore Schema',
        brief:
          'Define the server-authoritative module architecture, Replication contracts, and DataStore session-locking schema in the Vault and workspace.',
        priority: 'HIGH',
        dependsOn: [],
      },
      {
        key: 'core-loop',
        agentKey: 'builder',
        title: 'Implement Core Gameplay Loop & Server Authority',
        brief:
          'Implement the primary gameplay state machine, player round/progression loop, and validated RemoteEvents following the Architect blueprint.',
        priority: 'HIGH',
        dependsOn: ['blueprint'],
      },
      {
        key: 'ui-hud',
        agentKey: 'frame',
        title: 'Build Responsive 9-Slice HUD & Mobile Controls',
        brief:
          'Create the primary HUD, currency counter, and mobile thumb-zone action buttons with UIListLayout and UIScale.',
        priority: 'NORMAL',
        dependsOn: ['blueprint'],
      },
      {
        key: 'world-greybox',
        agentKey: 'scenic',
        title: 'Construct Greybox Arena & Lighting Profile',
        brief:
          'Build the spawn hub, primary gameplay arena layout, and atmospheric lighting settings.',
        priority: 'NORMAL',
        dependsOn: ['blueprint'],
      },
      {
        key: 'qa-smoke',
        agentKey: 'reviewer',
        title: 'Run Automated Smoke & Security Audit',
        brief:
          'Inspect all generated scripts and RemoteEvents for server authority, syntax correctness, and memory cleanup.',
        priority: 'HIGH',
        dependsOn: ['core-loop', 'ui-hud', 'world-greybox'],
      },
    ],
  },
  {
    key: 'weekly-liveops-update',
    name: 'Weekly LiveOps Update',
    description:
      'Designs, codes, polishes, and playtests a weekly LiveOps retention event and reward drop.',
    suggestOnGameStatus: 'LIVE',
    steps: [
      {
        key: 'event-design',
        agentKey: 'liveops',
        title: 'Draft Weekly LiveOps Event & Retention Hook',
        brief:
          'Design a time-limited weekly event loop with clear 3-minute session goals and milestone rewards.',
        priority: 'HIGH',
        dependsOn: [],
      },
      {
        key: 'event-code',
        agentKey: 'builder',
        title: 'Implement LiveOps Event Feature Flag & Rewards',
        brief:
          'Implement the server-side event scheduler, quest tracker, and reward claim validation.',
        priority: 'HIGH',
        dependsOn: ['event-design'],
      },
      {
        key: 'event-vfx',
        agentKey: 'splash',
        title: 'Create Event Celebration Banner & Visual Cues',
        brief:
          'Add reward claim celebration banners, UI tween feedback, and celebratory audio triggers.',
        priority: 'NORMAL',
        dependsOn: ['event-design'],
      },
      {
        key: 'event-qa',
        agentKey: 'tester108',
        title: 'Execute 108s Mobile Playtest Pass',
        brief:
          'Verify the LiveOps event onboarding, HUD clarity, and reward claim flow on mobile.',
        priority: 'HIGH',
        dependsOn: ['event-code', 'event-vfx'],
      },
    ],
  },
  {
    key: 'mobile-108s-ux-audit',
    name: 'Mobile 108s UX Audit',
    description:
      'Audits mobile thumb-zone ergonomics, frame pacing, and first-108-second player retention.',
    suggestOnGameStatus: 'TESTING',
    steps: [
      {
        key: 'thumb-zone',
        agentKey: 'frame',
        title: 'Audit Mobile Thumb-Zone Reachability & Safe Areas',
        brief:
          'Check all interactive HUD buttons for minimum 48x48dp touch targets and safe-area inset compliance.',
        priority: 'HIGH',
        dependsOn: [],
      },
      {
        key: 'perf-check',
        agentKey: 'playtest',
        title: 'Profile Client Frame Pacing & Memory Budget',
        brief:
          'Inspect client render loops, instance counts, and connection cleanup to ensure 60 FPS on mid-tier mobile.',
        priority: 'NORMAL',
        dependsOn: [],
      },
      {
        key: 'mobile-pass',
        agentKey: 'tester108',
        title: 'Run 108s First-Time Player Mobile Walkthrough',
        brief:
          'Evaluate time-to-first-action, tutorial clarity, and mobile camera feel during the first 108 seconds.',
        priority: 'HIGH',
        dependsOn: ['thumb-zone', 'perf-check'],
      },
    ],
  },
  {
    key: 'economy-rebalance-pass',
    name: 'Economy Rebalance Pass',
    description:
      'Models currency faucets/sinks, updates pricing tables, and verifies monetization telemetry.',
    suggestOnGameStatus: null,
    steps: [
      {
        key: 'sink-source',
        agentKey: 'balance',
        title: 'Model Currency Sources, Sinks & Progression Pacing',
        brief:
          'Analyze earn rates per minute vs upgrade costs across early, mid, and endgame tiers.',
        priority: 'NORMAL',
        dependsOn: [],
      },
      {
        key: 'shop-tuning',
        agentKey: 'merchant',
        title: 'Update Economy Configs & Shop Pricing Tables',
        brief:
          'Apply the rebalanced progression curve and shop multipliers in the shared economy configuration module.',
        priority: 'NORMAL',
        dependsOn: ['sink-source'],
      },
      {
        key: 'telemetry',
        agentKey: 'pulse',
        title: 'Verify Economy Funnel & Monetization KPIs',
        brief:
          'Review progression checkpoints and conversion touchpoints for balanced retention.',
        priority: 'LOW',
        dependsOn: ['shop-tuning'],
      },
    ],
  },
  {
    key: 'pre-publish-qa-gate',
    name: 'Pre-Publish QA Gate',
    description:
      'Final security audit, 108s mobile compatibility gate, and release icon/thumbnail review package.',
    suggestOnGameStatus: 'BLUEPRINT',
    steps: [
      {
        key: 'remotes-audit',
        agentKey: 'reviewer',
        title: 'Audit All RemoteEvents & Server Validation Guards',
        brief:
          'Verify every client-to-server remote validates types, cooldowns, distance, and currency ownership.',
        priority: 'URGENT',
        dependsOn: [],
      },
      {
        key: 'mobile-gate',
        agentKey: 'tester108',
        title: 'Run Final 108s Mobile Compatibility Verification',
        brief:
          'Confirm zero FIX_FIRST blockers and smooth mobile controls prior to release.',
        priority: 'URGENT',
        dependsOn: [],
      },
      {
        key: 'release-icon',
        agentKey: 'splash',
        title: 'Prepare Release Icon & Thumbnail Package for Review',
        brief:
          'Ensure high-contrast game icon and thumbnail assets are submitted to the Review queue.',
        priority: 'HIGH',
        dependsOn: ['remotes-audit', 'mobile-gate'],
      },
    ],
  },
];

@Injectable()
export class PlaybooksService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
  ) {}

  async onModuleInit(): Promise<void> {
    const studios = await this.prisma.studio
      .findMany({ select: { id: true } })
      .catch(() => []);
    for (const s of studios) {
      await this.ensureBuiltInsForStudio(s.id).catch(() => {});
    }
  }

  async ensureBuiltInsForStudio(studioId: string): Promise<void> {
    for (const pb of BUILT_IN_PLAYBOOKS) {
      await this.prisma.playbook.upsert({
        where: { studioId_key: { studioId, key: pb.key } },
        create: {
          studioId,
          key: pb.key,
          name: pb.name,
          description: pb.description,
          steps: pb.steps as unknown as Prisma.InputJsonValue,
          suggestOnGameStatus: pb.suggestOnGameStatus,
          isBuiltIn: true,
        },
        update: {},
      });
    }
  }

  async list(studioId: string): Promise<PlaybookDto[]> {
    await this.ensureBuiltInsForStudio(studioId);
    const rows = await this.prisma.playbook.findMany({
      where: { studioId },
      orderBy: [{ isBuiltIn: 'desc' }, { name: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    studioId: string,
    body: CreatePlaybookRequest,
  ): Promise<PlaybookDto> {
    const existing = await this.prisma.playbook.findUnique({
      where: { studioId_key: { studioId, key: body.key } },
    });
    if (existing) {
      throw new AppError(
        'CONFLICT',
        HttpStatus.CONFLICT,
        `Playbook key "${body.key}" already exists`,
      );
    }

    const created = await this.prisma.playbook.create({
      data: {
        studioId,
        key: body.key,
        name: body.name.trim(),
        description: body.description?.trim() ?? '',
        steps: body.steps as unknown as Prisma.InputJsonValue,
        suggestOnGameStatus: body.suggestOnGameStatus ?? null,
        isBuiltIn: false,
      },
    });
    return this.toDto(created);
  }

  async update(
    studioId: string,
    playbookId: string,
    body: UpdatePlaybookRequest,
  ): Promise<PlaybookDto> {
    const existing = await this.prisma.playbook.findFirst({
      where: { id: playbookId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Playbook not found');
    }

    const updated = await this.prisma.playbook.update({
      where: { id: existing.id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.description !== undefined
          ? { description: body.description.trim() }
          : {}),
        ...(body.steps !== undefined
          ? { steps: body.steps as unknown as Prisma.InputJsonValue }
          : {}),
        ...(body.suggestOnGameStatus !== undefined
          ? { suggestOnGameStatus: body.suggestOnGameStatus }
          : {}),
      },
    });
    return this.toDto(updated);
  }

  async delete(
    studioId: string,
    playbookId: string,
  ): Promise<{ deletedId: string }> {
    const existing = await this.prisma.playbook.findFirst({
      where: { id: playbookId, studioId },
    });
    if (!existing) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Playbook not found');
    }
    if (existing.isBuiltIn) {
      throw new AppError(
        'FORBIDDEN',
        HttpStatus.FORBIDDEN,
        'Built-in playbooks cannot be deleted',
      );
    }
    await this.prisma.playbook.delete({ where: { id: existing.id } });
    return { deletedId: existing.id };
  }

  async run(
    studioId: string,
    playbookId: string,
    body: RunPlaybookRequest,
    userId: string,
  ): Promise<RunPlaybookResultDto> {
    const playbook = await this.prisma.playbook.findFirst({
      where: { id: playbookId, studioId },
    });
    if (!playbook) {
      throw new AppError('NOT_FOUND', HttpStatus.NOT_FOUND, 'Playbook not found');
    }

    const dto = this.toDto(playbook);
    const agents = await this.prisma.agent.findMany({
      where: { studioId },
      select: { id: true, key: true },
    });
    const agentIdByKey = new Map(agents.map((a) => [a.key, a.id]));

    const leadAgentId = agentIdByKey.get('lead');
    if (!leadAgentId) {
      throw new AppError(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'Lead agent not found in studio',
      );
    }

    const rootTask = await this.tasks.createInternal({
      studioId,
      agentId: leadAgentId,
      gameId: body.gameId ?? null,
      createdByUserId: userId,
      origin: 'USER',
      title: `Playbook: ${dto.name}`.slice(0, 140),
      brief: `Executing multi-agent playbook **${dto.name}** (${dto.steps.length} steps): ${dto.description}`,
      priority: 'HIGH',
      tags: ['playbook', dto.key],
      metadata: {
        playbookId: dto.id,
        playbookKey: dto.key,
        leadReviewSpawned: true,
      },
    });

    const taskIdByStepKey = new Map<string, string>();
    const createdTaskIds: string[] = [rootTask.id];

    // Instantiate steps in topological order so dependencies resolve
    const remaining = [...dto.steps];
    const maxPasses = remaining.length + 2;
    for (let pass = 0; pass < maxPasses && remaining.length > 0; pass++) {
      const readyIdx = remaining.findIndex((s) =>
        s.dependsOn.every((depKey) => taskIdByStepKey.has(depKey)),
      );
      const step =
        readyIdx !== -1 ? remaining.splice(readyIdx, 1)[0]! : remaining.shift()!;

      const stepAgentId = agentIdByKey.get(step.agentKey) ?? leadAgentId;
      const depTaskIds = step.dependsOn
        .map((k) => taskIdByStepKey.get(k))
        .filter((id): id is string => Boolean(id));

      const createdStepTask = await this.tasks.createInternal({
        studioId,
        agentId: stepAgentId,
        gameId: body.gameId ?? null,
        parentTaskId: rootTask.id,
        createdByUserId: userId,
        origin: 'USER',
        title: step.title,
        brief: step.brief,
        priority: step.priority,
        tags: ['playbook', dto.key, step.key].slice(0, 10),
        dependsOnTaskIds: depTaskIds,
        metadata: {
          playbookId: dto.id,
          playbookKey: dto.key,
          stepKey: step.key,
        },
      });

      taskIdByStepKey.set(step.key, createdStepTask.id);
      createdTaskIds.push(createdStepTask.id);
    }

    return {
      playbookId: dto.id,
      rootTaskId: rootTask.id,
      createdTaskIds,
      taskCount: createdTaskIds.length,
    };
  }

  toDto(row: {
    id: string;
    studioId: string;
    key: string;
    name: string;
    description: string;
    steps: unknown;
    suggestOnGameStatus: GameStatus | null;
    isBuiltIn: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): PlaybookDto {
    const rawSteps = Array.isArray(row.steps) ? row.steps : [];
    const steps: PlaybookStepDto[] = rawSteps.map((s: Record<string, unknown>, i) => ({
      key:
        typeof s['key'] === 'string'
          ? s['key']
          : typeof s['stepKey'] === 'string'
            ? s['stepKey']
            : `step-${i + 1}`,
      agentKey: (typeof s['agentKey'] === 'string'
        ? s['agentKey']
        : 'builder') as PlaybookStepDto['agentKey'],
      title: typeof s['title'] === 'string' ? s['title'] : `Step ${i + 1}`,
      brief: typeof s['brief'] === 'string' ? s['brief'] : '',
      priority: (typeof s['priority'] === 'string'
        ? s['priority']
        : 'NORMAL') as PlaybookStepDto['priority'],
      dependsOn: Array.isArray(s['dependsOn'])
        ? s['dependsOn'].filter((d): d is string => typeof d === 'string')
        : Array.isArray(s['dependsOnStepKeys'])
          ? s['dependsOnStepKeys'].filter((d): d is string => typeof d === 'string')
          : [],
    }));

    return {
      id: row.id,
      studioId: row.studioId,
      key: row.key,
      name: row.name,
      description: row.description,
      steps,
      suggestOnGameStatus: row.suggestOnGameStatus,
      isBuiltIn: row.isBuiltIn,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
