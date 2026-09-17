# Cruise

Set a lead target and a monthly budget per city. Cruise holds them.

It clones a campaign that already works into a new city — resolving the geo key, the catalogue product set and the creative for that city rather than copying the old one — then watches every city against its target and its budget, and stops the ones that are done.

This is a full working build: real authentication, a real SQLite database, a real rules/scoring engine, and a mock (clearly isolated) Meta Marketing API layer so the product runs end-to-end without live ad spend or real API credentials.

**Data provenance (updated 2026-09-01).** The campaign, ad set, targeting, spend
and result data in this build is pulled from the live Meta account "Used Cars
Sales" (`10153410655459601`, CarDekho) over its trailing 30 days — see
`scripts/real-account-data.ts`. An earlier version of this build shipped with an
invented nine-city dataset; that has been removed. Catalogues and product sets are real too
(`scripts/real-catalogue-data.ts`): the account runs one pan-India vehicles
catalogue, `Catalog_Vehicles-Pan-India-20-July`, with a dynamic product set per
city filtered on `city` — Ahmedabad 1,230 vehicles, Nashik 1,054, Chandigarh 460,
Mohali 412. Those product counts are now the inventory figures for those cities,
so the only city still carrying a generated inventory number is Delhi NCR, which
has no product set because its campaign is a lead form rather than a catalogue
ad.

---

## 1. Quickstart

Requirements: Node.js 18.18+ (20 LTS recommended), npm.

```bash
npm install
cp .env.example .env
npm run setup     # creates the SQLite schema and seeds 9 cities / ~8,800 vehicles / 22 campaigns / 30 days of performance + leads
npm run build
npm start          # production build, http://localhost:3000
```

or for local iteration:

```bash
npm install
cp .env.example .env
npm run setup
npm run dev         # http://localhost:3000
```

To wipe and regenerate demo data at any point: `npm run db:reset`.

> **On a restrictive/corporate network:** `better-sqlite3` ships prebuilt native binaries for all major platforms and does not need to compile anything — but npm's default install step still attempts a `node-gyp rebuild`, which tries to download Node.js headers from `nodejs.org` even though it ends up unused. If `npm install` fails with a header-download/403 error, run `npm install --ignore-scripts` instead — the prebuilt binary loads directly and everything above still works.

### Demo credentials

`npm run db:seed` gives each seeded user a **different random password** and
prints them once, at the end of the run. They are not stored anywhere else and
cannot be looked up later — copy them from the terminal, or reset them from
Settings → Users & Roles.

Before sharing a deployed URL: change those passwords, or delete the seeded
accounts and create real ones. A published credential on an install that can
spend money in a live ad account is the whole ballgame.

| Role | Email | Can do |
|---|---|---|
| Admin | `admin@autocampaign.ai` | Everything: campaigns, budgets, integrations, users, settings |
| Marketing Manager | `manager@autocampaign.ai` | Create/edit campaigns, approve/reject AI recommendations, run inventory imports — no billing/user/integration admin |
| Marketing Manager | `priya.nair@autocampaign.ai` | Same as above (second manager seeded for the Users table demo) |
| Viewer | `viewer@autocampaign.ai` | Read-only: dashboards, reports, copilot |

---

## 2. What's implemented

Scope for this build, per the agreed "Must-Have + AI Copilot + Vehicle-level scoring" depth:

- Auth + role-based access control (Admin / Marketing Manager / Viewer), enforced both in the UI and in every API route.
- Executive dashboard: spend, leads, CPL, CPQL, ROAS, WoW deltas, trend chart, city leaderboard.
- City performance dashboard + per-city detail page (spend, leads, CPL, inventory, WoW comparisons).
- Inventory management: card grid, filters, health scoring (0–100), CSV import flow with validation and price-change/sold detection.
- Vehicle-level performance dashboard with a 0–100 performance score (CTR, CPL, lead rate, inventory age, price positioning).
- 7-step campaign creation wizard with automatic structure recommendation (Dedicated City / Standard City / City Cluster, thresholded at 1,000 / 300 active units) and templated auto-naming.
- Campaign monitoring & control: pause/resume, budget edits, duplicate, drill-in detail page.
- Settings-based classification (`src/lib/engine/classify.ts`): funnel stage, geo and comparability are derived from the ad set's actual targeting spec, never from its name. This is load-bearing — in the live account, "Combined Aud.Catalogue" carries a 90-day site-visitor custom audience and is remarketing, "CHD-Remarketing" carries none and is prospecting, "CHD-Detailed-Audience" is geo-targeted at Nashik, and two distinct ad sets share the name "Nashik-Catalogue - Detailed-Targeting".
- Cost comparison guards: cost-per-result is only ever compared within a cohort of identical result type **and** attribution window. The account mixes three result types (website pixel lead, WhatsApp conversation, lead form) across four attribution windows, so a blended "CPL" is not a number that means anything.
- Rule-based optimization engine, 9 rules: CPL above/below a same-cohort benchmark, sold-vehicle still spending, zero-lead vehicle, low inventory, underfunded winner, geo self-competition, audience exhaustion, and uncontrolled test variables.
- AI recommendation engine layered on the rules ("what happened / why / what to do", impact estimate, one-click apply).
- Smart budget allocation across cities (composite score: CPL efficiency, lead volume, inventory depth, trend — with ±40% swing guardrails) with one-click apply.
- Lead quality / CRM funnel view (Lead → Valid → Qualified → Sale) by city and campaign.
- AI Marketing Copilot chat — deterministic, fully explainable reasoning grounded in the same live metrics as the dashboards (see §5).
- Alerts centre (budget pacing, CPL breach, sold-vehicle spend, low inventory, integration health).
- Reports (daily/weekly/monthly) with an AI-generated written summary, PDF export (print-to-PDF) and Excel/CSV export.
- Settings: account defaults, campaign naming convention, notification channels, user invite/role management.
- Meta integration screen with a mock OAuth-style connect flow, asset selection, and sync — see §4 for going live.

Phase 2/3 items from the original spec (predictive forecasting, creative-level A/B testing automation, multi-platform expansion, native PDF rendering, real-time webhooks) were intentionally left out of this pass and are natural next slices.

---

## 3. Architecture

```
Next.js 14 (App Router) + TypeScript + Tailwind
  ├─ src/app/(app)/...      All authenticated pages (server-gated layout + client pages)
  ├─ src/app/api/...        REST API routes (Next.js route handlers)
  ├─ src/lib/db/            Drizzle ORM schema + client (cities > campaigns > ad sets > daily performance)
  ├─ src/lib/engine/        classify (stage/geo/comparability), scoring, rules, budget, AI copilot/summary
  ├─ scripts/real-account-data.ts   Real campaigns, ad sets and targeting from the live account
  ├─ scripts/verify-model.ts        Reconciles the seed against the API totals and prints what the rules fire
  ├─ src/lib/meta/          Meta integration: mock.ts (default) / client.ts (live) / index.ts (router)
  ├─ src/lib/queries.ts     Central metric aggregation (city/vehicle/campaign, WoW windows)
  └─ scripts/seed.ts        Demo data generator
```

**Why Drizzle + SQLite instead of Prisma + Postgres for this build:** the schema, query layer, and engine were designed against Postgres-flavoured relational modeling from day one — the swap in §6 is intentionally small. Drizzle was chosen for this delivery because it needed zero binary downloads to run (no engine/query-engine fetch step), which made it the reliable choice for a self-contained, offline-friendly demo package. The schema (`src/lib/db/schema.ts`) uses only types and patterns that map 1:1 onto Postgres.

**Why there is an ad set layer.** Delivery settings live on the ad set, not the
campaign, so a model that stops at campaign level cannot tell prospecting from
remarketing, cannot see that two live ad sets are bidding for the same city, and
cannot know which costs are comparable. The previous model inferred all of this
from campaign names and was wrong on the account's two largest spenders.

**"AI" in this build** is a deterministic, explainable rules-and-scoring engine (see `src/lib/engine/`), not a live LLM call — it was built to produce the exact style of reasoning an LLM-backed system would ("what happened → why → what to do"), grounded entirely in real computed metrics, so the UI, API contracts, and demo behavior are stable and reproducible. `src/lib/engine/ai.ts` and `copilot.ts` are the natural insertion points for a real LLM call (e.g. swap the deterministic string-building for a prompted call to Claude, passing the same structured `CityMetrics`/`VehicleMetrics` context that's already assembled) — the hard part (computing correct, current, well-labeled metrics) is already done.

---

## 4. Going live with real Meta APIs

Everything Meta-related is isolated behind `src/lib/meta/index.ts`, which routes to either:

- `src/lib/meta/mock.ts` — deterministic mock data generator (default, `USE_MOCK_META=true` in `.env`)
- `src/lib/meta/client.ts` — stub for the real Meta Marketing API / Catalogue API / Conversions API, currently throwing a clear `NOT_CONFIGURED` error for each method

To go live:

1. Set `USE_MOCK_META=false` and fill in `META_APP_ID`, `META_APP_SECRET`, `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID` in `.env`.
2. Implement each method in `client.ts` against the real Graph API (`getAssets`, `connect`, `sync`, `createCampaign`, `pauseCampaign`, etc. — the method signatures already match what the UI and API routes call, so no call-site changes are needed).
3. Point the Conversions API (CAPI) at your pixel for lead-quality feedback into Meta's optimization.
4. Move the inventory catalogue sync (currently manual CSV import) onto the Meta Catalogue API / product feed for automatic ad-creative generation from live inventory.

---

## 5. Background jobs (for production)

Two engine functions are designed to run on a schedule rather than on-demand:

- `syncRecommendations()` (`src/lib/engine/recommend.ts`) — re-runs the 5-rule engine + AI recommendation generator against current metrics and upserts results using a stable `dedupeKey` (`RULE:<type>:<entityId>` / `AI:<scope>:<entityId>:<title>`), so re-running never duplicates or clobbers a recommendation a user has already approved/rejected.
- `syncAlerts()` (`src/lib/engine/alerts.ts`) — same dedupe pattern for the alerts centre.

In this build both run inline on relevant page/API loads for demo simplicity. In production, wire these into a cron worker (e.g. a 15–30 minute interval job via a queue/worker process, or a serverless scheduled function) alongside the actual Meta data sync, so the dashboards and alerts reflect near-real-time performance without depending on a user having a page open.

---

## 6. Going to production with PostgreSQL

The schema in `src/lib/db/schema.ts` was written to be Postgres-portable (UUID-style string IDs, ISO timestamps, no SQLite-only types). To migrate:

1. `npm install drizzle-orm pg` and `npm uninstall better-sqlite3` (`@types/better-sqlite3` too).
2. Swap `src/lib/db/client.ts` to use `drizzle-orm/node-postgres` (or `postgres-js`) against a `DATABASE_URL` pointing at your Postgres instance.
3. Change `drizzle.config.ts` `dialect` from `"sqlite"` to `"postgresql"`.
4. Run `drizzle-kit generate` + `drizzle-kit migrate` instead of `db:push` for versioned migrations.
5. Re-run `scripts/seed.ts` (it uses Drizzle's query builder, not raw SQLite calls, so it should port with minimal changes — mainly around any SQLite-specific pragmas, which live only in `client.ts`).

---

## 7. Project scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build + serve |
| `npm run db:push` | Push the Drizzle schema to the SQLite file |
| `npm run db:seed` | Seed demo data (idempotent-ish — intended to run once against a fresh DB) |
| `npm run db:reset` | Wipe the DB, push schema, reseed — use this whenever the schema changes or data looks stale |
| `npm run setup` | `db:push` + `db:seed` in one step (first-time setup) |

---

## 8. Verifying the model

`npx tsx scripts/verify-model.ts` (after `npm run setup`) checks the four things
that matter and prints the evidence:

1. Every reconstructed ad set's 30-day spend and result totals equal the API
   figures exactly (current drift: 0.0000 and 0).
2. Each city's cost is reported as a list of comparable segments plus a named
   dominant cohort — never one blended number. Nashik's largest single segment
   is only 24% of its spend, which is precisely why a single Nashik CPL would be
   a fiction.
3. The cohort benchmarks the rules judge against.
4. Which rules fire and on what evidence, plus a name-vs-settings audit showing
   where campaign names disagree with reality.

## 9. Notes on the included interactive preview

Alongside this codebase, a standalone single-file HTML preview is published
separately (no install/build required) — a click-through of the same product
surface, now carrying the same real account data as the app.
