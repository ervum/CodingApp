import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { StudioStoreService } from '../../core/state/studio-store.service';
import { ToastService } from '../../shared/ui/toast/toast.service';
import { PitchesStore } from './pitches.store';

export type PitchFilterTab = 'DECISION' | 'WAITING' | 'IDEAS' | 'HISTORY';
export type PitchAccordionKey = 'game' | 'competitors' | 'evidence' | 'building' | 'risks';

export interface PitchCardViewModel {
  id: string;
  genreTag: string;
  matchLabel: string;
  matchTone: 'strong' | 'good';
  title: string;
  proposedAgo: string;
  summary: string;
  howDifferent: string;
  metrics: Array<{ label: string; value: string }>;
  coreLoop: string;
  first60Seconds: string;
  whyComeBack: string;
  competitors: string[];
  evidence: string;
  buildingIt: string;
  risks: string;
}

const PITCH_CARDS: readonly PitchCardViewModel[] = [
  {
    id: 'pitch-rooftop',
    genreTag: 'Action · Parkour',
    matchLabel: 'Strong match',
    matchTone: 'strong',
    title: 'Rooftop deliveries',
    proposedAgo: 'Proposed 18m ago',
    summary:
      'Race parcels across a shifting skyline before the weather turns — fast 3-minute runs with friends.',
    howDifferent:
      'Co-op relay handoffs in mid-air — drop the parcel and a friend catches it without losing the speed bonus.',
    metrics: [
      { label: 'FIRST PLAYABLE', value: '~4 days' },
      { label: 'EXPECTED DAY 1', value: '14–18%' },
      { label: 'GENRE GROWTH', value: '+42% over 14d' },
      { label: 'AUDIENCE FIT', value: '9–15 · mobile-first' },
      { label: 'SIMILAR HITS', value: '3 in top 200' },
    ],
    coreLoop:
      'Grab a fragile parcel at the dispatch tower → chain ziplines, wall-runs, and mid-air co-op passes across 4 shifting districts → bank streak multipliers before the storm wall hits.',
    first60Seconds:
      'Spawn on the dispatch pad with a countdown parcel already strapped on, hit a boost ramp within 6 seconds, and complete your first rooftop drop at 0:42.',
    whyComeBack:
      'Rotating daily weather hazards, unlockable glider rigs, and 4-player relay leaderboards with cosmetic courier trails.',
    competitors: [
      'Skyline Runners (8.2K CCU · 90.4% likes)',
      'Parcel Dash Obby (4.6K CCU · 88.1% likes)',
      'Neon Parkour Relay (3.1K CCU · 92.0% likes)',
    ],
    evidence:
      'Co-op movement games under 4-minute session loops grew +42% over the last 14 days on Up-and-Coming with high mobile thumbstick completion.',
    buildingIt:
      'Reuses Zone 1 movement controller and Mobile thumbstick safe-zones from Library; Scenic builds 8 modular rooftop tiles.',
    risks:
      'Mid-air pass latency on high-ping mobile connections; mitigated by client-predicted catch radius (12 studs).',
  },
  {
    id: 'pitch-workshop',
    genreTag: 'Tycoon · Crafting',
    matchLabel: 'Good match',
    matchTone: 'good',
    title: 'Pocket workshop',
    proposedAgo: 'Proposed 2h ago',
    summary:
      'Build tiny mechanical contraptions on a workbench, test them on an obstacle track, and sell blueprints to other players.',
    howDifferent:
      'Every contraption fits in a 6x6 stud grid — fast mobile building without camera fights, plus instant 1-tap blueprint trading.',
    metrics: [
      { label: 'FIRST PLAYABLE', value: '~6 days' },
      { label: 'EXPECTED DAY 1', value: '15–19%' },
      { label: 'GENRE GROWTH', value: '+31% over 14d' },
      { label: 'AUDIENCE FIT', value: '10–16 · tablet/PC' },
      { label: 'SIMILAR HITS', value: '4 in top 200' },
    ],
    coreLoop:
      'Snap gears, springs, and thrusters onto a 6x6 workbench → launch your contraption down the hazard track → earn bolts and list top-scoring blueprints in the player market.',
    first60Seconds:
      'Start with a pre-half-built spring cart, snap on 2 booster wheels in 3 taps, and launch it over the first ramp at 0:35.',
    whyComeBack:
      'Passive blueprint royalties when other players buy your designs, weekly track modifiers, and rare clockwork parts.',
    competitors: [
      'Sample Workshop (7.6K CCU · 91.2% likes)',
      'Build A Cart Lab (5.9K CCU · 89.5% likes)',
      'Contraption Tycoon (3.8K CCU · 90.1% likes)',
    ],
    evidence:
      'Compact sandbox crafting titles show +31% 14-day CCU velocity and 11.4m median session lengths across tablet and PC cohorts.',
    buildingIt:
      'Uses Server purchase checks and Delivery loop from Library; Builder implements 6x6 snap-grid serializer.',
    risks:
      'Physics solver jitter when 8+ contraptions run simultaneously; mitigated by deterministic client track lanes.',
  },
];

@Component({
  selector: 'rd-pitches-page',
  standalone: true,
  imports: [],
  providers: [PitchesStore],
  templateUrl: './pitches.page.html',
  styleUrl: './pitches.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PitchesPage {
  readonly studioStore = inject(StudioStoreService);
  readonly pitchesStore = inject(PitchesStore);
  private readonly toast = inject(ToastService);

  readonly activeFilter = signal<PitchFilterTab>('DECISION');
  readonly compareMode = signal<boolean>(false);
  readonly pitchCards = signal<PitchCardViewModel[]>([...PITCH_CARDS]);

  readonly openAccordions = signal<ReadonlyMap<string, ReadonlySet<PitchAccordionKey>>>(
    new Map([
      ['pitch-rooftop', new Set<PitchAccordionKey>(['game'])],
      ['pitch-workshop', new Set<PitchAccordionKey>(['game'])],
    ]),
  );

  isAccordionOpen(pitchId: string, key: PitchAccordionKey): boolean {
    return this.openAccordions().get(pitchId)?.has(key) ?? false;
  }

  toggleAccordion(pitchId: string, key: PitchAccordionKey): void {
    this.openAccordions.update((map) => {
      const next = new Map(map);
      const cur = new Set(next.get(pitchId) ?? []);
      if (cur.has(key)) {
        cur.delete(key);
      } else {
        cur.add(key);
      }
      next.set(pitchId, cur);
      return next;
    });
  }

  toggleCompare(): void {
    this.compareMode.update((v) => !v);
  }

  approvePitch(pitch: PitchCardViewModel): void {
    this.toast.success(`Approved "${pitch.title}" — Lead and Architect are kicking off the build`);
  }

  editAndApprovePitch(pitch: PitchCardViewModel): void {
    this.toast.info(`Opened scope editor for "${pitch.title}"`);
  }

  requestChangesPitch(pitch: PitchCardViewModel): void {
    this.toast.info(`Requested Pulse revisions on "${pitch.title}"`);
  }

  declinePitch(pitch: PitchCardViewModel): void {
    this.toast.warning(`Moved "${pitch.title}" to History`);
  }
}
