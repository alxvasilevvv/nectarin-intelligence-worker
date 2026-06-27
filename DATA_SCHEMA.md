# DATA_SCHEMA.md — what NECTARIN must provide to go live

This is the **client handoff contract**. Today every tool reads synthetic data
through the `DataSource` interface in `src/data.ts` (default: `MockDataSource`).
To replace the mock with real NECTARIN data, implement that interface against KV,
D1, or an internal HTTP API (`KvDataSource` / `HttpDataSource` stubs are in
`src/data.ts`) and call `setDataSource(...)` **once** at the top of `fetch()` in
`src/index.ts`. No tool or orchestrator code changes.

The `DataSource` interface has exactly four read methods. Each maps to one
table/collection below:

| `DataSource` method | Backing table/collection | Consumed by tools |
|---|---|---|
| `getCategoryBenchmarks(category)` | `benchmarks` | `ru_benchmarks`, `media_plan`, `roi_calculator`, `value_forecast` |
| `getMetric(category, platform, kpi)` | `benchmarks` (single cell) | `media_plan`, `roi_calculator`, `value_forecast` |
| `getPlaybook(industry)` | `playbooks` | `category_playbook`, `media_plan` (compliance), `creative_brief`, `competitor_scan` (territories) |
| `getSuppliers()` | `suppliers` | `supplier_quality` |

> Enumerations used throughout — keep these stable or update `src/data.ts` constants:
> - **category / industry**: `realty`, `pharma`, `fmcg`, `retail`, `auto`, `finance`
> - **platform**: `VK Ads`, `Yandex Direct`, `Telegram Ads`, `OLV`
> - **kpi**: `CPM`, `CTR`, `CPA`, `VTR`
> - Currency is **RUB**; CTR/VTR are **percent** (e.g. `0.8` = 0.8%). Region **RU/CIS**.

---

## 1. `benchmarks` — advertising benchmark ranges

One row per **category × platform × KPI**, with 25th/50th/75th percentile values.
This is the most important table: it powers benchmarks, the media-plan forecast,
and all ROI/value math.

### Columns

| Column | Type | Notes |
|---|---|---|
| `category` | string (enum) | One of the 6 categories above. |
| `platform` | string (enum) | One of the 4 platforms above. |
| `kpi` | string (enum) | `CPM`, `CTR`, `CPA`, or `VTR`. |
| `p25` | number | 25th percentile. RUB for CPM/CPA; percent for CTR/VTR. |
| `p50` | number | Median. Used directly by the forecast math. |
| `p75` | number | 75th percentile. |

> Full coverage = 6 categories × 4 platforms × 4 KPIs = **96 rows**. Partial
> coverage is allowed; missing cells fall back to safe defaults (CPM 300, CTR 0.8,
> CPA 1500) in `forecastChannels`, but completeness improves accuracy.

### Example rows

| category | platform | kpi | p25 | p50 | p75 |
|---|---|---|---|---|---|
| finance | Yandex Direct | CPA | 1500 | 2600 | 4700 |
| finance | Yandex Direct | CPM | 300 | 460 | 690 |
| finance | Yandex Direct | CTR | 0.5 | 0.92 | 1.55 |
| fmcg | VK Ads | CPA | 220 | 410 | 720 |
| retail | OLV | VTR | 50 | 66 | 81 |

### KV / HTTP shapes
- **KV key** `benchmarks:<category>` → JSON `Record<platform, { CPM:{p25,p50,p75}, CTR:{…}, CPA:{…}, VTR:{…} }>`.
- **HTTP** `GET /benchmarks/:category` → same JSON object.

### Forecast math that reads this (do not change semantics)
```
impressions = spend / CPM.p50 * 1000
clicks      = impressions * (CTR.p50 / 100)
conversions = spend / CPA.p50
estReach    = totalImpressions * 0.62 * 0.45
blendedCPA  = totalBudget / totalConversions
```

---

## 2. `playbooks` — category go-to-market + compliance

One row per **industry/category**. Drives the playbook tool and the STOP-GATE
compliance flag used by `media_plan` and `creative_brief`.

### Columns

| Column | Type | Notes |
|---|---|---|
| `industry` | string (enum) | Category key. Primary key. |
| `regulated` | boolean (optional) | `true` → STOP-GATE (legal sign-off before launch). `pharma`/`finance` are always treated as regulated. |
| `territories` | string[] | Communication territories (also used as competitor territory labels). |
| `dos` | string[] | Recommended practices. |
| `donts` | string[] | Prohibited / risky practices. |
| `seasonalHooks` | string[] | Seasonal demand windows. |
| `complianceNotes` | string[] | Legal/regulatory notes (ОРД/ЕРИР, ПСК, 152-ФЗ, etc.). |

### Example row (abridged)

```json
{
  "industry": "finance",
  "regulated": true,
  "territories": ["Контроль и безопасность денег", "Рост капитала", "Удобство и скорость", "Доверие к бренду банка"],
  "dos": ["Раскрывать полную стоимость кредита (ПСК) и ставки", "Сегментировать по продуктам", "Акцент на лицензии"],
  "donts": ["Не указывать только минимальную ставку без диапазона", "Не гарантировать доходность инвестиций"],
  "seasonalHooks": ["Декабрь-январь: вклады под высокую ставку", "Март-апрель: ИИС/вычет"],
  "complianceNotes": ["ОБЯЗАТЕЛЬНО раскрытие существенных условий и ПСК", "Лицензия ЦБ РФ", "Маркировка ОРД/ЕРИР", "Юр-согласование ДО запуска"]
}
```

### KV / HTTP shapes
- **KV key** `playbook:<industry>` → JSON `Playbook`.
- **HTTP** `GET /playbooks/:industry` → JSON `Playbook`.

---

## 3. `suppliers` — inventory / supplier quality index

One row per **supplier × format**. Drives `supplier_quality` (scoring, fraud
filtering, recommended/avoid lists).

### Columns

| Column | Type | Notes |
|---|---|---|
| `id` | string | Stable unique id (e.g. `sup-yd-search`). Primary key. |
| `name` | string | Human-readable supplier/placement name. |
| `platform` | string (enum) | One of the 4 platforms. |
| `format` | string | Free text, e.g. `search text`, `instream video`, `in-feed native`. Matched by substring filter. |
| `qualityScore` | number (0–100) | Higher is better. |
| `fraudRisk` | enum `low`\|`medium`\|`high` | `high` → listed in `avoid`. |
| `viewability` | number (0–1) | Fraction. |
| `humanTraffic` | number (0–1) | Fraction (1 − bot share). |
| `categoriesStrong` | string[] | Categories this supplier performs well in (gives a +4 score nudge). |

### Example rows

| id | name | platform | format | qualityScore | fraudRisk | viewability | humanTraffic | categoriesStrong |
|---|---|---|---|---|---|---|---|---|
| sup-yd-search | Yandex Direct — Search | Yandex Direct | search text | 93 | low | 0.99 | 0.98 | finance, realty, auto, pharma |
| sup-tg-gray | TG Gray-list Channels | Telegram Ads | channel post | 42 | high | 0.38 | 0.61 | (none) |

> `recommendedFormats` = formats where `qualityScore ≥ 80 AND fraudRisk = low`.
> `avoid` = names where `fraudRisk = high`.

### KV / HTTP shapes
- **KV key** `suppliers` → JSON `Supplier[]`.
- **HTTP** `GET /suppliers` → JSON `Supplier[]`.

---

## What does NOT come from this data layer

These tools are deterministic/synthetic and need **no** external data (though you
may later wire richer sources):

- `audience_insights`, `competitor_scan` (uses `playbooks.territories` only),
  `geo_aeo_audit`, `creative_brief`, `report_explain` — narrative/heuristic.
- All **Growth & Automation** tools derive their numbers from the `benchmarks`
  table via the data layer (CPA p25/p50) plus the `AOV_BY_CATEGORY` assumptions
  hard-coded in `src/growth.ts` — confirm those AOV figures with NECTARIN before
  presenting ROI numbers as anything but illustrative.
- Narrative copy goes through `callLLM()` in `src/orchestrator.ts` (a stub) — swap
  it for an Anthropic/OpenAI `fetch()` (key via `wrangler secret`) for real text.

## Go-live checklist for NECTARIN

1. Provide the three datasets above (CSV/JSON/DB export) keyed by the listed enums.
2. Pick a backing store: KV (simple, eventually consistent) or an internal HTTP API.
3. Implement `KvDataSource` or `HttpDataSource` in `src/data.ts` (stubs included).
4. Add the binding/secret in `wrangler.toml` and `setDataSource(...)` in `fetch()`.
5. Confirm/replace `AOV_BY_CATEGORY` and `NECTARIN_CPA_IMPROVEMENT` in `src/growth.ts`.
6. (Optional) Wire `callLLM()` to a real model for narrative output.
