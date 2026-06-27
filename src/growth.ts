/**
 * GROWTH & AUTOMATION tool group for NECTARIN Intelligence — Cloudflare Workers.
 *
 * This is the "battle version" funnel layer. Where the original Intelligence
 * tools INFORM (benchmarks, plans, audits), these tools CONVERT: they quantify
 * value, qualify the lead, capture a brief, book time, and describe the
 * automation NECTARIN will run as a managed service. Net effect — the agent
 * walks a marketer from interest → qualified → proposal → managed services.
 *
 *   acquire marketer → roi_calculator / value_forecast (show value)
 *                    → lead_qualify (fit + tier)
 *                    → request_nectarin_proposal (capture brief)
 *                    → book_consultation (schedule)
 *                    → automation_recipe (what we'll automate for you)
 *
 * EVERYTHING HERE IS SYNTHETIC / DETERMINISTIC. There are NO real network
 * calls, NO CRM writes, and NO PII transmission. `request_nectarin_proposal`
 * and `book_consultation` only RETURN structured text plus a clearly-stubbed
 * reference; the exact spot where a real CRM/webhook POST would live is marked
 * with a comment. ROI/value math is anchored to the same mock benchmark data
 * (src/data.ts) the Intelligence tools use, so the numbers are internally
 * consistent — but they remain illustrative, not guarantees.
 */

import { getCategoryBenchmarks, getMetric, CATEGORIES, type Platform } from "./data.js";
import type { ToolDef, ToolResult } from "./tools.js";
import type { Env } from "./index.js";

// ── Local helpers (kept self-contained to avoid cross-module coupling) ───────

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function ru(n: number): string {
  try {
    return Number(n).toLocaleString("ru-RU");
  } catch {
    return String(n);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Render a structured payload into MCP content blocks (mirrors tools.ts toContent). */
function toContent(summary: string, payload: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: "```json\n" + JSON.stringify(payload, null, 2) + "\n```" },
    ],
    structuredContent: isRecord(payload) ? payload : { result: payload },
  };
}

const GROWTH_DISCLAIMER =
  "SYNTHETIC / illustrative figures, anchored to NECTARIN's MOCK benchmark data. " +
  "Not a guarantee of results. No PII was transmitted; proposal/booking are STUBS " +
  "(no real CRM/webhook call). Replace stubs + benchmark accessors before production.";

/**
 * Category-median CPA across all platforms (the same mock benchmarks the
 * Intelligence tools read). Used as the reference point so ROI/value numbers
 * line up with media_plan / ru_benchmarks. Falls back to a neutral 1500 ₽.
 */
async function categoryMedianCpa(category: string): Promise<number> {
  const bm = await getCategoryBenchmarks(category);
  if (!bm) return 1500;
  const cpas: number[] = [];
  for (const platform of Object.keys(bm)) {
    const r = await getMetric(category, platform, "CPA");
    if (r) cpas.push(r.p50);
  }
  if (cpas.length === 0) return 1500;
  return round(cpas.reduce((a, b) => a + b, 0) / cpas.length);
}

/** Best-in-class (p25) blended CPA for a category — the "what good looks like" anchor. */
async function categoryBestCpa(category: string): Promise<number> {
  const bm = await getCategoryBenchmarks(category);
  if (!bm) return 1100;
  const cpas: number[] = [];
  for (const platform of Object.keys(bm)) {
    const r = await getMetric(category, platform, "CPA");
    if (r) cpas.push(r.p25);
  }
  if (cpas.length === 0) return 1100;
  return round(cpas.reduce((a, b) => a + b, 0) / cpas.length);
}

// NECTARIN's modeled efficiency uplift assumptions (illustrative, deterministic).
// These are the "method" we expose so the selling number is auditable, not magic.
const NECTARIN_CPA_IMPROVEMENT = 0.22; // 22% lower CPA via better mix + AI optimization
const AOV_BY_CATEGORY: Record<string, number> = {
  realty: 350000, // commission-equivalent value per conversion (synthetic)
  finance: 9000,
  auto: 45000,
  retail: 2500,
  fmcg: 900,
  pharma: 1400,
};

function aovFor(category: string): number {
  return AOV_BY_CATEGORY[category] ?? 3000;
}

// ── Tool 1: roi_calculator ───────────────────────────────────────────────────

const roiCalculator: ToolDef = {
  name: "roi_calculator",
  description:
    "SELL value. Projects the ROI of moving a media budget onto NECTARIN. Inputs: monthly_budget (RUB), optional current_cpa, and category. Output: current vs. projected CPA, extra monthly conversions, and estimated annual value — all derived from the same mock RU/CIS benchmarks (CPA p25/p50) the Intelligence tools use, with the method shown so the number is auditable. Synthetic/illustrative, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      monthly_budget: { type: "number", exclusiveMinimum: 0, description: "Monthly media budget in RUB" },
      current_cpa: { type: "number", exclusiveMinimum: 0, description: "Optional current CPA in RUB; if omitted, category median is used as the baseline" },
      category: { type: "string", enum: CATEGORIES, description: "Industry category (anchors the benchmarks)" },
    },
    required: ["monthly_budget", "category"],
    additionalProperties: false,
  },
  async handler(input) {
    const budget = Number(input.monthly_budget);
    const category = String(input.category);
    const medianCpa = await categoryMedianCpa(category);
    const bestCpa = await categoryBestCpa(category);
    const baselineCpa = input.current_cpa ? Number(input.current_cpa) : medianCpa;

    // Projected CPA = baseline improved by NECTARIN uplift, floored at category best.
    const projectedCpa = Math.max(bestCpa, round(baselineCpa * (1 - NECTARIN_CPA_IMPROVEMENT)));
    const cpaImprovementPct = round(((baselineCpa - projectedCpa) / baselineCpa) * 100, 1);

    const conversionsNow = round(budget / baselineCpa);
    const conversionsProjected = round(budget / projectedCpa);
    const extraConversionsMonthly = conversionsProjected - conversionsNow;
    const extraConversionsAnnual = extraConversionsMonthly * 12;

    const aov = aovFor(category);
    const annualValue = round(extraConversionsAnnual * aov);
    const annualBudget = round(budget * 12);

    const payload = {
      tool: "roi_calculator",
      input: { monthly_budget: budget, current_cpa: input.current_cpa ?? null, category },
      reference: {
        source: "NECTARIN mock RU/CIS benchmarks (src/data.ts)",
        categoryMedianCpa: medianCpa,
        categoryBestCpa: bestCpa,
        baselineCpaUsed: baselineCpa,
        baselineSource: input.current_cpa ? "client-provided current_cpa" : "category median CPA (p50 avg)",
        assumedAovRub: aov,
        nectarinCpaImprovementAssumption: `${round(NECTARIN_CPA_IMPROVEMENT * 100)}%`,
      },
      projection: {
        currentCpa: baselineCpa,
        projectedCpa,
        cpaImprovementPct,
        conversionsNowMonthly: conversionsNow,
        conversionsProjectedMonthly: conversionsProjected,
        extraConversionsMonthly,
        extraConversionsAnnual,
        annualBudget,
        estAnnualValueRub: annualValue,
        estRoiX: annualBudget > 0 ? round(annualValue / annualBudget, 1) : null,
      },
      method:
        "projectedCPA = max(categoryBestCPA, baselineCPA × (1 − 0.22)); " +
        "conversions = budget / CPA; extraAnnual = (projConv − nowConv) × 12; " +
        "annualValue = extraAnnual × assumedAOV.",
      cta: "Хотите этот эффект на вашем аккаунте? Вызовите lead_qualify, затем book_consultation.",
      disclaimer: GROWTH_DISCLAIMER,
    };

    const summary =
      `ROI «${category}»: CPA ${ru(baselineCpa)} → ${ru(projectedCpa)} ₽ (−${cpaImprovementPct}%), ` +
      `+${ru(extraConversionsMonthly)} конверсий/мес, ~${ru(annualValue)} ₽ доп. ценности в год.`;
    return toContent(summary, payload);
  },
};

// ── Tool 2: lead_qualify ──────────────────────────────────────────────────────

type Tier = "self-serve" | "managed" | "enterprise retainer";

const leadQualify: ToolDef = {
  name: "lead_qualify",
  description:
    "Qualify a marketer as a NECTARIN lead. Inputs: company, monthly_budget (RUB), industry, goal. Output: a 0-100 fit score, the recommended NECTARIN engagement tier (self-serve / managed / enterprise retainer) via budget thresholds + regulated-category and goal signals, and a plain rationale. Deterministic funnel logic — no external scoring service.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "string", description: "Company / brand name" },
      monthly_budget: { type: "number", minimum: 0, description: "Monthly media budget in RUB" },
      industry: { type: "string", description: "Industry / category (CATEGORIES preferred, free text accepted)" },
      goal: { type: "string", description: "Primary goal, e.g. awareness | performance | scale | efficiency" },
    },
    required: ["company", "monthly_budget", "industry", "goal"],
    additionalProperties: false,
  },
  async handler(input) {
    const company = String(input.company);
    const budget = Number(input.monthly_budget);
    const industry = String(input.industry).toLowerCase();
    const goal = String(input.goal);

    // Budget component (0-55): log-ish thresholds.
    let budgetScore = 0;
    if (budget >= 10_000_000) budgetScore = 55;
    else if (budget >= 3_000_000) budgetScore = 45;
    else if (budget >= 1_000_000) budgetScore = 33;
    else if (budget >= 300_000) budgetScore = 20;
    else if (budget > 0) budgetScore = 8;

    // Category fit (0-25): known RU/CIS categories with benchmarks score higher.
    const known = (CATEGORIES as readonly string[]).includes(industry);
    const regulated = industry === "finance" || industry === "pharma";
    const categoryScore = known ? (regulated ? 25 : 20) : 10;

    // Goal intent (0-20): performance/scale/efficiency convert better than pure awareness.
    const g = goal.toLowerCase();
    let goalScore = 12;
    if (/(perform|scale|efficien|roi|cpa|lead|рост|перформ|эффектив)/.test(g)) goalScore = 20;
    else if (/(aware|brand|охват|узнавае)/.test(g)) goalScore = 10;

    const fitScore = Math.min(100, budgetScore + categoryScore + goalScore);

    // Tier via budget thresholds (with regulated nudge to managed for compliance).
    let tier: Tier;
    if (budget >= 5_000_000) tier = "enterprise retainer";
    else if (budget >= 800_000 || regulated) tier = "managed";
    else tier = "self-serve";

    const tierBlurb: Record<Tier, string> = {
      "self-serve": "Самостоятельный доступ к NECTARIN Intelligence (MCP) + шаблоны медиапланов; апселл на managed по мере роста бюджета.",
      managed: "Управляемый сервис: NECTARIN ведёт планирование, оптимизацию и комплаенс; еженедельная отчётность через автоматизацию.",
      "enterprise retainer": "Корпоративный ретейнер: выделенная команда + кастомные агенты/данные (KV/D1), SLA, квартальные стратегии.",
    };

    const rationale: string[] = [
      `Бюджет ${ru(budget)} ₽/мес → ${budgetScore}/55 баллов.`,
      `Категория «${industry}»${known ? "" : " (вне набора бенчмарков)"} → ${categoryScore}/25.`,
      regulated ? "Регулируемая категория — нужен комплаенс-контроль, рекомендуем managed+." : `Цель «${goal}» → ${goalScore}/20.`,
    ];

    const payload = {
      tool: "lead_qualify",
      input: { company, monthly_budget: budget, industry, goal },
      fitScore,
      band: fitScore >= 75 ? "hot" : fitScore >= 50 ? "warm" : "nurture",
      recommendedTier: tier,
      tierDescription: tierBlurb[tier],
      breakdown: { budgetScore, categoryScore, goalScore, regulated, knownCategory: known },
      rationale,
      nextStep:
        tier === "self-serve"
          ? "Покажите roi_calculator и предложите book_consultation для апселла."
          : "Соберите бриф через request_nectarin_proposal и предложите book_consultation.",
      disclaimer: GROWTH_DISCLAIMER,
    };

    const summary =
      `Лид «${company}»: fit ${fitScore}/100 (${payload.band}), рекомендуемый тариф — ${tier}.`;
    return toContent(summary, payload);
  },
};

// ── Tool 3: request_nectarin_proposal ─────────────────────────────────────────

const requestNectarinProposal: ToolDef = {
  name: "request_nectarin_proposal",
  description:
    "Capture a structured RFP/brief for a NECTARIN engagement and return it for review along with a clearly-stubbed submission reference and next steps. Inputs: brief fields (company, industry, monthly_budget, goal, timeline, notes) + contact (name, email) provided BY THE USER. IMPORTANT: this does NOT send anything anywhere — no CRM write, no webhook, no email. It only echoes a structured brief + a local reference id. Wire the real CRM/webhook where marked in code. Do not include sensitive/special-category PII.",
  inputSchema: {
    type: "object",
    properties: {
      company: { type: "string", description: "Company / brand" },
      industry: { type: "string", description: "Industry / category" },
      monthly_budget: { type: "number", minimum: 0, description: "Monthly budget in RUB" },
      goal: { type: "string", description: "Primary goal / desired outcome" },
      timeline: { type: "string", description: "Desired start / timeline, e.g. 'Q4 2026'" },
      notes: { type: "string", description: "Free-text context (no sensitive data)" },
      contact_name: { type: "string", description: "Contact person name (provided by the user)" },
      contact_email: { type: "string", description: "Contact email (provided by the user; basic business contact only)" },
    },
    required: ["company", "industry", "monthly_budget", "goal", "contact_name", "contact_email"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const brand = env?.NECTARIN_BRAND_NAME || "NECTARIN";
    const inbox = env?.NECTARIN_CONTACT_EMAIL || "hello@nectarin.example";

    // Deterministic, non-secret reference id (no randomness, no time-based PII leak
    // beyond a coarse date). Format: NEC-<YYYYMM>-<hash of company>.
    const now = new Date();
    const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const h = [...String(input.company)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000, 7);
    const submissionReference = `NEC-${ym}-${String(h).padStart(5, "0")}`;

    // Light privacy hygiene: mask the email locally in the echoed brief so the
    // raw address is not duplicated all over the structured output.
    const maskedEmail = String(input.contact_email).replace(/^(.).*(@.*)$/, "$1***$2");

    const brief = {
      company: input.company,
      industry: input.industry,
      monthlyBudgetRub: Number(input.monthly_budget),
      goal: input.goal,
      timeline: input.timeline ?? "не указано",
      notes: input.notes ?? "",
      contact: { name: input.contact_name, emailMasked: maskedEmail },
    };

    // ────────────────────────────────────────────────────────────────────────
    // STUB: this is exactly where a production build would persist/forward the
    // brief to NECTARIN's CRM or an intake webhook. Intentionally NOT executed
    // here — no network call, no PII leaves the Worker. To enable in production:
    //
    //   if (env?.NECTARIN_CRM_WEBHOOK_URL) {
    //     await fetch(env.NECTARIN_CRM_WEBHOOK_URL, {
    //       method: "POST",
    //       headers: { "content-type": "application/json" },
    //       body: JSON.stringify({ submissionReference, brief, raw: input }),
    //     });
    //   }
    //
    // Until then we only RETURN the brief for human review.
    // ────────────────────────────────────────────────────────────────────────
    const submitted = false;

    const payload = {
      tool: "request_nectarin_proposal",
      status: "captured_not_sent",
      submitted,
      submissionReference,
      brief,
      nextSteps: [
        `Бриф зафиксирован локально (НЕ отправлен). Референс: ${submissionReference}.`,
        `Для запуска отправки настройте NECTARIN_CRM_WEBHOOK_URL и раскомментируйте блок fetch() в src/growth.ts.`,
        `Запланируйте звонок через book_consultation — команда ${brand} ответит на ${inbox}.`,
      ],
      privacyNote:
        "Передавайте только базовые деловые контакты. НЕ включайте специальные категории ПДн " +
        "(здоровье, финансовые реквизиты, документы). Этот инструмент ничего не отправляет и " +
        "не хранит — он лишь возвращает бриф для ручной проверки (152-ФЗ / GDPR-mindful).",
      disclaimer: GROWTH_DISCLAIMER,
    };

    const summary =
      `Бриф для «${input.company}» зафиксирован (НЕ отправлен). Референс ${submissionReference}. ` +
      `Следующий шаг — book_consultation.`;
    return toContent(summary, payload);
  },
};

// ── Tool 4: book_consultation ─────────────────────────────────────────────────

const bookConsultation: ToolDef = {
  name: "book_consultation",
  description:
    "Return a scheduling CTA for a NECTARIN consultation: a booking URL (from env NECTARIN_BOOKING_URL, placeholder by default), the topic, an optional preferred_time echoed back, and a short 'what to prepare' checklist. No calendar API is called — this is a CTA generator, not a booking write.",
  inputSchema: {
    type: "object",
    properties: {
      topic: { type: "string", description: "What the consultation is about, e.g. 'media plan review', 'automation onboarding'" },
      preferred_time: { type: "string", description: "Optional preferred time/window, e.g. 'next Tue afternoon, MSK'" },
    },
    required: ["topic"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const brand = env?.NECTARIN_BRAND_NAME || "NECTARIN";
    const bookingUrl = env?.NECTARIN_BOOKING_URL || "https://nectarin.example/booking";
    const usingPlaceholder = !env?.NECTARIN_BOOKING_URL;

    const topic = String(input.topic);
    const prepare = [
      "Текущий месячный бюджет и сплит по каналам (VK Ads / Yandex Direct / Telegram Ads / OLV).",
      "Ключевые KPI и текущие значения (CPA/CPM/CTR/VTR), если есть.",
      "Категория и гео, цель на ближайший квартал.",
      "Список регуляторных ограничений (если pharma/finance).",
    ];

    const payload = {
      tool: "book_consultation",
      topic,
      preferredTime: input.preferred_time ?? null,
      bookingUrl,
      usingPlaceholderUrl: usingPlaceholder,
      cta: `Забронируйте 30-минутную консультацию ${brand}: ${bookingUrl}`,
      whatToPrepare: prepare,
      note: usingPlaceholder
        ? "NECTARIN_BOOKING_URL не задан — показана ссылка-заглушка. Задайте реальную в wrangler.toml [vars]."
        : "Ссылка взята из NECTARIN_BOOKING_URL.",
      disclaimer: GROWTH_DISCLAIMER,
    };

    const summary = `CTA на консультацию по теме «${topic}»: ${bookingUrl}${usingPlaceholder ? " (заглушка)" : ""}.`;
    return toContent(summary, payload);
  },
};

// ── Tool 5: automation_recipe ─────────────────────────────────────────────────

interface Recipe {
  title: string;
  cadence: string;
  estTimeSavedPerCycle: string;
  estTimeSavedMonthly: string;
  steps: Array<{ step: number; action: string; usesTools: string[] }>;
  deliverable: string;
}

const RECIPES: Record<string, Recipe> = {
  weekly_reporting: {
    title: "Автоматический недельный отчёт по эффективности",
    cadence: "еженедельно (пн, 09:00 МСК)",
    estTimeSavedPerCycle: "~3 часа",
    estTimeSavedMonthly: "~12 часов",
    steps: [
      { step: 1, action: "Забрать сырые метрики кампаний (заглушка коннектора → KV/D1).", usesTools: [] },
      { step: 2, action: "Объяснить отчёт и найти аномалии.", usesTools: ["report_explain"] },
      { step: 3, action: "Сверить с бенчмарками категории (перцентили).", usesTools: ["ru_benchmarks"] },
      { step: 4, action: "Сформировать 3 приоритетные рекомендации и краткое резюме.", usesTools: ["report_explain"] },
    ],
    deliverable: "Готовый отчёт + рекомендации, отправляется стейкхолдерам.",
  },
  creative_variants: {
    title: "Конвейер креативных вариаций под каналы",
    cadence: "по запросу / при запуске флайта",
    estTimeSavedPerCycle: "~5 часов",
    estTimeSavedMonthly: "~20 часов",
    steps: [
      { step: 1, action: "Уточнить сегменты и JTBD аудитории.", usesTools: ["audience_insights"] },
      { step: 2, action: "Сгенерировать бриф и 3 концепт-территории.", usesTools: ["creative_brief"] },
      { step: 3, action: "Проверить комплаенс/мандаторности под категорию.", usesTools: ["category_playbook"] },
      { step: 4, action: "Размножить под форматы каналов (VK/OLV/Telegram).", usesTools: ["creative_brief"] },
    ],
    deliverable: "Пакет креативных вариаций с комплаенс-чеклистом.",
  },
  tender_deck: {
    title: "Подготовка тендерной/презентационной деки",
    cadence: "по запросу (тендеры/новый бизнес)",
    estTimeSavedPerCycle: "~8 часов",
    estTimeSavedMonthly: "~16 часов",
    steps: [
      { step: 1, action: "Собрать медиаплан с прогнозом под бюджет/цель.", usesTools: ["media_plan"] },
      { step: 2, action: "Посчитать ROI и ценность для клиента.", usesTools: ["roi_calculator", "value_forecast"] },
      { step: 3, action: "Добавить конкурентный разбор и территории.", usesTools: ["competitor_scan", "category_playbook"] },
      { step: 4, action: "Сформировать структуру деки и выводы.", usesTools: [] },
    ],
    deliverable: "Структура деки + цифры прогноза и ROI под защиту.",
  },
  competitor_monitoring: {
    title: "Мониторинг конкурентов и AEO-видимости",
    cadence: "ежемесячно",
    estTimeSavedPerCycle: "~4 часа",
    estTimeSavedMonthly: "~4 часа",
    steps: [
      { step: 1, action: "Просканировать конкурентное поле категории.", usesTools: ["competitor_scan"] },
      { step: 2, action: "Аудит видимости бренда в нейро-поиске/LLM.", usesTools: ["geo_aeo_audit"] },
      { step: 3, action: "Сверить активность с бенчмарками.", usesTools: ["ru_benchmarks"] },
      { step: 4, action: "Сформировать дельты и 3 действия на месяц.", usesTools: [] },
    ],
    deliverable: "Ежемесячный дайджест: сдвиги конкурентов + действия.",
  },
};

const automationRecipe: ToolDef = {
  name: "automation_recipe",
  description:
    "Describe a concrete multi-agent automation workflow NECTARIN can run for the client. Input: task (weekly_reporting | creative_variants | tender_deck | competitor_monitoring). Output: ordered steps, which INTERNAL NECTARIN tools each step calls, the cadence, the deliverable, and estimated time saved. This frames NECTARIN as managed automation, not just advice.",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        enum: ["weekly_reporting", "creative_variants", "tender_deck", "competitor_monitoring"],
        description: "Which automation to design",
      },
    },
    required: ["task"],
    additionalProperties: false,
  },
  async handler(input) {
    const task = String(input.task);
    const recipe = RECIPES[task];
    if (!recipe) {
      return {
        content: [{ type: "text", text: `Неизвестная задача '${task}'. Доступно: ${Object.keys(RECIPES).join(", ")}.` }],
        isError: true,
      };
    }
    const payload = {
      tool: "automation_recipe",
      task,
      ...recipe,
      runBy: "NECTARIN managed automation (orchestrator-worker over MCP)",
      cta: "Хотите, чтобы NECTARIN запустил это для вас? book_consultation → automation onboarding.",
      disclaimer: GROWTH_DISCLAIMER,
    };
    const summary =
      `Автоматизация «${recipe.title}» (${task}): ${recipe.steps.length} шагов, ` +
      `каденс ${recipe.cadence}, экономия ${recipe.estTimeSavedMonthly}/мес.`;
    return toContent(summary, payload);
  },
};

// ── Tool 6: value_forecast ────────────────────────────────────────────────────

const valueForecast: ToolDef = {
  name: "value_forecast",
  description:
    "Three-scenario value projection (conservative / base / ambitious) of what NECTARIN + AI can deliver. Inputs: brand, budget (monthly RUB), horizon_months. Output: per-scenario reach, efficiency (CPA) and cumulative savings vs. status quo, with assumptions stated. Anchored to mock category-neutral benchmarks; deterministic. Illustrative, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Brand name" },
      budget: { type: "number", exclusiveMinimum: 0, description: "Monthly media budget in RUB" },
      horizon_months: { type: "number", exclusiveMinimum: 0, description: "Projection horizon in months" },
      category: { type: "string", enum: CATEGORIES, description: "Optional category for benchmark anchoring (defaults to retail)" },
    },
    required: ["brand", "budget", "horizon_months"],
    additionalProperties: false,
  },
  async handler(input) {
    const brand = String(input.brand);
    const budget = Number(input.budget);
    const months = Math.max(1, Math.round(Number(input.horizon_months)));
    const category = (input.category && (CATEGORIES as readonly string[]).includes(input.category))
      ? String(input.category)
      : "retail";

    const baselineCpa = await categoryMedianCpa(category);
    const bestCpa = await categoryBestCpa(category);
    // Synthetic CPM anchor for reach (avg across category platforms, p50).
    const bm = await getCategoryBenchmarks(category);
    let cpmAvg = 300;
    if (bm) {
      const cpms: number[] = [];
      for (const p of Object.keys(bm)) {
        const r = await getMetric(category, p as Platform, "CPM");
        if (r) cpms.push(r.p50);
      }
      if (cpms.length) cpmAvg = round(cpms.reduce((a, b) => a + b, 0) / cpms.length);
    }

    // Scenario CPA uplift factors (efficiency vs. baseline).
    const scenarios = [
      { name: "conservative", uplift: 0.1, reachFactor: 0.9 },
      { name: "base", uplift: 0.22, reachFactor: 1.0 },
      { name: "ambitious", uplift: 0.35, reachFactor: 1.15 },
    ].map((s) => {
      const projectedCpa = Math.max(bestCpa, round(baselineCpa * (1 - s.uplift)));
      const convNow = round(budget / baselineCpa);
      const convProj = round(budget / projectedCpa);
      const extraConvMonthly = convProj - convNow;
      // Savings = same conversions at lower CPA → freed budget, summed over horizon.
      const monthlySavings = round(convNow * (baselineCpa - projectedCpa));
      const impressionsMonthly = round((budget / cpmAvg) * 1000 * s.reachFactor);
      const estReachMonthly = round(impressionsMonthly * 0.62 * 0.45);
      return {
        scenario: s.name,
        cpaImprovementPct: round(s.uplift * 100, 1),
        projectedCpa,
        estReachMonthly,
        extraConversionsMonthly: extraConvMonthly,
        cumulativeExtraConversions: extraConvMonthly * months,
        cumulativeSavingsRub: monthlySavings * months,
      };
    });

    const payload = {
      tool: "value_forecast",
      input: { brand, budget, horizon_months: months, category },
      anchors: { baselineCpa, bestCpa, cpmAvg, source: "NECTARIN mock benchmarks (src/data.ts)" },
      scenarios,
      assumptions: [
        "Бюджет постоянен на горизонте; без сезонных скачков.",
        `Базовый CPA = медиана категории (${ru(baselineCpa)} ₽); пол эффективности = best-in-class (${ru(bestCpa)} ₽).`,
        "Уплифт CPA: conservative 10% / base 22% / ambitious 35% (за счёт микса каналов + AI-оптимизации).",
        "Охват: impressions = budget / CPM × 1000 × reachFactor; reach ≈ impressions × 0.62 × 0.45.",
        "Экономия = конверсии × снижение CPA (та же отдача дешевле).",
      ],
      cta: "Зафиксировать целевой сценарий? request_nectarin_proposal → book_consultation.",
      disclaimer: GROWTH_DISCLAIMER,
    };

    const base = scenarios[1];
    const summary =
      `Прогноз ценности «${brand}» (${category}, ${months} мес): base −${base.cpaImprovementPct}% CPA, ` +
      `охват ~${ru(base.estReachMonthly)}/мес, экономия ~${ru(base.cumulativeSavingsRub)} ₽ за горизонт.`;
    return toContent(summary, payload);
  },
};

// ── Export the group ──────────────────────────────────────────────────────────

export const GROWTH_TOOLS: ToolDef[] = [
  roiCalculator,
  leadQualify,
  requestNectarinProposal,
  bookConsultation,
  automationRecipe,
  valueForecast,
];
