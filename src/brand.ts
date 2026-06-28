/**
 * BRAND tool group (v2.23) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • brand_lift — a brand-lift study calculator for Брендинг. Two modes:
 *       – MEASURE: from a control vs. exposed survey cell (n + positive answers for
 *         a brand metric — ad recall / awareness / consideration / intent) it
 *         computes both rates, the absolute (pp) and relative lift, a pooled
 *         two-proportion z-test (z, two-tailed p-value, significance at α) and a
 *         confidence interval for the absolute lift.
 *       – DESIGN: from a base rate + a target lift (absolute pp or relative %),
 *         α and power, it returns the required sample size PER CELL (and total).
 *
 * Classic survey statistics, fully deterministic, on the operator's OWN study
 * numbers. No LLM, no PII. Decision support, not a guarantee.
 */

import type { ToolDef, ToolResult } from "./tools.js";

function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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

/** Standard normal CDF via the Abramowitz–Stegun erf approximation. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Acklam's algorithm). */
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

interface Cell {
  n: number;
  positive: number;
}

const brandLift: ToolDef = {
  name: "brand_lift",
  description:
    "Brand-lift study calculator for Брендинг. MEASURE mode: from a control vs. exposed survey cell (n + positive answers for a brand metric — ad recall / awareness / consideration / intent) computes both rates, the absolute (pp) and relative lift, a pooled two-proportion z-test (z, two-tailed p-value, significance at α) and a confidence interval for the absolute lift. DESIGN mode: from a base rate + target lift (absolute pp or relative %), α and power, returns the required sample size PER CELL and total. Auto-detects mode from inputs. Deterministic survey statistics on YOUR numbers — decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      metric: { type: "string", description: "Brand metric label, e.g. 'ad recall' / 'awareness' / 'consideration' / 'intent'" },
      control: {
        type: "object",
        description: "MEASURE mode: unexposed/control cell",
        properties: {
          n: { type: "number", exclusiveMinimum: 0, description: "Respondents in control cell" },
          positive: { type: "number", minimum: 0, description: "Positive answers in control cell" },
        },
        required: ["n", "positive"],
        additionalProperties: false,
      },
      exposed: {
        type: "object",
        description: "MEASURE mode: exposed cell",
        properties: {
          n: { type: "number", exclusiveMinimum: 0, description: "Respondents in exposed cell" },
          positive: { type: "number", minimum: 0, description: "Positive answers in exposed cell" },
        },
        required: ["n", "positive"],
        additionalProperties: false,
      },
      baseRatePct: { type: "number", minimum: 0, maximum: 100, description: "DESIGN mode: expected control rate, %" },
      targetAbsoluteLiftPp: { type: "number", exclusiveMinimum: 0, description: "DESIGN mode: target absolute lift in percentage points" },
      targetRelativeLiftPct: { type: "number", exclusiveMinimum: 0, description: "DESIGN mode: target relative lift, % of base (alt to absolute)" },
      alpha: { type: "number", exclusiveMinimum: 0, maximum: 0.5, description: "Significance level (default 0.05)" },
      power: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1, description: "DESIGN mode: statistical power (default 0.8)" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const alpha = typeof input.alpha === "number" && input.alpha > 0 && input.alpha < 0.5 ? input.alpha : 0.05;
    const metric = input.metric ? String(input.metric) : "brand metric";
    const control = input.control as Cell | undefined;
    const exposed = input.exposed as Cell | undefined;

    // ── MEASURE mode ──────────────────────────────────────────────────────────
    if (control && exposed && control.n > 0 && exposed.n > 0) {
      const n1 = Number(control.n);
      const x1 = clamp(Number(control.positive), 0, n1);
      const n2 = Number(exposed.n);
      const x2 = clamp(Number(exposed.positive), 0, n2);
      const p1 = x1 / n1;
      const p2 = x2 / n2;
      const absLift = p2 - p1;
      const relLift = p1 > 0 ? absLift / p1 : null;

      const pPool = (x1 + x2) / (n1 + n2);
      const sePool = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
      const z = sePool > 0 ? absLift / sePool : 0;
      const pValue = 2 * (1 - normalCdf(Math.abs(z)));
      const significant = pValue < alpha;

      const seDiff = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2);
      const zCrit = invNorm(1 - alpha / 2);
      const ciLow = absLift - zCrit * seDiff;
      const ciHigh = absLift + zCrit * seDiff;

      const payload = {
        mode: "measure",
        metric,
        alpha,
        control: { n: n1, positive: x1, ratePct: round(p1 * 100, 1) },
        exposed: { n: n2, positive: x2, ratePct: round(p2 * 100, 1) },
        absoluteLiftPp: round(absLift * 100, 2),
        relativeLiftPct: relLift != null ? round(relLift * 100, 1) : null,
        zScore: round(z, 3),
        pValue: round(pValue, 4),
        significant,
        confidence: round((1 - alpha) * 100, 0),
        absoluteLiftCiPp: [round(ciLow * 100, 2), round(ciHigh * 100, 2)],
        verdict: significant
          ? `Значимый прирост ${metric}: +${round(absLift * 100, 1)} п.п. (p=${round(pValue, 4)} < α=${alpha}).`
          : `Прирост ${metric} статистически НЕ значим (p=${round(pValue, 4)} ≥ α=${alpha}) — нужна бо́льшая выборка или эффект слабый.`,
        methodology:
          "Pooled two-proportion z-test: z=(p₂−p₁)/√(p̄(1−p̄)(1/n₁+1/n₂)); two-tailed p=2(1−Φ(|z|)); CI на разность по несгруппированной SE.",
        assumptions: [
          "Случайное распределение по ячейкам, независимые ответы, корректный замер метрики.",
          "Двусторонний тест; одна метрика за раз (при множественных — поправка на множественность).",
        ],
        disclaimer: "Статистика на ВАШИХ данных опроса, не гарантия причинности. Контролируйте дизайн исследования.",
      };

      const summary = `Brand lift «${metric}»: контроль ${round(p1 * 100, 1)}% → экспонир. ${round(p2 * 100, 1)}% (${absLift >= 0 ? "+" : ""}${round(absLift * 100, 1)} п.п.${relLift != null ? `, отн. ${relLift >= 0 ? "+" : ""}${round(relLift * 100, 0)}%` : ""}). ${payload.verdict}`;
      return toContent(summary, payload);
    }

    // ── DESIGN mode ───────────────────────────────────────────────────────────
    const baseRate = typeof input.baseRatePct === "number" ? clamp(input.baseRatePct, 0, 100) / 100 : null;
    if (baseRate != null) {
      const power = typeof input.power === "number" && input.power > 0 && input.power < 1 ? input.power : 0.8;
      let absLift: number | null = null;
      if (typeof input.targetAbsoluteLiftPp === "number" && input.targetAbsoluteLiftPp > 0) {
        absLift = input.targetAbsoluteLiftPp / 100;
      } else if (typeof input.targetRelativeLiftPct === "number" && input.targetRelativeLiftPct > 0) {
        absLift = baseRate * (input.targetRelativeLiftPct / 100);
      }
      if (absLift == null || absLift <= 0) {
        return {
          content: [
            { type: "text", text: "Ошибка (design): укажи targetAbsoluteLiftPp или targetRelativeLiftPct (> 0)." },
          ],
          isError: true,
        };
      }
      const p1 = baseRate;
      const p2 = clamp(baseRate + absLift, 0, 1);
      const zA = invNorm(1 - alpha / 2);
      const zB = invNorm(power);
      const num = (zA + zB) ** 2 * (p1 * (1 - p1) + p2 * (1 - p2));
      const den = (p2 - p1) ** 2;
      const nPerCell = Math.ceil(num / den);

      const payload = {
        mode: "design",
        metric,
        alpha,
        power,
        baseRatePct: round(p1 * 100, 1),
        targetExposedRatePct: round(p2 * 100, 1),
        targetAbsoluteLiftPp: round(absLift * 100, 2),
        targetRelativeLiftPct: round((absLift / p1) * 100, 1),
        requiredSamplePerCell: nPerCell,
        requiredSampleTotal: nPerCell * 2,
        methodology:
          "n/cell = (z_{1−α/2}+z_{power})²·(p₁(1−p₁)+p₂(1−p₂)) / (p₂−p₁)²; two cells (control + exposed).",
        assumptions: [
          "Двусторонний тест, равные ячейки, простая случайная выборка.",
          "Реальная мощность зависит от фактического базового уровня и эффекта.",
        ],
        disclaimer: "Плановый расчёт выборки, не гарантия. Заложите запас на неответы/брак.",
      };

      const summary = `Дизайн brand-lift «${metric}»: для +${round(absLift * 100, 1)} п.п. от базы ${round(p1 * 100, 1)}% при α=${alpha}, power=${power} нужно ~${nPerCell} респондентов на ячейку (всего ~${nPerCell * 2}).`;
      return toContent(summary, payload);
    }

    return {
      content: [
        {
          type: "text",
          text: "Ошибка: для замера передай control{n,positive} и exposed{n,positive}; для дизайна — baseRatePct + targetAbsoluteLiftPp (или targetRelativeLiftPct).",
        },
      ],
      isError: true,
    };
  },
};

export const BRAND_TOOLS: ToolDef[] = [brandLift];
