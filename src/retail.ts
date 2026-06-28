/**
 * RETAIL MEDIA tool group (v2.37) for NECTARIN Intelligence — Workers.
 *
 *   • retail_media_planner — a marketplace / retail-media planner for Ozon,
 *     Wildberries, Yandex Market and Avito. From placements (search / catalog /
 *     banner) with their cost model (CPC or CPM+CTR) and click→order conversion,
 *     an average order value, the marketplace commission (take-rate) and an optional
 *     budget, it computes per-placement effective CPC, orders, revenue, **ДРР**
 *     (доля рекламных расходов = ad spend / revenue) and **ROAS**, ranks placements
 *     by profit per ₽, greedily allocates the budget to the most profitable
 *     placements first (respecting volume caps), and returns the blended portfolio
 *     economics with a target-ДРР check.
 *
 * Deterministic retail-media math on the operator's OWN inputs. No LLM, no PII.
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

interface PlacementIn {
  name: string;
  type?: string;
  model?: "CPC" | "CPM";
  cpc?: number;
  cpm?: number;
  ctr?: number;
  cvr: number;
  maxClicks?: number;
  maxImpressions?: number;
}

const retailMediaPlanner: ToolDef = {
  name: "retail_media_planner",
  description:
    "Marketplace / retail-media planner for Ozon, Wildberries, Yandex Market & Avito. From placements (search/catalog/banner) with a cost model (CPC, or CPM+CTR), click→order CVR, an average order value (AOV), the marketplace commission (take-rate %) and an optional budget, it computes per-placement effective CPC, orders, revenue, ДРР (доля рекламных расходов = ad spend / revenue) and ROAS, ranks placements by profit per ₽, greedily allocates the budget to the most profitable placements first (respecting click/impression caps), and returns blended portfolio economics (revenue, ДРР, ROAS, net profit) plus a target-ДРР check. Deterministic retail-media math on YOUR inputs — planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      placements: {
        type: "array",
        minItems: 1,
        description: "Retail-media placements",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Placement name, e.g. 'Ozon поиск', 'WB карточка', 'Я.Маркет баннер'" },
            type: { type: "string", description: "Optional: search / catalog / banner / shelf" },
            model: { type: "string", enum: ["CPC", "CPM"], description: "Pricing model (default CPC)" },
            cpc: { type: "number", exclusiveMinimum: 0, description: "Cost per click (₽) — for CPC model" },
            cpm: { type: "number", exclusiveMinimum: 0, description: "Cost per 1000 impressions (₽) — for CPM model" },
            ctr: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "CTR % — required for CPM model (to derive clicks)" },
            cvr: { type: "number", minimum: 0, maximum: 100, description: "Click→order conversion rate %" },
            maxClicks: { type: "number", minimum: 0, description: "Optional volume cap (max clicks available) — CPC" },
            maxImpressions: { type: "number", minimum: 0, description: "Optional volume cap (max impressions) — CPM" },
          },
          required: ["name", "cvr"],
          additionalProperties: false,
        },
      },
      aov: { type: "number", exclusiveMinimum: 0, description: "Average order value (₽)" },
      commissionPct: { type: "number", minimum: 0, maximum: 90, description: "Marketplace commission / take-rate % (default 0)" },
      cogsPct: { type: "number", minimum: 0, maximum: 100, description: "Cost of goods as % of revenue (default 0)" },
      monthlyBudget: { type: "number", exclusiveMinimum: 0, description: "Optional monthly budget (₽) to allocate across placements" },
      targetDrrPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Optional target ДРР % (ad spend / revenue) to check placements against" },
    },
    required: ["placements", "aov"],
    additionalProperties: false,
  },
  async handler(input) {
    const placements = (input.placements ?? []) as PlacementIn[];
    if (!Array.isArray(placements) || placements.length === 0) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы одну площадку (name, cvr) и aov." }], isError: true };
    }
    const aov = Math.max(0.01, Number(input.aov));
    const commission = typeof input.commissionPct === "number" ? Math.max(0, Math.min(90, input.commissionPct)) : 0;
    const cogs = typeof input.cogsPct === "number" ? Math.max(0, Math.min(100, input.cogsPct)) : 0;
    const budget = typeof input.monthlyBudget === "number" && input.monthlyBudget > 0 ? input.monthlyBudget : null;
    const targetDrr = typeof input.targetDrrPct === "number" && input.targetDrrPct > 0 ? input.targetDrrPct : null;
    const netRevShare = Math.max(0, 1 - commission / 100 - cogs / 100); // share of revenue kept before ad spend

    const warnings: string[] = [];
    const items = placements.map((p, idx) => {
      const model: "CPC" | "CPM" = p.model === "CPM" ? "CPM" : "CPC";
      const cvr = Math.max(0, Number(p.cvr));
      let effCpc: number;
      let maxClicks: number;
      if (model === "CPM") {
        const cpm = typeof p.cpm === "number" && p.cpm > 0 ? p.cpm : NaN;
        const ctr = typeof p.ctr === "number" && p.ctr > 0 ? p.ctr : NaN;
        if (!Number.isFinite(cpm) || !Number.isFinite(ctr)) {
          warnings.push(`«${p.name ?? `#${idx + 1}`}»: модель CPM требует cpm и ctr — площадка пропущена.`);
          effCpc = NaN;
          maxClicks = 0;
        } else {
          effCpc = cpm / (10 * ctr); // = cpm / (1000 * ctr/100)
          maxClicks = typeof p.maxImpressions === "number" ? p.maxImpressions * (ctr / 100) : Infinity;
        }
      } else {
        const cpc = typeof p.cpc === "number" && p.cpc > 0 ? p.cpc : NaN;
        if (!Number.isFinite(cpc)) {
          warnings.push(`«${p.name ?? `#${idx + 1}`}»: модель CPC требует cpc — площадка пропущена.`);
          effCpc = NaN;
          maxClicks = 0;
        } else {
          effCpc = cpc;
          maxClicks = typeof p.maxClicks === "number" ? p.maxClicks : Infinity;
        }
      }
      // Per-click unit economics.
      const ordersPerClick = cvr / 100;
      const revPerClick = ordersPerClick * aov;
      const netRevPerClick = revPerClick * netRevShare;
      const profitPerClick = Number.isFinite(effCpc) ? netRevPerClick - effCpc : NaN;
      const roas = Number.isFinite(effCpc) && effCpc > 0 ? revPerClick / effCpc : 0;
      const drrPct = revPerClick > 0 && Number.isFinite(effCpc) ? (effCpc / revPerClick) * 100 : Infinity;
      const profitPerRub = Number.isFinite(effCpc) && effCpc > 0 ? profitPerClick / effCpc : -Infinity;
      return {
        name: String(p.name ?? `#${idx + 1}`),
        type: p.type ? String(p.type) : null,
        model,
        effectiveCpc: Number.isFinite(effCpc) ? round(effCpc, 2) : null,
        cvrPct: round(cvr, 2),
        roas: round(roas, 2),
        drrPct: Number.isFinite(drrPct) ? round(drrPct, 1) : null,
        profitPerOrder: ordersPerClick > 0 ? round(profitPerClick / ordersPerClick) : null,
        profitable: Number.isFinite(profitPerClick) ? profitPerClick > 0 : false,
        _effCpc: effCpc,
        _maxClicks: maxClicks,
        _profitPerRub: profitPerRub,
        _revPerClick: revPerClick,
        _netRevPerClick: netRevPerClick,
        allocatedSpend: 0,
        clicks: 0,
        orders: 0,
        revenue: 0,
        netRevenue: 0,
        profit: 0,
        aboveTargetDrr: targetDrr != null && Number.isFinite(drrPct) ? drrPct > targetDrr : false,
      };
    });

    const valid = items.filter((i) => Number.isFinite(i._effCpc) && i._effCpc > 0);

    // Allocation: most profit-per-₽ first (fall back to ROAS when nothing profitable),
    // capped by each placement's addressable clicks; bounded by budget when given.
    const anyProfitable = valid.some((i) => i._profitPerRub > 0);
    const ranked = [...valid].sort((a, b) =>
      anyProfitable ? b._profitPerRub - a._profitPerRub : b.roas - a.roas
    );
    const maxDemandSpend = valid.reduce(
      (s, i) => s + (Number.isFinite(i._maxClicks) ? i._maxClicks * i._effCpc : Infinity),
      0
    );
    const haveCaps = valid.every((i) => Number.isFinite(i._maxClicks));
    let totalsKnown = budget != null || haveCaps;

    let remaining = budget ?? (haveCaps ? maxDemandSpend : 0);
    if (totalsKnown) {
      for (const i of ranked) {
        if (anyProfitable && i._profitPerRub <= 0) continue; // don't fund loss-makers when profitable options exist
        const cap = Number.isFinite(i._maxClicks) ? i._maxClicks * i._effCpc : remaining;
        const give = Math.min(cap, remaining);
        if (give <= 0) continue;
        const clicks = give / i._effCpc;
        i.allocatedSpend = round(give);
        i.clicks = round(clicks);
        i.orders = round(clicks * (i.cvrPct / 100));
        i.revenue = round(clicks * i._revPerClick);
        i.netRevenue = round(clicks * i._netRevPerClick);
        i.profit = round(i.netRevenue - i.allocatedSpend);
        remaining -= give;
        if (remaining <= 0) {
          remaining = 0;
          break;
        }
      }
    } else {
      warnings.push("Без monthlyBudget и без volume-капов итоги портфеля не считаются — показаны только юнит-метрики (CPC/ROAS/ДРР) по площадкам.");
    }

    const totalSpend = items.reduce((s, i) => s + i.allocatedSpend, 0);
    const totalRevenue = items.reduce((s, i) => s + i.revenue, 0);
    const totalNetRevenue = items.reduce((s, i) => s + i.netRevenue, 0);
    const totalOrders = items.reduce((s, i) => s + i.orders, 0);
    const totalProfit = items.reduce((s, i) => s + i.profit, 0);
    const blendedRoas = totalSpend > 0 ? totalRevenue / totalSpend : null;
    const blendedDrr = totalRevenue > 0 ? (totalSpend / totalRevenue) * 100 : null;

    // Priority tiers from profit-per-₽ (or ROAS fallback).
    const effForTier = valid.map((i) => (anyProfitable ? i._profitPerRub : i.roas)).sort((a, b) => a - b);
    const q = (pp: number) => effForTier[Math.min(effForTier.length - 1, Math.floor(pp * effForTier.length))] ?? 0;
    const hiT = q(0.66);
    const loT = q(0.33);

    const outItems = items
      .map((i) => {
        const eff = anyProfitable ? i._profitPerRub : i.roas;
        const priority = !Number.isFinite(i._effCpc) ? "n/a" : eff >= hiT ? "high" : eff >= loT ? "medium" : "low";
        const { _effCpc, _maxClicks, _profitPerRub, _revPerClick, _netRevPerClick, ...rest } = i;
        return { ...rest, priority };
      })
      .sort((a, b) => b.allocatedSpend - a.allocatedSpend || b.roas - a.roas);

    const aboveTargetCount = targetDrr != null ? outItems.filter((i) => i.aboveTargetDrr).length : 0;

    const payload = {
      placementsCount: items.length,
      aov: round(aov),
      commissionPct: commission,
      cogsPct: cogs,
      netRevenueShare: round(netRevShare * 100, 1),
      monthlyBudget: budget != null ? round(budget) : null,
      targetDrrPct: targetDrr,
      placements: outItems,
      totals: totalsKnown
        ? {
            spend: round(totalSpend),
            orders: round(totalOrders),
            revenue: round(totalRevenue),
            netRevenue: round(totalNetRevenue),
            profit: round(totalProfit),
            blendedRoas: blendedRoas != null ? round(blendedRoas, 2) : null,
            blendedDrrPct: blendedDrr != null ? round(blendedDrr, 1) : null,
          }
        : null,
      targetDrrCheck:
        targetDrr != null ? { targetDrrPct: targetDrr, placementsAboveTarget: aboveTargetCount } : null,
      verdict: !totalsKnown
        ? "Добавь monthlyBudget или volume-капы (maxClicks/maxImpressions), чтобы посчитать итоги портфеля."
        : totalProfit >= 0
          ? `Портфель прибыльный: выручка ~${ru(round(totalRevenue))} ₽, ДРР ${blendedDrr != null ? round(blendedDrr, 0) : "—"}%, ROAS ${blendedRoas != null ? round(blendedRoas, 1) : "—"}, прибыль ~${ru(round(totalProfit))} ₽ после комиссии${cogs > 0 ? " и себестоимости" : ""}.` +
            (targetDrr != null && aboveTargetCount > 0 ? ` ${aboveTargetCount} площадк(и) выше целевого ДРР ${targetDrr}% — пересмотреть ставки/ассортимент.` : "")
          : `Портфель убыточный при текущих ставках: ДРР ${blendedDrr != null ? round(blendedDrr, 0) : "—"}%, прибыль ~${ru(round(totalProfit))} ₽. Снизить CPC, поднять CVR/AOV или сменить площадки.`,
      methodology:
        "Эфф. CPC: для CPM = CPM/(1000×CTR). Заказы = клики×CVR; выручка = заказы×AOV; ДРР = расход/выручка; ROAS = выручка/расход. " +
        "Чистая выручка = выручка×(1−комиссия−себестоимость); прибыль = чистая выручка − расход. " +
        "Бюджет распределяется жадно от площадок с наибольшей прибылью на ₽ (при отсутствии прибыльных — по ROAS) до исчерпания, с учётом капов по объёму.",
      assumptions: [
        `AOV ${ru(round(aov))} ₽, комиссия маркетплейса ${commission}%${cogs > 0 ? `, себестоимость ${cogs}%` : ""}.`,
        "CVR и объёмы — ВАШИ вводные; реальная выдача зависит от ставок конкурентов, рейтинга карточки и наличия товара.",
        "Возвраты/выкуп и логистика не учтены отдельно — заложите в себестоимость при необходимости.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ вводных, не гарантия. Сверяйте с кабинетами Ozon/WB/Я.Маркет/Avito и фактом выкупа.",
      warnings: warnings.length ? warnings : undefined,
    };

    const top = outItems.find((i) => i.allocatedSpend > 0) ?? outItems[0];
    const summary = totalsKnown
      ? `Retail-media по ${items.length} площадкам${budget != null ? ` (бюджет ${ru(round(budget))} ₽)` : ""}: ` +
        `~${ru(round(totalOrders))} заказов, выручка ~${ru(round(totalRevenue))} ₽, ДРР ${blendedDrr != null ? round(blendedDrr, 0) : "—"}%, ROAS ${blendedRoas != null ? round(blendedRoas, 1) : "—"}, прибыль ~${ru(round(totalProfit))} ₽. Топ: «${top?.name}».`
      : `Retail-media: ${items.length} площадок, юнит-экономика посчитана (ROAS/ДРР); добавь бюджет или капы для итогов.`;

    return toContent(summary, payload);
  },
};

export const RETAIL_TOOLS: ToolDef[] = [retailMediaPlanner];
