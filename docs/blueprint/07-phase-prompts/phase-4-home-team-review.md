# Section 7 — Sequential Execution Prompts for Gemini Argon 4.0

**Feeding the prompts:** run the phases strictly in order. Each phase starts in a **fresh context** containing (a) the **Global Preamble**, (b) that phase's prompt and (c) the blueprint files it names under `/docs/blueprint/`. A phase is done only when its acceptance commands pass. If a phase fails acceptance, re-run the same phase prompt with the failing output appended under `## Failures to fix`.

## 7.0 Global Preamble (prepend to every phase prompt verbatim)
```text
You are Gemini Argon 4.0 acting as a senior full-stack engineer implementing "RobDev Control Room".
The blueprint in /docs/blueprint is the single source of truth. Implement it exactly; where it gives exact code or text, copy it verbatim. Where it specifies behaviour, implement it fully.

ABSOLUTE RULES
1. Write 100% of the code for every file in scope. No placeholders, no "// TODO", no "implement later", no stubbed functions, no mock data in production code, no lorem ipsum.
2. TypeScript strict mode everywhere. No `any` (use `unknown` + narrowing). No `@ts-ignore`/`@ts-expect-error`. No non-null assertions except where the blueprint shows them.
3. Pinned versions only (blueprint "Pinned Technology Versions"): TypeScript ~6.0.3, Angular ^22.2.3, NestJS ^12.2.0, Prisma 7.10.1, zod ^4.6.7. Do NOT install TypeScript 7 or Prisma 8.
4. Backend and shared are ESM ("type": "module", module "nodenext"): every relative import ends in ".js".
5. Frontend: standalone components, OnPush, signal inputs/outputs (input(), output(), model()), inject(), @if/@for/@switch with track, zoneless. No NgModules, no zone.js, no @angular/animations.
6. Styling: pure SCSS with the design system in frontend/src/styles. Every component stylesheet starts with `@use 'rd';`. NO Tailwind, NO Bootstrap, NO Angular Material, NO CDK, NO PrimeNG, NO icon fonts, NO CSS-in-JS. No raw hex colours in component SCSS: use rd.color()/tokens.
7. Never hard-code LLM model IDs. Models come from provider list-models APIs at runtime.
8. Never log or return API keys or tokens. Secrets are encrypted with SecretBoxService.
9. Every file listed for the phase must exist when you finish; do not create files the blueprint does not list unless strictly required by tooling (and then list them in your final report).
10. When the blueprint is silent on a detail, choose the simplest robust option consistent with the blueprint and record it under "Decisions" in your final report.

FINAL REPORT (end of every phase): list files created/modified, commands run with their results, and "Decisions" made.
```

## 7.4 Phase 4 — Home, Team/Lead Console & Review Drawer
```text
PHASE 4 OF 5 — Command Center (/home), Agent Execution Console (/team, /team/:agentKey, /lead), Tasks view, Games views, Human-in-the-loop Review (/review) with the inspection drawer, and Settings (models + members).

READ: docs/blueprint/03-scss-design-system.md §3.5 (Home, Team, Review, Drawer), 04-backend.md §4.4–4.5 (endpoints/events used), 05-frontend.md §5.5 feature stores, §5.6 contracts for every component named below, §5.7–5.10; 06-seed-data.md §6.5–6.7 (so the seeded content renders correctly).

BUILD
 1. HomePage + GreetingHeader (time-aware greeting, status pills "{n} need you / {n} working / {n} queued"), PromptBar ("Ask the Lead anything, or say what you want done..."), SetupBanner, NeedsYouColumn + NeedsYouCard (PICK THE NEXT GAME, TRY IT with Reply/Done/Details, DECISION options, optimistic Done), LiveNowPanel (Live now rows with streaming snippets, WHERE EACH GAME IS with GameProgressCard: "v404 published", "v1467 saved", progress, purple "Play the newest build" CTA or "Add Roblox place ID", STUDIO LANES rows). All filtered by the global selected game.
 2. TeamPage (master-detail split, /lead variant with fixed Lead and wider console), AgentConsoleStore (exact streaming algorithm), AgentList + AgentListItem (WORKING green / IDLE muted pills, timestamps, snippets), AgentConsole header (model chip / "No model" chip), RunPicker, RunLogStream (auto-stick + "Jump to live"), LogEntry (all 8 kinds; Markdown with ascii + luau blocks), AgentChatBar ("Message {Agent}...").
 3. TasksPage + TaskDetailDrawer; GamesPage + GameDetailPage (milestones, builds timeline with mobile pass A/B pills, place ID inputs).
 4. ReviewPage with ReviewStore: tabs "Images & video" / "Stages & publish", filter pills To review / Changes asked / Approved / Rejected / Everything (with counts), grid grouped by game (auto-fill 220px), ReviewCard, ReviewDrawer in rd-drawer (URL ?item= deep-link, metadata line "Made by Splash · 512×512 · 399 KB" format, SmallPreviewStrip "HOW IT READS SMALL" at 512/150/64 px, feedback textarea, Approve [A] / Ask for changes [C] / Reject [X] with hotkeys and the FIX FIRST disable rule, J/K navigation, verdict history), StageDetail (checklist + blockers with resolve/waive), Upload dialog for manual images/trailers (video duration read client-side).
 5. SettingsPage: ModelConnections + ConnectionFormDialog (6 providers, base URL rules, test on save), AgentModelBindings (live model lists, datalist, Splash image model, Apply to all, debounced PATCH), Members.
 6. Test: review-drawer.component.spec.ts.

ACCEPTANCE
  lint, build and test for frontend all pass.
  With the seed data, manually verify:
   - Home shows 4 Needs-you cards (1 PICK, 2 TRY IT, 1 DECISION), 2 game cards with v404 published / v1467 saved, and "Not published · v213 saved" for Dig Up a Dino; the game filter narrows every column
   - /team/builder shows the seeded Luau run with highlighting and the LANE_BUSY tool result; /team/frame shows both ASCII wireframes un-wrapped
   - /review shows 6 To-review items grouped by game; opening ri02 shows the strip at 3 sizes; pressing C focuses feedback, entering text + Ctrl+Enter asks for changes and a follow-up Splash task appears in /tasks; ri09 (Publish v1467) has Approve disabled with the FIX FIRST tooltip
   - with a real API key: add a connection in Settings, bind Lead, send "Plan a winter event for Dig Up a Dino" from Home → the Lead console streams live tokens, tool calls and handoffs; the matrix dot glows green while working; Pause all stops the run and Resume re-queues it
OUT OF SCOPE: Market, Pitches, Library content.
```
