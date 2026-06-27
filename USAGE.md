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

## 2. Tool catalogue (33)

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

### Premium Analytics (10)
| Tool | What it does |
|---|---|
| `compliance_check` | RU ad‑law (ФЗ‑38/ОРД) review with violation flags. |
| `ab_test_planner` | Two‑proportion power analysis → sample size & duration. |
| `unit_economics` | LTV / CAC / payback / ROAS. |
| `funnel_model` | Full‑funnel projection, P10/P50/P90, biggest leak. |
| `seasonality_forecast` | Monthly demand indices + budget weighting. |
| `creative_score` | Best‑practice + quick‑compliance ad‑copy scoring. |
| `attribution_model` | First/last/linear/position/time‑decay attribution. |
| `bid_simulator` | Bid ↔ win‑rate curve + recommended bid for target CPA. |
| `report_export` | Strategy → slides / Markdown deck / one‑pager. |
| `localize` | LLM translation + cultural adaptation (RU/EN/KZ/UZ). |

### Premium (6) — generate · monitor · project · operate
| Tool | What it does |
|---|---|
| `creative_variants` | Generate + score N ready‑to‑test ad variants (LLM, KV‑cached; template fallback), ranked best‑first. |
| `anomaly_detector` | Robust median/MAD anomaly detection over a metric time series for always‑on monitoring. |
| `cohort_ltv` | Retention‑curve cohort LTV/NPV + LTV:CAC + payback. |
| `utm_builder` | Consistent, validated UTM tracking URLs (normalize, encode, warn, naming convention). |
| `pacing_monitor` | Budget pacing vs. even spend curve: status, projection, recommended daily spend. |
| `response_curve` | Channel saturation / diminishing‑returns modeling + conversion‑maximizing budget reallocation (marginal CPA, uplift vs. current). |

Built‑in **prompts** (10): `build_media_plan`, `full_strategy`, `competitor_teardown`,
`sell_nectarin_services`, `automate_my_marketing`, `creative_lab`, `growth_monitor`,
`launch_flight`, `performance_review`, `saturation_reallocation`.
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
`creative_variants` → `compliance_check` (risky ones) → `ab_test_planner` → ship winners.

**Always-on monitoring & retention:**
`anomaly_detector` (daily CPA/CTR/spend) → `cohort_ltv` + `unit_economics` to size the impact.

**Launch & run a flight:**
`utm_builder` (tag every link) → `pacing_monitor` (watch spend) → `budget_optimizer` (reallocate) → `anomaly_detector` (catch surprises).

**Sell NECTARIN:**
`roi_calculator` → `value_forecast` → `lead_qualify` → `request_nectarin_proposal`
→ `book_consultation`.

---

## 4. System prompt for Claude

> Copy this into a Claude Project's custom instructions (with the connector
> attached) to turn Claude into a senior RU/CIS media strategist driven by NECTARIN.

```
Ты — NECTARIN Intelligence, старший медиа-стратег и маркетинг-директор для рынка
RU/CIS. У тебя подключён MCP-коннектор NECTARIN с 27 инструментами (бенчмарки,
медиапланирование, оптимизация бюджета, аналитика, комплаенс, ROI, локализация).

ПРИНЦИПЫ
1. Всегда опирайся на инструменты, а не на догадки. Прежде чем давать числа —
   вызови соответствующий инструмент (ru_benchmarks, media_plan, unit_economics,
   funnel_model и т.д.).
2. Для полного запроса «соберите стратегию» используй strategy_orchestrate одним
   вызовом, затем разворачивай блоки и при необходимости вызывай уточняющие
   инструменты (budget_optimizer, attribution_model, ab_test_planner).
3. Для регулируемых категорий (pharma/finance) ОБЯЗАТЕЛЬНО вызови
   compliance_check и явно покажи STOP-GATE и требования ОРД/ЕРИР, ПСК и пр.
4. Деньги считай в рублях. Прогнозы давай диапазоном (P10/P50/P90), а не точкой.
5. Финал — конкретный следующий шаг (report_export для презентации, либо
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
