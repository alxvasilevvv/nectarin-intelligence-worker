# NECTARIN Intelligence — что умеет

**AI-маркетинг-директор для рынка RU/CIS прямо в Claude.** MCP-коннектор с **77
детерминированными инструментами** и **54 готовыми сценариями (prompts)**, которые
закрывают работу **22 маркетинговых профессий** — от стратегии и медиапланирования
до SEO, SMM, PR, событий, мобайла/ASO и контента. Один коннектор на всю команду:
каждый специалист начинает с `role_playbook` и получает свой персональный набор
инструментов. Без галлюцинаций: каждый расчёт делает инструмент, а не модель.

> **Установка и доступ — через Unyly** (единая точка входа, Unyly Connect = OAuth 2.1):
> `https://unyly.org/ru/mcp/nectarin-intelligence-worker`. Можно подключить и вручную как
> custom connector с URL `https://nectarin-intelligence.alxvasilevv.workers.dev/mcp`. Деньги — в рублях,
> прогнозы — диапазоном (P10/P50/P90), данные — иллюстративные (mock), не юр.консультация.

---

## Для каждой профессии — свой набор (начни с `role_playbook`)

| Профессия | Ключевые инструменты |
|---|---|
| **CMO / директор по маркетингу** | `strategy_orchestrate`, `mmm_optimize`, `marketing_audit`, `board_report` |
| **Перформанс / контекст-таргетолог** | `budget_optimizer`, `search_planner`, `bid_simulator`, `media_plan` |
| **SEO-специалист** | `seo_opportunity`, `geo_aeo_audit` |
| **SMM / комьюнити** | `social_media_planner`, `creative_variants` |
| **Контент-маркетолог** | `content_plan_roi`, `creative_brief` |
| **Бренд-менеджер** | `brand_lift`, `share_of_search`, `sov_tracker` |
| **Медиапленер (OLV)** | `reach_frequency`, `frequency_cap_optimizer`, `channel_overlap` |
| **CRM / email / lifecycle** | `rfm_segmenter`, `churn_predictor`, `email_campaign_planner`, `cohort_ltv` |
| **Маркетплейсы / e-com** | `retail_media_planner`, `price_optimizer`, `promo_planner` |
| **Инфлюенс-маркетолог** | `influencer_planner` |
| **PR / коммуникации** | `pr_value_estimator`, `share_of_search` |
| **Аналитик / data** | `incrementality_meta`, `geo_holdout`, `mmm_optimize`, `attribution_model` |
| **Продуктовый маркетолог / GTM** | `gtm_calendar`, `strategy_orchestrate`, `value_forecast` |
| **Партнёрский / CPA** | `affiliate_program_planner` |
| **Growth-маркетолог** | `funnel_model`, `landing_cro_audit`, `ab_test_planner`, `creative_testing_matrix` |
| **Event / field-маркетолог** | `event_roi_planner` |
| **Мобильный маркетолог / ASO** | `aso_planner` |
| **Креатив / дизайн / продакшн** | `creative_brief`, `creative_variants`, `creative_score`, `production_estimator` |
| **Ценообразование / промо** | `price_optimizer`, `promo_planner` |
| **Комплаенс / юрист** | `compliance_check` |
| **Агентство / аккаунт** | `strategy_orchestrate`, `report_export`, `marketing_audit` |
| **Marketing Ops / автоматизация** | `utm_builder`, `utm_taxonomy_qa`, `automation_recipe` |

---

## Под каждую услугу — свой инструмент

> Любую из услуг ниже можно вызвать напрямую; чтобы выдать сотруднику весь его
> персональный набор под профессию — начни с `role_playbook(role="…")`.

| Услуга Nectarin | Что спросить Claude | Инструменты |
|---|---|---|
| **Стратегия и медиапланирование** | «Собери стратегию запуска под бюджет X» | `strategy_orchestrate`, `media_plan`, `ru_benchmarks`, `audience_insights`, `budget_optimizer` |
| **Performance & аналитика** | «Куда переложить бюджет? Где аномалии? Уложусь ли в бюджет? Чистая ли разметка?» | `attribution_model`, `bid_simulator`, `mmm_optimize`, `anomaly_detector`, `pacing_monitor`, `budget_pacing_forecast`, `utm_builder`, `utm_taxonomy_qa`, `funnel_model`, `cohort_ltv`, `unit_economics` |
| **SEO (органика)** | «Оцени потенциал роста по ключам, найди быстрые победы» | `seo_opportunity` (позиция→CTR→трафик→конверсии→ценность, quick wins стр.2→1), `geo_aeo_audit` (видимость в AI-поиске) |
| **SMM / соцсети** | «Спрогнозируй охват, вовлечение и прирост подписчиков» | `social_media_planner` (по площадкам: охват, ER, рост базы, выручка) |
| **Контент-маркетинг** | «Посчитай ROI контент-плана и окупаемость» | `content_plan_roi` (контент как компаундящийся актив, payback, рантрейт) |
| **PR / коммуникации** | «Оцени ценность размещений и долю голоса» | `pr_value_estimator` (дедуп-охват, качество tier×тональность, earned SOV) |
| **События / вебинары** | «Посчитай ROI мероприятия» | `event_roi_planner` (воронка рег→участ→лиды→сделки, стоимость лида, ROI) |
| **Мобайл / ASO** | «Посчитай воронку стора и экономику установок» | `aso_planner` (показы→установки→LTV, платный UA LTV/CPI, ASO-сценарий) |
| **Маркетинг влияния (инфлюенсеры)** | «Оцени ростер блогеров и собери микс» | `influencer_planner` (ER-аномалии/фрод, CPM/CPV/CPE, eCPA, оптимизация микса) |
| **Видеореклама / OLV** | «Спланируй охват и частоту, убери дубли и переплату по частоте» | `reach_frequency` (net reach, эфф. охват ≥N), `frequency_cap_optimizer` (оптимальная частотная отсечка, убрать переизбыток), `channel_overlap` (дедуп по независимости), `audience_overlap` (дедуп по измеренным пересечениям), `media_flowchart` (флайтинг по неделям) |
| **Брендинг** | «Замерь brand lift, оцени долю голоса и долю в поиске» | `brand_lift` (z-тест/дизайн выборки), `sov_tracker` (SOV/ESOV → рост доли, Binet & Field), `share_of_search` (доля в поиске как опережающий индикатор доли рынка, Les Binet) |
| **Ценообразование и промо** | «Найди прибыльную цену и механику акции» | `price_optimizer` (эластичность → profit-max цена), `promo_planner` (маржа, breakeven uplift) |
| **Креатив** | «Сгенерируй варианты, проверь на выгорание, оптимизируй ротацию» | `creative_variants`, `creative_fatigue` (детектор выгорания по CTR-тренду), `creative_rotation` (распределение показов против выгорания) |
| **Контекст / SEM** | «Собери семантику и распредели бюджет на Директ» | `search_planner` (клики/конверсии/CPA по ключам, распределение бюджета от самых эффективных, blended CPA, покрытие спроса), `bid_simulator` |
| **Маркетплейсы / retail media** | «Спланируй размещения на Ozon/WB и посчитай ДРР» | `retail_media_planner` (ДРР/ROAS по площадкам, прибыль после комиссии, распределение бюджета от самых прибыльных, проверка целевого ДРР) |
| **Удержание / CRM** | «Посчитай отток и сегментируй базу для удержания» | `churn_predictor` (месячный/годовой отток, срок жизни, LTV, выручка под риском, ROI удержания), `rfm_segmenter` (RFM-сегменты с размером, долей выручки и действием на сегмент), `cohort_ltv` |
| **Email / рассылки** | «Посчитай экономику рассылок и частоту» | `email_campaign_planner` (воронка рассылки, RPE, выручка/мес и /год, отписки, полужизнь списка, ROI) |
| **Партнёрки / CPA** | «Посчитай экономику партнёрской программы» | `affiliate_program_planner` (по партнёрам: заказы, выплата, EPC, ROAS, прибыль; потолок комиссии margin/(1+fee); убыточные партнёры) |
| **Производство** | «Оцени бюджет и сроки продакшна» | `production_estimator` (диапазон бюджета ±20%, критический путь по срокам) |
| **Измеримость** | «Спроектируй, замерь и объедини инкремент-тесты» | `geo_holdout` (MDE, нужный объём → инкремент, значимость), `incrementality_meta` (мета-анализ нескольких тестов), `ab_test_planner` |
| **Тесты креативов / лендингов** | «Спланируй A/B и разбери результаты» | `ab_test_planner` (дизайн и размер выборки), `creative_testing_matrix` (разбор результатов мульти-вариантного теста: победитель/значимость/дотест) |
| **Конверсия / CRO** | «Проведи CRO-аудит лендинга и оцени потенциал роста» | `landing_cro_audit` (0-100 оценка, приоритет проблем, прогноз роста конверсии и выручки), `funnel_model` (где течёт воронка) |
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
- **Один коннектор на всю команду.** 22 профессии — от CMO до SEO, SMM, PR, CRM,
  аналитика, мобайла и контента — работают в одном инструменте. `role_playbook`
  выдаёт каждому его персональный набор. Установка и доступ — через **Unyly**.
- **54 готовых сценария + скилы.** Нажал prompt или вызвал `marketing_skill` — Claude сам вызывает нужные инструменты в
  правильном порядке (медиаплан, brand lift, гео-тест, флайтинг, доля голоса и т.д.).

---

## Быстрые сценарии

- **Онбординг сотрудника:** `role_playbook(role="…")` → первый инструмент потока на реальной задаче.
- **SEO:** `seo_opportunity` → `content_plan_roi` → `landing_cro_audit`.
- **SMM:** `social_media_planner` → `creative_variants` → `creative_score`.
- **PR:** `pr_value_estimator` → `share_of_search` → `sov_tracker`.
- **События:** `event_roi_planner` → `lead_qualify`.
- **Мобайл/ASO:** `aso_planner` → `unit_economics` → `cohort_ltv`.
- **Go-to-market:** `strategy_orchestrate` → `report_export` → `book_consultation`.
- **OLV-охват:** `reach_frequency` → `frequency_cap_optimizer` → `channel_overlap` / `audience_overlap` → `media_flowchart`.
- **Бренд-рост:** `share_of_search` → `brand_lift` → `sov_tracker` → нужное медиадавление.
- **Инфлюенсеры:** `influencer_planner` → `media_quality_score` → `report_export`.
- **Инкремент:** `geo_holdout` (дизайн → замер) → `incrementality_meta` → `attribution_model`.
- **Контекст/SEM:** `search_planner` → `bid_simulator` → `utm_builder`.
- **Маркетплейсы:** `retail_media_planner` → `price_optimizer` → `unit_economics`.
- **Удержание:** `churn_predictor` → `rfm_segmenter` → `email_campaign_planner` → `cohort_ltv` → `unit_economics`.
- **Конверсия/CRO:** `funnel_model` → `landing_cro_audit` → `ab_test_planner` → `creative_testing_matrix`.
- **Цена и промо:** `price_optimizer` → `promo_planner` → `unit_economics`.
- **Конкурентная война:** `competitive_response` → `budget_optimizer` / `sov_tracker`.

---

*NECTARIN Intelligence · 77 инструментов · 54 сценария · 22 профессии · установка через Unyly
(`connect_via_unyly`) · Cloudflare Workers (edge, MCP Streamable HTTP). Подробности — в `README.md` и `USAGE.md`.*
