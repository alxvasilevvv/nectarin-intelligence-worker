# Changelog

All notable changes to NECTARIN Intelligence (Cloudflare Workers MCP server).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [2.18.0] — 2026-06-28

Executive composition: a one-call board one-pager that orchestrates two tools (39th tool).

### Added
- **`board_report`** (new **Executive** group) — a one-call executive one-pager that
  ORCHESTRATES `marketing_audit` (health score, channel verdicts, concentration/
  untracked risks, prioritized actions) and `scenario_planner` (a **+15% budget
  upside** scenario), then folds their structured output into a board-ready brief:
  status + grade, headline metrics (spend, conversions, blended CPA, and
  revenue/profit/ROI when `revenuePerConversion` is supplied), best/worst channel,
  live risks, top recommendations, the budget upside and a single next step.
  Composition over duplication — reuses the deterministic sub-tools verbatim. Honors
  optional `company`/`period`/`targetCpa`. 38 → **39 tools**.
- **`exec_report`** guided prompt (**16 prompts** total) — one-click board one-pager
  via `board_report`.

### Changed
- `server.json` description + version, README (Tools badge 39, new Executive group),
  USAGE (catalogue 39, prompts 16), test counts (39 tools / 16 prompts).

## [2.17.0] — 2026-06-28

Trade-marketing economics: a promo/discount break-even & ROI calculator (38th tool).

### Added
- **`promo_planner`** (new **Pricing & Promo** group) — a discount/promo P&L and
  break-even calculator. From regular price, variable unit cost and baseline period
  volume it computes the post-discount unit margin, the **break-even volume uplift**
  a promo must clear to avoid losing money, and — when `expectedUpliftPct` is given —
  projected units/revenue/profit, **incremental profit** vs. baseline and **ROI on the
  markdown**. Optional `promoFixedCost` (creative/media/ops) and a
  `cannibalizationPct` pull-forward penalty. Returns a verdict (`profitable` /
  `needs_more_uplift` / `margin_destroying` / `breakeven_only`). Deterministic;
  operator's own numbers. 37 → **38 tools**.
- **`promo_review`** guided prompt (**15 prompts** total) — one-click promo evaluation
  via `promo_planner` with margin erosion, break-even and ROI explanation.

### Changed
- `server.json` description + version, README (Tools badge 38, new Pricing & Promo
  group), USAGE (catalogue 38, prompts 15), test counts (38 tools / 15 prompts).

## [2.16.0] — 2026-06-28

Boardroom what-if planning: compare candidate budget scenarios head-to-head (37th tool).

### Added
- **`scenario_planner`** (added to the **Planning** group) — a what-if budget
  scenario comparator. Takes current per-channel spend & conversions plus named
  scenarios (conservative / base / aggressive via a `budgetMultiplier` and/or
  absolute per-channel spend `overrides`) and projects each plan's conversions,
  blended CPA, incremental lift vs. today and — when `revenuePerConversion` is
  supplied — revenue, profit, ROAS and ROI%. Each channel uses a constant-elasticity
  diminishing-returns curve `conversions = conv₀·(spend/spend₀)^b` calibrated to its
  own current point (`b` default 0.7, per-channel overridable). **Ranks** scenarios
  by objective (`max_conversions` / `min_cpa` / `max_roi`) and recommends one with a
  rationale + an elasticity-sensitivity note (b=0.5 vs 0.9). Deterministic; uses the
  operator's own numbers, not benchmarks. Complements `mmm_optimize` (fitted optimum)
  and `budget_optimizer` (single-budget allocation) by comparing the operator's OWN
  candidate plans head-to-head. 36 → **37 tools**.
- **`scenario_review`** guided prompt (**14 prompts** total) — one-click scenario
  comparison via `scenario_planner` with a ranking table, recommendation rationale
  and elasticity sensitivity.

### Changed
- `server.json` description + version, README (Tools badge 37, Planning group now 2
  tools), USAGE (catalogue 37, prompts 14), test counts (37 tools / 14 prompts).

## [2.15.0] — 2026-06-28

The premium "AI CMO" diagnostic: a full account health audit (36th tool).

### Added
- **`marketing_audit`** (new **Audit** group) — a senior-operator account health
  audit. Takes current per-channel spend & conversions, scores each channel's CPA
  against RU/CIS benchmarks (p25/p50/p75), flags **concentration risk** and
  **untracked** spend, computes an overall **health score (0-100) + grade A–D**, and
  returns a **prioritized action plan** with a concrete budget reallocation and
  projected extra conversions / saved spend. Optional `targetCpa` vs blended CPA.
  Deterministic; data-aware (respects KV / per-tenant overrides). 35 → **36 tools**.
- **`account_audit`** guided prompt (**13 prompts** total) — one-click account audit
  via `marketing_audit` with an explanation of the score, risks and action plan.

### Changed
- `version` `2.14.0` → `2.15.0`. Suite **93 tests** (tool/prompt counts,
  marketing_audit scoring/verdict/recommendation assertions, account_audit prompt).

## [2.14.0] — 2026-06-28

The senior-strategist planning layer: a phased go-to-market roadmap (35th tool).

### Added
- **`gtm_calendar`** (new **Planning** group) — a phased **Test → Scale → Optimize**
  go-to-market roadmap. Goal-driven phase budget weights and channel emphasis, plus
  a **week-by-week budget pacing curve** that leans spend into high-demand weeks
  using the category's monthly **seasonality index** (`src/data.ts`). Returns
  per-phase objectives/KPIs/exit-criteria, peak/soft **seasonal windows** inside the
  horizon, and milestones. Deterministic; answers *when & in what sequence* (vs.
  `media_plan`/`budget_optimizer` for *where*). 34 → **35 tools**.
- **`quarter_plan`** guided prompt (**12 prompts** total) — one-click phased roadmap
  via `gtm_calendar` with an explanation of phases, weekly pacing and seasonal pikes.

### Changed
- `version` `2.13.0` → `2.14.0`. Suite **91 tests** (tool/prompt counts, gtm_calendar
  phase/pacing/seasonality assertions, quarter_plan interpolation).

## [2.13.0] — 2026-06-28

### Added
- **`mmm_planning`** guided prompt (11 prompts total) — parses per-channel
  spend/conversions series, calls `mmm_optimize`, and explains the adstock decay,
  saturation elasticity, fit R²/confidence and the reallocated split. One-click
  MMM in Claude's prompt UI.

### Changed
- `version` `2.12.0` → `2.13.0`. Suite **89 tests** (prompt count, series interpolation).

## [2.12.0] — 2026-06-28

The senior-marketer headline capability: a real Marketing Mix Model (34th tool).

### Added
- **`mmm_optimize`** — MMM-lite. From each channel's spend & conversions TIME
  SERIES it fits **adstock/carryover** (geometric decay λ, grid-searched by
  log-log fit R²) and **saturation** (`conversions = a·adstock(spend)^b`, least
  squares, 0<b≤1), then computes the conversion-maximizing **steady-state**
  budget split across channels via exact **Lagrange bisection** (marginal CPA
  equalized across funded channels). Returns per-channel decay, carryover
  half-life, saturation elasticity, fit R²/confidence, recommended spend,
  projected steady-state conversions, marginal CPA, and uplift vs. current.
  Uses the operator's REAL series; deterministic; honest low-confidence flags.

### Changed
- Tool count **33 → 34**; `version` `2.11.0` → `2.12.0`. Suite **88 tests**
  (adstock+saturation fit, ROI-aware reallocation, mismatched-series error).

## [2.11.0] — 2026-06-28

### Added
- **`saturation_reallocation`** guided prompt (10 prompts total) — parses
  `name:spend:conversions` channels, calls `response_curve`, explains the
  marginal-CPA-equalized split + uplift, and optionally sanity-checks the
  biggest mover with `pacing_monitor`. Makes the new saturation tool one-click
  in Claude's prompt UI.

### Changed
- `version` `2.10.0` → `2.11.0`. Suite **86 tests** (prompt count, channel/
  elasticity interpolation).

## [2.10.0] — 2026-06-28

A genuinely premium analytical capability: marketing saturation modeling and
budget reallocation across channels (33rd tool).

### Added
- **`response_curve`** — channel saturation / diminishing-returns analysis. Fits
  a constant-elasticity response model `conversions = a·spend^b` (0<b<1) to the
  operator's OWN current per-channel spend/conversions (no fabricated data), then
  computes the conversion-maximizing split for a target budget via the closed
  form `share ∝ a^(1/(1-b))`. Returns recommended spend, projected conversions,
  per-channel marginal CPA (equalized at the optimum), blended-CPA improvement and
  uplift vs. current. Handles linear (b≥1, capped) and no-signal (even split) cases
  with explicit warnings. Fully deterministic.

### Changed
- Tool count **32 → 33**; `version` `2.9.0` → `2.10.0`. Suite **85 tests**
  (efficient-channel reallocation, marginal-CPA equalization, even-split fallback).

## [2.9.0] — 2026-06-28

Argument autocompletion so MCP clients can suggest valid enum values as the user
types a prompt/tool argument.

### Added
- **`completion/complete`** handler + the `completions` capability in
  `initialize`. Completes the shared enum-valued arguments by name —
  `category`, `kpi`, `platform`, `goal` — filtered by a case-insensitive prefix
  (capped at 100). Unknown arguments return an empty list. No PII, no state.

### Changed
- `version` `2.8.0` → `2.9.0`. Suite **83 tests** (capability advertised,
  prefix/empty completion for category/goal/kpi, unknown-arg empty result).

## [2.8.0] — 2026-06-28

MCP polish for premium clients: behavioral tool annotations and a live,
machine-readable catalog resource.

### Added
- **Tool annotations on `tools/list`** (MCP `ToolAnnotations` hints) + a display
  `title` for every tool. Safe defaults (read-only, non-destructive, idempotent,
  closed-world); per-tool overrides flag LLM-backed tools (`creative_variants`,
  `localize`) as non-idempotent/open-world and the funnel `request_nectarin_proposal`
  as not read-only. Titles auto-generated with marketing acronyms upper-cased
  (e.g. `ROI Calculator`, `UTM Builder`).
- **`nectarin://catalog` resource** — a live `application/json` catalog of all
  tools (title, description, input schema, annotations) + built-in prompts,
  generated from the registry on every read so it can never drift.

### Changed
- `version` `2.7.0` → `2.8.0`. Suite **79 tests** (annotation defaults/overrides,
  generated titles, catalog list/read, unknown-uri rejection).

## [2.7.0] — 2026-06-27

Per-tenant data without touching a single tool. Each request can carry its own
tenant context, resolved safely under concurrency.

### Added
- **Per-tenant data layering via `X-Tenant-Id`.** With KV bound, lookups resolve
  **tenant override → global override → bundled mock**. The tenant layer reads
  `tenant:<id>:*` KV keys; `LayeredKvDataSource` gained an optional `keyPrefix`
  and chains to the global layered source as its fallback.
- **Request-scoped data source via `AsyncLocalStorage`** (`runWithDataSource`,
  `node:async_hooks` under `nodejs_compat`). Concurrent requests never share or
  race a process-global source; the module data accessors transparently read the
  active request context, so **no tool/orchestrator code changed**.
- Tenant id validation (`^[A-Za-z0-9._-]{1,64}$`); invalid/absent header or no KV
  ⇒ transparent fallback to the shared data. `/health` + `/version` now report
  `perTenant`.

### Changed
- `version` `2.6.0` → `2.7.0`. Suite **75 tests** (per-tenant resolution order,
  tenant isolation, ALS-scoped accessors, end-to-end header routing).
- Verified on prod: same `ru_benchmarks` call returns the tenant's KV override
  (CPA 77777) with `X-Tenant-Id`, and the shared mock (CPA 560) without it.

## [2.6.0] — 2026-06-27

Hard, strongly-consistent global rate limiting via a Durable Object — the gap
KV (eventually consistent) could not close. Backward-compatible, fail-open.

### Added
- **`RateLimiterDO`** Durable Object (one instance per key owns a token bucket →
  exact counts even under a parallel burst) + **`DurableObjectRateLimiter`**
  worker-side wrapper. Bound via `[[durable_objects.bindings]]` + `[[migrations]]`
  (SQLite class, free-plan compatible).
- Limiter precedence is now **DO → KV → memory**, each **fail-open** to the next.
  Verified on prod: a 120-request parallel burst at 60/min returned
  ~64×200 / ~56×429 (KV admitted all 120 before). `/health` + `/version` report
  the active backend.

### Changed
- `version` `2.5.0` → `2.6.0`. Suite **71 tests** (DO limit enforcement, fail-open,
  DO token-bucket drain).

## [2.5.0] — 2026-06-27

Two orchestration prompts that turn the v2.4 operator/performance tools into
one-click flows in the Claude Connectors UI. Additive, backward-compatible.

### Added
- **`launch_flight`** prompt: media_plan → seasonality_forecast → utm_builder →
  pacing_monitor.
- **`performance_review`** prompt: anomaly_detector → attribution_model →
  bid_simulator → budget_optimizer.

### Changed
- `version` `2.4.0` → `2.5.0`. Prompts 7 → **9**. Tests **68** (prompts/list now 9).

## [2.4.0] — 2026-06-27

Two practical day-to-day operator tools. Deterministic, no data/LLM needed.
Backward-compatible.

### Added
- **`utm_builder`**: build a consistent, validated UTM tracking URL — normalizes
  tokens to a casing convention (lower/snake/kebab/preserve), URL-encodes,
  preserves existing query params, warns on uppercase/spaces/non-ASCII, and
  suggests a campaign naming convention.
- **`pacing_monitor`**: budget pacing vs. an even spend curve — expected spend,
  pace ratio, status (under/on-track/over), projected end spend, remaining
  budget/days and the recommended daily spend to land exactly on budget.

### Changed
- `version` `2.3.0` → `2.4.0`; `toolCount` 30 → **32** (Premium group now 5).
  Suite **68 tests**. Full prod smoke certified 32/32.

## [2.3.0] — 2026-06-27

Production hardening: globally-coordinated rate limiting. Backward-compatible.

### Added
- **`KvRateLimiter`** — KV-backed fixed-window limiter, coordinated across
  isolates (the in-memory limiter only saw one isolate). **FAIL-OPEN**: any KV
  error degrades to a local token bucket, so a KV hiccup can never hard-lock the
  public connector. Installed automatically in `fetch()` when `NECTARIN_KV` is
  bound; otherwise the per-isolate `MemoryRateLimiter` is used.
- `/health` and `/version` now report the active `rateLimiter` backend.

### Changed
- `version` `2.2.0` → `2.3.0`. Suite **64 tests** (limit enforcement, fail-open,
  disabled-limit coverage).

## [2.2.0] — 2026-06-27

Two guided **prompts** that surface the v2.1 Premium tools in the Claude
Connectors UI. Pure additive content. Backward-compatible.

### Added
- **`creative_lab`** prompt: creative_variants → compliance_check → ab_test_planner.
- **`growth_monitor`** prompt: anomaly_detector → cohort_ltv + unit_economics → action.

### Changed
- `version` `2.1.0` → `2.2.0`. Prompts 5 → **7**. Suite **61 tests** (added
  prompts/list + prompts/get coverage).

## [2.1.0] — 2026-06-27

New **Premium** tool group (3 tools) — generate, monitor, project. The KV LLM
cache (2.0) makes the LLM-backed tool here cheap on repeat. Backward-compatible.

### Added
- **`creative_variants`**: generate AND score N ready-to-test ad variants for a
  product × audience × channel. LLM-backed + KV-cached; deterministic template
  fallback without a key. Each variant scored by the `creative_score` heuristic
  (0-100 + grade) with a compliance flag, ranked best-first. Verified on prod
  (best variant 92/A via LLM).
- **`anomaly_detector`**: robust median/MAD z-score anomaly detection over a
  metric time series for always-on monitoring; per-point severity/direction,
  latest-point flag, std fallback for low-variance series. Deterministic.
- **`cohort_ltv`**: retention-curve cohort LTV/NPV projection (explicit curve OR
  churn%+periods), per-period survivors/revenue, LTV:CAC, payback. Deterministic.

### Changed
- `version` `2.0.0` → `2.1.0`; `toolCount` 27 → **30** (new `src/premium.ts`).
- Suite grows to **58 tests**. Smoke script honors `minItems` + adds conditional-
  requirement overrides; full prod smoke **30/30 green**.

## [2.0.0] — 2026-06-27

Production infrastructure milestone. The server now has a real persistence layer
(KV), real‑data layering, a response cache, an opt‑in streaming transport, and a
shipped Claude usage/prompt guide. Fully backward‑compatible — every change is
additive and graceful (absent bindings ⇒ prior behavior).

### Added
- **KV namespace `NECTARIN_KV`** bound in `wrangler.toml` (id provisioned).
- **LLM response cache** in `callLLM()` — keyed by SHA‑256 of
  provider/model/base/system/prompt/context, 24h TTL. Repeat narratives are
  ~50× faster and incur no LLM spend. Verified on prod: cold 9.8s → warm 0.2s,
  identical output. Cache failures are swallowed (never break a tool call).
- **`LayeredKvDataSource`** — operator‑uploaded REAL/override benchmarks,
  playbooks and suppliers (`benchmarks:<category>`, `playbook:<industry>`,
  `suppliers`) layered OVER the bundled synthetic data; missing keys fall back to
  mock. Installed once per isolate, idempotent, concurrency‑safe.
- **Opt‑in SSE transport** on `POST /mcp` (`?stream=1` or `Accept:
  text/event-stream` without `application/json`). Default stays JSON so existing
  clients are unaffected.
- **Observability**: `/health` and `/version` now report KV binding status,
  active data source, and live LLM cache hit/miss/store counters.
- **`USAGE.md`** — connection guide, full 27‑tool catalogue, recommended flows,
  and a ready‑to‑paste Claude system prompt.

### Changed
- `version` `1.6.0` → `2.0.0`. Suite grows to **53 tests** (added KV cache,
  LayeredKvDataSource, and SSE coverage; new `test/cache.test.ts`).

## [1.6.0] — 2026-06-27

Delivery & reach (Phase 3, part 2 — non-infra). Two composable tools that make
output presentation-ready and CIS-multilingual. Backward-compatible.

### Added
- **`report_export`**: turns a strategy/analysis (e.g. `strategy_orchestrate`
  output) into a presentation deck — ordered slides (title + bullets + speaker
  notes), a full Markdown deck, and a condensed one-pager. Optional LLM polish of
  the executive summary. Composable formatter.
- **`localize`**: translate + culturally adapt marketing copy into RU/EN/KZ/UZ
  for CIS markets (LLM-backed; graceful original-text fallback without a key).

### Changed
- `version` `1.5.0` → `1.6.0`; `GET /version` `toolCount` 25 → **27**.
- Premium Analytics group is now **10** tools. Suite now **44 tests**.

## [1.5.0] — 2026-06-27

Performance-marketing depth (Phase 3, part 1 — non-infra). Two self-contained
deterministic tools. Backward-compatible.

### Added
- **`attribution_model`**: multi-touch attribution simulator over conversion
  paths — credits channels under first-touch, last-touch, linear, position-based
  (U 40/20/40) and time-decay, and flags channels under-/over-valued by naive
  last-touch (the key budget-reallocation insight).
- **`bid_simulator`**: auction bid/win-rate trade-off curve from the category's
  benchmark CPC (CPM/CTR) and conversion rate (CPC/CPA); sweeps bid levels and
  recommends the bid that hits a target CPA or maximizes conversions under a daily
  budget. Synthetic logistic auction model, clearly labelled.

### Changed
- `version` `1.4.0` → `1.5.0`; `GET /version` `toolCount` 23 → **25**.
- Premium Analytics group is now **8** tools. Suite now **42 tests**.

## [1.4.0] — 2026-06-27

Coverage upgrade (Phase 2, part 2). Broader RU/CIS surface area — no new tools,
but every tool now reasons over more categories and a major new channel.
Backward-compatible.

### Added
- **2 new categories**: `ecom` (e-commerce/marketplaces) and `edtech` — full
  benchmark matrices (CPM/CTR/CPA/VTR p25/p50/p75 across all platforms), bespoke
  playbooks, seasonality curves, funnel rates, AOV, audience segments/JTBD, and
  competitor pools. Categories: **8** total.
- **New platform `Avito`** (high-intent RU classifieds): benchmarks for realty/
  auto/retail/ecom, two inventory suppliers, and it is automatically considered by
  `budget_optimizer` where present. Platforms: **5** total.

### Changed
- `version` `1.3.0` → `1.4.0`. `media_plan` presets stay on the 4 brand/perf
  channels by design; Avito surfaces via `budget_optimizer` and `ru_benchmarks`.
- Tests for new category + platform — suite now **40 tests**.

## [1.3.0] — 2026-06-27

Depth & transparency upgrade (Phase 2, part 1). Three new analytics tools plus a
data-provenance layer. Backward-compatible.

### Added
- **`funnel_model`**: full-funnel projection (impressions → reach → clicks →
  leads → qualified → sales → revenue) with conservative/base/optimistic
  scenarios from the benchmark spread, per-stage drop-off, CAC/ROAS, and the
  **biggest leak** call-out.
- **`seasonality_forecast`**: 12-month RU/CIS demand index per category, peak/
  trough months, recommended monthly budget weighting, and optional annual-budget
  split by month.
- **`creative_score`**: 0-100 best-practice score for ad copy (value prop,
  specificity, CTA, length, relevance, benefit-focus, no-CAPS) with per-criterion
  fixes, a quick compliance flag, and optional LLM-generated improved variants.
- **Data provenance**: `DATA_META.provenance` (source, methodology, confidence,
  `synthetic` flag) now surfaced in `ru_benchmarks` and `funnel_model` output —
  every number is auditable and honestly labelled.
- Seasonality dataset (`SEASONALITY`) + `getSeasonalityIndex()` accessor.
- Tests for all three new tools — suite now **37 tests**.

### Changed
- `version` `1.2.0` → `1.3.0`; `GET /version` `toolCount` 20 → **23**.

## [1.2.0] — 2026-06-27

Premium analytics upgrade — NECTARIN goes from informing/converting to operating
at a senior level: a RU ad-law reviewer, a rigorous experimentation lead, and a
unit-economics analyst. New `src/analytics.ts` group, all deterministic (with an
optional LLM rewrite for compliance). Backward-compatible.

### Added
- **`compliance_check`**: RU advertising-law review of ad copy. Returns a 0-100
  compliance score, flagged risks with severity + the relevant **ФЗ-38** article +
  a concrete fix. Covers superlatives/ФАС risk, comparative claims, finance (ПСК,
  guaranteed returns — ст. 28), pharma (mandatory warning — ст. 24),
  alcohol/tobacco/gambling hard-blocks, and **ОРД/ЕРИР** marking. With `LLM_API_KEY`
  set it adds extra nuance + a compliant rewrite. Decision-support, not legal advice.
- **`ab_test_planner`**: real two-proportion **power analysis** — sample size per
  variant, total, estimated duration, with exact z-scores via the inverse-normal
  (Acklam) and a **Bonferroni** correction for multi-variant tests. Includes
  guardrails (no peeking, ≥14-day runtime, SRM watch).
- **`unit_economics`**: LTV / LTV:CAC / payback (months) / ROAS / contribution per
  customer, with CAC derivable from spend÷customers and lifespan from churn, a
  health verdict (≥3:1, payback <12mo) and concrete levers.
- Tests: `compliance_check` (rule firing incl. Cyrillic word-boundary regression),
  `ab_test_planner` (sample size/duration), `unit_economics` (derivation + verdict)
  — suite now **34 tests**.

### Changed
- `version` `1.1.0` → `1.2.0`; `GET /version` `toolCount` 17 → **20**.

### Fixed
- Compliance regex no longer relies on `\b`/`\w` for Cyrillic (ASCII-only in JS
  regex), which previously let RU violations pass undetected.

## [1.1.0] — 2026-06-27

Orchestration & intelligence upgrade. Two new tools and a real (optional) LLM,
all backward-compatible — the server still runs offline with zero secrets.

### Added
- **`strategy_orchestrate`** (flagship): a single end-to-end call that fans the
  orchestrator out to every worker and returns a complete go-to-market strategy —
  CPA benchmarks, audience segments/JTBD, competitor landscape, a goal-based media
  plan **with forecast**, a conversion-maximizing **optimized split**, a lead
  creative concept, the compliance gate, a quick ROI framing, and an executive
  summary. Workers fan out in parallel where independent.
- **`budget_optimizer`**: solves the channel allocation that **maximizes
  conversions** for a fixed budget (conversions/RUB = 1/CPA → water-fill the
  lowest-CPA channels first under a per-channel cap, default 45%). Reports the
  optimal allocation, projected conversions/blended CPA, and the **uplift vs. the
  goal-preset split**. This is a real linear optimization, not a preset.
- **Real LLM seam**: `callLLM()` now calls **Anthropic** (default) or **OpenAI**
  over `fetch()` when `LLM_API_KEY` is set, and falls back to the deterministic
  stub when the key is absent **or any call fails** — so narrative copy can be
  real without ever risking a broken tool call. New optional env: `LLM_API_KEY`
  (secret), `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`. `env` is threaded through
  `runPlan(...)` to the copywriter worker.
- **`full_strategy`** prompt wrapping `strategy_orchestrate`.
- Tests: `budget_optimizer` (cap + optimality vs preset) and
  `strategy_orchestrate` (all workers assembled) — suite now 30 tests.

### Changed
- `version` `1.0.0` → `1.1.0`; `GET /version` `toolCount` 15 → **17**.
- README/CHANGELOG updated for the new tools, the LLM seam, and the 17-tool count.

## [1.0.0] — 2026-06-27

Production hardening. The server moves from a deploy-ready prototype to a
production-grade resource server, with no new real secrets or real data required
to run locally.

### Added
- **Real OAuth 2.1 bearer verification** (`src/auth.ts`) using `jose`
  `createRemoteJWKSet` + `jwtVerify` against a JWKS URL (`OAUTH_JWKS_URL`, or
  derived from `OAUTH_ISSUER`), validating signature, `iss`, `aud`, and expiry.
  `DEV_BYPASS=1` still skips verification for local/dev. 401s carry a
  `WWW-Authenticate: Bearer error=…, resource_metadata=…` header. Unyly Connect
  fronts the full OAuth flow in production.
- **Rate limiting** (`src/ratelimit.ts`): in-memory token-bucket per token (or
  per IP), configurable via `RATE_LIMIT_PER_MIN` (default 60). Exceeding it
  returns JSON-RPC error `-32029` + HTTP 429 with `Retry-After` /
  `X-RateLimit-*` headers. Commented `KvRateLimiter` / `DurableObjectRateLimiter`
  hooks for globally-coordinated production limits.
- **Input validation** (`src/validate.ts`): per-tool JSON-Schema validation →
  `-32602` with helpful messages; unknown tool/method → `-32601`; internal
  failures → `-32603` with a safe generic message (no stack/PII leakage).
- **Observability**: `GET /version` (name, version, protocolVersion, toolCount,
  commit, authMode) and structured per-request logs `{method, tool, ms, status}`
  (no PII). `/health` retained.
- **Data adapter layer** (`src/data.ts`): `DataSource` interface with
  `MockDataSource` as default; commented `KvDataSource` / `HttpDataSource` stubs
  so mock → real is a one-line `setDataSource(...)` wiring change.
- **`DATA_SCHEMA.md`** documenting the exact tables (`benchmarks`, `playbooks`,
  `suppliers`), columns, types, example rows, and which tool consumes each.
- **Test suite (vitest)**: 24 tests covering the initialize handshake,
  `tools/list` (15 tools), happy-path `tools/call` for `ru_benchmarks`,
  `media_plan`, `roi_calculator`, `lead_qualify`, invalid params (`-32602`),
  unknown tool/method (`-32601`), auth 401 with `DEV_BYPASS` off, plus unit tests
  for the rate limiter and validator. `npm test` → `vitest run`.

### Changed
- Data accessors (`getMetric`, `getCategoryBenchmarks`, `getPlaybook`,
  `getSuppliers`) are now async and delegate to the active `DataSource`; the
  orchestrator and growth tools `await` them. Behaviour is unchanged with the
  default mock source.
- `version` bumped `0.1.0` → `1.0.0`. `wrangler.toml` / `.dev.vars.example` gain
  `OAUTH_JWKS_URL`, `RATE_LIMIT_PER_MIN`, and `GIT_COMMIT`.
- README: new **Production configuration** section.

### Dependencies
- Added `jose` (runtime). Added `vitest` (dev).

## [0.1.0]

- Initial Cloudflare Workers MCP server: hand-rolled JSON-RPC 2.0 handler, 15
  tools (9 Intelligence + 6 Growth & Automation), inline synthetic RU/CIS data,
  OAuth bearer stub with `DEV_BYPASS`, prompts and resources. Typecheck + wrangler
  dry-run passing.
