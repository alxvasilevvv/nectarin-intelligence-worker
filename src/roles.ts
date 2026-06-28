/**
 * ROLES / ADOPTION tool group (v2.46) for NECTARIN Intelligence — Workers.
 *
 *   • role_playbook — the adoption engine. A marketer states their profession/role
 *     (RU or EN, free-text with alias matching) and gets a TAILORED playbook: the
 *     exact tools for that role (with a role-specific reason to use each), the
 *     supporting toolkit, an ordered end-to-end workflow, the KPIs that role owns,
 *     and example questions to ask. Called with no role, it lists every supported
 *     profession so leadership can see the breadth of coverage in one place.
 *
 * This is what makes EVERY specialist on a team — not just the CMO — have a
 * first-class reason to use the connector, all through one Unyly install.
 *
 * Deterministic, curated mapping. No LLM, no PII.
 */

import type { ToolDef, ToolResult } from "./tools.js";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function toContent(summary: string, payload: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: "```json\n" + JSON.stringify(payload, null, 2) + "\n```" },
    ],
    structuredContent: isRecord(payload) ? payload : { result: payload },
  };
}

/** Short RU one-liner per tool — keeps role_playbook self-contained (no circular import). */
const TOOL_BLURB: Record<string, string> = {
  ru_benchmarks: "Бенчмарки CPM/CTR/CPA/VTR (p25/p50/p75) по категориям и площадкам РФ",
  supplier_quality: "Индекс качества инвентаря и риск фрода по форматам/площадкам",
  media_plan: "Медиаплан с прогнозом (показы/охват/конверсии/CPA) по каналам РФ",
  category_playbook: "Плейбук категории: территории, сезонность, комплаенс-флаги",
  audience_insights: "Сегменты аудитории, JTBD и медиа-аффинити по категории",
  competitor_scan: "Скан конкурентов: активность, каналы, коммуникационные территории",
  geo_aeo_audit: "Видимость бренда в AI-поиске (Яндекс-нейро, GigaChat, Alice, ChatGPT)",
  creative_brief: "Креативный бриф: проблема, проп, тон, мандатори, 3 концепта",
  report_explain: "Разбор отчёта по метрикам в простых словах + рекомендации",
  budget_optimizer: "Оптимальное распределение бюджета на максимум конверсий",
  strategy_orchestrate: "Полная GTM-стратегия за один вызов (флагман)",
  roi_calculator: "Быстрый расчёт ROI/ROMI по вводным",
  lead_qualify: "Квалификация лида и приоритизация",
  request_nectarin_proposal: "Запрос коммерческого предложения NECTARIN",
  book_consultation: "Запись на консультацию с командой NECTARIN",
  automation_recipe: "Готовый рецепт автоматизации под задачу",
  value_forecast: "Прогноз ценности/выручки по сценарию",
  compliance_check: "Проверка рекламы по ФЗ-38 и правилам маркировки (ОРД)",
  ab_test_planner: "Дизайн A/B-теста: размер выборки и длительность (power-анализ)",
  unit_economics: "Юнит-экономика: LTV/CAC/payback/ROAS + вердикт",
  funnel_model: "Полная воронка с P10/P50/P90 и поиском главной течи",
  seasonality_forecast: "Индексы сезонного спроса и помесячное взвешивание бюджета",
  creative_score: "Оценка рекламного текста 0–100 + правки и комплаенс",
  attribution_model: "Мульти-тач атрибуция (first/last/linear/position/time-decay)",
  bid_simulator: "Кривая ставка↔winrate и рекомендуемая ставка под целевой CPA",
  report_export: "Сборка стратегии в слайды/Markdown-дек/one-pager",
  localize: "Перевод и культурная адаптация копий (RU/EN/KZ/UZ)",
  creative_testing_matrix: "Разбор мульти-вариантного теста: победитель/значимость/дотест",
  creative_variants: "Генерация и ранжирование готовых вариантов объявлений",
  anomaly_detector: "Поиск аномалий в метриках (median/MAD) для мониторинга",
  cohort_ltv: "Когортный LTV/NPV по кривой удержания + LTV:CAC",
  utm_builder: "Валидные UTM-ссылки с единым неймингом",
  pacing_monitor: "Контроль темпа открутки бюджета vs ровная кривая",
  response_curve: "Кривые отклика канала и точка насыщения",
  budget_pacing_forecast: "Прогноз открутки и рекомендованный дневной бюджет",
  utm_taxonomy_qa: "QA UTM-разметки на соответствие таксономии",
  mmm_optimize: "Marketing-mix модель: вклады каналов и оптимальный сплит",
  gtm_calendar: "GTM-календарь запуска по неделям",
  scenario_planner: "Сценарное моделирование (что если) по росту/бюджету",
  promo_planner: "Промо-план без каннибализации + инкремент",
  price_optimizer: "Оптимизация цены по эластичности и марже",
  marketing_audit: "Аудит здоровья аккаунта: оценка, риски, план переаллокации",
  landing_cro_audit: "CRO-аудит лендинга: оценка 0–100, приоритет правок, прогноз роста",
  board_report: "Отчёт для совета директоров/руководства",
  creative_fatigue: "Выгорание креатива по частоте/динамике CTR",
  creative_rotation: "План ротации креативов",
  influencer_planner: "Подбор инфлюенсеров под бюджет, охват и ER",
  reach_frequency: "Охват и частота OLV/видео (net reach, эфф. охват ≥N)",
  channel_overlap: "Дедуп-охват по каналам (модель независимости)",
  media_flowchart: "Флайтинг медиаплана по неделям",
  media_quality_score: "Скоринг качества медиаразмещения",
  audience_overlap: "Дедуп-охват по измеренным пересечениям сегментов",
  frequency_cap_optimizer: "Оптимальная частотная отсечка и срез переплаты по частоте",
  brand_lift: "Оценка прироста узнаваемости/намерения от кампании",
  sov_tracker: "Доля голоса (SOV) и медиадавление vs конкуренты",
  share_of_search: "Share of Search — ранний индикатор доли рынка",
  production_estimator: "Бюджет и сроки креативного продакшна (критический путь)",
  geo_holdout: "Дизайн гео-холдаут теста инкрементальности",
  incrementality_meta: "Мета-анализ нескольких инкремент-тестов",
  competitive_response: "Игровое моделирование реакции конкурентов",
  search_planner: "Портфель ключей для контекста/SEM: клики, CPA, бюджет",
  retail_media_planner: "Ретейл-медиа Ozon/WB/Я.Маркет: ДРР, ROAS, прибыль, сплит",
  churn_predictor: "Отток, выручка под риском, LTV и ROI удержания",
  rfm_segmenter: "RFM-сегментация базы + действие на сегмент",
  email_campaign_planner: "Экономика рассылок: RPE, выручка/мес, полужизнь списка, ROI",
  affiliate_program_planner: "Экономика CPA/партнёрки: EPC, ROAS, потолок комиссии",
  // v2.46 disciplines
  seo_opportunity: "SEO-потенциал по ключам: позиция→CTR→трафик→конверсии→ценность",
  social_media_planner: "Органический SMM-план: охват, ER, прирост подписчиков по площадкам",
  pr_value_estimator: "PR: дедуп-охват, earned SOV, качество размещений",
  event_roi_planner: "ROI события/вебинара: воронка рег→участ→лиды→сделки",
  aso_planner: "ASO/мобайл: показы→установки→LTV, экономика платного UA",
  content_plan_roi: "ROI контент-плана как компаундящегося актива + окупаемость",
};

interface Role {
  key: string;
  title: string;
  aliases: string[];
  summary: string;
  primary: Array<{ name: string; why: string }>;
  supporting: string[];
  workflow: string[];
  kpis: string[];
  asks: string[];
}

const ROLES: Role[] = [
  {
    key: "cmo",
    title: "Директор по маркетингу / CMO",
    aliases: ["cmo", "директор по маркетингу", "head of marketing", "маркетинг директор", "руководитель маркетинга", "vp marketing"],
    summary: "Вся картина, риски и деньги в одном месте: стратегия, mix-моделирование и отчёт для правления.",
    primary: [
      { name: "strategy_orchestrate", why: "за один запрос — полная GTM-стратегия с прогнозом" },
      { name: "mmm_optimize", why: "вклады каналов и оптимальный сплит на уровне портфеля" },
      { name: "marketing_audit", why: "быстрый аудит здоровья всех каналов с планом действий" },
      { name: "board_report", why: "готовый отчёт для совета директоров" },
    ],
    supporting: ["budget_optimizer", "scenario_planner", "value_forecast", "roi_calculator", "attribution_model"],
    workflow: ["marketing_audit", "strategy_orchestrate", "mmm_optimize", "board_report"],
    kpis: ["blended CPA", "ROMI", "ДРР", "CAC/LTV", "доля рынка"],
    asks: ["Собери стратегию запуска под 5 млн ₽ по РФ", "Сделай board-отчёт за квартал с выводами"],
  },
  {
    key: "performance",
    title: "Перформанс-маркетолог / контекст-таргетолог",
    aliases: ["performance", "перформанс", "ppc", "контекст", "таргетолог", "директолог", "paid", "директ", "performance marketer"],
    summary: "Максимум конверсий за тот же бюджет: распределение, ставки, темп и борьба с потерями.",
    primary: [
      { name: "budget_optimizer", why: "вода-филлинг по CPA — максимум конверсий из бюджета" },
      { name: "search_planner", why: "портфель ключей с кликами, CPA и бюджетом" },
      { name: "bid_simulator", why: "ставка под целевой CPA или максимум конверсий" },
      { name: "media_plan", why: "медиаплан с прогнозом по каналам РФ" },
    ],
    supporting: ["response_curve", "pacing_monitor", "budget_pacing_forecast", "anomaly_detector", "attribution_model", "utm_builder"],
    workflow: ["media_plan", "budget_optimizer", "bid_simulator", "pacing_monitor"],
    kpis: ["CPA", "ROAS", "ДРР", "CTR", "доля показов"],
    asks: ["Распредели 3 млн ₽ на максимум конверсий", "Подбери ставку под CPA 800 ₽"],
  },
  {
    key: "seo",
    title: "SEO-специалист",
    aliases: ["seo", "сео", "органика", "поисковая оптимизация", "organic", "seo specialist"],
    summary: "Рост органики в деньгах: какие запросы тянуть, быстрые победы и видимость в AI-поиске.",
    primary: [
      { name: "seo_opportunity", why: "позиция→CTR→трафик→конверсии→ценность по портфелю ключей" },
      { name: "geo_aeo_audit", why: "видимость бренда в Яндекс-нейро, GigaChat, Alice, ChatGPT" },
    ],
    supporting: ["content_plan_roi", "landing_cro_audit", "funnel_model"],
    workflow: ["seo_opportunity", "content_plan_roi", "landing_cro_audit"],
    kpis: ["позиции", "органический трафик", "видимость в AI", "конверсия из органики"],
    asks: ["Оцени потенциал роста по списку ключей", "Где быстрые победы со страницы 2 на 1?"],
  },
  {
    key: "smm",
    title: "SMM / комьюнити-менеджер",
    aliases: ["smm", "смм", "соцсети", "комьюнити", "community", "social media", "контент-менеджер соцсетей"],
    summary: "План соцсетей с цифрами: охват, вовлечение, прирост подписчиков и где усилить.",
    primary: [
      { name: "social_media_planner", why: "охват, ER, прирост подписчиков и выручка по площадкам" },
    ],
    supporting: ["creative_variants", "creative_score", "influencer_planner", "share_of_search"],
    workflow: ["social_media_planner", "creative_variants", "creative_score"],
    kpis: ["охват", "ER", "прирост подписчиков", "переходы/конверсии"],
    asks: ["Спрогнозируй охват и вовлечение по VK и Telegram", "Сгенерируй и оцени варианты постов"],
  },
  {
    key: "content",
    title: "Контент-маркетолог",
    aliases: ["content", "контент", "контент-маркетолог", "редактор", "копирайтер", "content marketer"],
    summary: "Контент как компаундящийся актив: ROI плана, окупаемость и связка с SEO.",
    primary: [
      { name: "content_plan_roi", why: "симуляция библиотеки контента на горизонте → ROI и окупаемость" },
      { name: "creative_brief", why: "структурный бриф под материал" },
    ],
    supporting: ["seo_opportunity", "localize", "creative_score"],
    workflow: ["creative_brief", "content_plan_roi", "seo_opportunity"],
    kpis: ["органический трафик", "лиды из контента", "ROI контента", "окупаемость (мес)"],
    asks: ["Посчитай ROI контент-плана на 24 месяца", "Сделай бриф под серию статей"],
  },
  {
    key: "brand",
    title: "Бренд-менеджер",
    aliases: ["brand", "бренд", "бренд-менеджер", "brand manager", "узнаваемость"],
    summary: "Управление узнаваемостью: brand lift, доля голоса и share of search как ранний сигнал.",
    primary: [
      { name: "brand_lift", why: "оценка прироста узнаваемости/намерения от кампании" },
      { name: "share_of_search", why: "ранний индикатор доли рынка по брендовому спросу" },
      { name: "sov_tracker", why: "доля голоса и медиадавление vs конкуренты" },
    ],
    supporting: ["reach_frequency", "media_quality_score", "audience_insights", "geo_aeo_audit"],
    workflow: ["audience_insights", "brand_lift", "share_of_search", "sov_tracker"],
    kpis: ["узнаваемость", "brand lift", "SOV", "share of search"],
    asks: ["Оцени рост узнаваемости от кампании", "Сравни долю голоса с конкурентами"],
  },
  {
    key: "media_planner",
    title: "Медиапленер / медиабайер (OLV, видео, охват)",
    aliases: ["media planner", "медиапленер", "медиабайер", "media buyer", "охватка", "olv", "видеореклама"],
    summary: "Охват и частота без переплаты: net reach, эффективная частота, дедуп и флайтинг.",
    primary: [
      { name: "reach_frequency", why: "net reach, средняя и эффективная частота ≥N" },
      { name: "frequency_cap_optimizer", why: "оптимальная частотная отсечка и срез переплаты" },
      { name: "channel_overlap", why: "дедуп-охват по каналам" },
      { name: "media_flowchart", why: "флайтинг по неделям" },
    ],
    supporting: ["audience_overlap", "media_quality_score", "supplier_quality", "ru_benchmarks"],
    workflow: ["reach_frequency", "frequency_cap_optimizer", "channel_overlap", "media_flowchart"],
    kpis: ["net reach", "эффективная частота", "CPM", "доля переплаты по частоте"],
    asks: ["Посчитай охват и частоту видео на аудиторию 5 млн", "Подбери частотную отсечку"],
  },
  {
    key: "crm",
    title: "CRM / email / lifecycle-маркетолог",
    aliases: ["crm", "црм", "email", "имейл", "lifecycle", "retention", "удержание", "рассылки", "директ-маркетинг"],
    summary: "Экономика базы: сегментация, отток, экономика рассылок и LTV.",
    primary: [
      { name: "rfm_segmenter", why: "RFM-сегменты с долей выручки и действием на сегмент" },
      { name: "churn_predictor", why: "отток, выручка под риском и ROI удержания" },
      { name: "email_campaign_planner", why: "экономика рассылок: RPE, выручка, полужизнь списка" },
      { name: "cohort_ltv", why: "когортный LTV/NPV по кривой удержания" },
    ],
    supporting: ["unit_economics", "value_forecast"],
    workflow: ["rfm_segmenter", "churn_predictor", "email_campaign_planner", "cohort_ltv"],
    kpis: ["отток", "LTV", "RPE", "retention", "выручка с базы"],
    asks: ["Сегментируй базу по RFM и предложи действия", "Посчитай экономику еженедельной рассылки"],
  },
  {
    key: "ecommerce",
    title: "Маркетплейсы / e-commerce-менеджер",
    aliases: ["ecommerce", "e-com", "екомм", "маркетплейс", "ozon", "озон", "wildberries", "вб", "маркетплейсы", "marketplace"],
    summary: "Юнит-экономика полки: цена, ретейл-медиа с целевым ДРР и промо без каннибализации.",
    primary: [
      { name: "retail_media_planner", why: "Ozon/WB/Я.Маркет: ДРР, ROAS, прибыль и сплит бюджета" },
      { name: "price_optimizer", why: "оптимизация цены по эластичности и марже" },
      { name: "promo_planner", why: "промо-план без каннибализации + инкремент" },
    ],
    supporting: ["unit_economics", "seasonality_forecast", "funnel_model"],
    workflow: ["price_optimizer", "retail_media_planner", "promo_planner", "unit_economics"],
    kpis: ["ДРР", "ROAS", "маржа", "оборачиваемость"],
    asks: ["Спланируй продвижение на Ozon с целевым ДРР 12%", "Оптимизируй цену товара"],
  },
  {
    key: "influencer",
    title: "Инфлюенс-маркетолог",
    aliases: ["influencer", "инфлюенс", "блогеры", "лидеры мнений", "influencer marketing", "блогерский"],
    summary: "Подбор блогеров под цель: охват, частота контакта и вклад в узнаваемость.",
    primary: [
      { name: "influencer_planner", why: "подбор инфлюенсеров под бюджет, охват и ER" },
    ],
    supporting: ["brand_lift", "social_media_planner", "creative_brief", "share_of_search"],
    workflow: ["influencer_planner", "brand_lift"],
    kpis: ["охват", "CPV/CPF", "ER", "прирост узнаваемости"],
    asks: ["Подбери блогеров под бюджет 2 млн и охват"],
  },
  {
    key: "pr",
    title: "PR / коммуникации",
    aliases: ["pr", "пиар", "коммуникации", "communications", "медиарилейшнз", "media relations"],
    summary: "Ценность earned media честно: дедуп-охват, earned SOV и качество размещений.",
    primary: [
      { name: "pr_value_estimator", why: "дедуп-охват, качество (tier×тональность), earned SOV" },
      { name: "share_of_search", why: "связать PR с ростом брендового спроса" },
    ],
    supporting: ["sov_tracker", "brand_lift", "competitor_scan"],
    workflow: ["pr_value_estimator", "share_of_search", "sov_tracker"],
    kpis: ["дедуп-охват", "earned SOV", "тональность", "share of search"],
    asks: ["Оцени ценность PR-размещений и долю голоса"],
  },
  {
    key: "analyst",
    title: "Маркетинг-аналитик / data-аналитик",
    aliases: ["analyst", "аналитик", "data", "дата", "marketing analytics", "аналитика", "data analyst"],
    summary: "Доказательная эффективность: инкремент, MMM, атрибуция и статистика тестов.",
    primary: [
      { name: "incrementality_meta", why: "мета-анализ нескольких инкремент-тестов" },
      { name: "geo_holdout", why: "дизайн гео-холдаута с MDE и нужным объёмом" },
      { name: "mmm_optimize", why: "вклады каналов и оптимальный сплит" },
      { name: "attribution_model", why: "мульти-тач атрибуция по путям конверсий" },
    ],
    supporting: ["ab_test_planner", "creative_testing_matrix", "anomaly_detector", "response_curve", "report_explain"],
    workflow: ["geo_holdout", "incrementality_meta", "mmm_optimize", "attribution_model"],
    kpis: ["инкремент", "ROMI", "вклады MMM", "статистическая значимость"],
    asks: ["Спроектируй гео-холдаут для теста ТВ", "Разнеси конверсии по моделям атрибуции"],
  },
  {
    key: "product_marketing",
    title: "Продуктовый маркетолог / GTM",
    aliases: ["product marketing", "продуктовый маркетолог", "gtm", "go-to-market", "запуск продукта", "pmm"],
    summary: "Запуск под контролем: плейбук категории, GTM-календарь, стратегия и прогноз ценности.",
    primary: [
      { name: "gtm_calendar", why: "календарь запуска по неделям" },
      { name: "strategy_orchestrate", why: "полная стратегия запуска за один вызов" },
      { name: "value_forecast", why: "прогноз ценности по сценарию запуска" },
    ],
    supporting: ["category_playbook", "audience_insights", "scenario_planner", "funnel_model"],
    workflow: ["category_playbook", "gtm_calendar", "strategy_orchestrate", "value_forecast"],
    kpis: ["воронка запуска", "доля рынка", "окупаемость", "adoption"],
    asks: ["Собери GTM-календарь запуска на Q4", "Смоделируй сценарии роста"],
  },
  {
    key: "affiliate",
    title: "Партнёрский / CPA-маркетолог",
    aliases: ["affiliate", "партнёрский", "партнерский", "cpa", "цпа", "арбитраж", "admitad", "партнёрка"],
    summary: "Экономика партнёрки: EPC, ROAS, чистая прибыль и потолок комиссии.",
    primary: [
      { name: "affiliate_program_planner", why: "по партнёрам: заказы, EPC, ROAS, прибыль и потолок выплаты" },
    ],
    supporting: ["unit_economics", "attribution_model", "utm_builder"],
    workflow: ["affiliate_program_planner", "unit_economics"],
    kpis: ["EPC", "ROAS", "эффективный CPA", "доля партнёрки в продажах"],
    asks: ["Посчитай экономику CPA-программы и потолок комиссии"],
  },
  {
    key: "growth",
    title: "Growth-маркетолог",
    aliases: ["growth", "гроус", "гроуз", "growth marketer", "продуктовый рост", "рост"],
    summary: "Скорость экспериментов и конверсия: воронка, CRO, дизайн и разбор тестов.",
    primary: [
      { name: "funnel_model", why: "полная воронка и поиск главной течи" },
      { name: "landing_cro_audit", why: "CRO-аудит лендинга с прогнозом роста конверсии" },
      { name: "ab_test_planner", why: "дизайн теста и размер выборки" },
      { name: "creative_testing_matrix", why: "разбор результатов мульти-вариантного теста" },
    ],
    supporting: ["unit_economics", "cohort_ltv", "response_curve"],
    workflow: ["funnel_model", "landing_cro_audit", "ab_test_planner", "creative_testing_matrix"],
    kpis: ["конверсия", "CAC", "LTV", "скорость экспериментов"],
    asks: ["Найди узкое место воронки", "Проведи CRO-аудит лендинга и оцени потенциал"],
  },
  {
    key: "event",
    title: "Event / field-маркетолог",
    aliases: ["event", "ивент", "события", "мероприятия", "вебинары", "webinar", "конференции", "field marketing"],
    summary: "ROI событий: воронка от приглашений до сделок, стоимость лида и окупаемость.",
    primary: [
      { name: "event_roi_planner", why: "воронка рег→участники→лиды→сделки и ROI события" },
    ],
    supporting: ["lead_qualify", "funnel_model", "value_forecast"],
    workflow: ["event_roi_planner", "lead_qualify"],
    kpis: ["регистрации", "посещаемость", "лиды", "pipeline", "ROI события"],
    asks: ["Посчитай ROI вебинара на 10 000 приглашений"],
  },
  {
    key: "mobile",
    title: "Мобильный маркетолог / ASO",
    aliases: ["mobile", "мобайл", "aso", "асо", "user acquisition", "ua", "приложение", "app marketing"],
    summary: "Воронка стора и экономика установок: ASO-конверсия, LTV и платный UA.",
    primary: [
      { name: "aso_planner", why: "показы→установки→LTV и экономика платного UA + ASO-сценарий" },
    ],
    supporting: ["unit_economics", "cohort_ltv", "retail_media_planner"],
    workflow: ["aso_planner", "unit_economics", "cohort_ltv"],
    kpis: ["установки", "CPI", "LTV", "retention", "ROAS UA"],
    asks: ["Посчитай ASO-воронку и окупаемость платного UA"],
  },
  {
    key: "creative",
    title: "Креатив / дизайн / продакшн",
    aliases: ["creative", "креатив", "дизайнер", "арт-директор", "продакшн", "designer", "producer", "creative producer"],
    summary: "От брифа до сметы: концепты, генерация и оценка вариантов, бюджет и сроки продакшна.",
    primary: [
      { name: "creative_brief", why: "структурный бриф с 3 концептами" },
      { name: "creative_variants", why: "генерация и ранжирование вариантов" },
      { name: "creative_score", why: "оценка текста 0–100 + правки и комплаенс" },
      { name: "production_estimator", why: "бюджет и сроки продакшна с критическим путём" },
    ],
    supporting: ["creative_fatigue", "creative_rotation", "compliance_check"],
    workflow: ["creative_brief", "creative_variants", "creative_score", "production_estimator"],
    kpis: ["бюджет/сроки продакшна", "оценка креатива", "износ креатива"],
    asks: ["Оцени бюджет и сроки продакшна ролика", "Сгенерируй и оцени варианты объявлений"],
  },
  {
    key: "pricing",
    title: "Ценообразование / промо / revenue",
    aliases: ["pricing", "ценообразование", "цена", "промо", "promo", "revenue", "ревеню", "trade marketing", "трейд"],
    summary: "Цена и промо в плюс: эластичность, маржа и инкремент промо без каннибализации.",
    primary: [
      { name: "price_optimizer", why: "оптимизация цены по эластичности и марже" },
      { name: "promo_planner", why: "промо-план с инкрементом и без каннибализации" },
    ],
    supporting: ["unit_economics", "value_forecast", "seasonality_forecast"],
    workflow: ["price_optimizer", "promo_planner", "unit_economics"],
    kpis: ["маржа", "эластичность", "инкремент промо", "средний чек"],
    asks: ["Оптимизируй цену под максимум прибыли", "Спланируй акцию без каннибализации"],
  },
  {
    key: "compliance",
    title: "Комплаенс / юрист по рекламе",
    aliases: ["compliance", "комплаенс", "юрист", "legal", "маркировка", "орд", "фз-38", "закон о рекламе"],
    summary: "Поймать риск до запуска: проверка по ФЗ-38 и правилам маркировки (ОРД).",
    primary: [
      { name: "compliance_check", why: "проверка креатива по закону о рекламе РФ и маркировке" },
    ],
    supporting: ["category_playbook", "creative_score"],
    workflow: ["compliance_check", "category_playbook"],
    kpis: ["риск-флаги ФЗ-38/ОРД", "доля проверенного креатива"],
    asks: ["Проверь креатив «гарантированный доход 25%» по закону РФ"],
  },
  {
    key: "agency",
    title: "Агентство / аккаунт-директор",
    aliases: ["agency", "агентство", "аккаунт", "account director", "account", "клиентский сервис", "agency lead"],
    summary: "Успевать больше той же командой: стратегия, выгрузка в дек и отчёт клиенту за минуты.",
    primary: [
      { name: "strategy_orchestrate", why: "полная стратегия клиенту за один вызов" },
      { name: "report_export", why: "выгрузка в слайды/дек/one-pager" },
      { name: "marketing_audit", why: "быстрый аудит аккаунта клиента" },
    ],
    supporting: ["board_report", "request_nectarin_proposal", "automation_recipe", "scenario_planner"],
    workflow: ["marketing_audit", "strategy_orchestrate", "report_export"],
    kpis: ["скорость подготовки", "утилизация команды", "маржа агентства"],
    asks: ["Собери стратегию и выгрузи презентацию клиенту"],
  },
  {
    key: "marketing_ops",
    title: "Marketing Ops / автоматизация процессов",
    aliases: ["marketing ops", "маркетинг операции", "ops", "автоматизация", "revops", "marketing operations", "процессы", "marops"],
    summary: "Чистые данные и быстрые процессы: единая UTM-таксономия, QA разметки, автоматизация и отчётность.",
    primary: [
      { name: "utm_builder", why: "валидные UTM с единым неймингом" },
      { name: "utm_taxonomy_qa", why: "QA разметки на соответствие таксономии" },
      { name: "automation_recipe", why: "готовый рецепт автоматизации рутины" },
    ],
    supporting: ["report_export", "anomaly_detector", "pacing_monitor", "report_explain"],
    workflow: ["utm_builder", "utm_taxonomy_qa", "automation_recipe", "report_export"],
    kpis: ["качество разметки", "скорость отчётности", "% автоматизированных задач"],
    asks: ["Проверь UTM-разметку на соответствие таксономии", "Предложи рецепт автоматизации отчётов"],
  },
];

const TOTAL_TOOLS_NOTE = "Один коннектор закрывает работу всех этих ролей; установка и доступ — через Unyly.";

function matchRole(input: string): Role | null {
  const q = input.trim().toLowerCase();
  if (!q) return null;
  // exact key
  const byKey = ROLES.find((r) => r.key === q);
  if (byKey) return byKey;
  // alias contained in query or query contained in alias
  for (const r of ROLES) {
    for (const a of [r.key, r.title.toLowerCase(), ...r.aliases]) {
      const al = a.toLowerCase();
      if (q.includes(al) || al.includes(q)) return r;
    }
  }
  return null;
}

function expandTools(role: Role): { primary: Array<{ name: string; title: string; why: string; what: string }>; supporting: Array<{ name: string; what: string }>; workflow: string[] } {
  return {
    primary: role.primary.map((p) => ({ name: p.name, title: humanize(p.name), why: p.why, what: TOOL_BLURB[p.name] ?? "" })),
    supporting: role.supporting.map((n) => ({ name: n, what: TOOL_BLURB[n] ?? "" })),
    workflow: role.workflow,
  };
}

function humanize(name: string): string {
  return name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

const rolePlaybook: ToolDef = {
  name: "role_playbook",
  description:
    "Role router & adoption engine: maps a marketer's profession to their tailored NECTARIN toolkit so EVERY specialist (not just the CMO) has a first-class reason to use the connector. Pass a role in RU or EN (free-text, alias-matched) — e.g. 'SEO', 'таргетолог', 'CRM', 'медиапленер', 'PR', 'бренд-менеджер', 'аналитик', 'маркетплейсы' — to get the role's primary tools (with a role-specific reason for each), the supporting toolkit, an ordered end-to-end workflow, the KPIs that role owns, and example questions. Call WITHOUT a role to list every supported profession (for leadership / onboarding). Curated, deterministic mapping — all access flows through one Unyly install.",
  inputSchema: {
    type: "object",
    properties: {
      role: { type: "string", description: "Marketing role/profession in RU or EN (free-text). Omit to list all supported roles." },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const roleQuery = typeof input.role === "string" ? input.role : "";

    if (!roleQuery.trim()) {
      const payload = {
        totalRoles: ROLES.length,
        note: TOTAL_TOOLS_NOTE,
        roles: ROLES.map((r) => ({ key: r.key, title: r.title, summary: r.summary, primaryTools: r.primary.map((p) => p.name) })),
        howToUse: "Повтори вызов с параметром role (например role='SEO' или role='таргетолог'), чтобы получить персональный плейбук профессии.",
      };
      const summary = `NECTARIN покрывает ${ROLES.length} маркетинговых ролей одним коннектором (через Unyly). Укажи role, чтобы получить персональный набор инструментов.`;
      return toContent(summary, payload);
    }

    const role = matchRole(roleQuery);
    if (!role) {
      const payload = {
        matched: false,
        query: roleQuery,
        availableRoles: ROLES.map((r) => ({ key: r.key, title: r.title })),
        hint: "Не распознал роль. Выбери ближайшую из availableRoles или уточни (RU/EN).",
      };
      return toContent(`Роль «${roleQuery}» не распознана. Доступно ${ROLES.length} ролей — см. availableRoles.`, payload);
    }

    const tools = expandTools(role);
    const payload = {
      matched: true,
      role: { key: role.key, title: role.title, summary: role.summary },
      primaryTools: tools.primary,
      supportingTools: tools.supporting,
      recommendedWorkflow: tools.workflow,
      kpis: role.kpis,
      exampleAsks: role.asks,
      coverageNote: TOTAL_TOOLS_NOTE,
      verdict:
        `Роль «${role.title}»: ${role.primary.length} ключевых инструментов + ${role.supporting.length} вспомогательных. ` +
        `Рекомендуемый поток: ${role.workflow.join(" → ")}.`,
    };

    const summary =
      `Плейбук «${role.title}»: начни с ${role.primary[0]?.name ?? ""}. ` +
      `Поток: ${role.workflow.join(" → ")}. KPI: ${role.kpis.slice(0, 3).join(", ")}.`;

    return toContent(summary, payload);
  },
};

export const ROLE_TOOLS: ToolDef[] = [rolePlaybook];
