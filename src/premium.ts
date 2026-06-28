/**
 * PREMIUM tool group (v2.1) for NECTARIN Intelligence — Cloudflare Workers.
 *
 * Three senior-operator capabilities that round out the suite:
 *   • creative_variants — generate & score N on-brand ad variants (LLM-backed,
 *     KV-cached; deterministic template fallback without a key).
 *   • anomaly_detector  — robust (median/MAD) anomaly detection over a metric
 *     time series for always-on monitoring. Fully deterministic.
 *   • cohort_ltv        — retention-curve cohort LTV/NPV projection. Deterministic.
 *
 * Nothing here transmits PII or makes a real CRM/network call. Outputs are
 * decision-support, not legal/financial advice. All figures are illustrative.
 */

import { CATEGORIES, PLATFORMS } from "./data.js";
import { callLLM, type LlmEnv } from "./orchestrator.js";
import type { ToolDef, ToolResult } from "./tools.js";

// ── local helpers (self-contained, mirrors analytics.ts) ─────────────────────

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

/** Compact creative scorer (shared shape with analytics.creative_score). */
function scoreCreative(headline: string, body: string, cta: string): {
  score: number;
  grade: "A" | "B" | "C" | "D";
  complianceFlag: boolean;
} {
  const full = `${headline} ${body} ${cta}`.trim();
  const hasNumbers = /\d/.test(full);
  const hasCta = cta.length > 0 || /(узнай|закаж|купи|оформи|получи|перейд|регистрир|подключ|скачай|запиш|оставь заявку|звони)/i.test(full);
  const headlineOk = headline.length >= 8 && headline.length <= 60;
  const bodyOk = body.length >= 20 && body.length <= 300;
  const hasBenefit = /(сэконом|выгод|быстр|удобн|бесплатн|гаранти|защит|увеличь|сниз|без|за \d|всего|скидк|подар)/i.test(full);
  const hasUrgency = /(сегодня|сейчас|до \d|успей|ограничен|новинк|сезон|акци|только)/i.test(full);
  const notAllCaps = !(headline === headline.toUpperCase() && /[А-ЯA-Z]{6,}/.test(headline));
  const weights: Array<[boolean, number]> = [
    [headlineOk, 18], [bodyOk, 12], [hasNumbers, 18], [hasCta, 20],
    [hasBenefit, 16], [hasUrgency, 8], [notAllCaps, 8],
  ];
  const score = weights.reduce((a, [ok, w]) => a + (ok ? w : 0), 0);
  const grade = score >= 85 ? "A" : score >= 70 ? "B" : score >= 50 ? "C" : "D";
  const complianceFlag = /(лучш|№\s?1|самый|100\s?%|гаранти|излечива)/i.test(full);
  return { score, grade, complianceFlag };
}

// ═════════════════════════════════════════════════════════════════════════════
// Tool 1: creative_variants — generate + score N ad variants
// ═════════════════════════════════════════════════════════════════════════════

const TONE_RU: Record<string, string> = {
  bold: "дерзкий, энергичный",
  expert: "экспертный, доказательный",
  friendly: "дружелюбный, тёплый",
  premium: "премиальный, статусный",
};

interface Variant {
  headline: string;
  body: string;
  cta: string;
  score: number;
  grade: string;
  complianceFlag: boolean;
}

/** Deterministic template fallback (no LLM key) — varied, plausibly-good copy. */
function templateVariants(product: string, audience: string, channel: string, count: number, tone: string): Variant[] {
  const angles = [
    { h: `${product}: выгода уже сегодня`, b: `Решение для аудитории «${audience}». Экономьте время и до 30% бюджета. Понятный результат с первой недели.`, c: "Оформите заявку" },
    { h: `${product} без переплат`, b: `Для «${audience}»: прозрачные условия, запуск за 1 день, поддержка 24/7. Только то, что действительно работает.`, c: "Получить расчёт" },
    { h: `${product} — попробуйте на ${channel}`, b: `Подобрали под «${audience}»: 3 готовых сценария и измеримый эффект. Старт без долгих согласований.`, c: "Узнать подробнее" },
    { h: `Рост для «${audience}»`, b: `${product}: +22% к конверсии в среднем по нише. Настроим под ваши цели и бюджет за один созвон.`, c: "Запишитесь на разбор" },
    { h: `${product}: меньше затрат, больше заявок`, b: `Аудитория «${audience}» уже выбирает нас. Снизьте CPA и масштабируйте то, что окупается.`, c: "Перейти и оформить" },
  ];
  void tone;
  return angles.slice(0, count).map((a) => ({
    headline: a.h,
    body: a.b,
    cta: a.c,
    ...scoreCreative(a.h, a.b, a.c),
  }));
}

const creativeVariants: ToolDef = {
  name: "creative_variants",
  description:
    "Generate AND score multiple ready-to-test ad variants for a product × audience × channel. With an LLM key it writes N on-brand, RU-compliant variants (KV-cached); without a key it returns strong deterministic template variants. Every variant is scored by the same heuristic as creative_score (0-100 + grade) and gets a quick compliance flag, then ranked best-first. Pairs with ab_test_planner to test the winners.",
  inputSchema: {
    type: "object",
    properties: {
      product: { type: "string", description: "Product / offer to advertise" },
      audience: { type: "string", description: "Target audience description" },
      channel: { type: "string", description: "Channel / platform (e.g. VK Ads, Telegram Ads)" },
      category: { type: "string", enum: CATEGORIES, description: "Optional category for context" },
      count: { type: "integer", minimum: 1, maximum: 5, description: "How many variants (1-5, default 3)" },
      tone: { type: "string", enum: ["bold", "expert", "friendly", "premium"], description: "Optional tone of voice" },
    },
    required: ["product", "audience", "channel"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const product = String(input.product ?? "");
    const audience = String(input.audience ?? "");
    const channel = String(input.channel ?? "");
    const count = clamp(Math.round(Number(input.count ?? 3)), 1, 5);
    const tone = typeof input.tone === "string" ? input.tone : "expert";

    let variants: Variant[] | null = null;
    let usedLlm = false;
    const llmEnv = env as LlmEnv | undefined;

    if (llmEnv?.LLM_API_KEY) {
      const raw = await callLLM(
        {
          system:
            `Ты — перформанс-копирайтер РФ (тон: ${TONE_RU[tone] ?? "экспертный"}). ` +
            `Верни СТРОГО JSON {"variants":[{"headline":"...","body":"...","cta":"..."}]} без markdown — ` +
            `${count} разных, комплаентных (ФЗ-38, без «лучший/№1/100%/гарантия») варианта объявления на русском. ` +
            `headline 8–60 символов, body 20–300, явный CTA.`,
          prompt: `Продукт: ${product}\nАудитория: ${audience}\nКанал: ${channel}\nКатегория: ${input.category ?? "—"}`,
        },
        llmEnv
      );
      try {
        const parsed = JSON.parse(raw.replace(/^```json\s*|\s*```$/g, "").trim());
        if (Array.isArray(parsed?.variants)) {
          variants = parsed.variants.slice(0, count).map((v: any) => {
            const headline = String(v?.headline ?? "");
            const body = String(v?.body ?? "");
            const cta = String(v?.cta ?? "");
            return { headline, body, cta, ...scoreCreative(headline, body, cta) };
          });
          usedLlm = (variants?.length ?? 0) > 0;
        }
      } catch {
        /* fall through to template */
      }
    }

    if (!variants || variants.length === 0) {
      variants = templateVariants(product, audience, channel, count, tone);
      usedLlm = false;
    }

    const ranked: Variant[] = [...variants].sort((a, b) => b.score - a.score);
    const best = ranked[0];
    variants = ranked;

    const payload = {
      tool: "creative_variants",
      input: { product, audience, channel, category: input.category ?? null, count, tone },
      usedLlm,
      variants,
      best: best ? { headline: best.headline, score: best.score, grade: best.grade } : null,
      nextStep: "Протестируйте 2 лучших варианта через ab_test_planner; рискованные — через compliance_check.",
      disclaimer: usedLlm
        ? "Варианты сгенерированы моделью и оценены эвристикой; финал — за A/B-тестом."
        : "LLM-ключ не задан — возвращены шаблонные варианты. Оценка эвристическая.",
    };
    const summary =
      `Сгенерировано ${variants.length} вариантов для «${product}» (${channel})` +
      (usedLlm ? " через LLM" : " (шаблоны)") +
      `. Лучший: ${best?.score ?? 0}/100 (грейд ${best?.grade ?? "—"}).`;
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 2: anomaly_detector — robust (median/MAD) anomaly detection
// ═════════════════════════════════════════════════════════════════════════════

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

const anomalyDetector: ToolDef = {
  name: "anomaly_detector",
  description:
    "Flag anomalies in a metric time series (e.g. daily CPA, CTR, spend, conversions) for always-on monitoring. Uses a robust median/MAD z-score (resistant to outliers), with a std-based fallback for low-variance series. Reports each anomaly's index, value, z-score, direction and severity, whether the LATEST point is anomalous, and the baseline. Deterministic.",
  inputSchema: {
    type: "object",
    properties: {
      series: {
        type: "array",
        items: { type: "number" },
        minItems: 4,
        description: "Ordered metric values (oldest → newest), at least 4 points",
      },
      metric: { type: "string", description: "Optional metric label (e.g. 'CPA')" },
      direction: { type: "string", enum: ["both", "up", "down"], description: "Which spikes to flag (default both)" },
      sensitivity: { type: "number", minimum: 1.5, maximum: 5, description: "z-score threshold (default 3.0; lower = more sensitive)" },
    },
    required: ["series"],
    additionalProperties: false,
  },
  async handler(input) {
    const series: number[] = (Array.isArray(input.series) ? input.series : []).map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n));
    if (series.length < 4) throw new Error("series must contain at least 4 finite numbers.");
    const metric = input.metric ? String(input.metric) : "значение";
    const direction = ["both", "up", "down"].includes(input.direction) ? input.direction : "both";
    const threshold = clamp(Number(input.sensitivity ?? 3), 1.5, 5);

    const med = median(series);
    const mad = median(series.map((x) => Math.abs(x - med)));
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const std = Math.sqrt(series.reduce((a, b) => a + (b - mean) ** 2, 0) / series.length);

    // Robust z (median/MAD, scaled by 1.4826). Fallback to std-based z if MAD=0.
    const useMad = mad > 0;
    const scale = useMad ? mad * 1.4826 : std;
    const z = (x: number): number => (scale > 0 ? (x - (useMad ? med : mean)) / scale : 0);

    const anomalies = series
      .map((value, index) => {
        const zi = round(z(value), 2);
        const dir = zi > 0 ? "up" : zi < 0 ? "down" : "flat";
        return { index, value, z: zi, direction: dir, severity: severityFor(Math.abs(zi)) };
      })
      .filter((a) => Math.abs(a.z) >= threshold)
      .filter((a) => direction === "both" || a.direction === direction);

    const last = series[series.length - 1];
    const lastZ = round(z(last), 2);
    const latestAnomaly =
      Math.abs(lastZ) >= threshold && (direction === "both" || (lastZ > 0 ? "up" : "down") === direction);

    const payload = {
      tool: "anomaly_detector",
      input: { metric, points: series.length, direction, threshold },
      baseline: { median: round(med, 4), mad: round(mad, 4), mean: round(mean, 4), std: round(std, 4), method: useMad ? "median/MAD" : "mean/std" },
      anomalies,
      latest: { value: last, z: lastZ, anomaly: latestAnomaly },
      disclaimer: "Статистический детектор; подтверждайте бизнес-контекстом (промо, сезонность — см. seasonality_forecast).",
    };
    const summary =
      `Аномалии «${metric}» (${series.length} точек, порог z=${threshold}): найдено ${anomalies.length}` +
      (latestAnomaly ? `; ПОСЛЕДНЯЯ точка аномальна (z=${lastZ}).` : "; последняя точка в норме.");
    return toContent(summary, payload);
  },
};

function severityFor(absZ: number): "medium" | "high" | "critical" {
  if (absZ >= 5) return "critical";
  if (absZ >= 4) return "high";
  return "medium";
}

// ═════════════════════════════════════════════════════════════════════════════
// Tool 3: cohort_ltv — retention-curve cohort LTV / NPV projection
// ═════════════════════════════════════════════════════════════════════════════

const cohortLtv: ToolDef = {
  name: "cohort_ltv",
  description:
    "Project a cohort's lifetime value from a retention curve. Provide either an explicit retentionCurve (fraction surviving each period, period 0 = 1.0) OR a monthlyChurnPct + periods to synthesize one. Returns per-period survivors/revenue, cumulative LTV per customer and for the whole cohort, optional NPV discounting, and payback period if CAC is given. Complements unit_economics. Deterministic; figures illustrative.",
  inputSchema: {
    type: "object",
    properties: {
      cohortSize: { type: "integer", exclusiveMinimum: 0, description: "Customers in the cohort" },
      arpu: { type: "number", exclusiveMinimum: 0, description: "Average revenue per user PER PERIOD (₽)" },
      retentionCurve: {
        type: "array",
        items: { type: "number", minimum: 0, maximum: 1 },
        description: "Retention fraction per period (period 0 should be 1.0). Use this OR monthlyChurnPct+periods.",
      },
      monthlyChurnPct: { type: "number", minimum: 0, maximum: 100, description: "Constant churn %/period to synthesize a curve" },
      periods: { type: "integer", minimum: 1, maximum: 120, description: "Number of periods when using monthlyChurnPct (default 12)" },
      grossMarginPct: { type: "number", minimum: 0, maximum: 100, description: "Gross margin % applied to revenue (default 100)" },
      discountRatePct: { type: "number", minimum: 0, maximum: 100, description: "Annual discount rate for NPV (default 0 = no discount)" },
      cac: { type: "number", minimum: 0, description: "Optional CAC (₽) to compute payback period" },
    },
    required: ["cohortSize", "arpu"],
    additionalProperties: false,
  },
  async handler(input) {
    const cohortSize = Number(input.cohortSize);
    const arpu = Number(input.arpu);
    const margin = clamp(Number(input.grossMarginPct ?? 100), 0, 100) / 100;
    const annualDiscount = clamp(Number(input.discountRatePct ?? 0), 0, 100) / 100;
    const cac = input.cac != null ? Number(input.cac) : null;

    // Build retention curve.
    let curve: number[];
    if (Array.isArray(input.retentionCurve) && input.retentionCurve.length > 0) {
      curve = input.retentionCurve.map((r: any) => clamp(Number(r), 0, 1));
      if (curve[0] !== 1) curve = [1, ...curve]; // ensure period 0 = full cohort
    } else if (input.monthlyChurnPct != null) {
      const churn = clamp(Number(input.monthlyChurnPct), 0, 100) / 100;
      const periods = clamp(Math.round(Number(input.periods ?? 12)), 1, 120);
      curve = Array.from({ length: periods + 1 }, (_, t) => (1 - churn) ** t);
    } else {
      throw new Error("Provide retentionCurve OR monthlyChurnPct (+ optional periods).");
    }

    // Monthly discount factor from annual rate.
    const monthlyDiscount = annualDiscount > 0 ? (1 + annualDiscount) ** (1 / 12) - 1 : 0;

    const rows = curve.map((retention, period) => {
      const survivors = cohortSize * retention;
      const revenue = survivors * arpu * margin;
      const npvFactor = monthlyDiscount > 0 ? 1 / (1 + monthlyDiscount) ** period : 1;
      const npvRevenue = revenue * npvFactor;
      return { period, retention: round(retention, 4), survivors: round(survivors, 1), revenue: round(revenue, 2), npvRevenue: round(npvRevenue, 2) };
    });

    let cum = 0;
    let cumNpv = 0;
    const table = rows.map((r) => {
      cum += r.revenue;
      cumNpv += r.npvRevenue;
      return { ...r, cumRevenue: round(cum, 2), cumNpvRevenue: round(cumNpv, 2) };
    });

    const totalLtv = round(cum, 2);
    const totalNpvLtv = round(cumNpv, 2);
    const ltvPerCustomer = round(totalLtv / cohortSize, 2);
    const npvLtvPerCustomer = round(totalNpvLtv / cohortSize, 2);

    // Payback period (first period where per-customer cumulative revenue ≥ CAC).
    let paybackPeriod: number | null = null;
    if (cac != null && cac > 0) {
      for (const r of table) {
        if (r.cumRevenue / cohortSize >= cac) {
          paybackPeriod = r.period;
          break;
        }
      }
    }
    const ltvCacRatio = cac != null && cac > 0 ? round(ltvPerCustomer / cac, 2) : null;

    const payload = {
      tool: "cohort_ltv",
      input: {
        cohortSize,
        arpu,
        grossMarginPct: round(margin * 100, 2),
        discountRatePct: round(annualDiscount * 100, 2),
        periods: curve.length - 1,
        retentionSource: Array.isArray(input.retentionCurve) && input.retentionCurve.length ? "curve" : "synthesized",
        cac,
      },
      ltvPerCustomer,
      npvLtvPerCustomer,
      totalLtv,
      totalNpvLtv,
      ltvCacRatio,
      paybackPeriod,
      table,
      verdict:
        ltvCacRatio == null
          ? "Передайте cac для оценки LTV:CAC и срока окупаемости."
          : ltvCacRatio >= 3
          ? "Здоровая экономика: LTV:CAC ≥ 3 — можно масштабировать."
          : ltvCacRatio >= 1
          ? "Окупается, но запас тонкий: поднимайте retention/ARPU или снижайте CAC."
          : "Юнит-экономика отрицательная: LTV < CAC — не масштабируйте, чините воронку.",
      disclaimer: "Иллюстративная модель; не финансовая консультация. Сверьте с unit_economics.",
    };
    const summary =
      `Когорта ${ru(cohortSize)} клиентов: LTV/клиент ${ru(ltvPerCustomer)} ₽` +
      (annualDiscount > 0 ? ` (NPV ${ru(npvLtvPerCustomer)} ₽)` : "") +
      `, всего ${ru(totalLtv)} ₽ за ${curve.length - 1} периодов` +
      (ltvCacRatio != null ? `; LTV:CAC ${ltvCacRatio}, окупаемость ${paybackPeriod ?? "не достигнута"}${paybackPeriod != null ? " период(ов)" : ""}.` : ".");
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 4: utm_builder — consistent, validated UTM tracking links
// ═════════════════════════════════════════════════════════════════════════════

/** Normalize a UTM token per a casing convention; flag issues. */
function normalizeToken(raw: string, mode: string): { value: string; warnings: string[] } {
  const warnings: string[] = [];
  let v = raw.trim();
  if (v !== raw) warnings.push("обрезаны пробелы по краям");
  if (/[A-ZА-Я]/.test(v) && mode !== "preserve") warnings.push("приведено к нижнему регистру для консистентности");
  if (/[^\x00-\x7F]/.test(v)) warnings.push("есть не-ASCII символы (кириллица) — лучше латиница для UTM");
  if (mode !== "preserve") v = v.toLowerCase();
  // spaces → separator
  if (mode === "snake") v = v.replace(/\s+/g, "_");
  else if (mode === "kebab") v = v.replace(/\s+/g, "-");
  else v = v.replace(/\s+/g, "_"); // lower default → snake spaces
  return { value: v, warnings };
}

const utmBuilder: ToolDef = {
  name: "utm_builder",
  description:
    "Build a consistent, validated UTM tracking URL. Normalizes source/medium/campaign/term/content to a chosen casing convention (lower/snake/kebab/preserve), URL-encodes safely, preserves any existing query params, and warns about common mistakes (uppercase, spaces, non-ASCII/Cyrillic, missing required fields). Also returns a campaign naming-convention suggestion. Deterministic; no network call.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Destination URL (http/https)" },
      source: { type: "string", description: "utm_source (e.g. vk, yandex, telegram)" },
      medium: { type: "string", description: "utm_medium (e.g. cpc, banner, social, email)" },
      campaign: { type: "string", description: "utm_campaign (e.g. spring_sale_2026)" },
      term: { type: "string", description: "Optional utm_term (keyword)" },
      content: { type: "string", description: "Optional utm_content (creative/variant id)" },
      casing: { type: "string", enum: ["lower", "snake", "kebab", "preserve"], description: "Token casing convention (default lower)" },
    },
    required: ["url", "source", "medium", "campaign"],
    additionalProperties: false,
  },
  async handler(input) {
    const casing = ["lower", "snake", "kebab", "preserve"].includes(input.casing) ? input.casing : "lower";
    const rawUrl = String(input.url ?? "").trim();
    if (!/^https?:\/\//i.test(rawUrl)) throw new Error("url must start with http:// or https://");

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error("url is not a valid URL.");
    }

    const warnings: string[] = [];
    const fields: Array<[string, string | undefined]> = [
      ["utm_source", input.source],
      ["utm_medium", input.medium],
      ["utm_campaign", input.campaign],
      ["utm_term", input.term],
      ["utm_content", input.content],
    ];
    const params: Record<string, string> = {};
    for (const [key, val] of fields) {
      if (val == null || String(val).trim() === "") continue;
      const { value, warnings: w } = normalizeToken(String(val), casing);
      params[key] = value;
      for (const msg of w) warnings.push(`${key}: ${msg}`);
      parsed.searchParams.set(key, value);
    }

    const finalUrl = parsed.toString();
    const namingSuggestion = `${params.utm_source ?? "<source>"}_${params.utm_medium ?? "<medium>"}_${params.utm_campaign ?? "<campaign>"}`;

    const payload = {
      tool: "utm_builder",
      input: { url: rawUrl, casing },
      params,
      url: finalUrl,
      namingSuggestion,
      warnings,
      tips: [
        "Держите единый словарь source/medium (vk/cpc, telegram/social…) во всех кампаниях.",
        "utm_content — для A/B вариантов креатива (свяжите с creative_variants).",
        "Только латиница, нижний регистр, разделитель «_» — так данные не двоятся в аналитике.",
      ],
      disclaimer: "Ссылка собрана локально; реальный трекинг зависит от вашей системы аналитики.",
    };
    const summary =
      `UTM-ссылка собрана: ${Object.keys(params).length} параметров` +
      (warnings.length ? `, предупреждений ${warnings.length}.` : ", без предупреждений.");
    return toContent(summary, payload);
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// Tool 5: pacing_monitor — budget pacing vs. an even spend curve
// ═════════════════════════════════════════════════════════════════════════════

const pacingMonitor: ToolDef = {
  name: "pacing_monitor",
  description:
    "Monitor budget pacing against an even spend curve. Given total budget, total/elapsed days and spend-to-date, it computes expected spend, pace ratio, status (under/on-track/over), projected end-of-period spend, remaining budget/days and the recommended daily spend to land exactly on budget. Deterministic; figures illustrative.",
  inputSchema: {
    type: "object",
    properties: {
      totalBudget: { type: "number", exclusiveMinimum: 0, description: "Total budget for the period (₽)" },
      daysTotal: { type: "integer", exclusiveMinimum: 0, description: "Total days in the flight" },
      daysElapsed: { type: "integer", minimum: 0, description: "Days elapsed so far" },
      spendToDate: { type: "number", minimum: 0, description: "Actual spend so far (₽)" },
      onTrackBandPct: { type: "number", minimum: 1, maximum: 50, description: "± band considered on-track (default 10%)" },
    },
    required: ["totalBudget", "daysTotal", "daysElapsed", "spendToDate"],
    additionalProperties: false,
  },
  async handler(input) {
    const totalBudget = Number(input.totalBudget);
    const daysTotal = Math.round(Number(input.daysTotal));
    const daysElapsed = clamp(Math.round(Number(input.daysElapsed)), 0, daysTotal);
    const spendToDate = Math.max(0, Number(input.spendToDate));
    const band = clamp(Number(input.onTrackBandPct ?? 10), 1, 50) / 100;

    const expectedSpend = totalBudget * (daysElapsed / daysTotal);
    const pace = expectedSpend > 0 ? spendToDate / expectedSpend : daysElapsed === 0 ? 0 : Infinity;
    const status =
      daysElapsed === 0 ? "not-started" : pace > 1 + band ? "over" : pace < 1 - band ? "under" : "on-track";

    const remainingBudget = round(totalBudget - spendToDate, 2);
    const remainingDays = daysTotal - daysElapsed;
    const projectedEndSpend = daysElapsed > 0 ? round((spendToDate / daysElapsed) * daysTotal, 2) : 0;
    const recommendedDailySpend = remainingDays > 0 ? round(Math.max(0, remainingBudget) / remainingDays, 2) : 0;
    const currentDailyAvg = daysElapsed > 0 ? round(spendToDate / daysElapsed, 2) : 0;

    const action =
      status === "over"
        ? `Перерасход: при текущем темпе закончите бюджет раньше (≈${ru(projectedEndSpend)} ₽ прогноз). Снизьте дневной до ~${ru(recommendedDailySpend)} ₽.`
        : status === "under"
        ? `Недорасход: останется ~${ru(round(totalBudget - projectedEndSpend, 2))} ₽. Поднимите дневной до ~${ru(recommendedDailySpend)} ₽ или перелейте в эффективные каналы (budget_optimizer).`
        : status === "on-track"
        ? `В графике. Держите дневной ~${ru(recommendedDailySpend)} ₽ до конца флайта.`
        : "Флайт ещё не начался — план дневного расхода ниже.";

    const payload = {
      tool: "pacing_monitor",
      input: { totalBudget, daysTotal, daysElapsed, spendToDate, onTrackBandPct: round(band * 100, 1) },
      expectedSpend: round(expectedSpend, 2),
      pace: Number.isFinite(pace) ? round(pace, 3) : null,
      status,
      currentDailyAvg,
      recommendedDailySpend,
      projectedEndSpend,
      remainingBudget,
      remainingDays,
      action,
      disclaimer: "Линейная (ровная) модель пейсинга; для сезонных флайтов сверьтесь с seasonality_forecast.",
    };
    const summary =
      `Пейсинг: статус «${status}»` +
      (Number.isFinite(pace) ? ` (темп ${round(pace, 2)}× от ожидаемого)` : "") +
      `. Рекоменд. дневной ~${ru(recommendedDailySpend)} ₽, прогноз к концу ~${ru(projectedEndSpend)} ₽.`;
    return toContent(summary, payload);
  },
};

/**
 * response_curve — marketing saturation / diminishing-returns analysis and
 * budget reallocation across channels. Uses a constant-elasticity response model
 * conversions(spend) = a · spend^b (0<b<1 ⇒ diminishing returns), calibrated per
 * channel from the operator's OWN current spend/conversions (no fabricated data).
 *
 * With a shared elasticity b, maximizing total conversions under a fixed total
 * budget has a closed form: optimal spend share ∝ a_i^{1/(1-b)}. We return the
 * recommended split, projected conversions, per-channel marginal CPA, and the
 * uplift vs. the current allocation — the "efficient frontier" point.
 */
const responseCurve: ToolDef = {
  name: "response_curve",
  description:
    "Channel saturation / diminishing-returns modeling + budget reallocation. Fits a constant-elasticity response curve (conversions = a·spend^b, 0<b<1) to YOUR current per-channel spend & conversions, then computes the conversion-maximizing split for a target total budget (closed-form: share ∝ a^(1/(1-b))). Returns recommended spend per channel, projected conversions, marginal CPA, blended-CPA improvement and uplift vs. current. Model-based decision support (not real benchmarks).",
  inputSchema: {
    type: "object",
    properties: {
      channels: {
        type: "array",
        minItems: 2,
        description: "Channels with their CURRENT spend and conversions",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name" },
            currentSpend: { type: "number", exclusiveMinimum: 0, description: "Current spend (RUB)" },
            currentConversions: { type: "number", minimum: 0, description: "Current conversions" },
          },
          required: ["name", "currentSpend", "currentConversions"],
          additionalProperties: false,
        },
      },
      elasticity: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: 1,
        description: "Response elasticity b (0<b≤1). Lower = stronger diminishing returns. Default 0.7.",
      },
      totalBudget: {
        type: "number",
        exclusiveMinimum: 0,
        description: "Total budget to allocate (RUB). Default = sum of current spends (pure reallocation).",
      },
    },
    required: ["channels"],
    additionalProperties: false,
  },
  async handler(input) {
    const channels = (input.channels ?? []) as Array<{
      name: string;
      currentSpend: number;
      currentConversions: number;
    }>;
    const warnings: string[] = [];

    // Elasticity: clamp into (0,1). b→1 (linear) breaks the closed form, so cap.
    let b = typeof input.elasticity === "number" ? input.elasticity : 0.7;
    if (b >= 1) {
      b = 0.95;
      warnings.push("elasticity≥1 (no diminishing returns) — capped to 0.95 for a finite optimum.");
    }
    if (b <= 0) b = 0.7;

    const currentTotalSpend = channels.reduce((s, c) => s + c.currentSpend, 0);
    const totalBudget =
      typeof input.totalBudget === "number" && input.totalBudget > 0 ? input.totalBudget : currentTotalSpend;

    // Calibrate a_i from the current point: a = conv / spend^b.
    const calib = channels.map((c) => {
      const a = c.currentConversions > 0 ? c.currentConversions / Math.pow(c.currentSpend, b) : 0;
      return { ...c, a };
    });

    // Optimal share ∝ a^{1/(1-b)}. If no channel has signal, split evenly.
    const exponent = 1 / (1 - b);
    const rawWeights = calib.map((c) => (c.a > 0 ? Math.pow(c.a, exponent) : 0));
    const weightSum = rawWeights.reduce((s, w) => s + w, 0);
    if (weightSum <= 0) {
      warnings.push("No channel has conversions > 0 — cannot infer efficiency; splitting the budget evenly.");
    }

    const rows = calib.map((c, i) => {
      const recommendedSpend =
        weightSum > 0 ? totalBudget * (rawWeights[i] / weightSum) : totalBudget / calib.length;
      const projectedConversions = c.a > 0 ? c.a * Math.pow(recommendedSpend, b) : 0;
      // Marginal conversions per RUB = a·b·spend^{b-1}; marginal CPA = its reciprocal.
      const marginal = c.a > 0 && recommendedSpend > 0 ? c.a * b * Math.pow(recommendedSpend, b - 1) : 0;
      const marginalCPA = marginal > 0 ? round(1 / marginal) : null;
      const currentCPA = c.currentConversions > 0 ? round(c.currentSpend / c.currentConversions) : null;
      const spendDeltaPct =
        c.currentSpend > 0 ? round(((recommendedSpend - c.currentSpend) / c.currentSpend) * 100, 1) : null;
      return {
        name: c.name,
        currentSpend: round(c.currentSpend),
        currentConversions: round(c.currentConversions, 1),
        currentCPA,
        recommendedSpend: round(recommendedSpend),
        spendDeltaPct,
        projectedConversions: round(projectedConversions, 1),
        marginalCPA,
      };
    });
    rows.sort((x, y) => y.recommendedSpend - x.recommendedSpend);

    const currentTotalConv = channels.reduce((s, c) => s + c.currentConversions, 0);
    const projectedTotalConv = rows.reduce((s, r) => s + r.projectedConversions, 0);
    const blendedCurrentCPA = currentTotalConv > 0 ? round(currentTotalSpend / currentTotalConv) : null;
    const blendedProjectedCPA = projectedTotalConv > 0 ? round(totalBudget / projectedTotalConv) : null;
    const upliftConversions = round(projectedTotalConv - currentTotalConv, 1);
    const upliftPct = currentTotalConv > 0 ? round((upliftConversions / currentTotalConv) * 100, 1) : null;
    const cpaImprovementPct =
      blendedCurrentCPA && blendedProjectedCPA
        ? round(((blendedCurrentCPA - blendedProjectedCPA) / blendedCurrentCPA) * 100, 1)
        : null;

    const payload = {
      model: "constant-elasticity (conversions = a·spend^b)",
      elasticity: b,
      totalBudget: round(totalBudget),
      isReallocation: !(typeof input.totalBudget === "number" && input.totalBudget > 0),
      channels: rows,
      totals: {
        currentSpend: round(currentTotalSpend),
        currentConversions: round(currentTotalConv, 1),
        projectedConversions: round(projectedTotalConv, 1),
        blendedCurrentCPA,
        blendedProjectedCPA,
        upliftConversions,
        upliftPct,
        cpaImprovementPct,
      },
      methodology:
        "Per-channel a calibrated from current spend/conversions; optimal share ∝ a^(1/(1-b)) under a fixed total budget. Marginal CPA = 1/(a·b·spend^(b-1)). At the optimum, marginal CPA is equalized across funded channels.",
      warnings,
      disclaimer:
        "Model-based decision support, not real benchmarks. A single calibration point assumes the elasticity b; validate b against historical spend/response before acting.",
    };

    const summary =
      `Кривые отдачи (b=${b}) по ${rows.length} каналам, бюджет ${ru(round(totalBudget))} ₽: ` +
      `прогноз ${ru(round(projectedTotalConv, 1))} конв.` +
      (upliftPct != null ? ` (${upliftPct >= 0 ? "+" : ""}${upliftPct}% к текущим)` : "") +
      (cpaImprovementPct != null ? `, blended CPA ${cpaImprovementPct >= 0 ? "−" : "+"}${Math.abs(cpaImprovementPct)}%.` : ".");
    return toContent(summary, payload);
  },
};

/**
 * budget_pacing_forecast — trend-aware end-of-flight projection. Unlike
 * pacing_monitor (a linear extrapolation from spend-to-date), this projects the
 * landing spend from the RECENT daily run-rate (last N days when provided),
 * reports the projected over/under-spend %, the days-to-exhaust the budget, the
 * recommended daily rate (and % adjustment) to land exactly on budget, and an
 * optional CPA pace when conversions-to-date are given.
 */
const budgetPacingForecast: ToolDef = {
  name: "budget_pacing_forecast",
  description:
    "Trend-aware budget pacing forecast. From the total budget, total/elapsed days and spend-to-date — and optionally the recent daily spend series — it projects end-of-flight spend from the RECENT run-rate (not just a flat average), the over/under-spend variance %, the days to exhaust the budget at the current rate, and the recommended daily rate (and % adjustment) to land exactly on budget. Optional conversions-to-date adds a CPA pace. Complements pacing_monitor (linear) with a trend-based projection. Deterministic; figures illustrative.",
  inputSchema: {
    type: "object",
    properties: {
      totalBudget: { type: "number", exclusiveMinimum: 0, description: "Total budget for the flight (₽)" },
      daysTotal: { type: "integer", exclusiveMinimum: 0, description: "Total days in the flight" },
      daysElapsed: { type: "integer", exclusiveMinimum: 0, description: "Days elapsed so far" },
      spendToDate: { type: "number", minimum: 0, description: "Actual spend so far (₽)" },
      recentDailySpend: {
        type: "array",
        items: { type: "number", minimum: 0 },
        description: "Optional recent daily spend (most-recent last) → trend run-rate; defaults to spendToDate/daysElapsed",
      },
      conversionsToDate: { type: "number", minimum: 0, description: "Optional conversions so far → CPA pace" },
      onTrackBandPct: { type: "number", minimum: 1, maximum: 50, description: "± band considered on-track (default 5%)" },
    },
    required: ["totalBudget", "daysTotal", "daysElapsed", "spendToDate"],
    additionalProperties: false,
  },
  async handler(input) {
    const totalBudget = Number(input.totalBudget);
    const daysTotal = Math.round(Number(input.daysTotal));
    const daysElapsed = clamp(Math.round(Number(input.daysElapsed)), 1, daysTotal);
    const spendToDate = Math.max(0, Number(input.spendToDate));
    const band = clamp(Number(input.onTrackBandPct ?? 5), 1, 50) / 100;
    const remainingDays = daysTotal - daysElapsed;
    const remainingBudget = totalBudget - spendToDate;

    const flatDaily = spendToDate / daysElapsed;
    const recent = Array.isArray(input.recentDailySpend)
      ? (input.recentDailySpend as number[]).filter((x) => typeof x === "number" && x >= 0)
      : [];
    const trendDaily = recent.length > 0 ? recent.reduce((s, x) => s + x, 0) / recent.length : flatDaily;

    const projectedEndSpend = spendToDate + trendDaily * remainingDays;
    const projectedVariancePct = ((projectedEndSpend - totalBudget) / totalBudget) * 100;
    const status =
      projectedVariancePct > band * 100 ? "overpacing" : projectedVariancePct < -band * 100 ? "underpacing" : "on_track";

    const daysToExhaust = trendDaily > 0 ? remainingBudget / trendDaily : Infinity;
    const willExhaustEarly = Number.isFinite(daysToExhaust) && daysToExhaust < remainingDays;
    const recommendedDailyRate = remainingDays > 0 ? Math.max(0, remainingBudget) / remainingDays : 0;
    const recommendedAdjustmentPct = trendDaily > 0 ? (recommendedDailyRate / trendDaily - 1) * 100 : null;

    const conv = typeof input.conversionsToDate === "number" && input.conversionsToDate > 0 ? input.conversionsToDate : null;
    const cpaToDate = conv != null ? spendToDate / conv : null;
    const projectedConversions = conv != null && spendToDate > 0 ? conv * (projectedEndSpend / spendToDate) : null;

    const action =
      status === "overpacing"
        ? `Перелёт: при текущем темпе (~${ru(round(trendDaily))} ₽/день) к концу выйдет ${ru(round(projectedEndSpend))} ₽ (+${round(projectedVariancePct, 1)}%).` +
          (willExhaustEarly ? ` Бюджет кончится за ~${round(daysToExhaust)} дн. (до конца ${remainingDays}).` : "") +
          ` Снизь дневной до ~${ru(round(recommendedDailyRate))} ₽ (${recommendedAdjustmentPct != null ? round(recommendedAdjustmentPct, 0) : "—"}%).`
        : status === "underpacing"
          ? `Недолёт: прогноз ${ru(round(projectedEndSpend))} ₽ (${round(projectedVariancePct, 1)}%), останется ~${ru(round(totalBudget - projectedEndSpend))} ₽. Подними дневной до ~${ru(round(recommendedDailyRate))} ₽ (+${recommendedAdjustmentPct != null ? round(recommendedAdjustmentPct, 0) : "—"}%) или перелей в эффективные каналы (budget_optimizer).`
          : `В графике: прогноз ${ru(round(projectedEndSpend))} ₽ (${round(projectedVariancePct, 1)}%). Держи дневной ~${ru(round(recommendedDailyRate))} ₽.`;

    const payload = {
      totalBudget: round(totalBudget),
      daysTotal,
      daysElapsed,
      remainingDays,
      spendToDate: round(spendToDate),
      remainingBudget: round(remainingBudget),
      currentDailyRate: round(trendDaily),
      usedTrend: recent.length > 0,
      flatDailyAvg: round(flatDaily),
      projectedEndSpend: round(projectedEndSpend),
      projectedVariancePct: round(projectedVariancePct, 1),
      status,
      daysToExhaust: Number.isFinite(daysToExhaust) ? round(daysToExhaust, 1) : null,
      willExhaustEarly,
      recommendedDailyRate: round(recommendedDailyRate),
      recommendedAdjustmentPct: recommendedAdjustmentPct != null ? round(recommendedAdjustmentPct, 1) : null,
      cpaToDate: cpaToDate != null ? round(cpaToDate) : null,
      projectedConversions: projectedConversions != null ? round(projectedConversions) : null,
      action,
      disclaimer: "Прогноз по текущему run-rate; для сезонных флайтов учитывай seasonality_forecast и аукционную динамику.",
    };

    const summary =
      `Прогноз пейсинга: «${status}», к концу ~${ru(round(projectedEndSpend))} ₽ (${projectedVariancePct >= 0 ? "+" : ""}${round(projectedVariancePct, 1)}% к бюджету). ` +
      `Рекоменд. дневной ~${ru(round(recommendedDailyRate))} ₽${recommendedAdjustmentPct != null ? ` (${recommendedAdjustmentPct >= 0 ? "+" : ""}${round(recommendedAdjustmentPct, 0)}%)` : ""}.` +
      (willExhaustEarly ? ` ⚠️ Бюджет кончится за ~${round(daysToExhaust)} дн.` : "");

    return toContent(summary, payload);
  },
};

/**
 * utm_taxonomy_qa — batch UTM/taxonomy governance audit. Parses a list of tagged
 * URLs (or raw query strings), checks each for missing required params, casing,
 * spaces and non-ASCII, then aggregates a consistency score, near-duplicate value
 * variants per parameter (e.g. "facebook" vs "Facebook" vs "fb"), values outside
 * an allow-list, and concrete fixes. Complements utm_builder (which builds ONE
 * link) by auditing a whole campaign export for consistency.
 */
function parseUtm(raw: string): { ok: boolean; params: Record<string, string> } {
  const s = String(raw ?? "").trim();
  if (!s) return { ok: false, params: {} };
  const params: Record<string, string> = {};
  try {
    let qs = s;
    if (/^https?:\/\//i.test(s)) qs = new URL(s).search;
    qs = qs.replace(/^\?/, "");
    if (qs) {
      for (const part of qs.split("&")) {
        const [k, v = ""] = part.split("=");
        if (!k) continue;
        const key = decodeURIComponent(k.trim());
        if (/^utm_/i.test(key)) params[key.toLowerCase()] = decodeURIComponent(v.replace(/\+/g, " "));
      }
    }
  } catch {
    return { ok: false, params: {} };
  }
  return { ok: true, params };
}

const utmTaxonomyQa: ToolDef = {
  name: "utm_taxonomy_qa",
  description:
    "Batch UTM / taxonomy governance auditor. Give it a list of tagged URLs (or raw UTM query strings) and it parses every link, checks each for missing required params (utm_source/medium/campaign by default), uppercase, spaces and non-ASCII/Cyrillic, then aggregates a 0–100 consistency score, near-duplicate value variants per parameter (e.g. 'facebook' vs 'Facebook' vs 'fb'), values outside an optional allow-list for source/medium, and concrete fixes. Complements utm_builder (which builds ONE link) by auditing a whole campaign export for consistency. Deterministic; no network call.",
  inputSchema: {
    type: "object",
    properties: {
      urls: {
        type: "array",
        minItems: 1,
        items: { type: "string" },
        description: "Tagged URLs or raw UTM query strings to audit",
      },
      requiredParams: {
        type: "array",
        items: { type: "string" },
        description: "Required UTM params (default ['utm_source','utm_medium','utm_campaign'])",
      },
      allowedSources: { type: "array", items: { type: "string" }, description: "Optional allow-list of valid utm_source values" },
      allowedMediums: { type: "array", items: { type: "string" }, description: "Optional allow-list of valid utm_medium values" },
    },
    required: ["urls"],
    additionalProperties: false,
  },
  async handler(input) {
    const urls: string[] = ((input.urls ?? []) as unknown[]).map((u) => String(u)).filter((u) => u.trim() !== "");
    if (urls.length === 0) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один URL/строку UTM в urls[]." }], isError: true };
    }
    const required = Array.isArray(input.requiredParams) && input.requiredParams.length
      ? (input.requiredParams as string[]).map((p) => p.toLowerCase())
      : ["utm_source", "utm_medium", "utm_campaign"];
    const allowedSources = Array.isArray(input.allowedSources) ? (input.allowedSources as string[]).map((x) => x.toLowerCase()) : null;
    const allowedMediums = Array.isArray(input.allowedMediums) ? (input.allowedMediums as string[]).map((x) => x.toLowerCase()) : null;

    const norm = (v: string) => v.trim().toLowerCase().replace(/[\s_-]+/g, "");
    const valuesByParam: Record<string, Map<string, Set<string>>> = {};
    const issueCounts: Record<string, number> = {
      missing_required: 0,
      uppercase: 0,
      spaces: 0,
      non_ascii: 0,
      unparseable: 0,
      not_in_allowlist: 0,
    };

    const rows = urls.map((u, idx) => {
      const { ok, params } = parseUtm(u);
      const rowIssues: string[] = [];
      if (!ok || Object.keys(params).length === 0) {
        issueCounts.unparseable++;
        rowIssues.push("не распарсилось / нет utm-параметров");
        return { index: idx, url: u, params, issues: rowIssues };
      }
      for (const r of required) {
        if (!params[r] || params[r].trim() === "") {
          issueCounts.missing_required++;
          rowIssues.push(`нет ${r}`);
        }
      }
      for (const [k, v] of Object.entries(params)) {
        if (/[A-ZА-Я]/.test(v)) {
          issueCounts.uppercase++;
          rowIssues.push(`${k}: верхний регистр`);
        }
        if (/\s/.test(v)) {
          issueCounts.spaces++;
          rowIssues.push(`${k}: пробелы`);
        }
        if (/[^\x00-\x7F]/.test(v)) {
          issueCounts.non_ascii++;
          rowIssues.push(`${k}: не-ASCII (кириллица)`);
        }
        if (!valuesByParam[k]) valuesByParam[k] = new Map();
        const key = norm(v);
        if (!valuesByParam[k].has(key)) valuesByParam[k].set(key, new Set());
        valuesByParam[k].get(key)!.add(v);
      }
      if (allowedSources && params.utm_source && !allowedSources.includes(params.utm_source.toLowerCase())) {
        issueCounts.not_in_allowlist++;
        rowIssues.push(`utm_source «${params.utm_source}» вне allow-list`);
      }
      if (allowedMediums && params.utm_medium && !allowedMediums.includes(params.utm_medium.toLowerCase())) {
        issueCounts.not_in_allowlist++;
        rowIssues.push(`utm_medium «${params.utm_medium}» вне allow-list`);
      }
      return { index: idx, url: u, params, issues: rowIssues };
    });

    // Near-duplicate variants: same normalized key but >1 raw spelling.
    const variants: Array<{ param: string; canonical: string; spellings: string[] }> = [];
    for (const [param, map] of Object.entries(valuesByParam)) {
      for (const [, spellingsSet] of map.entries()) {
        if (spellingsSet.size > 1) {
          const spellings = [...spellingsSet];
          variants.push({ param, canonical: spellings[0].toLowerCase(), spellings });
        }
      }
    }

    const totalIssues = Object.values(issueCounts).reduce((s, x) => s + x, 0);
    const cleanRows = rows.filter((r) => r.issues.length === 0).length;
    // Score: start 100, −2 per issue, −5 per variant cluster, floored at 0.
    const score = Math.max(0, 100 - totalIssues * 2 - variants.length * 5);

    const recommendations: string[] = [];
    if (issueCounts.uppercase || issueCounts.spaces || issueCounts.non_ascii)
      recommendations.push("Приведи все значения к нижнему регистру, латинице и разделителю «_» (utm_builder).");
    if (issueCounts.missing_required) recommendations.push("Заполни обязательные параметры на всех ссылках.");
    if (variants.length) recommendations.push(`Унифицируй разнобой в значениях (${variants.length} кластеров), напр. ${variants.slice(0, 3).map((v) => v.spellings.join("/")).join("; ")}.`);
    if (issueCounts.not_in_allowlist) recommendations.push("Приведи source/medium к утверждённому словарю.");
    if (recommendations.length === 0) recommendations.push("Таксономия консистентна — поддерживай единый словарь и шаблон через utm_builder.");

    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    const payload = {
      urlsAudited: urls.length,
      cleanUrls: cleanRows,
      consistencyScore: score,
      grade,
      requiredParams: required,
      issueCounts,
      totalIssues,
      variantClusters: variants,
      rows: rows.map((r) => ({ index: r.index, params: r.params, issues: r.issues })),
      recommendations,
      methodology:
        "Парсинг utm_* из URL/query → проверка обязательных параметров, регистра, пробелов, не-ASCII и allow-list; кластеры разнобоя — одинаковое нормализованное значение (lower, без -_ пробелов) с >1 написанием. Score = 100 − 2×проблема − 5×кластер.",
      assumptions: [
        "Аудит синтаксиса/консистентности тегирования, не корректности бизнес-смысла кампаний.",
        "Allow-list проверяется только если передан.",
      ],
      disclaimer: "Проверка тегирования; на качество данных в аналитике влияет и настройка систем сбора.",
    };

    const summary =
      `UTM-аудит ${urls.length} ссылок: консистентность ${score}/100 (${grade}), чистых ${cleanRows}, проблем ${totalIssues}, кластеров разнобоя ${variants.length}. ` +
      (recommendations[0] ?? "");

    return toContent(summary, payload);
  },
};

export const PREMIUM_TOOLS: ToolDef[] = [
  creativeVariants,
  anomalyDetector,
  cohortLtv,
  utmBuilder,
  pacingMonitor,
  responseCurve,
  budgetPacingForecast,
  utmTaxonomyQa,
];
