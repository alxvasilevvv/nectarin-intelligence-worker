/**
 * B2B & CX tool group (v2.55) for NECTARIN Intelligence — Workers.
 * Closes two under-served profession clusters in the catalogue: B2B / demand-gen / revenue
 * marketing, and customer experience / loyalty.
 *
 *   • abm_account_scoring — ABM/B2B account prioritization. Weights fit × intent ×
 *     engagement into a 0–100 score, assigns each account a tier (1:1 / 1:few / 1:many /
 *     nurture) with a recommended play, and (given deal size) an expected-value ranking.
 *   • nps_analysis — CX/loyalty. From raw 0–10 scores or promoter/passive/detractor counts
 *     it computes NPS, the segment split, a 95% confidence interval and a benchmark read.
 *   • b2b_pipeline_velocity — revenue marketing. Velocity = (opps × win-rate × deal size) /
 *     sales-cycle days, annualized, plus a +10% lever sensitivity to find the best lever.
 *
 * Deterministic math on YOUR inputs — planning estimates, not guarantees.
 */

import type { ToolDef, ToolResult } from "./tools.js";

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
function errResult(message: string, extra?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, ...(extra ?? {}) },
    isError: true,
  };
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function ru(n: number): string {
  try {
    return Math.round(n).toLocaleString("ru-RU");
  } catch {
    return String(Math.round(n));
  }
}

// ── 1. ABM account scoring ───────────────────────────────────────────────────

const ABM_TIERS = [
  { min: 75, tier: "1:1 (стратегический)", play: "Персональный аккаунт-план, кастом-контент, ABM-объявления на лиц, принимающих решения, синхрон с продажами." },
  { min: 50, tier: "1:few (кластер)", play: "Отраслевые плейбуки на 5–15 похожих аккаунтов, таргет по индустрии/роли, среднеформатная персонализация." },
  { min: 30, tier: "1:many (программный)", play: "Скейл-кампании по сегменту, lead-nurturing, ретаргет; ручной труд минимален." },
  { min: 0, tier: "nurture / отложить", play: "Низкий приоритет: образовательный контент и реактивация по триггеру интента." },
];
function tierFor(score: number): { tier: string; play: string } {
  let chosen = ABM_TIERS[ABM_TIERS.length - 1];
  for (const t of ABM_TIERS) if (score >= t.min) { chosen = t; break; }
  return { tier: chosen.tier, play: chosen.play };
}

const abmAccountScoring: ToolDef = {
  name: "abm_account_scoring",
  description:
    "ABM / B2B account prioritization for a demand-gen or account-based marketer. For each target account give fit (ICP match 0–100), intent (buying signals 0–100) and engagement (your touch/response 0–100), optional dealSize ₽. It computes a weighted 0–100 priority score (default weights fit .40 / intent .35 / engagement .25, overridable), assigns a tier (1:1 / 1:few / 1:many / nurture) with a recommended play, and — when dealSize is given — an expected-value ranking (score × dealSize). Deterministic weighting on your inputs.",
  inputSchema: {
    type: "object",
    properties: {
      accounts: {
        type: "array",
        minItems: 1,
        description: "Target accounts to score",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Account name" },
            fit: { type: "number", minimum: 0, maximum: 100, description: "ICP fit, 0–100" },
            intent: { type: "number", minimum: 0, maximum: 100, description: "Buying-intent signals, 0–100" },
            engagement: { type: "number", minimum: 0, maximum: 100, description: "Engagement with you, 0–100" },
            dealSize: { type: "number", minimum: 0, description: "Optional potential deal size (RUB)" },
          },
          required: ["name", "fit", "intent", "engagement"],
          additionalProperties: false,
        },
      },
      weights: {
        type: "object",
        description: "Optional weight override (will be normalized). Keys: fit, intent, engagement.",
        properties: {
          fit: { type: "number", minimum: 0 },
          intent: { type: "number", minimum: 0 },
          engagement: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    required: ["accounts"],
    additionalProperties: false,
  },
  async handler(input) {
    const raw = Array.isArray(input?.accounts) ? input.accounts : [];
    const w = isRecord(input?.weights) ? input.weights : {};
    let wf = num(w.fit) ?? 0.4;
    let wi = num(w.intent) ?? 0.35;
    let we = num(w.engagement) ?? 0.25;
    const wsum = wf + wi + we;
    if (wsum <= 0) {
      wf = 0.4;
      wi = 0.35;
      we = 0.25;
    } else {
      wf /= wsum;
      wi /= wsum;
      we /= wsum;
    }

    const scored: Array<Record<string, unknown>> = [];
    for (const a of raw) {
      if (!isRecord(a)) continue;
      const name = typeof a.name === "string" ? a.name : "";
      const fit = num(a.fit);
      const intent = num(a.intent);
      const engagement = num(a.engagement);
      if (!name || fit === null || intent === null || engagement === null) continue;
      const f = clamp(fit, 0, 100);
      const i = clamp(intent, 0, 100);
      const e = clamp(engagement, 0, 100);
      const score = round(wf * f + wi * i + we * e, 1);
      const t = tierFor(score);
      const dealSize = num(a.dealSize);
      const expectedValue = dealSize !== null ? round((score / 100) * dealSize, 0) : null;
      scored.push({ name, fit: f, intent: i, engagement: e, score, tier: t.tier, recommendedPlay: t.play, dealSize: dealSize ?? null, expectedValue });
    }
    if (scored.length === 0) {
      return errResult("Не удалось разобрать аккаунты. Нужны поля name, fit, intent, engagement (0–100).");
    }
    const haveValue = scored.some((s) => s.expectedValue !== null);
    scored.sort((a, b) =>
      haveValue
        ? (Number(b.expectedValue ?? 0) - Number(a.expectedValue ?? 0)) || (Number(b.score) - Number(a.score))
        : Number(b.score) - Number(a.score)
    );
    scored.forEach((s, i) => (s.rank = i + 1));

    const tierCounts: Record<string, number> = {};
    for (const s of scored) tierCounts[String(s.tier)] = (tierCounts[String(s.tier)] ?? 0) + 1;
    const top = scored[0];
    const summary =
      `ABM-скоринг ${scored.length} аккаунтов (веса fit ${round(wf, 2)} / intent ${round(wi, 2)} / engagement ${round(we, 2)}). ` +
      `Топ-приоритет: «${top.name}» — ${top.score}/100, ${top.tier}` +
      (top.expectedValue !== null ? `, ожидаемая ценность ~${ru(Number(top.expectedValue))} ₽.` : ".");

    return toContent(summary, {
      tool: "abm_account_scoring",
      weights: { fit: round(wf, 3), intent: round(wi, 3), engagement: round(we, 3) },
      tierCounts,
      accounts: scored,
      note: "Скор = взвешенная сумма fit/intent/engagement (0–100). Тиры: ≥75 1:1, ≥50 1:few, ≥30 1:many, иначе nurture. Сортировка по ожидаемой ценности, если задан dealSize.",
    });
  },
};

// ── 2. NPS analysis ──────────────────────────────────────────────────────────

const npsAnalysis: ToolDef = {
  name: "nps_analysis",
  description:
    "Net Promoter Score (NPS) analysis for a CX / customer-marketing / loyalty owner. Provide either raw 0–10 `scores` or aggregate `counts` {promoters, passives, detractors}. It returns the segment split (promoters 9–10, passives 7–8, detractors 0–6), the NPS (−100..+100), a 95% confidence interval (NPS standard error), and a benchmark interpretation band. Deterministic survey math.",
  inputSchema: {
    type: "object",
    properties: {
      scores: { type: "array", items: { type: "number", minimum: 0, maximum: 10 }, description: "Raw 0–10 responses (use this OR counts)" },
      counts: {
        type: "object",
        description: "Aggregate counts (use this OR scores)",
        properties: {
          promoters: { type: "number", minimum: 0 },
          passives: { type: "number", minimum: 0 },
          detractors: { type: "number", minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  async handler(input) {
    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    if (Array.isArray(input?.scores) && input.scores.length > 0) {
      for (const s of input.scores) {
        const v = num(s);
        if (v === null) continue;
        const x = clamp(Math.round(v), 0, 10);
        if (x >= 9) promoters++;
        else if (x >= 7) passives++;
        else detractors++;
      }
    } else if (isRecord(input?.counts)) {
      promoters = Math.max(0, Math.round(num(input.counts.promoters) ?? 0));
      passives = Math.max(0, Math.round(num(input.counts.passives) ?? 0));
      detractors = Math.max(0, Math.round(num(input.counts.detractors) ?? 0));
    } else {
      return errResult("Передайте либо scores (массив 0–10), либо counts {promoters, passives, detractors}.");
    }

    const n = promoters + passives + detractors;
    if (n === 0) {
      return errResult("Нет ни одного валидного ответа.");
    }
    const pP = promoters / n;
    const pD = detractors / n;
    const nps = round((pP - pD) * 100, 1);

    // Variance of (promoter - detractor) indicator; SE of NPS (in points, ×100).
    const variance = pP + pD - (pP - pD) ** 2;
    const seFraction = Math.sqrt(variance / n);
    const moe = round(1.96 * seFraction * 100, 1); // 95% margin of error, in NPS points
    const ci95 = [round(nps - moe, 1), round(nps + moe, 1)];

    let band: string;
    if (nps < 0) band = "зона риска (детракторов больше, чем промоутеров)";
    else if (nps < 30) band = "нормально (есть куда расти)";
    else if (nps < 50) band = "хорошо";
    else if (nps < 70) band = "отлично";
    else band = "мирового класса";

    const summary =
      `NPS = ${nps} (95% ДИ ${ci95[0]}…${ci95[1]}, n=${n}). ` +
      `Промоутеры ${round(pP * 100, 1)}% / пассивные ${round((passives / n) * 100, 1)}% / детракторы ${round(pD * 100, 1)}%. Оценка: ${band}.`;

    return toContent(summary, {
      tool: "nps_analysis",
      n,
      segments: {
        promoters,
        passives,
        detractors,
        promoterPct: round(pP * 100, 1),
        passivePct: round((passives / n) * 100, 1),
        detractorPct: round(pD * 100, 1),
      },
      nps,
      marginOfError95: moe,
      ci95,
      interpretation: band,
      note: "NPS = %промоутеров − %детракторов. ДИ через SE = √((p_p + p_d − (p_p − p_d)²)/n). Бэнды — ориентир, сравнивайте с отраслью и динамикой.",
    });
  },
};

// ── 3. B2B pipeline velocity ─────────────────────────────────────────────────

const b2bPipelineVelocity: ToolDef = {
  name: "b2b_pipeline_velocity",
  description:
    "B2B sales/pipeline velocity for a revenue / demand-gen marketer. Velocity = (qualified opportunities × win-rate × average deal size) ÷ sales-cycle length (days) = revenue generated per day. Returns daily/monthly/annual velocity and a +10% lever sensitivity (opportunities, win-rate, deal size, and a −10% on cycle length) to reveal the highest-leverage improvement. Deterministic formula on your funnel numbers.",
  inputSchema: {
    type: "object",
    properties: {
      opportunities: { type: "number", exclusiveMinimum: 0, description: "Number of qualified opportunities in the pipeline" },
      winRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Win rate, %" },
      avgDealSize: { type: "number", exclusiveMinimum: 0, description: "Average deal size, RUB" },
      salesCycleDays: { type: "number", exclusiveMinimum: 0, description: "Average sales-cycle length, days" },
    },
    required: ["opportunities", "winRatePct", "avgDealSize", "salesCycleDays"],
    additionalProperties: false,
  },
  async handler(input) {
    const opps = num(input?.opportunities);
    const win = num(input?.winRatePct);
    const deal = num(input?.avgDealSize);
    const cycle = num(input?.salesCycleDays);
    if (opps === null || win === null || deal === null || cycle === null || opps <= 0 || win <= 0 || deal <= 0 || cycle <= 0) {
      return errResult("Нужны положительные opportunities, winRatePct, avgDealSize, salesCycleDays.");
    }
    const w = win / 100;
    const velocity = (opps * w * deal) / cycle; // RUB/day
    const perDay = round(velocity, 0);

    const lever = (vOpps: number, vWin: number, vDeal: number, vCycle: number) =>
      (vOpps * (vWin / 100) * vDeal) / vCycle;
    const base = lever(opps, win, deal, cycle);
    const sensitivity = [
      { lever: "Кол-во сделок +10%", newPerDay: round(lever(opps * 1.1, win, deal, cycle), 0) },
      { lever: "Win-rate +10%", newPerDay: round(lever(opps, win * 1.1, deal, cycle), 0) },
      { lever: "Средний чек +10%", newPerDay: round(lever(opps, win, deal * 1.1, cycle), 0) },
      { lever: "Цикл сделки −10%", newPerDay: round(lever(opps, win, deal, cycle * 0.9), 0) },
    ].map((s) => ({ ...s, upliftPct: round(((s.newPerDay - base) / base) * 100, 1) }));
    const best = [...sensitivity].sort((a, b) => b.upliftPct - a.upliftPct)[0];

    const summary =
      `Скорость пайплайна ~${ru(perDay)} ₽/день (≈${ru(perDay * 30)} ₽/мес, ≈${ru(perDay * 365)} ₽/год). ` +
      `Лучший рычаг: ${best.lever} → +${best.upliftPct}%.`;

    return toContent(summary, {
      tool: "b2b_pipeline_velocity",
      inputs: { opportunities: opps, winRatePct: win, avgDealSize: deal, salesCycleDays: cycle },
      velocityPerDay: perDay,
      velocityPerMonth: round(perDay * 30, 0),
      velocityPerYear: round(perDay * 365, 0),
      sensitivity,
      bestLever: best.lever,
      note: "Velocity = (opps × win-rate × deal) ÷ cycle days. Цикл сделки −10% эквивалентно ускорению оборота; чувствительность показывает рычаг с максимальным эффектом.",
    });
  },
};

// ── 4. Win/loss analysis ─────────────────────────────────────────────────────

const winLossAnalysis: ToolDef = {
  name: "win_loss_analysis",
  description:
    "B2B win/loss analysis for a revenue / product-marketing team. From closed deals (outcome won|lost, optional reason, segment, value ₽) it computes the overall win rate (by count and by value), win rate by segment, the top loss reasons and top win reasons (count + value impact), and prioritized recommendations targeting the biggest loss drivers. Deterministic aggregation on your CRM export.",
  inputSchema: {
    type: "object",
    properties: {
      deals: {
        type: "array",
        minItems: 1,
        description: "Closed deals",
        items: {
          type: "object",
          properties: {
            outcome: { type: "string", enum: ["won", "lost"], description: "Deal outcome" },
            reason: { type: "string", description: "Optional win/loss reason, e.g. 'цена', 'функционал', 'конкурент'" },
            segment: { type: "string", description: "Optional segment, e.g. 'enterprise', 'SMB', industry" },
            value: { type: "number", minimum: 0, description: "Optional deal value (RUB)" },
          },
          required: ["outcome"],
          additionalProperties: false,
        },
      },
    },
    required: ["deals"],
    additionalProperties: false,
  },
  async handler(input) {
    const raw = Array.isArray(input?.deals) ? input.deals : [];
    let won = 0;
    let lost = 0;
    let wonValue = 0;
    let lostValue = 0;
    const lossReasons = new Map<string, { count: number; value: number }>();
    const winReasons = new Map<string, { count: number; value: number }>();
    const bySegment = new Map<string, { won: number; lost: number }>();

    for (const d of raw) {
      if (!isRecord(d)) continue;
      const outcome = d.outcome === "won" ? "won" : d.outcome === "lost" ? "lost" : null;
      if (!outcome) continue;
      const value = num(d.value) ?? 0;
      const reason = (typeof d.reason === "string" && d.reason.trim()) || "не указана";
      const segment = (typeof d.segment === "string" && d.segment.trim()) || "не указан";
      const seg = bySegment.get(segment) ?? { won: 0, lost: 0 };
      if (outcome === "won") {
        won++;
        wonValue += value;
        const w = winReasons.get(reason) ?? { count: 0, value: 0 };
        w.count++;
        w.value += value;
        winReasons.set(reason, w);
        seg.won++;
      } else {
        lost++;
        lostValue += value;
        const l = lossReasons.get(reason) ?? { count: 0, value: 0 };
        l.count++;
        l.value += value;
        lossReasons.set(reason, l);
        seg.lost++;
      }
      bySegment.set(segment, seg);
    }
    const total = won + lost;
    if (total === 0) {
      return errResult("Не удалось разобрать сделки. Нужно поле outcome ('won' | 'lost').");
    }
    const winRatePct = round((won / total) * 100, 1);
    const winRateByValuePct = wonValue + lostValue > 0 ? round((wonValue / (wonValue + lostValue)) * 100, 1) : null;

    const topLoss = [...lossReasons.entries()]
      .map(([reason, v]) => ({ reason, count: v.count, valueLost: round(v.value, 0) }))
      .sort((a, b) => b.count - a.count || b.valueLost - a.valueLost);
    const topWin = [...winReasons.entries()]
      .map(([reason, v]) => ({ reason, count: v.count, valueWon: round(v.value, 0) }))
      .sort((a, b) => b.count - a.count || b.valueWon - a.valueWon);
    const segments = [...bySegment.entries()]
      .map(([segment, v]) => ({ segment, won: v.won, lost: v.lost, winRatePct: round((v.won / (v.won + v.lost)) * 100, 1) }))
      .sort((a, b) => b.winRatePct - a.winRatePct);

    const recommendations: string[] = [];
    if (topLoss[0]) recommendations.push(`Главная причина проигрышей — «${topLoss[0].reason}» (${topLoss[0].count} сделок). Адресуйте её в позиционировании/оффере и материалах для продаж.`);
    const weakSeg = [...segments].sort((a, b) => a.winRatePct - b.winRatePct)[0];
    if (weakSeg && weakSeg.won + weakSeg.lost >= 2) recommendations.push(`Слабый сегмент — «${weakSeg.segment}» (win-rate ${weakSeg.winRatePct}%). Проверьте ICP-фит и плейбук под него.`);
    if (topWin[0]) recommendations.push(`Усильте то, что приносит победы — «${topWin[0].reason}»: вынесите в ключевые сообщения и кейсы.`);

    const summary =
      `Win/loss по ${total} сделкам: win-rate ${winRatePct}%` +
      (winRateByValuePct !== null ? ` (по сумме ${winRateByValuePct}%)` : "") +
      `. Топ-причина проигрышей: ${topLoss[0]?.reason ?? "—"}.`;

    return toContent(summary, {
      tool: "win_loss_analysis",
      totals: { deals: total, won, lost, winRatePct, winRateByValuePct, wonValue: round(wonValue, 0), lostValue: round(lostValue, 0) },
      topLossReasons: topLoss,
      topWinReasons: topWin,
      bySegment: segments,
      recommendations,
      note: "Подсчёт по вашему экспорту из CRM. Win-rate по количеству и по сумме; рекомендации нацелены на крупнейшие драйверы проигрышей.",
    });
  },
};

export const B2BCX_TOOLS: ToolDef[] = [abmAccountScoring, npsAnalysis, b2bPipelineVelocity, winLossAnalysis];
