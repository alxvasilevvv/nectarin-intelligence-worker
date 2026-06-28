/**
 * EXPERIMENTATION tool group (v2.27) for NECTARIN Intelligence — Workers.
 *
 *   • geo_holdout — a geo-based incrementality (matched-market holdout) test tool.
 *       – DESIGN: from the expected baseline conversions in the test geos over the
 *         window and a target lift, returns the minimum detectable lift (MDE) and
 *         the baseline volume required to detect the target, plus a recommended test
 *         duration when a weekly baseline is given.
 *       – MEASURE: from observed test-geo conversions vs. a counterfactual (e.g.
 *         scaled control geos) it computes incremental conversions, lift %, a
 *         count-based z-test (Poisson), two-tailed p-value, significance, and the
 *         incremental CPA when the test spend is supplied.
 *
 * Standard count-data incrementality statistics, fully deterministic, on the
 * operator's OWN numbers. No LLM, no PII. Decision support, not a guarantee.
 */

import type { ToolDef, ToolResult } from "./tools.js";

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
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

function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
function invNorm(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pl = 0.02425;
  const ph = 1 - pl;
  let q: number;
  let r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= ph) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

const geoHoldout: ToolDef = {
  name: "geo_holdout",
  description:
    "Geo-based incrementality (matched-market holdout) test tool. DESIGN mode: from the expected baseline conversions in the test geos over the window and a target lift, returns the minimum detectable lift (MDE), the baseline volume required to detect the target lift, and a recommended test duration when a weekly baseline is given. MEASURE mode: from observed test-geo conversions vs. a counterfactual (e.g. scaled control geos), computes incremental conversions, lift %, a count-based (Poisson) z-test, two-tailed p-value, significance and the incremental CPA when test spend is given. Auto-detects mode. Deterministic count-data statistics on YOUR numbers — decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      testConversions: { type: "number", minimum: 0, description: "MEASURE: observed conversions in the test geos over the window" },
      counterfactualConversions: { type: "number", exclusiveMinimum: 0, description: "MEASURE: expected conversions without the campaign (e.g. from scaled control geos)" },
      testSpend: { type: "number", minimum: 0, description: "MEASURE: media spend in the test geos (for incremental CPA)" },
      baselineConversions: { type: "number", exclusiveMinimum: 0, description: "DESIGN: expected baseline conversions in the test geos over the window" },
      targetLiftPct: { type: "number", exclusiveMinimum: 0, description: "DESIGN: target lift to detect, %" },
      weeklyBaselineConversions: { type: "number", exclusiveMinimum: 0, description: "DESIGN: weekly baseline conversions (to recommend a duration)" },
      alpha: { type: "number", exclusiveMinimum: 0, maximum: 0.5, description: "Significance level (default 0.05)" },
      power: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1, description: "DESIGN: statistical power (default 0.8)" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const alpha = typeof input.alpha === "number" && input.alpha > 0 && input.alpha < 0.5 ? input.alpha : 0.05;
    const zA = invNorm(1 - alpha / 2);

    // ── MEASURE ───────────────────────────────────────────────────────────────
    if (typeof input.testConversions === "number" && typeof input.counterfactualConversions === "number" && input.counterfactualConversions > 0) {
      const test = Math.max(0, Number(input.testConversions));
      const counter = Number(input.counterfactualConversions);
      const incremental = test - counter;
      const liftPct = (incremental / counter) * 100;
      // Difference of two independent Poisson counts: Var = test + counter.
      const se = Math.sqrt(test + counter);
      const z = se > 0 ? incremental / se : 0;
      const pValue = 2 * (1 - normalCdf(Math.abs(z)));
      const significant = pValue < alpha;
      const ciLow = incremental - zA * se;
      const ciHigh = incremental + zA * se;
      const spend = typeof input.testSpend === "number" && input.testSpend >= 0 ? Number(input.testSpend) : null;
      const iCpa = spend != null && incremental > 0 ? spend / incremental : null;

      const payload = {
        mode: "measure",
        alpha,
        testConversions: round(test),
        counterfactualConversions: round(counter),
        incrementalConversions: round(incremental),
        liftPct: round(liftPct, 1),
        zScore: round(z, 3),
        pValue: round(pValue, 4),
        significant,
        incrementalCi: [round(ciLow), round(ciHigh)],
        incrementalCpa: iCpa != null ? round(iCpa) : null,
        verdict: significant
          ? `Значимый инкремент: +${round(incremental)} конверсий (${liftPct >= 0 ? "+" : ""}${round(liftPct, 1)}%, p=${round(pValue, 4)}).`
          : `Инкремент статистически НЕ значим (p=${round(pValue, 4)} ≥ α=${alpha}) — слабый эффект или мало данных.`,
        methodology:
          "Incremental = test − counterfactual. Counts ~ Poisson ⇒ Var(diff)=test+counter; z=incremental/√(test+counter); two-tailed p=2(1−Φ(|z|)).",
        assumptions: [
          "Контрольные гео корректно отражают контрфактический сценарий (matched markets).",
          "Конверсии — счётные (Пуассон); нет утечки воздействия в контроль и резких внешних шоков.",
        ],
        disclaimer: "Оценка инкрементальности на ВАШИХ данных, не гарантия причинности. Контролируйте дизайн гео-теста.",
      };
      const summary = `Гео-холдаут (замер): тест ${round(test)} vs контрфакт ${round(counter)} ⇒ инкремент ${round(incremental)} (${round(liftPct, 1)}%). ${payload.verdict}${iCpa != null ? ` iCPA ${round(iCpa)} ₽.` : ""}`;
      return toContent(summary, payload);
    }

    // ── DESIGN ────────────────────────────────────────────────────────────────
    const baseline = typeof input.baselineConversions === "number" ? Number(input.baselineConversions) : null;
    if (baseline != null && baseline > 0) {
      const power = typeof input.power === "number" && input.power > 0 && input.power < 1 ? input.power : 0.8;
      const zB = invNorm(power);
      // Test vs matched control of similar size ⇒ relative SE ≈ sqrt(2/baseline) for Poisson counts.
      const mdeFraction = (zA + zB) * Math.sqrt(2 / baseline);
      const mdePct = mdeFraction * 100;

      let targetInfo: Record<string, unknown> | null = null;
      if (typeof input.targetLiftPct === "number" && input.targetLiftPct > 0) {
        const liftFraction = input.targetLiftPct / 100;
        const requiredBaseline = Math.ceil(2 * ((zA + zB) / liftFraction) ** 2);
        const detectable = baseline >= requiredBaseline;
        let recommendedWeeks: number | null = null;
        if (typeof input.weeklyBaselineConversions === "number" && input.weeklyBaselineConversions > 0) {
          recommendedWeeks = Math.ceil(requiredBaseline / input.weeklyBaselineConversions);
        }
        targetInfo = {
          targetLiftPct: round(input.targetLiftPct, 1),
          requiredBaselineConversions: requiredBaseline,
          detectableAtPlannedBaseline: detectable,
          recommendedWeeks,
        };
      }

      const payload = {
        mode: "design",
        alpha,
        power,
        plannedBaselineConversions: round(baseline),
        minimumDetectableLiftPct: round(mdePct, 1),
        target: targetInfo,
        methodology:
          "Poisson counts, test vs matched control (~equal size): MDE(rel) = (z_{1−α/2}+z_power)·√(2/baseline). Required baseline for a target lift L = 2·((z_{1−α/2}+z_power)/L)².",
        assumptions: [
          "Контроль сопоставим по размеру с тестом; конверсии ~ Пуассон.",
          "Без утечки воздействия и сильных внешних шоков в окне теста.",
        ],
        disclaimer: "Плановый расчёт чувствительности, не гарантия. Реальная мощность зависит от подбора гео и шумов.",
      };
      const summary =
        `Гео-холдаут (дизайн): при базе ${round(baseline)} конверсий MDE ≈ ${round(mdePct, 1)}% (α=${alpha}, power=${power}).` +
        (targetInfo
          ? ` Для +${targetInfo.targetLiftPct}% нужно ~${targetInfo.requiredBaselineConversions} конверсий${targetInfo.recommendedWeeks ? ` (~${targetInfo.recommendedWeeks} нед.)` : ""}; ${targetInfo.detectableAtPlannedBaseline ? "план достаточен." : "плана НЕ хватает."}`
          : "");
      return toContent(summary, payload);
    }

    return {
      content: [
        {
          type: "text",
          text: "Ошибка: для замера передай testConversions + counterfactualConversions; для дизайна — baselineConversions (+ опц. targetLiftPct, weeklyBaselineConversions).",
        },
      ],
      isError: true,
    };
  },
};

export const EXPERIMENTATION_TOOLS: ToolDef[] = [geoHoldout];
