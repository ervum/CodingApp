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

## 7.2 Phase 2 — NestJS Backend & WebSocket Orchestrator
```text
PHASE 2 OF 5 — The complete NestJS backend: auth, all REST endpoints, WebSocket gateway, orchestrator, LLM adapters, tools, market ingestion, vault + disk sync, media.

READ: docs/blueprint/00-overview.md, 01-file-tree.md, 02-schema-and-contracts.md, 04-backend.md (all of it), and 06-seed-data.md §6.1–6.3.

BUILD every backend file in Section 1 not completed in Phase 1:
 1. main.ts, app.module.ts, config (EnvSchema exactly), PrismaModule/Service (PrismaPg adapter).
 2. common/: decorators, JwtAuthGuard (global, @Public), StudioAccessGuard + @StudioRoles, ZodValidationPipe, AllExceptionsFilter (AppError/ZodError/HttpException/Prisma P2002/P2025 mapping), AppError, UrlSignerService, pagination (opaque base64url cursor of {createdAt,id}), bigint serialization.
 3. Auth module with argon2id, access JWT, rotating refresh tokens in httpOnly cookie, reuse detection, ALLOW_REGISTRATION, registration provisioning via provisionStudio.
 4. Every controller/service in the REST tables of Section 4.4 with exact routes, roles, request schemas, response DTOs and the documented semantics (message→task/reply rules, verdict rules incl. FIX_FIRST + mobile-pass gate, pitch pick transaction, human request reply/resolve, builds + 108 Tester auto-passes A/B).
 5. RealtimeModule: StudioGateway (JWT handshake, studio:join, run:subscribe with membership checks, MARKET_ROOM), RealtimeService (only emitter, typed with ServerToClientEvents, debounced broadcastCounts 250 ms).
 6. AgentStatusService using deriveAgentStatus; emits agent:status only on change.
 7. OrchestratorModule exactly per Sections 4.7–4.9 + 4.11: boot recovery, ORCHESTRATOR_AUTOSTART, tick with the claim SQL (FOR UPDATE SKIP LOCKED), dependency propagation, pause/resume/cancel via RunRegistry, RunExecutorService algorithm, LogBuffer (120 ms/512 char chunking, 1 s persistence, activity throttle 1/s), PromptResolverService (STUDIO_PREAMBLE, OUTPUT_CONTRACT, context/task/history messages), VaultContextService (priority sources, token budget, H2-section truncation, RunVaultInjection rows), ToolRegistryService + all 15 tool handlers.
 8. LlmModule: connections CRUD with SecretBoxService, test + list models, LlmAdapterFactory, OpenAiCompatibleAdapter / AnthropicAdapter / GoogleAdapter exactly per the mapping table in 4.10 (streaming, tool-call accumulation, usage, finish mapping, error mapping, pre-stream retries), image adapters with sharp normalisation.
 9. MarketModule: RobloxClient (timeout, UA, token bucket, retries honouring Retry-After), loose zod schemas, MarketIngestionService algorithm (single-flight, drift warnings, top-rated fallback, batching of 50, retention), dynamic cron + boot run, MarketService leaderboard/history with SQL daily averages and the pure metric functions.
10. VaultModule: tree, documents CRUD with optimistic concurrency (409 VERSION_CONFLICT with details), revisions, links/backlinks reindex, pg_trgm search with snippets, VaultDiskSyncService (atomic export, boot reconciliation, chokidar watch with self-write suppression, ignore rules).
11. MediaModule (store/probe/sign/stream), LanesModule, SearchModule, HealthModule.
12. Tests: all unit specs in Section 4.16 and the five e2e specs, with test-support/scripted-llm.adapter.ts used ONLY in tests. Add vitest.e2e.config.ts using DATABASE_URL from .env.test (robdev_test database).

ACCEPTANCE
  pnpm --filter @robdev/backend lint
  pnpm --filter @robdev/backend build
  pnpm --filter @robdev/backend test
  pnpm --filter @robdev/backend test:e2e
  pnpm db:reset (re-seeds) then start the API (pnpm --filter @robdev/backend start:dev) and verify with curl/httpie:
    POST /api/auth/login (seed operator) → 200 with accessToken + Set-Cookie rd_refresh
    GET /api/studios/{id}/snapshot → counts.needsYou=4, counts.review.toReview=6, 15 agents (OFFLINE when no SEED_LLM_* set), 2 games with progressPct 80 and 50
    GET /api/market/leaderboard?sort=up-and-coming → rows (source SEED until live ingest succeeds; LIVE afterwards, or a FAILED run recorded with a clear errorCode if Roblox is unreachable — the server must not crash)
    PUT a vault doc with a stale baseVersion → 409 VERSION_CONFLICT
    backend/vault/inclined-games/05 UI and HUD/05 UI and HUD.md exists after boot (disk export)
  If an API key is available: create a connection via the API, bind 'reviewer' to a model from /models, POST /lead/ask, and observe agent:status + agent:log-chunk events with a socket.io client script (scripts/ws-smoke.ts, dev-only, documented in README).
OUT OF SCOPE: frontend.
```
