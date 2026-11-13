import type { PitchSectionKey } from '@robdev/shared';
import type { Pitch, PrismaClient } from '../../src/generated/prisma/client.js';
import { SEED_IDS, ago } from './ids.js';
import type { SeededStudioContext } from './studios.seed.js';

export interface SeededPitches {
  p1: Pitch;
  p2: Pitch;
}

const SECTION_ORDER: readonly PitchSectionKey[] = [
  'FIRST_60_SECONDS',
  'FIVE_MINUTE_LOOP',
  'MINUTES_10_30',
  'MONETIZATION',
  'COMPETITORS',
  'RISKS',
];

export async function seedPitches(
  prisma: PrismaClient,
  studioCtx: SeededStudioContext,
  now: Date,
): Promise<SeededPitches> {
  const studioId = studioCtx.inclined.id;
  const pulse = studioCtx.agentsByKey.pulse;
  const createdAt = ago(now, { hours: 6 });

  const p1 = await prisma.pitch.create({
    data: {
      id: SEED_IDS.pitches.p1,
      studioId,
      title: 'Rooftop deliveries',
      logline:
        'Sprint across neon city rooftops with a stacked courier pack: grapple-hook, wall-run, and unlock route-altering gadgets between deliveries solo or with a 4-player crew.',
      genre: 'obby / runner · session upgrades · solo + party',
      status: 'PROPOSED',
      createdByAgentId: pulse.id,
      runId: null, // linked to r15 once r15 is created
      metrics: [
        { label: 'TOP-EARNING RANK', value: '#64', tone: 'neutral' },
        { label: 'TOP COMPARABLE PLAYING', value: '18K', tone: 'positive' },
        { label: 'ITS LIKES', value: '91%', tone: 'positive' },
        { label: 'SPOTTED THIS WEEK', value: '2.2K', tone: 'positive' },
        { label: 'SIMILAR GAMES', value: '3', tone: 'neutral' },
      ],
      whatChanged:
        'Parkour-runner games with per-session gadget drafts grew +42% over the last 7 daily snapshots. Speed Run 4 and Rooftop Runner hold 91% like ratios, but neither lets upgrades unlock new vertical shortcuts.',
      howDifferent:
        'Upgrades change the route, not just the speed.',
      comparables: [
        { universeId: '900000000000001', name: 'Speed Run 4' },
        { universeId: '900000000000002', name: 'Rooftop Runner' },
        { universeId: '900000000000003', name: 'Sample Relay' },
      ],
      createdAt,
      updatedAt: createdAt,
    },
  });

  const p1Sections: Record<PitchSectionKey, string> = {
    FIRST_60_SECONDS:
      '- Spawn on the dispatch helipad with a glowing courier satchel and a 45-second drop-off beacon 300 studs away.\n- First gap introduces the **Slide-Jump** boost; landing on the blue awning triggers a +50 Coin tip burst.\n- Complete Delivery #1 in ~28 seconds and immediately pick your first **Route Gadget** (Zipline Hook or Spring Vent).',
    FIVE_MINUTE_LOOP:
      '1. **Grab** a contract from the rooftop terminal (Standard, Fragile, or Timed VIP).\n2. **Run** the skyline route, chaining wall-runs and ziplines to keep the combo meter at ×3.\n3. **Draft** a session upgrade after every 2 deliveries that opens higher shortcuts across the district.\n4. **Cash in** stamps in the Collection Book to permanently unlock new courier rigs.',
    MINUTES_10_30:
      '- Unlock **District 2 (Neon Harbor)** with moving cranes and co-op relay handoffs.\n- Party bonus (+15% tips per crew member) encourages 4-player rooftop relays.\n- First monetisation prompt at minute 14: **Grapple Pro Starter Pack (99 R$)**.',
    MONETIZATION:
      '| Product | Type | Price |\n|---|---|---|\n| Grapple Pro Starter Pack | Dev product | 99 R$ |\n| 2× Courier Tips | Gamepass | 199 R$ |\n| VIP Glider Trail + District Pass | Gamepass | 299 R$ |\n| Instant Contract Reroll | Dev product | 29 R$ |',
    COMPETITORS:
      '| Game | CCU | 7d | Likes | Gap we exploit |\n|---|---|---|---|---|\n| Speed Run 4 | 18.0K | +42% | 91% | Linear speed-only stages; no route-changing gadgets |\n| Rooftop Runner | 6.4K | +19% | 89% | Solo time-trial only; no party relay or collection book |',
    RISKS:
      '- **Mobile camera control on vertical jumps:** mitigated by soft look-ahead spline framing on ziplines and wall-runs ([08 Mobile]).\n- **Route readability at high speed:** high-contrast yellow/cyan edge trim on all climbable ledges ([06 World and Look]).\n- **Content burn rate:** modular rooftop chunks allow Scenic to assemble new districts in under 2 hours.',
  };

  for (let i = 0; i < SECTION_ORDER.length; i++) {
    const key = SECTION_ORDER[i]!;
    await prisma.pitchSection.create({
      data: {
        pitchId: p1.id,
        key,
        markdown: p1Sections[key],
        sortOrder: i + 1,
      },
    });
  }

  const p2 = await prisma.pitch.create({
    data: {
      id: SEED_IDS.pitches.p2,
      studioId,
      title: 'Pocket workshop',
      logline:
        'Build a miniature clockwork & gadget workshop: snap gears, solder glowing cores, test contraptions on the tabletop track, and trade custom blueprints with friends.',
      genre: 'tycoon / builder · gadget assembly · solo + co-op',
      status: 'PROPOSED',
      createdByAgentId: pulse.id,
      runId: null, // linked to r15 once r15 is created
      metrics: [
        { label: 'TOP-EARNING RANK', value: '#142', tone: 'neutral' },
        { label: 'TOP COMPARABLE PLAYING', value: '9.6K', tone: 'positive' },
        { label: 'ITS LIKES', value: '87%', tone: 'positive' },
        { label: 'SPOTTED THIS WEEK', value: '420', tone: 'positive' },
        { label: 'SIMILAR GAMES', value: '6', tone: 'neutral' },
      ],
      whatChanged:
        'Sample Workshop grew +31% over 7 daily snapshots while traditional dropper tycoons plateaued. Players reward tactile micro-assembly loops with higher D1 retention.',
      howDifferent:
        'Every workbench is a tactile 8-second assembly gadget rather than an idle dropper.',
      comparables: [
        { universeId: '900000000000002', name: 'Sample Workshop' },
        { universeId: '900000000000006', name: 'Cake Empire Café' },
      ],
      createdAt,
      updatedAt: createdAt,
    },
  });

  const p2Sections: Record<PitchSectionKey, string> = {
    FIRST_60_SECONDS:
      "- Spawn in a tiny market stall; Grandma Butter waves and says **'First customer in 10 seconds!'**\n- Tap the glowing oven: a 3-layer stack minigame with perfect-timing rings.\n- Serve the cake: the customer reacts (hearts for a perfect stack) and you get +40 coins with a coin fountain.\n- A **Shop Upgrade** arrow points to the second oven (35 coins), an instant affordable upgrade.",
    FIVE_MINUTE_LOOP:
      '1. **Order** arrives (cake type, layers, topping).\n2. **Bake** the minigame (stack timing → frosting swipe → topping tap).\n3. **Serve** with a score from 1 to 3 stars; tips scale with stars and streak.\n4. **Upgrade** ovens, counters and décor; décor raises customer patience.\n5. **Unlock** a recipe roughly every 4 minutes early on.\n\nSessions feel productive in 5 minutes: 12–15 orders and 2 upgrades.',
    MINUTES_10_30:
      "- Shop level 3 unlocks **Hire a Helper** (an NPC auto-serves simple orders), the idle layer for returning players.\n- The **Recipe Book** index: 36 cakes in 6 rarity tiers, each with a golden variant.\n- **Visit friends' bakeries** and leave a 'Sweet!' rating (social proof, daily cap).\n- The first-purchase offer appears at around 12 minutes: **Starter Bakery Pack (99 R$)**.",
    MONETIZATION:
      '| Product | Type | Price |\n|---|---|---|\n| Starter Bakery Pack | Dev product | 99 R$ |\n| Golden Oven (2× bake speed) | Gamepass | 199 R$ |\n| Extra Helper slot | Gamepass | 249 R$ |\n| Premium Décor set (rotating) | Dev product | 149 R$ |\n| Tip Jar (+25% tips) | Gamepass | 299 R$ |',
    COMPETITORS:
      '| Game | CCU | 7d | Likes | Gap we exploit |\n|---|---|---|---|---|\n| Cake Empire Café | 11.2K | +18% | 91% | Idle only, no skill expression |\n| Bakery Tycoon Deluxe | 4.1K | +52% | 89% | Small content pool (12 recipes) |\n| Mega Mall Roleplay | 72.4K | +4% | 85% | Huge roleplay audience that likes shop fantasy |',
    RISKS:
      '- **Minigame fatigue:** mitigated by helpers taking simple orders and by perfect streaks granting auto-bake.\n- **Audience skews younger:** keep reading level simple and text icons-first ([05 UI and HUD]).\n- **Décor UGC moderation:** use preset décor only, with no free text on signs.\n- **Competitor response:** Cake Empire could add minigames; our edge has to be recipe depth and the street progression.',
  };

  for (let i = 0; i < SECTION_ORDER.length; i++) {
    const key = SECTION_ORDER[i]!;
    await prisma.pitchSection.create({
      data: {
        pitchId: p2.id,
        key,
        markdown: p2Sections[key],
        sortOrder: i + 1,
      },
    });
  }

  return { p1, p2 };
}
