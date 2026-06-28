/**
 * PARTNERSHIPS tool group (v2.45) for NECTARIN Intelligence — Workers.
 *
 *   • affiliate_program_planner — CPA / affiliate / partner-program economics for RU
 *     networks (Admitad, Cityads, …) and direct partners. From AOV, gross margin, a
 *     commission model (percent of AOV or fixed CPA), an optional network fee and
 *     order-validation rate, plus per-partner click volume & conversion, it computes
 *     per-partner orders, revenue, payout, EPC, effective CPA, ROAS and net profit,
 *     ranks partners, blends the whole program, and derives the SUSTAINABLE commission
 *     ceiling (the payout at which profit per order hits zero). Flags loss-making
 *     partners and checks a target CPA.
 *
 * Deterministic affiliate math on the operator's OWN numbers. No LLM, no PII.
 * Planning estimate, not a guarantee.
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

const affiliateProgramPlanner: ToolDef = {
  name: "affiliate_program_planner",
  description:
    "CPA / affiliate / partner-program economics planner for RU networks (Admitad, Cityads, …) and direct partners. From AOV, gross margin %, a commission model (percent of AOV via commissionPct, or fixed CPA via cpaPayout), an optional networkFeePct and validationRatePct (approved orders), plus per-partner clicksPerMonth & conversionRatePct, it computes per-partner approved orders, revenue, payout, EPC (partner earnings per click), effective CPA, ROAS and net profit to the advertiser, ranks partners best-first, blends the whole program, and derives the SUSTAINABLE commission ceiling (payout where profit per order = 0 ⇒ margin/(1+fee)). Flags loss-making partners and checks an optional target CPA. Deterministic affiliate math on YOUR numbers — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      aov: { type: "number", exclusiveMinimum: 0, description: "Average order value, ₽" },
      marginPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Gross margin % on revenue (before affiliate payout)" },
      commissionType: { type: "string", enum: ["percent", "cpa"], description: "Payout model: percent of AOV, or fixed CPA per order (default percent)" },
      commissionPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Commission % of AOV (when commissionType=percent)" },
      cpaPayout: { type: "number", exclusiveMinimum: 0, description: "Fixed payout per approved order, ₽ (when commissionType=cpa)" },
      networkFeePct: { type: "number", minimum: 0, maximum: 100, description: "Network fee on top of payout, % (default 0)" },
      validationRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Approved/validated orders % (default 100)" },
      targetCpa: { type: "number", exclusiveMinimum: 0, description: "Optional target cost per approved order, ₽" },
      partners: {
        type: "array",
        minItems: 1,
        description: "Partners / placements with monthly click volume and conversion",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Partner / placement name" },
            clicksPerMonth: { type: "number", exclusiveMinimum: 0, description: "Clicks driven per month" },
            conversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Conversion rate (orders/clicks) %" },
          },
          required: ["name", "clicksPerMonth", "conversionRatePct"],
          additionalProperties: false,
        },
      },
    },
    required: ["aov", "marginPct", "partners"],
    additionalProperties: false,
  },
  async handler(input) {
    const aov = Number(input.aov);
    const margin = clamp(Number(input.marginPct), 0, 100) / 100;
    const commissionType = (input.commissionType as string) ?? "percent";
    const fee = clamp(Number(input.networkFeePct ?? 0), 0, 100) / 100;
    const validation = clamp(Number(input.validationRatePct ?? 100), 0, 100) / 100;
    const partners = (input.partners ?? []) as Array<{ name: string; clicksPerMonth: number; conversionRatePct: number }>;
    if (!Array.isArray(partners) || partners.length === 0) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы одного партнёра." }], isError: true };
    }

    // Payout per approved order under the chosen model.
    let payoutPerOrder: number;
    if (commissionType === "cpa") {
      if (!(typeof input.cpaPayout === "number" && input.cpaPayout > 0)) {
        return { content: [{ type: "text", text: "Ошибка: при commissionType=cpa задай cpaPayout > 0." }], isError: true };
      }
      payoutPerOrder = input.cpaPayout;
    } else {
      if (!(typeof input.commissionPct === "number" && input.commissionPct > 0)) {
        return { content: [{ type: "text", text: "Ошибка: при commissionType=percent задай commissionPct > 0." }], isError: true };
      }
      payoutPerOrder = aov * (clamp(input.commissionPct, 0, 100) / 100);
    }
    const costPerOrder = payoutPerOrder * (1 + fee); // payout incl. network fee
    const grossProfitPerOrder = aov * margin;
    const profitPerOrder = grossProfitPerOrder - costPerOrder;

    // Sustainable ceiling: payout where profit per order = 0.
    const sustainablePayout = grossProfitPerOrder / (1 + fee);
    const sustainableCommissionPct = (sustainablePayout / aov) * 100;

    const rows = partners.map((p) => {
      const clicks = Number(p.clicksPerMonth);
      const cr = clamp(Number(p.conversionRatePct), 0, 100) / 100;
      const ordersGross = clicks * cr;
      const orders = ordersGross * validation;
      const revenue = orders * aov;
      const payout = orders * payoutPerOrder;
      const cost = orders * costPerOrder;
      const netProfit = revenue * margin - cost;
      const epc = clicks > 0 ? payout / clicks : 0; // partner earnings per click
      const effCpa = orders > 0 ? cost / orders : 0;
      const roas = cost > 0 ? revenue / cost : null;
      return {
        name: String(p.name),
        clicksPerMonth: round(clicks),
        conversionRatePct: round(cr * 100, 2),
        approvedOrders: round(orders, 1),
        revenue: round(revenue),
        payout: round(payout),
        networkFee: round(cost - payout),
        effectiveCpa: round(effCpa),
        epcPartner: round(epc, 2),
        roas: roas != null ? round(roas, 2) : null,
        netProfit: round(netProfit),
        profitable: netProfit > 0,
      };
    });
    rows.sort((a, b) => b.netProfit - a.netProfit);

    const totals = rows.reduce(
      (acc, r) => {
        acc.orders += r.approvedOrders;
        acc.revenue += r.revenue;
        acc.payout += r.payout;
        acc.fee += r.networkFee;
        acc.net += r.netProfit;
        return acc;
      },
      { orders: 0, revenue: 0, payout: 0, fee: 0, net: 0 }
    );
    const totalCost = totals.payout + totals.fee;
    const blendedRoas = totalCost > 0 ? totals.revenue / totalCost : null;
    const blendedCpa = totals.orders > 0 ? totalCost / totals.orders : null;

    const lossMakers = rows.filter((r) => !r.profitable).map((r) => r.name);
    const targetCpa = typeof input.targetCpa === "number" && input.targetCpa > 0 ? input.targetCpa : null;

    const payload = {
      model: {
        commissionType,
        payoutPerOrder: round(payoutPerOrder),
        networkFeePct: round(fee * 100, 1),
        costPerOrder: round(costPerOrder),
        validationRatePct: round(validation * 100, 1),
        grossProfitPerOrder: round(grossProfitPerOrder),
        profitPerOrder: round(profitPerOrder),
        sustainable: profitPerOrder >= 0,
      },
      sustainableCeiling: {
        maxPayoutPerOrder: round(sustainablePayout),
        maxCommissionPctOfAov: round(sustainableCommissionPct, 1),
      },
      partners: rows,
      program: {
        approvedOrders: round(totals.orders),
        revenue: round(totals.revenue),
        payout: round(totals.payout),
        networkFee: round(totals.fee),
        totalCost: round(totalCost),
        netProfit: round(totals.net),
        blendedRoas: blendedRoas != null ? round(blendedRoas, 2) : null,
        blendedCpa: blendedCpa != null ? round(blendedCpa) : null,
      },
      targetCpaCheck: targetCpa != null && blendedCpa != null
        ? { targetCpa: round(targetCpa), blendedCpa: round(blendedCpa), withinTarget: blendedCpa <= targetCpa }
        : null,
      lossMakingPartners: lossMakers,
      verdict:
        (profitPerOrder >= 0
          ? `Модель прибыльна: ${round(profitPerOrder)} ₽ прибыли с заказа. `
          : `⚠️ Модель убыточна: ${round(profitPerOrder)} ₽ с заказа — снизь выплату до ≤${round(sustainablePayout)} ₽ (≤${round(sustainableCommissionPct, 1)}% от чека). `) +
        `Программа: ${ru(round(totals.revenue))} ₽ выручки, ${ru(round(totals.net))} ₽ чистой прибыли/мес` +
        (blendedRoas != null ? `, ROAS ${round(blendedRoas, 1)}.` : ".") +
        (lossMakers.length ? ` Убыточные партнёры: ${lossMakers.join(", ")}.` : ""),
      methodology:
        "payout/заказ = %×AOV или фикс CPA; cost/заказ = payout×(1+networkFee). approved = clicks×CR×validation. " +
        "netProfit = revenue×margin − cost. EPC партнёра = payout/clicks. ROAS = revenue/cost. " +
        "Потолок выплаты (profit=0) = AOV×margin/(1+fee).",
      assumptions: [
        "CR и объём кликов по партнёрам стабильны; на практике зависят от площадки и сезона.",
        "Валидация (approved) единая для всех партнёров; в сетях отличается по источникам.",
        "Маржа считается до выплаты партнёру; прочие переменные затраты не учтены отдельно.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия. Сверяйте с фактикой сети (постбеки, отмены, фрод).",
    };

    const top = rows[0];
    const summary =
      `Партнёрка (${commissionType}): прибыль с заказа ${round(profitPerOrder)} ₽, потолок выплаты ≤${round(sustainablePayout)} ₽ (≤${round(sustainableCommissionPct, 0)}% чека). ` +
      `Программа: ${ru(round(totals.net))} ₽ прибыли/мес` +
      (blendedRoas != null ? `, ROAS ${round(blendedRoas, 1)}` : "") +
      `. Лучший партнёр: «${top.name}».` +
      (lossMakers.length ? ` ⚠️ Убыточные: ${lossMakers.join(", ")}.` : "");

    return toContent(summary, payload);
  },
};

export const PARTNERSHIP_TOOLS: ToolDef[] = [affiliateProgramPlanner];
