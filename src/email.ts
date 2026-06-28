/**
 * EMAIL / LIFECYCLE tool group (v2.44) for NECTARIN Intelligence — Workers.
 *
 *   • email_campaign_planner — email / CRM newsletter economics. From a list size,
 *     deliverability, open & click rates, conversion and AOV it computes per-send
 *     delivered / opens / clicks / orders / revenue, the key revenue-per-email (RPE),
 *     and (with a cadence) the monthly & annual revenue, orders and list attrition
 *     from unsubscribes — including a list half-life and a fatigue warning. With a
 *     cost (per-email and/or platform) it returns profit and ROI.
 *
 * Deterministic email math on the operator's OWN numbers. No LLM, no PII.
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

const emailCampaignPlanner: ToolDef = {
  name: "email_campaign_planner",
  description:
    "Email / CRM newsletter economics & cadence planner. From a list size, deliverability, open rate, click rate (clicks/delivered, or derive from clickToOpen), conversion rate (orders/clicks) and AOV, it computes per-send delivered → opens → clicks → orders → revenue and the key revenue-per-email (RPE). With sendsPerMonth it projects monthly & annual revenue, orders and list attrition from unsubscribes, plus a list half-life and a fatigue warning when cadence × unsubscribe is high. With costPerEmail and/or platformMonthlyCost it returns profit and ROI. Deterministic email math on YOUR numbers — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      listSize: { type: "number", exclusiveMinimum: 0, description: "Active subscribers on the list" },
      deliverabilityPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Delivered / sent % (default 98)" },
      openRatePct: { type: "number", minimum: 0, maximum: 100, description: "Open rate, % of delivered" },
      clickRatePct: { type: "number", minimum: 0, maximum: 100, description: "Click rate, % of delivered (CTR). Alternative to clickToOpenPct." },
      clickToOpenPct: { type: "number", minimum: 0, maximum: 100, description: "Click-to-open rate, % of opens (used if clickRatePct omitted)" },
      conversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Conversion rate, orders / clicks %" },
      aov: { type: "number", minimum: 0, description: "Average order value, ₽" },
      sendsPerMonth: { type: "number", exclusiveMinimum: 0, description: "Campaign cadence — sends per month (default 4)" },
      unsubscribeRatePct: { type: "number", minimum: 0, maximum: 100, description: "Unsubscribe rate per send, % of delivered (default 0.2)" },
      costPerEmail: { type: "number", minimum: 0, description: "Cost per delivered email, ₽ (optional)" },
      platformMonthlyCost: { type: "number", minimum: 0, description: "Fixed ESP / platform cost per month, ₽ (optional)" },
      marginPct: { type: "number", minimum: 0, maximum: 100, description: "Gross margin % on revenue for profit (default 100 = revenue is contribution)" },
    },
    required: ["listSize", "openRatePct", "conversionRatePct", "aov"],
    additionalProperties: false,
  },
  async handler(input) {
    const listSize = Number(input.listSize);
    if (!(listSize > 0)) {
      return { content: [{ type: "text", text: "Ошибка: listSize должен быть > 0." }], isError: true };
    }
    const deliverability = clamp(Number(input.deliverabilityPct ?? 98), 0, 100) / 100;
    const openRate = clamp(Number(input.openRatePct), 0, 100) / 100;
    let clickRate: number;
    if (typeof input.clickRatePct === "number") {
      clickRate = clamp(input.clickRatePct, 0, 100) / 100;
    } else if (typeof input.clickToOpenPct === "number") {
      clickRate = openRate * (clamp(input.clickToOpenPct, 0, 100) / 100);
    } else {
      return { content: [{ type: "text", text: "Ошибка: задай clickRatePct (CTR) или clickToOpenPct." }], isError: true };
    }
    const convRate = clamp(Number(input.conversionRatePct), 0, 100) / 100;
    const aov = Number(input.aov);
    const sendsPerMonth = Number(input.sendsPerMonth ?? 4);
    const unsubRate = clamp(Number(input.unsubscribeRatePct ?? 0.2), 0, 100) / 100;
    const costPerEmail = typeof input.costPerEmail === "number" ? input.costPerEmail : null;
    const platformMonthlyCost = typeof input.platformMonthlyCost === "number" ? input.platformMonthlyCost : null;
    const margin = clamp(Number(input.marginPct ?? 100), 0, 100) / 100;

    // ── Per send ────────────────────────────────────────────────────────────
    const delivered = listSize * deliverability;
    const opens = delivered * openRate;
    const clicks = delivered * clickRate;
    const orders = clicks * convRate;
    const revenue = orders * aov;
    const rpe = delivered > 0 ? revenue / delivered : 0; // revenue per email (delivered)
    const unsubs = delivered * unsubRate;

    const sendCost = (costPerEmail != null ? delivered * costPerEmail : 0) + (platformMonthlyCost != null ? platformMonthlyCost / sendsPerMonth : 0);
    const sendProfit = revenue * margin - sendCost;

    // ── Monthly / annual ──────────────────────────────────────────────────────
    const monthlyRevenue = revenue * sendsPerMonth;
    const monthlyOrders = orders * sendsPerMonth;
    const monthlyUnsubs = unsubs * sendsPerMonth;
    const monthlyUnsubRate = 1 - Math.pow(1 - unsubRate, sendsPerMonth); // compounding within the month
    const monthlyCost = (costPerEmail != null ? delivered * costPerEmail * sendsPerMonth : 0) + (platformMonthlyCost != null ? platformMonthlyCost : 0);
    const monthlyProfit = monthlyRevenue * margin - monthlyCost;
    const roiPct = monthlyCost > 0 ? ((monthlyRevenue * margin - monthlyCost) / monthlyCost) * 100 : null;

    // List half-life from unsubscribe attrition (months), ignoring new acquisition.
    const halfLifeMonths = monthlyUnsubRate > 0 ? Math.log(0.5) / Math.log(1 - monthlyUnsubRate) : Infinity;

    const fatigueRisk = monthlyUnsubRate > 0.02 || sendsPerMonth > 12;
    const payload = {
      perSend: {
        delivered: round(delivered),
        opens: round(opens),
        clicks: round(clicks),
        orders: round(orders, 1),
        revenue: round(revenue),
        revenuePerEmail: round(rpe, 2),
        unsubscribes: round(unsubs),
        cost: round(sendCost),
        profit: round(sendProfit),
      },
      rates: {
        deliverabilityPct: round(deliverability * 100, 1),
        openRatePct: round(openRate * 100, 1),
        clickRatePct: round(clickRate * 100, 2),
        clickToOpenPct: openRate > 0 ? round((clickRate / openRate) * 100, 1) : null,
        conversionRatePct: round(convRate * 100, 1),
      },
      monthly: {
        sends: sendsPerMonth,
        revenue: round(monthlyRevenue),
        orders: round(monthlyOrders),
        unsubscribes: round(monthlyUnsubs),
        unsubRatePct: round(monthlyUnsubRate * 100, 2),
        cost: round(monthlyCost),
        profit: round(monthlyProfit),
        roiPct: roiPct != null ? round(roiPct, 0) : null,
      },
      annual: {
        revenue: round(monthlyRevenue * 12),
        orders: round(monthlyOrders * 12),
        profit: round(monthlyProfit * 12),
      },
      listHealth: {
        listSize: round(listSize),
        estListHalfLifeMonths: Number.isFinite(halfLifeMonths) ? round(halfLifeMonths, 1) : null,
        fatigueRisk,
        note: fatigueRisk
          ? "Высокий риск усталости списка: частота и/или отписки велики — сегментируй, снижай частоту для неактивных, усиливай релевантность."
          : "Частота в норме; следи за вовлечённостью и регулярно чисти неактивных.",
      },
      verdict:
        `RPE ${round(rpe, 2)} ₽/письмо · выручка ${ru(round(revenue))} ₽/рассылку · ${ru(round(monthlyRevenue))} ₽/мес при ${sendsPerMonth} рассылках.` +
        (roiPct != null ? ` ROI ${round(roiPct, 0)}%.` : "") +
        (Number.isFinite(halfLifeMonths) ? ` Полужизнь списка ~${round(halfLifeMonths, 0)} мес. без привлечения.` : ""),
      methodology:
        "delivered = list×deliverability; opens = delivered×open; clicks = delivered×CTR (или opens×CTOR); orders = clicks×CR; revenue = orders×AOV; RPE = revenue/delivered. " +
        "Месячная отписка = 1−(1−unsub)^sends; полужизнь = ln0.5/ln(1−месячная отписка). Profit = revenue×margin − (perEmail×delivered + platform).",
      assumptions: [
        "Ставки (open/click/CR) стабильны между рассылками; на практике зависят от темы, сегмента и времени.",
        "Привлечение новых подписчиков не моделируется в полужизни списка (только отток через отписки).",
        "margin=100% означает, что выручка трактуется как вклад; задайте marginPct для прибыли.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия. Сверяйте с фактикой ESP и A/B-тестами тем/контента.",
    };

    const summary =
      `Email-план: RPE ${round(rpe, 2)} ₽/письмо, ${ru(round(revenue))} ₽/рассылку → ${ru(round(monthlyRevenue))} ₽/мес (${sendsPerMonth} рассылок). ` +
      (roiPct != null ? `ROI ${round(roiPct, 0)}%. ` : "") +
      (fatigueRisk ? "⚠️ Риск усталости списка." : "Частота в норме.");

    return toContent(summary, payload);
  },
};

export const EMAIL_TOOLS: ToolDef[] = [emailCampaignPlanner];
