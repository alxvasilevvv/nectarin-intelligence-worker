/**
 * EXECUTIVE tool group (v2.18) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • board_report — a one-call executive one-pager. It ORCHESTRATES two existing
 *     tools — marketing_audit (health score, channel verdicts, risks, prioritized
 *     actions) and scenario_planner (a +15% budget upside scenario) — and folds
 *     their structured output into a board-ready brief: status & grade, the headline
 *     metrics (spend, conversions, blended CPA, and revenue/profit/ROI when a
 *     revenue-per-conversion is supplied), best/worst channel, the live risks, the
 *     top recommendations, the budget upside and a single next step.
 *
 * Composition over duplication: reuses the deterministic sub-tools verbatim, so the
 * one-pager stays consistent with `marketing_audit` / `scenario_planner`. No LLM,
 * no PII. Decision support on the operator's own numbers — not a guarantee.
 */

import { CATEGORIES } from "./data.js";
import { AUDIT_TOOLS } from "./audit.js";
import { SCENARIO_TOOLS } from "./scenario.js";
import type { ToolDef, ToolResult } from "./tools.js";

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

const auditTool = AUDIT_TOOLS.find((t) => t.name === "marketing_audit")!;
const scenarioTool = SCENARIO_TOOLS.find((t) => t.name === "scenario_planner")!;

interface RawChannel {
  name: string;
  spend: number;
  conversions: number;
}

const GRADE_HEADLINE: Record<string, string> = {
  A: "Здоровый аккаунт — фокус на масштабирование лучших каналов.",
  B: "В целом здоровый аккаунт с точечными зонами роста.",
  C: "Аккаунт требует внимания: есть заметные потери эффективности.",
  D: "Аккаунт в зоне риска: нужны срочные действия по перераспределению.",
};

const boardReport: ToolDef = {
  name: "board_report",
  description:
    "Executive one-pager (orchestrator). Give a category and current per-channel spend & conversions; board_report internally runs marketing_audit (health score, channel verdicts, concentration/untracked risks, prioritized actions) and scenario_planner (a +15% budget upside scenario), then assembles a board-ready brief: status + grade, headline metrics (spend, conversions, blended CPA, and revenue/profit/ROI if revenuePerConversion is given), best/worst channel, live risks, top recommendations, budget upside and a single next step. Composes the deterministic sub-tools — consistent with marketing_audit / scenario_planner. Decision support on your own numbers, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category (anchors benchmarks)" },
      company: { type: "string", description: "Optional company / brand name for the header" },
      period: { type: "string", description: "Optional reporting period label, e.g. 'Q3 2026', 'ноябрь'" },
      channels: {
        type: "array",
        minItems: 1,
        description: "Current spend & conversions per channel (last period)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name" },
            spend: { type: "number", minimum: 0, description: "Spend in RUB" },
            conversions: { type: "number", minimum: 0, description: "Conversions attributed to the channel" },
          },
          required: ["name", "spend", "conversions"],
          additionalProperties: false,
        },
      },
      targetCpa: { type: "number", exclusiveMinimum: 0, description: "Optional business target CPA (RUB) to compare blended CPA against" },
      revenuePerConversion: {
        type: "number",
        exclusiveMinimum: 0,
        description: "Optional average revenue per conversion (RUB) — enables revenue/profit/ROI and a ROI-ranked upside.",
      },
    },
    required: ["category", "channels"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const category = String(input.category);
    const company = input.company ? String(input.company) : null;
    const period = input.period ? String(input.period) : null;
    const targetCpa = input.targetCpa != null ? Number(input.targetCpa) : null;
    const revenuePerConversion =
      typeof input.revenuePerConversion === "number" && input.revenuePerConversion > 0
        ? Number(input.revenuePerConversion)
        : null;
    const channels: RawChannel[] = Array.isArray(input.channels) ? input.channels : [];
    if (!channels.length) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один канал в channels." }], isError: true };
    }

    // ── 1) Account audit (reused verbatim). ──
    const auditRes = await auditTool.handler(
      { category, channels, ...(targetCpa != null ? { targetCpa } : {}) },
      env,
    );
    if (auditRes.isError || !auditRes.structuredContent) {
      return auditRes; // surface the sub-tool's validation error as-is
    }
    const audit = auditRes.structuredContent as any;

    // ── 2) +15% budget upside (scenario_planner, reused). ──
    const scenarioChannels = channels
      .filter((c) => Number(c.spend) > 0 && Number(c.conversions) > 0)
      .map((c) => ({ name: c.name, currentSpend: Number(c.spend), currentConversions: Number(c.conversions) }));
    let upside: Record<string, unknown> | null = null;
    if (scenarioChannels.length) {
      const scRes = await scenarioTool.handler(
        {
          channels: scenarioChannels,
          scenarios: [{ name: "+15% бюджета", budgetMultiplier: 1.15 }],
          objective: revenuePerConversion != null ? "max_roi" : "max_conversions",
          ...(revenuePerConversion != null ? { revenuePerConversion } : {}),
        },
        env,
      );
      const sc = scRes.structuredContent as any;
      if (sc && Array.isArray(sc.scenarios)) {
        const base = sc.scenarios.find((s: any) => s.isBaseline);
        const plus = sc.scenarios.find((s: any) => !s.isBaseline);
        if (base && plus) {
          const extra = round(plus.totalConversions - base.totalConversions, 1);
          upside = {
            lever: "+15% бюджета на каналы с конверсиями",
            fromConversions: base.totalConversions,
            toConversions: plus.totalConversions,
            projectedExtraConversions: extra,
            marginalCPA:
              extra > 0 ? round((plus.totalSpend - base.totalSpend) / extra) : null,
            roiPct: plus.roiPct ?? null,
            note: "Диминишинг при эластичности b=0.7: +15% бюджета даёт <15% конверсий.",
          };
        }
      }
    }

    // ── 3) Channel highlights from the audit. ──
    const auditChannels: any[] = Array.isArray(audit.channels) ? audit.channels : [];
    const measuredWithBm = auditChannels.filter((c) => c.cpa != null && c.benchmarkCpa);
    const best = measuredWithBm.reduce<any>((m, c) => (m == null || c.cpa < m.cpa ? c : m), null);
    const weak = auditChannels.filter((c) => c.cpa != null && (c.verdict === "wasteful" || c.verdict === "above p75"));
    const worst = weak.reduce<any>((m, c) => (m == null || c.cpa > m.cpa ? c : m), null);

    // ── 4) Live risks. ──
    const risks: string[] = [];
    if (audit.concentration?.risk) {
      risks.push(`Концентрация: «${audit.concentration.topChannel}» — ${audit.concentration.sharePct}% бюджета.`);
    }
    const untracked = auditChannels.filter((c) => c.verdict === "untracked" && c.spend > 0).map((c) => c.name);
    if (untracked.length) risks.push(`Непрослеженный бюджет: ${untracked.join(", ")} (нет конверсий).`);
    const wasteful = auditChannels.filter((c) => c.verdict === "wasteful").map((c) => c.name);
    if (wasteful.length) risks.push(`Перерасход по CPA: ${wasteful.join(", ")} (выше p75 ×1.25).`);
    if (targetCpa != null && audit.blendedCpa != null && audit.blendedCpa > targetCpa) {
      risks.push(`Blended CPA ${ru(audit.blendedCpa)} ₽ выше цели ${ru(targetCpa)} ₽.`);
    }
    if (!risks.length) risks.push("Острых рисков не выявлено.");

    // ── 5) Headline metrics. ──
    const metrics: Record<string, unknown> = {
      totalSpend: audit.totalSpend,
      totalConversions: audit.totalConversions,
      blendedCpa: audit.blendedCpa,
      targetCpa,
    };
    if (revenuePerConversion != null) {
      const revenue = audit.totalConversions * revenuePerConversion;
      const profit = revenue - audit.totalSpend;
      metrics.revenuePerConversion = round(revenuePerConversion);
      metrics.revenue = round(revenue);
      metrics.profit = round(profit);
      metrics.roas = audit.totalSpend > 0 ? round(revenue / audit.totalSpend, 2) : null;
      metrics.roiPct = audit.totalSpend > 0 ? round((profit / audit.totalSpend) * 100, 1) : null;
    }

    const topRecommendations = (Array.isArray(audit.recommendations) ? audit.recommendations : []).slice(0, 3);
    const nextStep = topRecommendations[0]?.action ?? "Сохраняй курс и масштабируй лучшие каналы с шагом 10–15%/нед.";

    const payload = {
      header: {
        title: `Исполнительный отчёт${company ? ` — ${company}` : ""}`,
        category,
        period,
        currency: "RUB",
      },
      status: {
        grade: audit.grade,
        healthScore: audit.healthScore,
        headline: GRADE_HEADLINE[audit.grade] ?? "",
      },
      metrics,
      channelHighlights: {
        best: best ? { name: best.name, cpa: best.cpa, verdict: best.verdict } : null,
        worst: worst ? { name: worst.name, cpa: worst.cpa, verdict: worst.verdict } : null,
      },
      risks,
      topRecommendations,
      upside,
      nextStep,
      composedFrom: ["marketing_audit", "scenario_planner"],
      disclaimer:
        "Сводка собрана из marketing_audit + scenario_planner на mock-бенчмарках RU/CIS (если в KV нет реальных данных). Не является юридической/финансовой гарантией.",
    };

    const summary =
      `Исполнительный отчёт${company ? ` «${company}»` : ""} / «${category}»` +
      (period ? ` / ${period}` : "") +
      `: health ${audit.healthScore}/100 (${audit.grade}). ` +
      (audit.blendedCpa != null ? `Blended CPA ${ru(audit.blendedCpa)} ₽, спенд ${ru(audit.totalSpend)} ₽. ` : `Спенд ${ru(audit.totalSpend)} ₽. `) +
      (upside && (upside.projectedExtraConversions as number) > 0
        ? `Апсайд +15% бюджета: +${ru(upside.projectedExtraConversions as number)} конв. `
        : "") +
      `Next: ${nextStep}`;

    return toContent(summary, payload);
  },
};

export const BOARD_TOOLS: ToolDef[] = [boardReport];
