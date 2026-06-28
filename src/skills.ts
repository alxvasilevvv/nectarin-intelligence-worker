/**
 * SKILLS layer (v2.51) for NECTARIN Intelligence — Workers.
 *
 * A "skill" is a named, composable WORKFLOW that chains several tools into one
 * end-to-end job (e.g. "снизить CAC", "запустить продукт", "поднять retention").
 * `marketing_skill` is the extensible registry: with no args it lists the catalog;
 * given a skill name (or a free-text goal) it returns the ordered recipe — which
 * tools to call, in what order, why, what inputs are needed and which KPIs to watch.
 *
 * This is the "дополняемая" layer the owner asked for: add a new entry to SKILLS and
 * the connector gains a new repeatable playbook — without touching the tools. It does
 * NOT execute tools itself (the client/LLM runs the steps); it returns the plan, so it
 * is deterministic, side-effect free and cheap.
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

interface SkillStep {
  tool: string;
  why: string;
}
interface Skill {
  key: string;
  title: string;
  aliases: string[];
  forRoles: string[];
  outcome: string;
  inputsNeeded: string[];
  steps: SkillStep[];
  kpis: string[];
}

const SKILLS: Skill[] = [
  {
    key: "product_launch",
    title: "Запуск продукта под ключ",
    aliases: ["запуск", "launch", "go-to-market", "gtm", "вывод на рынок", "запустить продукт"],
    forRoles: ["CMO", "Перформанс", "Медиапленер"],
    outcome: "Полная стратегия запуска: каналы, прогноз воронки, бюджеты, флайтинг и проверка по закону.",
    inputsNeeded: ["категория", "бюджет/мес", "цель", "гео", "период (опц.)"],
    steps: [
      { tool: "strategy_orchestrate", why: "за один вызов — стратегия, сегменты, сплит и прогноз" },
      { tool: "budget_optimizer", why: "пересборка сплита под максимум конверсий" },
      { tool: "media_flowchart", why: "недельный флайтинг и пейсинг бюджета" },
      { tool: "compliance_check", why: "проверка по ФЗ-38/ОРД до старта" },
    ],
    kpis: ["CAC/CPA", "охват", "конверсии", "ROMI"],
  },
  {
    key: "cut_cac",
    title: "Снизить стоимость клиента (CAC)",
    aliases: ["cac", "cpa", "снизить cac", "дешевле клиент", "cut cac", "эффективность"],
    forRoles: ["Перформанс", "Growth"],
    outcome: "Перераспределение бюджета и креатива для снижения CPA без роста бюджета.",
    inputsNeeded: ["каналы со spend и конверсиями/CPA", "бюджет"],
    steps: [
      { tool: "budget_optimizer", why: "вода-филлинг по CPA — максимум конверсий из бюджета" },
      { tool: "response_curve", why: "найти насыщение каналов и точки убывающей отдачи" },
      { tool: "creative_testing_matrix", why: "выявить выигрышные креативы статистически" },
      { tool: "scenario_planner", why: "сравнить what-if сценарии по ROI" },
    ],
    kpis: ["CPA", "blended CPA", "конверсии", "ROAS"],
  },
  {
    key: "retention_boost",
    title: "Поднять удержание и LTV",
    aliases: ["retention", "удержание", "ltv", "отток", "churn", "лояльность"],
    forRoles: ["CRM", "Продукт / GTM", "Growth"],
    outcome: "Снижение оттока и рост LTV через сегментацию и жизненный цикл коммуникаций.",
    inputsNeeded: ["база клиентов (recency/frequency/monetary)", "отток/ARPU"],
    steps: [
      { tool: "churn_predictor", why: "оценить отток, LTV и ROI удержания" },
      { tool: "rfm_segmenter", why: "сегменты RFM с действиями под каждый" },
      { tool: "email_campaign_planner", why: "каденс и экономика жизненного цикла писем" },
      { tool: "cohort_retention_curve", why: "спрогнозировать кривую удержания и LTV по когортам" },
    ],
    kpis: ["retention D30/D90", "churn", "LTV", "RPE"],
  },
  {
    key: "creative_refresh",
    title: "Обновить выгоревший креатив",
    aliases: ["креатив", "creative", "выгорание", "fatigue", "обновить креатив", "ротация"],
    forRoles: ["Креатив", "Перформанс"],
    outcome: "Поймать усталость креатива, сгенерировать варианты и протестировать их.",
    inputsNeeded: ["метрики креативов по времени (CTR/частота)"],
    steps: [
      { tool: "creative_fatigue", why: "детект усталости/выгорания по динамике" },
      { tool: "creative_variants", why: "сгенерировать новые концепты" },
      { tool: "creative_testing_matrix", why: "сравнить варианты с контролем ложных срабатываний" },
      { tool: "creative_rotation", why: "оптимизировать ротацию выживших" },
    ],
    kpis: ["CTR", "частота", "CPA", "доля свежих показов"],
  },
  {
    key: "budget_reallocation",
    title: "Перераспределить бюджет",
    aliases: ["бюджет", "budget", "реаллокация", "перераспределение", "пейсинг", "pacing"],
    forRoles: ["Медиапленер", "Перформанс", "CMO"],
    outcome: "Сдвинуть деньги в недонасыщенные каналы и удержать пейсинг до конца периода.",
    inputsNeeded: ["каналы со spend и отдачей", "общий бюджет", "факт пейсинга"],
    steps: [
      { tool: "response_curve", why: "кривые отдачи и насыщения по каналам" },
      { tool: "scenario_planner", why: "ранжировать сценарии перераспределения по ROI" },
      { tool: "budget_pacing_forecast", why: "прогноз пейсинга с учётом тренда" },
    ],
    kpis: ["ROMI", "доля недонасыщенных каналов", "отклонение пейсинга"],
  },
  {
    key: "seo_growth",
    title: "Органический рост (SEO + контент)",
    aliases: ["seo", "органика", "контент", "content", "органический рост", "трафик"],
    forRoles: ["SEO", "Контент"],
    outcome: "Найти SEO-возможности и спланировать контент с окупаемостью.",
    inputsNeeded: ["ключи (объём, текущая/целевая позиция)", "CR и ценность конверсии"],
    steps: [
      { tool: "seo_opportunity", why: "позиция→CTR→трафик→деньги, выявить quick wins" },
      { tool: "content_plan_roi", why: "компаундная окупаемость контент-плана" },
      { tool: "share_of_search", why: "доля поиска как опережающий индикатор доли рынка" },
    ],
    kpis: ["органический трафик", "позиции", "share of search", "ROI контента"],
  },
  {
    key: "social_growth",
    title: "Рост в соцсетях и инфлюенс",
    aliases: ["smm", "соцсети", "social", "инфлюенс", "influencer", "блогеры"],
    forRoles: ["SMM", "Инфлюенс"],
    outcome: "Спланировать органический SMM и инфлюенс-микс, отслеживать SOV.",
    inputsNeeded: ["платформы/частота постинга", "ростер блогеров (охват/ER/цена)"],
    steps: [
      { tool: "social_media_planner", why: "охват, ER и рост подписчиков органики" },
      { tool: "influencer_planner", why: "оценка ростера и оптимизация микса (фрод-флаги)" },
      { tool: "sov_tracker", why: "доля голоса/ESOV как драйвер роста" },
    ],
    kpis: ["охват", "ER", "рост подписчиков", "SOV/ESOV"],
  },
  {
    key: "board_readout",
    title: "Отчёт для правления",
    aliases: ["правление", "board", "руководство", "отчёт", "executive", "совет директоров"],
    forRoles: ["CMO", "Аналитик"],
    outcome: "Аудит + апсайд + сценарии в виде одностраничника для руководства.",
    inputsNeeded: ["текущие метрики аккаунта/каналов", "бюджет"],
    steps: [
      { tool: "marketing_audit", why: "приоритизированный аудит со списком действий" },
      { tool: "board_report", why: "executive-одностраничник: аудит + апсайд" },
      { tool: "scenario_planner", why: "what-if сценарии бюджета с ранжированием по ROI" },
    ],
    kpis: ["ROMI", "доля задач в системе", "эффект сценариев"],
  },
  {
    key: "marketplace_scaling",
    title: "Масштабирование на маркетплейсах",
    aliases: ["маркетплейс", "marketplace", "ozon", "wildberries", "retail media", "ритейл-медиа", "drr"],
    forRoles: ["Маркетплейсы", "Цена / промо"],
    outcome: "План ритейл-медиа + цена + промо для роста продаж с контролем ДРР.",
    inputsNeeded: ["площадки/ставки/ДРР", "цена и эластичность", "параметры промо"],
    steps: [
      { tool: "retail_media_planner", why: "план Ozon/WB/Я.Маркет с ДРР и ROAS" },
      { tool: "price_optimizer", why: "оптимизация цены по эластичности спроса" },
      { tool: "promo_planner", why: "P&L и точка безубыточности промо" },
    ],
    kpis: ["ДРР", "ROAS", "маржа", "оборот"],
  },
  {
    key: "measurement_setup",
    title: "Настроить измеримость и инкрементальность",
    aliases: ["измеримость", "measurement", "инкрементальность", "incrementality", "utm", "атрибуция", "эксперименты"],
    forRoles: ["Аналитик", "Marketing Ops"],
    outcome: "Чистая разметка + инкрементальные тесты вместо «корреляции».",
    inputsNeeded: ["ссылки/UTM", "данные кампаний", "гео-сплиты"],
    steps: [
      { tool: "utm_taxonomy_qa", why: "QA UTM-таксономии пачкой" },
      { tool: "incrementality_meta", why: "мета-анализ инкрементальности" },
      { tool: "geo_holdout", why: "гео-холдаут тест инкрементальности" },
      { tool: "brand_lift", why: "калькулятор brand-lift исследования" },
    ],
    kpis: ["incrementality %", "качество разметки", "stat. значимость"],
  },
];

export function matchSkill(query: string): Skill | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byKey = SKILLS.find((s) => s.key === q);
  if (byKey) return byKey;
  const byAlias = SKILLS.find((s) => s.aliases.some((a) => a.toLowerCase() === q));
  if (byAlias) return byAlias;
  // Fuzzy: any alias/title token contained in the query (or vice versa).
  let best: { skill: Skill; score: number } | null = null;
  for (const s of SKILLS) {
    const hay = [s.title, s.outcome, ...s.aliases, ...s.forRoles].join(" ").toLowerCase();
    let score = 0;
    for (const token of q.split(/[\s,]+/).filter(Boolean)) {
      if (token.length >= 3 && hay.includes(token)) score++;
    }
    if (s.aliases.some((a) => q.includes(a.toLowerCase()))) score += 2;
    if (score > 0 && (!best || score > best.score)) best = { skill: s, score };
  }
  return best?.skill ?? null;
}

const marketingSkill: ToolDef = {
  name: "marketing_skill",
  description:
    "SKILLS / playbooks engine — composable, end-to-end marketing workflows that chain several NECTARIN tools into one repeatable job. With NO arguments it lists the catalogue of skills (launch, cut CAC, retention, creative refresh, budget reallocation, SEO/content, social/influencer, board readout, marketplace scaling, measurement setup). Given a `skill` name/alias OR a free-text `goal` (RU/EN), it returns the ordered recipe: which tools to run, in what order, why, the inputs needed and the KPIs to watch. Deterministic planning only — it returns the workflow, it does NOT call the tools itself. Extensible: this is the layer to add new repeatable playbooks.",
  inputSchema: {
    type: "object",
    properties: {
      skill: { type: "string", description: "Skill key or alias, e.g. 'cut_cac', 'retention', 'запуск'" },
      goal: { type: "string", description: "Free-text goal to match to a skill, e.g. 'хочу снизить стоимость клиента'" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const query =
      (typeof input?.skill === "string" && input.skill) ||
      (typeof input?.goal === "string" && input.goal) ||
      "";

    if (!query) {
      const catalog = SKILLS.map((s) => ({
        skill: s.key,
        title: s.title,
        outcome: s.outcome,
        forRoles: s.forRoles,
        steps: s.steps.length,
      }));
      const payload = {
        tool: "marketing_skill",
        count: SKILLS.length,
        catalog,
        howTo: "Вызовите marketing_skill(skill=\"<key>\") или marketing_skill(goal=\"<что хочу>\") для готового рецепта.",
        note: "Скилы — это композитные сценарии поверх инструментов. Список расширяется.",
      };
      return toContent(`Каталог скилов NECTARIN: ${SKILLS.length} готовых сценариев. Укажите skill или goal для рецепта.`, payload);
    }

    const skill = matchSkill(query);
    if (!skill) {
      const payload = {
        tool: "marketing_skill",
        matched: false,
        query,
        available: SKILLS.map((s) => s.key),
        note: "Не нашёл подходящий скил. Выберите из available или уточните goal.",
      };
      return toContent(`Скил по запросу «${query}» не найден. Доступно: ${SKILLS.map((s) => s.key).join(", ")}.`, payload);
    }

    const payload = {
      tool: "marketing_skill",
      matched: true,
      skill: skill.key,
      title: skill.title,
      forRoles: skill.forRoles,
      outcome: skill.outcome,
      inputsNeeded: skill.inputsNeeded,
      workflow: skill.steps.map((s, i) => ({ step: i + 1, tool: s.tool, why: s.why })),
      kpis: skill.kpis,
      cta: "Запускайте инструменты по порядку; выход каждого шага — вход следующего. Подключение и тарифы — через Unyly.",
    };
    const summary =
      `Скил «${skill.title}» (${skill.steps.length} шага): ` +
      skill.steps.map((s) => s.tool).join(" → ") +
      `. Роли: ${skill.forRoles.join(", ")}.`;
    return toContent(summary, payload);
  },
};

export const SKILL_TOOLS: ToolDef[] = [marketingSkill];
