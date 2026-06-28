# Changelog

All notable changes to NECTARIN Intelligence (Cloudflare Workers MCP server).
Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

## [2.50.0] — 2026-06-29

Thirteenth wave — **consumption transparency** (Phase A of the global roadmap, see
`ROADMAP.md`): surface plan & quota state to clients inline, and ship a visual usage
dashboard for leadership. Non-breaking; counts unchanged (**74 tools / 51 prompts**).

### Added
- **Quota headers** on `tools/call` responses: `X-Plan`, and for finite-quota plans
  `X-Quota-Limit` / `X-Quota-Used` / `X-Quota-Remaining` / `X-Quota-Period` — so a client
  sees its remaining allowance without a separate `/usage` call. Unlimited/`owner` callers
  get only `X-Plan` (no extra KV read), keeping the authless deploy read-light. Headers are
  also added to gating/quota upsell responses; exposed via CORS for browser clients.
- **`GET /dashboard`** — a self-contained HTML usage dashboard (gold-on-dark) that reads
  `/usage` same-origin and shows plan, used, limit, remaining + a progress bar per tenant.
- **`ROADMAP.md`** — the global plan: Marketing-OS vision, phases A–D, and the MCP
  **federation** design (NECTARIN as hub; Unyly as the gateway/marketplace/billing point
  through which external specialist MCPs are added so all traffic stays on unyly.org).

### Changed
- `rpcResult` accepts optional response headers; CORS `Expose-Headers`/`Allow-Headers`
  updated for the quota headers and `X-Tenant-Id`. Tests: +3 (headers + dashboard). 196 pass.

## [2.49.0] — 2026-06-29

Twelfth wave — **metered free tier + usage dashboard**: build on the monetization seam
with a per-tenant monthly quota (the concrete free→paid upsell moment) and a read-only
`/usage` endpoint Unyly (or an internal dashboard) can poll for consumption. Non-breaking:
quota is only enforced for finite-quota plans with KV bound, and `owner` (claimless) is
unlimited — so the current authless deploy is unaffected. Counts unchanged (**74 tools /
51 prompts**).

### Added
- **Monthly quota** (`PLAN_MONTHLY_QUOTA` in `src/plan.ts`) — `free` capped at 100
  tool-calls/month; paid tiers and `owner` unlimited. When a finite-quota caller exceeds
  it (counted via the KV usage counter), the tool returns a quota-exceeded **upgrade CTA**
  with a tracked Unyly link instead of running.
- **`GET /usage`** — returns `{ tenant, month, plan, used, quota, remaining, metering }`
  for the current month. Same auth posture as `/mcp` (open under dev-bypass / authless
  prod, 401 when OAuth is configured without a token). Read-only; no enumeration.
- Shared usage helpers (`usageMonth`, `usageKey`, `readUsage`, `sanitizeTenant`) so the
  metering writer and the quota/dashboard readers agree on keys.

### Changed
- `tools/call` now checks the monthly quota (after tool-tier gating) and threads the
  sanitized tenant id through `RpcMeta`. Tests: +5 (quota unit + `/usage` integration +
  counter increment). 194 passing.

## [2.48.0] — 2026-06-29

Eleventh wave — **monetization seam**: turn the Unyly access tiers from narrative into
real, enforceable product value, add a usage-metering event Unyly can bill on, and make
every successful tool output carry a tracked "install via Unyly" footer so the connector
distributes itself. Non-breaking: gating and the footer are inert until Unyly Connect
issues a `plan` claim / the footer is enabled, so the current authless deploy and the
test-suite are unchanged. Tool/prompt counts are unchanged (**74 tools / 51 prompts**).

### Added
- **Plan gating** (`src/plan.ts`) — a small set of flagship / compute-heavy tools
  (`strategy_orchestrate`, `mmm_optimize`, `incrementality_meta`, `geo_holdout`,
  `competitive_response`, `report_export` → `pro`; `board_report` → `team`) now require a
  minimum tier. The caller's tier comes from the token's **`plan` claim** (issued by Unyly
  Connect); a claimless token (dev-bypass / shared-token) is treated as `owner` ⇒ full
  access. Below-tier calls return a friendly **upgrade CTA** with a tracked Unyly link
  instead of running. The free tier stays deliberately generous to drive adoption.
- **Usage metering** — every `tools/call` now emits a structured `usage` log
  (`{scope:"usage", tool, tenant, plan, gated}`) as the zero-infra billing seam, plus a
  best-effort monthly KV counter per tenant (`usage:<tenant>:<YYYYMM>`) when KV is bound.
  Never blocks the response (runs via `waitUntil` when available) and never throws.
- **Unyly attribution footer** — when `UNYLY_ATTRIBUTION=1`, successful tool outputs get a
  subtle "Сделано в NECTARIN · подключить через Unyly" line with a UTM-tracked link plus a
  `poweredBy` field in `structuredContent`. Funnel tools (`connect_via_unyly`,
  `request_nectarin_proposal`, `book_consultation`) are skipped to avoid noise.
- Env var `UNYLY_ATTRIBUTION` in `Env`, `wrangler.toml` (on) and `.dev.vars.example`.

### Changed
- Token `plan`/`tier` claim is now extracted into `AuthContext.plan` and threaded into the
  dispatcher. `src/index.ts` `fetch` now accepts the optional Workers `ExecutionContext`
  (for `waitUntil`); tests calling `fetch(request, env)` are unaffected.

## [2.47.0] — 2026-06-29

Tenth wave — **distribution through Unyly**: make the connector self-distribute and
route every install/access/onboarding through unyly.org (the single front door where
Unyly Connect fronts OAuth 2.1 and the gateway can measure traffic & meter usage).
NECTARIN Intelligence now ships **74 tools / 51 guided prompts**.

### Added
- **`connect_via_unyly`** (new **Distribution** group) — the front door. Returns the
  **tracked Unyly install link** (UTM-attributed by `source`/`role`/`plan`, with a
  `via=<UNYLY_PARTNER_ID>` partner tag), the manual MCP endpoint as a fallback,
  role-aware onboarding (pairs with `role_playbook`) and the **access tiers**
  (free / pro / team / agency) with what each unlocks. Use it whenever a user asks how
  to connect, install, onboard a team or upgrade. Returns links & guidance only — no
  PII, no network call. 73 → **74 tools**.
- **`connect_unyly`** guided prompt (**51 prompts** total).
- Env vars `UNYLY_LISTING_URL` (default the public listing) and `UNYLY_PARTNER_ID`
  (attribution tag) in `Env`, `wrangler.toml` and `.dev.vars.example`.

### Changed
- `tools/list` now advertises **74 tools** with a new Distribution group. Catalog,
  `/version`, README/USAGE/OVERVIEW counts and the test suite updated accordingly.

## [2.46.0] — 2026-06-28

Ninth wave — **profession coverage**: one connector for every marketer, not just
the CMO. Adds a role router plus six discipline planners for under-served roles
(SEO, SMM, PR, events, mobile/ASO, content). NECTARIN Intelligence now ships
**73 tools / 50 guided prompts** spanning **22 marketing professions** — all
installed and accessed through a single **Unyly** front door.

### Added
- **`role_playbook`** (new **Roles / Adoption** group) — the adoption engine. A
  marketer states their profession in RU or EN (free-text, alias-matched) and gets a
  TAILORED playbook: primary tools (each with a role-specific reason), the supporting
  toolkit, an ordered end-to-end workflow, the KPIs that role owns and example
  questions. Called without a role it lists all **22 supported professions** (CMO,
  performance/PPC, SEO, SMM, content, brand, media planning, CRM/lifecycle, e-commerce/
  marketplaces, influencer, PR, analytics, product/GTM, affiliate, growth, events,
  mobile/ASO, creative/production, pricing/promo, compliance, agency, marketing ops).
- **`seo_opportunity`** (new **SEO** group) — organic-growth model: applies a
  position→CTR curve to keyword volumes to project current vs. target traffic,
  incremental conversions & value per keyword, ranks opportunities and flags page-2
  **quick wins**.
- **`social_media_planner`** (new **Social / SMM** group) — organic reach, impressions,
  engagements and follower growth per platform (VK/Telegram/Дзен/YouTube …), with
  optional conversions & revenue and a low-organic-reach flag.
- **`pr_value_estimator`** (new **PR / Communications** group) — deduplicated earned
  reach, tier×sentiment quality-adjusted reach, advertising-equivalent reach value
  (clearly labelled as context, not an endorsed KPI) and earned **share of voice**.
- **`event_roi_planner`** (new **Events** group) — event/webinar funnel
  (invites→registrations→attendees→leads→opportunities→deals→revenue), cost per
  registration/attendee/lead, ROI and breakeven deals.
- **`aso_planner`** (new **Mobile / ASO** group) — store funnel
  (impressions→page views→installs), LTV revenue, paid-UA economics (LTV/CPI) and an
  ASO uplift scenario (+pp to install conversion).
- **`content_plan_roi`** (new **Content** group) — models content as a compounding
  asset month-by-month over a horizon → cumulative visits/conversions/value vs. spend,
  ROI, **payback month** and exit run-rate.
- Seven guided prompts: **`my_role`**, `seo_forecast`, `social_plan`, `pr_value`,
  `event_roi`, `aso_plan`, `content_roi` (**50 prompts** total).

### Changed
- `tools/list` now advertises **73 tools** across the new SEO, Social/SMM, PR, Events,
  Mobile/ASO, Content and Roles/Adoption groups. Catalog resource, `/version`
  `toolCount`, README/USAGE/OVERVIEW counts, the leadership deck and the test suite
  updated accordingly. Title humanizer learns the `SEO`, `SMM`, `PR`, `ASO`, `EPC`,
  `CRM` acronyms.

## [2.45.0] — 2026-06-28

Eighth wave (3/3) — CPA / affiliate program economics (**66th tool**).
NECTARIN Intelligence now ships **66 tools / 43 guided prompts**.

### Added
- **`affiliate_program_planner`** (new **Partnerships** group) — CPA / affiliate /
  partner-program economics for RU networks (Admitad, Cityads, …) and direct partners.
  From AOV, gross margin %, a commission model (percent of AOV or fixed CPA), an optional
  `networkFeePct` and `validationRatePct`, plus per-partner `clicksPerMonth` &
  `conversionRatePct`, it computes per-partner approved orders, revenue, payout, EPC,
  effective CPA, ROAS and net profit, ranks partners, blends the program (revenue,
  payout, fee, net profit, blended ROAS/CPA), and derives the **sustainable commission
  ceiling** (payout where profit per order = 0 ⇒ `AOV×margin/(1+fee)`), flagging
  loss-making partners and checking an optional target CPA. 65 → **66 tools**.
- **`affiliate_program_plan`** guided prompt (**43 prompts** total).

### Changed
- `tools/list` now advertises **66 tools** with a new Partnerships group. Catalog
  resource, `/version` `toolCount`, README/USAGE/OVERVIEW counts and the test suite
  updated accordingly.

## [2.44.0] — 2026-06-28

Eighth wave (2/3) — email / CRM newsletter economics (**65th tool**).
NECTARIN Intelligence now ships **65 tools / 42 guided prompts**.

### Added
- **`email_campaign_planner`** (new **Email / Lifecycle** group) — from list size,
  deliverability, open & click rates (CTR or click-to-open), conversion and AOV it
  computes per-send delivered→opens→clicks→orders→revenue and the key
  **revenue-per-email (RPE)**; with `sendsPerMonth` it projects monthly & annual
  revenue, orders and list attrition from unsubscribes (compounded monthly unsub rate),
  a **list half-life** and a **fatigue warning**; with `costPerEmail` /
  `platformMonthlyCost` (and `marginPct`) it returns profit and **ROI**.
  64 → **65 tools**.
- **`email_campaign_plan`** guided prompt (**42 prompts** total).

### Changed
- `tools/list` now advertises **65 tools** with a new Email/Lifecycle group. Catalog
  resource, `/version` `toolCount`, README/USAGE/OVERVIEW counts and the test suite
  updated accordingly.

## [2.43.0] — 2026-06-28

Eighth wave (1/3) — RFM customer segmentation (**64th tool**).
NECTARIN Intelligence now ships **64 tools / 41 guided prompts**.

### Added
- **`rfm_segmenter`** (Retention / CRM group, now 2 tools) — from customers with
  `recencyDays` + `frequency` + `monetary`, scores each on 1–5 quintiles (recency
  inverted), combines R with the F/M average into the classic named segments
  (Champions, Loyal, Potential Loyalist, New/Promising, Need Attention, About to Sleep,
  At Risk, Can't Lose Them, Hibernating, Lost), sizes every segment (customers, share %,
  total & average monetary, avg recency/frequency) and attaches a concrete CRM action.
  Surfaces Champions revenue and revenue at risk. 63 → **64 tools**.
- **`rfm_segmentation`** guided prompt (**41 prompts** total).

### Changed
- `tools/list` now advertises **64 tools**; the Retention/CRM group grows to 2. Catalog
  resource, `/version` `toolCount`, README/USAGE/OVERVIEW counts and the test suite
  updated accordingly.

## [2.42.0] — 2026-06-28

Seventh wave (4/4) — a heuristic landing-page CRO audit (**63rd tool**).
NECTARIN Intelligence now ships **63 tools / 40 guided prompts**.

### Added
- **`landing_cro_audit`** (Audit group, now 2 tools) — scores up to seven UX/performance
  dimensions you provide (page speed, bounce, mobile parity, form friction, CTA clarity,
  trust/social proof, CR vs benchmark) into a weighted **0-100 CRO score + grade**,
  with weights renormalised to the data supplied. Returns a **prioritized issue list**
  (weight × gap) with concrete fixes and a **projected CR uplift** (multiplicative with
  diminishing returns: `1 − Π(1 − maxUplift·(1−score))`) that, given `monthlyVisitors`
  + `aov`, becomes incremental conversions & revenue per month/year. Points to
  `ab_test_planner` → `creative_testing_matrix` for validation. 62 → **63 tools**.
- **`landing_cro_audit_run`** guided prompt (**40 prompts** total).

### Changed
- `tools/list` now advertises **63 tools**; the Audit group grows to 2. Catalog
  resource, `/version` `toolCount`, README/USAGE/OVERVIEW counts and the test suite
  updated accordingly.

## [2.41.0] — 2026-06-28

Seventh wave (3/4) — a multi-variant test results analyzer (**62nd tool**).
NECTARIN Intelligence now ships **62 tools / 39 guided prompts**.

### Added
- **`creative_testing_matrix`** (Premium Analytics group, now 11 tools) — the READ side
  of `ab_test_planner`. From ≥2 arms with observed visitors+conversions it picks a
  control (named, else highest-traffic), then per arm computes CR, absolute & relative
  lift, a pooled **two-proportion z-test** (z, two-tailed p) and significance under a
  **multiple-comparison-corrected α** (Bonferroni / Šidák / none across k−1
  comparisons). For non-significant arms it estimates the **additional sample per arm**
  needed to detect the observed effect at the target power, and declares
  **WINNER / LOSER / KEEP TESTING / INSUFFICIENT DATA** per arm plus a roll-out
  recommendation and guardrails (no-peeking, SRM). 61 → **62 tools**.
- **`creative_test_readout`** guided prompt (**39 prompts** total).

### Changed
- `tools/list` now advertises **62 tools**; the Premium Analytics group grows to 11.
  Catalog resource, `/version` `toolCount`, README/USAGE/OVERVIEW counts and the test
  suite updated accordingly.

## [2.40.0] — 2026-06-28

Seventh wave (2/4) — an OLV/display frequency-cap optimizer (**61st tool**).
NECTARIN Intelligence now ships **61 tools / 38 guided prompts**.

### Added
- **`frequency_cap_optimizer`** (Media group, now 6 tools) — from a fixed impression
  pool (impressions, or budget + CPM) and the audience universe it (A) **diagnoses**
  the over-cap waste at the natural average frequency for each candidate cap (Poisson:
  `U·E[max(X−c,0)]`), and (B) **optimizes** by re-solving per-person delivery so freed
  impressions are reallocated (`U·E[min(Poisson(λ′),c)] = impressions`), returning the
  resulting net (1+) reach, effective reach at ≥N, average frequency and the effective-
  reach **uplift** vs. no cap. Recommends the cap maximising ≥N effective reach.
  60 → **61 tools**.
- **`frequency_cap_plan`** guided prompt (**38 prompts** total).

### Changed
- `tools/list` now advertises **61 tools**; the Media group grows to 6. Catalog
  resource, `/version` `toolCount`, README/USAGE/OVERVIEW counts and the test suite
  updated accordingly.

## [2.39.0] — 2026-06-28

Seventh wave (1/4) — a churn & retention-economics tool (**60th tool**).
NECTARIN Intelligence now ships **60 tools / 37 guided prompts**.

### Added
- **`churn_predictor`** (new **Retention / CRM** group) — resolves a monthly churn
  rate from a direct %, a cohort (`customersStart`→`customersRetained` over N months)
  or a monthly retention %, then computes **annualised churn**, **average lifetime**
  (1/churn), a survival curve to the horizon, **customers & revenue retained vs. lost**,
  and **LTV** (`ARPU/churn`, optionally discounted with an annual rate). Given a
  retention initiative (`reduceChurnByPp` + `programCost`) it sizes the per-customer
  LTV uplift, the total uplift and the **ROI of retention**. 59 → **60 tools**.
- **`churn_analysis`** guided prompt (**37 prompts** total).

### Changed
- `tools/list` now advertises **60 tools**; catalog resource, `/version` `toolCount`,
  README/USAGE/OVERVIEW counts and the integration test suite updated accordingly.

## [2.38.0] — 2026-06-28

Sixth wave complete (3/3) — a Share-of-Search demand tracker (**59th tool**).
NECTARIN Intelligence now ships **59 tools / 36 guided prompts**.

### Added
- **`share_of_search`** (Brand group, now 3 tools) — tracks branded-search demand as a
  **leading indicator of market share** (Les Binet). From the brand's branded-search
  volume + competitors' volumes (or a total category volume, or SoS directly), computes
  **Share of Search (SoS %)**, the brand's **rank**, and — given current market share —
  the **SoS↔share gap** (SoS above share ⇒ poised to gain; below ⇒ at risk). An optional
  previous SoS yields the **trend**, and next-period market share is projected as it
  partially converges toward SoS. Explicitly distinct from `sov_tracker` (which tracks
  share of media **spend**, not demand). 58 → **59 tools**.
- **`share_of_search_check`** guided prompt (**36 prompts** total) — parse `name:volume`
  rows, pick the brand → `share_of_search` → SoS %, rank, gap, trend and projected share.

### Changed
- `tools/list` now advertises **59 tools**; the Brand group grows to 3
  (`brand_lift`, `sov_tracker`, `share_of_search`). Catalog resource, `/version`
  `toolCount`, README/USAGE/OVERVIEW counts and the test suite updated accordingly.

## [2.37.0] — 2026-06-28

Sixth wave (2/3) — a marketplace / retail-media planner (**58th tool**).
NECTARIN Intelligence now ships **58 tools / 35 guided prompts**.

### Added
- **`retail_media_planner`** (new **Retail Media** group) — a planner for Ozon,
  Wildberries, Яндекс Маркет & Avito retail media. From placements (search/catalog/
  banner) with a cost model (**CPC**, or **CPM + CTR**), click→order **CVR**, an
  **AOV**, the marketplace **commission** (take-rate %) and an optional budget, it
  computes per-placement effective CPC, orders, revenue, **ДРР** (доля рекламных
  расходов = ad spend / revenue) and **ROAS**, ranks placements by **profit per ₽**,
  then greedily allocates the budget to the most profitable placements first
  (respecting click/impression caps). Returns blended portfolio economics —
  revenue, ДРР, ROAS, net profit after commission/COGS — with a **target-ДРР** check
  and priority tiers. Falls back to unit-economics-only output when neither a budget
  nor volume caps are supplied. 57 → **58 tools**.
- **`retail_media_plan`** guided prompt (**35 prompts** total) — parse
  `name:model:cost:cvr[:ctr]` rows + AOV/commission/budget/target ДРР →
  `retail_media_planner` → profit-ranked plan and portfolio economics.

### Changed
- `tools/list` now advertises **58 tools**; catalog resource, `/version` `toolCount`,
  README/USAGE/OVERVIEW counts and the integration test suite updated accordingly.

## [2.36.0] — 2026-06-28

Sixth wave (1/3) — a paid-search / SEM keyword-portfolio planner (**57th tool**).
NECTARIN Intelligence now ships **57 tools / 34 guided prompts**.

### Added
- **`search_planner`** (new **Search & SEM** group) — a Yandex Direct / контекст
  keyword-portfolio planner. From keywords (monthly **volume** + **CPC**, optional
  CTR%/CVR%/intent) and an optional monthly budget it estimates per-keyword **clicks,
  conversions, CPA** and the **max addressable spend**, ranks keywords by efficiency
  (conversions per ₽), then greedily **allocates the budget** to the lowest-CPA
  keywords first. Returns portfolio totals — clicks, conversions, **blended CPA**,
  total spend and demand **coverage %** — plus per-keyword priority tiers
  (high/medium/low). Defaults CTR 4% / CVR 2% when missing (flagged). Deterministic
  media math on the operator's own inputs; planning estimate, not a guarantee.
  56 → **57 tools**.
- **`search_plan`** guided prompt (**34 prompts** total) — parse `term:volume:cpc[:ctr][:cvr]`
  rows + optional budget → `search_planner` → priority-ranked plan and totals.

### Changed
- `tools/list` now advertises **57 tools**; catalog resource, `/version` `toolCount`,
  README/USAGE/OVERVIEW counts and the integration test suite updated accordingly.

## [2.35.0] — 2026-06-28

Fifth wave complete (3/3) — an incrementality meta-analysis tool (**56th tool**).
NECTARIN Intelligence now ships **56 tools / 33 guided prompts**.

### Added
- **`incrementality_meta`** (Experimentation group, now 2 tools) — pools multiple
  incrementality / A-B / geo-holdout tests (each a lift % + SE, or a 95% CI from which
  SE is derived) into one estimate: the inverse-variance **fixed-effect** pooled lift
  (z, p, CI), heterogeneity **Q & I²**, and the **DerSimonian–Laird random-effects**
  pooled lift (wider CI when results disagree). Returns per-test weights, both pooled
  estimates, a heterogeneity verdict and an overall significance call.
  55 → **56 tools**.
- **`meta_analysis`** guided prompt (**33 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 56, Experimentation now 2
  tools), USAGE (catalogue 56, prompts 33, measurement flow), OVERVIEW, test counts
  (56 tools / 33 prompts).

## [2.34.0] — 2026-06-28

Fifth wave (2/3) — a batch UTM / taxonomy governance auditor (**55th tool**). Now **55
tools / 32 guided prompts**.

### Added
- **`utm_taxonomy_qa`** (Premium group, now 8 tools) — parses a list of tagged URLs
  (or raw UTM query strings), checks each for missing required params
  (utm_source/medium/campaign by default), uppercase, spaces and non-ASCII/Cyrillic,
  then aggregates a **0–100 consistency score** + A–F grade, **near-duplicate value
  variants** per parameter (e.g. `facebook` vs `Facebook` vs `fb`), values outside an
  optional source/medium allow-list, and concrete fixes. Complements `utm_builder`
  (which builds ONE link) by auditing a whole campaign export. 54 → **55 tools**.
- **`utm_audit`** guided prompt (**32 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 55, Premium now 8 tools),
  USAGE (catalogue 55, prompts 32), OVERVIEW, test counts (55 tools / 32 prompts).

## [2.33.0] — 2026-06-28

Fifth wave (1/3) — a creative rotation optimizer (**54th tool**). Now **54 tools / 31
guided prompts**.

### Added
- **`creative_rotation`** (Creative Ops group, now 2 tools) — from a set of creatives
  (performance % + impressions served), applies an **exponential fatigue decay**
  (effectiveness halves every `halfLifeImpressions`), then **water-fills** the next
  period's impressions to the highest fatigue-adjusted value, **capped per creative**
  (default 40%) to preserve rotation/variety. Returns the recommended impression
  share, decay multiplier, status (scale/maintain/retire), the projected aggregate
  **uplift vs. an even rotation**, and how many fresh creatives to produce.
  Complements `creative_fatigue` (single-creative time-series). 53 → **54 tools**.
- **`creative_rotation_plan`** guided prompt (**31 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 54, Creative Ops now 2
  tools), USAGE (catalogue 54, prompts 31, rotation flow), OVERVIEW, test counts (54
  tools / 31 prompts).

## [2.32.0] — 2026-06-28

Fourth wave complete (3/3) — a measured audience overlap / dedup analyzer (**53rd
tool**). NECTARIN Intelligence now ships **53 tools / 30 guided prompts**.

### Added
- **`audience_overlap`** (Media group, now 5 tools) — deduplicates audiences from
  **measured** pairwise overlaps (DMP / panel / cross-device), unlike `channel_overlap`
  which assumes statistical independence. Computes the deduplicated total reach
  (inclusion–exclusion), the duplication rate, each segment's incremental
  (leave-one-out) unique contribution & redundancy, a duplication matrix, and the most
  additive vs. most redundant segment — to cap frequency or reallocate budget. Exact
  for 2 segments; a clamped 2nd-order estimate for ≥3 (no triple-intersection data).
  52 → **53 tools**.
- **`audience_dedup`** guided prompt (**30 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 53, Media now 5 tools),
  USAGE (catalogue 53, prompts 30, OLV flow), OVERVIEW, test counts (53 tools / 30
  prompts).

## [2.31.0] — 2026-06-28

Fourth wave (2/3) — a trend-aware budget pacing forecaster (**52nd tool**). Now **52
tools / 29 guided prompts**.

### Added
- **`budget_pacing_forecast`** (Premium group, now 7 tools) — projects end-of-flight
  spend from the **recent daily run-rate** (last N days when provided, else the flat
  average), reporting the over/under-spend variance %, the **days to exhaust** the
  budget at the current rate, the recommended daily rate (and % adjustment) to land
  exactly on budget, and an optional CPA pace from conversions-to-date. Complements
  `pacing_monitor` (a linear extrapolation) with a trend-based projection.
  51 → **52 tools**.
- **`pacing_forecast`** guided prompt (**29 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 52, Premium now 7 tools),
  USAGE (catalogue 52, prompts 29), OVERVIEW, test counts (52 tools / 29 prompts).

## [2.30.0] — 2026-06-28

Fourth wave — competitive war-gaming. Adds a competitive response simulator (**51st
tool**) in a new Competitive group. Now **51 tools / 28 guided prompts**.

### Added
- **`competitive_response`** (new **Competitive** group) — given your spend, the
  current competitor spend and a competitor move (spend escalation %, new entrant or
  pullback), models the impact on your **Share of Voice**, **auction CPM inflation**
  and **effective impressions** at a fixed budget; sizes the **defensive budget**
  required to hold a target SOV (y = t·comp'/(1−t)); and recommends a posture
  (hold / partial_match / defend_or_pivot). Deterministic auction-share dynamics.
  50 → **51 tools**.
- **`competitive_wargame`** guided prompt (**28 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 51, new Competitive
  group), USAGE (catalogue 51, prompts 28, new flow), test counts (51 tools / 28
  prompts).

## [2.29.0] — 2026-06-28

Media quality: a delivery quality scorer (**50th tool**) — final feature of the third
wave. NECTARIN Intelligence now ships **50 tools / 27 guided prompts**.

### Added
- **`media_quality_score`** (Media group, now 4 tools) — from a placement's OWN
  delivered metrics (viewability %, IVT/bot %, video completion %, brand-safe %,
  on-target %), computes a weighted **0–100 quality score** and an A–F grade, scores
  each metric vs. RU/MRC-style thresholds (viewability ≥50% display / ≥70% video,
  IVT <3%, brand-safe ≥95%, on-target ≥70%), flags problems and names the biggest
  lever. Complements `supplier_quality` (a benchmark lookup) — this scores YOUR
  actual delivery. Deterministic. 49 → **50 tools**.
- **`media_quality_check`** guided prompt (**27 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 50, Media group now 4
  tools), USAGE (catalogue 50, prompts 27), test counts (50 tools / 27 prompts).

## [2.28.0] — 2026-06-28

Brand growth: a Share-of-Voice / ESOV growth tracker (49th tool) — second feature of
the third wave.

### Added
- **`sov_tracker`** (Brand group, now 2 tools) — from brand spend + competitor
  spends (or a given SOV) and the brand's current market share (SOM), computes
  **SOV**, **ESOV** (excess share of voice = SOV − SOM) and the predicted annual
  market-share growth using the Binet & Field rule (~0.5pp per 10pp ESOV, coef
  configurable). Also solves the SOV and brand spend required to hit a target share
  growth. Deterministic brand-growth heuristic. 48 → **49 tools**.
- **`sov_analysis`** guided prompt (**26 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 49, Brand group now 2
  tools), USAGE (catalogue 49, prompts 26), test counts (49 tools / 26 prompts).

## [2.27.0] — 2026-06-28

Incrementality: a geo-holdout test designer & evaluator (48th tool) — first feature
of the third wave (causal measurement / matched-market testing).

### Added
- **`geo_holdout`** (new **Experimentation** group) — two auto-detected modes.
  *Design*: from expected baseline conversions in the test geos + a target lift,
  returns the **minimum detectable lift (MDE)** = (z_{1−α/2}+z_power)·√(2/baseline),
  the baseline volume required for a target lift, and a recommended test duration.
  *Measure*: from observed test-geo conversions vs. a counterfactual (scaled
  control), computes incremental conversions, lift %, a count-based (Poisson)
  z-test, two-tailed p-value, significance, a CI and incremental CPA. Deterministic.
  47 → **48 tools**.
- **`geo_test`** guided prompt (**25 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 48, new Experimentation
  group), USAGE (catalogue 48, prompts 25), test counts (48 tools / 25 prompts).

## [2.26.0] — 2026-06-28

Media flighting: a weekly media flowchart / flighting planner (47th tool) — final
feature of the second wave (медийная реклама / flighting).

### Added
- **`media_flowchart`** (Media group, now 3 tools) — distributes a total budget
  across N weeks by a flighting pattern (even / front_loaded / back_loaded / burst /
  pulse), returning the per-week budget, share and cumulative spend, plus a
  **per-channel split each on-air week** when channel shares are given. Reports the
  peak week and on-air weeks. Deterministic scheduling math. 46 → **47 tools**.
- **`flighting_plan`** guided prompt (**24 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 47, Media group now 3
  tools), USAGE (catalogue 47, prompts 24), test counts (47 tools / 24 prompts).

## [2.25.0] — 2026-06-28

Production: a creative production budget & timeline estimator (46th tool) — second
feature of the second wave (Производство).

### Added
- **`production_estimator`** (new **Production** group) — from a list of deliverables
  (asset type × quantity × complexity) and a quality tier (economy/standard/premium),
  applies an illustrative RU rate card to give a per-deliverable cost & effort
  breakdown, a subtotal, contingency and optional rush surcharge, a **total cost
  range (±20%)**, and a **critical-path timeline** estimate (production is partly
  parallel, not purely additive). Asset types: video, video_cutdown, static,
  key_visual, animated_banner, social_post, photo, landing, audio. Heuristic &
  deterministic. 45 → **46 tools**.
- **`production_budget`** guided prompt (**23 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 46, new Production group),
  USAGE (catalogue 46, prompts 23), test counts (46 tools / 23 prompts).

## [2.24.0] — 2026-06-28

Omnichannel measurement: a cross-channel deduplicated reach estimator (45th tool) —
first feature of the second wave (омниканальность на данных).

### Added
- **`channel_overlap`** (Media group, now 2 tools) — given a shared audience
  universe and ≥2 channels' individual reach (reachPct or reachPeople), computes the
  combined **net deduplicated reach** under the independence (Sainsbury) model, the
  gross summed reach, the duplication/overlap (people & %), and each channel's
  **incremental unique reach** (leave-one-out). Flags the most additive and most
  duplicated channels. Deterministic planning estimate. 44 → **45 tools**.
- **`omnichannel_reach`** guided prompt (**22 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 45, Media group now 2
  tools), USAGE (catalogue 45, prompts 22), test counts (45 tools / 22 prompts).

## [2.23.0] — 2026-06-28

Branding measurement: a brand-lift study calculator (44th tool) — third feature of
the site-aligned wave (closes the брендинг gap).

### Added
- **`brand_lift`** (new **Brand** group) — two modes, auto-detected.
  *Measure*: from a control vs. exposed survey cell (n + positive answers for ad
  recall / awareness / consideration / intent) computes both rates, the absolute
  (pp) and relative lift, a pooled **two-proportion z-test** (z, two-tailed
  p-value, significance at α) and a confidence interval for the absolute lift.
  *Design*: from a base rate + target lift (absolute pp or relative %), α and power,
  returns the **required sample size per cell** and total. Deterministic survey
  statistics. 43 → **44 tools**.
- **`brand_lift_study`** guided prompt (**21 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 44, new Brand group),
  USAGE (catalogue 44, prompts 21), test counts (44 tools / 21 prompts).

## [2.22.0] — 2026-06-28

OLV/display media science: a reach & frequency planner (43rd tool) — second feature
of the site-aligned wave (Nectarin is award-winning in OLV-performance).

### Added
- **`reach_frequency`** (new **Media** group) — from a budget + CPM (or impressions
  directly) and the target audience universe, computes gross impressions, GRPs,
  **net reach** (people & %), average frequency among reached, the full contact
  distribution and **effective reach at ≥N exposures** using a Poisson exposure
  model. With a `frequencyCap` it estimates impressions wasted above the cap and the
  potential reach gain from reallocating them, plus cost-per-reached-person and an
  under-/over-frequency verdict. Deterministic media math. 42 → **43 tools**.
- **`olv_plan`** guided prompt (**20 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 43, new Media group),
  USAGE (catalogue 43, prompts 20), test counts (43 tools / 20 prompts).

## [2.21.0] — 2026-06-28

Маркетинг влияния: an influencer/KOL roster evaluator & mix optimizer (42nd tool).
First feature of a site-aligned wave that closes gaps vs. nectarin.ru's named
services (influence, OLV/display reach, branding).

### Added
- **`influencer_planner`** (new **Influence** group) — for each creator (followers,
  price, optional avgViews, ER%, audience match) computes reach, CPM/CPV/CPE,
  estimated target reach & conversions, eCPA and a value score; **flags suspicious
  engagement** (likely inflated/bot or dead audience vs. the typical ER band for the
  follower tier — nano/micro/macro/mega). With a `budget` it greedily builds the
  best mix (by eCPA for conversions or CPM for reach) and reports blended
  reach/conversions/CPA/CPM. Deterministic, on the operator's own roster.
  41 → **42 tools**.
- **`influencer_plan`** guided prompt (**19 prompts** total).

### Changed
- `server.json` description + version, README (Tools badge 42, new Influence group),
  USAGE (catalogue 42, prompts 19), test counts (42 tools / 19 prompts).

## [2.20.0] — 2026-06-28

Pricing science: a profit-maximizing price optimizer with demand elasticity (41st tool).

### Added
- **`price_optimizer`** (Pricing & Promo group, now 2 tools) — from ≥2 historical
  `(price, units)` observations it fits a constant-elasticity demand curve
  `Q = a·P^(-e)` by log-log least squares, estimates the **price elasticity of
  demand**, and — when demand is elastic (e>1) — computes the profit-maximizing
  price `P* = cost·e/(e−1)` (markup rule) with projected units/revenue/profit and
  the **profit uplift vs. an optional currentPrice**. Flags inelastic demand
  (e≤1, no interior optimum), anomalous (e≤0) and low-confidence fits (n<3 or
  R²<0.5). Deterministic, on the operator's own data. Complements `promo_planner`.
  40 → **41 tools**.
- **`price_optimization`** guided prompt (**18 prompts** total) — one-click optimal
  price via `price_optimizer`.

### Changed
- `server.json` description + version, README (Tools badge 41, Pricing & Promo
  group now 2 tools), USAGE (catalogue 41, prompts 18), test counts (41 tools /
  18 prompts).

## [2.19.0] — 2026-06-28

Creative ops: a CTR-based creative burnout/fatigue detector (40th tool).

### Added
- **`creative_fatigue`** (new **Creative Ops** group) — a creative burnout detector.
  From each creative's daily CTR series (`ctr[]` in %, or `impressions[]`+`clicks[]`),
  it finds the peak CTR, the decline from peak, the recent least-squares trend, a
  0–100 **fatigue score** + stage (fresh/maturing/fatigued/burnt), and — while CTR is
  still falling — the estimated **days until it crosses the refresh threshold**
  (default 70% of peak). Ranks creatives worst-first and recommends refresh_now /
  prepare_refresh / monitor / healthy. Deterministic, on the operator's own series.
  39 → **40 tools**.
- **`creative_fatigue_check`** guided prompt (**17 prompts** total) — one-click
  burnout check via `creative_fatigue`.

### Changed
- `server.json` description + version, README (Tools badge 40, new Creative Ops
  group), USAGE (catalogue 40, prompts 17), test counts (40 tools / 17 prompts).

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
