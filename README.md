# RobDev Control Room

Multi-agent AI Roblox game-development studio dashboard, market intelligence terminal, human-in-the-loop review queue, and Obsidian Markdown Knowledge Vault orchestrator.

---

## Prerequisites

- **Node.js**: `>= 24.15.0` (or `^22.22.3` for Angular 22 compatibility; `.nvmrc` specifies `24`)
- **pnpm**: `10.18.x` (`corepack enable && corepack prepare pnpm@10.18.2 --activate`)
- **Docker**: Docker Desktop / Docker Compose (runs PostgreSQL 17 on host port `5433` so it never collides with a local PostgreSQL instance on `5432`)

---

## Quick Start

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Start PostgreSQL 17 (port `5433`)**
   ```bash
   pnpm db:up
   ```

3. **Configure backend environment**
   ```bash
   cp backend/.env.example backend/.env
   ```
   Generate a 32-byte base64 master key for `SECRETS_MASTER_KEY` and set it in `backend/.env`:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

4. **Build shared contracts, run migrations, and seed the database**
   ```bash
   pnpm build:shared
   pnpm db:migrate
   pnpm db:seed
   ```

5. **Start the development stack**
   ```bash
   pnpm dev
   ```
   - Frontend: `http://localhost:4200`
   - Backend API & WebSocket Gateway: `http://localhost:3000`

---

## Default Seed Login Credentials

| Role | Email | Password | Studio |
|---|---|---|---|
| **OWNER** | `operator@robdev.local` | `robdev-dev-2026!` | Inclined Games studio (`inclined-games`) & Sandbox studio (`sandbox`) |
| **PRODUCER** | `producer@robdev.local` | `robdev-dev-2026!` | Inclined Games studio (`inclined-games`) |

---

## Feature Tour (What to Click)

1. **Sign In & Persistent Studio Shell**
   - Sign in at `http://localhost:4200/login` using `operator@robdev.local` / `robdev-dev-2026!`.
   - Use the **left sidebar** studio switcher (`robdev / Inclined Games studio`), inspect the **4×4 Agent Avatar Matrix** (15 specialist agents + Team tile with glowing status dots), and check the bottom execution widget (`2 agents working · Playtest has Studio`).
   - Use the **top context bar** to filter all views by game (`All games`, `Anime Awakening RNG`, `Dig Up a Dino`), or press `Ctrl+K` (`⌘K` on macOS) to open the **Command Palette**.
   - Try global navigation chords (when not typing in an input): `G` then `H` (Home), `L` (Lead), `T` (Team), `R` (Review), `P` (Pitches), `M` (Market), or `B` (Library).

2. **`/home` — Command Center**
   - View the time-aware greeting header and live status pills (`4 need you`, `2 working`, `0 queued`).
   - In the **Needs you** column, click **Choose a pitch** on the `PICK THE NEXT GAME` card, or reply/resolve `TRY IT` playtest verification cards (`v404` & `v1467`).
   - In the **Live now & Where each game is** column, inspect streaming agent tasks, milestone progress bars, Studio lane assignments (`Lane A · Playtest`), and click **Play the newest build**.

3. **`/team` & `/lead` — 15-Agent Execution Console**
   - Select any of the 15 agents (`Lead`, `Pulse`, `Architect`, `Builder`, `Frame`, `Scenic`, `Balance`, `Librarian`, `Splash`, `Producer`, `Liveops`, `Merchant`, `Playtest`, `108 Tester`, `Reviewer`).
   - Switch between runs using the horizontal `RunPicker`, inspect injected Knowledge Vault context chips, expand `TOOL_CALL` / `TOOL_RESULT` payloads, view syntax-highlighted Luau code and ASCII UI wireframes, and message the agent from the bottom chat bar.

4. **`/review` — Human-in-the-Loop Approval Queue & Inspection Drawer**
   - Toggle between **Images & video** and **Stages & publish**, and filter by `To review`, `Changes asked`, `Approved`, `Rejected`, or `Everything`.
   - Click any card to open the **Slide-out Right Inspection Drawer** showing asset metadata (`Made by Splash · 512×512 · 399 KB`), the **"HOW IT READS SMALL"** preview strip (`512px`, `150px`, `64px`), and keyboard-bound verdict actions (`Approve [A]`, `Ask for changes [C]`, `Reject [X]`, and `J`/`K` to step through items).
   - Switch to **Stages & publish** and inspect a stage gate with `FIX FIRST` blockers — notice `Approve [A]` is disabled with tooltip *"Resolve FIX FIRST blockers first"* until blockers are resolved or waived.

5. **`/market` — Roblox Market Intelligence Terminal**
   - Switch discovery sorts (`Top earning`, `Top playing now`, `Up and coming`, `Top rated`) or jump directly to `/s/inclined-games/market?sort=up-and-coming` to see *Kaiju Smash City* at `#1` with a `+68%` 7d Δ.
   - Sort client-side by clicking any column header (`#`, `Game`, `Genre`, `CCU`, `7d Δ`, `Likes`, `Visits`, `Favorites`), filter by genre or search query, and click **Refresh** to trigger live Roblox chart ingestion.

6. **`/pitches` — Pulse Concept Pitches**
   - Inspect *"What If The Sky Falls"* (`TOP-EARNING RANK #280`, `6.4K PLAYING`, `85% LIKES`) and *"Bake a Cake Shop"*, including `WHAT CHANGED` and `HOW WE'RE DIFFERENT` callout banners, clickable comparable chips (deep-linking to `/market?q=…`), and the 6 breakdown accordions (`First 60 seconds`, `5-minute loop`, `Minutes 10-30`, `Monetization`, `Competitors`, `Risks`).
   - Click **Pick this game** (or **Edit & approve**) to promote a pitch into a studio game, resolve the `PICK_NEXT_GAME` card on Home, and automatically queue an `Architect` 12-step blueprint task.

7. **`/library` — 3-Pane Obsidian Knowledge Vault IDE**
   - Browse folders `00`–`13` (`00 For Any AI`, `05 UI and HUD`, etc.) and open `05 UI and HUD` to inspect the PC (`1920×1080`) and Mobile Landscape (`844×390 notched / 800×360 short`) ASCII wireframes and inline `rgb(R, G, B)` color swatches (`Green (68, 214, 72)`, `Red (235, 82, 82)`, `Gold (255, 206, 68)`).
   - Switch between `View`, `Split`, and `Edit` modes, type in the editor to watch the bottom **Telemetry Bar** update live word/character counts, inspect the **backlinks popover** and linked agent chips (`frame`, `tester108`, `reviewer`), and press `Ctrl+S` (or wait 2s for autosave) — changes sync bidirectionally with `backend/vault/inclined-games/` on disk.

---

## Workspace Scripts

| Script | Description |
|---|---|
| `pnpm build:shared` | Compile `@robdev/shared` DTOs, enums, Zod schemas, and utilities |
| `pnpm dev` | Build `@robdev/shared` and start shared watch, NestJS API (`:3000`), and Angular dev server (`:4200`) |
| `pnpm build` | Production build across `@robdev/shared`, `@robdev/backend`, and `@robdev/frontend` |
| `pnpm test` | Run unit tests across all workspace packages |
| `pnpm lint` | Run ESLint and `tsc --noEmit` across all workspace packages |
| `pnpm db:up` | Start the `robdev-postgres` container on `localhost:5433` |
| `pnpm db:migrate` | Apply Prisma migrations (`prisma migrate dev`) |
| `pnpm db:seed` | Run the deterministic, idempotent studio & vault seed (`prisma db seed`) |
| `pnpm db:reset` | Reset database and re-run migrations + seed (`prisma migrate reset --force`) |

---

## Troubleshooting

- **Port `5432` vs `5433`**: `docker-compose.yml` maps PostgreSQL 17 to `localhost:5433` to avoid colliding with a host PostgreSQL installation. Verify `DATABASE_URL` in `backend/.env` uses port `5433`.
- **Agents showing `OFFLINE` (No API Tokens Needed)**: By default, no paid API keys are required. Open **Settings → Models** in the UI (`http://localhost:4200/s/inclined-games/settings`) to configure any of the **Zero-Token / Self-Hosted AI options** or standard cloud providers:
  1. **Google AI Web Session (`GOOGLE_WEB` — No API Key)**: Uses your active Google / Gemini Advanced subscription directly via a persistent Chrome/Edge browser profile (`gemini.google.com/app` or `aistudio.google.com/prompts/new_chat`). Create a `GOOGLE_WEB` connection and click **Sign in with Browser** on the connection card to log in once.
  2. **Local AI (`OLLAMA` / LM Studio / llama.cpp / vLLM — No API Key)**: Click **Scan Local Ports** in the Add Connection dialog to auto-detect running servers (`:11434`, `:1234`, `:8080`, `:8000`, `:5001`), or click **Pull Model** on an Ollama card to download models like `qwen2.5-coder:7b`. Includes an automatic `<tool_call>` prompt bridge so local models without native OpenAI `tools` support can execute all 15 RobDev agent tools.
  3. **RunPod / Cloud GPU (`RUNPOD`)**: Connect to a self-hosted open-weights LLM running on a RunPod GPU Pod (`https://<podId>-8000.proxy.runpod.net/v1`) or RunPod Serverless vLLM endpoint (`https://api.runpod.ai/v2/<endpointId>/openai/v1`), with one-click **Start Pod** / **Stop Pod** controls right on the connection card.
  4. **Standard API Key Providers**: `OPENAI`, `ANTHROPIC`, `GOOGLE_GEMINI`, `XAI`, or `OPENAI_COMPATIBLE`.
- **Unexpected token spend on boot**: Interrupted `RUNNING` tasks are re-queued on server startup. Set `ORCHESTRATOR_AUTOSTART=false` in `backend/.env` if you want the studio to boot in `PAUSED` mode.
