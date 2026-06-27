/**
 * PREMIUM ANALYTICS tool group for NECTARIN Intelligence — Cloudflare Workers.
 *
 * Where the Intelligence tools INFORM and the Growth tools CONVERT, these tools
 * make NECTARIN a *senior* operator: a RU ad-law compliance officer
 * (`compliance_check`), a rigorous experimentation lead (`ab_test_planner`,
 * real two-proportion power analysis), and a unit-economics analyst
 * (`unit_economics`). All math is deterministic and auditable; `compliance_check`
 * additionally uses the model (when LLM_API_KEY is set) to add nuance and a
 * compliant rewrite, with graceful fallback to the rule engine alone.
 *
 * Nothing here transmits PII or makes a real CRM/network call. The compliance
 * output is decision-support, NOT legal advice.
 */

import {
  CATEGORIES,
  PLATFORMS,
  DATA_META,
  MONTHS_RU,
  getCategoryBenchmarks,
  getMetric,
  getSeasonalityIndex,
  type Kpi,
} from "./data.js";
import { callLLM, type LlmEnv } from "./orchestrator.js";
import type { ToolDef, ToolResult } from "./tools.js";

// ── local helpers (self-contained, mirrors growth.ts) ────────────────────────

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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

function toContent(summary: string, payload: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: "```json\n" + JSON.stringify(payload, null, 2) + "\n```" },
    ],
    structuredContent: isRecord(payload) ? payload : { result: payload },
  };
}

const NOT_LEGAL_ADVICE =
  "Decision-support only, NOT legal advice. Final sign-off must come from a qualified " +
  "lawyer / regulatory team (РФ: ФЗ «О рекламе» №38-ФЗ, маркировка ОРД/ЕРИР).";

// ═════════════════════════════════════════════════════════════════════════════
// Tool 1: compliance_check — RU advertising-law copy review (ФЗ-38 / ОРД / etc.)
// ═════════════════════════════════════════════════════════════════════════════

type Severity = "high" | "medium" | "low" | "info";

interface Finding {
  severity: Severity;
  area: string;
  article: string;
  issue: string;
  fix: string;
}

interface Rule {
  test: RegExp;
  /** When set, only applies if the category matches. */
  category?: string;
  /** When true, the rule fires when test does NOT match (used for missing mandatories). */
  negate?: boolean;
  finding: Omit<Finding, never>;
}

const PENALTY: Record<Severity, number> = { high: 26, medium: 13, low: 5, info: 0 };

// Heuristic rule base. Conservative + RU-specific. Negated rules check for the
// ABSENCE of a required disclosure (e.g. pharma warning, ПСК for credit).
const RULES: Rule[] = [
  {
    test: /(лучш(ий|ая|ие|её|ее)|№\s?1|номер\s?один|самый|самая|самое|первый на рынке|идеальн|непревзойд|вне конкуренц)/i,
    finding: {
      severity: "high",
      area: "Превосходная степень без подтверждения",
      article: "ст. 5 ФЗ-38 (недобросовестная/недостоверная реклама)",
      issue: "Использованы превосходные степени («лучший», «№1», «самый») без объективного подтверждения и указания критерия/периода/источника.",
      fix: "Уберите превосходную степень или подкрепите её ссылкой на исследование/критерий и период (например, «по версии … за 2026»).",
    },
  },
  {
    test: /(гаранти(я|и|ру|рован))/i,
    finding: {
      severity: "medium",
      area: "Гарантии/обещания результата",
      article: "ст. 5 ФЗ-38",
      issue: "Слово «гарантия» без раскрытия условий может вводить в заблуждение.",
      fix: "Уточните условия и ограничения гарантии или замените на проверяемую формулировку.",
    },
  },
  {
    test: /(100\s?%|абсолютн|навсегда|никогда не)/i,
    finding: {
      severity: "medium",
      area: "Абсолютные утверждения",
      article: "ст. 5 ФЗ-38",
      issue: "Абсолютные формулировки («100%», «навсегда») трудно доказуемы и рискованны.",
      fix: "Смягчите формулировку или добавьте подтверждаемые условия.",
    },
  },
  {
    test: /(лучше чем|выгоднее чем|дешевле чем|быстрее чем|против конкурент)/i,
    finding: {
      severity: "medium",
      area: "Сравнительная реклама",
      article: "ст. 5 ФЗ-38 (некорректное сравнение)",
      issue: "Прямое сравнение с конкурентами требует корректных, подтверждаемых критериев.",
      fix: "Уберите сравнение или укажите измеримый критерий и источник; не упоминайте конкурентов некорректно.",
    },
  },
  {
    test: /(только сегодня|последн[а-яё]*\s+шанс|осталось\s+\d+|спешите|сгорает)/i,
    finding: {
      severity: "low",
      area: "Искусственная срочность",
      article: "ст. 5 ФЗ-38",
      issue: "Срочность/дефицит не должны вводить в заблуждение о реальных условиях акции.",
      fix: "Убедитесь, что срок/остаток реальны и проверяемы.",
    },
  },
  // ── finance ──
  {
    test: /гарантирован[а-яё]*\s+доходност|доход[а-яё]*\s+гарантир|без риска/i,
    category: "finance",
    finding: {
      severity: "high",
      area: "Гарантия доходности (финансы)",
      article: "ст. 28 ФЗ-38; требования ЦБ РФ",
      issue: "Нельзя гарантировать доходность инвестиционных продуктов или заявлять «без риска».",
      fix: "Уберите гарантию доходности; добавьте дисклеймер о рисках и отсутствии гарантий.",
    },
  },
  {
    test: /(кредит|займ|рассрочк|ипотек|ставка\s+от|под\s+\d+\s?%)/i,
    category: "finance",
    finding: {
      severity: "info",
      area: "Кредитный продукт",
      article: "ст. 28 ФЗ-38",
      issue: "Реклама кредита/займа требует раскрытия всех существенных условий и ПСК.",
      fix: "Проверьте, что указана полная стоимость кредита (ПСК) и диапазон условий, а не только минимальная ставка.",
    },
  },
  // ── pharma ──
  {
    test: /(излечива|вылечит|гарантир[а-яё]*\s+эффект|без побочн|абсолютно безопас)/i,
    category: "pharma",
    finding: {
      severity: "high",
      area: "Недопустимые заявления (фарма)",
      article: "ст. 24 ФЗ-38",
      issue: "Заявления об излечении/100% эффекте/полной безопасности недопустимы.",
      fix: "Уберите такие заявления; опирайтесь на инструкцию и показания.",
    },
  },
];

// Mandatories that must be PRESENT — flagged when missing (category-gated).
const MANDATORIES: Array<{ test: RegExp; category?: string; finding: Finding }> = [
  {
    test: /противопоказани|проконсультируйтесь|специалист(ом|а)?/i,
    category: "pharma",
    finding: {
      severity: "high",
      area: "Отсутствует обязательное предупреждение (фарма)",
      article: "ст. 24 ФЗ-38",
      issue: "Нет обязательного предупреждения о противопоказаниях и необходимости консультации специалиста.",
      fix: "Добавьте: «Имеются противопоказания. Проконсультируйтесь со специалистом».",
    },
  },
  {
    test: /(пск|полная стоимость кредита)/i,
    category: "finance",
    finding: {
      severity: "high",
      area: "Не раскрыта ПСК (финансы)",
      article: "ст. 28 ФЗ-38; ФЗ «О потребкредите»",
      issue: "Для кредитного продукта не указана полная стоимость кредита (ПСК).",
      fix: "Добавьте ПСК и диапазон существенных условий.",
    },
  },
];

const HARD_BLOCK = /(алкогол|пиво|вино|водк|коньяк|сигарет|табак|вейп|казино|букмекер|ставк[аи]\s+на\s+спорт|онлайн-казино)/i;

function runComplianceRules(copy: string, category?: string): Finding[] {
  const findings: Finding[] = [];
  const text = copy;

  if (HARD_BLOCK.test(text)) {
    findings.push({
      severity: "high",
      area: "Жёстко ограниченная/запрещённая категория",
      article: "ст. 21-27 ФЗ-38 (алкоголь/табак/азартные игры)",
      issue: "Обнаружены признаки строго регулируемой категории (алкоголь/табак/гемблинг).",
      fix: "Не запускать без отдельной юридической проверки — большинство таких размещений запрещены или жёстко ограничены.",
    });
  }

  for (const r of RULES) {
    if (r.category && r.category !== category) continue;
    if (r.test.test(text)) findings.push({ ...r.finding });
  }

  // Mandatories: fire when the required phrase is ABSENT for the category.
  const cat = category;
  // ПСК mandatory only when a credit product is actually mentioned.
  const mentionsCredit = /(кредит|займ|рассрочк|ипотек|ставка|под\s+\d+\s?%)/i.test(text);
  for (const m of MANDATORIES) {
    if (m.category && m.category !== cat) continue;
    if (m.finding.area.includes("ПСК") && !mentionsCredit) continue;
    if (!m.test.test(text)) findings.push({ ...m.finding });
  }

  // ОРД marking reminder — always relevant for online ads.
  findings.push({
    severity: "info",
    area: "Маркировка интернет-рекламы (ОРД/ЕРИР)",
    article: "ст. 18.1 ФЗ-38",
    issue: "Онлайн-реклама требует пометки «Реклама», указания рекламодателя и токена erid (через ОРД).",
    fix: "Перед запуском получите erid в ОРД и добавьте пометку «Реклама» + наименование рекламодателя.",
  });

  return findings;
}

function complianceScore(findings: Finding[]): number {
  let score = 100;
  for (const f of findings) score -= PENALTY[f.severity];
  return Math.max(0, Math.min(100, score));
}

const complianceCheck: ToolDef = {
  name: "compliance_check",
  description:
    "RU advertising-law compliance review of ad copy. Paste the creative text (+ optional category/platform) and get: a 0-100 compliance score, a list of flagged risks with severity, the relevant ФЗ-38 «О рекламе» article, and a concrete fix — covering superlatives/ФАС risk, comparative claims, finance (ПСК, guaranteed returns — ст. 28), pharma (mandatory warning — ст. 24), alcohol/tobacco/gambling hard-blocks, and ОРД/ЕРИР marking. When an LLM key is configured it also returns extra nuance and a compliant rewrite. Decision-support, NOT legal advice.",
  inputSchema: {
    type: "object",
    properties: {
      copy: { type: "string", description: "The ad creative text to review (RU)" },
      category: { type: "string", enum: CATEGORIES, description: "Optional category (enables category-specific rules)" },
      platform: { type: "string", enum: PLATFORMS, description: "Optional placement platform" },
    },
    required: ["copy"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const copy = String(input.copy ?? "");
    const category = input.category ? String(input.category) : undefined;
    const findings = runComplianceRules(copy, category);
    const score = complianceScore(findings);
    const high = findings.filter((f) => f.severity === "high").length;
    const riskLevel = high > 0 || score < 50 ? "high" : score < 80 ? "medium" : "low";

    // Optional LLM enrichment: extra issues + a compliant rewrite. Graceful fallback.
    let llm: { additionalNotes: string; compliantRewrite: string } | null = null;
    const llmEnv = env as LlmEnv | undefined;
    if (llmEnv?.LLM_API_KEY) {
      const raw = await callLLM(
        {
          system:
            "Ты — комплаенс-юрист по рекламе РФ (ФЗ «О рекламе» №38-ФЗ, маркировка ОРД). " +
            "Верни СТРОГО JSON вида {\"additionalNotes\":\"...\",\"compliantRewrite\":\"...\"} без markdown. " +
            "additionalNotes — кратко доп.риски, не покрытые правилами. compliantRewrite — переписанный, " +
            "комплаентный вариант текста на русском, сохраняющий смысл и маркетинговую силу.",
          prompt:
            `Категория: ${category ?? "не указана"}.\nТекст объявления:\n"""${copy}"""\n` +
            `Уже найденные правилами риски: ${findings.map((f) => f.area).join("; ") || "нет"}.`,
        },
        llmEnv
      );
      try {
        const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
        if (parsed && (parsed.additionalNotes || parsed.compliantRewrite)) {
          llm = {
            additionalNotes: String(parsed.additionalNotes ?? ""),
            compliantRewrite: String(parsed.compliantRewrite ?? ""),
          };
        }
      } catch {
        if (raw && !raw.includes("(LLM-stub:")) llm = { additionalNotes: raw.slice(0, 800), compliantRewrite: "" };
      }
    }

    const payload = {
      tool: "compliance_check",
      input: { category: category ?? null, platform: input.platform ?? null, copyChars: copy.length },
      complianceScore: score,
      riskLevel,
      counts: {
        high,
        medium: findings.filter((f) => f.severity === "medium").length,
        low: findings.filter((f) => f.severity === "low").length,
        info: findings.filter((f) => f.severity === "info").length,
      },
      findings,
      llm,
      disclaimer: NOT_LEGAL_ADVICE,
    };

    const summary =
      `Комплаенс-скоринг: ${score}/100 (риск ${riskLevel}). ` +
      `Найдено: ${high} высоких, ${payload.counts.medium} средних, ${payload.counts.low} низких замечаний` +
      (llm?.compliantRewrite ? " + предложен комплаентный рерайт." : ".");
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 2: ab_test_planner — rigorous two-proportion power analysis
// ═════════════════════════════════════════════════════════════════════════════

/** Inverse standard-normal CDF (Acklam's algorithm). Accurate to ~1e-9. */
function invNorm(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const ph = 1 - pl;
  let q: number, r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const abTestPlanner: ToolDef = {
  name: "ab_test_planner",
  description:
    "Plan an A/B test with real statistics (two-proportion z-test power analysis). Inputs: baselineRatePct (current conversion %), mdeRelPct (minimum relative uplift to detect, e.g. 10 = +10%), dailyVisitorsPerVariant, optional variants (default 2), powerPct (default 80), alphaPct (default 5, two-sided). Returns the required sample size per variant, total, estimated test duration in days, the detectable absolute lift, and guardrails (min runtime, multiple-comparison note). Deterministic — uses the inverse-normal (Acklam) for exact z-scores.",
  inputSchema: {
    type: "object",
    properties: {
      baselineRatePct: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100, description: "Current conversion rate, in percent" },
      mdeRelPct: { type: "number", exclusiveMinimum: 0, description: "Minimum detectable effect as a RELATIVE % uplift (e.g. 10 = detect +10%)" },
      dailyVisitorsPerVariant: { type: "number", exclusiveMinimum: 0, description: "Daily traffic to EACH variant" },
      variants: { type: "number", minimum: 2, description: "Number of variants incl. control (default 2)" },
      powerPct: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100, description: "Statistical power, percent (default 80)" },
      alphaPct: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 100, description: "Significance level, percent two-sided (default 5)" },
    },
    required: ["baselineRatePct", "mdeRelPct", "dailyVisitorsPerVariant"],
    additionalProperties: false,
  },
  async handler(input) {
    const p1 = Number(input.baselineRatePct) / 100;
    const mde = Number(input.mdeRelPct) / 100;
    const dailyPerVariant = Number(input.dailyVisitorsPerVariant);
    const variants = Math.max(2, Math.round(Number(input.variants ?? 2)));
    const power = Number(input.powerPct ?? 80) / 100;
    let alpha = Number(input.alphaPct ?? 5) / 100;

    // Bonferroni correction across the (variants-1) comparisons vs control.
    const comparisons = variants - 1;
    const alphaAdj = alpha / comparisons;

    const p2 = Math.min(0.999999, p1 * (1 + mde));
    const absLift = p2 - p1;

    const zAlpha = invNorm(1 - alphaAdj / 2);
    const zBeta = invNorm(power);

    // Per-variant sample size (two-proportion, unpooled variance form).
    const nPerVariant = Math.ceil(
      ((zAlpha + zBeta) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2))) / (absLift * absLift)
    );
    const totalN = nPerVariant * variants;
    const days = Math.ceil(totalN / (dailyPerVariant * variants));
    const minRuntimeDays = Math.max(days, 14); // never call a test before 2 weeks (weekly seasonality)

    const payload = {
      tool: "ab_test_planner",
      input: {
        baselineRatePct: Number(input.baselineRatePct),
        mdeRelPct: Number(input.mdeRelPct),
        dailyVisitorsPerVariant: dailyPerVariant,
        variants,
        powerPct: power * 100,
        alphaPct: alpha * 100,
      },
      design: {
        baselineRate: round(p1, 5),
        targetRate: round(p2, 5),
        absoluteLift: round(absLift, 5),
        comparisons,
        alphaAdjustedPerComparison: round(alphaAdj, 5),
        zAlpha: round(zAlpha, 4),
        zBeta: round(zBeta, 4),
      },
      result: {
        sampleSizePerVariant: nPerVariant,
        totalSampleSize: totalN,
        estDurationDays: days,
        recommendedMinRuntimeDays: minRuntimeDays,
      },
      guardrails: [
        "Не подводи итоги раньше расчётного размера выборки (no peeking) — это раздувает ложноположительные.",
        "Минимальный прогон ≥ 14 дней, чтобы покрыть недельную сезонность.",
        comparisons > 1
          ? `Поправка на множественные сравнения (Bonferroni): α на сравнение = ${round(alphaAdj, 4)}.`
          : "Одно сравнение — поправка на множественность не требуется.",
        "Следи за SRM (sample ratio mismatch): фактический сплит трафика должен совпадать с ожидаемым.",
      ],
      method:
        "n/variant = (z_{1-α/2} + z_{power})² · (p1(1−p1)+p2(1−p2)) / (p2−p1)²; " +
        "z через обратную функцию нормального распределения (Acklam); α скорректирована по Бонферрони.",
      disclaimer: "Оценка для биномиальной метрики (конверсия). Для непрерывных метрик нужна другая модель.",
    };

    const summary =
      `A/B-план: ${ru(nPerVariant)} на вариант (${ru(totalN)} всего), ` +
      `~${days} дн. при ${ru(dailyPerVariant)}/вариант/день. ` +
      `Детектируем абсолютный сдвиг ${round(absLift * 100, 2)} п.п. (${input.baselineRatePct}% → ${round(p2 * 100, 2)}%).`;
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 3: unit_economics — LTV / CAC / payback / ROAS with a health verdict
// ═════════════════════════════════════════════════════════════════════════════

const unitEconomics: ToolDef = {
  name: "unit_economics",
  description:
    "Marketing unit economics & health check. Inputs: aov (avg order value or ARPU per purchase, RUB), grossMarginPct, and EITHER cac directly OR (monthlySpend + newCustomers) to derive it; plus repeat behaviour as purchasesPerYear and lifespanYears (or churnRatePct). Returns gross-margin LTV, LTV:CAC, payback period (months), ROAS, contribution per customer, a health verdict (LTV:CAC ≥3 healthy, payback <12mo good), and concrete levers. Deterministic; illustrative, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      aov: { type: "number", exclusiveMinimum: 0, description: "Average order value / ARPU per purchase, RUB" },
      grossMarginPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Gross margin, percent" },
      cac: { type: "number", exclusiveMinimum: 0, description: "Customer acquisition cost, RUB (or omit and pass monthlySpend + newCustomers)" },
      monthlySpend: { type: "number", exclusiveMinimum: 0, description: "Monthly acquisition spend, RUB (used with newCustomers to derive CAC)" },
      newCustomers: { type: "number", exclusiveMinimum: 0, description: "New customers acquired in that month" },
      purchasesPerYear: { type: "number", exclusiveMinimum: 0, description: "Repeat purchase frequency per year (default 1)" },
      lifespanYears: { type: "number", exclusiveMinimum: 0, description: "Customer lifespan in years (or pass churnRatePct)" },
      churnRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Monthly churn %, used to derive lifespan if lifespanYears omitted" },
    },
    required: ["aov", "grossMarginPct"],
    additionalProperties: false,
  },
  async handler(input) {
    const aov = Number(input.aov);
    const margin = Number(input.grossMarginPct) / 100;

    // CAC: explicit, or derived from spend / customers.
    let cac = input.cac ? Number(input.cac) : NaN;
    let cacSource = "provided";
    if (!Number.isFinite(cac)) {
      if (input.monthlySpend && input.newCustomers) {
        cac = Number(input.monthlySpend) / Number(input.newCustomers);
        cacSource = "derived from monthlySpend / newCustomers";
      } else {
        return {
          content: [
            {
              type: "text",
              text: "Нужен CAC: передайте `cac` напрямую ИЛИ пару `monthlySpend` + `newCustomers`.",
            },
          ],
          isError: true,
        };
      }
    }

    const purchasesPerYear = Number(input.purchasesPerYear ?? 1);
    // Lifespan: explicit years, or derived from monthly churn (lifespan ≈ 1/churn months).
    let lifespanYears = input.lifespanYears ? Number(input.lifespanYears) : NaN;
    let lifespanSource = "provided";
    if (!Number.isFinite(lifespanYears)) {
      if (input.churnRatePct) {
        lifespanYears = 1 / (Number(input.churnRatePct) / 100) / 12;
        lifespanSource = "derived from churnRatePct (1/churn months)";
      } else {
        lifespanYears = 1;
        lifespanSource = "default 1 year";
      }
    }

    const grossPerPurchase = aov * margin;
    const totalPurchases = purchasesPerYear * lifespanYears;
    const ltv = round(grossPerPurchase * totalPurchases);
    const ltvToCac = cac > 0 ? round(ltv / cac, 2) : null;
    const grossPerMonth = grossPerPurchase * (purchasesPerYear / 12);
    const paybackMonths = grossPerMonth > 0 ? round(cac / grossPerMonth, 1) : null;
    const firstOrderRoas = cac > 0 ? round(aov / cac, 2) : null;
    const contributionPerCustomer = round(ltv - cac);

    const healthy = ltvToCac !== null && ltvToCac >= 3 && paybackMonths !== null && paybackMonths <= 12;
    const verdict =
      ltvToCac === null
        ? "n/a"
        : ltvToCac >= 3 && (paybackMonths ?? 99) <= 12
        ? "healthy — модель масштабируема: можно увеличивать бюджет"
        : ltvToCac >= 1
        ? "borderline — экономика положительная, но есть риск; улучшайте до 3:1 / окупаемости <12 мес."
        : "unhealthy — привлечение дороже ценности клиента; не масштабировать, сначала чинить юнит-экономику";

    const levers: string[] = [];
    if (ltvToCac !== null && ltvToCac < 3) {
      levers.push("Снизить CAC: оптимизировать сплит/таргетинг (см. budget_optimizer), отсечь дорогие каналы.");
      levers.push("Поднять AOV: апсейл/кросс-сейл, бандлы, порог бесплатной доставки.");
      levers.push("Увеличить частоту/удержание (CRM, подписки) — рост LTV без роста CAC.");
    }
    if (paybackMonths !== null && paybackMonths > 12) {
      levers.push("Сократить окупаемость: предоплата/подписка, маржинальные SKU в первом заказе.");
    }
    if (levers.length === 0) levers.push("Экономика здорова — масштабируйте бюджет, контролируя предельный CAC.");

    const payload = {
      tool: "unit_economics",
      input: { aov, grossMarginPct: Number(input.grossMarginPct), cacSource, lifespanSource },
      derived: {
        cac: round(cac),
        grossMarginPerPurchase: round(grossPerPurchase),
        purchasesPerYear,
        lifespanYears: round(lifespanYears, 2),
        totalLifetimePurchases: round(totalPurchases, 2),
      },
      metrics: {
        ltv,
        ltvToCac,
        paybackMonths,
        firstOrderRoas,
        contributionPerCustomer,
      },
      verdict,
      healthy,
      levers,
      method:
        "LTV = AOV × grossMargin × (purchasesPerYear × lifespanYears); LTV:CAC = LTV / CAC; " +
        "payback(мес) = CAC / (AOV × grossMargin × purchasesPerYear/12); ROAS(1st) = AOV / CAC.",
      disclaimer: "Иллюстративная модель юнит-экономики; точность зависит от входных данных. Не финансовая гарантия.",
    };

    const summary =
      `Юнит-экономика: LTV ${ru(ltv)} ₽, CAC ${ru(round(cac))} ₽, LTV:CAC ${ltvToCac ?? "n/a"}, ` +
      `окупаемость ${paybackMonths ?? "n/a"} мес → ${healthy ? "здорово" : "требует доработки"}.`;
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 4: funnel_model — full-funnel projection with P10/P50/P90 scenarios
// ═════════════════════════════════════════════════════════════════════════════

// Default post-click funnel rates by category (click→lead, lead→qualified,
// qualified→sale). Conservative, illustrative; all overridable via input.
const FUNNEL_RATES: Record<string, { lead: number; qualify: number; close: number }> = {
  realty: { lead: 0.06, qualify: 0.45, close: 0.12 },
  pharma: { lead: 0.08, qualify: 0.6, close: 0.3 },
  fmcg: { lead: 0.05, qualify: 0.7, close: 0.45 },
  retail: { lead: 0.07, qualify: 0.65, close: 0.4 },
  auto: { lead: 0.05, qualify: 0.4, close: 0.1 },
  finance: { lead: 0.06, qualify: 0.5, close: 0.2 },
  ecom: { lead: 0.08, qualify: 0.7, close: 0.5 },
  edtech: { lead: 0.1, qualify: 0.45, close: 0.18 },
};
const DEFAULT_FUNNEL_RATES = { lead: 0.06, qualify: 0.55, close: 0.3 };

/** Blended median (or p25/p75) of a KPI across all platforms for a category. */
async function blendedKpi(category: string, kpi: Kpi, band: "p25" | "p50" | "p75"): Promise<number | null> {
  const bm = await getCategoryBenchmarks(category);
  if (!bm) return null;
  const vals: number[] = [];
  for (const platform of Object.keys(bm)) {
    const r = await getMetric(category, platform, kpi);
    if (r) vals.push(r[band]);
  }
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

const funnelModel: ToolDef = {
  name: "funnel_model",
  description:
    "Model the FULL marketing funnel for a budget, end to end: impressions → reach → clicks → leads → qualified → sales → revenue, with conservative/base/optimistic (P10/P50/P90-style) scenarios derived from the benchmark spread (p75/p50/p25 CPM·CTR). Reports stage counts, drop-off at each step, CAC, ROAS and revenue when an AOV is given. Identifies the biggest leak. Deterministic; illustrative, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      budget: { type: "number", exclusiveMinimum: 0, description: "Total budget, RUB" },
      category: { type: "string", enum: CATEGORIES, description: "Industry category" },
      aov: { type: "number", exclusiveMinimum: 0, description: "Average order value, RUB (enables revenue/ROAS)" },
      leadRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Override click→lead %, else category default" },
      qualifyRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Override lead→qualified %" },
      closeRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Override qualified→sale %" },
    },
    required: ["budget", "category"],
    additionalProperties: false,
  },
  async handler(input) {
    const budget = Number(input.budget);
    const category = String(input.category);
    const aov = input.aov ? Number(input.aov) : null;
    const def = FUNNEL_RATES[category] ?? DEFAULT_FUNNEL_RATES;
    const leadRate = input.leadRatePct ? Number(input.leadRatePct) / 100 : def.lead;
    const qualRate = input.qualifyRatePct ? Number(input.qualifyRatePct) / 100 : def.qualify;
    const closeRate = input.closeRatePct ? Number(input.closeRatePct) / 100 : def.close;

    // Scenario bands: optimistic uses cheap CPM + high CTR (p25 CPM, p75 CTR);
    // conservative the reverse; base = medians.
    type Scenario = "conservative" | "base" | "optimistic";
    const bands: Record<Scenario, { cpm: "p25" | "p50" | "p75"; ctr: "p25" | "p50" | "p75" }> = {
      conservative: { cpm: "p75", ctr: "p25" },
      base: { cpm: "p50", ctr: "p50" },
      optimistic: { cpm: "p25", ctr: "p75" },
    };

    async function build(s: Scenario) {
      const cpm = (await blendedKpi(category, "CPM", bands[s].cpm)) ?? 300;
      const ctrPct = (await blendedKpi(category, "CTR", bands[s].ctr)) ?? 0.8;
      const impressions = Math.round((budget / cpm) * 1000);
      const reach = Math.round(impressions * 0.62); // ~1.6 avg frequency
      const clicks = Math.round(impressions * (ctrPct / 100));
      const leads = Math.round(clicks * leadRate);
      const qualified = Math.round(leads * qualRate);
      const sales = Math.round(qualified * closeRate);
      const revenue = aov ? Math.round(sales * aov) : null;
      const cac = sales > 0 ? round(budget / sales) : null;
      const roas = revenue ? round(revenue / budget, 2) : null;
      return { scenario: s, cpm: round(cpm), ctrPct: round(ctrPct, 2), impressions, reach, clicks, leads, qualified, sales, revenue, cac, roas };
    }

    const [conservative, base, optimistic] = await Promise.all([build("conservative"), build("base"), build("optimistic")]);

    // Biggest leak: stage with the largest relative drop in the base scenario.
    const stages = [
      { from: "clicks", to: "leads", a: base.clicks, b: base.leads },
      { from: "leads", to: "qualified", a: base.leads, b: base.qualified },
      { from: "qualified", to: "sales", a: base.qualified, b: base.sales },
    ];
    let biggestLeak = stages[0];
    let worstKeep = 1;
    for (const st of stages) {
      const keep = st.a > 0 ? st.b / st.a : 1;
      if (keep < worstKeep) {
        worstKeep = keep;
        biggestLeak = st;
      }
    }

    const payload = {
      tool: "funnel_model",
      input: { budget, category, aov },
      assumptions: {
        clickToLeadPct: round(leadRate * 100, 1),
        leadToQualifiedPct: round(qualRate * 100, 1),
        qualifiedToSalePct: round(closeRate * 100, 1),
        avgFrequency: 1.6,
        ratesSource: input.leadRatePct || input.qualifyRatePct || input.closeRatePct ? "user-overridden" : "category default",
      },
      scenarios: { conservative, base, optimistic },
      biggestLeak: {
        stage: `${biggestLeak.from} → ${biggestLeak.to}`,
        keepRatePct: round(worstKeep * 100, 1),
        note: "Наибольшая относительная потеря — приоритет для оптимизации (оффер/лендинг/скрипты продаж).",
      },
      method:
        "impressions = budget/CPM×1000; reach ≈ impressions×0.62 (freq≈1.6); clicks = impressions×CTR; " +
        "leads = clicks×leadRate; qualified = leads×qualifyRate; sales = qualified×closeRate; " +
        "CAC = budget/sales; ROAS = sales×AOV/budget. Сценарии — из разброса бенчмарков (p25/p50/p75).",
      provenance: DATA_META.provenance,
      disclaimer: "Иллюстративная модель воронки на синтетических бенчмарках; не гарантия результата.",
    };

    const summary =
      `Воронка (${category}, бюджет ${ru(budget)} ₽): база ${ru(base.sales)} продаж ` +
      `(диапазон ${ru(conservative.sales)}–${ru(optimistic.sales)}), CAC ~${base.cac ?? "n/a"} ₽` +
      (base.roas ? `, ROAS ${base.roas}×` : "") +
      `. Узкое место: ${biggestLeak.from}→${biggestLeak.to} (${round(worstKeep * 100, 1)}%).`;
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 5: seasonality_forecast — when to spend (monthly demand index)
// ═════════════════════════════════════════════════════════════════════════════

const seasonalityForecast: ToolDef = {
  name: "seasonality_forecast",
  description:
    "When to spend. Returns a 12-month demand/competition index for a RU/CIS category (mean ≈ 1.0), the peak and trough months, a recommended budget weighting across months, and a flighting recommendation (lean in before peaks, protect efficiency in troughs). Optionally splits a provided annual budget by month. Deterministic.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category" },
      annualBudget: { type: "number", exclusiveMinimum: 0, description: "Optional annual budget, RUB, to split by month" },
    },
    required: ["category"],
    additionalProperties: false,
  },
  async handler(input) {
    const category = String(input.category);
    const idx = getSeasonalityIndex(category);
    if (!idx) {
      return { content: [{ type: "text", text: `Нет сезонных данных для категории «${category}».` }], isError: true };
    }
    const annualBudget = input.annualBudget ? Number(input.annualBudget) : null;
    const sum = idx.reduce((a, b) => a + b, 0);

    const months = idx.map((v, i) => ({
      month: MONTHS_RU[i],
      index: round(v, 2),
      budgetWeightPct: round((v / sum) * 100, 1),
      budget: annualBudget ? Math.round((v / sum) * annualBudget) : null,
    }));

    const peak = months.reduce((a, b) => (b.index > a.index ? b : a));
    const trough = months.reduce((a, b) => (b.index < a.index ? b : a));

    const payload = {
      tool: "seasonality_forecast",
      input: { category, annualBudget },
      months,
      peak: { month: peak.month, index: peak.index },
      trough: { month: trough.month, index: trough.index },
      recommendation: [
        `Пик спроса: ${peak.month} (индекс ${peak.index}). Заходить в аукцион за 2–4 недели до пика, чтобы обучить кампании.`,
        `Спад: ${trough.month} (индекс ${trough.index}). Снижать охватный бюджет, держать перформанс/ретаргетинг на эффективность.`,
        annualBudget
          ? `Годовой бюджет ${ru(annualBudget)} ₽ распределён по месяцам пропорционально индексу спроса.`
          : "Передайте annualBudget, чтобы получить помесячную разбивку.",
      ],
      method: "budgetWeight(month) = index(month) / Σ index. Индекс — относительный спрос/конкуренция (1.0 = средний).",
      disclaimer: "Сезонные индексы синтетические/иллюстративные для RU/CIS; калибруйте на своих данных.",
    };

    const summary =
      `Сезонность «${category}»: пик — ${peak.month} (${peak.index}), спад — ${trough.month} (${trough.index}). ` +
      (annualBudget ? `Бюджет ${ru(annualBudget)} ₽ разнесён по месяцам.` : "Передайте annualBudget для разбивки.");
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 6: creative_score — score an ad creative on marketing best-practices
// ═════════════════════════════════════════════════════════════════════════════

interface CreativeCheck {
  criterion: string;
  pass: boolean;
  weight: number;
  note: string;
}

const creativeScore: ToolDef = {
  name: "creative_score",
  description:
    "Score an ad creative (headline + body, optional CTA) on performance best-practices: clear value proposition, specificity/numbers, a strong CTA, length discipline, urgency/relevance, and a benefit (not feature) focus. Returns a 0-100 score, per-criterion pass/fail with fixes, and a quick compliance risk flag (delegates depth to compliance_check). With an LLM key it adds two improved variants. Deterministic core.",
  inputSchema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "Ad headline / title" },
      body: { type: "string", description: "Ad body text" },
      cta: { type: "string", description: "Optional call-to-action text" },
      category: { type: "string", enum: CATEGORIES, description: "Optional category" },
      platform: { type: "string", enum: PLATFORMS, description: "Optional platform" },
    },
    required: ["headline", "body"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const headline = String(input.headline ?? "");
    const body = String(input.body ?? "");
    const cta = input.cta ? String(input.cta) : "";
    const full = `${headline} ${body} ${cta}`.trim();

    const hasNumbers = /\d/.test(full);
    const hasCta = cta.length > 0 || /(узнай|закаж|купи|оформи|получи|перейд|регистрир|подключ|скачай|запиш|оставь заявку|звони)/i.test(full);
    const headlineOk = headline.length >= 8 && headline.length <= 60;
    const bodyOk = body.length >= 20 && body.length <= 300;
    const hasBenefit = /(сэконом|выгод|быстр|удобн|бесплатн|гаранти|защит|увеличь|сниз|без|за \d|всего|скидк|подар)/i.test(full);
    const hasUrgencyOrRelevance = /(сегодня|сейчас|до \d|успей|ограничен|новинк|сезон|акци|только)/i.test(full);
    const notAllCaps = !(headline === headline.toUpperCase() && /[А-ЯA-Z]{6,}/.test(headline));

    const checks: CreativeCheck[] = [
      { criterion: "Заголовок 8–60 символов", pass: headlineOk, weight: 18, note: headlineOk ? "ОК" : "Сделайте заголовок короче и конкретнее (8–60 символов)." },
      { criterion: "Тело 20–300 символов", pass: bodyOk, weight: 12, note: bodyOk ? "ОК" : "Оптимальная длина тела — 20–300 символов." },
      { criterion: "Есть конкретика/цифры", pass: hasNumbers, weight: 18, note: hasNumbers ? "ОК" : "Добавьте конкретику: цену, %, срок, количество." },
      { criterion: "Чёткий CTA", pass: hasCta, weight: 20, note: hasCta ? "ОК" : "Добавьте явный призыв к действию (Оформите, Получите…)." },
      { criterion: "Фокус на выгоде клиента", pass: hasBenefit, weight: 16, note: hasBenefit ? "ОК" : "Сместите акцент с характеристик на выгоду для клиента." },
      { criterion: "Уместность/своевременность", pass: hasUrgencyOrRelevance, weight: 8, note: hasUrgencyOrRelevance ? "ОК" : "Добавьте релевантность моменту (сезон/новинка/срок)." },
      { criterion: "Без CAPS-крика в заголовке", pass: notAllCaps, weight: 8, note: notAllCaps ? "ОК" : "Не пишите заголовок капсом — снижает доверие и охваты." },
    ];

    const score = checks.reduce((a, c) => a + (c.pass ? c.weight : 0), 0);
    const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";

    // Quick compliance heuristic flag (deep review = compliance_check).
    const complianceFlag = /(лучш|№\s?1|самый|100\s?%|гаранти|излечива)/i.test(full);

    // Optional LLM variants. Graceful fallback.
    let variants: string[] | null = null;
    const llmEnv = env as LlmEnv | undefined;
    if (llmEnv?.LLM_API_KEY) {
      const raw = await callLLM(
        {
          system:
            "Ты — перформанс-копирайтер РФ. Верни СТРОГО JSON {\"variants\":[\"...\",\"...\"]} без markdown — " +
            "два улучшенных, комплаентных варианта объявления (заголовок + тело + CTA одной строкой) на русском.",
          prompt: `Категория: ${input.category ?? "—"}. Площадка: ${input.platform ?? "—"}.\nЗаголовок: ${headline}\nТело: ${body}\nCTA: ${cta || "—"}`,
        },
        llmEnv
      );
      try {
        const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
        if (Array.isArray(parsed?.variants)) variants = parsed.variants.slice(0, 2).map((v: unknown) => String(v));
      } catch {
        /* keep null on parse failure */
      }
    }

    const payload = {
      tool: "creative_score",
      input: { category: input.category ?? null, platform: input.platform ?? null, headlineChars: headline.length, bodyChars: body.length },
      score,
      grade,
      checks,
      complianceFlag,
      complianceHint: complianceFlag
        ? "Обнаружены потенциально рискованные формулировки — прогоните через compliance_check."
        : "Грубых рисков не видно; для гарантии прогоните через compliance_check.",
      variants,
      disclaimer: "Эвристическая оценка качества креатива; финальное решение — за A/B-тестом (см. ab_test_planner).",
    };

    const summary =
      `Оценка креатива: ${score}/100 (грейд ${grade}). ` +
      `Пройдено ${checks.filter((c) => c.pass).length}/${checks.length} критериев` +
      (complianceFlag ? "; есть комплаенс-флаг." : ".") +
      (variants ? ` Предложено ${variants.length} улучшенных варианта.` : "");
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 7: attribution_model — multi-touch attribution across 5 models
// ═════════════════════════════════════════════════════════════════════════════

type AttrModel = "firstTouch" | "lastTouch" | "linear" | "positionBased" | "timeDecay";

/** Credit weights for ONE path (length n), per model, summing to 1.0. */
function pathWeights(n: number, model: AttrModel): number[] {
  if (n <= 0) return [];
  if (n === 1) return [1];
  switch (model) {
    case "firstTouch": {
      const w = new Array(n).fill(0);
      w[0] = 1;
      return w;
    }
    case "lastTouch": {
      const w = new Array(n).fill(0);
      w[n - 1] = 1;
      return w;
    }
    case "linear":
      return new Array(n).fill(1 / n);
    case "positionBased": {
      // U-shaped: 40% first, 40% last, 20% spread across the middle.
      if (n === 2) return [0.5, 0.5];
      const w = new Array(n).fill(0);
      w[0] = 0.4;
      w[n - 1] = 0.4;
      const mid = 0.2 / (n - 2);
      for (let i = 1; i < n - 1; i++) w[i] = mid;
      return w;
    }
    case "timeDecay": {
      // Heavier toward the last touch (weight_i = 2^i), normalized.
      const raw = Array.from({ length: n }, (_, i) => 2 ** i);
      const sum = raw.reduce((a, b) => a + b, 0);
      return raw.map((v) => v / sum);
    }
  }
}

const attributionModel: ToolDef = {
  name: "attribution_model",
  description:
    "Multi-touch attribution simulator. Given conversion PATHS (ordered channel sequences with their conversion counts), it credits conversions to channels under five models — first-touch, last-touch, linear, position-based (U-shaped 40/20/40) and time-decay — and highlights which channels are UNDER- or OVER-valued by naive last-touch vs. multi-touch (the key budget-reallocation insight). Deterministic.",
  inputSchema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        minItems: 1,
        description: "Conversion paths. Each: an ordered list of channel touchpoints + the number of conversions on that path.",
        items: {
          type: "object",
          properties: {
            channels: { type: "array", minItems: 1, items: { type: "string" }, description: "Ordered channels (first → last touch)" },
            conversions: { type: "number", exclusiveMinimum: 0, description: "Conversions attributed to this path" },
          },
          required: ["channels", "conversions"],
          additionalProperties: false,
        },
      },
    },
    required: ["paths"],
    additionalProperties: false,
  },
  async handler(input) {
    const paths = (input.paths ?? []) as Array<{ channels: string[]; conversions: number }>;
    const models: AttrModel[] = ["firstTouch", "lastTouch", "linear", "positionBased", "timeDecay"];
    const credit: Record<AttrModel, Record<string, number>> = {
      firstTouch: {}, lastTouch: {}, linear: {}, positionBased: {}, timeDecay: {},
    };
    let totalConversions = 0;

    for (const p of paths) {
      const channels = (p.channels ?? []).map(String);
      const conv = Number(p.conversions) || 0;
      if (channels.length === 0 || conv <= 0) continue;
      totalConversions += conv;
      for (const model of models) {
        const w = pathWeights(channels.length, model);
        channels.forEach((ch, i) => {
          credit[model][ch] = (credit[model][ch] ?? 0) + w[i] * conv;
        });
      }
    }

    const allChannels = Array.from(new Set(paths.flatMap((p) => (p.channels ?? []).map(String))));

    const byChannel = allChannels.map((ch) => {
      const row: Record<string, number> = {};
      for (const model of models) row[model] = round(credit[model][ch] ?? 0, 1);
      const lt = row.lastTouch;
      const multi = (row.linear + row.positionBased + row.timeDecay) / 3;
      const deltaPct = lt > 0 ? round(((multi - lt) / lt) * 100, 1) : multi > 0 ? 100 : 0;
      return {
        channel: ch,
        credited: row,
        lastTouchVsMultiTouchDeltaPct: deltaPct,
        verdict:
          deltaPct > 15 ? "undervalued by last-touch — заслуживает больше бюджета"
          : deltaPct < -15 ? "overvalued by last-touch — вероятно, переинвестирован"
          : "оценён сбалансированно",
      };
    });

    // Sort: most undervalued first (biggest reallocation opportunity).
    byChannel.sort((a, b) => b.lastTouchVsMultiTouchDeltaPct - a.lastTouchVsMultiTouchDeltaPct);

    const payload = {
      tool: "attribution_model",
      input: { paths: paths.length, totalConversions: round(totalConversions, 1) },
      models: ["firstTouch", "lastTouch", "linear", "positionBased", "timeDecay"],
      byChannel,
      insight:
        byChannel.length > 0
          ? `Канал «${byChannel[0].channel}» наиболее недооценён last-touch-моделью (${byChannel[0].lastTouchVsMultiTouchDeltaPct > 0 ? "+" : ""}${byChannel[0].lastTouchVsMultiTouchDeltaPct}% vs мульти-тач) — кандидат на рост бюджета.`
          : "Недостаточно данных для вывода.",
      method:
        "first/last — 100% первому/последнему касанию; linear — поровну по касаниям; " +
        "position-based — 40/20/40 (U); time-decay — вес 2^i к последнему касанию. " +
        "delta% = (среднее по linear/position/time-decay − last-touch) / last-touch.",
      disclaimer: "Симуляция атрибуции на переданных путях; для production нужны реальные мульти-тач данные (CDP/трекинг).",
    };

    const summary =
      `Атрибуция по ${paths.length} путям (${round(totalConversions, 0)} конверсий), ` +
      `5 моделей, ${allChannels.length} каналов. ` +
      (byChannel.length ? `Самый недооценённый last-touch: ${byChannel[0].channel}.` : "");
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 8: bid_simulator — auction bid/win-rate trade-off curve
// ═════════════════════════════════════════════════════════════════════════════

const bidSimulator: ToolDef = {
  name: "bid_simulator",
  description:
    "Simulate an auction bidding strategy. Using the category's benchmark CPC (derived from CPM/CTR) and conversion rate (from CPC/CPA), it sweeps bid levels and returns a trade-off curve — win-rate, clicks, conversions, spend and resulting CPA at each bid — capped by a daily budget. Recommends the bid that hits a target CPA (if given) or maximizes conversions. Synthetic logistic auction model, clearly labelled.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category (sets the reference CPC/CPA)" },
      dailyBudget: { type: "number", exclusiveMinimum: 0, description: "Daily budget cap, RUB" },
      targetCpa: { type: "number", exclusiveMinimum: 0, description: "Optional target CPA, RUB — the recommended bid will aim for it" },
    },
    required: ["category", "dailyBudget"],
    additionalProperties: false,
  },
  async handler(input) {
    const category = String(input.category);
    const dailyBudget = Number(input.dailyBudget);
    const targetCpa = input.targetCpa ? Number(input.targetCpa) : null;

    const cpmMed = (await blendedKpi(category, "CPM", "p50")) ?? 300;
    const ctrMed = (await blendedKpi(category, "CTR", "p50")) ?? 0.8; // percent
    const cpaMed = (await blendedKpi(category, "CPA", "p50")) ?? 1500;
    // CPC = CPM / (1000 * CTR_fraction); convRate = CPC / CPA.
    const refCpc = cpmMed / (1000 * (ctrMed / 100));
    const convRate = cpaMed > 0 ? refCpc / cpaMed : 0.02;

    // Available daily click pool (synthetic headroom) at full win-rate.
    const poolClicks = (dailyBudget / refCpc) * 1.8;

    const multiples = [0.6, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5];
    const curve = multiples.map((m) => {
      const bid = refCpc * m;
      const effectiveCpc = bid * 0.9; // ~second-price
      // Logistic win-rate centered at the market reference bid.
      const winRate = clamp(1 / (1 + Math.exp(-4 * (m - 1))), 0.03, 0.97);
      const availableClicks = poolClicks * winRate;
      const budgetClicks = dailyBudget / effectiveCpc;
      const clicks = Math.floor(Math.min(availableClicks, budgetClicks));
      const conversions = Math.round(clicks * convRate);
      const spend = round(clicks * effectiveCpc);
      const cpa = conversions > 0 ? round(spend / conversions) : null;
      return {
        bidMultipleOfMarket: m,
        bid: round(bid),
        effectiveCpc: round(effectiveCpc),
        winRatePct: round(winRate * 100, 1),
        clicks,
        conversions,
        spend,
        cpa,
      };
    });

    // Recommendation.
    let recommended;
    let rationale;
    if (targetCpa) {
      // Highest-volume bid whose CPA still ≤ target.
      const feasible = curve.filter((c) => c.cpa !== null && c.cpa <= targetCpa);
      if (feasible.length) {
        recommended = feasible.reduce((a, b) => (b.conversions > a.conversions ? b : a));
        rationale = `Максимум конверсий при CPA ≤ целевого ${ru(targetCpa)} ₽.`;
      } else {
        recommended = curve.reduce((a, b) => ((b.cpa ?? Infinity) < (a.cpa ?? Infinity) ? b : a));
        rationale = `Целевой CPA ${ru(targetCpa)} ₽ недостижим в этой модели — выбран бид с минимальным CPA.`;
      }
    } else {
      recommended = curve.reduce((a, b) => (b.conversions > a.conversions ? b : a));
      rationale = "Максимум конверсий в рамках дневного бюджета.";
    }

    const payload = {
      tool: "bid_simulator",
      input: { category, dailyBudget, targetCpa },
      reference: { cpc: round(refCpc), cpaMedian: round(cpaMed), convRatePct: round(convRate * 100, 2) },
      curve,
      recommended: { ...recommended, rationale },
      method:
        "CPC = CPM/(1000·CTR); convRate = CPC/CPA; win-rate = логистическая от бида относительно рынка; " +
        "clicks = min(pool·win-rate, budget/effCPC); effCPC ≈ 0.9·bid (second-price).",
      provenance: DATA_META.provenance,
      disclaimer: "Синтетическая модель аукциона для планирования бид-стратегии; не отражает реальную динамику площадки.",
    };

    const summary =
      `Бид-симуляция (${category}, бюджет ${ru(dailyBudget)} ₽/день): рекоменд. бид ${ru(recommended.bid)} ₽ ` +
      `(win ${recommended.winRatePct}%, ~${ru(recommended.conversions)} конв./день, CPA ${recommended.cpa ?? "n/a"} ₽). ${rationale}`;
    return toContent(summary, payload);
  },
};

// ── Export the group ──────────────────────────────────────────────────────────

export const ANALYTICS_TOOLS: ToolDef[] = [
  complianceCheck,
  abTestPlanner,
  unitEconomics,
  funnelModel,
  seasonalityForecast,
  creativeScore,
  attributionModel,
  bidSimulator,
];
