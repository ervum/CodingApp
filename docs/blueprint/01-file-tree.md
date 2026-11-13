# Section 1 — Monorepo File Tree

Conventions:
- **Package names:** `@robdev/shared`, `@robdev/backend`, `@robdev/frontend`.
- **Backend is ESM** (`"type": "module"`, `module: "nodenext"`). Every relative import **must end in `.js`** (e.g. `import { X } from './x.service.js'`).
- **Angular files** use the `name.component.ts` / `.html` / `.scss` triplet. Every component is standalone with `ChangeDetectionStrategy.OnPush`.
- **Files marked `(gen)`** are generated and git-ignored.

```text
robdev-control-room/
├── .editorconfig
├── .gitignore
├── .nvmrc                                  # "24"
├── .prettierrc.json
├── docker-compose.yml                      # postgres:17-alpine on 5433, volume rd_pg
├── package.json                            # root scripts (dev/build/test/lint/db:*)
├── pnpm-workspace.yaml                     # packages: shared, backend, frontend
├── tsconfig.base.json                      # strict base shared by all packages
├── README.md
├── docs/
│   └── blueprint/
│       ├── 00-overview.md
│       ├── 01-file-tree.md
│       ├── 02-schema-and-contracts.md
│       ├── 03-scss-design-system.md
│       ├── 04-backend.md
│       ├── 05-frontend.md
│       ├── 06-seed-data.md
│       └── 07-phase-prompts/
│           ├── phase-1-workspace-shared-prisma.md
│           ├── phase-2-backend-orchestrator.md
│           ├── phase-3-design-system-shell-store.md
│           ├── phase-4-home-team-review.md
│           └── phase-5-market-pitches-library.md
│
├── shared/
│   ├── package.json                        # name @robdev/shared, type module, exports ./dist
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── index.ts                        # barrel: re-exports every module below
│       ├── enums.ts                        # const-object enums + union types (mirror Prisma)
│       ├── agents/
│       │   ├── agent-roster.ts             # AGENT_ROSTER: key, name, title, color, glyph, order
│       │   └── agent-tools.ts              # AGENT_TOOL_DEFINITIONS (zod args + labels + descriptions)
│       ├── dto/
│       │   ├── common.dto.ts               # Id, IsoDate, Paginated<T>, ApiErrorBody, ErrorCode
│       │   ├── auth.dto.ts
│       │   ├── studio.dto.ts
│       │   ├── game.dto.ts
│       │   ├── agent.dto.ts
│       │   ├── task.dto.ts
│       │   ├── run.dto.ts
│       │   ├── human-request.dto.ts
│       │   ├── review.dto.ts
│       │   ├── pitch.dto.ts
│       │   ├── market.dto.ts
│       │   ├── vault.dto.ts
│       │   ├── llm.dto.ts
│       │   ├── lane.dto.ts
│       │   └── search.dto.ts
│       ├── schemas/                        # zod request schemas (single source for FE forms + BE pipes)
│       │   ├── auth.schema.ts
│       │   ├── studio.schema.ts
│       │   ├── game.schema.ts
│       │   ├── agent.schema.ts
│       │   ├── task.schema.ts
│       │   ├── human-request.schema.ts
│       │   ├── review.schema.ts
│       │   ├── pitch.schema.ts
│       │   ├── market.schema.ts
│       │   ├── vault.schema.ts
│       │   └── llm.schema.ts
│       ├── realtime/
│       │   └── events.ts                   # ServerToClientEvents / ClientToServerEvents / payloads
│       ├── vault/
│       │   └── vault-structure.ts          # VAULT_FOLDERS canonical list (00–13 + extras)
│       └── utils/
│           ├── text-stats.ts               # countWords(), countChars(), estimateTokens()
│           ├── text-stats.spec.ts
│           ├── wikilinks.ts                # parseWikilinks(), normalizeVaultPath()
│           └── wikilinks.spec.ts
│
├── backend/
│   ├── package.json                        # type module
│   ├── nest-cli.json
│   ├── prisma.config.ts                    # Prisma 7 config: schema path, datasource url, seed cmd
│   ├── tsconfig.json
│   ├── tsconfig.build.json
│   ├── vitest.config.ts                    # unplugin-swc for decorator metadata
│   ├── eslint.config.mjs
│   ├── .env.example
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/                     (gen by `prisma migrate dev --name init`)
│   │   ├── seed.ts                         # orchestrates seed modules in order
│   │   └── seed/
│   │       ├── prng.ts                     # mulberry32 deterministic PRNG
│   │       ├── ids.ts                      # stable seed id helpers
│   │       ├── users.seed.ts
│   │       ├── studios.seed.ts
│   │       ├── llm.seed.ts                 # creates encrypted connections from env keys (optional)
│   │       ├── agents.seed.ts              # 15 agents + personas + tools + vault bindings
│   │       ├── agent-personas.ts           # SYSTEM PROMPTS (exact text, Section 6)
│   │       ├── games.seed.ts               # 2 games, milestones, builds, lanes
│   │       ├── tasks.seed.ts               # tasks, deps, runs, log entries, artifacts, messages
│   │       ├── seed-logs.ts                # exact log-entry content (Luau, ASCII, delegation)
│   │       ├── human-requests.seed.ts
│   │       ├── media.seed.ts               # renders PNGs via sharp from SVG templates
│   │       ├── svg-templates.ts            # deterministic SVG art for icons/thumbnails
│   │       ├── review.seed.ts              # review items, verdicts, blockers
│   │       ├── pitches.seed.ts
│   │       ├── market.seed.ts              # 24 market games, 8 days of snapshots, sort entries
│   │       ├── vault.seed.ts               # reads ./vault/** markdown, folders, links, bindings
│   │       └── vault/                      # seed Markdown (exact text, Section 6)
│   │           ├── 00 For Any AI/00 For Any AI.md
│   │           ├── 00 Start Here/00 Start Here.md
│   │           ├── 01 The First Five Minutes/01 The First Five Minutes.md
│   │           ├── 02 The Core Loop/02 The Core Loop.md
│   │           ├── 03 Rarity and RNG/03 Rarity and RNG.md
│   │           ├── 04 Progression and Economy/04 Progression and Economy.md
│   │           ├── 05 UI and HUD/05 UI and HUD.md
│   │           ├── 06 World and Look/06 World and Look.md
│   │           ├── 07 Characters, VFX and Assets/07 Characters, VFX and Assets.md
│   │           ├── 08 Mobile/08 Mobile.md
│   │           ├── 09 Shops and Monetisation/09 Shops and Monetisation.md
│   │           ├── 10 Retention and Social/10 Retention and Social.md
│   │           ├── 11 Thumbnails, Icons and the Store Page/11 Thumbnails, Icons and the Store Page.md
│   │           ├── 12 Live Ops and Launch/12 Live Ops and Launch.md
│   │           ├── 13 Building It Right/13 Building It Right.md
│   │           ├── Claude Design prompts/Claude Design prompts.md
│   │           ├── Our assets/Our assets.md
│   │           └── Skills/Skills.md
│   ├── storage/                            (gen, git-ignored) media/<studioId>/<mediaId>.<ext>
│   ├── vault/                              (gen, git-ignored) <studioSlug>/<folder>/<doc>.md disk mirror
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.module.ts
│   │   ├── generated/prisma/               (gen) Prisma 7 client output
│   │   ├── config/
│   │   │   ├── env.schema.ts               # zod schema for process.env
│   │   │   └── app-config.service.ts       # typed getters over ConfigService
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts            # @Global
│   │   │   └── prisma.service.ts           # PrismaClient + PrismaPg adapter, lifecycle hooks
│   │   ├── common/
│   │   │   ├── decorators/
│   │   │   │   ├── public.decorator.ts
│   │   │   │   ├── current-user.decorator.ts
│   │   │   │   ├── studio-roles.decorator.ts
│   │   │   │   └── studio-context.decorator.ts
│   │   │   ├── guards/
│   │   │   │   ├── jwt-auth.guard.ts       # global APP_GUARD; honours @Public()
│   │   │   │   └── studio-access.guard.ts  # membership + role check for :studioId routes
│   │   │   ├── pipes/zod-validation.pipe.ts
│   │   │   ├── filters/all-exceptions.filter.ts
│   │   │   ├── errors/app-error.ts         # AppError(code, status, message, details)
│   │   │   ├── crypto/secret-box.service.ts  # AES-256-GCM for API keys
│   │   │   ├── crypto/url-signer.service.ts  # HMAC-signed media URLs
│   │   │   ├── http/pagination.ts          # cursor helpers
│   │   │   └── serialization/bigint.ts     # BigInt → string mappers
│   │   ├── modules/
│   │   │   ├── health/health.controller.ts
│   │   │   ├── auth/
│   │   │   │   ├── auth.module.ts
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   ├── password.service.ts
│   │   │   │   └── token.service.ts        # access JWT + rotating refresh tokens
│   │   │   ├── studios/
│   │   │   │   ├── studios.module.ts
│   │   │   │   ├── studios.controller.ts
│   │   │   │   ├── studios.service.ts
│   │   │   │   ├── snapshot.service.ts     # builds StudioSnapshotDto
│   │   │   │   ├── members.controller.ts
│   │   │   │   └── members.service.ts
│   │   │   ├── games/
│   │   │   │   ├── games.module.ts
│   │   │   │   ├── games.controller.ts
│   │   │   │   ├── games.service.ts
│   │   │   │   └── builds.service.ts       # build recording + 108 Tester auto-passes
│   │   │   ├── agents/
│   │   │   │   ├── agents.module.ts
│   │   │   │   ├── agents.controller.ts
│   │   │   │   ├── agents.service.ts
│   │   │   │   ├── agent-status.service.ts # derived status recompute + broadcast
│   │   │   │   └── agent-messages.service.ts
│   │   │   ├── tasks/
│   │   │   │   ├── tasks.module.ts
│   │   │   │   ├── tasks.controller.ts
│   │   │   │   ├── tasks.service.ts
│   │   │   │   └── lead.controller.ts      # POST /lead/ask
│   │   │   ├── orchestrator/
│   │   │   │   ├── orchestrator.module.ts
│   │   │   │   ├── orchestrator.service.ts     # scheduler tick, claim, recovery, pause
│   │   │   │   ├── run-executor.service.ts     # one run: prompt → stream → tools → finish
│   │   │   │   ├── run-registry.service.ts     # in-memory AbortControllers per run
│   │   │   │   ├── prompt-resolver.service.ts  # assembles system + vault + context messages
│   │   │   │   ├── vault-context.service.ts    # selects + budgets VaultDocuments
│   │   │   │   ├── log-buffer.ts               # batches text deltas → DB + WS
│   │   │   │   ├── run-errors.ts
│   │   │   │   └── tools/
│   │   │   │       ├── tool-registry.service.ts
│   │   │   │       ├── tool-context.ts
│   │   │   │       ├── vault-search.tool.ts
│   │   │   │       ├── vault-read.tool.ts
│   │   │   │       ├── vault-update-document.tool.ts
│   │   │   │       ├── delegate-task.tool.ts
│   │   │   │       ├── request-human.tool.ts
│   │   │   │       ├── save-artifact.tool.ts
│   │   │   │       ├── market-query.tool.ts
│   │   │   │       ├── create-pitch.tool.ts
│   │   │   │       ├── generate-image.tool.ts
│   │   │   │       ├── submit-for-review.tool.ts
│   │   │   │       ├── flag-blocker.tool.ts
│   │   │   │       ├── studio-lane.tools.ts     # acquire + release
│   │   │   │       ├── record-build.tool.ts
│   │   │   │       └── update-milestone.tool.ts
│   │   │   ├── llm/
│   │   │   │   ├── llm.module.ts
│   │   │   │   ├── llm-connections.controller.ts
│   │   │   │   ├── llm-connections.service.ts
│   │   │   │   ├── llm-adapter.factory.ts
│   │   │   │   ├── provider-defaults.ts       # default base URLs per provider
│   │   │   │   ├── llm-errors.ts              # normalise provider errors → ErrorCode
│   │   │   │   ├── adapters/
│   │   │   │   │   ├── llm-adapter.interface.ts
│   │   │   │   │   ├── openai-compatible.adapter.ts  # OpenAI, xAI, Ollama, OpenAI-compatible
│   │   │   │   │   ├── anthropic.adapter.ts
│   │   │   │   │   └── google.adapter.ts
│   │   │   │   └── image/
│   │   │   │       ├── image-adapter.interface.ts
│   │   │   │       ├── openai-images.adapter.ts      # OpenAI + xAI (images.generate)
│   │   │   │       └── google-images.adapter.ts
│   │   │   ├── human-requests/
│   │   │   │   ├── human-requests.module.ts
│   │   │   │   ├── human-requests.controller.ts
│   │   │   │   └── human-requests.service.ts
│   │   │   ├── review/
│   │   │   │   ├── review.module.ts
│   │   │   │   ├── review.controller.ts
│   │   │   │   ├── review.service.ts
│   │   │   │   └── blockers.service.ts
│   │   │   ├── media/
│   │   │   │   ├── media.module.ts
│   │   │   │   ├── media.controller.ts        # GET /media/:id?exp&sig
│   │   │   │   └── media.service.ts           # store, probe (sharp), sign
│   │   │   ├── pitches/
│   │   │   │   ├── pitches.module.ts
│   │   │   │   ├── pitches.controller.ts
│   │   │   │   └── pitches.service.ts
│   │   │   ├── market/
│   │   │   │   ├── market.module.ts
│   │   │   │   ├── market.controller.ts
│   │   │   │   ├── market.service.ts          # leaderboard queries + metrics
│   │   │   │   ├── market-ingestion.service.ts
│   │   │   │   ├── market-metrics.ts          # delta7d, likeRatio, sparkline (pure fns)
│   │   │   │   ├── market-metrics.spec.ts
│   │   │   │   └── roblox/
│   │   │   │       ├── roblox-client.ts       # fetch wrapper: timeout, retry, UA, limiter
│   │   │   │       ├── roblox-schemas.ts      # loose zod schemas for responses
│   │   │   │       ├── roblox-schemas.spec.ts
│   │   │   │       ├── rate-limiter.ts        # token bucket
│   │   │   │       └── fixtures/              # recorded sample payloads for tests
│   │   │   │           ├── get-sorts.json
│   │   │   │           ├── get-sort-content.json
│   │   │   │           ├── games.json
│   │   │   │           └── votes.json
│   │   │   ├── vault/
│   │   │   │   ├── vault.module.ts
│   │   │   │   ├── vault.controller.ts
│   │   │   │   ├── vault.service.ts
│   │   │   │   ├── vault-links.service.ts
│   │   │   │   ├── vault-search.service.ts
│   │   │   │   └── vault-disk-sync.service.ts
│   │   │   ├── lanes/
│   │   │   │   ├── lanes.module.ts
│   │   │   │   ├── lanes.controller.ts
│   │   │   │   └── lanes.service.ts
│   │   │   ├── search/
│   │   │   │   ├── search.module.ts
│   │   │   │   ├── search.controller.ts
│   │   │   │   └── search.service.ts
│   │   │   └── realtime/
│   │   │       ├── realtime.module.ts         # @Global
│   │   │       ├── studio.gateway.ts
│   │   │       ├── realtime.service.ts        # typed emit helpers used by all services
│   │   │       └── ws-auth.ts
│   │   └── test-support/
│   │       └── scripted-llm.adapter.ts        # TEST-ONLY deterministic adapter (never wired in prod)
│   └── test/
│       ├── setup-e2e.ts
│       ├── auth.e2e-spec.ts
│       ├── snapshot.e2e-spec.ts
│       ├── orchestrator.e2e-spec.ts
│       ├── review.e2e-spec.ts
│       └── vault.e2e-spec.ts
│
└── frontend/
    ├── package.json
    ├── angular.json
    ├── proxy.conf.json                       # /api + /socket.io → http://localhost:3000
    ├── tsconfig.json
    ├── tsconfig.app.json
    ├── tsconfig.spec.json
    └── src/
        ├── index.html
        ├── main.ts
        ├── styles.scss                        # global entry: tokens emit, reset, typography, layout…
        ├── environments/
        │   ├── environment.ts
        │   └── environment.development.ts
        ├── styles/
        │   ├── _rd.scss                       # @forward tokens + mixins — the ONLY module components @use
        │   ├── _tokens.scss
        │   ├── _mixins.scss
        │   ├── _reset.scss
        │   ├── _typography.scss
        │   ├── _layout.scss
        │   ├── _animations.scss
        │   ├── _controls.scss                 # .rd-btn, .rd-input, .rd-select, .rd-textarea, .rd-kbd
        │   └── _markdown.scss                 # .rd-prose (vault + logs), code, ascii, tables
        └── app/
            ├── app.component.ts               # <router-outlet/> + <rd-toast-host/>
            ├── app.config.ts
            ├── app.routes.ts
            ├── core/
            │   ├── api/
            │   │   ├── api-paths.ts           # typed URL builders
            │   │   ├── studio-api.service.ts
            │   │   ├── games-api.service.ts
            │   │   ├── agents-api.service.ts
            │   │   ├── tasks-api.service.ts
            │   │   ├── human-requests-api.service.ts
            │   │   ├── review-api.service.ts
            │   │   ├── pitches-api.service.ts
            │   │   ├── market-api.service.ts
            │   │   ├── vault-api.service.ts
            │   │   ├── llm-api.service.ts
            │   │   ├── lanes-api.service.ts
            │   │   └── search-api.service.ts
            │   ├── auth/
            │   │   ├── auth-api.service.ts
            │   │   ├── auth.store.ts
            │   │   ├── auth.interceptor.ts     # bearer + single-flight refresh on 401
            │   │   ├── api-error.interceptor.ts# maps ApiErrorBody → toasts
            │   │   ├── auth.guard.ts
            │   │   └── guest.guard.ts
            │   ├── realtime/
            │   │   └── socket.service.ts
            │   ├── state/
            │   │   ├── studio-store.service.ts
            │   │   ├── studio-store.service.spec.ts
            │   │   └── studio-context.guard.ts # ensures snapshot loaded for :studioSlug
            │   ├── keyboard/hotkeys.service.ts
            │   ├── time/clock.service.ts
            │   └── markdown/
            │       ├── markdown.service.ts
            │       ├── markdown.service.spec.ts
            │       ├── luau-highlighter.ts
            │       └── luau-highlighter.spec.ts
            ├── shared/
            │   ├── ui/
            │   │   ├── icon/icon.component.ts, icons.ts
            │   │   ├── agent-avatar/agent-avatar.component.{ts,html,scss}
            │   │   ├── status-pill/status-pill.component.{ts,scss}
            │   │   ├── count-badge/count-badge.component.{ts,scss}
            │   │   ├── kbd/kbd.component.{ts,scss}
            │   │   ├── tabs/tabs.component.{ts,html,scss}
            │   │   ├── filter-pills/filter-pills.component.{ts,html,scss}
            │   │   ├── accordion/accordion.component.{ts,html,scss}
            │   │   ├── progress-bar/progress-bar.component.{ts,scss}
            │   │   ├── delta/delta.component.{ts,scss}
            │   │   ├── sparkline/sparkline.component.{ts,scss}
            │   │   ├── markdown-view/markdown-view.component.{ts,scss}
            │   │   ├── dialog/dialog.component.{ts,html,scss}   # native <dialog>
            │   │   ├── drawer/drawer.component.{ts,html,scss}
            │   │   ├── empty-state/empty-state.component.{ts,scss}
            │   │   ├── spinner/spinner.component.{ts,scss}
            │   │   └── toast/toast.service.ts, toast-host.component.{ts,html,scss}
            │   ├── pipes/
            │   │   ├── relative-time.pipe.ts
            │   │   ├── compact-number.pipe.ts
            │   │   └── bytes.pipe.ts
            │   └── directives/
            │       ├── autosize.directive.ts
            │       └── tab-indent.directive.ts
            ├── layout/
            │   ├── studio-shell/studio-shell.component.{ts,html,scss}
            │   ├── sidebar/
            │   │   ├── sidebar.component.{ts,html,scss}
            │   │   ├── studio-switcher.component.{ts,html,scss}
            │   │   ├── nav-link.component.{ts,html,scss}
            │   │   ├── agent-matrix.component.{ts,html,scss}
            │   │   └── execution-widget.component.{ts,html,scss}
            │   ├── context-bar/
            │   │   ├── context-bar.component.{ts,html,scss}
            │   │   └── game-filter-tabs.component.{ts,html,scss}
            │   ├── command-palette/command-palette.component.{ts,html,scss}
            │   └── dialogs/
            │       ├── ask-dialog.component.{ts,html,scss}
            │       └── new-task-dialog.component.{ts,html,scss}
            └── features/
                ├── auth/
                │   ├── login.page.{ts,html,scss}
                │   └── register.page.{ts,html,scss}
                ├── home/
                │   ├── home.page.{ts,html,scss}
                │   ├── greeting-header.component.{ts,html,scss}
                │   ├── prompt-bar.component.{ts,html,scss}
                │   ├── needs-you-column.component.{ts,html,scss}
                │   ├── needs-you-card.component.{ts,html,scss}
                │   ├── live-now-panel.component.{ts,html,scss}
                │   ├── game-progress-card.component.{ts,html,scss}
                │   └── setup-banner.component.{ts,html,scss}
                ├── team/
                │   ├── team.page.{ts,html,scss}            # also serves /lead
                │   ├── agent-console.store.ts
                │   ├── agent-list.component.{ts,html,scss}
                │   ├── agent-list-item.component.{ts,html,scss}
                │   ├── agent-console.component.{ts,html,scss}
                │   ├── run-picker.component.{ts,html,scss}
                │   ├── run-log-stream.component.{ts,html,scss}
                │   ├── log-entry.component.{ts,html,scss}
                │   └── agent-chat-bar.component.{ts,html,scss}
                ├── tasks/
                │   ├── tasks.page.{ts,html,scss}
                │   └── task-detail-drawer.component.{ts,html,scss}
                ├── review/
                │   ├── review.page.{ts,html,scss}
                │   ├── review.store.ts
                │   ├── review-grid.component.{ts,html,scss}
                │   ├── review-card.component.{ts,html,scss}
                │   ├── review-drawer.component.{ts,html,scss}
                │   ├── small-preview-strip.component.{ts,html,scss}
                │   └── stage-detail.component.{ts,html,scss}
                ├── games/
                │   ├── games.page.{ts,html,scss}
                │   └── game-detail.page.{ts,html,scss}
                ├── pitches/
                │   ├── pitches.page.{ts,html,scss}
                │   ├── pitches.store.ts
                │   ├── pitch-list-item.component.{ts,html,scss}
                │   ├── pitch-detail.component.{ts,html,scss}
                │   ├── metric-callout.component.{ts,scss}
                │   ├── pitch-banner.component.{ts,scss}
                │   └── pitch-edit-dialog.component.{ts,html,scss}
                ├── market/
                │   ├── market.page.{ts,html,scss}
                │   ├── market.store.ts
                │   ├── market-table.component.{ts,html,scss}
                │   └── ingestion-status.component.{ts,html,scss}
                ├── library/
                │   ├── library.page.{ts,html,scss}
                │   ├── library.store.ts
                │   ├── vault-tree.component.{ts,html,scss}
                │   ├── vault-tree-node.component.{ts,html,scss}
                │   ├── vault-editor.component.{ts,html,scss}
                │   ├── vault-preview.component.{ts,html,scss}
                │   └── telemetry-bar.component.{ts,html,scss}
                └── settings/
                    ├── settings.page.{ts,html,scss}
                    ├── model-connections.component.{ts,html,scss}
                    ├── connection-form-dialog.component.{ts,html,scss}
                    ├── agent-model-bindings.component.{ts,html,scss}
                    └── members.component.{ts,html,scss}
```

> [!NOTE]
> The tree notation `name.component.{ts,html,scss}` means **three files**. Argon must create every file listed; there are no optional files.

### Root workspace files (exact content)

**`pnpm-workspace.yaml`**
```yaml
packages:
  - shared
  - backend
  - frontend
onlyBuiltDependencies:
  - '@node-rs/argon2'
  - '@prisma/engines'
  - prisma
  - sharp
  - esbuild
  - '@swc/core'
```

**`package.json` (root)**
```json
{
  "name": "robdev-control-room",
  "private": true,
  "packageManager": "pnpm@10.18.2",
  "engines": { "node": ">=24.15.0" },
  "scripts": {
    "build:shared": "pnpm --filter @robdev/shared build",
    "dev": "pnpm build:shared && concurrently -k -n shared,api,web -c magenta,blue,green \"pnpm --filter @robdev/shared dev\" \"pnpm --filter @robdev/backend start:dev\" \"pnpm --filter @robdev/frontend start\"",
    "build": "pnpm build:shared && pnpm --filter @robdev/backend build && pnpm --filter @robdev/frontend build",
    "test": "pnpm build:shared && pnpm -r --workspace-concurrency=1 test",
    "lint": "pnpm -r lint",
    "db:up": "docker compose up -d postgres",
    "db:migrate": "pnpm --filter @robdev/backend prisma:migrate",
    "db:seed": "pnpm --filter @robdev/backend prisma:seed",
    "db:reset": "pnpm --filter @robdev/backend prisma:reset"
  },
  "devDependencies": {
    "concurrently": "^10.0.6",
    "prettier": "^3.6.0",
    "typescript": "~6.0.3"
  }
}
```

**`docker-compose.yml`**
```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: robdev-postgres
    environment:
      POSTGRES_USER: robdev
      POSTGRES_PASSWORD: robdev
      POSTGRES_DB: robdev
    ports:
      - "5433:5432"
    volumes:
      - rd_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U robdev -d robdev"]
      interval: 5s
      timeout: 3s
      retries: 20
volumes:
  rd_pg:
```

**`tsconfig.base.json`**
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": false,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

**`shared/package.json`**
```json
{
  "name": "@robdev/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsc -p tsconfig.json --watch --preserveWatchOutput",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "zod": "^4.6.7" },
  "devDependencies": { "typescript": "~6.0.3", "vitest": "^4.0.0" }
}
```

**`shared/tsconfig.json`**
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.spec.ts"]
}
```

**`backend/package.json` (scripts + deps)**
```json
{
  "name": "@robdev/backend",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "prisma generate && nest build",
    "start": "node dist/main.js",
    "start:dev": "prisma generate && nest start --watch",
    "test": "vitest run",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "lint": "eslint \"src/**/*.ts\" && tsc -p tsconfig.json --noEmit",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:seed": "prisma db seed",
    "prisma:reset": "prisma migrate reset --force"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^1.1.0",
    "@google/genai": "^2.30.0",
    "@nestjs/common": "^12.2.0",
    "@nestjs/config": "^12.0.1",
    "@nestjs/core": "^12.2.0",
    "@nestjs/jwt": "^12.0.3",
    "@nestjs/platform-express": "^12.2.0",
    "@nestjs/platform-socket.io": "^12.2.0",
    "@nestjs/schedule": "^12.0.2",
    "@nestjs/throttler": "^6.7.1",
    "@nestjs/websockets": "^12.2.0",
    "@node-rs/argon2": "^2.2.2",
    "@prisma/adapter-pg": "7.10.1",
    "@prisma/client": "7.10.1",
    "@robdev/shared": "workspace:*",
    "chokidar": "^6.0.0",
    "cookie-parser": "^1.4.7",
    "helmet": "^8.3.0",
    "multer": "^2.0.0",
    "openai": "^7.42.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.2",
    "sharp": "^0.35.5",
    "socket.io": "^4.8.4",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@nestjs/cli": "^12.0.10",
    "@nestjs/testing": "^12.2.0",
    "@swc/core": "^1.13.0",
    "@types/cookie-parser": "^1.4.9",
    "@types/express": "^5.0.3",
    "@types/multer": "^2.3.0",
    "@types/node": "^24.0.0",
    "@types/supertest": "^6.0.3",
    "eslint": "^9.36.0",
    "prisma": "7.10.1",
    "supertest": "^7.1.4",
    "tsx": "^4.23.15",
    "typescript": "~6.0.3",
    "typescript-eslint": "^8.44.0",
    "unplugin-swc": "^1.5.7",
    "vitest": "^4.0.0"
  }
}
```

**`backend/tsconfig.json`**
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "rootDir": ".",
    "outDir": "dist",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false,
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "prisma/**/*.ts", "test/**/*.ts", "prisma.config.ts"]
}
```
`tsconfig.build.json` extends it with `"rootDir": "src"`, `"include": ["src/**/*.ts"]`, `"exclude": ["**/*.spec.ts", "src/test-support/**"]`.

**`backend/prisma.config.ts`**
```ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```
(Add `"dotenv": "^17.2.0"` to backend `devDependencies`.)

**`frontend/proxy.conf.json`**
```json
{
  "/api": { "target": "http://localhost:3000", "secure": false, "changeOrigin": true },
  "/socket.io": { "target": "http://localhost:3000", "secure": false, "ws": true, "changeOrigin": true }
}
```

**`frontend/angular.json` (key build options)**
```json
{
  "projects": {
    "robdev": {
      "projectType": "application",
      "root": "",
      "sourceRoot": "src",
      "prefix": "rd",
      "schematics": {
        "@schematics/angular:component": { "style": "scss", "changeDetection": "OnPush" }
      },
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.app.json",
            "inlineStyleLanguage": "scss",
            "styles": [
              "@fontsource-variable/inter/index.css",
              "@fontsource-variable/jetbrains-mono/index.css",
              "src/styles.scss"
            ],
            "stylePreprocessorOptions": { "includePaths": ["src/styles"] }
          },
          "configurations": {
            "production": {
              "budgets": [
                { "type": "initial", "maximumWarning": "900kB", "maximumError": "1.5MB" },
                { "type": "anyComponentStyle", "maximumWarning": "8kB", "maximumError": "16kB" }
              ],
              "outputHashing": "all"
            },
            "development": { "optimization": false, "extractLicenses": false, "sourceMap": true }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "options": { "proxyConfig": "proxy.conf.json", "port": 4200 },
          "configurations": { "development": { "buildTarget": "robdev:build:development" } },
          "defaultConfiguration": "development"
        },
        "test": { "builder": "@angular/build:unit-test", "options": { "tsConfig": "tsconfig.spec.json" } }
      }
    }
  }
}
```
Components import the design system with **`@use 'rd';`** (namespace `rd`). This resolves to `src/styles/_rd.scss` through `includePaths: ["src/styles"]`. The forwarder is deliberately **not** named `styles/_index.scss`: `@use 'styles'` would then resolve to the global entry `src/styles.scss` first (file beats directory index), and components would re-emit every global rule. The compile check caught this.

**`frontend/package.json` (deps)**: `@angular/{core,common,compiler,router,forms,platform-browser}` `^22.2.3`, `@robdev/shared: workspace:*`, `socket.io-client ^4.8.4`, `marked ^18.1.1`, `dompurify ^3.4.17`, `rxjs ^7.8.2`, `tslib`, `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono`; dev: `@angular/build ^22.2.3`, `@angular/cli ^22.2.4`, `@angular/compiler-cli ^22.2.3`, `sass ^1.106.1`, `typescript ~6.0.3`, `vitest ^4`, `jsdom`. Scripts: `start: ng serve`, `build: ng build`, `test: ng test --watch=false`, `lint: tsc -p tsconfig.app.json --noEmit`.

**`backend/.env.example`**
```dotenv
# --- Core ---
NODE_ENV=development
PORT=3000
FRONTEND_ORIGIN=http://localhost:4200
DATABASE_URL=postgresql://robdev:robdev@localhost:5433/robdev?schema=public

# --- Auth ---
JWT_ACCESS_SECRET=change-me-access-secret-min-32-chars-long!!
JWT_ACCESS_TTL_SECONDS=900
REFRESH_TOKEN_TTL_DAYS=14
ALLOW_REGISTRATION=true
COOKIE_SECURE=false

# --- Secrets (AES-256-GCM, base64 of exactly 32 random bytes) ---
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
SECRETS_MASTER_KEY=
MEDIA_URL_SIGNING_SECRET=change-me-media-signing-secret-32+chars

# --- Orchestrator ---
ORCHESTRATOR_AUTOSTART=true
ORCHESTRATOR_TICK_MS=2000
MAX_CONCURRENT_RUNS_PER_STUDIO=4
AGENT_MAX_TOOL_ITERATIONS=12
AGENT_RUN_TIMEOUT_MS=600000
VAULT_TOKEN_BUDGET=24000

# --- Storage ---
MEDIA_STORAGE_ROOT=./storage/media
VAULT_DISK_ROOT=./vault
VAULT_DISK_SYNC=true

# --- Market ingestion ---
MARKET_INGEST_ENABLED=true
MARKET_INGEST_CRON=*/30 * * * *
MARKET_INGEST_ON_BOOT=true
ROBLOX_REQUESTS_PER_SECOND=1
ROBLOX_USER_AGENT=RobDevControlRoom/1.0 (+contact: you@example.com)

# --- Optional provider keys used ONLY by the seed to pre-create encrypted connections ---
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
XAI_API_KEY=
OLLAMA_BASE_URL=
# Optional: bind all 15 agents at seed time. Connection label = one of: OpenAI, Anthropic, Google Gemini, xAI Grok, Ollama (local)
SEED_LLM_CONNECTION=
SEED_LLM_MODEL=
SEED_OPERATOR_EMAIL=operator@robdev.local
SEED_OPERATOR_PASSWORD=robdev-dev-2026!
```
