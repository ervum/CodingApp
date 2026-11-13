import type { LogEntryKind } from '@robdev/shared';
import { SEED_IDS } from './ids.js';

export interface SeedLogEntrySpec {
  kind: LogEntryKind;
  content: string;
  meta?: Record<string, unknown>;
}

export interface SeedArtifactSpec {
  path: string;
  language: string;
  content: string;
}

export const FRAME_RAID_MENU_MD = `### Raid menu — PC 1920×1080
\`\`\`ascii
┌──────────────────────────────────────────────────────────────────────────────┐
│ [≡][💬]  (Roblox controls — keep clear, 58px)            ⏱ 04:32   ♥ 87%     │
│                                                                              │
│   ┌─────────────── HOLLOW SHOGUN · RAID ────────────────┐   ┌─ PARTY (4) ─┐  │
│   │  Difficulty:  [ Normal ] [ Hard ] [▣ Nightmare ]    │   │ ● Ervum  ★  │  │
│   │  Rewards:  Awakening Shard ×3 · 2% Mythic Mask      │   │ ● Maya      │  │
│   │  Recommended power: 12,500                          │   │ ○ empty     │  │
│   │                                                     │   │ ○ empty     │  │
│   │      [  START RAID  ]  (Green 68,214,72)            │   │ [ INVITE ]  │  │
│   └─────────────────────────────────────────────────────┘   └─────────────┘  │
│                                                         [ ✕ ] (Red 235,82,82)│
└──────────────────────────────────────────────────────────────────────────────┘
\`\`\`
### Raid menu — Mobile landscape 844×390 (notched)
\`\`\`ascii
┌─notch─┬────────────────────────────────────────────────────────────┐
│ 47px  │ [≡][💬]            ⏱ 04:32                         [ ✕ ]   │
│ safe  │  ┌──── HOLLOW SHOGUN ─────┐  ┌─ PARTY 2/4 ─┐                │
│ inset │  │ [Nrm][Hrd][▣Ntm]       │  │ ● Ervum ★   │                │
│       │  │ Shard ×3 · 2% Mythic   │  │ ● Maya      │                │
│       │  │ [   START RAID   ] 52px│  │ [ INVITE ]  │                │
│       │  └────────────────────────┘  └─────────────┘                │
│       │ (thumbstick zone — empty)                    (jump — empty) │
└───────┴────────────────────────────────────────────────────────────┘
\`\`\`
- Timer moved from top-left to top-center: it overlapped the Roblox chat button at 844×390.
- START RAID is 52 px tall on mobile (≥ 44 px), Green (68, 214, 72). Close is Red (235, 82, 82), top-right, 44×44.`;

export const BUILDER_HOLLOW_SHOGUN_PHASE2_LUAU = `--!strict
-- ServerScriptService/Raid/HollowShogunPhase2.server.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local RaidConfig = require(ReplicatedStorage.Shared.RaidConfig)
local DamageService = require(script.Parent.DamageService)

local Phase2 = {}
Phase2.__index = Phase2

export type Phase2 = typeof(setmetatable({} :: {
\tboss: Model,
\tarena: Model,
\tringAngle: number,
\tconnections: { RBXScriptConnection },
\talive: boolean,
}, Phase2))

local RING_SPEED = math.rad(RaidConfig.HollowShogun.Phase2.RingDegreesPerSecond) -- 72°/s
local RING_DAMAGE = RaidConfig.HollowShogun.Phase2.RingDamage -- 18% max HP, server-validated

function Phase2.new(boss: Model, arena: Model): Phase2
\tlocal self = setmetatable({
\t\tboss = boss,
\t\tarena = arena,
\t\tringAngle = 0,
\t\tconnections = {},
\t\talive = true,
\t}, Phase2)
\treturn self
end

function Phase2:Start()
\tlocal humanoid = self.boss:FindFirstChildOfClass("Humanoid") :: Humanoid
\thumanoid.WalkSpeed *= RaidConfig.HollowShogun.Phase2.EnrageSpeedMultiplier
\tfor _ = 1, 2 do
\t\ttask.spawn(DamageService.SpawnMinion, self.arena, "ShadowRonin")
\tend
\ttable.insert(self.connections, game:GetService("RunService").Heartbeat:Connect(function(dt: number)
\t\tself:_stepRing(dt)
\tend))
end`;

export const BALANCE_RAID_LOOT_JSON = `{ "boss": "HollowShogun", "rollsPerClear": 3,
  "table": [
    { "item": "Awakening Shard", "rarity": "Rare", "weight": 6200 },
    { "item": "Shogun Katana Skin", "rarity": "Epic", "weight": 2600 },
    { "item": "Hollow Aura", "rarity": "Legendary", "weight": 1000 },
    { "item": "Mythic Oni Mask", "rarity": "Mythic", "weight": 199 },
    { "item": "Void Emperor Fragment", "rarity": "Secret", "weight": 1 } ],
  "totalWeight": 10000, "pity": { "item": "Mythic Oni Mask", "guaranteedAtClears": 60 } }`;

export const ARCHITECT_DINO_BLUEPRINT_MD = `# Dig Up a Dino — 12-Step Technical & Design Blueprint

## 1. Player fantasy & pillars
Uncover complete dinosaur skeletons buried across vibrant stratified dig sites, assemble them in a personal museum that earns passive visitor tips, and trade duplicate rare bones with friends. Pillars: tactile 0.6s dig feedback [02 The Core Loop], readable mobile-first controls [05 UI and HUD], and honest collection odds [03 Rarity and RNG].

## 2. First five minutes
Players spawn facing the glowing Zone 1 sand pit with a Rusty Shovel equipped and zero modal popups [01 The First Five Minutes]. The first tile breaks in two taps and guarantees an Uncommon Triceratops Horn with a coin burst; after three tiles the HUD points to the Steel Pick upgrade (250 coins) and the Museum pedestal.

## 3. Core loop diagram
\`\`\`ascii
  ┌────────► DIG TILE (0.6-1.0s) ────────┐
  │                                      ▼
UPGRADE ◄── SELL / MOUNT ◄── FOSSIL + COINS
\`\`\`

## 4. Progression & economy hooks
Soft currency is Coins; tool upgrades follow \`base * 1.15^n\` and zone unlocks follow \`1250 * 4.5^(z-1)\` so Zone 2 (Amber Canyon) unlocks at ~6 minutes [04 Progression and Economy]. Museum skeleton completion grants a permanent +10% zone coin multiplier.

## 5. Rarity/RNG model
Seven-tier ladder from Common (1 in 2) to Secret Amber T-Rex (1 in 10,000,000) validated on the server on boot [03 Rarity and RNG]. Displayed odds match integer weights; Mythic fossils have a visible 60-dig site pity counter.

## 6. UI & HUD screen list
Four core screens following [05 UI and HUD]: Main HUD (right-thumb 96×96 Dig button above Jump, top-center zone progress bar clear of the 58px Roblox inset), Tool & Backpack Shop modal, Fossil Index grid by rarity, and Museum Placement HUD.

## 7. World zones
Zone 1 Fern Valley (green/tan with orange flags), Zone 2 Amber Canyon (orange/amber with teal crystals), Zone 3 Permafrost Ridge, and the central Museum Plaza [06 World and Look]. Each zone stays under 15,000 instances with StreamingEnabled radius 256 [08 Mobile].

## 8. Data model
Single ProfileService-style document keyed by \`player_<userId>\` with \`schemaVersion = 2\`, storing \`coins\`, \`equippedTool\`, \`ownedTools\`, \`fossilInventory\`, \`museumDisplays\`, and \`pityCounters\` [13 Building It Right].

## 9. Server/client architecture
\`DigService\`, \`InventoryService\`, \`MuseumService\`, and \`TradeService\` live in \`ServerScriptService/Services\`. Clients play shovel swing animations immediately while \`DigTileRemote\` validates tool reach, cooldown, and server-side RNG [13 Building It Right].

## 10. Monetisation surfaces
Starter Fossil Pack (99 R$ at minute 12), 2× Dig Speed Gamepass (199 R$), Auto-Dig Gamepass (249 R$), and VIP Museum Wing (399 R$) [09 Shops and Monetisation].

## 11. Live-ops hooks
Weekly Saturday 14:00 UTC fossil drop and bi-weekly Meteor Shower limited event doubling Amber fossil weights [12 Live Ops and Launch].

## 12. Test plan & milestone list
Eight standard studio milestones from Concept locked through First publish, gated by 108 Tester Passes A & B on 844×390 and 800×360 viewports plus Playtest 2-player trade verification.`;

export const SEED_ARTIFACTS_BY_RUN: Readonly<Record<string, readonly SeedArtifactSpec[]>> = {
  [SEED_IDS.runs.r02]: [
    {
      path: 'UI/Anime Awakening RNG/Raid Menu.md',
      language: 'markdown',
      content: FRAME_RAID_MENU_MD,
    },
  ],
  [SEED_IDS.runs.r03]: [
    {
      path: 'Balance/Anime Awakening RNG/raid_loot.json',
      language: 'json',
      content: BALANCE_RAID_LOOT_JSON,
    },
  ],
  [SEED_IDS.runs.r04]: [
    {
      path: 'ServerScriptService/Raid/HollowShogunPhase2.server.luau',
      language: 'luau',
      content: BUILDER_HOLLOW_SHOGUN_PHASE2_LUAU,
    },
  ],
  [SEED_IDS.runs.r12]: [
    {
      path: 'Blueprints/Dig Up a Dino/Dig Up a Dino Blueprint.md',
      language: 'markdown',
      content: ARCHITECT_DINO_BLUEPRINT_MD,
    },
  ],
};

export const R01_LEAD_LOGS: readonly SeedLogEntrySpec[] = [
  {
    kind: 'TEXT',
    content: `**Goal:** ship the Hollow Shogun raid boss update for Anime Awakening RNG in v1470, playable by 4-player parties on PC and mobile.

I'm splitting this into four tracks. Loot odds come first because phase 2 rewards depend on them.`,
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      agentKey: 'frame',
      title: 'Raid menu HUD — Hollow Shogun raid',
      priority: 'HIGH',
      gameId: SEED_IDS.games.aar,
    }),
    meta: {
      tool: 'delegate_task',
      toolCallId: 'call_r01_1',
      args: {
        agentKey: 'frame',
        title: 'Raid menu HUD — Hollow Shogun raid',
        priority: 'HIGH',
        gameId: SEED_IDS.games.aar,
      },
    },
  },
  {
    kind: 'HANDOFF',
    content: 'Delegated "Raid menu HUD — Hollow Shogun raid" to Frame',
    meta: { handoffTaskId: SEED_IDS.tasks.t02, handoffAgentKey: 'frame' },
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      agentKey: 'balance',
      title: 'Raid loot odds & Awakening Shard drops',
      priority: 'HIGH',
      gameId: SEED_IDS.games.aar,
    }),
    meta: {
      tool: 'delegate_task',
      toolCallId: 'call_r01_2',
      args: {
        agentKey: 'balance',
        title: 'Raid loot odds & Awakening Shard drops',
        priority: 'HIGH',
        gameId: SEED_IDS.games.aar,
      },
    },
  },
  {
    kind: 'HANDOFF',
    content: 'Delegated "Raid loot odds & Awakening Shard drops" to Balance',
    meta: { handoffTaskId: SEED_IDS.tasks.t03, handoffAgentKey: 'balance' },
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      agentKey: 'builder',
      title: 'Hollow Shogun phase 2 server logic',
      priority: 'HIGH',
      gameId: SEED_IDS.games.aar,
      dependsOnTaskIds: [SEED_IDS.tasks.t03],
    }),
    meta: {
      tool: 'delegate_task',
      toolCallId: 'call_r01_3',
      args: {
        agentKey: 'builder',
        title: 'Hollow Shogun phase 2 server logic',
        priority: 'HIGH',
        gameId: SEED_IDS.games.aar,
        dependsOnTaskIds: [SEED_IDS.tasks.t03],
      },
    },
  },
  {
    kind: 'HANDOFF',
    content: 'Delegated "Hollow Shogun phase 2 server logic" to Builder',
    meta: { handoffTaskId: SEED_IDS.tasks.t04, handoffAgentKey: 'builder' },
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      agentKey: 'producer',
      title: 'Flow check after phase 2',
      priority: 'NORMAL',
      gameId: SEED_IDS.games.aar,
      dependsOnTaskIds: [SEED_IDS.tasks.t04],
    }),
    meta: {
      tool: 'delegate_task',
      toolCallId: 'call_r01_4',
      args: {
        agentKey: 'producer',
        title: 'Flow check after phase 2',
        priority: 'NORMAL',
        gameId: SEED_IDS.games.aar,
        dependsOnTaskIds: [SEED_IDS.tasks.t04],
      },
    },
  },
  {
    kind: 'HANDOFF',
    content: 'Delegated "Flow check after phase 2" to Producer',
    meta: { handoffTaskId: SEED_IDS.tasks.t09, handoffAgentKey: 'producer' },
  },
  {
    kind: 'TEXT',
    content: `| # | Agent | Task | Depends on |
|---|-------|------|------------|
| 1 | Frame | Raid menu HUD — Hollow Shogun raid | – |
| 2 | Balance | Raid loot odds & Awakening Shard drops | – |
| 3 | Builder | Hollow Shogun phase 2 server logic | 2 |
| 4 | Producer | Flow check after phase 2 | 3 |

## Result
- 4 tasks delegated; Builder waits on Balance's drop table.
- Raid HUD must follow [05 UI and HUD] mobile safe zones (timer clear of the Roblox chat button).
- Target build: v1470.`,
  },
  {
    kind: 'USAGE',
    content: 'Input: 6,812 tokens · Output: 1,204 tokens',
    meta: { usage: { inputTokens: 6812, outputTokens: 1204 } },
  },
];

export const R02_FRAME_LOGS: readonly SeedLogEntrySpec[] = [
  {
    kind: 'TEXT',
    content: `${FRAME_RAID_MENU_MD}

## Result
- Saved PC 1920×1080 and mobile 844×390 Raid Menu wireframes to \`UI/Anime Awakening RNG/Raid Menu.md\`.
- Moved raid timer to top-center to stay out of the x 0–160, y 0–58 Roblox top-left keep-out zone [05 UI and HUD].`,
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      path: 'UI/Anime Awakening RNG/Raid Menu.md',
      language: 'markdown',
    }),
    meta: {
      tool: 'save_artifact',
      toolCallId: 'call_r02_1',
      args: { path: 'UI/Anime Awakening RNG/Raid Menu.md', language: 'markdown' },
    },
  },
  {
    kind: 'TOOL_RESULT',
    content: JSON.stringify({ ok: true, path: 'UI/Anime Awakening RNG/Raid Menu.md' }, null, 2),
    meta: { tool: 'save_artifact', toolCallId: 'call_r02_1', ok: true, durationMs: 18 },
  },
  {
    kind: 'USAGE',
    content: 'Input: 5,420 tokens · Output: 1,480 tokens',
    meta: { usage: { inputTokens: 5420, outputTokens: 1480 } },
  },
];

export const R04_BUILDER_LOGS: readonly SeedLogEntrySpec[] = [
  {
    kind: 'TEXT',
    content: `Balance's drop table is in (t03). Implementing phase 2 server-side: the boss enrages at 50% HP, adds a rotating blade ring and summons two Shadow Ronin.

\`\`\`luau
${BUILDER_HOLLOW_SHOGUN_PHASE2_LUAU}
\`\`\``,
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({ reason: 'Phase 2 arena test placement' }),
    meta: {
      tool: 'acquire_studio_lane',
      toolCallId: 'call_r04_1',
      args: { reason: 'Phase 2 arena test placement' },
    },
  },
  {
    kind: 'TOOL_RESULT',
    content: JSON.stringify(
      {
        ok: false,
        error: 'LANE_BUSY',
        message: 'All Studio lanes are busy (Lane A: Playtest)',
      },
      null,
      2,
    ),
    meta: {
      tool: 'acquire_studio_lane',
      toolCallId: 'call_r04_1',
      ok: false,
      errorCode: 'LANE_BUSY',
      durationMs: 14,
    },
  },
  {
    kind: 'TEXT',
    content:
      "Lane A is busy with Playtest, so I'm finishing the blade-ring hit detection first and will request a lane after.",
  },
];

export const R05_PLAYTEST_LOGS: readonly SeedLogEntrySpec[] = [
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({ reason: '4-client party reroll test on v1467' }),
    meta: {
      tool: 'acquire_studio_lane',
      toolCallId: 'call_r05_1',
      args: { reason: '4-client party reroll test on v1467' },
    },
  },
  {
    kind: 'TOOL_RESULT',
    content: JSON.stringify({ ok: true, laneName: 'Studio Lane A' }, null, 2),
    meta: {
      tool: 'acquire_studio_lane',
      toolCallId: 'call_r05_1',
      ok: true,
      durationMs: 11,
    },
  },
  {
    kind: 'TEXT',
    content: `| Clients | Network | Step | Expected | Observed |
|---|---|---|---|---|
| 4 | none | All 4 reroll at once | 4 unique results, 4 × −1 Reroll Token | ✅ |
| 4 | 200 ms | Spam reroll 10×/s | Server rate-limit at 4/s, toast "Slow down" | ✅ |
| 4 | 200 ms | Leave mid-reroll | Token refunded or result saved | ⏳ testing… |`,
  },
];

export const R07_REVIEWER_LOGS: readonly SeedLogEntrySpec[] = [
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      severity: 'FIX_FIRST',
      title: 'Raid timer overlaps the Roblox chat button on 844×390',
      buildVersion: 1467,
    }),
    meta: {
      tool: 'flag_blocker',
      toolCallId: 'call_r07_1',
      args: {
        severity: 'FIX_FIRST',
        title: 'Raid timer overlaps the Roblox chat button on 844×390',
        buildVersion: 1467,
      },
    },
  },
  {
    kind: 'TOOL_RESULT',
    content: JSON.stringify({ ok: true, blockerId: SEED_IDS.blockers.b1 }, null, 2),
    meta: { tool: 'flag_blocker', toolCallId: 'call_r07_1', ok: true, durationMs: 12 },
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      severity: 'SHOULD_FIX',
      title: 'Reroll result toast hides the currency counter for 2.5 s',
      buildVersion: 1467,
    }),
    meta: {
      tool: 'flag_blocker',
      toolCallId: 'call_r07_2',
      args: {
        severity: 'SHOULD_FIX',
        title: 'Reroll result toast hides the currency counter for 2.5 s',
        buildVersion: 1467,
      },
    },
  },
  {
    kind: 'TOOL_RESULT',
    content: JSON.stringify({ ok: true, blockerId: SEED_IDS.blockers.b2 }, null, 2),
    meta: { tool: 'flag_blocker', toolCallId: 'call_r07_2', ok: true, durationMs: 10 },
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      severity: 'NIT',
      title: 'Inconsistent capitalisation on the Awakening Index tabs',
      buildVersion: 1467,
    }),
    meta: {
      tool: 'flag_blocker',
      toolCallId: 'call_r07_3',
      args: {
        severity: 'NIT',
        title: 'Inconsistent capitalisation on the Awakening Index tabs',
        buildVersion: 1467,
      },
    },
  },
  {
    kind: 'TOOL_RESULT',
    content: JSON.stringify({ ok: true, blockerId: SEED_IDS.blockers.b3 }, null, 2),
    meta: { tool: 'flag_blocker', toolCallId: 'call_r07_3', ok: true, durationMs: 9 },
  },
  {
    kind: 'TOOL_CALL',
    content: JSON.stringify({
      kind: 'PUBLISH',
      title: 'Publish v1467 — Hollow Shogun phase 1',
      buildVersion: 1467,
    }),
    meta: {
      tool: 'submit_for_review',
      toolCallId: 'call_r07_4',
      args: {
        kind: 'PUBLISH',
        title: 'Publish v1467 — Hollow Shogun phase 1',
        buildVersion: 1467,
      },
    },
  },
  {
    kind: 'TOOL_RESULT',
    content: JSON.stringify({ ok: true, reviewItemId: SEED_IDS.reviewItems.ri09 }, null, 2),
    meta: { tool: 'submit_for_review', toolCallId: 'call_r07_4', ok: true, durationMs: 15 },
  },
  {
    kind: 'TEXT',
    content: `Pre-publish QA completed for **Anime Awakening RNG v1467**.

## Result
- Flagged 1 \`FIX_FIRST\` blocker (raid timer overlaps CoreGui chat button on 844×390 [05 UI and HUD]), 1 \`SHOULD_FIX\`, and 1 \`NIT\`.
- Submitted \`Publish v1467 — Hollow Shogun phase 1\` to the review queue; publish approval is gated until B1 is resolved.`,
  },
  {
    kind: 'USAGE',
    content: 'Input: 7,140 tokens · Output: 1,120 tokens',
    meta: { usage: { inputTokens: 7140, outputTokens: 1120 } },
  },
];
