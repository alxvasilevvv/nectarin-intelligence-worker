/**
 * COMPETITIVE tool group (v2.30) for NECTARIN Intelligence — Workers.
 *
 *   • competitive_response — simulate the impact of a competitor's spend move
 *     (escalation, new entrant, or pullback) on YOUR Share of Voice, auction CPM
 *     and effective impressions, then size the defensive budget needed to hold
 *     SOV and recommend a response posture.
 *
 * Deterministic auction/share dynamics on the operator's OWN spend numbers.
 * No LLM, no PII. Directional decision support, not a guarantee.
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

const ACTIONS = ["spend_escalation", "new_entrant", "pullback"] as const;

const competitiveResponse: ToolDef = {
  name: "competitive_response",
  description:
    "Competitive war-game simulator. Given your spend, the current competitor spend and a competitor move (spend escalation %, a new entrant, or a pullback), it models the impact on your Share of Voice (SOV), auction CPM inflation and effective impressions at a fixed budget — then sizes the defensive budget needed to hold your SOV (or a target SOV) and recommends a response posture (hold / partial match / defend or pivot). Deterministic auction-share dynamics on YOUR numbers — directional decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      yourSpend: { type: "number", exclusiveMinimum: 0, description: "Your current advertising spend (₽)" },
      competitorSpend: { type: "number", minimum: 0, description: "Current total competitor spend in the auction/category (₽)" },
      competitorIncreasePct: { type: "number", description: "Competitor's planned spend change, % (e.g. 50 = +50%; negative = pullback)" },
      action: { type: "string", enum: ACTIONS as unknown as string[], description: "Move type (qualitative label; default spend_escalation)" },
      cpmSensitivity: { type: "number", minimum: 0, maximum: 2, description: "CPM inflation per 1.0 of relative market-spend growth (default 0.3)" },
      targetSovPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "SOV you want to defend, % (default = your current SOV)" },
    },
    required: ["yourSpend", "competitorSpend", "competitorIncreasePct"],
    additionalProperties: false,
  },
  async handler(input) {
    const yourSpend = Number(input.yourSpend);
    const competitorSpend = Math.max(0, Number(input.competitorSpend));
    const incr = Number(input.competitorIncreasePct);
    const action = ACTIONS.includes(input.action) ? (input.action as string) : "spend_escalation";
    const cpmSensitivity = typeof input.cpmSensitivity === "number" && input.cpmSensitivity >= 0 ? Math.min(2, input.cpmSensitivity) : 0.3;

    const totalBefore = yourSpend + competitorSpend;
    const sovBefore = (yourSpend / totalBefore) * 100;
    const compAfter = Math.max(0, competitorSpend * (1 + incr / 100));
    const totalAfter = yourSpend + compAfter;
    const sovAfter = (yourSpend / totalAfter) * 100;
    const sovErosionPp = sovBefore - sovAfter;

    const marketGrowth = (totalAfter - totalBefore) / totalBefore; // relative
    const cpmInflationPct = cpmSensitivity * marketGrowth * 100;
    // At a fixed budget, impressions scale with 1/CPM.
    const impressionImpactPct = (1 / (1 + cpmInflationPct / 100) - 1) * 100;

    const targetSov = typeof input.targetSovPct === "number" ? clamp(input.targetSovPct, 0.01, 99.99) : sovBefore;
    const t = targetSov / 100;
    // Solve y/(y+compAfter)=t ⇒ y = t·compAfter/(1−t).
    const requiredYourSpend = t < 1 ? (t * compAfter) / (1 - t) : Infinity;
    const additionalSpendToDefend = Number.isFinite(requiredYourSpend) ? Math.max(0, requiredYourSpend - yourSpend) : null;
    const defenseBudgetIncreasePct = additionalSpendToDefend != null ? (additionalSpendToDefend / yourSpend) * 100 : null;

    const posture =
      sovErosionPp < 2 ? "hold" : sovErosionPp <= 5 ? "partial_match" : "defend_or_pivot";
    const recommendation =
      posture === "hold"
        ? "Эрозия SOV незначительна — держи план, мониторь аукцион (pacing_monitor) и эффективность (bid_simulator)."
        : posture === "partial_match"
          ? `Заметная эрозия ${round(sovErosionPp, 1)} п.п. — частично сматчи давление и догони эффективностью: подними бюджет к ~${additionalSpendToDefend != null ? ru(round(additionalSpendToDefend)) : "—"} ₽ доп. и оптимизируй ставки/каналы (budget_optimizer, bid_simulator).`
          : `Сильная эрозия ${round(sovErosionPp, 1)} п.п. — либо защищай SOV (≈+${additionalSpendToDefend != null ? ru(round(additionalSpendToDefend)) : "—"} ₽), либо уходи от лобовой войны: дешёвый инвентарь (supplier_quality), дифференциация (creative_variants), бренд-капитал (brand_lift, sov_tracker).`;

    const payload = {
      action,
      cpmSensitivity,
      sovBeforePct: round(sovBefore, 1),
      sovAfterPct: round(sovAfter, 1),
      sovErosionPp: round(sovErosionPp, 1),
      marketSpendGrowthPct: round(marketGrowth * 100, 1),
      cpmInflationPct: round(cpmInflationPct, 1),
      effectiveImpressionImpactPct: round(impressionImpactPct, 1),
      defense: {
        targetSovPct: round(targetSov, 1),
        requiredYourSpend: Number.isFinite(requiredYourSpend) ? round(requiredYourSpend) : null,
        additionalSpendToDefend: additionalSpendToDefend != null ? round(additionalSpendToDefend) : null,
        defenseBudgetIncreasePct: defenseBudgetIncreasePct != null ? round(defenseBudgetIncreasePct, 1) : null,
      },
      posture,
      recommendation,
      methodology:
        "SOV = spend share of the auction/category. После хода: SOV' = your/(your+comp'). CPM-инфляция ≈ sensitivity × относительный рост суммарного спенда; при фиксированном бюджете показы ∝ 1/CPM. Защитный бюджет: y = t·comp'/(1−t) для целевого SOV t.",
      assumptions: [
        "SOV аппроксимируется долей спенда (без учёта качества ставок/таргета).",
        "CPM-инфляция — линейная эвристика от давления в аукционе; калибруйте sensitivity под категорию.",
        "Учитываются только спенды; ценовые/промо-ходы конкурента моделируй отдельно (price_optimizer, promo_planner).",
      ],
      disclaimer: "Директивная симуляция, не гарантия. Реальная динамика зависит от аукциона, креатива и ценностного предложения.",
    };

    const summary =
      `Ход конкурента (${action}, ${incr >= 0 ? "+" : ""}${round(incr, 0)}%): SOV ${round(sovBefore, 1)}% → ${round(sovAfter, 1)}% (−${round(sovErosionPp, 1)} п.п.), CPM ${cpmInflationPct >= 0 ? "+" : ""}${round(cpmInflationPct, 1)}%, показы ${round(impressionImpactPct, 1)}%. ` +
      (additionalSpendToDefend != null ? `Защита SOV ${round(targetSov, 1)}%: +${ru(round(additionalSpendToDefend))} ₽. ` : "") +
      `Рекомендация: ${posture}.`;

    return toContent(summary, payload);
  },
};

export const COMPETITIVE_TOOLS: ToolDef[] = [competitiveResponse];
