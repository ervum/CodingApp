import '@angular/compiler';
import { Injector, runInInjectionContext, signal } from '@angular/core';
import type { ReviewItemDetailDto, Verdict } from '@robdev/shared';
import { describe, expect, it } from 'vitest';
import { HotkeysService } from '../../core/keyboard/hotkeys.service';
import { ReviewDrawerComponent } from './review-drawer.component';

function createComponent(detail: ReviewItemDetailDto, canAct = true): {
  comp: ReviewDrawerComponent;
  verdicts: Array<{ verdict: Verdict; feedback: string }>;
  handlers: Map<string, () => void>;
} {
  const handlers = new Map<string, () => void>();
  const mockHotkeys = {
    register: (combo: string, fn: () => void) => {
      handlers.set(combo, fn);
      return () => handlers.delete(combo);
    },
  } as unknown as HotkeysService;

  const injector = Injector.create({
    providers: [{ provide: HotkeysService, useValue: mockHotkeys }],
  });

  const comp = runInInjectionContext(injector, () => new ReviewDrawerComponent());
  Object.defineProperty(comp, 'detail', { value: signal(detail) });
  Object.defineProperty(comp, 'canAct', { value: signal(canAct) });
  Object.defineProperty(comp, 'busy', { value: signal(false) });

  const verdicts: Array<{ verdict: Verdict; feedback: string }> = [];
  comp.verdict.subscribe((v) => verdicts.push(v));

  return { comp, verdicts, handlers };
}

describe('ReviewDrawerComponent', () => {
  const baseImageDetail: ReviewItemDetailDto = {
    id: 'ri-02',
    kind: 'ICON',
    tab: 'IMAGES_VIDEO',
    status: 'TO_REVIEW',
    title: 'Anime Awakening Icon v2',
    description: 'High-contrast 1:1 icon',
    gameId: 'game-anime',
    gameName: 'Anime Awakening RNG',
    madeByAgentKey: 'splash',
    media: {
      id: 'm-1',
      url: '/api/media/m-1/raw',
      mimeType: 'image/png',
      width: 512,
      height: 512,
      bytes: 399_000,
      durationSec: null,
    },
    iteration: 2,
    openBlockers: 0,
    openFixFirst: 0,
    payload: null,
    verdicts: [],
    blockers: [],
    previousIterations: [],
    taskId: null,
    runId: null,
    createdAt: '2026-04-20T12:00:00.000Z',
    updatedAt: '2026-04-20T12:00:00.000Z',
  };

  it('computes agentName, image strip aspect ratio, and emits verdicts via hotkeys A, C, and X', () => {
    const { comp, verdicts, handlers } = createComponent(baseImageDetail, true);

    expect(comp.agentName()).toBe('Splash');
    expect(comp.isImage()).toBe(true);
    expect(comp.aspect()).toBe('1:1');
    expect(comp.approveDisabled()).toBe(false);

    handlers.get('a')?.();
    expect(verdicts).toEqual([{ verdict: 'APPROVE', feedback: '' }]);

    comp.feedback.set('Increase silhouette contrast at 64px');
    handlers.get('c')?.();
    expect(verdicts[1]).toEqual({
      verdict: 'ASK_CHANGES',
      feedback: 'Increase silhouette contrast at 64px',
    });

    handlers.get('x')?.();
    expect(verdicts[2]).toEqual({
      verdict: 'REJECT',
      feedback: 'Increase silhouette contrast at 64px',
    });
  });

  it('disables Approve with FIX FIRST tooltip when STAGE or PUBLISH item has openFixFirst > 0', () => {
    const publishWithBlocker: ReviewItemDetailDto = {
      ...baseImageDetail,
      id: 'ri-09',
      kind: 'PUBLISH',
      tab: 'STAGES_PUBLISH',
      media: null,
      openBlockers: 1,
      openFixFirst: 1,
      blockers: [
        {
          id: 'blk-1',
          severity: 'FIX_FIRST',
          status: 'OPEN',
          title: 'Close button clipped on 800x360',
          detail: 'Top-right close button overlaps safe zone',
          agentKey: 'tester108',
          buildVersion: 1467,
          createdAt: '2026-04-20T12:00:00.000Z',
        },
      ],
    };

    const { comp, verdicts, handlers } = createComponent(publishWithBlocker, true);

    expect(comp.hasFixFirstBlocker()).toBe(true);
    expect(comp.approveDisabled()).toBe(true);
    expect(comp.approveTooltip()).toBe('Resolve FIX FIRST blockers first');

    handlers.get('a')?.();
    expect(verdicts.length).toBe(0);
  });
});
