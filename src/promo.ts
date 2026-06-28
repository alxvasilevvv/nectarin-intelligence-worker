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

// ── price_optimizer ──────────────────────────────────────────────────────────

interface PriceObs {
  price: number;
  units: number;
}
interface ElasticityFit {
  elasticity: number; // e in Q = a·P^(-e)
  a: number;
  r2: number;
  n: number;
}

/** Fit constant-elasticity demand Q = a·P^(-e) by log-log least squares. */
function fitElasticity(obs: PriceObs[]): ElasticityFit | null {
  const X: number[] = [];
  const Y: number[] = [];
  for (const o of obs) {
    const p = Number(o.price);
    const q = Number(o.units);
    if (p > 0 && q > 0) {
      X.push(Math.log(p));
      Y.push(Math.log(q));
    }
  }
  const n = X.length;
  if (n < 2) return null;
  const mx = X.reduce((s, v) => s + v, 0) / n;
  const my = Y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (X[i] - mx) ** 2;
    sxy += (X[i] - mx) * (Y[i] - my);
  }
  if (sxx <= 0) return null; // no price variation ⇒ elasticity undefined
  const b = sxy / sxx; // slope = -e
  const lnA = my - b * mx;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = lnA + b * X[i];
    ssRes += (Y[i] - pred) ** 2;
    ssTot += (Y[i] - my) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 1;
  return { elasticity: -b, a: Math.exp(lnA), r2, n };
}

const priceOptimizer: ToolDef = {
  name: "price_optimizer",
  description:
    "Profit-maximizing price finder. From ≥2 historical (price, units) observations, fits a constant-elasticity demand curve Q = a·P^(-e) by log-log least squares, estimates the price elasticity of demand, and — when demand is elastic (e>1) — computes the profit-maximizing price P* = cost·e/(e−1) (standard markup rule), with projected units/revenue/profit and the uplift vs. an optional currentPrice. Flags inelastic demand (e≤1, no interior optimum) and low-confidence fits. Deterministic, on YOUR data — decision support, not a guarantee. Complements promo_planner (which evaluates a fixed discount).",
  inputSchema: {
    type: "object",
    properties: {
      observations: {
        type: "array",
        minItems: 2,
        description: "Historical (price, units) points with varying prices, ≥2",
        items: {
          type: "object",
          properties: {
            price: { type: "number", exclusiveMinimum: 0, description: "Price point (RUB)" },
            units: { type: "number", exclusiveMinimum: 0, description: "Units sold at that price (same period basis)" },
          },
          required: ["price", "units"],
          additionalProperties: false,
        },
      },
      unitCost: { type: "number", minimum: 0, description: "Variable cost per unit / COGS (RUB)" },
      currentPrice: { type: "number", exclusiveMinimum: 0, description: "Optional current price to compare against the optimum" },
      product: { type: "string", description: "Optional product/offer label" },
    },
    required: ["observations", "unitCost"],
    additionalProperties: false,
  },
  async handler(input) {
    const obs = (input.observations ?? []) as PriceObs[];
    const unitCost = Math.max(0, Number(input.unitCost));
    const currentPrice = input.currentPrice != null ? Number(input.currentPrice) : null;
    const fit = fitElasticity(obs);
    if (!fit) {
      return {
        content: [
          { type: "text", text: "Ошибка: нужно ≥2 наблюдений с РАЗНЫМИ положительными ценами и объёмами." },
        ],
        isError: true,
      };
    }

    const e = fit.elasticity;
    const lowConfidence = fit.n < 3 || fit.r2 < 0.5;
    const warnings: string[] = [];
    if (lowConfidence) {
      warnings.push(`Низкая уверенность подгонки (R²=${round(fit.r2, 2)}, точек=${fit.n}) — добавь больше ценовых точек.`);
    }

    const demandAt = (p: number) => fit.a * Math.pow(p, -e);
    const profitAt = (p: number) => (p - unitCost) * demandAt(p);

    let optimalPrice: number | null = null;
    let regime: "elastic" | "inelastic" | "anomalous";
    if (e > 1) {
      regime = "elastic";
      optimalPrice = round((unitCost * e) / (e - 1), 2);
    } else if (e > 0) {
      regime = "inelastic";
      warnings.push("Спрос неэластичен (e≤1): прибыль растёт с ценой — внутреннего оптимума нет, тестируй повышение цены осторожно.");
    } else {
      regime = "anomalous";
      warnings.push("Оценённая эластичность ≤0 (объём растёт с ценой) — вероятно шум/смешанные факторы; не доверяй модели.");
    }

    const atOptimal =
      optimalPrice != null
        ? {
            price: optimalPrice,
            units: round(demandAt(optimalPrice), 1),
            revenue: round(optimalPrice * demandAt(optimalPrice)),
            profit: round(profitAt(optimalPrice)),
            unitMargin: round(optimalPrice - unitCost, 2),
          }
        : null;

    let current: Record<string, unknown> | null = null;
    if (currentPrice != null && currentPrice > 0) {
      const curProfit = profitAt(currentPrice);
      current = {
        price: round(currentPrice, 2),
        units: round(demandAt(currentPrice), 1),
        revenue: round(currentPrice * demandAt(currentPrice)),
        profit: round(curProfit),
        unitMargin: round(currentPrice - unitCost, 2),
      };
      if (atOptimal) {
        (current as any).profitUpliftVsOptimal = round((atOptimal.profit as number) - curProfit);
        (current as any).priceChangePct = round(((optimalPrice! - currentPrice) / currentPrice) * 100, 1);
      }
    }

    const payload = {
      product: input.product ? String(input.product) : null,
      currency: "RUB",
      model: "constant-elasticity demand: units = a·price^(-e); profit-max price P* = cost·e/(e−1) for e>1",
      fit: {
        elasticity: round(e, 3),
        regime,
        scaleA: round(fit.a, 4),
        r2: round(fit.r2, 3),
        points: fit.n,
        lowConfidence,
      },
      unitCost: round(unitCost, 2),
      optimalPrice,
      atOptimal,
      current,
      warnings,
      assumptions: [
        "Спрос моделируется постоянной эластичностью Q=a·P^(-e), оценённой по лог-лог регрессии ваших точек.",
        "Оптимум прибыли для e>1: P* = себестоимость·e/(e−1) (классическое правило наценки).",
        "Эффекты конкуренции, восприятия цены и долгосрочной лояльности не моделируются.",
      ],
      disclaimer: "Модельная оценка на ВАШИХ данных, не гарантия. Проверяйте ценовые изменения A/B-тестом.",
    };

    const summary =
      `Эластичность спроса e≈${round(e, 2)} (${regime}, R²=${round(fit.r2, 2)}). ` +
      (optimalPrice != null
        ? `Оптимальная цена ~${ru(optimalPrice)} ₽ (маржа ${ru(round(optimalPrice - unitCost, 2))} ₽/ед.)` +
          (current && (current as any).profitUpliftVsOptimal != null
            ? `, прибыль ${(current as any).profitUpliftVsOptimal >= 0 ? "+" : ""}${ru((current as any).profitUpliftVsOptimal)} ₽ к текущей цене.`
            : ".")
        : "Внутреннего оптимума нет (спрос неэластичен/аномален) — см. warnings.");

    return toContent(summary, payload);
  },
};

export const PROMO_TOOLS: ToolDef[] = [promoPlanner, priceOptimizer];
