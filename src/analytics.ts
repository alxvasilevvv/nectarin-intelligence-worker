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

import { CATEGORIES, PLATFORMS } from "./data.js";
import { callLLM, type LlmEnv } from "./orchestrator.js";
import type { ToolDef, ToolResult } from "./tools.js";

// ── local helpers (self-contained, mirrors growth.ts) ────────────────────────

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

// ── Export the group ──────────────────────────────────────────────────────────

export const ANALYTICS_TOOLS: ToolDef[] = [complianceCheck, abTestPlanner, unitEconomics];
