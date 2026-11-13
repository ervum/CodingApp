# Section 6 — Rich Seed Data Specification (`backend/prisma/seed.ts`)

## 6.1 Orchestration & Determinism
```ts
// prisma/seed.ts
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
// …imports of every seed module…
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
async function main(): Promise<void> {
  const now = new Date();                      // single reference time; all seed timestamps are offsets from it
  const rng = mulberry32(20261022);            // deterministic noise
  await wipe(prisma);                          // deleteMany in reverse-dependency order (seed is re-runnable)
  const users = await seedUsers(prisma);
  const studio = await seedStudios(prisma, users);          // + calls StudioProvisioning (agents, lanes, vault)
  await seedLlmConnections(prisma, studio);                // optional, env-driven
  const games = await seedGames(prisma, studio, now);
  const media = await seedMedia(prisma, studio, games, rng);  // sharp-rendered PNGs
  const pitches = await seedPitches(prisma, studio, now);
  const tasks = await seedTasksRunsLogs(prisma, studio, games, now);
  await seedHumanRequests(prisma, studio, games, tasks, pitches, now);
  await seedReview(prisma, studio, games, tasks, media, users, now);
  await seedMarket(prisma, now, rng);
  await finalizeAgentStatuses(prisma, studio);             // applies deriveAgentStatus() — same pure rules as AgentStatusService
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
```
- `StudioProvisioningService` logic lives in a framework-free function, `provisionStudio(prisma, studioId, opts)`, in `src/modules/studios/provision-studio.ts`. The Nest service and the seed both call it.
- `deriveAgentStatus()` is a pure function in `src/modules/agents/agent-status.rules.ts`, shared by `AgentStatusService` and the seed.
- **Time offsets** below are written as `T-15m` = `now − 15 minutes`.

## 6.2 Users & Studios
| Entity | Values |
|---|---|
| User (OWNER) | email `SEED_OPERATOR_EMAIL` (default `operator@robdev.local`), password `SEED_OPERATOR_PASSWORD` (default `robdev-dev-2026!`), displayName `Ervum`, avatarColor `#7C3AED` |
| User (PRODUCER) | `producer@robdev.local` / same password, displayName `Maya`, avatarColor `#14B8A6` |
| Studio 1 | slug `inclined-games`, name `Inclined Games studio`, workspaceLabel `robdev`, `isPaused=false`. Members: Ervum OWNER, Maya PRODUCER |
| Studio 2 | slug `sandbox`, name `Sandbox studio`, workspaceLabel `robdev`, member Ervum OWNER (provisioned; no games) — shows that the switcher works |
| Lanes (each studio) | `Studio Lane A` (sortOrder 1), `Studio Lane B` (sortOrder 2) |

**LLM connections (`llm.seed.ts`)** are created only for env keys that are present:

| Env var | provider | label |
|---|---|---|
| `OPENAI_API_KEY` | OPENAI | `OpenAI` |
| `ANTHROPIC_API_KEY` | ANTHROPIC | `Anthropic` |
| `GEMINI_API_KEY` | GOOGLE | `Google Gemini` |
| `XAI_API_KEY` | XAI | `xAI Grok` |
| `OLLAMA_BASE_URL` | OLLAMA (baseUrl = value) | `Ollama (local)` |

When `SEED_LLM_CONNECTION` matches one of the created labels and `SEED_LLM_MODEL` is non-empty, all 15 agents of studio 1 are bound to it (`temperature 0.4`, `maxOutputTokens 4096`).

## 6.3 The 15 Agents (`agents.seed.ts` + `agent-personas.ts`)
Name, title, color, glyph, order and tools come from `AGENT_ROSTER` (§2.3). `description` = `title`. `systemPrompt` = the exact text below, stored as `AGENT_PERSONAS: Record<AgentKey, string>`.

````text
[lead]
You are Lead, the studio's orchestrator. You turn every human request into a plan of concrete, verifiable tasks and delegate each one with delegate_task. You never write production code, art or numbers yourself.
Method: (1) Restate the goal in one sentence. (2) Split the work into 2–8 tasks; every brief states the deliverable, the acceptance criteria and the vault docs that apply. (3) Sequence with dependsOnTaskIds: Architect before Builder/Frame/Scenic; Balance before Merchant; Builder before Playtest; feature-final before Splash; everything before Reviewer. (4) Routing: market & pitches→pulse, design blueprint→architect, Luau systems→builder, UI/HUD→frame, maps & lighting→scenic, curves & odds→balance, asset library→librarian, icons/thumbnails/trailers→splash, milestones & flow checks→producer, events & cadence→liveops, gamepasses & shop→merchant, multiplayer tests→playtest, mobile viewport tests→tester108, pre-publish QA→reviewer. (5) If ambiguity would change the plan, call request_human before delegating.
Finish with a table: # · Agent · Task · Depends on, then the Result section.

[pulse]
You are Pulse, the studio's market analyst. You read live Roblox chart data with market_query and turn it into data-backed game pitches with create_pitch.
Rules: every metric you cite must come from a market_query result in this run, quoted exactly (rank, CCU, like ratio, 7-day delta). Look for momentum (positive 7-day delta in up-and-coming), saturation (many near-identical titles in top-earning) and gaps (high like ratio, low competitor count). A pitch must explain WHAT CHANGED in the market this week and HOW WE'RE DIFFERENT in one sentence each. Fill all six sections: First 60 seconds, 5-minute loop, Minutes 10-30, Monetization, Competitors, Risks. Propose at most 2 pitches per run, then stop; the human picks.

[architect]
You are Architect. Before any code is written, you produce the 12-step technical and game-design blueprint for a game or feature and save it with save_artifact as "Blueprints/<Game>/<Feature> Blueprint.md".
The 12 steps, in order: 1 Player fantasy & pillars · 2 First five minutes · 3 Core loop diagram (ascii) · 4 Progression & economy hooks · 5 Rarity/RNG model · 6 UI & HUD screen list · 7 World zones · 8 Data model (DataStore keys, profile schema) · 9 Server/client architecture (services, remotes, trust boundaries) · 10 Monetisation surfaces · 11 Live-ops hooks · 12 Test plan & milestone list.
Use update_milestone to create the milestones from step 12. Respect [13 Building It Right] for architecture and [05 UI and HUD] for screens. Be specific enough that Builder, Frame, Scenic and Balance can work in parallel without asking you questions.

[builder]
You are Builder, the studio's senior Luau engineer. You write production Roblox code: server and client scripts, combat, boss fights, data persistence and the Workspace/ServerScriptService hierarchy.
Non-negotiables from [13 Building It Right]: --!strict on every script; the server is authoritative (never trust client damage, currency or cooldowns); RemoteEvents are validated with type checks and rate limits; modules over monoliths; no deprecated APIs (use task.wait/task.spawn, never wait/spawn); no busy loops; clean up connections with Maid-style tables; DataStore calls are wrapped in pcall with retries and session locking.
Acquire a Studio lane before declaring the work playtest-ready and release it when done. Save every script with save_artifact using its Roblox path, e.g. "ServerScriptService/Raid/HollowShogun.server.luau". Record a SAVED build with record_build when a playable increment is complete.

[frame]
You are Frame, the studio's UI/HUD designer. You design 2D Roblox interfaces (HUD, Raid menus, Index grids, Shops, popups) as precise ASCII wireframes plus a component spec.
Every screen ships with: an ascii wireframe for PC 1920×1080 AND Mobile landscape 844×390 (notched) and 800×360 (short); safe-zone offsets that avoid the Roblox top-left controls (top 58 px inset) and the thumbstick/jump zones; the semantic colour of every button from the [05 UI and HUD] colour table (Green 68,214,72 confirm/buy, Red 235,82,82 close, Gold 255,206,68 premium); minimum tap target 44×44 px; UIScale/UIAspectRatioConstraint notes; and the genre convention you followed. Save each screen as "UI/<Game>/<Screen>.md" with save_artifact.

[scenic]
You are Scenic, the environment artist. You plan and build 3D map zones and lighting: zone layout, landmarks, paths, spawn and portal placement, Lighting/Atmosphere/ColorCorrection settings and performance budgets.
Follow [06 World and Look]: every zone has one silhouette landmark visible from spawn, readable paths, and a colour-script entry. Keep part count and StreamingEnabled budgets from [08 Mobile]. Output a zone sheet (ascii top-down map, landmark list, lighting property table with exact values) and save it with save_artifact. Acquire a Studio lane before placing geometry and release it when done.

[balance]
You are Balance, the economy and progression designer. You compute progression curves, rarity odds, drop tables, pity systems and zone economy math.
Show your maths: formulas, a table of the first 20 levels/zones, expected time-to-milestone for a median player (25-minute sessions) and for a top-10% player, and the expected value of every currency sink. Rarity odds must sum to exactly 100% and follow [03 Rarity and RNG] (displayed odds, pity, luck boosts multiplicative and capped). Save tables as CSV or JSON with save_artifact so Builder can paste them into ModuleScripts.

[librarian]
You are Librarian, the curator of the studio asset library. You catalogue meshes, audio, decals and animations: naming, tags, licence/source notes, and where each asset is used.
Naming convention: <Game>_<Category>_<Name>_<Variant> (e.g. AAR_VFX_AwakenBurst_Purple). You maintain the [Our assets] vault document with vault_update_document; always keep its index table sorted by category, then name. Flag duplicates and unlicensed items. You never invent asset IDs; unknown IDs are written as "pending upload".

[splash]
You are Splash, the studio's marketing artist. You make game icons (1:1, 512×512), store thumbnails (16:9, 1920×1080) and trailer storyboards.
Follow [11 Thumbnails, Icons and the Store Page]: one focal subject, a face or creature with clear emotion, at most three words of text on thumbnails and none on icons, high-contrast rim light, and it must read at 64 px. Write a detailed image prompt (subject, pose, camera, lighting, palette, background, style "high-quality Roblox 3D render"), call generate_image, then submit_for_review with a description explaining the concept and how it reads small. For trailers, produce a 6–8 shot storyboard (shot, duration, camera, on-screen text, audio cue) with one keyframe image per key beat.

[producer]
You are Producer. You own end-to-end flow checks and milestone verification across all games.
For each game you check the full player journey (join → first five minutes → core loop → first purchase prompt → return hook) against the latest build and the milestones. You update milestone status with update_milestone, delegate fixes to the responsible agent with delegate_task, and when a human must try something in Roblox Studio, create a TRY_IT request (request_human with kind TRY_IT and the build version) with exact steps: what to click, what should happen, what to report. Submit STAGE review items when a milestone is complete.

[liveops]
You are Liveops. You design the live calendar: rotating events, update cadence, notifications and retention loops.
Follow [12 Live Ops and Launch] and [10 Retention and Social]: weekly update on the same weekday and hour, a 2-week event rhythm, daily rewards with a 7-day streak, limited-time banners announced 48 h ahead. Deliver a calendar table (date, event, mechanic, reward, notification copy ≤ 60 chars) and the config JSON Builder needs, saved with save_artifact.

[merchant]
You are Merchant, the monetisation designer. You design gamepasses, developer products and shop ladders.
Follow [09 Shops and Monetisation]: a clear price ladder (e.g. 49 / 99 / 199 / 399 / 799 Robux), no pay-to-win in PvP, first-purchase offer in minutes 10–30, every product's value explained in one line, and starter pack ≤ 99 Robux. Use market_query to sanity-check comparable games. Deliver a table (product, type, price, what it does, expected attach rate, placement) and save it. Pricing changes above 399 Robux need a human decision: call request_human with kind DECISION and options.

[playtest]
You are Playtest. You plan and run multi-client server and party tests for Roblox Studio lanes.
Always acquire a Studio lane first. Write a test matrix: clients (2/4/8), roles, network simulation (none / 200 ms), steps, expected result, observed result. Focus on replication bugs, race conditions in remotes, party join/leave mid-raid, data saving on leave, and exploit attempts (spamming remotes, teleport spoofing). Report each failure with flag_blocker (FIX_FIRST if it breaks progression, purchases or data). Release the lane when finished.

[tester108]
You are 108 Tester, the mobile viewport specialist. You run every build through two passes (A on save, B before publish) across the viewport matrix in [08 Mobile]: 844×390 notched landscape, 800×360 short landscape, 1334×750, 2532×1170, 1024×768 tablet and 1920×1080 PC.
Check: nothing under the Roblox top-left controls or behind the notch, no overlap with thumbstick or jump zones, tap targets ≥ 44 px, text ≥ 14 px at 800×360, scrolling frames reachable with a thumb, no clipped currency numbers at 9,999,999. Report a table per viewport (pass/fail per check) and flag_blocker for every failure (FIX_FIRST when a button is unreachable or hidden).

[reviewer]
You are Reviewer, the final pre-publish QA gate. You verify a build against every relevant vault rule before a human sees it.
Checklist: [05 UI and HUD] safe zones and colour semantics, [08 Mobile] passes A and B, [09 Shops and Monetisation] honesty rules, [11 Thumbnails, Icons and the Store Page] for store assets, [13 Building It Right] for server authority, plus open blockers from Playtest and 108 Tester. Flag each problem with flag_blocker; anything that would hurt players, purchases, data or store policy is FIX_FIRST. Finish by calling submit_for_review with kind PUBLISH, the build version and the full checklist.
````

**Vault bindings (`AgentVaultBinding`, priority in parentheses).** `00 For Any AI` is always injected and is not listed. Paths use the folder-note convention.

| Agent | Bound documents |
|---|---|
| lead | 00 Start Here (1), 13 Building It Right (5), Skills (6) |
| pulse | 11 Thumbnails, Icons and the Store Page (3), 01 The First Five Minutes (4), 02 The Core Loop (4), 12 Live Ops and Launch (6) |
| architect | 02 The Core Loop (1), 01 The First Five Minutes (2), 03 Rarity and RNG (3), 04 Progression and Economy (3), 13 Building It Right (4) |
| builder | 13 Building It Right (1), 02 The Core Loop (4), 07 Characters, VFX and Assets (6) |
| frame | 05 UI and HUD (1), 08 Mobile (2), Claude Design prompts (5) |
| scenic | 06 World and Look (1), 07 Characters, VFX and Assets (3), 08 Mobile (4) |
| balance | 03 Rarity and RNG (1), 04 Progression and Economy (1) |
| librarian | Our assets (1), 07 Characters, VFX and Assets (3) |
| splash | 11 Thumbnails, Icons and the Store Page (1), 06 World and Look (4) |
| producer | 00 Start Here (1), 13 Building It Right (3), 12 Live Ops and Launch (4) |
| liveops | 12 Live Ops and Launch (1), 10 Retention and Social (1) |
| merchant | 09 Shops and Monetisation (1), 04 Progression and Economy (3) |
| playtest | 13 Building It Right (2), 02 The Core Loop (4), 01 The First Five Minutes (5) |
| tester108 | 08 Mobile (1), 05 UI and HUD (2) |
| reviewer | 05 UI and HUD (1), 08 Mobile (2), 09 Shops and Monetisation (3), 11 Thumbnails, Icons and the Store Page (3), 13 Building It Right (4) |

## 6.4 Games, Milestones, Builds, Lanes (`games.seed.ts`)

| Field | Anime Awakening RNG | Dig Up a Dino |
|---|---|---|
| slug | `anime-awakening-rng` | `dig-up-a-dino` |
| genre | `RNG · Anime` | `Simulator · Digging` |
| status | `LIVE` | `BUILDING` |
| accentColor | `#A855F7` | `#F59E0B` |
| description | Roll for anime-inspired Awakenings, from Common to the 1-in-10M Secret "Void Emperor". Fight raid bosses with friends, fill the Awakening Index and climb the weekly leaderboard. | Dig through layered dig sites with upgradeable tools, uncover fossils of 40+ dinosaurs, assemble skeletons in your museum and trade rare specimens. |
| robloxUniverseId / PlaceId | `null` / `null` (the user sets real IDs in Game detail) | `null` / `null` |
| latestPublishedVersion | `404` | `null` |
| latestSavedVersion | `1467` | `213` |
| iconMediaId | media `icon-aar-v3` | media `icon-dino-v1` |

**Default milestone template** (used here and by Pitch → Pick): `concept` Concept locked · `blueprint` 12-step blueprint · `core-loop` Core loop playable · `ui-hud` UI & HUD pass · `world` World & lighting pass · `economy` Economy & monetisation · `qa-mobile` QA & mobile passes · `publish` First publish (sortOrder 1–8).

- **Anime Awakening RNG:** the 8 template milestones are all `DONE` (completedAt spread T-120d … T-35d). Plus `raid-boss-update` "Hollow Shogun raid update" (9, `IN_PROGRESS`) and `awakening-index-2` "Awakening Index 2.0" (10, `TODO`). That gives **8/10 = 80%** with currentStage "Hollow Shogun raid update".
- **Dig Up a Dino:** concept/blueprint/core-loop/ui-hud are `DONE`, world is `IN_PROGRESS`, economy/qa-mobile/publish are `TODO`. That gives **4/8 = 50%** with currentStage "World & lighting pass".

**Builds**
| Game | version | kind | notes | by | mobile A | mobile B | createdAt |
|---|---|---|---|---|---|---|---|
| AAR | 401 | PUBLISHED | "Awakening Index + 3 new Legendaries" | producer | PASSED | PASSED | T-9d |
| AAR | 404 | PUBLISHED | "Hotfix: reroll button double-fire; leaderboard reset time" | producer | PASSED | PASSED | T-4d |
| AAR | 1460 | SAVED | "Raid lobby UI from Frame" | builder | PASSED | NOT_STARTED | T-2d |
| AAR | 1466 | SAVED | "Hollow Shogun phase 1 + arena" | builder | PASSED | NOT_STARTED | T-20h |
| AAR | 1467 | SAVED | "Phase 1 tuning, raid timer HUD" | builder | PASSED | NOT_STARTED | T-3h |
| Dino | 205 | SAVED | "Zone 2 Amber Canyon blockout" | builder | PASSED | NOT_STARTED | T-3d |
| Dino | 211 | SAVED | "Tool tiers 1–4, fossil drop table v2" | builder | PASSED | NOT_STARTED | T-1d |
| Dino | 213 | SAVED | "Mobile dig button + museum placement" | builder | PASSED | NOT_STARTED | T-5h |

**Lanes:** `Studio Lane A` is held by `playtest` for AAR (`heldByRunId` = run R5, `heldSince` T-12m). `Studio Lane B` is free.

## 6.5 Tasks, Runs & Logs (`tasks.seed.ts`, `seed-logs.ts`)

Stable IDs: tasks `seed_t01`…`seed_t14`, runs `seed_r01`…, so log content can cross-reference them. Provider/model on seeded runs = the bound connection/model if `SEED_LLM_*` is set, otherwise provider `ANTHROPIC` and modelId `"seed-history"` (historical record only; never executed).

| ID | Agent | Game | Title | Status | Parent / deps | Origin | Times | Run |
|---|---|---|---|---|---|---|---|---|
| t01 | lead | AAR | Plan: Hollow Shogun raid boss update | DONE | – | USER (Ervum) | queued T-26h, done T-25h50m | r01 SUCCEEDED |
| t02 | frame | AAR | Raid menu HUD — Hollow Shogun raid | DONE | parent t01 | LEAD_DELEGATION | done T-22h | r02 SUCCEEDED |
| t03 | balance | AAR | Raid loot odds & Awakening Shard drops | DONE | parent t01 | LEAD_DELEGATION | done T-23h | r03 SUCCEEDED |
| t04 | builder | AAR | Hollow Shogun phase 2 server logic | RUNNING | parent t01, deps t03 | LEAD_DELEGATION | started T-18m | r04 RUNNING |
| t05 | playtest | AAR | 4-client party test: Awakening rerolls on v1467 | RUNNING | – | AGENT_DELEGATION (producer) | started T-12m | r05 RUNNING |
| t06 | splash | AAR | App icon v3 — Shogun Awakening | DONE | – | REVIEW_FEEDBACK | done T-2h | r06 SUCCEEDED |
| t07 | reviewer | AAR | Pre-publish QA — v1467 | DONE | – | SYSTEM | done T-1h | r07 SUCCEEDED |
| t08 | pulse | – | Weekly market scan → 2 pitches | NEEDS_HUMAN | – | SYSTEM | run T-6h | r08 AWAITING_HUMAN |
| t09 | producer | AAR | Verify Hollow Shogun phase 1 flow on v1467 | NEEDS_HUMAN | – | SYSTEM | run T-2h30m | r09 AWAITING_HUMAN |
| t10 | producer | Dino | Verify excavation tool tiers on mobile (v213) | NEEDS_HUMAN | – | SYSTEM | run T-4h | r10 AWAITING_HUMAN |
| t11 | merchant | AAR | Gamepass ladder — Anime Awakening RNG | NEEDS_HUMAN | – | USER (Maya) | run T-5h | r11 AWAITING_HUMAN |
| t12 | architect | Dino | 12-step blueprint: Dig Up a Dino | DONE | – | USER (Ervum) | done T-30d | r12 SUCCEEDED |
| t13 | splash | Dino | Store thumbnails — Dig Up a Dino | DONE | – | USER (Maya) | done T-1d | r13 SUCCEEDED |
| t14 | tester108 | AAR | Mobile pass A · v1467 | DONE | – | SYSTEM (`metadata={buildVersion:1467,pass:'A'}`) | done T-2h40m | r14 SUCCEEDED |

The resulting snapshot: **needsYou = 4**, **working = 2** (builder, playtest; only while bound, since boot recovery re-queues them), **queued = 0**.

**Exact log content for the showcase runs** (`seed-logs.ts`). Every other run gets 3 entries: CONTEXT (its bound docs), a TEXT summary of 2–4 sentences that matches its title and a `## Result` list, and USAGE.

**r01 — Lead** (seq order)
1. `CONTEXT` "Loaded 4 vault documents". Meta docs: 00 For Any AI v3, 00 Start Here v2, 13 Building It Right v4, Skills v1.
2. `TEXT`:
```markdown
**Goal:** ship the Hollow Shogun raid boss update for Anime Awakening RNG in v1470, playable by 4-player parties on PC and mobile.

I'm splitting this into four tracks. Loot odds come first because phase 2 rewards depend on them.
```
3. `TOOL_CALL` delegate_task → `{ agentKey: 'frame', title: 'Raid menu HUD — Hollow Shogun raid', priority: 'HIGH' … }`; `HANDOFF` → t02.
4. `TOOL_CALL` delegate_task → balance (t03); `HANDOFF`.
5. `TOOL_CALL` delegate_task → builder, `dependsOnTaskIds: ['seed_t03']` (t04); `HANDOFF`.
6. `TOOL_CALL` delegate_task → producer: "Flow check after phase 2" (recorded as part of t09's lineage); `HANDOFF`.
7. `TEXT`:
```markdown
| # | Agent | Task | Depends on |
|---|-------|------|------------|
| 1 | Frame | Raid menu HUD — Hollow Shogun raid | – |
| 2 | Balance | Raid loot odds & Awakening Shard drops | – |
| 3 | Builder | Hollow Shogun phase 2 server logic | 2 |
| 4 | Producer | Flow check after phase 2 | 3 |

## Result
- 4 tasks delegated; Builder waits on Balance's drop table.
- Raid HUD must follow [05 UI and HUD] mobile safe zones (timer clear of the Roblox chat button).
- Target build: v1470.
```
8. `USAGE` (in 6,812 / out 1,204).

**r02 — Frame** `TEXT` (the essential content; also saved as artifact `UI/Anime Awakening RNG/Raid Menu.md`):
````markdown
### Raid menu — PC 1920×1080
```ascii
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
```
### Raid menu — Mobile landscape 844×390 (notched)
```ascii
┌─notch─┬────────────────────────────────────────────────────────────┐
│ 47px  │ [≡][💬]            ⏱ 04:32                         [ ✕ ]   │
│ safe  │  ┌──── HOLLOW SHOGUN ─────┐  ┌─ PARTY 2/4 ─┐                │
│ inset │  │ [Nrm][Hrd][▣Ntm]       │  │ ● Ervum ★   │                │
│       │  │ Shard ×3 · 2% Mythic   │  │ ● Maya      │                │
│       │  │ [   START RAID   ] 52px│  │ [ INVITE ]  │                │
│       │  └────────────────────────┘  └─────────────┘                │
│       │ (thumbstick zone — empty)                    (jump — empty) │
└───────┴────────────────────────────────────────────────────────────┘
```
- Timer moved from top-left to top-center: it overlapped the Roblox chat button at 844×390.
- START RAID is 52 px tall on mobile (≥ 44 px), Green (68, 214, 72). Close is Red (235, 82, 82), top-right, 44×44.
````

**r04 — Builder (RUNNING; partial)** entries:
1. `CONTEXT`: docs 00 For Any AI, 13 Building It Right, 02 The Core Loop, 07 Characters, VFX and Assets.
2. `TEXT` (open):
````markdown
Balance's drop table is in (t03). Implementing phase 2 server-side: the boss enrages at 50% HP, adds a rotating blade ring and summons two Shadow Ronin.

```luau
--!strict
-- ServerScriptService/Raid/HollowShogunPhase2.server.luau
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")

local RaidConfig = require(ReplicatedStorage.Shared.RaidConfig)
local DamageService = require(script.Parent.DamageService)

local Phase2 = {}
Phase2.__index = Phase2

export type Phase2 = typeof(setmetatable({} :: {
	boss: Model,
	arena: Model,
	ringAngle: number,
	connections: { RBXScriptConnection },
	alive: boolean,
}, Phase2))

local RING_SPEED = math.rad(RaidConfig.HollowShogun.Phase2.RingDegreesPerSecond) -- 72°/s
local RING_DAMAGE = RaidConfig.HollowShogun.Phase2.RingDamage -- 18% max HP, server-validated

function Phase2.new(boss: Model, arena: Model): Phase2
	local self = setmetatable({
		boss = boss,
		arena = arena,
		ringAngle = 0,
		connections = {},
		alive = true,
	}, Phase2)
	return self
end

function Phase2:Start()
	local humanoid = self.boss:FindFirstChildOfClass("Humanoid") :: Humanoid
	humanoid.WalkSpeed *= RaidConfig.HollowShogun.Phase2.EnrageSpeedMultiplier
	for _ = 1, 2 do
		task.spawn(DamageService.SpawnMinion, self.arena, "ShadowRonin")
	end
	table.insert(self.connections, game:GetService("RunService").Heartbeat:Connect(function(dt: number)
		self:_stepRing(dt)
	end))
end
```
````
3. `TOOL_CALL` acquire_studio_lane `{ reason: 'Phase 2 arena test placement' }` → `TOOL_RESULT` `{ ok: false, error: 'LANE_BUSY', message: 'All Studio lanes are busy (Lane A: Playtest)' }`.
4. `TEXT` (open, streaming at seed time): "Lane A is busy with Playtest, so I'm finishing the blade-ring hit detection first and will request a lane after." The entry stays open; it has no `## Result` yet.

**r05 — Playtest (RUNNING)** entries: CONTEXT, then `TOOL_CALL` acquire_studio_lane → `TOOL_RESULT` `{ ok: true, laneName: 'Studio Lane A' }`, then `TEXT`:
```markdown
| Clients | Network | Step | Expected | Observed |
|---|---|---|---|---|
| 4 | none | All 4 reroll at once | 4 unique results, 4 × −1 Reroll Token | ✅ |
| 4 | 200 ms | Spam reroll 10×/s | Server rate-limit at 4/s, toast "Slow down" | ✅ |
| 4 | 200 ms | Leave mid-reroll | Token refunded or result saved | ⏳ testing… |
```

**r07 — Reviewer** creates blockers B1–B3 (§6.7) and the PUBLISH review item via logged `TOOL_CALL`s.

**Artifacts:** r01: none. r02: `UI/Anime Awakening RNG/Raid Menu.md` (the Frame content above). r03: `Balance/Anime Awakening RNG/raid_loot.json` (exact JSON below). r04: `ServerScriptService/Raid/HollowShogunPhase2.server.luau` (the Luau above). r12: `Blueprints/Dig Up a Dino/Dig Up a Dino Blueprint.md` (a 12-step outline, one paragraph per step, matching the Architect persona format).
```json
{ "boss": "HollowShogun", "rollsPerClear": 3,
  "table": [
    { "item": "Awakening Shard", "rarity": "Rare", "weight": 6200 },
    { "item": "Shogun Katana Skin", "rarity": "Epic", "weight": 2600 },
    { "item": "Hollow Aura", "rarity": "Legendary", "weight": 1000 },
    { "item": "Mythic Oni Mask", "rarity": "Mythic", "weight": 199 },
    { "item": "Void Emperor Fragment", "rarity": "Secret", "weight": 1 } ],
  "totalWeight": 10000, "pity": { "item": "Mythic Oni Mask", "guaranteedAtClears": 60 } }
```

**Agent messages:** for t01 there is a USER message from Ervum: "Plan the Hollow Shogun raid boss update — 4-player party raid, two phases, ship in v1470." For t11 the AGENT message is the DECISION body. For t09/t10 the AGENT messages carry the TRY_IT bodies.

## 6.6 Human Requests ("Needs you") — exactly 4 OPEN

| # | kind | agent / task | game | title | body (Markdown) | options / extras |
|---|---|---|---|---|---|---|
| HR1 | PICK_NEXT_GAME | pulse / t08 | – | Pick the next game | "I scanned this week's charts and wrote two pitches. **What If The Sky Falls** rides the disaster-survival bump (+38% 7-day CCU on the top comparable). **Bake a Cake Shop** targets the cosy tycoon gap with a 91% like ratio. Open a pitch to compare, then pick one." | `pitchIds` = [P1, P2]; created T-6h |
| HR2 | TRY_IT | producer / t09 | AAR | Try the Hollow Shogun phase 1 fight (v1467) | "1. Open **Studio Lane B** with place version **1467**.\n2. Start a 2-player local server (Test → Clients and Servers → 2).\n3. Join the raid from the lobby portal, choose **Normal**.\n4. Get the boss to 50% HP.\n\n**Expected:** the boss stops at 50% and plays the enrage animation; phase 2 is not in this build yet.\n**Report:** did the HP bar and raid timer stay readable on the phone emulator (844×390)?" | `buildVersion` 1467; created T-2h30m |
| HR3 | TRY_IT | producer / t10 | Dino | Try the excavation tool tiers on mobile (v213) | "1. Open place version **213** with the device emulator set to **iPhone 14 (844×390)**.\n2. Dig in Zone 1 with the Rusty Shovel, buy the **Steel Pick** (250 coins) and dig again.\n\n**Expected:** dig speed goes from 1.0× to 1.6×, and the new **Dig** button sits above the jump button without overlapping it.\n**Report:** is the Dig button comfortable to hold with your right thumb?" | `buildVersion` 213; created T-4h |
| HR4 | DECISION | merchant / t11 | AAR | Approve the gamepass price ladder | "Proposed ladder for Anime Awakening RNG:\n\n| Product | Type | Price |\n|---|---|---|\n| Starter Awakening Pack | Dev product | 99 R$ |\n| 2× Luck | Gamepass | 199 R$ |\n| Auto-Roll | Gamepass | 249 R$ |\n| VIP (chat tag + 10% luck) | Gamepass | 399 R$ |\n| Mythic Bundle | Dev product | 799 R$ |\n\nComparables price 2× Luck between 149 and 299 R$. The Mythic Bundle is above 399 R$, so I need your call." | options: `approve` "Approve ladder", `lower` "Cap at 399 R$", `revise` "Revise with notes"; created T-5h |

## 6.7 Media, Review Items, Verdicts & Blockers (`media.seed.ts`, `svg-templates.ts`, `review.seed.ts`)

**Rendering:** `svgTemplates.icon({ title, accent, glyph, seed })` returns a 512×512 SVG:
- radial gradient background from `accent` to `#0B0C10`
- 18 sparkle circles (r 2–6, PRNG positions, white at 0.15–0.6 opacity)
- a central 8-point star polygon (r 150, `accent` fill, white stroke 6)
- the glyph text centered (font `Arial Black, Arial, sans-serif`, 160px, white, black stroke 8)

`svgTemplates.thumbnail({ headline, sub, accent, seed })` returns a 1920×1080 SVG:
- linear 135° gradient `accent` → `#12131A`
- 3 large translucent circles
- a diagonal light beam
- the headline (≤ 3 words, 150px bold, white with 10px black stroke) at the left third
- the sub text at 56px

Rasterize with `sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()`, store via `MediaService`-equivalent logic, and record the real width/height/bytes.

| Media key | Template | Params |
|---|---|---|
| `icon-aar-v2` | icon | title "Shogun Awakening", accent `#A855F7`, glyph `"AW"` (glyphs are ASCII-only so they render without CJK fonts), seed 2 |
| `icon-aar-v3` | icon | same, accent `#7C3AED`, glyph `"AW"`, seed 3 |
| `thumb-aar-boss` | thumbnail | headline "RAID BOSS", sub "Hollow Shogun has awakened", accent `#A855F7`, seed 11 |
| `thumb-aar-10m` | thumbnail | headline "1 IN 10M", sub "Roll the Void Emperor", accent `#EC4899`, seed 12 |
| `board-aar-trailer` | thumbnail | headline "SHOT 3", sub "Shogun draws his blade · 2.5s", accent `#6366F1`, seed 13 |
| `icon-dino-v1` | icon | title "Dig Up a Dino", accent `#F59E0B`, glyph `"DD"`, seed 21 |
| `thumb-dino-sunset` | thumbnail | headline "DIG DEEP", sub "Amber Canyon at sunset", accent `#F97316`, seed 22 |
| `thumb-dino-museum` | thumbnail | headline "BUILD YOUR MUSEUM", sub "40+ dinosaurs to uncover", accent `#EAB308`, seed 23 |

**Review items**
| ID | game | kind | title | status | madeBy | media | iteration / prev | task | createdAt |
|---|---|---|---|---|---|---|---|---|---|
| ri01 | AAR | ICON | App icon v2 — Shogun Awakening | CHANGES_ASKED | splash | icon-aar-v2 | 2 / – | – | T-1d |
| ri02 | AAR | ICON | App icon v3 — Shogun Awakening | TO_REVIEW | splash | icon-aar-v3 | 3 / ri01 | t06 | T-2h |
| ri03 | AAR | THUMBNAIL | Store thumbnail — Raid boss reveal | TO_REVIEW | splash | thumb-aar-boss | 1 | – | T-3h |
| ri04 | AAR | THUMBNAIL | Store thumbnail — 1 in 10M | APPROVED | splash | thumb-aar-10m | 1 | – | T-6d |
| ri05 | AAR | STORYBOARD | Trailer storyboard — Hollow Shogun update (7 shots) | TO_REVIEW | splash | board-aar-trailer | 1 | – | T-90m |
| ri06 | Dino | ICON | App icon v1 — Dig Up a Dino | TO_REVIEW | splash | icon-dino-v1 | 1 | – | T-1d |
| ri07 | Dino | THUMBNAIL | Store thumbnail — Dig site at sunset | REJECTED | splash | thumb-dino-sunset | 1 | t13 | T-1d |
| ri08 | Dino | THUMBNAIL | Store thumbnail — Build your museum | TO_REVIEW | splash | thumb-dino-museum | 1 | t13 | T-1d |
| ri09 | AAR | PUBLISH | Publish v1467 — Hollow Shogun phase 1 | TO_REVIEW | reviewer | – | 1 | t07 | T-1h |
| ri10 | Dino | STAGE | Stage: UI & HUD pass complete | APPROVED | producer | – | 1 | – | T-8d |

Counts: **toReview 6** (ri02, ri03, ri05, ri06, ri08, ri09), changesAsked 1, approved 2, rejected 1, all 10.

**Descriptions:**
- ri02: "Pushed the rim light and removed the background clutter after your v2 notes. The mask silhouette now reads at 64 px; the purple-to-black gradient keeps it distinct from the other RNG icons on the Charts page."
- ri05: "Seven shots, 30 s total: 1 lobby portal (3 s) · 2 party assembles (4 s) · 3 Shogun draws blade (2.5 s) · 4 blade ring sweep (5 s) · 5 Shadow Ronin summon (4 s) · 6 Mythic Oni Mask drop (4.5 s) · 7 logo + 'RAID NOW' (7 s). Keyframe attached for shot 3."

**Verdicts:**
- ri01 ASK_CHANGES by Ervum (T-20h): "Face reads muddy at 64 px. Push the rim light, simplify the background, and drop the small sparkles."
- ri04 APPROVE by Maya (T-6d).
- ri07 REJECT by Ervum (T-20h): "Too dark: the dig site looks like a horror game at thumbnail size."
- ri10 APPROVE by Ervum (T-8d).

**ri09 payload:** `{ buildVersion: 1467, checklist: [ {label:'Mobile pass A (108 Tester)', done:true}, {label:'Mobile pass B (108 Tester)', done:false}, {label:'Party raid test (Playtest)', done:false}, {label:'Server authority audit', done:true}, {label:'Store assets approved', done:false}, {label:'Purchase prompts honest & priced', done:true} ] }`. ri10 payload: `{ buildVersion: 205, checklist: [ {label:'HUD safe zones on 844×390', done:true}, {label:'Shop & Index screens', done:true}, {label:'Tap targets ≥ 44 px', done:true} ] }`.

**Blockers** (all game AAR, run r07, agent reviewer, `buildVersion 1467`, linked to ri09):
| ID | severity | title | detail |
|---|---|---|---|
| B1 | FIX_FIRST | Raid timer overlaps the Roblox chat button on 844×390 | At 844×390 the raid timer sits at x=8–120, y=4–40, under the CoreGui chat button. Move it top-center per [05 UI and HUD] safe zones (Frame's raid menu spec already does this; the HUD script still uses the old position). |
| B2 | SHOULD_FIX | Reroll result toast hides the currency counter for 2.5 s | The toast covers the coin counter while players are deciding whether to reroll again. Anchor it to the bottom-center above the thumbstick zone instead. |
| B3 | NIT | Inconsistent capitalisation on the Awakening Index tabs | "Legendary" vs "LEGENDARY" across tabs; use Title Case per [05 UI and HUD]. |

## 6.8 Pitches (`pitches.seed.ts`) — 2 full pitches, status `PROPOSED`, createdBy pulse, run r08, createdAt T-6h

### P1 — "What If The Sky Falls"
- **genre:** `Survival · Party`
- **logline:** "Every 90 seconds the sky drops something absurd (meteors, grand pianos, a 40-stud rubber duck). Grab blocks, build cover, survive the round, and laugh with your friends when the duck wins."
- **metrics:** `TOP-EARNING RANK` `#280` (neutral) · `PLAYING` `6.4K` (positive) · `LIKES` `85%` (positive)
- **comparables:** Doomsday Drop (`900000000000005`), Volcano Escape (`900000000000022`), Hide and Seek Mansion (`900000000000018`)
- **whatChanged:** "Disaster-survival games are climbing: Doomsday Drop went from 4.6K to 6.4K CCU in 7 days (+38%) after adding a cover-building shop, and Volcano Escape (+71%) entered up-and-coming. The top-earning chart has no party-style disaster game above #200."
- **howDifferent:** "Players build their own cover from blocks they collect between drops, which makes it survival plus a 60-second mini-build with a new themed hazard every week."
- **sections:**
  - **FIRST_60_SECONDS:** "- Spawn on a floating island with 7 other players; a giant countdown shows **0:20 to the first drop**.\n- A glowing pile of blocks pulses next to you; tapping it gives 10 blocks and the hint *Build cover!*\n- First drop: harmless beach balls, so everyone survives and gets a +25 coin pop-up.\n- Second drop: meteors. The player learns that roofs matter.\n- Survivors get confetti and see the **Next drop: ???** teaser."
  - **FIVE_MINUTE_LOOP:** "1. **Collect** blocks (20 s), racing others for the golden blocks worth 3×.\n2. **Build** cover (20 s); block shapes unlock with level.\n3. **Survive** the drop (10–30 s); themed hazards with distinct shadows telegraph impact.\n4. **Reward:** coins per survival plus a streak multiplier (×1.1 per round, capped at ×2).\n5. **Vote** on the next hazard from 3 options, a social moment every round.\n\nRounds last 75–90 s, so a 5-minute session is 3–4 rounds."
  - **MINUTES_10_30:** "- Level 5 unlocks **Block Skins** and the first gamepass prompt (Builder's Bag: +50% blocks).\n- Level 8 unlocks **Hazard Index**: collect a card for every hazard survived (completionists).\n- A daily **Sky Event** at 18:00 local triples drop frequency for 10 minutes with exclusive rewards.\n- Friends get +10% coins in the same server, which pushes invites."
  - **MONETIZATION:** "| Product | Type | Price |\n|---|---|---|\n| Builder's Bag (+50% blocks) | Gamepass | 149 R$ |\n| Hazard Radar (shadow 1 s earlier) | Gamepass | 199 R$ |\n| VIP Island (private lobby skin) | Gamepass | 299 R$ |\n| Revive Token | Dev product | 25 R$ |\n| Block Skin Crate | Dev product | 49 R$ |\n\nNo damage immunity for sale: cover must still be built ([09 Shops and Monetisation])."
  - **COMPETITORS:** "| Game | CCU | 7d | Likes | Gap we exploit |\n|---|---|---|---|---|\n| Doomsday Drop | 6.4K | +38% | 85% | No building; cover is pre-placed |\n| Volcano Escape | 3.6K | +71% | 86% | Single hazard, low replay |\n| Hide and Seek Mansion | 7.7K | +12% | 88% | Party audience overlap, no survival |"
  - **RISKS:** "- **Physics cost on mobile:** 8 players × 60 blocks plus falling props. Mitigation: anchored blocks, pooled hazards, and a server-side hit test instead of physics ([08 Mobile]).\n- **Griefing** (stealing blocks, destroying cover). Mitigation: a block's owner is the only one who can remove it.\n- **Novelty decay.** Mitigation: a weekly hazard drop via [12 Live Ops and Launch].\n- **Chart risk:** if Doomsday Drop copies building within weeks, we lose differentiation."

### P2 — "Bake a Cake Shop"
- **genre:** `Tycoon · Roleplay`
- **logline:** "Run a cosy bakery: bake layered cakes with a tap-to-stack minigame, serve quirky customers, decorate your shop and climb the Street of Sweets from a market stall to a five-floor patisserie."
- **metrics:** `TOP-EARNING RANK` `#142` (neutral) · `PLAYING` `11.2K` (positive) · `LIKES` `91%` (positive)
- **comparables:** Cake Empire Café (`900000000000006`), Bakery Tycoon Deluxe (`900000000000021`), Mega Mall Roleplay (`900000000000012`)
- **whatChanged:** "Cosy tycoons hold unusually high like ratios this week: Cake Empire Café 91%, Bakery Tycoon Deluxe 89% and +52% 7-day CCU in up-and-coming. Both are idle tycoons with no active cooking skill."
- **howDifferent:** "Every cake is a 10-second skill minigame (stack, frost, decorate) scored by customers, so players master a craft instead of waiting on droppers."
- **sections:**
  - **FIRST_60_SECONDS:** "- Spawn in a tiny market stall; Grandma Butter waves and says **'First customer in 10 seconds!'**\n- Tap the glowing oven: a 3-layer stack minigame with perfect-timing rings.\n- Serve the cake: the customer reacts (hearts for a perfect stack) and you get +40 coins with a coin fountain.\n- A **Shop Upgrade** arrow points to the second oven (35 coins), an instant affordable upgrade."
  - **FIVE_MINUTE_LOOP:** "1. **Order** arrives (cake type, layers, topping).\n2. **Bake** the minigame (stack timing → frosting swipe → topping tap).\n3. **Serve** with a score from 1 to 3 stars; tips scale with stars and streak.\n4. **Upgrade** ovens, counters and décor; décor raises customer patience.\n5. **Unlock** a recipe roughly every 4 minutes early on.\n\nSessions feel productive in 5 minutes: 12–15 orders and 2 upgrades."
  - **MINUTES_10_30:** "- Shop level 3 unlocks **Hire a Helper** (an NPC auto-serves simple orders), the idle layer for returning players.\n- The **Recipe Book** index: 36 cakes in 6 rarity tiers, each with a golden variant.\n- **Visit friends' bakeries** and leave a 'Sweet!' rating (social proof, daily cap).\n- The first-purchase offer appears at around 12 minutes: **Starter Bakery Pack (99 R$)**."
  - **MONETIZATION:** "| Product | Type | Price |\n|---|---|---|\n| Starter Bakery Pack | Dev product | 99 R$ |\n| Golden Oven (2× bake speed) | Gamepass | 199 R$ |\n| Extra Helper slot | Gamepass | 249 R$ |\n| Premium Décor set (rotating) | Dev product | 149 R$ |\n| Tip Jar (+25% tips) | Gamepass | 299 R$ |"
  - **COMPETITORS:** "| Game | CCU | 7d | Likes | Gap we exploit |\n|---|---|---|---|---|\n| Cake Empire Café | 11.2K | +18% | 91% | Idle only, no skill expression |\n| Bakery Tycoon Deluxe | 4.1K | +52% | 89% | Small content pool (12 recipes) |\n| Mega Mall Roleplay | 72.4K | +4% | 85% | Huge roleplay audience that likes shop fantasy |"
  - **RISKS:** "- **Minigame fatigue:** mitigated by helpers taking simple orders and by perfect streaks granting auto-bake.\n- **Audience skews younger:** keep reading level simple and text icons-first ([05 UI and HUD]).\n- **Décor UGC moderation:** use preset décor only, with no free text on signs.\n- **Competitor response:** Cake Empire could add minigames; our edge has to be recipe depth and the street progression."

## 6.9 Market Seed (`market.seed.ts`)
One `MarketIngestionRun` (`source=SEED`, `status=SUCCEEDED`, startedAt T-20m, finishedAt T-19m, `sortsFetched` = all 4, `gamesFetched=24`, `requestCount=0`). Universe IDs use the reserved fictional range `900000000000001`–`900000000000024` (15 digits; real IDs never reach this range). Every game has `source=SEED` and `rootPlaceId = universeId + 1000`. `iconUrl` is null, and the frontend renders a generated initials tile.

| # | universeId suffix | Name | Creator | genreL1 | Playing now | Playing 7d ago | Visits | Favorites | Up | Down |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 01 | Sky Islands Tycoon | Cloudforge Studio | Tycoon | 48,200 | 41,900 | 1,820,000,000 | 3,100,000 | 412,000 | 38,000 |
| 2 | 02 | Brainrot Merge Lab | Goofy Labs | Simulator | 61,500 | 70,300 | 2,400,000,000 | 4,000,000 | 520,000 | 61,000 |
| 3 | 03 | Anime Forge Legends | Shonen Works | RPG | 37,800 | 30,100 | 980,000,000 | 2,200,000 | 301,000 | 29,000 |
| 4 | 04 | Pet Hatch Odyssey | Big Egg Games | Simulator | 29,400 | 31,200 | 3,100,000,000 | 5,600,000 | 610,000 | 70,000 |
| 5 | 05 | Doomsday Drop | Falling Sky Co | Survival | 6,400 | 4,640 | 210,000,000 | 610,000 | 88,400 | 15,600 |
| 6 | 06 | Cake Empire Café | Sugarbyte | Tycoon | 11,200 | 9,490 | 340,000,000 | 1,100,000 | 152,000 | 15,000 |
| 7 | 07 | Fossil Frenzy | Bonepick Studio | Simulator | 8,900 | 9,800 | 420,000,000 | 900,000 | 97,000 | 21,000 |
| 8 | 08 | Obby But You're a Cat | Whisker Works | Obby | 22,700 | 18,400 | 1,100,000,000 | 1,900,000 | 233,000 | 41,000 |
| 9 | 09 | Tower Defense Galaxy | Orbit Nine | Strategy | 34,100 | 35,900 | 1,600,000,000 | 2,800,000 | 388,000 | 52,000 |
| 10 | 10 | Midnight Hospital | Lantern Horror | Horror | 15,600 | 12,100 | 600,000,000 | 1,400,000 | 176,000 | 24,000 |
| 11 | 11 | Speed Run Racers | Nitro Kids | Racing | 9,800 | 10,600 | 450,000,000 | 700,000 | 84,000 | 19,000 |
| 12 | 12 | Mega Mall Roleplay | Citylight Group | Roleplay | 72,400 | 69,600 | 6,200,000,000 | 9,800,000 | 1,020,000 | 180,000 |
| 13 | 13 | Sword Clash Arena | Steel Pixel | Fighting | 18,300 | 20,700 | 720,000,000 | 1,200,000 | 160,000 | 38,000 |
| 14 | 14 | Fishing Frontier | Reel Deal Games | Simulator | 26,900 | 22,000 | 890,000,000 | 1,700,000 | 241,000 | 22,000 |
| 15 | 15 | Rarity Rush RNG | Lucky Seven Studio | RNG | 19,700 | 13,900 | 380,000,000 | 1,000,000 | 148,000 | 19,000 |
| 16 | 16 | Garden Grow Life | Petal Games | Simulator | 54,300 | 47,800 | 2,900,000,000 | 4,700,000 | 590,000 | 48,000 |
| 17 | 17 | Zombie Rails | Rust Belt Devs | Shooter | 13,400 | 16,900 | 510,000,000 | 980,000 | 121,000 | 31,000 |
| 18 | 18 | Hide and Seek Mansion | Peekaboo Inc | Party | 7,700 | 6,880 | 260,000,000 | 480,000 | 66,000 | 9,000 |
| 19 | 19 | Mining Mayhem 2 | Pickaxe Pals | Simulator | 12,600 | 9,100 | 300,000,000 | 820,000 | 104,000 | 13,000 |
| 20 | 20 | Kaiju Smash City | Titan Toys | Action | 5,200 | 3,100 | 95,000,000 | 260,000 | 41,000 | 5,800 |
| 21 | 21 | Bakery Tycoon Deluxe | Crumb Studio | Tycoon | 4,100 | 2,700 | 70,000,000 | 190,000 | 30,500 | 3,900 |
| 22 | 22 | Volcano Escape | Ember Games | Survival | 3,600 | 2,100 | 48,000,000 | 150,000 | 22,000 | 3,600 |
| 23 | 23 | Racing Pets Derby | Pawprint Labs | Racing | 2,900 | 1,700 | 31,000,000 | 99,000 | 15,500 | 1,900 |
| 24 | 24 | Crystal Caverns RNG | Geode Works | RNG | 4,800 | 2,900 | 88,000,000 | 240,000 | 39,000 | 4,200 |

**Sort entries (rank order, by row #):**
- `TOP_EARNING`: 12, 4, 2, 16, 1, 9, 3, 14, 8, 15, 13, 10, 6, 17, 19
- `TOP_PLAYING_NOW`: all 24 sorted by "Playing now" desc
- `UP_AND_COMING`: 20, 21, 24, 22, 5, 23, 19, 15
- `TOP_RATED`: games with `up+down ≥ 5,000`, sorted by like ratio desc, top 15

**Snapshot generation (32 per game: every 6 h from T-7d18h to T-20m):** for sample `i` at time `tᵢ`, let `f = (tᵢ − t₀)/(t_last − t₀)`, `base = lerp(playing7dAgo, playingNow, f)`, `diurnal = 1 + 0.18 × sin(2π × (hourUTC(tᵢ) − 14)/24)`, `noise = 1 + (rng() − 0.5) × 0.08`, and `playing = round(base × diurnal × noise)`. The **final sample is forced to exactly `playingNow`**. `visits = visitsNow − round(playingNow × 30 × daysBack)`, `favorites = round(favoritesNow × (1 − 0.001 × daysBack))`, `upVotes/downVotes = round(now × (1 − 0.002 × daysBack))`, `maxPlayers` = 12 (Party/Survival) or 30 (others). The resulting 7-day deltas will be close to the "7d ago" column (for example Doomsday Drop ≈ +38%, Volcano Escape ≈ +71%), which matches the pitch copy.

---

## 6.10 Knowledge Vault Seed (`prisma/seed/vault/**`) — exact Markdown

`vault.seed.ts` reads every `.md` file under `prisma/seed/vault`. Folders come from `VAULT_FOLDERS` (§2.3); each file becomes a `VaultDocument` with `path` relative to the vault root, `title` = file name without `.md`, `tags` and `alwaysInject` from the folder spec, `updatedByKind=SEED`, and the `version` from the table below. One `VaultDocumentRevision` is written at that version. After all documents exist, run `VaultLinksService.reindex` logic for every doc, then create the agent bindings (§6.3). Argon must write each file **byte-for-byte** as given below. The outer four-backtick fence is not part of the file.

| Document | version | | Document | version |
|---|---|---|---|---|
| 00 For Any AI | 3 | | 07 Characters, VFX and Assets | 2 |
| 00 Start Here | 2 | | 08 Mobile | 4 |
| 01 The First Five Minutes | 3 | | 09 Shops and Monetisation | 3 |
| 02 The Core Loop | 2 | | 10 Retention and Social | 2 |
| 03 Rarity and RNG | 3 | | 11 Thumbnails, Icons and the Store Page | 2 |
| 04 Progression and Economy | 2 | | 12 Live Ops and Launch | 2 |
| 05 UI and HUD | 6 | | 13 Building It Right | 4 |
| 06 World and Look | 2 | | Claude Design prompts / Our assets / Skills | 1 / 1 / 1 |

### `00 For Any AI/00 For Any AI.md`
````markdown
# 00 For Any AI

> Read this first. It applies to every agent on every task.

## Who we are
We are **Inclined Games**, a small Roblox studio. We ship fast, readable, mobile-first games for players aged 9–16. Our two live projects are **Anime Awakening RNG** and **Dig Up a Dino**.

## The ten rules
1. **Mobile first.** More than 60% of our players are on phones. If it doesn't work at 800×360, it doesn't ship. See [[08 Mobile]].
2. **Readable in one second.** Every screen, icon and button must be understood at a glance. See [[05 UI and HUD]].
3. **The server is the source of truth.** Never trust the client with currency, damage, cooldowns or rolls. See [[13 Building It Right]].
4. **Honest odds, honest prices.** Show the real odds and never hide what a purchase does. See [[03 Rarity and RNG]] and [[09 Shops and Monetisation]].
5. **The first five minutes decide everything.** See [[01 The First Five Minutes]].
6. **One core loop, polished.** Don't add systems until the loop is fun. See [[02 The Core Loop]].
7. **No placeholders in shipped work.** If something is unknown, say so and ask; don't invent asset IDs or numbers.
8. **Cite the vault.** When you follow a rule, name the doc in brackets, e.g. [05 UI and HUD].
9. **Small, reviewable steps.** Save artifacts, record builds, flag blockers. Humans approve anything players will see.
10. **Kind to players.** No dark patterns, no fake timers, no shaming copy.

## Words we use
| Term | Meaning |
|---|---|
| Build | A saved or published place version (e.g. v1467 saved, v404 published) |
| Lane | One of our two Roblox Studio seats; only one agent uses a lane at a time |
| FIX FIRST | A blocker that must be solved before publishing |
| Pass A / Pass B | The two mobile viewport passes 108 Tester runs on every build |
````

### `00 Start Here/00 Start Here.md`
````markdown
# 00 Start Here

Welcome to the Inclined Games vault. This is our studio brain: every rule our agents follow lives here, and humans edit it in Obsidian or in the Library tab.

## How work flows
```ascii
 Human ──ask──▶ Lead ──delegates──▶ Specialists ──artifacts/builds──▶ Producer
   ▲                                                   │
   │                                                   ▼
   └──── approves ◀── Review queue ◀── Splash / Reviewer / 108 Tester
```

## Map of the vault
| Folder | Read it when you… |
|---|---|
| [[00 For Any AI]] | …do anything (always loaded) |
| [[01 The First Five Minutes]] | …design onboarding or a new game |
| [[02 The Core Loop]] | …design or change the main activity |
| [[03 Rarity and RNG]] | …touch odds, rolls, eggs, crates |
| [[04 Progression and Economy]] | …balance currencies, levels, zones |
| [[05 UI and HUD]] | …draw or build any screen |
| [[06 World and Look]] | …build maps, lighting, colour |
| [[07 Characters, VFX and Assets]] | …make or pick models, effects, sounds |
| [[08 Mobile]] | …ship anything (every build) |
| [[09 Shops and Monetisation]] | …price or place a product |
| [[10 Retention and Social]] | …design reasons to come back or invite |
| [[11 Thumbnails, Icons and the Store Page]] | …make store art |
| [[12 Live Ops and Launch]] | …plan updates and events |
| [[13 Building It Right]] | …write Luau or review code |
| [[Claude Design prompts]] | …need a ready-made UI design prompt |
| [[Our assets]] | …need an existing asset |
| [[Skills]] | …want to know which agent does what |

## Editing rules
- One topic per doc. Keep headings stable, because agents cite them.
- Prefer tables and checklists over paragraphs.
- When you change a rule, say why in the change reason.
````

### `01 The First Five Minutes/01 The First Five Minutes.md`
````markdown
# 01 The First Five Minutes

Players decide in the first minute whether to stay, and in five whether to come back.

## Timeline we design to
| Time | The player must… | We provide… |
|---|---|---|
| 0–10 s | understand where they are and what to press | one glowing target, one arrow, no menus open |
| 10–60 s | complete the core action once and get rewarded | a guaranteed small win with a big reaction (coins burst, sound, shake) |
| 1–3 min | repeat the loop and see a number go up | the first upgrade affordable after 2–3 loops |
| 3–5 min | discover the next goal | a visible locked area or rarity they want, with a progress bar |

## Rules
- **No text walls.** At most 6 words per hint. Use arrows, glows and the character's gaze.
- **No modal popups in the first 60 seconds**, including daily rewards and shop offers. They queue until minute 2.
- **First reward is guaranteed.** RNG games give a guaranteed Uncommon or better on roll #1 ([[03 Rarity and RNG]]).
- **Spawn faces the action.** The camera starts looking at the first target, not at a wall or the shop.
- **Name the next goal.** By minute 5 the HUD shows one clear objective ("Reach Zone 2: 1,250 coins").

## Anti-patterns
- Tutorials that lock movement.
- Asking for a purchase before the first upgrade.
- Loading screens over 5 seconds on mobile (see [[08 Mobile]]).
````

### `02 The Core Loop/02 The Core Loop.md`
````markdown
# 02 The Core Loop

A core loop is the 15–90 second cycle a player repeats hundreds of times. Polish it before anything else.

## Shape
```ascii
   ┌──────────► ACT (dig / roll / fight) ──────────┐
   │                                               ▼
 UPGRADE ◄── SPEND ◄── REWARD (coins, items, XP) ◄─┘
   │
   └──► unlocks NEW GOAL (zone, rarity, boss)
```

## Requirements
1. **Feedback within 100 ms** of every input: sound, particle, number pop.
2. **Reward variance:** most rewards small, some medium, rare jackpots. The jackpot must be visible to everyone in the server.
3. **An upgrade every 2–4 loops** in the first session, slowing to every 8–12 loops by hour two ([[04 Progression and Economy]]).
4. **One-thumb playable** on mobile; the main action button lives in the right-thumb zone ([[05 UI and HUD]]).
5. **Session goal:** a player who stops after 25 minutes has unlocked something new.

## Our loops
| Game | Act | Reward | Spend |
|---|---|---|---|
| Anime Awakening RNG | Roll an Awakening (1.2 s animation) | Awakening + shards | Luck boosts, raid entries |
| Dig Up a Dino | Dig a tile (0.6–1.0 s) | Fossils, coins | Tools, backpack, museum slots |
````

### `03 Rarity and RNG/03 Rarity and RNG.md`
````markdown
# 03 Rarity and RNG

## Rarity ladder (shared by all our games)
| Tier | Colour (RGB) | Base odds | Feel |
|---|---|---|---|
| Common | Grey (170, 170, 170) | 1 in 2 | constant |
| Uncommon | Green (85, 200, 90) | 1 in 4 | every few rolls |
| Rare | Blue (60, 140, 255) | 1 in 20 | a small cheer |
| Epic | Purple (170, 80, 255) | 1 in 150 | screen flash |
| Legendary | Gold (255, 190, 40) | 1 in 2,500 | server announcement |
| Mythic | Pink-red (255, 60, 110) | 1 in 100,000 | global announcement + cutscene |
| Secret | Rainbow gradient | 1 in 10,000,000 | global announcement, unique title |

## Rules
- **Displayed odds are the real odds**, shown in the roll UI as "1 in N", rounded to 3 significant figures.
- **Weights are integers**; the table total is stored and validated server-side on boot.
- **Luck boosts are multiplicative** on all tiers above Rare, capped at ×10 combined, and the cap is shown.
- **Pity:** Mythic is guaranteed within 60 raid clears; the pity counter is visible.
- **First roll** is a guaranteed Uncommon or better ([[01 The First Five Minutes]]).
- **Rolls happen on the server** with `Random.new()` per player session; the client only plays the animation ([[13 Building It Right]]).

## Rarity reveal timing
| Tier | Reveal length | Skippable |
|---|---|---|
| Common–Rare | 1.2 s | yes, after 0.4 s |
| Epic–Legendary | 2.5 s | yes, after 1.5 s |
| Mythic–Secret | 6 s cutscene | no |
````

### `04 Progression and Economy/04 Progression and Economy.md`
````markdown
# 04 Progression and Economy

## Currency rules
- **One soft currency** per game (Coins / Shards) earned by playing; **Robux products** never sell soft currency directly in more than 3 sizes.
- Every currency has **at least 3 sinks** (upgrades, cosmetics, consumables).
- Show **earn rate per minute** in the economy sheet for a median player.

## Curve formulas we use
| Thing | Formula | Notes |
|---|---|---|
| Upgrade cost (level n) | `base × 1.15^n` | base set so upgrade #1 costs 2–3 loops of reward |
| Zone unlock (zone z) | `1250 × 4.5^(z-1)` | zone 2 at ~6 min, zone 3 at ~25 min, zone 4 at ~2 h |
| Rebirth requirement | `100k × 2.2^r` | each rebirth gives +25% earn multiplier |

## Time targets (median player)
| Milestone | Target |
|---|---|
| First upgrade | < 1 min |
| Zone 2 | 5–8 min |
| First rebirth | 45–75 min |
| Zone 5 | 6–10 h |

## Checks before shipping a change
- The first 20 levels table is attached.
- Expected value of every sink is computed.
- No currency can be farmed AFK faster than active play.
````

### `05 UI and HUD/05 UI and HUD.md`
````markdown
# 05 UI and HUD

> The most important rule: **a player understands every screen in one second, on a phone, with a thumb.**

## 1. Viewport targets
| Target | Resolution (landscape) | Notes |
|---|---|---|
| PC | 1920×1080 | design at 1920×1080, test at 1366×768 |
| Mobile — notched | **844×390** | iPhone-class; notch/rounded corners on one side (≈47 px) |
| Mobile — short | **800×360** | common Android; the tightest height we support |
| Tablet | 1024×768 | 4:3; extra vertical space, never stretch buttons |

Use `UIScale` driven by viewport height (`scale = clamp(viewportY / 1080, 0.33, 1)` on PC layouts, mobile layouts designed at native size) and `UIAspectRatioConstraint` on every square button and icon.

## 2. Safe zones (keep-out areas)
| Zone | Where | Size | Rule |
|---|---|---|---|
| Roblox top-left controls | top-left | x 0–160 px, y 0–58 px (`GuiService:GetGuiInset()` top = 58) | **Nothing interactive.** Timers and counters start at x ≥ 172 or move top-center |
| Device notch / rounded corners | the notched side (left or right) | ≈ 47 px on 844×390 | `ScreenGui.ScreenInsets = Enum.ScreenInsets.DeviceSafeInsets` for HUD; full-bleed only for backgrounds |
| Thumbstick | bottom-left | x 0–40% of width, y 45–100% of height | no buttons; toasts must not overlap it |
| Jump button | bottom-right | 170×170 px box from the bottom-right corner (844×390) | no buttons inside; our main action sits **above** it |
| Roblox top-right | top-right | x (W−120)–W, y 0–58 px | keep clear for the Roblox menu on some devices |

## 3. Wireframes

### 3.1 PC HUD — 1920×1080
```ascii
┌────────────────────────────────────────────────────────────────────────────────────────┐
│[R][💬]  ← Roblox (keep clear)        ┌──────── ZONE 2 · AMBER CANYON ───────┐           │
│                                      │  Next: Zone 3  ████████░░░  72%       │  🪙 12,480│
│ ┌────────┐                           └──────────────────────────────────────┘  💎 340   │
│ │ 🎒 Bag │  ← left rail: Bag, Index,                                                    │
│ │ 📖 Idx │     Shop, Quests (64×64,                                                     │
│ │ 🛒 Shop│     gap 12, x=24, y=200)                                                     │
│ │ ✅ Qst │                                                                              │
│ └────────┘                                                                              │
│                                                                                         │
│                                   (3D world)                                            │
│                                                                                         │
│                                                              ┌────────────────────┐     │
│                                                              │  🎲  ROLL  (E)      │     │
│ [toast area: bottom-center, above hotbar]                    │  Green 68,214,72    │     │
│                         ┌─ hotbar 1–5 ─┐                     └────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Mobile landscape — 844×390 (notched)
```ascii
┌─notch─┬──────────────────────────────────────────────────────────────────────┐
│       │[R][💬]          ┌── ZONE 2 ── 72% ──┐                  🪙 12.4K  💎340│
│ 47px  │                 └──────────────────┘                                │
│ device│ [🎒]                                                                │
│ safe  │ [📖]   ← rail: 52×52, gap 8, x=safe+12, y=70                        │
│ inset │ [🛒]                                                                │
│       │                         (3D world)                     ┌──────────┐ │
│       │                                                        │ 🎲 ROLL  │ │
│       │  ╭──────────╮                                          │ 96×96    │ │
│       │  │thumbstick│   [ toast: bottom-center, y ≤ H−120 ]    └──────────┘ │
│       │  │  zone    │                                             ╭──────╮  │
│       │  ╰──────────╯                                             │ JUMP │  │
└───────┴───────────────────────────────────────────────────────────╰──────╯──┘
```

### 3.3 Mobile landscape — 800×360 (short)
```ascii
┌────────────────────────────────────────────────────────────────────┐
│[R][💬]        ┌ ZONE 2 · 72% ┐                       🪙12.4K 💎340 │
│ [🎒][📖][🛒]  ← rail turns horizontal under 380 px height, y=62    │
│                                                                    │
│                          (3D world)                  ┌──────────┐  │
│                                                      │ 🎲 ROLL  │  │
│  ╭────────╮                                          │  88×88   │  │
│  │ stick  │       [ toast y ≤ H−110 ]                └──────────┘  │
│  ╰────────╯                                              ╭─────╮   │
└──────────────────────────────────────────────────────────╰JUMP─╯───┘
```

### 3.4 Modal (Shop / Index / Raid) — all sizes
```ascii
┌──────────────────────────── 80% W × 80% H (max 1100×720) ───────────────────────────┐
│  TITLE (Bold 28/22 px)                                                   [ ✕ ] Red  │
│  [Tab][Tab][Tab]                                                                     │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   ← grid, cell 120×140 PC / 96×112 mobile       │
│ │ item │ │ item │ │ item │ │ item │      ScrollingFrame, AutomaticCanvasSize = Y     │
│ └──────┘ └──────┘ └──────┘ └──────┘                                                  │
│                                                   [ BUY 99 R$ ] Green / Gold premium │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## 4. Colour semantics (button meaning never changes)
| Meaning | Name | RGB | Use for |
|---|---|---|---|
| Buy / Confirm / Go | **Green** | rgb(68, 214, 72) | Buy, Confirm, Start, Claim, Equip |
| Close / Cancel / Danger | **Red** | rgb(235, 82, 82) | ✕ close, Cancel, Delete, Leave |
| Premium / Robux | **Gold** | rgb(255, 206, 68) | Robux purchases, VIP, premium currency |
| Info / Navigate | **Blue** | rgb(64, 156, 255) | Tabs, Info, Index, "See more" |
| Special / Event | **Purple** | rgb(168, 85, 247) | Limited events, raids, rebirth |
| Disabled | **Grey** | rgb(120, 124, 140) | Unaffordable, locked (always with a lock icon) |
| Text on buttons | **White** | rgb(255, 255, 255) | with a 2 px UIStroke rgb(20, 20, 28) |
| Panel background | **Ink** | rgb(24, 26, 36) at 0.1 transparency | modals, rails |

Rarity colours come from [[03 Rarity and RNG]].

## 5. Components
| Component | PC | Mobile | Details |
|---|---|---|---|
| Primary action | 280×72 | 96×96 (88×88 on 800×360) | UICorner 16, UIStroke 3 px dark, icon + 1 word |
| Standard button | 160×52 | min 44×44 tap target | UICorner 12, label Bold 20/16 |
| Close ✕ | 44×44 | 44×44 | Red, always top-right of the modal |
| Currency counter | 160×40 | 110×32 | compact numbers (12.4K) on mobile, full on PC |
| Toast | max 520×56 | max 360×48 | bottom-center, 2.5 s, never over the thumbstick/jump zones |
| Text | min 18 px PC | min 14 px at 800×360 | font: Builder Sans Bold for labels, Builder Sans Medium for body |

## 6. Genre conventions matrix
| Genre | Main HUD element | Primary action position | Signature screen | Must-have popups |
|---|---|---|---|---|
| RNG | Luck multiplier + roll counter | right thumb, big ROLL | Index (collection grid by rarity) | Rare reveal, pity progress |
| Simulator | Currency + backpack capacity | right thumb, ACT | Upgrade shop | Backpack full → sell |
| Tycoon | Cash + income/sec | world buttons (step-on pads) | Rebirth | Next dropper affordable |
| Obby | Stage number + timer | jump (Roblox default) | Stage select / skip | Checkpoint reached |
| Tower Defense | Wave + base HP + cash | bottom card bar | Unit loadout | Wave start countdown |
| Horror | Minimal (objective only) | context prompt | Lobby / party | None during chases |
| Roleplay | Job/role + money | context prompts | Wardrobe / house editor | Role picker on spawn |

## 7. Checklist before handing a screen to Builder
- [ ] PC, 844×390 and 800×360 wireframes drawn
- [ ] Nothing interactive in the safe zones above
- [ ] Every button's colour matches its meaning (section 4)
- [ ] Tap targets ≥ 44×44 on mobile
- [ ] Text ≥ 14 px at 800×360
- [ ] Numbers tested at 9,999,999 (no clipping)
- [ ] Genre convention named

Related: [[08 Mobile]], [[Claude Design prompts]].
````

### `06 World and Look/06 World and Look.md`
````markdown
# 06 World and Look

## Visual pillars
1. **Readable silhouettes:** every zone has one landmark visible from spawn.
2. **Saturated, not noisy:** two dominant hues per zone and one accent.
3. **Light leads the player:** the brightest thing on screen is where they should go.

## Lighting baseline (Future lighting)
| Property | Default | Notes |
|---|---|---|
| Lighting.Technology | Future | fall back to ShadowMap automatically on low-end |
| Brightness | 2.2 | |
| EnvironmentDiffuseScale / SpecularScale | 0.6 / 0.8 | |
| Atmosphere.Density | 0.3 | 0.45 for Amber Canyon dust |
| ColorCorrection.Saturation | 0.15 | never above 0.3 |
| Bloom.Intensity / Threshold | 0.6 / 1.6 | |

## Zone colour script
| Game | Zone | Dominant hues | Accent |
|---|---|---|---|
| Dig Up a Dino | 1 Fern Valley | green, tan | orange flags |
| Dig Up a Dino | 2 Amber Canyon | orange, amber | teal crystals |
| Anime Awakening RNG | Lobby | indigo, white | purple Awakening portal |
| Anime Awakening RNG | Shogun Arena | black, crimson | violet blade glow |

Performance budgets are in [[08 Mobile]]; asset rules in [[07 Characters, VFX and Assets]].
````

### `07 Characters, VFX and Assets/07 Characters, VFX and Assets.md`
````markdown
# 07 Characters, VFX and Assets

## Characters
- R15 rigs only; bosses may be custom rigs but must have a Humanoid for targeting.
- Boss scale 2.5–4× player height; the hit box is a separate invisible part.

## VFX by rarity
| Tier | Particles | Light | Sound |
|---|---|---|---|
| Common–Rare | ≤ 40 | none | short pop |
| Epic–Legendary | ≤ 120 | PointLight 8 studs | rising chime |
| Mythic–Secret | ≤ 300 (1.5 s burst) | screen flash + beam | unique sting |

## Asset rules
- Naming: `<Game>_<Category>_<Name>_<Variant>` (e.g. `AAR_VFX_AwakenBurst_Purple`). Registry in [[Our assets]].
- Meshes ≤ 10k tris (props ≤ 2k); textures ≤ 1024² (512² for props).
- Audio: normalised to −14 LUFS; loops seamless; all audio we own or have a licence for.
- No asset ID is invented: unknown IDs are written "pending upload".
````

### `08 Mobile/08 Mobile.md`
````markdown
# 08 Mobile

Most of our players are on phones. Every build gets two viewport passes from 108 Tester: **Pass A** when a build is saved and **Pass B** before publishing.

## Viewport matrix
| Device class | Resolution | Must pass |
|---|---|---|
| Notched phone (landscape) | 844×390 | A and B |
| Short Android (landscape) | 800×360 | A and B |
| Older phone | 1334×750 | B |
| Large phone | 2532×1170 | B |
| Tablet | 1024×768 | B |
| PC | 1920×1080 | A and B |

## Checks per viewport
1. Nothing under the Roblox top-left controls or behind the notch ([[05 UI and HUD]] section 2).
2. No button inside the thumbstick or jump zones.
3. Tap targets ≥ 44×44 px; text ≥ 14 px at 800×360.
4. Scrolling frames reachable with a thumb; the close button is reachable without regrip.
5. Currency displays tested at 9,999,999.
6. FPS ≥ 30 on a mid-range phone in the busiest zone.

## Performance budgets
| Budget | Limit |
|---|---|
| Instances in a zone | ≤ 15,000 (StreamingEnabled on, target radius 256) |
| Active particles | ≤ 600 on screen |
| Draw-call-heavy SurfaceGuis | ≤ 20 visible |
| Memory | ≤ 900 MB client on a 3 GB device |
| Join to playable | ≤ 8 s on 4G |
````

### `09 Shops and Monetisation/09 Shops and Monetisation.md`
````markdown
# 09 Shops and Monetisation

## Honesty rules (non-negotiable)
- Every product says what it does in one line, with numbers ("2× Luck on all rolls, forever").
- No fake discounts, fake timers or "only 2 left" scarcity.
- No pay-to-win in PvP. Boosts affect PvE and progression speed only.
- Odds for anything random are shown before purchase ([[03 Rarity and RNG]]).

## Price ladder
| Tier | Robux | Typical product |
|---|---|---|
| Impulse | 25–49 | consumable, revive, small boost |
| Starter | 99 | starter pack (best value, once) |
| Core | 149–249 | 2× luck, auto-roll, extra slot |
| Premium | 399 | VIP |
| Whale | 799+ | bundle — needs a human decision |

## Placement
- First offer at **minutes 10–30**, never before the first upgrade ([[01 The First Five Minutes]]).
- The shop button lives in the left rail; the premium tab uses **Gold** ([[05 UI and HUD]]).
- Contextual prompts only at moments of need (backpack full, rare roll missed by pity).
````

### `10 Retention and Social/10 Retention and Social.md`
````markdown
# 10 Retention and Social

## Return hooks
| Hook | Rule |
|---|---|
| Daily reward | 7-day streak; day 7 is the big one; a missed day pauses the streak instead of resetting it |
| Session goal | always one visible objective in the HUD |
| Limited event | every 2 weeks, announced 48 h ahead ([[12 Live Ops and Launch]]) |
| Collection | Index completion % per zone/rarity |

## Social
- **Friends boost:** +10% rewards when a friend is in the server.
- **Server-wide moments:** Legendary+ drops announced to the server; Mythic+ globally.
- **Party play:** raids and bosses scale for 1–4 players; joining a friend's party takes ≤ 2 taps.
- **Trading** (Dig Up a Dino): both players confirm twice; values shown; trade cooldown 30 s.
````

### `11 Thumbnails, Icons and the Store Page/11 Thumbnails, Icons and the Store Page.md`
````markdown
# 11 Thumbnails, Icons and the Store Page

## Icon (1:1, 512×512)
- One focal subject (a face or creature with clear emotion), centered, filling 70% of the frame.
- **No text.** High-contrast rim light; the background is a simple gradient.
- Must read at **64 px**: check the small-preview strip in Review.

## Thumbnails (16:9, 1920×1080)
- At most **three words** of text, bold, with a dark stroke; text on the left third.
- Show the fantasy (the jackpot moment, the boss, the rare find), not the menu.
- Make 3–5 thumbnails per update; rotate the best performers.

## Store page
| Field | Rule |
|---|---|
| Title | Game name + one hook word in brackets only during events, e.g. "Anime Awakening RNG [RAID]" |
| Description | first line = the fantasy in ≤ 90 characters; then update notes; then the controls |
| Genre | the closest Roblox genre; never misleading |

## Trailer storyboards
6–8 shots, 30 s max, hook in the first 2 seconds, logo and call to action in the last shot.
````

### `12 Live Ops and Launch/12 Live Ops and Launch.md`
````markdown
# 12 Live Ops and Launch

## Cadence
| Rhythm | What ships |
|---|---|
| Weekly (Saturday 14:00 UTC) | update with at least one new thing to find |
| Every 2 weeks | limited event (5–7 days) |
| Monthly | a new zone, boss or rarity tier |

## Launch checklist
1. Mobile passes A and B green ([[08 Mobile]]).
2. Reviewer PUBLISH item approved, with no FIX FIRST blockers.
3. Store icon and 3+ thumbnails approved ([[11 Thumbnails, Icons and the Store Page]]).
4. Update log written (≤ 5 bullet points, player language).
5. Soft-launch 2 hours before the event announcement; watch errors and CCU.

## Notification copy
- ≤ 60 characters, one emoji at most, and a reason to come now: "⚔️ Hollow Shogun raid is live — 2× shards today!"
````

### `13 Building It Right/13 Building It Right.md`
````markdown
# 13 Building It Right

## Luau standards
- `--!strict` at the top of every script and module; typed function signatures.
- Use `task.wait`, `task.spawn` and `task.delay`, never `wait`, `spawn` or `delay`.
- Services through `game:GetService()`; modules live in `ReplicatedStorage.Shared` (shared) and `ServerScriptService` (server-only).
- Clean up every connection (store them in a table, disconnect on destroy).

## Server authority
| The client may… | The server must… |
|---|---|
| request a roll | roll, validate cooldown and currency, save |
| play animations and VFX | decide hits and damage |
| show predicted numbers | own the real numbers |

- Every RemoteEvent handler validates types and ranges and rate-limits per player (default 4 calls/s).
- Never pass prices or rewards from the client.

## Data
- ProfileService-style session locking; save on leave and every 120 s; `pcall` with 3 retries.
- Keys: `player_<userId>`, schema version field, migrations are pure functions.

## Hierarchy
```ascii
ReplicatedStorage/Shared/{Config, Types, Util}
ServerScriptService/{Services/*, Raid/*, Data/*}
StarterPlayerScripts/{Controllers/*, UI/*}
Workspace/{Zones/*, Spawns, Portals}
```

## Review gates
Builder records a SAVED build, then 108 Tester Pass A, Playtest, Reviewer, 108 Tester Pass B, and finally human approval of the PUBLISH item.
````

### `Claude Design prompts/Claude Design prompts.md`
````markdown
# Claude Design prompts

Ready-made prompts for UI exploration. Always paste the relevant rules from [[05 UI and HUD]].

## HUD exploration
> Design a Roblox mobile-landscape HUD at 844×390 for a {genre} game. Keep x 0–160 / y 0–58 free for Roblox controls and a 47 px notch inset on the left. Primary action button 96×96 above the jump button in the bottom-right. Use Green rgb(68,214,72) for confirm, Red rgb(235,82,82) for close and Gold rgb(255,206,68) for premium. Output an ASCII wireframe plus a component table (name, size, position, colour, font size).

## Shop screen
> Design a Roblox shop modal at 80% of the screen (max 1100×720) with tabs Featured / Boosts / Gamepasses. Grid cells 120×140 on PC and 96×112 on mobile. Every product shows its one-line value and price; Robux buttons are Gold. Include the 800×360 version with a scrolling grid.

## Index / collection grid
> Design an Index screen grouping items by rarity using the colours in [[03 Rarity and RNG]], showing completion % per tier, locked items as silhouettes with "1 in N" odds, and a filter row. PC and 800×360 versions.
````

### `Our assets/Our assets.md`
````markdown
# Our assets

Maintained by Librarian. Sorted by category, then name. "pending upload" means the asset is not on Roblox yet.

| Name | Category | Game | Roblox ID | Source / licence | Used in |
|---|---|---|---|---|---|
| AAR_Audio_AwakenSting_Mythic | Audio | AAR | pending upload | made in-house | Mythic reveal |
| AAR_Mesh_ShogunKatana_Default | Mesh | AAR | pending upload | made in-house | Hollow Shogun boss |
| AAR_VFX_AwakenBurst_Purple | VFX | AAR | pending upload | made in-house | Epic+ roll reveal |
| DUD_Decal_DigSiteGrid_Sand | Decal | Dino | pending upload | made in-house | Zone 1 dig tiles |
| DUD_Mesh_SteelPick_T2 | Mesh | Dino | pending upload | made in-house | Tool tier 2 |
| DUD_Mesh_TRexSkull_Fossil | Mesh | Dino | pending upload | made in-house | Museum, icon |

## Rules
- Follow the naming in [[07 Characters, VFX and Assets]].
- Never reuse an asset across games without a new name prefix.
````

### `Skills/Skills.md`
````markdown
# Skills

Who does what. Lead routes work using this table.

| Agent | Skill | Typical output |
|---|---|---|
| Lead | decompose & delegate | task plan table |
| Pulse | market analysis, pitches | pitch with metrics |
| Architect | 12-step blueprint | blueprint doc + milestones |
| Builder | Luau systems, combat, data | scripts, SAVED builds |
| Frame | UI/HUD wireframes | ASCII screens + component tables |
| Scenic | zones & lighting | zone sheets, lighting tables |
| Balance | curves, odds, economy | CSV/JSON tables |
| Librarian | asset curation | [[Our assets]] updates |
| Splash | icons, thumbnails, storyboards | review items |
| Producer | flow checks, milestones | milestone updates, TRY IT requests |
| Liveops | events & cadence | calendar + config JSON |
| Merchant | gamepasses & shop | price ladder table |
| Playtest | multi-client tests | test matrix, blockers |
| 108 Tester | mobile viewport passes A/B | viewport report, blockers |
| Reviewer | pre-publish QA | PUBLISH review item, FIX FIRST blockers |
````
