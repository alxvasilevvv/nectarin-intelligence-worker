/**
 * PLANNING tool group — scenario_planner (v2.16) for NECTARIN Intelligence.
 *
 *   • scenario_planner — a what-if budget comparator for the boardroom. Given the
 *     CURRENT per-channel spend & conversions and a set of named scenarios
 *     (conservative / base / aggressive, or any custom plans), it projects each
 *     scenario's conversions, blended CPA, incremental conversions vs. today and —
 *     when a revenue-per-conversion is supplied — revenue, profit, ROAS and ROI%.
 *     Each channel is modelled with a constant-elasticity diminishing-returns curve
 *     conversions(s) = conv₀·(s/s₀)^b, calibrated to that channel's own current
 *     point (s₀, conv₀); b defaults to 0.7 and is per-channel overridable. Scenarios
 *     are ranked by the chosen objective and one is recommended with a rationale +
 *     an elasticity sensitivity note.
 *
 * Distinct from mmm_optimize (which FITS the optimal split from a time series) and
 * budget_optimizer (which allocates a single budget): this tool compares the
 * operator's OWN candidate plans head-to-head. Deterministic; uses the operator's
 * numbers, not benchmarks; no LLM, no PII. Decision support, not a guarantee.
 */

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

const DEFAULT_ELASTICITY = 0.7;

interface ChannelIn {
  name: string;
  currentSpend: number;
  currentConversions: number;
  elasticity?: number;
}
interface ScenarioIn {
  name: string;
  budgetMultiplier?: number;
  overrides?: Array<{ name: string; spend: number }>;
}

/** conversions(s) = conv₀·(s/s₀)^b, calibrated to the channel's current point. */
function projectConversions(currentSpend: number, currentConv: number, newSpend: number, b: number): number {
  if (currentSpend <= 0 || currentConv <= 0 || newSpend <= 0) return 0;
  return currentConv * Math.pow(newSpend / currentSpend, b);
}

/** Marginal conversions per extra RUB at `newSpend` (derivative of the curve). */
function marginalConvPerRub(currentSpend: number, currentConv: number, newSpend: number, b: number): number {
  if (currentSpend <= 0 || currentConv <= 0 || newSpend <= 0) return 0;
  // d/ds [conv₀·(s/s₀)^b] = conv₀·b·s^{b-1}/s₀^b
  return (currentConv * b * Math.pow(newSpend, b - 1)) / Math.pow(currentSpend, b);
}

interface EvaluatedChannel {
  name: string;
  spend: number;
  conversions: number;
  cpa: number | null;
  marginalCPA: number | null;
  elasticity: number;
  spendDeltaPct: number | null;
  uncalibrated: boolean;
}
interface EvaluatedScenario {
  name: string;
  isBaseline: boolean;
  totalSpend: number;
  totalConversions: number;
  blendedCPA: number | null;
  channels: EvaluatedChannel[];
  incrementalConversions: number;
  incrementalSpend: number;
  incrementalCPA: number | null;
  revenue?: number;
  profit?: number;
  roas?: number;
  roiPct?: number;
}

type Objective = "max_conversions" | "min_cpa" | "max_roi";

function evaluateScenario(
  scn: ScenarioIn,
  channels: ChannelIn[],
  defaultB: number,
  isBaseline: boolean,
  revenuePerConversion: number | null,
): EvaluatedScenario {
  const mult = scn.budgetMultiplier != null && scn.budgetMultiplier > 0 ? scn.budgetMultiplier : 1;
  const overrideMap = new Map<string, number>();
  for (const o of scn.overrides ?? []) overrideMap.set(o.name, o.spend);

  const evChannels: EvaluatedChannel[] = channels.map((c) => {
    const b = c.elasticity != null && c.elasticity > 0 ? clamp(c.elasticity, 0.01, 1) : defaultB;
    const newSpend = overrideMap.has(c.name) ? Number(overrideMap.get(c.name)) : c.currentSpend * mult;
    const conv = projectConversions(c.currentSpend, c.currentConversions, newSpend, b);
    const marg = marginalConvPerRub(c.currentSpend, c.currentConversions, newSpend, b);
    const uncalibrated = c.currentSpend > 0 && c.currentConversions <= 0 && newSpend > 0;
    return {
      name: c.name,
      spend: round(newSpend),
      conversions: round(conv, 1),
      cpa: conv > 0 ? round(newSpend / conv) : null,
      marginalCPA: marg > 0 ? round(1 / marg) : null,
      elasticity: round(b, 2),
      spendDeltaPct: c.currentSpend > 0 ? round(((newSpend - c.currentSpend) / c.currentSpend) * 100, 1) : null,
      uncalibrated,
    };
  });

  const totalSpend = evChannels.reduce((s, c) => s + c.spend, 0);
  const totalConversions = evChannels.reduce((s, c) => s + c.conversions, 0);
  const out: EvaluatedScenario = {
    name: scn.name,
    isBaseline,
    totalSpend: round(totalSpend),
    totalConversions: round(totalConversions, 1),
    blendedCPA: totalConversions > 0 ? round(totalSpend / totalConversions) : null,
    channels: evChannels,
    incrementalConversions: 0,
    incrementalSpend: 0,
    incrementalCPA: null,
  };

  if (revenuePerConversion != null && revenuePerConversion > 0) {
    const revenue = totalConversions * revenuePerConversion;
    const profit = revenue - totalSpend;
    out.revenue = round(revenue);
    out.profit = round(profit);
    out.roas = totalSpend > 0 ? round(revenue / totalSpend, 2) : null as unknown as number;
    out.roiPct = totalSpend > 0 ? round((profit / totalSpend) * 100, 1) : null as unknown as number;
  }
  return out;
}

const scenarioPlanner: ToolDef = {
  name: "scenario_planner",
  description:
    "What-if budget scenario comparator. Takes CURRENT per-channel spend & conversions plus named scenarios (e.g. conservative/base/aggressive, via a budgetMultiplier and/or absolute per-channel spend overrides) and projects each scenario's conversions, blended CPA, incremental conversions vs. today, and — if revenuePerConversion is given — revenue, profit, ROAS and ROI%. Each channel uses a constant-elasticity diminishing-returns curve conversions=conv₀·(spend/spend₀)^b calibrated to its own current point (b default 0.7, per-channel overridable). Ranks scenarios by objective (max_conversions | min_cpa | max_roi), recommends one with a rationale and an elasticity-sensitivity note. Uses YOUR numbers — deterministic decision support, not benchmarks. Complements mmm_optimize (optimal split) / budget_optimizer (single-budget allocation): this compares YOUR candidate plans head-to-head.",
  inputSchema: {
    type: "object",
    properties: {
      channels: {
        type: "array",
        minItems: 1,
        description: "Current state per channel (the calibration point)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name" },
            currentSpend: { type: "number", exclusiveMinimum: 0, description: "Current spend (RUB)" },
            currentConversions: { type: "number", minimum: 0, description: "Current conversions at that spend" },
            elasticity: {
              type: "number",
              exclusiveMinimum: 0,
              maximum: 1,
              description: "Optional saturation elasticity b (0<b≤1). Lower = faster diminishing returns. Default 0.7.",
            },
          },
          required: ["name", "currentSpend", "currentConversions"],
          additionalProperties: false,
        },
      },
      scenarios: {
        type: "array",
        minItems: 1,
        description: "Candidate plans to compare (a 'Текущий' baseline is added automatically)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Scenario label, e.g. 'Консервативный', 'Базовый', 'Агрессивный'" },
            budgetMultiplier: {
              type: "number",
              exclusiveMinimum: 0,
              description: "Scale every non-overridden channel's current spend by this factor (e.g. 0.8, 1.0, 1.5).",
            },
            overrides: {
              type: "array",
              description: "Absolute per-channel spend overrides (RUB) for this scenario",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  spend: { type: "number", minimum: 0 },
                },
                required: ["name", "spend"],
                additionalProperties: false,
              },
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
      objective: {
        type: "string",
        enum: ["max_conversions", "min_cpa", "max_roi"],
        description: "Ranking objective. Default max_conversions. max_roi requires revenuePerConversion.",
      },
      revenuePerConversion: {
        type: "number",
        exclusiveMinimum: 0,
        description: "Average revenue per conversion (RUB) — enables revenue/profit/ROAS/ROI and the max_roi objective.",
      },
      defaultElasticity: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: 1,
        description: "Default saturation elasticity b for channels without their own (0<b≤1). Default 0.7.",
      },
    },
    required: ["channels", "scenarios"],
    additionalProperties: false,
  },
  async handler(input) {
    const channels = (input.channels ?? []) as ChannelIn[];
    const scenarios = (input.scenarios ?? []) as ScenarioIn[];
    const defaultB =
      typeof input.defaultElasticity === "number" && input.defaultElasticity > 0
        ? clamp(input.defaultElasticity, 0.01, 1)
        : DEFAULT_ELASTICITY;
    const revenuePerConversion =
      typeof input.revenuePerConversion === "number" && input.revenuePerConversion > 0
        ? input.revenuePerConversion
        : null;
    let objective = (input.objective as Objective) ?? "max_conversions";

    const warnings: string[] = [];
    if (objective === "max_roi" && revenuePerConversion == null) {
      warnings.push("Цель max_roi требует revenuePerConversion — переключаюсь на max_conversions.");
      objective = "max_conversions";
    }

    // Baseline = current state (multiplier 1, no overrides), always first.
    const baseline = evaluateScenario(
      { name: "Текущий" },
      channels,
      defaultB,
      true,
      revenuePerConversion,
    );
    const evaluated = scenarios.map((s) =>
      evaluateScenario(s, channels, defaultB, false, revenuePerConversion),
    );

    // Deltas vs baseline.
    for (const e of [baseline, ...evaluated]) {
      e.incrementalConversions = round(e.totalConversions - baseline.totalConversions, 1);
      e.incrementalSpend = round(e.totalSpend - baseline.totalSpend);
      e.incrementalCPA =
        e.incrementalConversions > 0 ? round(e.incrementalSpend / e.incrementalConversions) : null;
      if (e.channels.some((c) => c.uncalibrated)) {
        warnings.push(
          `Сценарий «${e.name}»: есть каналы с нулевыми текущими конверсиями — кривую отдачи откалибровать нельзя, их вклад принят за 0.`,
        );
      }
    }

    // Rank candidates (user scenarios + baseline) by objective.
    const candidates = [baseline, ...evaluated];
    const score = (e: EvaluatedScenario): number => {
      if (objective === "min_cpa") return e.blendedCPA == null ? Number.POSITIVE_INFINITY : e.blendedCPA;
      if (objective === "max_roi") return -(e.profit ?? Number.NEGATIVE_INFINITY);
      return -e.totalConversions; // max_conversions
    };
    const ranked = [...candidates]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => {
        const d = score(a.e) - score(b.e);
        return d !== 0 ? d : a.i - b.i;
      })
      .map((x) => x.e);
    const best = ranked[0];

    // Elasticity sensitivity: re-evaluate the recommended scenario at b=0.5 and b=0.9.
    const recScnIn: ScenarioIn = best.isBaseline
      ? { name: "Текущий" }
      : scenarios[evaluated.indexOf(best)] ?? { name: best.name };
    const sensitivity = [0.5, 0.9].map((b) => {
      const e = evaluateScenario(recScnIn, channels, b, best.isBaseline, revenuePerConversion);
      return { elasticity: b, projectedConversions: e.totalConversions, blendedCPA: e.blendedCPA };
    });

    const objLabel =
      objective === "min_cpa" ? "минимум blended CPA" : objective === "max_roi" ? "максимум прибыли (ROI)" : "максимум конверсий";

    const rationaleParts: string[] = [
      `Цель ранжирования: ${objLabel}.`,
      `Победитель «${best.name}»: ${ru(best.totalConversions)} конв. при бюджете ${ru(best.totalSpend)} ₽` +
        (best.blendedCPA != null ? `, blended CPA ${ru(best.blendedCPA)} ₽` : "") +
        (best.roiPct != null ? `, ROI ${best.roiPct}%` : "") +
        ".",
    ];
    if (!best.isBaseline && best.incrementalConversions !== 0) {
      rationaleParts.push(
        `Против текущего: ${best.incrementalConversions >= 0 ? "+" : ""}${ru(best.incrementalConversions)} конв. за ` +
          `${best.incrementalSpend >= 0 ? "+" : ""}${ru(best.incrementalSpend)} ₽` +
          (best.incrementalCPA != null ? ` (предельный CPA доп.объёма ~${ru(best.incrementalCPA)} ₽).` : "."),
      );
    }

    const payload = {
      objective,
      currency: "RUB",
      model: "constant-elasticity diminishing returns: conversions(s) = conv₀·(s/s₀)^b, calibrated per channel",
      defaultElasticity: round(defaultB, 2),
      revenuePerConversion,
      baseline: {
        name: baseline.name,
        totalSpend: baseline.totalSpend,
        totalConversions: baseline.totalConversions,
        blendedCPA: baseline.blendedCPA,
      },
      scenarios: candidates,
      ranking: ranked.map((e, i) => ({
        rank: i + 1,
        name: e.name,
        totalSpend: e.totalSpend,
        totalConversions: e.totalConversions,
        blendedCPA: e.blendedCPA,
        incrementalConversions: e.incrementalConversions,
        profit: e.profit ?? null,
        roiPct: e.roiPct ?? null,
        recommended: i === 0,
      })),
      recommendation: {
        scenario: best.name,
        rationale: rationaleParts.join(" "),
        elasticitySensitivity: sensitivity,
      },
      warnings,
      assumptions: [
        "Каждый канал моделируется кривой убывающей отдачи conversions=conv₀·(spend/spend₀)^b, откалиброванной по его текущей точке (spend₀, conv₀).",
        `Эластичность b по умолчанию ${round(defaultB, 2)} (можно задать на канал); ниже b — быстрее убывает отдача.`,
        "Прогноз — экстраполяция от одной точки: чем дальше новый бюджет от текущего, тем выше неопределённость (см. elasticitySensitivity).",
      ],
      disclaimer:
        "Модельная оценка на ВАШИХ числах, не реальные бенчмарки и не гарантия. Кривая отдачи калибруется по одной текущей точке — используйте как support для сравнения вариантов, а не как точный прогноз.",
    };

    const summary =
      `Сравнение ${candidates.length} сценариев (вкл. текущий) по цели «${objLabel}». ` +
      `Рекомендация: «${best.name}» — ${ru(best.totalConversions)} конв.` +
      (best.blendedCPA != null ? `, blended CPA ${ru(best.blendedCPA)} ₽` : "") +
      (best.roiPct != null ? `, ROI ${best.roiPct}%` : "") +
      `, бюджет ${ru(best.totalSpend)} ₽.`;

    return toContent(summary, payload);
  },
};

export const SCENARIO_TOOLS: ToolDef[] = [scenarioPlanner];
