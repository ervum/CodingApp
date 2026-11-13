import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import {
  AGENT_ROSTER,
  type AgentDto,
  type ReviewItemDto,
  type ServerToClientEvents,
  type StudioSnapshotDto,
  type TaskDto,
} from '@robdev/shared';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioApiService } from '../api/studio-api.service';
import { TasksApiService } from '../api/tasks-api.service';
import { SocketService } from '../realtime/socket.service';
import { EMPTY_COUNTS, StudioStoreService } from './studio-store.service';

describe('StudioStoreService', () => {
  let store: StudioStoreService;
  let streams: {
    [K in keyof ServerToClientEvents]: Subject<Parameters<ServerToClientEvents[K]>[0]>;
  };
  let reconnect$: Subject<void>;
  let mockSnapshot: StudioSnapshotDto;

  beforeEach(async () => {
    streams = {
      'agent:status': new Subject(),
      'agent:log-chunk': new Subject(),
      'agent:activity': new Subject(),
      'agent:message': new Subject(),
      'run:started': new Subject(),
      'run:finished': new Subject(),
      'task:updated': new Subject(),
      'task:output-ready': new Subject(),
      'review:item': new Subject(),
      'review:verdict': new Subject(),
      'studio:counts': new Subject(),
      'studio:paused': new Subject(),
      'human-request:updated': new Subject(),
      'lane:updated': new Subject(),
      'game:updated': new Subject(),
      'pitch:updated': new Subject(),
      'vault:document-updated': new Subject(),
      'market:ingested': new Subject(),
      'chat:history-changed': new Subject(),
      'agent:screen': new Subject(),
      'asset:updated': new Subject(),
    };
    reconnect$ = new Subject<void>();

    const agents: AgentDto[] = AGENT_ROSTER.map((entry) => ({
      id: `agent-${entry.key}`,
      key: entry.key,
      name: entry.name,
      title: entry.title,
      color: entry.color,
      glyph: entry.glyph,
      order: entry.order,
      status: entry.key === 'builder' || entry.key === 'playtest' ? 'WORKING' : 'IDLE',
      isEnabled: true,
      currentTaskId: null,
      currentTaskTitle: null,
      currentRunId: null,
      currentGameId: null,
      lastActivityAt: null,
      lastSnippet: null,
      modelLabel: 'Google · gemini-2.5-pro',
      lastErrorCode: null,
    }));

    mockSnapshot = {
      studio: {
        id: 'studio-1',
        slug: 'inclined-games',
        name: 'Inclined Games',
        workspaceLabel: 'robdev / Inclined Games studio',
        isPaused: false,
        pausedAt: null,
      },
      myRole: 'OWNER',
      agents,
      games: [
        {
          id: 'game-anime',
          slug: 'anime-awakening-rng',
          name: 'Anime Awakening RNG',
          genre: 'RNG',
          status: 'LIVE',
          accentColor: '#A855F7',
          iconUrl: null,
          latestSavedVersion: 1467,
          latestPublishedVersion: 404,
          milestonesDone: 7,
          milestonesTotal: 9,
          progressPct: 78,
          currentStage: 'Live Ops Event #1',
          laneName: 'Studio Lane A',
          laneAgentKey: 'playtest',
          robloxPlaceId: '1001',
          playUrl: 'https://www.roblox.com/games/1001',
          updatedAt: '2026-04-20T12:00:00.000Z',
        },
        {
          id: 'game-dino',
          slug: 'dig-up-a-dino',
          name: 'Dig Up a Dino',
          genre: 'Simulator',
          status: 'BUILDING',
          accentColor: '#22C55E',
          iconUrl: null,
          latestSavedVersion: 312,
          latestPublishedVersion: null,
          milestonesDone: 4,
          milestonesTotal: 9,
          progressPct: 44,
          currentStage: 'Core Digging Loop',
          laneName: null,
          laneAgentKey: null,
          robloxPlaceId: null,
          playUrl: null,
          updatedAt: '2026-04-20T12:00:00.000Z',
        },
      ],
      lanes: [
        {
          id: 'lane-a',
          name: 'Studio Lane A',
          sortOrder: 1,
          heldByAgentKey: 'playtest',
          heldForGameId: 'game-anime',
          heldByRunId: 'run-playtest-1',
          heldSince: '2026-04-20T12:00:00.000Z',
        },
      ],
      liveRuns: [],
      humanRequests: [],
      counts: {
        ...EMPTY_COUNTS,
        needsYou: 4,
        working: 2,
        openTasks: 3,
        review: {
          toReview: 5,
          changesAsked: 1,
          approved: 1,
          rejected: 1,
          all: 8,
          byTab: {
            IMAGES_VIDEO: { toReview: 3, all: 6 },
            STAGES_PUBLISH: { toReview: 2, all: 2 },
          },
        },
      },
      setup: { hasAnyLlmConnection: true, unboundAgentKeys: [] },
      serverTime: '2026-04-20T12:00:00.000Z',
    };

    const mockApi = {
      snapshot: vi.fn().mockReturnValue(of(mockSnapshot)),
    } as unknown as StudioApiService;

    const mockSocket = {
      connect: vi.fn(),
      emitWithAck: vi.fn().mockResolvedValue({ joinedAt: '2026-04-20T12:00:00.000Z' }),
      on: vi.fn((event: keyof ServerToClientEvents) => streams[event].asObservable()),
      onReconnect$: reconnect$.asObservable(),
    } as unknown as SocketService;

    const mockTasksApi = {
      listOutputs: vi.fn().mockReturnValue(of({ items: [] })),
    } as unknown as TasksApiService;

    const injector = Injector.create({
      providers: [
        { provide: StudioApiService, useValue: mockApi },
        { provide: TasksApiService, useValue: mockTasksApi },
        { provide: SocketService, useValue: mockSocket },
        { provide: StudioStoreService, useFactory: () => new StudioStoreService() },
      ],
    });

    store = runInInjectionContext(injector, () => injector.get(StudioStoreService));
    await store.activate('studio-1');
  });

  it('computes executionSummary and workingAgents from snapshot', () => {
    expect(store.workingAgents().length).toBe(2);
    expect(store.executionSummary()).toBe('2 agents working · Playtest has Studio');
  });

  it('filters filteredTasks and filteredReviewItems by selectedGameId and computes reviewCountForFilter', () => {
    const taskA: TaskDto = {
      id: 'task-1',
      title: 'Fix boss',
      brief: 'Fix boss fight',
      status: 'RUNNING',
      priority: 'HIGH',
      origin: 'LEAD_DELEGATION',
      agentKey: 'builder',
      gameId: 'game-anime',
      parentTaskId: null,
      tags: ['combat'],
      dependsOn: [],
      waitingOnDependencies: false,
      attempts: 1,
      createdAt: '2026-04-20T12:00:00.000Z',
      queuedAt: '2026-04-20T12:00:00.000Z',
      startedAt: '2026-04-20T12:01:00.000Z',
      completedAt: null,
      resultSummary: null,
      latestRunId: 'run-1',
      openHumanRequestId: null,
    };
    const taskB: TaskDto = {
      ...taskA,
      id: 'task-2',
      gameId: 'game-dino',
      status: 'QUEUED',
    };
    store.tasks.set([taskA, taskB]);

    const revA: ReviewItemDto = {
      id: 'rev-1',
      kind: 'ICON',
      tab: 'IMAGES_VIDEO',
      status: 'TO_REVIEW',
      title: 'Icon v1',
      gameId: 'game-anime',
      gameName: 'Anime Awakening RNG',
      madeByAgentKey: 'splash',
      media: {
        id: 'media-1',
        url: '/api/media/media-1/raw',
        mimeType: 'image/svg+xml',
        width: 512,
        height: 512,
        bytes: 399000,
        durationSec: null,
      },
      iteration: 1,
      openBlockers: 0,
      openFixFirst: 0,
      createdAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:00.000Z',
    };
    const revB: ReviewItemDto = {
      ...revA,
      id: 'rev-2',
      gameId: 'game-dino',
      gameName: 'Dig Up a Dino',
      status: 'APPROVED',
    };
    store.reviewItems.set([revA, revB]);

    expect(store.filteredTasks().length).toBe(2);
    expect(store.filteredReviewItems().length).toBe(2);
    expect(store.reviewCountForFilter('TO_REVIEW')).toBe(1);
    expect(store.reviewCountForFilter('APPROVED')).toBe(1);
    expect(store.reviewCountForFilter('ALL')).toBe(2);

    store.selectGame('game-anime');
    expect(store.filteredTasks().map((t) => t.id)).toEqual(['task-1']);
    expect(store.filteredReviewItems().map((r) => r.id)).toEqual(['rev-1']);
    expect(store.reviewCountForFilter('TO_REVIEW')).toBe(1);
    expect(store.reviewCountForFilter('APPROVED')).toBe(0);
  });

  it('applies WebSocket deltas for agent:status, agent:log-chunk, task:updated, and review:verdict', () => {
    streams['agent:status'].next({
      studioId: 'studio-1',
      agentKey: 'lead',
      status: 'WAITING_ON_HUMAN',
      currentTaskId: 'task-1',
      currentTaskTitle: 'Coordinate launch',
      currentRunId: 'run-1',
      currentGameId: 'game-anime',
      lastSnippet: 'Awaiting operator reply',
      lastErrorCode: null,
      at: '2026-04-20T12:05:00.000Z',
    });

    expect(store.agent('lead')()?.status).toBe('WAITING_ON_HUMAN');
    expect(store.navBadges().lead).toBe(1);

    streams['agent:log-chunk'].next({
      studioId: 'studio-1',
      at: '2026-04-20T12:05:01.000Z',
      agentKey: 'builder',
      runId: 'run-99',
      entryId: 'entry-1',
      seq: 1,
      kind: 'TEXT',
      delta: 'local Damage = ',
      entry: null,
      meta: null,
    });
    streams['agent:log-chunk'].next({
      studioId: 'studio-1',
      at: '2026-04-20T12:05:02.000Z',
      agentKey: 'builder',
      runId: 'run-99',
      entryId: 'entry-1',
      seq: 2,
      kind: 'TEXT',
      delta: '100',
      entry: null,
      meta: null,
    });
    expect(store.logBuffers().get('run-99:entry-1')).toBe('local Damage = 100');

    streams['task:updated'].next({
      studioId: 'studio-1',
      at: '2026-04-20T12:06:00.000Z',
      change: 'created',
      task: {
        id: 'task-99',
        title: 'New streamed task',
        brief: 'Build aura VFX',
        status: 'RUNNING',
        priority: 'NORMAL',
        origin: 'LEAD_DELEGATION',
        agentKey: 'scenic',
        gameId: 'game-anime',
        parentTaskId: null,
        tags: [],
        dependsOn: [],
        waitingOnDependencies: false,
        attempts: 1,
        createdAt: '2026-04-20T12:06:00.000Z',
        queuedAt: '2026-04-20T12:06:00.000Z',
        startedAt: '2026-04-20T12:06:01.000Z',
        completedAt: null,
        resultSummary: null,
        latestRunId: null,
        openHumanRequestId: null,
      },
    });
    expect(store.tasks().some((t) => t.id === 'task-99')).toBe(true);

    store.reviewItems.set([
      {
        id: 'rev-99',
        kind: 'ICON',
        tab: 'IMAGES_VIDEO',
        status: 'TO_REVIEW',
        title: 'Pending Icon',
        gameId: 'game-anime',
        gameName: 'Anime Awakening RNG',
        madeByAgentKey: 'splash',
        media: null,
        iteration: 1,
        openBlockers: 0,
        openFixFirst: 0,
        createdAt: '2026-04-20T12:00:00.000Z',
        updatedAt: '2026-04-20T12:00:00.000Z',
      },
    ]);

    streams['review:verdict'].next({
      studioId: 'studio-1',
      at: '2026-04-20T12:07:00.000Z',
      reviewItemId: 'rev-99',
      verdict: 'APPROVE',
      status: 'APPROVED',
      feedback: 'Looks great!',
      byUserName: 'Operator',
      followUpTaskId: null,
    });
    expect(store.reviewItems().find((r) => r.id === 'rev-99')?.status).toBe('APPROVED');
  });
});
