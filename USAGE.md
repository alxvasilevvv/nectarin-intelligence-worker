# NECTARIN Intelligence — Usage & Claude Prompt

Premium AI marketing agent for the **RU/CIS** market, served as a remote **MCP**
server on Cloudflare Workers. **32 tools** across four groups, a model‑agnostic
LLM narrative seam (with KV response cache), real‑data layering via KV, and an
opt‑in SSE transport.

- **MCP endpoint:** `https://nectarin-intelligence.alxvasilevv.workers.dev/mcp`
- **Health:** `/health` · **Version:** `/version`
- **Auth:** dev‑bypass (open) — data is MOCK/synthetic, safe to expose.
- **Disclaimer:** all figures are illustrative; tools are decision‑support, **not legal advice**.

---

## 1. Connect

### Claude Desktop / Web — Custom Connector
Settings → Connectors → **Add custom connector** → paste the `/mcp` URL above.
No token required (dev‑bypass).

### Claude Code / CLI
```bash
claude mcp add --transport http nectarin https://nectarin-intelligence.alxvasilevv.workers.dev/mcp
```

### Raw JSON‑RPC (curl)
```bash
curl -s -H 'content-type: application/json' \
  -X POST https://nectarin-intelligence.alxvasilevv.workers.dev/mcp \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### SSE (opt‑in)
Add `?stream=1` to the endpoint, **or** send `Accept: text/event-stream` (without
`application/json`). The common `Accept: application/json, text/event-stream`
stays on JSON, so existing clients are unaffected.

---

## 2. Tool catalogue (63)

### Intelligence (11)
| Tool | What it does |
|---|---|
| `ru_benchmarks` | CPM/CTR/CPA/VTR ranges (p25/p50/p75) per platform + provenance. |
| `supplier_quality` | Vendor/inventory quality scan for a category. |
| `media_plan` | Channel split + forecast (impressions/clicks/conversions/CPA). |
| `category_playbook` | Territories, angles, compliance notes per industry. |
| `audience_insights` | Segments + JTBD for a category. |
| `competitor_scan` | Competitors, activity, territories. |
| `geo_aeo_audit` | Visibility in Yandex / GigaChat / ChatGPT (GEO/AEO). |
| `creative_brief` | LLM creative brief for product × audience × channel. |
| `report_explain` | Plain‑language explanation of a metrics JSON. |
| `budget_optimizer` | Greedy water‑filling allocation by CPA across channels. |
| `strategy_orchestrate` | **Flagship**: end‑to‑end GTM strategy in one call. |

### Growth & Automation (6)
| Tool | What it does |
|---|---|
| `roi_calculator` | CPA improvement, extra conversions, annualized value. |
| `value_forecast` | 3 scenarios (conservative/base/ambitious) over a horizon. |
| `lead_qualify` | Fit score + recommended tier. |
| `automation_recipe` | Concrete managed‑service automation workflow. |
| `request_nectarin_proposal` | Capture a brief (no PII invented; stubbed CRM). |
| `book_consultation` | CTA + prep checklist (placeholder scheduling link). |

### Premium Analytics (11)
| Tool | What it does |
|---|---|
| `compliance_check` | RU ad‑law (ФЗ‑38/ОРД) review with violation flags. |
| `ab_test_planner` | Two‑proportion power analysis → sample size & duration (DESIGN). |
| `unit_economics` | LTV / CAC / payback / ROAS. |
| `funnel_model` | Full‑funnel projection, P10/P50/P90, biggest leak. |
| `seasonality_forecast` | Monthly demand indices + budget weighting. |
| `creative_score` | Best‑practice + quick‑compliance ad‑copy scoring. |
| `attribution_model` | First/last/linear/position/time‑decay attribution. |
| `bid_simulator` | Bid ↔ win‑rate curve + recommended bid for target CPA. |
| `report_export` | Strategy → slides / Markdown deck / one‑pager. |
| `localize` | LLM translation + cultural adaptation (RU/EN/KZ/UZ). |
| `creative_testing_matrix` | Multi‑variant test RESULTS analyzer: per‑arm CR, lift vs control, two‑proportion z‑test with Bonferroni/Šidák correction, additional sample needed, and WINNER / LOSER / KEEP TESTING / INSUFFICIENT DATA decisions. |

### Premium (6) — generate · monitor · project · operate
| Tool | What it does |
|---|---|
| `creative_variants` | Generate + score N ready‑to‑test ad variants (LLM, KV‑cached; template fallback), ranked best‑first. |
| `anomaly_detector` | Robust median/MAD anomaly detection over a metric time series for always‑on monitoring. |
| `cohort_ltv` | Retention‑curve cohort LTV/NPV + LTV:CAC + payback. |
| `utm_builder` | Consistent, validated UTM tracking URLs (normalize, encode, warn, naming convention). |
| `pacing_monitor` | Budget pacing vs. even spend curve: status, projection, recommended daily spend. |
| `budget_pacing_forecast` | **Trend-aware** forecast: projects landing spend from the recent daily run-rate → over/under-spend %, **days to exhaust**, recommended daily rate & % adjustment to land on budget; optional CPA pace. |
| `utm_taxonomy_qa` | Audits a **batch** of tagged URLs → 0–100 consistency score + grade, missing-param / casing / spaces / non-ASCII issues, **near-duplicate value variants** per parameter, allow-list violations and fixes. (vs `utm_builder` which builds one link.) |
| `response_curve` | Channel saturation / diminishing‑returns modeling + conversion‑maximizing budget reallocation (marginal CPA, uplift vs. current). |

### MMM (1) — marketing mix modeling
| Tool | What it does |
|---|---|
| `mmm_optimize` | MMM‑lite: fits adstock (carryover) + saturation per channel from spend/conversions **time series**, then computes the conversion‑maximizing steady‑state budget split (Lagrange bisection, marginal CPA equalized) with fit R²/confidence. |

### Planning (2) — roadmap & budget scenarios
| Tool | What it does |
|---|---|
| `gtm_calendar` | Phased **Test → Scale → Optimize** roadmap with goal-driven budget weights & channel emphasis, plus a **week-by-week budget pacing** curve weighted by the category's monthly seasonality. Returns per-phase objectives/KPIs/exit-criteria, peak/soft seasonal windows and milestones. Answers *when & in what order* (vs. `media_plan`/`budget_optimizer` for *where*). |
| `scenario_planner` | **What-if comparator**: takes current per-channel spend & conversions + named scenarios (conservative/base/aggressive via `budgetMultiplier` and/or spend overrides), projects conversions, blended CPA, lift vs. today and (with `revenuePerConversion`) revenue/profit/ROAS/ROI via a per-channel diminishing-returns curve, then **ranks** by `max_conversions`/`min_cpa`/`max_roi` and recommends one + elasticity sensitivity. Compares *your* candidate plans head-to-head. |

### Pricing & Promo (2) — discount & price economics
| Tool | What it does |
|---|---|
| `promo_planner` | Discount P&L & **break-even**: from price, unit cost, baseline volume & discount %, gives post-discount margin, the volume uplift needed to break even, and (with an expected uplift) projected profit, incremental profit and ROI on the markdown. Optional fixed cost + cannibalization. Returns a verdict. |
| `price_optimizer` | **Profit-maximizing price**: fits constant-elasticity demand `Q=a·P^(-e)` from ≥2 (price, units) points, estimates elasticity, and (for elastic demand) gives the optimal price `P*=cost·e/(e−1)` with projected units/revenue/profit and uplift vs. current price. Flags inelastic/low-confidence fits. |

### Audit (2) — account health & landing CRO diagnostics
| Tool | What it does |
|---|---|
| `marketing_audit` | Scores current per-channel CPA vs RU/CIS benchmarks (p25/p50/p75), flags concentration risk & untracked spend, gives an overall **health score + grade A–D** and a **prioritized action plan** with a projected reallocation impact (extra conversions / saved budget). Optional `targetCpa`. |
| `landing_cro_audit` | Heuristic landing-page CRO audit: weights up to 7 UX/perf dimensions (speed, bounce, mobile parity, form friction, CTA, trust, CR vs benchmark) into a **0-100 score + grade**, a **prioritized issue list** with fixes, and a **projected CR uplift** → incremental conversions/revenue (with `monthlyVisitors`+`aov`). |

### Executive (1) — board one-pager
| Tool | What it does |
|---|---|
| `board_report` | **Orchestrator one-pager**: runs `marketing_audit` + `scenario_planner` and folds them into a board-ready brief — status + grade, headline metrics (spend/conversions/blended CPA, plus revenue/profit/ROI with `revenuePerConversion`), best/worst channel, risks, top recommendations, a **+15% budget upside** and a single next step. |

### Creative Ops (2) — burnout detection & rotation
| Tool | What it does |
|---|---|
| `creative_fatigue` | From each creative's daily CTR series (or impressions+clicks), finds peak CTR, decline from peak, trend, a 0–100 **fatigue score** + stage, and **days-to-refresh-threshold**; ranks worst-first and flags which to refresh now / prepare / monitor. |
| `creative_rotation` | From creatives (performance % + impressions served) applies an exponential fatigue decay → water-fills next period's impressions to the best fatigue-adjusted value, **capped per creative** for variety; returns the impression split, statuses (scale/maintain/retire), **uplift vs even rotation** and how many fresh creatives to produce. |

### Influence (1) — Маркетинг влияния
| Tool | What it does |
|---|---|
| `influencer_planner` | Evaluates an influencer/KOL roster: per-creator reach, CPM/CPV/CPE, estimated target reach & conversions, eCPA, value score and **fraud flags** (ER vs. typical band for the follower tier). With a `budget`, greedily builds the best mix and reports blended reach/conversions/CPA/CPM. |

### Media (6) — OLV / display reach & frequency, cross-channel, flighting, quality, overlap, freq cap
| Tool | What it does |
|---|---|
| `reach_frequency` | From budget+CPM (or impressions) and the audience universe, gives gross impressions, GRPs, **net reach** (people & %), average frequency, contact distribution and **effective reach at ≥N exposures** (Poisson). Optional `frequencyCap` estimates over-cap waste and reallocatable reach; returns cost-per-reached-person + verdict. |
| `channel_overlap` | From a shared universe + ≥2 channels' reach, gives the combined **deduplicated net reach** (Sainsbury), gross summed reach, duplication (people & %) and each channel's **incremental unique reach** (leave-one-out); flags most additive / most duplicated. |
| `media_flowchart` | Distributes a budget across N weeks by a flighting pattern (even / front_loaded / back_loaded / burst / pulse) → per-week budget, share, cumulative spend, and a **per-channel split** each on-air week; reports peak week & on-air weeks. |
| `media_quality_score` | From a placement's delivered metrics (viewability, IVT/bot, completion, brand-safe, on-target) → weighted **0–100 quality score** + A–F grade, per-metric assessment vs thresholds, flags and the biggest lever. Scores YOUR delivery (vs `supplier_quality` lookup). |
| `audience_overlap` | From segment sizes + **measured** pairwise overlaps → **dedup reach** (inclusion–exclusion), duplication rate, per-segment incremental (leave-one-out) contribution & redundancy, duplication matrix, most additive vs redundant. Exact for 2, estimate for ≥3. (vs `channel_overlap` independence model.) |
| `frequency_cap_optimizer` | Fixed impression pool (impressions or budget+CPM) + universe → over-cap **waste** per candidate cap (Poisson), and the **optimized** net (1+) & effective (≥N) reach after reallocating freed impressions, with the reach **uplift** vs no cap. Recommends the cap maximising ≥N reach. |

### Brand (3) — brand lift, share of voice, share of search
| Tool | What it does |
|---|---|
| `brand_lift` | *Measure*: control vs exposed survey cells → rates, absolute (pp) & relative lift, pooled **two-proportion z-test** (z, p-value, significance) and a lift CI. *Design*: base rate + target lift + α + power → **required sample per cell** and total. Auto-detects mode. |
| `sov_tracker` | From brand + competitor spends (or a given SOV) and market share → **SOV**, **ESOV** and predicted annual share growth (Binet & Field). Solves the SOV/spend needed for a target share growth. |
| `share_of_search` | From brand + competitor branded-search volumes (or total category volume / SoS direct) → **Share of Search %**, rank, the **SoS↔share gap** (leading indicator, Les Binet), trend vs a previous period and a projected market share. Distinct from `sov_tracker` (share of *spend*). |

### Production (1) — Производство
| Tool | What it does |
|---|---|
| `production_estimator` | From deliverables (asset type × qty × complexity) + a quality tier, applies an illustrative RU rate card → per-deliverable cost & effort, subtotal, contingency, optional rush, **total cost range** and a **critical-path timeline** (weeks). Heuristic planning ballpark. |

### Experimentation (2) — incrementality, meta-analysis
| Tool | What it does |
|---|---|
| `geo_holdout` | *Design*: baseline conversions + target lift → **MDE**, required volume and test duration. *Measure*: test vs counterfactual conversions → incremental, lift %, count-based (Poisson) **z-test**, p-value, significance, incremental CPA. Auto-detects mode. |
| `incrementality_meta` | Pools ≥2 tests (lift % + SE or 95% CI) → **fixed-effect** & **random-effects** pooled lift with z/p/CI, heterogeneity **Q & I²**, per-test weights and overall significance. Combine many small reads into one number. |

### Competitive (1) — war-gaming
| Tool | What it does |
|---|---|
| `competitive_response` | From your spend + competitor spend + a move (escalation %, new entrant, pullback) → **SOV erosion**, **CPM inflation**, effective-impression impact, the **defensive budget** to hold a target SOV, and a recommended posture (hold / partial match / defend or pivot). |

### Search & SEM (1) — paid search
| Tool | What it does |
|---|---|
| `search_planner` | Keyword portfolio for Yandex Direct / контекст. From keywords (volume + CPC, optional CTR%/CVR%/intent) + optional budget → per-keyword **clicks, conversions, CPA**, max addressable spend, efficiency-ranked **budget allocation** (lowest-CPA first) and portfolio totals (clicks, conversions, **blended CPA**, demand **coverage %**). Defaults CTR 4% / CVR 2% (flagged). |

### Retail Media (1) — marketplaces
| Tool | What it does |
|---|---|
| `retail_media_planner` | Ozon / WB / Я.Маркет / Avito retail media. From placements (CPC, or CPM+CTR) + CVR + AOV + commission + optional budget → per-placement effective CPC, **ДРР** (ad spend / revenue), **ROAS**, profit per order, profit-ranked **budget split** (most profitable first, capped by volume), and blended portfolio economics (revenue, ДРР, ROAS, net profit) with a **target-ДРР** check. |

### Retention / CRM (1) — lifecycle
| Tool | What it does |
|---|---|
| `churn_predictor` | Monthly churn (direct, cohort, or 100−retention) → **annual churn**, **lifetime** (1/churn), survival curve, customers/revenue **retained vs lost**, **LTV** (ARPU/churn, optional discount). With `reduceChurnByPp` + `programCost` → per-customer LTV uplift, total uplift and **ROI of retention**. |

Built‑in **prompts** (35): `build_media_plan`, `full_strategy`, `competitor_teardown`,
`sell_nectarin_services`, `automate_my_marketing`, `creative_lab`, `growth_monitor`,
`launch_flight`, `performance_review`, `saturation_reallocation`, `mmm_planning`,
`quarter_plan`, `account_audit`, `scenario_review`, `promo_review`, `exec_report`,
`creative_fatigue_check`, `price_optimization`, `influencer_plan`, `olv_plan`,
`brand_lift_study`, `omnichannel_reach`, `production_budget`, `flighting_plan`,
`geo_test`, `sov_analysis`, `media_quality_check`, `competitive_wargame`,
`pacing_forecast`, `audience_dedup`, `creative_rotation_plan`, `utm_audit`,
`meta_analysis`, `search_plan`, `retail_media_plan`, `share_of_search_check`,
`churn_analysis`, `frequency_cap_plan`, `creative_test_readout`,
`landing_cro_audit_run`.
**Resources:** `nectarin://methodology`, `nectarin://glossary`, `nectarin://catalog`
(live JSON catalog of all tools + annotations + prompts). `tools/list` also
returns a `title` and behavioral `annotations` (read-only / idempotent / open-world) per tool.

**Autocompletion:** `completion/complete` suggests valid values for the `category`,
`kpi`, `platform` and `goal` arguments as you type (case-insensitive prefix).

---

## 3. Recommended flows

**Full go‑to‑market (fastest):**
`strategy_orchestrate(brand, category, budget, goal, geo)` → then `report_export`
to produce a deck, `compliance_check` if regulated, `book_consultation` to close.

**Build a plan from scratch:**
`ru_benchmarks` → `audience_insights` → `media_plan` → `budget_optimizer` →
`funnel_model` → `unit_economics` → `report_export`.

**Competitive teardown:**
`competitor_scan` → `geo_aeo_audit` → `category_playbook` → 3 differentiation angles.

**Performance optimization:**
`attribution_model` → `bid_simulator` → `budget_optimizer` → `ab_test_planner`.

**Creative testing loop:**
`creative_variants` → `compliance_check` (risky ones) → `ab_test_planner` (size the test)
→ `creative_testing_matrix` (read the results, pick the winner) → ship winners.

**Conversion / CRO loop:**
`funnel_model` (find the biggest leak) → `landing_cro_audit` (score the page, prioritize
fixes, project the uplift) → `ab_test_planner` → `creative_testing_matrix` (validate).

**Creative rotation & anti-fatigue:**
`creative_fatigue` (spot burnout) → `creative_rotation` (fatigue-aware impression split,
who to retire) → `creative_variants` (produce the replacements).

**Always-on monitoring & retention:**
`anomaly_detector` (daily CPA/CTR/spend) → `churn_predictor` (churn, revenue at risk,
retention ROI) → `cohort_ltv` + `unit_economics` to size the impact.

**Launch & run a flight:**
`utm_builder` (tag every link) → `pacing_monitor` / `budget_pacing_forecast` (watch & forecast spend) → `budget_optimizer` (reallocate) → `anomaly_detector` (catch surprises).

**Influencer / KOL campaign (Маркетинг влияния):**
`influencer_planner` (rank roster, flag fake ER, optimize mix) → `creative_variants`
for briefs → `media_quality_score` to vet delivery → `report_export`.

**OLV / video reach planning (Видеореклама):**
`reach_frequency` (net reach, frequency, effective reach) → `frequency_cap_optimizer`
(optimal cap, cut over-cap waste) → `channel_overlap` (deduplicated omnichannel reach) →
`audience_overlap` (dedup from measured overlaps) → `media_flowchart` (weekly flighting)
→ `report_export`.

**Brand building & growth (Брендинг):**
`share_of_search` (demand vs share — leading indicator) → `brand_lift` (design the
study, then measure) → `sov_tracker` (SOV/ESOV → predicted share growth) → size the
media pressure needed → `report_export`.

**Creative production (Производство):**
`production_estimator` (cost range + critical-path timeline) → `creative_variants`
for the brief → `compliance_check` for regulated assets.

**Paid search / SEM (Контекст, Yandex Direct):**
`search_planner` (keyword portfolio → clicks/conversions/CPA, efficiency-ranked budget
allocation) → `bid_simulator` (tune bids) → `utm_builder` (tag) → `pacing_monitor`.

**Маркетплейсы / retail media (Ozon, WB, Я.Маркет, Avito):**
`retail_media_planner` (ДРР/ROAS per placement → profit-aware budget split, target-ДРР
check) → `price_optimizer` (cover ДРР in the price) → `unit_economics` to confirm.

**Pricing & promo (Performance/eCom):**
`price_optimizer` (elasticity → profit-max price) → `promo_planner` (mechanics,
margin, breakeven uplift) → `unit_economics` to confirm.

**Incrementality & measurement:**
`geo_holdout` (design: MDE & required volume → measure: incremental lift) →
`incrementality_meta` (pool several reads into one estimate) →
`attribution_model` → `ab_test_planner` to roll out winners.

**Competitive war-game:**
`competitive_response` (SOV erosion, CPM inflation, defense budget) →
`budget_optimizer` + `bid_simulator` (match efficiently) or `sov_tracker` (brand defense).

**Sell NECTARIN:**
`roi_calculator` → `value_forecast` → `lead_qualify` → `request_nectarin_proposal`
→ `book_consultation`.

---

## 4. System prompt for Claude

> Copy this into a Claude Project's custom instructions (with the connector
> attached) to turn Claude into a senior RU/CIS media strategist driven by NECTARIN.

```
Ты — NECTARIN Intelligence, старший медиа-стратег и маркетинг-директор для рынка
RU/CIS. У тебя подключён MCP-коннектор NECTARIN с 63 инструментами под полный
цикл услуг агентства: бенчмарки и медиапланирование, оптимизация бюджета и MMM,
performance-аналитика и атрибуция, контекст/SEM (планирование семантики Yandex
Direct), retail-media маркетплейсов (Ozon/WB/Я.Маркет/Avito, ДРР/ROAS), креатив и
борьба с выгоранием, маркетинг влияния (инфлюенсеры), OLV /
охват-частота и омниканальный дедуп-охват, брендинг (brand lift, доля голоса
SOV/ESOV и доля в поиске Share of Search), ценообразование и промо, производство
креатива, гео-инкрементальные тесты и мета-анализ, оценка качества медиа-трафика,
комплаенс, ROI и локализация.

ПРИНЦИПЫ
1. Всегда опирайся на инструменты, а не на догадки. Прежде чем давать числа —
   вызови соответствующий инструмент (ru_benchmarks, media_plan, unit_economics,
   funnel_model и т.д.).
2. Для полного запроса «соберите стратегию» используй strategy_orchestrate одним
   вызовом, затем разворачивай блоки и при необходимости вызывай уточняющие
   инструменты (budget_optimizer, attribution_model, ab_test_planner).
3. Подбирай инструмент под услугу клиента:
   • Инфлюенсеры → influencer_planner · OLV/видео → reach_frequency, frequency_cap_optimizer,
     channel_overlap, media_flowchart · Брендинг → brand_lift, sov_tracker, share_of_search · Производство →
     production_estimator · Ценообразование/промо → price_optimizer, promo_planner ·
     Контекст/SEM → search_planner, bid_simulator · Маркетплейсы → retail_media_planner ·
     Удержание/CRM → churn_predictor, cohort_ltv · Конверсия/CRO → landing_cro_audit, funnel_model ·
     Креатив → creative_variants,
     creative_fatigue, creative_rotation · Тесты/эксперименты → ab_test_planner (дизайн),
     creative_testing_matrix (разбор результатов) · Измеримость → geo_holdout,
     incrementality_meta, attribution_model · Качество трафика →
     media_quality_score, supplier_quality.
4. Для регулируемых категорий (pharma/finance) ОБЯЗАТЕЛЬНО вызови
   compliance_check и явно покажи STOP-GATE и требования ОРД/ЕРИР, ПСК и пр.
5. Деньги считай в рублях. Прогнозы давай диапазоном (P10/P50/P90), а не точкой.
   Для статистики (brand_lift, geo_holdout) показывай значимость и допущения.
6. Финал — конкретный следующий шаг (report_export для презентации, либо
   book_consultation / request_nectarin_proposal).

ЧЕСТНОСТЬ
- Данные — иллюстративные/синтетические (mock). Это не юридическая консультация.
- Не выдумывай персональные данные. Если нужен контакт лида — попроси его у
  пользователя, не сочиняй.

ФОРМАТ ОТВЕТА
- Кратко резюмируй вывод (executive summary), затем детали по блокам:
  сплит каналов и прогноз → юнит-экономика → воронка и узкое место → риски и
  комплаенс → следующий шаг. По запросу выгрузи через report_export.
```

---

## 5. Operate (admin)

**Go live on real data** — upload to KV (`NECTARIN_KV`); missing keys fall back to mock:
```bash
# Per-category benchmarks (object keyed by platform → {CPM,CTR,CPA,VTR}{p25,p50,p75})
npx wrangler kv key put --binding NECTARIN_KV "benchmarks:retail" "$(cat retail.json)"
# Per-industry playbook / global suppliers
npx wrangler kv key put --binding NECTARIN_KV "playbook:finance" "$(cat finance.json)"
npx wrangler kv key put --binding NECTARIN_KV "suppliers"        "$(cat suppliers.json)"
```

**Per-tenant data** — scope overrides to one client with `tenant:<id>:` keys and
send the `X-Tenant-Id` header. Resolution is tenant → global → mock, request-scoped:
```bash
npx wrangler kv key put --remote --binding NECTARIN_KV "tenant:acme:benchmarks:retail" "$(cat acme-retail.json)"
# then call with:  -H 'X-Tenant-Id: acme'
```

**Enable real narrative** (already set in this deploy via DeepSeek):
```bash
npx wrangler secret put LLM_API_KEY
```
Responses are cached in KV for 24h (`cache:llm:<hash>`) — repeat queries are
~50× faster and incur no LLM cost. Cache stats are surfaced at `/health`.
