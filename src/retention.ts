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

// ── rfm_segmenter ─────────────────────────────────────────────────────────────

/** Score values into 1..5 by quintile rank. invert=true ⇒ smaller value scores higher. */
function quintileScores(values: number[], invert: boolean): number[] {
  const n = values.length;
  const indexed = values.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const scores = new Array<number>(n);
  for (let rank = 0; rank < n; rank++) {
    // ascending rank → quintile 1..5
    let q = Math.floor((rank / n) * 5) + 1;
    if (q > 5) q = 5;
    // For recency: smaller days = more recent = better, so invert (rank 0 → score 5).
    const score = invert ? 6 - q : q;
    scores[indexed[rank].i] = score;
  }
  return scores;
}

function rfmSegment(r: number, fm: number): { name: string; action: string } {
  if (r >= 4 && fm >= 4) return { name: "Champions", action: "Поощряй и удерживай: ранний доступ, статусные привилегии, реферальная программа." };
  if (r >= 3 && fm >= 4) return { name: "Loyal", action: "Допродажи и кросс-сейл, программа лояльности, сбор отзывов." };
  if (r >= 4 && fm >= 3) return { name: "Potential Loyalist", action: "Веди к лояльности: онбординг, бандлы, подписка/повтор." };
  if (r >= 4 && fm <= 2) return { name: "New / Promising", action: "Активируй: приветственная серия, лёгкое первое повторение, объясни ценность." };
  if (r === 3 && fm <= 2) return { name: "Promising", action: "Подтолкни ко второй покупке: ограниченное предложение, релевантные рекомендации." };
  if (r >= 3 && fm === 3) return { name: "Need Attention", action: "Реактивируй: персональные офферы, лимит по времени." };
  if (r <= 2 && fm >= 5) return { name: "Can't Lose Them", action: "Срочно вернуть: выгодное персональное предложение, прямой контакт, опрос почему ушли." };
  if (r <= 2 && fm >= 4) return { name: "At Risk", action: "Win-back: реактивация с сильным стимулом, напоминание о ценности." };
  if (r <= 2 && fm === 3) return { name: "About to Sleep", action: "Реактивируй до оттока: триггерная серия, ограниченный бонус." };
  if (r <= 1 && fm <= 2) return { name: "Lost", action: "Дешёвый реактивационный канал (email/push); не трать на них дорогой платный трафик." };
  if (r <= 2 && fm <= 2) return { name: "Hibernating", action: "Низкочастотная реактивация; чисти список перед платными кампаниями." };
  return { name: "Others", action: "Сегментируй точнее или собирай больше данных." };
}

const rfmSegmenter: ToolDef = {
  name: "rfm_segmenter",
  description:
    "RFM (Recency–Frequency–Monetary) customer segmentation. From a list of customers with recencyDays + frequency + monetary, it scores each on 1–5 quintiles (recency inverted — more recent = higher), combines R with the F/M average into the classic named segments (Champions, Loyal, Potential Loyalist, At Risk, Can't Lose Them, Hibernating, Lost, …), then sizes every segment (customers, share %, total & average monetary) and attaches a concrete CRM action. Surfaces the revenue concentrated in Champions and the revenue at risk (At Risk + Can't Lose Them). Deterministic segmentation on YOUR data — decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      customers: {
        type: "array",
        minItems: 5,
        description: "Customer records (≥5 for meaningful quintiles)",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "Optional customer id/name" },
            recencyDays: { type: "number", minimum: 0, description: "Days since last purchase (smaller = better)" },
            frequency: { type: "number", minimum: 0, description: "Number of purchases" },
            monetary: { type: "number", minimum: 0, description: "Total spend, ₽" },
          },
          required: ["recencyDays", "frequency", "monetary"],
          additionalProperties: false,
        },
      },
    },
    required: ["customers"],
    additionalProperties: false,
  },
  async handler(input) {
    const customers = (input.customers ?? []) as Array<{ id?: string; recencyDays: number; frequency: number; monetary: number }>;
    if (!Array.isArray(customers) || customers.length < 5) {
      return { content: [{ type: "text", text: "Ошибка: передай ≥5 клиентов с recencyDays, frequency, monetary." }], isError: true };
    }
    const recency = customers.map((c) => Number(c.recencyDays));
    const freq = customers.map((c) => Number(c.frequency));
    const money = customers.map((c) => Number(c.monetary));

    const rScores = quintileScores(recency, true);
    const fScores = quintileScores(freq, false);
    const mScores = quintileScores(money, false);

    const scored = customers.map((c, i) => {
      const r = rScores[i];
      const f = fScores[i];
      const m = mScores[i];
      const fm = Math.round((f + m) / 2);
      const seg = rfmSegment(r, fm);
      return { id: c.id ?? `#${i + 1}`, recencyDays: recency[i], frequency: freq[i], monetary: money[i], R: r, F: f, M: m, FM: fm, segment: seg.name, action: seg.action };
    });

    const totalCustomers = scored.length;
    const totalMonetary = money.reduce((s, v) => s + v, 0);

    const bySeg = new Map<string, { name: string; action: string; count: number; monetary: number; recSum: number; freqSum: number }>();
    for (const s of scored) {
      const e = bySeg.get(s.segment) ?? { name: s.segment, action: s.action, count: 0, monetary: 0, recSum: 0, freqSum: 0 };
      e.count += 1;
      e.monetary += s.monetary;
      e.recSum += s.recencyDays;
      e.freqSum += s.frequency;
      bySeg.set(s.segment, e);
    }
    const segments = [...bySeg.values()]
      .map((e) => ({
        segment: e.name,
        customers: e.count,
        sharePct: round((e.count / totalCustomers) * 100, 1),
        totalMonetary: round(e.monetary),
        monetarySharePct: totalMonetary > 0 ? round((e.monetary / totalMonetary) * 100, 1) : 0,
        avgMonetary: round(e.monetary / e.count),
        avgRecencyDays: round(e.recSum / e.count),
        avgFrequency: round(e.freqSum / e.count, 1),
        action: e.action,
      }))
      .sort((a, b) => b.totalMonetary - a.totalMonetary);

    const championsRevenue = segments.filter((s) => s.segment === "Champions").reduce((s, x) => s + x.totalMonetary, 0);
    const atRiskRevenue = segments.filter((s) => ["At Risk", "Can't Lose Them", "About to Sleep"].includes(s.segment)).reduce((s, x) => s + x.totalMonetary, 0);
    const topSeg = segments[0];

    const payload = {
      totalCustomers,
      totalMonetary: round(totalMonetary),
      segments,
      championsRevenue: round(championsRevenue),
      championsRevenueSharePct: totalMonetary > 0 ? round((championsRevenue / totalMonetary) * 100, 1) : 0,
      atRiskRevenue: round(atRiskRevenue),
      atRiskRevenueSharePct: totalMonetary > 0 ? round((atRiskRevenue / totalMonetary) * 100, 1) : 0,
      customers: scored,
      verdict:
        `${totalCustomers} клиентов в ${segments.length} сегментах. Крупнейший по выручке — «${topSeg.segment}» (${topSeg.monetarySharePct}% выручки). ` +
        `Champions держат ${round((championsRevenue / (totalMonetary || 1)) * 100, 0)}% выручки; под риском (At Risk/Can't Lose) ~${ru(round(atRiskRevenue))} ₽ — приоритет win-back.`,
      methodology:
        "Каждая метрика ранжируется по квинтилям и получает балл 1–5 (Recency инвертирован: меньше дней = выше). " +
        "Сегмент определяется по R и среднему F/M (классическая карта RFM). Размер сегмента — число клиентов, доля, суммарная и средняя выручка.",
      assumptions: [
        "Квинтили считаются по предоставленной выборке — она должна репрезентировать базу.",
        "F и M усредняются в один балл (FM); при необходимости разнесите их по своим правилам.",
        "Окно наблюдения едино для всех клиентов.",
      ],
      disclaimer: "Сегментация на ВАШИХ данных — decision support, не гарантия отклика. Подтверждайте действия тестами реактивации.",
    };

    const summary =
      `RFM: ${totalCustomers} клиентов → ${segments.length} сегментов. ` +
      `Топ по выручке: «${topSeg.segment}» (${topSeg.monetarySharePct}%). ` +
      `Под риском ~${ru(round(atRiskRevenue))} ₽ (${round((atRiskRevenue / (totalMonetary || 1)) * 100, 0)}% выручки) — нужен win-back.`;

    return toContent(summary, payload);
  },
};

export const RETENTION_TOOLS: ToolDef[] = [churnPredictor, rfmSegmenter];
