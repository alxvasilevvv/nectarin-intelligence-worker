# Changelog

All notable changes to NECTARIN Intelligence (Cloudflare Workers MCP server).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

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
