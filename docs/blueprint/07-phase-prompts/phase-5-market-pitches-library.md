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

## 7.5 Phase 5 — Market, Pitches & Obsidian Vault Views
```text
PHASE 5 OF 5 — Market intelligence terminal (/market), Pulse pitches (/pitches), the Obsidian Vault IDE (/library), final polish and full-system verification.

READ: docs/blueprint/03-scss-design-system.md §3.5 (Market, Pitches, Library, Status Pill), 04-backend.md §4.4 (Market, Pitches, Vault), §4.13–4.14, 05-frontend.md §5.5 (MarketStore, PitchesStore, LibraryStore), §5.6 (all Market/Pitch/Vault component contracts), §5.8; 06-seed-data.md §6.8–6.10.

BUILD
 1. MarketPage + MarketStore: sort tabs top-earning / top-playing now / up-and-coming / top-rated (URL ?sort=), genre select, search, MarketTable (high-density, sticky header, client-side column sorting, CCU compact, 7d Δ coloured +/−, sparkline, like ratio colouring, visits, favorites, initials tile when iconUrl is null, row → Roblox page), IngestionStatus (Live / Seed / stale-error banner, admin Refresh with 409 handling), live reload on market:ingested.
 2. PitchesPage + PitchesStore: list pane (PitchListItem) + detail (PitchDetail) with MetricCallout cards (TOP-EARNING RANK #280 · 6.4K PLAYING · 85% LIKES), PitchBanner "WHAT CHANGED" / "HOW WE'RE DIFFERENT", comparables chips (→ /market?q=name), six accordions (First 60 seconds, 5-minute loop, Minutes 10-30, Monetization, Competitors, Risks), sticky actions Pick this game / Edit & approve (PitchEditDialog then PATCH + pick) / Request changes (dialog), "Ask Pulse for pitches" generate action; after Pick navigate to the new game's detail page with a success toast.
 3. LibraryPage + LibraryStore: 3-pane IDE (VaultTree with folders 00–13 + extras, keyboard navigation, persisted expansion, create doc/folder; VaultEditor textarea with tab-indent, Ctrl+S, 2 s autosave, View/Split/Edit modes; VaultPreview with wikilinks (click → open doc), ASCII blocks, colour swatches for rgb() cells; TelemetryBar with live word/char counts via shared countWords/countChars, backlinks popover, linked agent avatars, version + updated by). Conflict handling: 409 → banner with "Keep mine" (re-save with new baseVersion) / "Use theirs". Live vault:document-updated handling (clean reload vs dirty conflict). URL ?doc=&mode=.
 4. Polish: every page has loading skeletons, empty and error states per §5.9; aria labels on icon buttons; reduced-motion respected; no console errors.
 5. README: final "Feature tour" section with the default credentials and what to click.

ACCEPTANCE
  pnpm lint && pnpm build && pnpm test (root, all packages)
  Manual (seed data + running stack):
   - /market?sort=up-and-coming shows Kaiju Smash City first with a green 7d Δ near +68%; sorting by CCU works; the banner says "Seed data" until a live ingest succeeds, then "Live · updated …"
   - /pitches shows both pitches; P1 metrics read exactly "#280", "6.4K", "85%"; Pick this game on P2 creates the game "Bake a Cake Shop", resolves the PICK_NEXT_GAME card on Home, archives P1 and queues an Architect "12-step blueprint" task
   - /library opens "05 UI and HUD" with all three ASCII wireframes aligned, the colour table showing swatches, telemetry showing word/char counts that change as you type, backlinks ≥ 3 and linked agents frame/tester108/reviewer; editing and saving bumps the version, and the file on disk under backend/vault updates within 1 s; editing the .md on disk (e.g. in Obsidian) updates the open preview
   - full keyboard pass: G then M/P/B navigation, Ctrl+K, Esc everywhere
  Final report must include a feature checklist mapping every bullet of the original specification to the implementing files.
```
