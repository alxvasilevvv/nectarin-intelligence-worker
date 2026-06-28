# NECTARIN Intelligence — что умеет

**AI-маркетинг-директор для рынка RU/CIS прямо в Claude.** MCP-коннектор с **52
детерминированными инструментами** и **29 готовыми сценариями (prompts)**, которые
закрывают полный цикл услуг агентства — от стратегии и медиапланирования до
измеримости, брендинга и производства. Без галлюцинаций: каждый расчёт делает
инструмент, а не модель.

> Подключение за 1 минуту: Claude → Settings → Connectors → Add custom connector →
> `https://nectarin-intelligence.alxvasilevv.workers.dev/mcp`. Деньги — в рублях,
> прогнозы — диапазоном (P10/P50/P90), данные — иллюстративные (mock), не юр.консультация.

---

## Под каждую услугу — свой инструмент

| Услуга Nectarin | Что спросить Claude | Инструменты |
|---|---|---|
| **Стратегия и медиапланирование** | «Собери стратегию запуска под бюджет X» | `strategy_orchestrate`, `media_plan`, `ru_benchmarks`, `audience_insights`, `budget_optimizer` |
| **Performance & аналитика** | «Куда переложить бюджет? Где аномалии? Уложусь ли в бюджет?» | `attribution_model`, `bid_simulator`, `mmm_optimize`, `anomaly_detector`, `pacing_monitor`, `budget_pacing_forecast`, `funnel_model`, `cohort_ltv`, `unit_economics` |
| **Маркетинг влияния (инфлюенсеры)** | «Оцени ростер блогеров и собери микс» | `influencer_planner` (ER-аномалии/фрод, CPM/CPV/CPE, eCPA, оптимизация микса) |
| **Видеореклама / OLV** | «Спланируй охват и частоту» | `reach_frequency` (net reach, эфф. охват ≥N), `channel_overlap` (дедуп-охват), `media_flowchart` (флайтинг по неделям) |
| **Брендинг** | «Замерь brand lift, оцени долю голоса» | `brand_lift` (z-тест/дизайн выборки), `sov_tracker` (SOV/ESOV → рост доли, Binet & Field) |
| **Ценообразование и промо** | «Найди прибыльную цену и механику акции» | `price_optimizer` (эластичность → profit-max цена), `promo_planner` (маржа, breakeven uplift) |
| **Креатив** | «Сгенерируй варианты, проверь на выгорание» | `creative_variants`, `creative_fatigue` (детектор выгорания по CTR-тренду) |
| **Производство** | «Оцени бюджет и сроки продакшна» | `production_estimator` (диапазон бюджета ±20%, критический путь по срокам) |
| **Измеримость** | «Спроектируй и замерь инкремент» | `geo_holdout` (MDE, нужный объём → инкремент, значимость), `ab_test_planner` |
| **Качество трафика** | «Оцени качество доставки площадки» | `media_quality_score` (viewability/IVT/brand-safety → 0–100, грейд A–F), `supplier_quality` |
| **Комплаенс и локализация** | «Проверь рекламу pharma/finance, локализуй» | `compliance_check` (ОРД/ЕРИР, ПСК, STOP-GATE), `localize`, `geo_aeo_audit` |
| **Конкуренты** | «Разбери конкурента, смоделируй его ход» | `competitor_scan`, `category_playbook`, `competitive_response` (SOV-эрозия, CPM-инфляция, защитный бюджет) |
| **Продажа услуг Nectarin** | «Посчитай ROI и подготовь предложение» | `roi_calculator`, `value_forecast`, `lead_qualify`, `request_nectarin_proposal`, `book_consultation` |

---

## Почему это сильно

- **Детерминированно и честно.** Регрессии, z-тесты, модели Пуассона, эластичность,
  Sainsbury-дедупликация — реальная медиа-математика, а не «придуманные» числа.
  У каждого вывода — методология, допущения и дисклеймер.
- **Заточено под RU/CIS.** Бенчмарки и плейбуки VK Ads, Yandex Direct, Telegram Ads,
  OLV, Avito; комплаенс ОРД/ЕРИР; рубли по умолчанию.
- **Полный цикл за один разговор.** От `strategy_orchestrate` одним вызовом до
  выгрузки презентации `report_export` и записи на консультацию.
- **29 готовых сценариев.** Нажал prompt — Claude сам вызывает нужные инструменты в
  правильном порядке (медиаплан, brand lift, гео-тест, флайтинг, доля голоса и т.д.).

---

## Быстрые сценарии

- **Go-to-market:** `strategy_orchestrate` → `report_export` → `book_consultation`.
- **OLV-охват:** `reach_frequency` → `channel_overlap` → `media_flowchart`.
- **Бренд-рост:** `brand_lift` → `sov_tracker` → нужное медиадавление.
- **Инфлюенсеры:** `influencer_planner` → `media_quality_score` → `report_export`.
- **Инкремент:** `geo_holdout` (дизайн → замер) → `attribution_model`.
- **Цена и промо:** `price_optimizer` → `promo_planner` → `unit_economics`.
- **Конкурентная война:** `competitive_response` → `budget_optimizer` / `sov_tracker`.

---

*NECTARIN Intelligence · 52 инструмента · 29 сценариев · Cloudflare Workers (edge,
MCP Streamable HTTP). Подробности — в `README.md` и `USAGE.md`.*
