/**
 * SEARCH & SEM tool group (v2.36) for NECTARIN Intelligence — Workers.
 *
 *   • search_planner — a paid-search / SEM keyword-portfolio planner (Yandex Direct,
 *     VK/контекст). From keywords with monthly volume + CPC (and optional CTR/CVR/
 *     intent) and an optional monthly budget, it estimates per-keyword clicks,
 *     conversions, CPA and the max addressable spend, ranks keywords by efficiency,
 *     greedily allocates the budget to the lowest-CPA keywords first, and returns
 *     the portfolio totals (clicks, conversions, blended CPA, coverage).
 *
 * Deterministic media math on the operator's OWN keyword inputs. No LLM, no PII.
 * Planning estimate, not a guarantee.
 */

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

interface KeywordIn {
  term: string;
  volume: number;
  cpc: number;
  ctr?: number;
  cvr?: number;
  intent?: string;
}

const searchPlanner: ToolDef = {
  name: "search_planner",
  description:
    "Paid-search / SEM keyword-portfolio planner for Yandex Direct & контекст. From keywords (monthly search volume + CPC, optional CTR%/CVR%/intent) and an optional monthly budget, estimates per-keyword clicks, conversions, CPA and the max addressable spend; ranks keywords by efficiency (expected conversions per ₽); greedily allocates the budget to the lowest-CPA keywords first; and returns portfolio totals — clicks, conversions, blended CPA, total spend and demand coverage. Defaults CTR=4%, CVR=2% when missing (flagged). Deterministic media math on YOUR keyword inputs — planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        minItems: 1,
        description: "Keyword list",
        items: {
          type: "object",
          properties: {
            term: { type: "string", description: "Keyword / phrase" },
            volume: { type: "number", minimum: 0, description: "Monthly search volume (impressions opportunity)" },
            cpc: { type: "number", exclusiveMinimum: 0, description: "Expected cost-per-click (₽)" },
            ctr: { type: "number", minimum: 0, maximum: 100, description: "Expected CTR % (default 4)" },
            cvr: { type: "number", minimum: 0, maximum: 100, description: "Expected conversion rate % (default 2)" },
            intent: { type: "string", description: "Optional intent label (e.g. transactional/informational/brand)" },
          },
          required: ["term", "volume", "cpc"],
          additionalProperties: false,
        },
      },
      monthlyBudget: { type: "number", exclusiveMinimum: 0, description: "Optional monthly budget (₽) to allocate across keywords" },
      defaultCtrPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Fallback CTR % when missing (default 4)" },
      defaultCvrPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Fallback CVR % when missing (default 2)" },
    },
    required: ["keywords"],
    additionalProperties: false,
  },
  async handler(input) {
    const kws = (input.keywords ?? []) as KeywordIn[];
    if (!Array.isArray(kws) || kws.length === 0) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один ключ (term, volume, cpc)." }], isError: true };
    }
    const dCtr = typeof input.defaultCtrPct === "number" && input.defaultCtrPct > 0 ? input.defaultCtrPct : 4;
    const dCvr = typeof input.defaultCvrPct === "number" && input.defaultCvrPct > 0 ? input.defaultCvrPct : 2;
    const budget = typeof input.monthlyBudget === "number" && input.monthlyBudget > 0 ? input.monthlyBudget : null;

    let usedDefaults = false;
    const items = kws.map((k) => {
      const volume = Math.max(0, Number(k.volume));
      const cpc = Math.max(0.0001, Number(k.cpc));
      const ctr = typeof k.ctr === "number" && k.ctr >= 0 ? k.ctr : ((usedDefaults = true), dCtr);
      const cvr = typeof k.cvr === "number" && k.cvr >= 0 ? k.cvr : ((usedDefaults = true), dCvr);
      const maxClicks = volume * (ctr / 100);
      const maxSpend = maxClicks * cpc;
      const cpa = cvr > 0 ? cpc / (cvr / 100) : Infinity;
      const convPerRub = cpc > 0 ? cvr / 100 / cpc : 0; // conversions per ₽ at this keyword
      return {
        term: String(k.term),
        intent: k.intent ? String(k.intent) : null,
        volume: round(volume),
        cpc: round(cpc, 2),
        ctrPct: round(ctr, 2),
        cvrPct: round(cvr, 2),
        cpa: Number.isFinite(cpa) ? round(cpa) : null,
        maxClicks: round(maxClicks),
        maxSpend: round(maxSpend),
        convPerRub,
        allocatedSpend: 0,
        expClicks: 0,
        expConversions: 0,
        priority: "" as string,
      };
    });

    // Greedy allocation: best efficiency (most conversions per ₽) first, up to each
    // keyword's max addressable spend, until the budget is exhausted.
    const order = [...items].sort((a, b) => b.convPerRub - a.convPerRub);
    let remaining = budget ?? order.reduce((s, i) => s + i.maxSpend, 0);
    const totalDemandSpend = items.reduce((s, i) => s + i.maxSpend, 0);
    for (const i of order) {
      const give = Math.min(i.maxSpend, remaining);
      i.allocatedSpend = round(give);
      i.expClicks = round(i.cpc > 0 ? give / i.cpc : 0);
      i.expConversions = round(i.expClicks * (i.cvrPct / 100));
      remaining -= give;
      if (remaining <= 0) remaining = 0;
    }

    // Priority tiers by efficiency quantiles.
    const effSorted = [...items].map((i) => i.convPerRub).sort((a, b) => a - b);
    const q = (p: number) => effSorted[Math.min(effSorted.length - 1, Math.floor(p * effSorted.length))] ?? 0;
    const hi = q(0.66);
    const lo = q(0.33);
    for (const i of items) {
      i.priority = i.convPerRub >= hi ? "high" : i.convPerRub >= lo ? "medium" : "low";
    }

    const totalSpend = items.reduce((s, i) => s + i.allocatedSpend, 0);
    const totalClicks = items.reduce((s, i) => s + i.expClicks, 0);
    const totalConv = items.reduce((s, i) => s + i.expConversions, 0);
    const blendedCpa = totalConv > 0 ? totalSpend / totalConv : null;
    const coveragePct = totalDemandSpend > 0 ? (totalSpend / totalDemandSpend) * 100 : 100;

    items.sort((a, b) => b.allocatedSpend - a.allocatedSpend);

    const payload = {
      keywordsCount: items.length,
      monthlyBudget: budget != null ? round(budget) : null,
      keywords: items.map(({ convPerRub, ...rest }) => rest),
      totals: {
        spend: round(totalSpend),
        clicks: round(totalClicks),
        conversions: round(totalConv),
        blendedCpa: blendedCpa != null ? round(blendedCpa) : null,
        demandCoveragePct: round(coveragePct, 1),
        maxAddressableSpend: round(totalDemandSpend),
      },
      verdict:
        budget != null && coveragePct < 99
          ? `Бюджет ${ru(round(budget))} ₽ покрывает ${round(coveragePct, 0)}% спроса — хватает на топ-эффективные ключи; остальной спрос недозакрыт.`
          : budget != null
            ? `Бюджет покрывает весь адресуемый спрос (${ru(round(totalDemandSpend))} ₽). Можно расширять семантику.`
            : `Полный потенциал семантики: ~${ru(round(totalConv))} конверсий при ~${ru(round(totalDemandSpend))} ₽ и blended CPA ~${blendedCpa != null ? ru(round(blendedCpa)) : "—"} ₽.`,
      methodology:
        "Клики = volume×CTR; расход = клики×CPC; CPA = CPC/(CVR). Эффективность = конверсии на ₽ = CVR/CPC. Бюджет распределяется жадно от самых эффективных ключей к менее эффективным до исчерпания. Coverage = распределённый расход / максимально адресуемый.",
      assumptions: [
        usedDefaults ? `Для части ключей CTR/CVR не заданы — взяты дефолты ${dCtr}%/${dCvr}% (уточните под свою категорию).` : "CTR/CVR заданы по всем ключам.",
        "Аукцион стабилен в рамках периода; нет каннибализации между ключами.",
        "Volume = месячный потенциал показов; реальная доля показов зависит от ставок и Quality Score.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ вводных, не гарантия. Сверяйте с прогнозатором площадки и фактом.",
    };

    const top = items[0];
    const summary =
      `SEM-план по ${items.length} ключам${budget != null ? ` на бюджет ${ru(round(budget))} ₽` : ""}: ` +
      `~${ru(round(totalClicks))} кликов, ~${ru(round(totalConv))} конверсий, blended CPA ${blendedCpa != null ? ru(round(blendedCpa)) : "—"} ₽` +
      `${budget != null ? `, покрытие спроса ${round(coveragePct, 0)}%` : ""}. Топ-ключ: «${top?.term}».`;

    return toContent(summary, payload);
  },
};

export const SEARCH_TOOLS: ToolDef[] = [searchPlanner];
