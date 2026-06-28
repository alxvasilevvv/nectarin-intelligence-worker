/**
 * AUDIT tool group (v2.15) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • marketing_audit — a senior-operator account health audit. Takes the current
 *     per-channel spend & conversions, scores each channel's CPA against RU/CIS
 *     category benchmarks (p25/p50/p75), flags concentration risk and untracked
 *     channels, computes an overall health score + grade, and returns a prioritized
 *     action plan with a projected reallocation impact (extra conversions / saved
 *     budget). Deterministic; data-aware (respects KV / per-tenant overrides).
 *
 * Outputs are decision-support, not legal/financial advice. Benchmarks are mock
 * unless real data is layered into KV.
 */

import { CATEGORIES, PLATFORMS, getCategoryBenchmarks } from "./data.js";
import type { ToolDef, ToolResult } from "./tools.js";

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

// Map a free-text channel name to a known RU/CIS platform (for benchmark lookup).
const PLATFORM_ALIASES: Array<[RegExp, string]> = [
  [/vk|вконтакте|вк/i, "VK Ads"],
  [/yandex|яндекс|директ|direct/i, "Yandex Direct"],
  [/telegram|телеграм|тг|tg/i, "Telegram Ads"],
  [/olv|видео|youtube|rutube|видеореклам/i, "OLV"],
  [/avito|авито/i, "Avito"],
];
function matchPlatform(name: string): string | null {
  for (const p of PLATFORMS) if (name.trim().toLowerCase() === p.toLowerCase()) return p;
  for (const [re, p] of PLATFORM_ALIASES) if (re.test(name)) return p;
  return null;
}

type Verdict = "below p25" | "p25–p50" | "p50–p75" | "above p75" | "wasteful" | "untracked" | "no benchmark";

function verdictAndScore(cpa: number | null, bm: { p25: number; p50: number; p75: number } | null): {
  verdict: Verdict;
  score: number;
} {
  if (cpa == null) return { verdict: "untracked", score: 30 };
  if (!bm) return { verdict: "no benchmark", score: 60 };
  if (cpa <= bm.p25) return { verdict: "below p25", score: 95 };
  if (cpa <= bm.p50) return { verdict: "p25–p50", score: 80 };
  if (cpa <= bm.p75) return { verdict: "p50–p75", score: 60 };
  if (cpa <= bm.p75 * 1.25) return { verdict: "above p75", score: 40 };
  return { verdict: "wasteful", score: 20 };
}

interface ChannelAudit {
  name: string;
  platformMatched: string | null;
  spend: number;
  sharePct: number;
  conversions: number;
  cpa: number | null;
  benchmarkCpa: { p25: number; p50: number; p75: number } | null;
  verdict: Verdict;
  score: number;
  flags: string[];
}

const marketingAudit: ToolDef = {
  name: "marketing_audit",
  description:
    "Senior-level account health audit. Give the current per-channel spend & conversions for a category and NECTARIN scores each channel's CPA against RU/CIS benchmarks (p25/p50/p75), flags concentration risk (one channel hogging budget) and untracked channels (no conversions), computes an overall health score (0-100) + grade A–D, and returns a PRIORITIZED action plan — including a concrete budget reallocation with projected extra conversions and saved spend. Optional targetCpa compares blended CPA to your business goal. Deterministic; benchmarks are mock unless real data is layered into KV.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category (anchors benchmarks)" },
      channels: {
        type: "array",
        minItems: 1,
        description: "Current spend & conversions per channel (last period). Channel names matched to RU/CIS platforms for benchmarking.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name, e.g. 'VK Ads', 'Yandex Direct', 'Telegram Ads', 'OLV', 'Avito'" },
            spend: { type: "number", minimum: 0, description: "Spend in RUB" },
            conversions: { type: "number", minimum: 0, description: "Conversions (leads/orders) attributed to the channel" },
          },
          required: ["name", "spend", "conversions"],
          additionalProperties: false,
        },
      },
      targetCpa: { type: "number", exclusiveMinimum: 0, description: "Optional business target CPA in RUB to compare blended CPA against" },
    },
    required: ["category", "channels"],
    additionalProperties: false,
  },
  async handler(input) {
    const category = String(input.category);
    const targetCpa = input.targetCpa != null ? Number(input.targetCpa) : null;
    const rawChannels: Array<{ name: string; spend: number; conversions: number }> = Array.isArray(input.channels)
      ? input.channels
      : [];
    if (!rawChannels.length) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один канал в channels." }], isError: true };
    }

    const benchmarks = (await getCategoryBenchmarks(category)) ?? {};
    const totalSpend = rawChannels.reduce((a, c) => a + Math.max(0, Number(c.spend) || 0), 0);
    const totalConv = rawChannels.reduce((a, c) => a + Math.max(0, Number(c.conversions) || 0), 0);

    const channels: ChannelAudit[] = rawChannels.map((c) => {
      const spend = Math.max(0, Number(c.spend) || 0);
      const conversions = Math.max(0, Number(c.conversions) || 0);
      const cpa = conversions > 0 ? round(spend / conversions) : null;
      const platform = matchPlatform(String(c.name ?? ""));
      const bm = platform ? benchmarks[platform]?.CPA ?? null : null;
      const { verdict, score } = verdictAndScore(cpa, bm);
      const flags: string[] = [];
      if (cpa == null) flags.push("Нет конверсий — проверь трекинг или поставь на паузу");
      if (verdict === "wasteful") flags.push("CPA значительно выше p75 — кандидат на срез/переработку");
      if (!platform) flags.push("Канал не сопоставлен с площадкой — бенчмарк недоступен");
      const sharePct = totalSpend > 0 ? round((spend / totalSpend) * 100, 1) : 0;
      if (sharePct > 60) flags.push("Концентрация: >60% бюджета в одном канале");
      return {
        name: String(c.name ?? ""),
        platformMatched: platform,
        spend: round(spend),
        sharePct,
        conversions: round(conversions),
        cpa,
        benchmarkCpa: bm ? { p25: bm.p25, p50: bm.p50, p75: bm.p75 } : null,
        verdict,
        score,
        flags,
      };
    });

    const blendedCpa = totalConv > 0 ? round(totalSpend / totalConv) : null;

    // Spend-weighted health, then penalties.
    let health =
      totalSpend > 0
        ? channels.reduce((a, c) => a + c.score * (c.spend / totalSpend), 0)
        : channels.reduce((a, c) => a + c.score, 0) / channels.length;
    const top = channels.reduce((m, c) => (c.sharePct > m.sharePct ? c : m), channels[0]);
    const concentrationRisk = top.sharePct > 60;
    if (concentrationRisk) health -= 10;
    const wastefulHeavy = channels.some((c) => c.verdict === "wasteful" && c.sharePct >= 20);
    if (wastefulHeavy) health -= 10;
    if (channels.some((c) => c.verdict === "untracked" && c.sharePct >= 15)) health -= 5;
    health = clamp(round(health), 0, 100);
    const grade = health >= 85 ? "A" : health >= 70 ? "B" : health >= 50 ? "C" : "D";

    // ── Findings ──
    const findings: string[] = [];
    if (blendedCpa != null) findings.push(`Сводный blended CPA: ${ru(blendedCpa)} ₽ при общем спенде ${ru(round(totalSpend))} ₽.`);
    if (concentrationRisk) findings.push(`Риск концентрации: «${top.name}» = ${top.sharePct}% бюджета.`);
    const below = channels.filter((c) => c.verdict === "below p25");
    if (below.length) findings.push(`Эффективные каналы (CPA < p25): ${below.map((c) => c.name).join(", ")} — кандидаты на доинвестирование.`);
    const bad = channels.filter((c) => c.verdict === "wasteful" || c.verdict === "above p75");
    if (bad.length) findings.push(`Слабые по CPA: ${bad.map((c) => c.name).join(", ")}.`);
    if (targetCpa != null && blendedCpa != null) {
      findings.push(
        blendedCpa <= targetCpa
          ? `Цель по CPA выполнена: ${ru(blendedCpa)} ≤ ${ru(targetCpa)} ₽.`
          : `Цель по CPA НЕ выполнена: ${ru(blendedCpa)} > ${ru(targetCpa)} ₽ (превышение ${round(((blendedCpa - targetCpa) / targetCpa) * 100, 1)}%).`
      );
    }

    // ── Prioritized recommendations ──
    const recommendations: Array<{ priority: number; action: string; rationale: string; projectedImpact: string }> = [];

    // 1) Reallocation from worst to best (both must have a measurable CPA).
    const measured = channels.filter((c) => c.cpa != null);
    const best = measured
      .filter((c) => c.benchmarkCpa)
      .reduce<ChannelAudit | null>((m, c) => (m == null || (c.cpa as number) < (m.cpa as number) ? c : m), null);
    const worst = measured
      .filter((c) => c.benchmarkCpa && (c.verdict === "wasteful" || c.verdict === "above p75") && c.spend > 0)
      .reduce<ChannelAudit | null>((m, c) => (m == null || (c.cpa as number) > (m.cpa as number) ? c : m), null);
    if (best && worst && best.name !== worst.name) {
      const moveAmt = round(0.2 * worst.spend);
      const addConv = (1 / (best.cpa as number) - 1 / (worst.cpa as number)) * moveAmt;
      if (addConv > 0) {
        recommendations.push({
          priority: 1,
          action: `Перелей ~${ru(moveAmt)} ₽ из «${worst.name}» в «${best.name}».`,
          rationale: `CPA «${worst.name}» = ${ru(worst.cpa as number)} ₽ (выше p75), «${best.name}» = ${ru(best.cpa as number)} ₽ (ниже p25).`,
          projectedImpact: `+~${ru(round(addConv))} конверсий при том же бюджете (≈ ${ru(round(addConv * (best.cpa as number)))} ₽ эквивалентной экономии).`,
        });
      }
    }
    // 2) Concentration.
    if (concentrationRisk) {
      recommendations.push({
        priority: recommendations.length + 1,
        action: `Снизь долю «${top.name}» с ${top.sharePct}% до ≤45–50% и протестируй 1–2 новых канала.`,
        rationale: "Высокая концентрация = хрупкость к изменениям аукциона/политики площадки и упёртый потолок объёма.",
        projectedImpact: "Снижение риска и доступ к дополнительному объёму конверсий вне потолка канала.",
      });
    }
    // 3) Untracked.
    const untracked = channels.filter((c) => c.verdict === "untracked" && c.spend > 0);
    if (untracked.length) {
      recommendations.push({
        priority: recommendations.length + 1,
        action: `Почини атрибуцию или поставь на паузу: ${untracked.map((c) => c.name).join(", ")}.`,
        rationale: `Тратят бюджет (${ru(round(untracked.reduce((a, c) => a + c.spend, 0)))} ₽), но конверсии не фиксируются.`,
        projectedImpact: "Возврат «слепого» бюджета в измеримые каналы или корректная оценка эффективности.",
      });
    }
    if (!recommendations.length) {
      recommendations.push({
        priority: 1,
        action: "Держи курс: структура расходов здоровая — масштабируй лучшие каналы с шагом 10–15%/нед.",
        rationale: "Нет выраженных перекосов по CPA, концентрации или трекингу.",
        projectedImpact: "Плавный рост объёма без роста blended CPA.",
      });
    }

    const payload = {
      category,
      currency: "RUB",
      totalSpend: round(totalSpend),
      totalConversions: round(totalConv),
      blendedCpa,
      targetCpa,
      healthScore: health,
      grade,
      concentration: { topChannel: top.name, sharePct: top.sharePct, risk: concentrationRisk },
      channels,
      findings,
      recommendations,
      disclaimer: "Аудит на mock-бенчмарках RU/CIS (если в KV не загружены реальные данные). Не является юридической/финансовой гарантией.",
    };

    const summary =
      `Аудит маркетинга «${category}»: health ${health}/100 (${grade}). ` +
      (blendedCpa != null ? `Blended CPA ${ru(blendedCpa)} ₽, спенд ${ru(round(totalSpend))} ₽. ` : `Спенд ${ru(round(totalSpend))} ₽. `) +
      `${recommendations.length} приоритетных рекомендаций` +
      (concentrationRisk ? `; ⚠ концентрация в «${top.name}» (${top.sharePct}%).` : ".");

    return toContent(summary, payload);
  },
};

// ── landing_cro_audit ─────────────────────────────────────────────────────────

interface CroDim {
  key: string;
  label: string;
  weight: number;
  score: number | null; // 0..100, null when no data supplied
  maxRelUplift: number; // relative CR uplift unlocked if this dimension is fixed (0..1)
  note: string;
}

const landingCroAudit: ToolDef = {
  name: "landing_cro_audit",
  description:
    "Heuristic conversion-rate-optimization (CRO) audit for a landing page. Scores up to seven UX/performance dimensions you provide — page speed (loadTimeSec), bounce rate, mobile parity (mobile vs overall CR), form friction (formFields + stepsToConvert), CTA clarity (hasClearCta + aboveFoldCta), trust & social proof (hasSocialProof + hasTrustSignals), and CR vs an industry benchmark — into a weighted 0-100 CRO score with a letter grade. Returns a prioritized issue list (by weight × gap), concrete fixes, and a projected CR uplift (multiplicative, with diminishing returns) that, given monthlyVisitors + AOV, is translated into incremental conversions & revenue. Heuristic decision support — validate with a real A/B test (see ab_test_planner / creative_testing_matrix), not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      conversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Current overall landing-page conversion rate %" },
      bounceRatePct: { type: "number", minimum: 0, maximum: 100, description: "Bounce rate %" },
      loadTimeSec: { type: "number", exclusiveMinimum: 0, description: "Page load time / LCP, seconds" },
      mobileConversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Mobile conversion rate % (compared to overall for parity)" },
      mobileSharePct: { type: "number", minimum: 0, maximum: 100, description: "Share of traffic on mobile % (context)" },
      formFields: { type: "number", minimum: 0, description: "Number of fields in the primary form" },
      stepsToConvert: { type: "number", minimum: 1, description: "Number of steps/clicks to convert (default 1)" },
      hasClearCta: { type: "boolean", description: "Is there a single, clear primary CTA?" },
      aboveFoldCta: { type: "boolean", description: "Is the primary CTA visible above the fold?" },
      hasSocialProof: { type: "boolean", description: "Reviews / testimonials / client logos present?" },
      hasTrustSignals: { type: "boolean", description: "Guarantees / security / returns / contacts present?" },
      industryBenchmarkCRPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Industry benchmark CR % to compare against" },
      monthlyVisitors: { type: "number", minimum: 0, description: "Monthly visitors (to monetize the uplift)" },
      aov: { type: "number", minimum: 0, description: "Average order value, ₽ (to monetize the uplift)" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const dims: CroDim[] = [];

    // 1) Page speed — 20%
    if (typeof input.loadTimeSec === "number" && input.loadTimeSec > 0) {
      const t = input.loadTimeSec;
      const score = clamp(100 - Math.max(0, t - 1.5) * 18, 0, 100);
      dims.push({
        key: "speed", label: "Скорость загрузки", weight: 0.2, score, maxRelUplift: 0.18,
        note: t <= 2 ? "Быстро (≤2с)." : t <= 3 ? `Средне (${t}с) — цель ≤2.5с (каждая сек. >3с режет конверсию).` : `Медленно (${t}с) — критично: сожми изображения, lazy-load, CDN, цель ≤2.5с.`,
      });
    }
    // 2) Bounce — 15%
    if (typeof input.bounceRatePct === "number") {
      const b = input.bounceRatePct;
      const score = clamp(100 - Math.max(0, b - 30) * 1.6, 0, 100);
      dims.push({
        key: "bounce", label: "Показатель отказов", weight: 0.15, score, maxRelUplift: 0.1,
        note: b <= 40 ? "В норме." : b <= 60 ? `Повышен (${b}%) — усиль соответствие оффера запросу и первый экран.` : `Высокий (${b}%) — проверь релевантность трафика, скорость и первый экран.`,
      });
    }
    // 3) Mobile parity — 15%
    if (typeof input.mobileConversionRatePct === "number" && typeof input.conversionRatePct === "number" && input.conversionRatePct > 0) {
      const parity = input.mobileConversionRatePct / input.conversionRatePct;
      const score = clamp(parity * 100, 0, 100);
      dims.push({
        key: "mobile", label: "Мобильный паритет", weight: 0.15, score, maxRelUplift: 0.2,
        note: parity >= 0.9 ? "Мобайл не отстаёт." : `Мобильная конверсия ${round(parity * 100, 0)}% от общей — оптимизируй мобильный UX, формы, скорость${typeof input.mobileSharePct === "number" ? ` (мобайл — ${input.mobileSharePct}% трафика)` : ""}.`,
      });
    }
    // 4) Form friction — 15%
    if (typeof input.formFields === "number") {
      const f = input.formFields;
      const steps = typeof input.stepsToConvert === "number" && input.stepsToConvert >= 1 ? input.stepsToConvert : 1;
      const fieldScore = clamp(100 - Math.max(0, f - 3) * 9, 0, 100);
      const stepScore = clamp(100 - Math.max(0, steps - 1) * 18, 0, 100);
      const score = Math.round(fieldScore * 0.65 + stepScore * 0.35);
      dims.push({
        key: "form", label: "Трение формы", weight: 0.15, score, maxRelUplift: 0.15,
        note: f <= 3 && steps <= 2 ? "Минимум трения." : `${f} пол${f === 1 ? "е" : "ей"} / ${steps} шаг(ов) — убери необязательные поля, объедини шаги, добавь автозаполнение.`,
      });
    }
    // 5) CTA clarity — 15%
    if (typeof input.hasClearCta === "boolean" || typeof input.aboveFoldCta === "boolean") {
      const clear = input.hasClearCta === true;
      const fold = input.aboveFoldCta === true;
      const score = (clear ? 50 : 0) + (fold ? 50 : 0);
      dims.push({
        key: "cta", label: "Ясность CTA", weight: 0.15, score, maxRelUplift: 0.12,
        note: clear && fold ? "Чёткий CTA на первом экране." : `${clear ? "" : "Сделай один основной CTA с глаголом действия. "}${fold ? "" : "Подними CTA на первый экран."}`.trim() || "Усиль CTA.",
      });
    }
    // 6) Trust & social proof — 10%
    if (typeof input.hasSocialProof === "boolean" || typeof input.hasTrustSignals === "boolean") {
      const sp = input.hasSocialProof === true;
      const ts = input.hasTrustSignals === true;
      const score = (sp ? 50 : 0) + (ts ? 50 : 0);
      dims.push({
        key: "trust", label: "Доверие и соц. доказательства", weight: 0.1, score, maxRelUplift: 0.1,
        note: sp && ts ? "Есть отзывы и сигналы доверия." : `${sp ? "" : "Добавь отзывы/кейсы/логотипы. "}${ts ? "" : "Добавь гарантии, безопасность оплаты, контакты."}`.trim() || "Усиль доверие.",
      });
    }
    // 7) CR vs benchmark — 10%
    if (typeof input.conversionRatePct === "number" && typeof input.industryBenchmarkCRPct === "number" && input.industryBenchmarkCRPct > 0) {
      const ratio = input.conversionRatePct / input.industryBenchmarkCRPct;
      const score = clamp(ratio * 70, 0, 100); // at benchmark → 70 (room above), 1.43× → 100
      dims.push({
        key: "benchmark", label: "CR против бенчмарка", weight: 0.1, score, maxRelUplift: 0.12,
        note: ratio >= 1 ? `Выше бенчмарка (${round(ratio, 2)}×).` : `Ниже бенчмарка (${round(ratio * 100, 0)}% от ${input.industryBenchmarkCRPct}%) — есть потенциал роста.`,
      });
    }

    if (dims.length === 0) {
      return {
        content: [{ type: "text", text: "Ошибка: задай хотя бы один сигнал (loadTimeSec, bounceRatePct, formFields, hasClearCta, conversionRatePct+industryBenchmarkCRPct и т.д.)." }],
        isError: true,
      };
    }

    // Weighted score over the dimensions actually provided (renormalised weights).
    const totalWeight = dims.reduce((s, d) => s + d.weight, 0);
    const overall = dims.reduce((s, d) => s + (d.score as number) * (d.weight / totalWeight), 0);
    const grade = overall >= 90 ? "A" : overall >= 80 ? "B" : overall >= 70 ? "C" : overall >= 60 ? "D" : "F";

    // Prioritised issues (score < 75), ranked by weight × gap.
    const issues = dims
      .filter((d) => (d.score as number) < 75)
      .map((d) => ({
        dimension: d.label,
        score: round(d.score as number, 0),
        priority: round(d.weight * (100 - (d.score as number)), 1),
        fix: d.note,
      }))
      .sort((a, b) => b.priority - a.priority);

    // Projected uplift — multiplicative with diminishing returns: 1 − Π(1 − contrib_i).
    let prod = 1;
    for (const d of dims) {
      const contrib = d.maxRelUplift * (1 - (d.score as number) / 100);
      prod *= 1 - contrib;
    }
    const projectedRelUpliftPct = (1 - prod) * 100;

    let monetised: Record<string, unknown> | null = null;
    if (typeof input.conversionRatePct === "number") {
      const curCR = input.conversionRatePct / 100;
      const newCR = clamp(curCR * (1 + projectedRelUpliftPct / 100), 0, 1);
      const block: Record<string, unknown> = {
        currentCRPct: round(curCR * 100, 2),
        projectedCRPct: round(newCR * 100, 2),
      };
      if (typeof input.monthlyVisitors === "number" && input.monthlyVisitors > 0) {
        const curConv = input.monthlyVisitors * curCR;
        const newConv = input.monthlyVisitors * newCR;
        block.incrementalConversionsPerMonth = round(newConv - curConv);
        if (typeof input.aov === "number" && input.aov > 0) {
          block.incrementalRevenuePerMonth = round((newConv - curConv) * input.aov);
          block.incrementalRevenuePerYear = round((newConv - curConv) * input.aov * 12);
        }
      }
      monetised = block;
    }

    const top = issues.slice(0, 3).map((i) => i.dimension);
    const payload = {
      croScore: round(overall, 0),
      grade,
      dimensionsScored: dims.length,
      dimensions: dims.map((d) => ({ dimension: d.label, weightPct: round((d.weight / totalWeight) * 100, 0), score: round(d.score as number, 0), note: d.note })),
      prioritizedIssues: issues,
      projectedRelativeUpliftPct: round(projectedRelUpliftPct, 1),
      projection: monetised,
      verdict:
        `CRO-оценка ${round(overall, 0)}/100 (${grade}). ` +
        (issues.length ? `Главные точки роста: ${top.join(", ")}. ` : "Базовая гигиена в норме. ") +
        `Потенциал роста конверсии ~${round(projectedRelUpliftPct, 0)}% относительно текущей` +
        (monetised && (monetised as any).incrementalRevenuePerMonth != null ? ` (≈${ru((monetised as any).incrementalRevenuePerMonth)} ₽/мес).` : "."),
      methodology:
        "Каждое измерение оценивается 0-100 по эвристическим порогам и взвешивается (скорость 20%, отказы 15%, мобайл 15%, форма 15%, CTA 15%, доверие 10%, бенчмарк 10%); веса перенормируются по предоставленным данным. " +
        "Приоритет проблемы = вес × (100−оценка). Прогноз роста = 1 − Π(1 − maxUplift_i·(1−оценка_i/100)) — мультипликативно, с затуханием.",
      assumptions: [
        "Эвристические пороги — ориентир, не отраслевой стандарт для вашей ниши.",
        "Потенциал роста — верхняя оценка при качественном исполнении правок; фактический эффект подтверждается тестом.",
        "Измерения независимы (на практике частично коррелируют).",
      ],
      disclaimer: "Эвристический аудит — decision support. Подтверждайте гипотезы A/B-тестом (ab_test_planner → creative_testing_matrix), не гарантия.",
    };

    const summary =
      `CRO-аудит: ${round(overall, 0)}/100 (${grade}), оценено измерений: ${dims.length}. ` +
      (issues.length ? `Приоритет: ${top.join(", ")}. ` : "") +
      `Потенциал ~+${round(projectedRelUpliftPct, 0)}% к конверсии` +
      (monetised && (monetised as any).incrementalRevenuePerMonth != null ? ` (≈${ru((monetised as any).incrementalRevenuePerMonth)} ₽/мес).` : ".");

    return toContent(summary, payload);
  },
};

export const AUDIT_TOOLS: ToolDef[] = [marketingAudit, landingCroAudit];
