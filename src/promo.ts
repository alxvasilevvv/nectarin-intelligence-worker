/**
 * PROMO tool group (v2.17) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • promo_planner — a discount/promo P&L and break-even calculator. From the
 *     regular price, variable unit cost and baseline period volume, it computes the
 *     post-discount unit margin, the BREAK-EVEN volume uplift a promo must clear to
 *     not lose money, and — when an expected uplift is supplied — the promo's
 *     projected units, revenue, profit, incremental profit vs. baseline and ROI on
 *     the discount investment. Optional fixed promo cost (media/ops) and a
 *     pull-forward / cannibalization adjustment on the incremental volume. Returns a
 *     clear verdict (profitable / needs more uplift / margin-destroying).
 *
 * Classic trade-marketing math, fully deterministic, on the operator's OWN numbers.
 * No LLM, no PII. Decision support, not a guarantee.
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

const promoPlanner: ToolDef = {
  name: "promo_planner",
  description:
    "Promo / discount P&L and break-even calculator. From regular price, variable unit cost and baseline period volume, computes the post-discount unit margin, the BREAK-EVEN volume uplift the promo must clear to avoid losing money, and — if expectedUpliftPct is given — projected units/revenue/profit, incremental profit vs. baseline and ROI on the discount investment. Supports an optional fixed promo cost (media/ops) and a pull-forward/cannibalization penalty on incremental volume. Returns a verdict (profitable / needs more uplift / margin-destroying). Deterministic trade-marketing math on YOUR numbers — decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      product: { type: "string", description: "Optional product/offer label" },
      price: { type: "number", exclusiveMinimum: 0, description: "Regular unit price (RUB)" },
      unitCost: { type: "number", minimum: 0, description: "Variable cost per unit / COGS (RUB)" },
      baselineUnits: {
        type: "number",
        exclusiveMinimum: 0,
        description: "Units sold in the period WITHOUT the promo (at regular price)",
      },
      discountPct: { type: "number", minimum: 0, maximum: 90, description: "Promo discount on price, % (0–90)" },
      expectedUpliftPct: {
        type: "number",
        minimum: 0,
        description: "Optional expected % increase in unit volume during the promo",
      },
      promoFixedCost: {
        type: "number",
        minimum: 0,
        description: "Optional fixed promo cost (creative, media, ops), RUB",
      },
      cannibalizationPct: {
        type: "number",
        minimum: 0,
        maximum: 100,
        description: "Optional % of the UPLIFT that is pull-forward (penalized at regular margin). Default 0.",
      },
      period: { type: "string", description: "Optional period label, e.g. 'неделя акции', 'ноябрь'" },
    },
    required: ["price", "unitCost", "baselineUnits", "discountPct"],
    additionalProperties: false,
  },
  async handler(input) {
    const price = Number(input.price);
    const unitCost = Number(input.unitCost);
    const baselineUnits = Number(input.baselineUnits);
    const discountPct = clamp(Number(input.discountPct), 0, 90);
    const promoFixedCost = input.promoFixedCost != null ? Math.max(0, Number(input.promoFixedCost)) : 0;
    const cannibalizationPct =
      input.cannibalizationPct != null ? clamp(Number(input.cannibalizationPct), 0, 100) : 0;
    const hasUplift = input.expectedUpliftPct != null && Number.isFinite(Number(input.expectedUpliftPct));
    const expectedUpliftPct = hasUplift ? Math.max(0, Number(input.expectedUpliftPct)) : null;

    if (![price, unitCost, baselineUnits].every(Number.isFinite) || price <= 0 || baselineUnits <= 0) {
      return {
        content: [{ type: "text", text: "Ошибка: price и baselineUnits должны быть положительными, unitCost ≥ 0." }],
        isError: true,
      };
    }

    const regularMargin = price - unitCost;
    const promoPrice = round(price * (1 - discountPct / 100), 2);
    const promoMargin = round(promoPrice - unitCost, 2);
    const baselineProfit = baselineUnits * regularMargin;

    // Break-even uplift: smallest volume increase so promo profit ≥ baseline profit.
    // promoUnits·promoMargin − fixed = baselineUnits·regularMargin
    // ⇒ (1+u)·baselineUnits·promoMargin = baselineProfit + fixed
    let breakevenUpliftPct: number | null = null;
    if (promoMargin > 0) {
      const ratio = (baselineProfit + promoFixedCost) / (baselineUnits * promoMargin);
      breakevenUpliftPct = round((ratio - 1) * 100, 1);
    }

    const warnings: string[] = [];
    if (promoMargin <= 0) {
      warnings.push("Цена со скидкой ≤ переменной себестоимости — каждая проданная единица убыточна, промо не окупится ни при каком объёме.");
    }
    if (regularMargin <= 0) {
      warnings.push("Базовая маржа ≤ 0 — продукт убыточен ещё до скидки; проверьте unitCost/price.");
    }

    const payload: Record<string, unknown> = {
      product: input.product ? String(input.product) : null,
      period: input.period ? String(input.period) : null,
      currency: "RUB",
      inputs: {
        price: round(price, 2),
        unitCost: round(unitCost, 2),
        baselineUnits: round(baselineUnits),
        discountPct: round(discountPct, 1),
        promoFixedCost: round(promoFixedCost),
        cannibalizationPct: round(cannibalizationPct, 1),
      },
      economics: {
        regularUnitMargin: round(regularMargin, 2),
        regularMarginPct: price > 0 ? round((regularMargin / price) * 100, 1) : null,
        promoPrice,
        promoUnitMargin: promoMargin,
        promoMarginPct: promoPrice > 0 ? round((promoMargin / promoPrice) * 100, 1) : null,
        marginErosionPerUnit: round(regularMargin - promoMargin, 2),
        baselineProfit: round(baselineProfit),
      },
      breakevenUpliftPct,
      warnings,
      assumptions: [
        "В период промо ВСЕ единицы (база + прирост) продаются по сниженной цене — это эрозия маржи на базовый объём.",
        "Break-even уплифт — это рост объёма, при котором прибыль промо равна базовой прибыли (с учётом фикс. затрат).",
        cannibalizationPct > 0
          ? `Каннибализация ${round(cannibalizationPct, 1)}%: эта доля прироста считается «переносом спроса» и штрафуется по обычной марже.`
          : "Каннибализация не учитывается (0%).",
      ],
      disclaimer:
        "Модельная оценка на ВАШИХ числах, не гарантия. Эластичность спроса и долгосрочные эффекты на бренд/цену не моделируются.",
    };

    let verdict: string;
    if (promoMargin <= 0) {
      verdict = "margin_destroying";
    } else if (expectedUpliftPct != null) {
      const upliftUnits = baselineUnits * (expectedUpliftPct / 100);
      const promoUnits = baselineUnits + upliftUnits;
      const promoRevenue = promoUnits * promoPrice;
      const promoProfitRaw = promoUnits * promoMargin - promoFixedCost;
      const pullForwardPenalty = upliftUnits * (cannibalizationPct / 100) * regularMargin;
      const promoProfit = promoProfitRaw - pullForwardPenalty;
      const incrementalProfit = promoProfit - baselineProfit;
      // Discount investment = total markdown given + fixed cost.
      const discountInvestment = promoUnits * (price - promoPrice) + promoFixedCost;
      const promoRoiPct = discountInvestment > 0 ? round((incrementalProfit / discountInvestment) * 100, 1) : null;
      verdict = incrementalProfit > 0 ? "profitable" : "needs_more_uplift";
      payload.projection = {
        expectedUpliftPct: round(expectedUpliftPct, 1),
        promoUnits: round(promoUnits),
        promoRevenue: round(promoRevenue),
        promoProfit: round(promoProfit),
        pullForwardPenalty: round(pullForwardPenalty),
        incrementalProfit: round(incrementalProfit),
        promoRoiPct,
        beatsBreakeven: breakevenUpliftPct != null ? expectedUpliftPct >= breakevenUpliftPct : null,
      };
    } else {
      verdict = "breakeven_only";
    }
    payload.verdict = verdict;

    const verdictRu: Record<string, string> = {
      margin_destroying: "скидка убивает маржу — не окупится ни при каком объёме",
      profitable: "прибыльно при ожидаемом аплифте",
      needs_more_uplift: "убыточно при ожидаемом аплифте — нужен аплифт выше break-even",
      breakeven_only: "ориентир — нужен аплифт не ниже break-even",
    };

    const proj = payload.projection as
      | { incrementalProfit: number; promoRoiPct: number | null }
      | undefined;
    const summary =
      `Промо${input.product ? ` «${input.product}»` : ""}: скидка ${round(discountPct, 1)}% → цена ${ru(promoPrice)} ₽, ` +
      `маржа ${ru(promoMargin)} ₽/ед. ` +
      (breakevenUpliftPct != null ? `Break-even аплифт: ${breakevenUpliftPct}%. ` : "Маржа ≤ 0 — break-even недостижим. ") +
      (proj ? `При ожидаемом аплифте: доп. прибыль ${ru(proj.incrementalProfit)} ₽${proj.promoRoiPct != null ? `, ROI ${proj.promoRoiPct}%` : ""}. ` : "") +
      `Вывод: ${verdictRu[verdict]}.`;

    return toContent(summary, payload);
  },
};

export const PROMO_TOOLS: ToolDef[] = [promoPlanner];
