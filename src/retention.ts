/**
 * RETENTION / CRM tool group (v2.39) for NECTARIN Intelligence — Workers.
 *
 *   • churn_predictor — a churn & retention economics tool. From a monthly churn
 *     rate (given directly, or derived from a retained/started cohort, or from a
 *     monthly retention %) plus the active customer base and ARPU, it computes the
 *     annualised churn, the average customer lifetime, a survival curve to the
 *     horizon, the customers/revenue retained vs. lost, and LTV (optionally
 *     discounted). Given a retention initiative (churn reduction + program cost) it
 *     sizes the LTV uplift and the ROI of retention.
 *
 * Deterministic retention math on the operator's OWN numbers. No LLM, no PII.
 * Decision support, not a guarantee.
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

const churnPredictor: ToolDef = {
  name: "churn_predictor",
  description:
    "Churn & retention economics tool for CRM / lifecycle. Resolves a MONTHLY churn rate from one of: monthlyChurnRatePct, OR a cohort (customersStart + customersRetained over periodMonths), OR monthlyRetentionPct. Then computes annualised churn, average customer lifetime (1/churn), a survival curve to the horizon, customers & revenue retained vs. lost, and LTV (ARPU/churn, optionally discounted). Given a retention initiative (reduceChurnByPp + programCost) it sizes the LTV uplift per customer, the total uplift and the ROI of retention. Deterministic retention math on YOUR numbers — decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      monthlyChurnRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Monthly churn rate %, if known directly" },
      customersStart: { type: "number", exclusiveMinimum: 0, description: "Cohort size at start (with customersRetained → derive churn)" },
      customersRetained: { type: "number", minimum: 0, description: "Customers still active after periodMonths" },
      periodMonths: { type: "number", exclusiveMinimum: 0, description: "Months between start and retained count (default 1)" },
      monthlyRetentionPct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Alt: monthly retention % (churn = 100 − this)" },
      customers: { type: "number", minimum: 0, description: "Current active customer base (for revenue-at-risk)" },
      arpuMonthly: { type: "number", minimum: 0, description: "Average revenue per user per month (₽)" },
      horizonMonths: { type: "number", exclusiveMinimum: 0, description: "Projection horizon in months (default 12)" },
      annualDiscountRatePct: { type: "number", minimum: 0, maximum: 100, description: "Optional annual discount rate % for LTV (default 0)" },
      reduceChurnByPp: { type: "number", exclusiveMinimum: 0, description: "Retention initiative: absolute monthly-churn reduction, pp" },
      programCost: { type: "number", minimum: 0, description: "Retention initiative total cost (₽) for the base, to compute ROI" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    // ── Resolve monthly churn ────────────────────────────────────────────────
    let m: number | null = null;
    let source = "";
    if (typeof input.monthlyChurnRatePct === "number" && input.monthlyChurnRatePct > 0) {
      m = clamp(input.monthlyChurnRatePct, 0, 100) / 100;
      source = "monthlyChurnRatePct";
    } else if (typeof input.monthlyRetentionPct === "number" && input.monthlyRetentionPct > 0) {
      m = clamp(100 - input.monthlyRetentionPct, 0, 100) / 100;
      source = "monthlyRetentionPct";
    } else if (
      typeof input.customersStart === "number" && input.customersStart > 0 &&
      typeof input.customersRetained === "number" && input.customersRetained >= 0
    ) {
      const periods = typeof input.periodMonths === "number" && input.periodMonths > 0 ? input.periodMonths : 1;
      const retainedFrac = clamp(input.customersRetained / input.customersStart, 0, 1);
      m = 1 - Math.pow(retainedFrac, 1 / periods);
      source = "cohort";
    }

    if (m == null) {
      return {
        content: [
          { type: "text", text: "Ошибка: задай monthlyChurnRatePct, либо monthlyRetentionPct, либо customersStart+customersRetained(+periodMonths)." },
        ],
        isError: true,
      };
    }
    if (m <= 0) m = 0.0001; // guard against div-by-zero while staying meaningful

    const horizon = typeof input.horizonMonths === "number" && input.horizonMonths > 0 ? Math.round(input.horizonMonths) : 12;
    const annualChurn = 1 - Math.pow(1 - m, 12);
    const avgLifetimeMonths = 1 / m;
    const survivalAtHorizon = Math.pow(1 - m, horizon);

    const customers = typeof input.customers === "number" && input.customers >= 0 ? input.customers : null;
    const arpu = typeof input.arpuMonthly === "number" && input.arpuMonthly >= 0 ? input.arpuMonthly : null;
    const dAnnual = typeof input.annualDiscountRatePct === "number" ? clamp(input.annualDiscountRatePct, 0, 100) / 100 : 0;
    const dMonthly = dAnnual > 0 ? Math.pow(1 + dAnnual, 1 / 12) - 1 : 0;

    // LTV = ARPU × Σ (1−m)^t / (1+dMonthly)^t  (t≥1) = ARPU × s/(1−s), s=(1−m)/(1+dMonthly)
    const s = (1 - m) / (1 + dMonthly);
    const ltv = arpu != null ? (s < 1 ? arpu * (s / (1 - s)) : arpu * horizon) : null;

    // Revenue projection over the horizon (discounted).
    let revenueRetained = 0;
    let revenueNoChurn = 0;
    if (customers != null && arpu != null) {
      for (let t = 1; t <= horizon; t++) {
        const disc = Math.pow(1 + dMonthly, t);
        revenueRetained += (customers * Math.pow(1 - m, t) * arpu) / disc;
        revenueNoChurn += (customers * arpu) / disc;
      }
    }
    const revenueLost = revenueNoChurn - revenueRetained;
    const customersRemaining = customers != null ? customers * survivalAtHorizon : null;
    const customersLost = customers != null ? customers - (customersRemaining ?? 0) : null;

    // ── Retention initiative ROI ─────────────────────────────────────────────
    let initiative: Record<string, unknown> | null = null;
    if (typeof input.reduceChurnByPp === "number" && input.reduceChurnByPp > 0) {
      const newM = clamp(m - input.reduceChurnByPp / 100, 0.0001, 1);
      const sNew = (1 - newM) / (1 + dMonthly);
      const newLtv = arpu != null ? (sNew < 1 ? arpu * (sNew / (1 - sNew)) : arpu * horizon) : null;
      const deltaLtvPerCustomer = ltv != null && newLtv != null ? newLtv - ltv : null;
      const totalUplift = deltaLtvPerCustomer != null && customers != null ? deltaLtvPerCustomer * customers : null;
      const programCost = typeof input.programCost === "number" && input.programCost >= 0 ? input.programCost : null;
      const roiPct = totalUplift != null && programCost != null && programCost > 0 ? ((totalUplift - programCost) / programCost) * 100 : null;
      initiative = {
        reduceChurnByPp: round(input.reduceChurnByPp, 2),
        newMonthlyChurnPct: round(newM * 100, 2),
        newAvgLifetimeMonths: round(1 / newM, 1),
        newLtv: newLtv != null ? round(newLtv) : null,
        deltaLtvPerCustomer: deltaLtvPerCustomer != null ? round(deltaLtvPerCustomer) : null,
        totalLtvUplift: totalUplift != null ? round(totalUplift) : null,
        programCost: programCost != null ? round(programCost) : null,
        roiPct: roiPct != null ? round(roiPct, 1) : null,
        verdict:
          roiPct != null
            ? roiPct > 0
              ? `Удержание окупается: +${ru(round(totalUplift as number))} ₽ LTV против ${ru(round(programCost as number))} ₽ затрат — ROI ${round(roiPct, 0)}%.`
              : `Программа не окупается при этих вводных: прирост LTV ${ru(round(totalUplift as number))} ₽ < затрат ${ru(round(programCost as number))} ₽.`
            : deltaLtvPerCustomer != null
              ? `Снижение оттока на ${input.reduceChurnByPp} п.п. даёт +${ru(round(deltaLtvPerCustomer))} ₽ LTV на клиента. Добавь programCost для ROI.`
              : "Добавь arpuMonthly (и customers), чтобы оценить эффект в деньгах.",
      };
    }

    const payload = {
      churnSource: source,
      monthlyChurnPct: round(m * 100, 2),
      annualChurnPct: round(annualChurn * 100, 1),
      avgLifetimeMonths: round(avgLifetimeMonths, 1),
      horizonMonths: horizon,
      survivalAtHorizonPct: round(survivalAtHorizon * 100, 1),
      customers: customers != null ? round(customers) : null,
      customersRemainingAtHorizon: customersRemaining != null ? round(customersRemaining) : null,
      customersLostAtHorizon: customersLost != null ? round(customersLost) : null,
      arpuMonthly: arpu != null ? round(arpu) : null,
      annualDiscountRatePct: round(dAnnual * 100, 1),
      ltvPerCustomer: ltv != null ? round(ltv) : null,
      revenue: customers != null && arpu != null ? {
        monthlyNow: round(customers * arpu),
        retainedOverHorizon: round(revenueRetained),
        revenueAtRiskOverHorizon: round(revenueLost),
      } : null,
      retentionInitiative: initiative,
      verdict:
        `Месячный отток ${round(m * 100, 1)}% ⇒ годовой ${round(annualChurn * 100, 0)}%, средний срок жизни ~${round(avgLifetimeMonths, 1)} мес.` +
        (customers != null && arpu != null ? ` За ${horizon} мес. под риском ~${ru(round(revenueLost))} ₽ выручки.` : "") +
        (ltv != null ? ` LTV ~${ru(round(ltv))} ₽/клиент.` : ""),
      methodology:
        "Месячный отток m (задан, = 100−retention, или = 1−(retained/start)^(1/periods)). Годовой = 1−(1−m)¹². Срок жизни = 1/m. " +
        "Выживаемость = (1−m)^t. LTV = ARPU×s/(1−s), s=(1−m)/(1+d_мес), d_мес из годовой ставки. ROI удержания = (прирост LTV − затраты)/затраты.",
      assumptions: [
        "Отток постоянен во времени (геометрическая модель); реальные кривые удержания обычно выпуклые — для точности используйте когорты.",
        "ARPU стабилен; апсейл/даунсейл не моделируются отдельно.",
        "Эффект инициативы — мгновенный сдвиг месячного оттока на reduceChurnByPp.",
      ],
      disclaimer: "Оценка на ВАШИХ данных, не гарантия. Калибруйте по реальным когортам и сезонности.",
    };

    const summary =
      `Отток: ${round(m * 100, 1)}%/мес (≈${round(annualChurn * 100, 0)}%/год), срок жизни ~${round(avgLifetimeMonths, 1)} мес` +
      (ltv != null ? `, LTV ~${ru(round(ltv))} ₽` : "") +
      (customers != null && arpu != null ? `; под риском ~${ru(round(revenueLost))} ₽ за ${horizon} мес` : "") +
      (initiative && (initiative as any).roiPct != null ? `. Удержание: ROI ${round((initiative as any).roiPct, 0)}%.` : ".");

    return toContent(summary, payload);
  },
};

export const RETENTION_TOOLS: ToolDef[] = [churnPredictor];
