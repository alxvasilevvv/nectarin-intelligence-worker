/**
 * MEDIA (OLV / display) tool group (v2.22) for NECTARIN Intelligence — Workers.
 *
 *   • reach_frequency — a reach & frequency planner for online video (OLV) and
 *     display. From a budget + CPM (or impressions directly) and the target
 *     audience universe it computes gross impressions, GRPs, NET reach (people &
 *     %), average frequency among reached, the full contact distribution, and the
 *     EFFECTIVE reach at ≥N exposures (Poisson contact model). With an optional
 *     frequency cap it estimates wasted impressions above the cap and the potential
 *     reach gain from reallocating them. Returns cost-per-reached-person and a
 *     verdict (under-/over-frequency).
 *
 * Classic media math (Poisson exposure model), fully deterministic, on the
 * operator's OWN plan inputs. No LLM, no PII. Planning estimate, not a guarantee.
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

/** Poisson pmf p(i) for i=0..maxI, plus E[max(X-cap,0)] when a cap is given. */
function poisson(lambda: number, maxI: number): number[] {
  const out: number[] = [];
  let p = Math.exp(-lambda); // p(0)
  out.push(p);
  for (let i = 1; i <= maxI; i++) {
    p = (p * lambda) / i;
    out.push(p);
  }
  return out;
}

const reachFrequency: ToolDef = {
  name: "reach_frequency",
  description:
    "Reach & frequency planner for OLV (online video) and display. From a budget + CPM (or impressions directly) and the target audience universe, computes gross impressions, GRPs, NET reach (people & %), average frequency among reached, the full contact distribution, and EFFECTIVE reach at ≥N exposures using a Poisson exposure model. With an optional frequencyCap it estimates impressions wasted above the cap and the potential reach gain from reallocating them, plus cost-per-reached-person and an under-/over-frequency verdict. Deterministic media math on YOUR plan inputs — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      audienceSize: { type: "number", exclusiveMinimum: 0, description: "Target audience universe (people)" },
      budget: { type: "number", exclusiveMinimum: 0, description: "Media budget, RUB (use with cpm). Omit if you pass impressions." },
      cpm: { type: "number", exclusiveMinimum: 0, description: "Cost per 1000 impressions, RUB (required with budget)" },
      impressions: { type: "number", exclusiveMinimum: 0, description: "Gross impressions directly (alternative to budget+cpm)" },
      effectiveFreq: { type: "number", minimum: 1, description: "Effective-frequency threshold N for ≥N exposures. Default 3." },
      frequencyCap: { type: "number", minimum: 1, description: "Optional frequency cap per person — estimates wasted over-cap impressions" },
    },
    required: ["audienceSize"],
    additionalProperties: false,
  },
  async handler(input) {
    const universe = Number(input.audienceSize);
    if (!(universe > 0)) {
      return { content: [{ type: "text", text: "Ошибка: audienceSize должен быть > 0." }], isError: true };
    }
    let impressions: number;
    let budget: number | null = null;
    let cpm: number | null = null;
    if (typeof input.impressions === "number" && input.impressions > 0) {
      impressions = Number(input.impressions);
      if (typeof input.cpm === "number" && input.cpm > 0) {
        cpm = Number(input.cpm);
        budget = (impressions / 1000) * cpm;
      }
    } else if (typeof input.budget === "number" && input.budget > 0 && typeof input.cpm === "number" && input.cpm > 0) {
      budget = Number(input.budget);
      cpm = Number(input.cpm);
      impressions = (budget / cpm) * 1000;
    } else {
      return {
        content: [{ type: "text", text: "Ошибка: передай impressions, либо budget + cpm." }],
        isError: true,
      };
    }

    const effectiveFreq = typeof input.effectiveFreq === "number" && input.effectiveFreq >= 1 ? Math.round(input.effectiveFreq) : 3;
    const cap = typeof input.frequencyCap === "number" && input.frequencyCap >= 1 ? Math.round(input.frequencyCap) : null;

    const lambda = impressions / universe; // mean contacts per person (uncapped)
    const reachFraction = 1 - Math.exp(-lambda);
    const reachPeople = universe * reachFraction;
    const avgFrequency = reachFraction > 0 ? lambda / reachFraction : 0;
    const grps = lambda * 100;

    // Contact distribution and effective reach (≥ effectiveFreq).
    const maxI = Math.max(8, effectiveFreq + 3, (cap ?? 0) + 3);
    const pmf = poisson(lambda, maxI);
    let cumBelowEff = 0;
    for (let i = 0; i < effectiveFreq; i++) cumBelowEff += pmf[i] ?? 0;
    const effReachFraction = Math.max(0, 1 - cumBelowEff);
    const effReachPeople = universe * effReachFraction;

    const distribution = pmf.slice(0, Math.min(pmf.length, effectiveFreq + 4)).map((p, i) => ({
      exposures: i,
      pct: round(p * 100, 2),
      people: round(universe * p),
    }));

    // Optional frequency cap: wasted impressions above the cap (E[(X-cap)+]·universe).
    let capInfo: Record<string, unknown> | null = null;
    if (cap != null) {
      const tail = poisson(lambda, cap + 60);
      let expExcess = 0;
      for (let i = cap + 1; i < tail.length; i++) expExcess += (i - cap) * tail[i];
      const wastedImpressions = universe * expExcess;
      // Potential extra reach if wasted impressions served only to not-yet-reached people (upper bound, 1 contact each):
      const notReached = universe - reachPeople;
      const extraReach = Math.min(notReached, wastedImpressions);
      capInfo = {
        cap,
        wastedImpressionsAboveCap: round(wastedImpressions),
        wastedPctOfTotal: round((wastedImpressions / impressions) * 100, 1),
        potentialExtraReachIfReallocated: round(extraReach),
        note: "Оценка верхней границы: показы сверх кэпа, перераспределённые на неохваченных (1 контакт каждому).",
      };
    }

    const costPerReached = budget != null && reachPeople > 0 ? budget / reachPeople : null;
    const cpm_out = cpm != null ? round(cpm) : impressions > 0 && budget != null ? round((budget / impressions) * 1000) : null;

    let verdict: string;
    if (avgFrequency < effectiveFreq * 0.6)
      verdict = `Низкая частота (avg ${round(avgFrequency, 1)} < эффективной ${effectiveFreq}) — эффективного охвата мало, увеличь бюджет или сузь аудиторию.`;
    else if (avgFrequency > effectiveFreq * 2.2)
      verdict = `Переконтакт (avg ${round(avgFrequency, 1)} ≫ ${effectiveFreq}) — ставь frequency cap или расширяй аудиторию.`;
    else verdict = `Частота сбалансирована (avg ${round(avgFrequency, 1)} около эффективной ${effectiveFreq}).`;

    const payload = {
      inputs: {
        audienceSize: round(universe),
        budget: budget != null ? round(budget) : null,
        cpm: cpm_out,
        effectiveFreq,
        frequencyCap: cap,
      },
      grossImpressions: round(impressions),
      grps: round(grps, 1),
      netReach: {
        people: round(reachPeople),
        pct: round(reachFraction * 100, 1),
      },
      averageFrequency: round(avgFrequency, 2),
      effectiveReach: {
        threshold: effectiveFreq,
        people: round(effReachPeople),
        pct: round(effReachFraction * 100, 1),
      },
      costPerReachedPerson: costPerReached != null ? round(costPerReached, 2) : null,
      contactDistribution: distribution,
      frequencyCap: capInfo,
      verdict,
      methodology:
        "Poisson exposure model: λ = impressions/universe; net reach = 1−e^(−λ); avg frequency = λ/(1−e^(−λ)); effective reach (≥N) = 1−Σ P(i<N); GRP = λ·100.",
      assumptions: [
        "Случайное распределение контактов (Пуассон) — реальные DSP/таргет дают неравномерность; это плановая оценка.",
        "Один источник/кампания; пересечение каналов не моделируется (см. channel_overlap при мультиканале).",
        "CPM и universe — ваши вводные; точность результата зависит от их точности.",
      ],
      disclaimer: "Плановая оценка, не гарантия фактической доставки. Сверяйте с post-buy замером.",
    };

    const summary =
      `OLV/медийный план: ${ru(round(impressions))} показов на аудиторию ${ru(round(universe))}. ` +
      `Чистый охват ${round(reachFraction * 100, 1)}% (${ru(round(reachPeople))} чел.), avg частота ${round(avgFrequency, 1)}, ` +
      `эффективный охват ≥${effectiveFreq}: ${round(effReachFraction * 100, 1)}%` +
      (costPerReached != null ? `, цена за охваченного ${ru(round(costPerReached, 2))} ₽.` : ".") +
      ` ${verdict}`;

    return toContent(summary, payload);
  },
};

// ── channel_overlap ──────────────────────────────────────────────────────────

interface ChannelReachIn {
  name: string;
  reachPct?: number;
  reachPeople?: number;
}

const channelOverlap: ToolDef = {
  name: "channel_overlap",
  description:
    "Omnichannel deduplicated reach estimator. Given a shared audience universe and ≥2 channels' individual reach (reachPct of universe, or reachPeople), computes the combined NET deduplicated reach under the independence (Sainsbury) model, the gross summed reach, the duplication/overlap (people & %), and each channel's incremental UNIQUE reach (leave-one-out) — i.e. how much net reach it adds on top of the others. Flags the most additive and most duplicated channels. Deterministic planning estimate (assumes random duplication) — pair with reach_frequency for single-channel R&F.",
  inputSchema: {
    type: "object",
    properties: {
      audienceSize: { type: "number", exclusiveMinimum: 0, description: "Shared target audience universe (people)" },
      channels: {
        type: "array",
        minItems: 2,
        description: "Channels with their individual reach within the universe",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name (TV / OLV / display / social / search / OOH …)" },
            reachPct: { type: "number", minimum: 0, maximum: 100, description: "Channel reach as % of the universe" },
            reachPeople: { type: "number", minimum: 0, description: "Channel reach in people (alt to reachPct)" },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    },
    required: ["audienceSize", "channels"],
    additionalProperties: false,
  },
  async handler(input) {
    const universe = Number(input.audienceSize);
    const chans = (input.channels ?? []) as ChannelReachIn[];
    if (!(universe > 0) || chans.length < 2) {
      return {
        content: [{ type: "text", text: "Ошибка: нужны audienceSize > 0 и ≥2 канала с reachPct или reachPeople." }],
        isError: true,
      };
    }

    const fr = chans.map((c) => {
      let r = 0;
      if (typeof c.reachPct === "number") r = c.reachPct / 100;
      else if (typeof c.reachPeople === "number") r = c.reachPeople / universe;
      return { name: String(c.name ?? ""), r: Math.max(0, Math.min(1, r)) };
    });

    const prodAll = fr.reduce((acc, c) => acc * (1 - c.r), 1);
    const combinedFraction = 1 - prodAll;
    const combinedPeople = universe * combinedFraction;
    const grossPeople = fr.reduce((s, c) => s + c.r * universe, 0);
    const duplicationPeople = grossPeople - combinedPeople;

    const channels = fr.map((c) => {
      // Leave-one-out: net reach of all others, so incremental = combined − others.
      const prodOthers = fr.reduce((acc, o) => (o === c ? acc : acc * (1 - o.r)), 1);
      const othersFraction = 1 - prodOthers;
      const incrementalFraction = Math.max(0, combinedFraction - othersFraction);
      const reachPeople = c.r * universe;
      const incrementalPeople = universe * incrementalFraction;
      return {
        name: c.name,
        reachPct: round(c.r * 100, 1),
        reachPeople: round(reachPeople),
        incrementalUniquePeople: round(incrementalPeople),
        incrementalUniquePct: round(incrementalFraction * 100, 1),
        duplicatedPeople: round(Math.max(0, reachPeople - incrementalPeople)),
      };
    });

    const mostAdditive = [...channels].sort((a, b) => b.incrementalUniquePeople - a.incrementalUniquePeople)[0];
    const mostDuplicated = [...channels].sort((a, b) => b.duplicatedPeople - a.duplicatedPeople)[0];

    const payload = {
      audienceSize: round(universe),
      combinedReach: { people: round(combinedPeople), pct: round(combinedFraction * 100, 1) },
      grossSummedReach: round(grossPeople),
      duplication: {
        people: round(duplicationPeople),
        pctOfGross: grossPeople > 0 ? round((duplicationPeople / grossPeople) * 100, 1) : 0,
      },
      channels,
      mostAdditiveChannel: mostAdditive ? { name: mostAdditive.name, incrementalUniquePeople: mostAdditive.incrementalUniquePeople } : null,
      mostDuplicatedChannel: mostDuplicated ? { name: mostDuplicated.name, duplicatedPeople: mostDuplicated.duplicatedPeople } : null,
      methodology:
        "Independence (Sainsbury) model: combined reach = 1−Π(1−rᵢ). Incremental unique reach (leave-one-out) = combined − reach(all others). Duplication = Σrᵢ·U − combined.",
      assumptions: [
        "Случайная (независимая) дупликация между каналами — реальные пересечения по аудиториям могут отличаться.",
        "Все каналы покрывают одну и ту же вселенную (universe); таргетинги считаются сопоставимыми.",
        "Если есть фактические парные пересечения из исследований — модель даст лишь оценку сверху по уникальности.",
      ],
      disclaimer: "Плановая оценка дедупликации, не гарантия. Сверяйте с кросс-медиа исследованием (напр. установочным).",
    };

    const summary =
      `Омниканальный охват ${chans.length} каналов на вселенную ${ru(round(universe))}: ` +
      `дедуплицированный ${round(combinedFraction * 100, 1)}% (${ru(round(combinedPeople))} чел.), ` +
      `пересечение ${ru(round(duplicationPeople))} чел. (${payload.duplication.pctOfGross}% от суммы). ` +
      (mostAdditive ? `Больше всего уникума даёт «${mostAdditive.name}».` : "");

    return toContent(summary, payload);
  },
};

// ── media_flowchart ──────────────────────────────────────────────────────────

type FlightPattern = "even" | "front_loaded" | "back_loaded" | "burst" | "pulse";

interface ChannelSplitIn {
  name: string;
  sharePct: number;
}

function weekWeights(pattern: FlightPattern, weeks: number, burstWeeks: number): number[] {
  const w: number[] = [];
  for (let i = 0; i < weeks; i++) {
    switch (pattern) {
      case "front_loaded":
        w.push(weeks - i);
        break;
      case "back_loaded":
        w.push(i + 1);
        break;
      case "burst":
        w.push(i < burstWeeks ? 1 : 0);
        break;
      case "pulse":
        w.push(i % 2 === 0 ? 1 : 0);
        break;
      case "even":
      default:
        w.push(1);
        break;
    }
  }
  // Guard: if a pattern zeroed everything (e.g. burstWeeks=0), fall back to even.
  if (w.every((x) => x === 0)) return new Array(weeks).fill(1);
  return w;
}

const mediaFlowchart: ToolDef = {
  name: "media_flowchart",
  description:
    "Media flighting / flowchart planner. Distributes a total budget across N weeks by a flighting pattern (even / front_loaded / back_loaded / burst / pulse), returning the per-week budget, share and cumulative spend, plus a per-channel split each week when channel shares are given. Reports the peak week and on-air weeks. Deterministic scheduling math on YOUR plan — a planning artifact, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      totalBudget: { type: "number", exclusiveMinimum: 0, description: "Total media budget to distribute, RUB" },
      weeks: { type: "number", exclusiveMinimum: 0, maximum: 104, description: "Number of weeks in the flight" },
      pattern: {
        type: "string",
        enum: ["even", "front_loaded", "back_loaded", "burst", "pulse"],
        description: "Flighting pattern (default even)",
      },
      burstWeeks: { type: "number", minimum: 1, description: "For 'burst': how many leading weeks are on-air (default ⌈weeks/3⌉)" },
      channels: {
        type: "array",
        description: "Optional per-channel split (sharePct, auto-normalized) applied to every on-air week",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name" },
            sharePct: { type: "number", exclusiveMinimum: 0, description: "Channel share, % (normalized across channels)" },
          },
          required: ["name", "sharePct"],
          additionalProperties: false,
        },
      },
    },
    required: ["totalBudget", "weeks"],
    additionalProperties: false,
  },
  async handler(input) {
    const totalBudget = Number(input.totalBudget);
    const weeks = Math.round(Number(input.weeks));
    if (!(totalBudget > 0) || !(weeks > 0)) {
      return { content: [{ type: "text", text: "Ошибка: нужны totalBudget > 0 и weeks > 0." }], isError: true };
    }
    const pattern: FlightPattern = (["even", "front_loaded", "back_loaded", "burst", "pulse"] as FlightPattern[]).includes(
      input.pattern as FlightPattern,
    )
      ? (input.pattern as FlightPattern)
      : "even";
    const burstWeeks =
      typeof input.burstWeeks === "number" && input.burstWeeks >= 1
        ? Math.min(Math.round(input.burstWeeks), weeks)
        : Math.ceil(weeks / 3);

    const rawChannels = (input.channels ?? []) as ChannelSplitIn[];
    const shareSum = rawChannels.reduce((s, c) => s + (c.sharePct > 0 ? c.sharePct : 0), 0);
    const channels =
      rawChannels.length && shareSum > 0
        ? rawChannels.map((c) => ({ name: String(c.name ?? ""), share: Math.max(0, c.sharePct) / shareSum }))
        : null;

    const weights = weekWeights(pattern, weeks, burstWeeks);
    const wSum = weights.reduce((s, x) => s + x, 0);

    let cumulative = 0;
    const weekRows = weights.map((w, i) => {
      const budget = (totalBudget * w) / wSum;
      cumulative += budget;
      const row: Record<string, unknown> = {
        week: i + 1,
        onAir: w > 0,
        budget: round(budget),
        sharePct: round((budget / totalBudget) * 100, 1),
        cumulative: round(cumulative),
      };
      if (channels && budget > 0) {
        row.channels = channels.map((c) => ({ name: c.name, budget: round(budget * c.share) }));
      }
      return row;
    });

    const onAirWeeks = weekRows.filter((r) => r.onAir).length;
    const peak = weekRows.reduce((best, r) => ((r.budget as number) > (best.budget as number) ? r : best), weekRows[0]);

    const payload = {
      pattern,
      totalBudget: round(totalBudget),
      weeks,
      onAirWeeks,
      burstWeeks: pattern === "burst" ? burstWeeks : undefined,
      channelSplit: channels ? channels.map((c) => ({ name: c.name, sharePct: round(c.share * 100, 1) })) : null,
      flowchart: weekRows,
      peakWeek: { week: peak.week, budget: peak.budget },
      avgWeeklyOnAir: onAirWeeks > 0 ? round(totalBudget / onAirWeeks) : 0,
      methodology:
        "Pattern → weekly weights (even=1; front/back=linear ramp; burst=first N weeks; pulse=every other week), normalized to the total budget. Channel split normalizes shares and applies them to every on-air week.",
      assumptions: [
        "Распределение по неделям — плановая раскладка, без учёта аукционной динамики и сезонных коэффициентов (см. seasonality_forecast).",
        "Доли каналов одинаковы во все недели on-air; при необходимости меняйте вручную по фазам.",
      ],
      disclaimer: "Плановый флоучарт, не гарантия доставки. Корректируйте под реальные закупки и сезонность.",
    };

    const summary =
      `Медиа-флоучарт (${pattern}): ${ru(round(totalBudget))} ₽ на ${weeks} нед. (${onAirWeeks} нед. on-air). ` +
      `Пик — неделя ${peak.week}: ${ru(peak.budget as number)} ₽.` +
      (channels ? ` Сплит по ${channels.length} каналам.` : "");

    return toContent(summary, payload);
  },
};

// ── media_quality_score ──────────────────────────────────────────────────────

function clamp01to100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

const mediaQualityScore: ToolDef = {
  name: "media_quality_score",
  description:
    "Media delivery quality scorer. From a placement's OWN delivered metrics (viewability %, invalid/bot traffic %, video completion %, brand-safe %, in-geo/on-target %), computes a weighted 0–100 quality score and an A–F grade, scores each metric vs. RU market thresholds (MRC-style), flags problems (low viewability, high IVT, weak completion/brand-safety), and gives a verdict + the biggest lever. Complements supplier_quality (which is a benchmark lookup) — this scores YOUR actual delivery. Deterministic, decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      placement: { type: "string", description: "Placement / supplier / line-item label" },
      isVideo: { type: "boolean", description: "Treat as video (uses video viewability threshold & completion). Default false." },
      viewabilityPct: { type: "number", minimum: 0, maximum: 100, description: "Viewable impressions, %" },
      invalidTrafficPct: { type: "number", minimum: 0, maximum: 100, description: "Invalid/bot (IVT) traffic, %" },
      completionPct: { type: "number", minimum: 0, maximum: 100, description: "Video completion rate (VTR), % (video only)" },
      brandSafePct: { type: "number", minimum: 0, maximum: 100, description: "Brand-safe impressions, %" },
      onTargetPct: { type: "number", minimum: 0, maximum: 100, description: "In-geo / on-target-audience, %" },
    },
    required: [],
    additionalProperties: false,
  },
  async handler(input) {
    const isVideo = input.isVideo === true;
    const num = (v: unknown): number | null => (typeof v === "number" && v >= 0 ? Math.min(100, v) : null);

    const viewability = num(input.viewabilityPct);
    const ivt = num(input.invalidTrafficPct);
    const completion = num(input.completionPct);
    const brandSafe = num(input.brandSafePct);
    const onTarget = num(input.onTargetPct);

    if ([viewability, ivt, completion, brandSafe, onTarget].every((v) => v == null)) {
      return {
        content: [{ type: "text", text: "Ошибка: передай хотя бы одну метрику доставки (viewabilityPct, invalidTrafficPct, completionPct, brandSafePct, onTargetPct)." }],
        isError: true,
      };
    }

    // Thresholds (RU market, MRC-style illustrative): {good, target weight}.
    const viewTarget = isVideo ? 70 : 50; // MRC: 2s/50% video, 1s/50% display; RU практика выше
    interface Metric {
      key: string;
      label: string;
      value: number | null;
      score: number | null; // 0..100 sub-score
      weight: number;
      assessment: string;
      flag: boolean;
    }
    const metrics: Metric[] = [];

    // Viewability sub-score: linear from 0 at 0% to 100 at (viewTarget+30), capped.
    if (viewability != null) {
      const s = clamp01to100(((viewability - 0) / (viewTarget + 30)) * 100);
      const flag = viewability < viewTarget;
      metrics.push({
        key: "viewability",
        label: "Viewability",
        value: viewability,
        score: round(s),
        weight: 0.3,
        assessment: flag ? `Ниже порога ${viewTarget}%` : "В норме",
        flag,
      });
    }
    // IVT sub-score: 100 at 0%, 0 at 10%+ (lower is better).
    if (ivt != null) {
      const s = clamp01to100(100 - (ivt / 10) * 100);
      const flag = ivt > 3;
      metrics.push({
        key: "invalidTraffic",
        label: "Invalid traffic (IVT)",
        value: ivt,
        score: round(s),
        weight: 0.3,
        assessment: ivt > 5 ? "Высокий фрод" : flag ? "Повышенный фрод" : "Приемлемо (<3%)",
        flag,
      });
    }
    // Completion (video only).
    if (completion != null && isVideo) {
      const s = clamp01to100((completion / 75) * 100);
      const flag = completion < 50;
      metrics.push({
        key: "completion",
        label: "Completion (VTR)",
        value: completion,
        score: round(s),
        weight: 0.15,
        assessment: flag ? "Низкий досмотр" : "В норме",
        flag,
      });
    }
    // Brand safety.
    if (brandSafe != null) {
      const s = clamp01to100(((brandSafe - 80) / 20) * 100); // 80%→0, 100%→100
      const flag = brandSafe < 95;
      metrics.push({
        key: "brandSafety",
        label: "Brand safety",
        value: brandSafe,
        score: round(s),
        weight: 0.15,
        assessment: brandSafe < 90 ? "Риск размещения рядом с небезопасным контентом" : flag ? "Ниже целевых 95%" : "В норме",
        flag,
      });
    }
    // On-target.
    if (onTarget != null) {
      const s = clamp01to100(((onTarget - 50) / 50) * 100); // 50%→0, 100%→100
      const flag = onTarget < 70;
      metrics.push({
        key: "onTarget",
        label: "On-target / in-geo",
        value: onTarget,
        score: round(s),
        weight: 0.1,
        assessment: flag ? "Много нецелевого трафика" : "В норме",
        flag,
      });
    }

    const wSum = metrics.reduce((s, m) => s + m.weight, 0);
    const overall = wSum > 0 ? metrics.reduce((s, m) => s + (m.score ?? 0) * m.weight, 0) / wSum : 0;
    const grade =
      overall >= 90 ? "A" : overall >= 80 ? "B" : overall >= 70 ? "C" : overall >= 60 ? "D" : "F";

    const flags = metrics.filter((m) => m.flag).map((m) => m.label);
    // Biggest lever = flagged metric with the lowest weighted score contribution headroom.
    const worst = [...metrics].sort((a, b) => (a.score ?? 100) - (b.score ?? 100))[0];

    const payload = {
      placement: input.placement ? String(input.placement) : null,
      isVideo,
      qualityScore: round(overall),
      grade,
      metrics,
      flags: flags.length ? flags : [],
      biggestLever: worst ? worst.label : null,
      verdict:
        grade === "A" || grade === "B"
          ? "Качество доставки хорошее — можно масштабировать."
          : grade === "C"
            ? "Среднее качество — оптимизируй слабые метрики перед масштабом."
            : "Низкое качество доставки — пересмотри площадку/таргет до увеличения бюджета.",
      methodology:
        `Weighted sub-scores: viewability 0.30, IVT 0.30, ${isVideo ? "completion 0.15, " : ""}brand-safety 0.15, on-target 0.10 (нормируются на сумму присутствующих весов). Пороги: viewability ≥${viewTarget}% (${isVideo ? "video" : "display"}), IVT <3%, brand-safe ≥95%, on-target ≥70%.`,
      assumptions: [
        "Пороги иллюстративные (MRC-style, RU практика); используйте свои стандарты при наличии.",
        "Оценка по предоставленным метрикам; отсутствующие метрики не учитываются в весах.",
      ],
      disclaimer: "Скоринг на ВАШИХ данных доставки, не гарантия. Сверяйте с независимой верификацией (напр. Weborama/Adriver/MRC-партнёр).",
    };

    const summary =
      `Качество доставки${input.placement ? ` «${input.placement}»` : ""}: ${round(overall)}/100 (${grade}). ` +
      (flags.length ? `Проблемы: ${flags.join(", ")}.` : "Флагов нет.") +
      (worst ? ` Главный рычаг: ${worst.label}.` : "");

    return toContent(summary, payload);
  },
};

// ── audience_overlap ─────────────────────────────────────────────────────────

interface AudSegment {
  name: string;
  size: number;
}
interface AudPair {
  a: string;
  b: string;
  overlap: number;
}

/** Inclusion–exclusion union over a subset of indices using MEASURED pairwise
 *  overlaps. Exact for 2 sets; for ≥3 a 2nd-order Bonferroni estimate
 *  (ΣS − Σpairwise) clamped to [max single, ΣS] (no triple-intersection data). */
function unionOf(indices: number[], sizes: number[], pair: number[][]): number {
  if (indices.length === 0) return 0;
  const sumS = indices.reduce((s, i) => s + sizes[i], 0);
  let sumPair = 0;
  for (let x = 0; x < indices.length; x++) {
    for (let y = x + 1; y < indices.length; y++) {
      sumPair += pair[indices[x]][indices[y]] ?? 0;
    }
  }
  const raw = sumS - sumPair;
  const lower = Math.max(...indices.map((i) => sizes[i]));
  return Math.max(lower, Math.min(sumS, raw));
}

const audienceOverlap: ToolDef = {
  name: "audience_overlap",
  description:
    "Audience overlap / deduplication analyzer from MEASURED pairwise overlaps (e.g. from a DMP, panel or cross-device graph) — unlike channel_overlap, which assumes statistical independence. Given segment sizes (reach % or absolute users) and the measured pairwise overlaps, it computes the deduplicated total reach (inclusion–exclusion), the duplication rate (wasted double-counting), each segment's incremental (leave-one-out) unique contribution and redundancy, a duplication matrix, and which segment is most additive vs. most redundant — to cap frequency or reallocate budget. Exact for 2 segments; a clamped 2nd-order estimate for ≥3 (no triple-intersection data). Deterministic.",
  inputSchema: {
    type: "object",
    properties: {
      segments: {
        type: "array",
        minItems: 2,
        description: "Audience segments / channels with their sizes (reach % or absolute users — be consistent)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Segment / channel name" },
            size: { type: "number", exclusiveMinimum: 0, description: "Segment reach (% of universe or absolute users)" },
          },
          required: ["name", "size"],
          additionalProperties: false,
        },
      },
      overlaps: {
        type: "array",
        description: "Measured pairwise overlaps (people in BOTH a and b), same unit as size",
        items: {
          type: "object",
          properties: {
            a: { type: "string", description: "First segment name" },
            b: { type: "string", description: "Second segment name" },
            overlap: { type: "number", minimum: 0, description: "Overlap size (same unit as segment size)" },
          },
          required: ["a", "b", "overlap"],
          additionalProperties: false,
        },
      },
    },
    required: ["segments", "overlaps"],
    additionalProperties: false,
  },
  async handler(input) {
    const segs = (input.segments ?? []) as AudSegment[];
    if (!Array.isArray(segs) || segs.length < 2) {
      return { content: [{ type: "text", text: "Ошибка: нужно ≥2 сегмента с size." }], isError: true };
    }
    const names = segs.map((s) => String(s.name));
    const sizes = segs.map((s) => Math.max(0, Number(s.size)));
    const n = segs.length;
    const idxOf = (name: string) => names.findIndex((x) => x.toLowerCase() === String(name).toLowerCase());

    const pair: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    const warnings: string[] = [];
    for (const o of (input.overlaps ?? []) as AudPair[]) {
      const i = idxOf(o.a);
      const j = idxOf(o.b);
      if (i < 0 || j < 0 || i === j) {
        warnings.push(`Пропущено пересечение «${o.a}↔${o.b}»: сегмент не найден.`);
        continue;
      }
      let ov = Math.max(0, Number(o.overlap));
      const cap = Math.min(sizes[i], sizes[j]);
      if (ov > cap) {
        warnings.push(`Пересечение «${o.a}↔${o.b}» (${round(ov)}) > min размера (${round(cap)}) — обрезано.`);
        ov = cap;
      }
      pair[i][j] = ov;
      pair[j][i] = ov;
    }

    const allIdx = segs.map((_, i) => i);
    const totalUnion = unionOf(allIdx, sizes, pair);
    const sumSizes = sizes.reduce((s, x) => s + x, 0);
    const duplicationRate = sumSizes > 0 ? (sumSizes - totalUnion) / sumSizes : 0;

    const perSegment = segs.map((s, i) => {
      const without = allIdx.filter((k) => k !== i);
      const incremental = totalUnion - unionOf(without, sizes, pair);
      const incrementalSharePct = sizes[i] > 0 ? (incremental / sizes[i]) * 100 : 0;
      return {
        name: names[i],
        size: round(sizes[i], 2),
        incrementalUnique: round(incremental, 2),
        incrementalSharePct: round(incrementalSharePct, 1),
        redundancyPct: round(100 - incrementalSharePct, 1),
      };
    });

    const sortedByAddable = [...perSegment].sort((a, b) => b.incrementalSharePct - a.incrementalSharePct);
    const mostAdditive = sortedByAddable[0]?.name ?? null;
    const mostRedundant = sortedByAddable[sortedByAddable.length - 1]?.name ?? null;

    const matrix: Array<{ a: string; b: string; overlap: number; ofSmallerPct: number }> = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const smaller = Math.min(sizes[i], sizes[j]);
        matrix.push({
          a: names[i],
          b: names[j],
          overlap: round(pair[i][j], 2),
          ofSmallerPct: smaller > 0 ? round((pair[i][j] / smaller) * 100, 1) : 0,
        });
      }
    }

    const approximate = n >= 3;
    const verdict =
      duplicationRate > 0.4
        ? `Высокое дублирование (${round(duplicationRate * 100, 0)}%) — много двойного охвата. Введи частотные капы и сократи самый избыточный сегмент «${mostRedundant}».`
        : duplicationRate > 0.15
          ? `Умеренное дублирование (${round(duplicationRate * 100, 0)}%). Перелей часть бюджета из «${mostRedundant}» в наиболее аддитивный «${mostAdditive}».`
          : `Низкое дублирование (${round(duplicationRate * 100, 0)}%) — сегменты дополняют друг друга, охват эффективный.`;

    const payload = {
      segmentsCount: n,
      grossReach: round(sumSizes, 2),
      dedupReach: round(totalUnion, 2),
      duplicationRate: round(duplicationRate, 3),
      duplicationPct: round(duplicationRate * 100, 1),
      perSegment,
      duplicationMatrix: matrix,
      mostAdditive,
      mostRedundant,
      approximate,
      warnings,
      verdict,
      methodology:
        "Дедуп-охват по формуле включений-исключений на ИЗМЕРЕННЫХ парных пересечениях (точно для 2 сегментов; для ≥3 — оценка 2-го порядка ΣS−Σпар, обрезанная в [max, ΣS], без тройных пересечений). Инкремент сегмента = leave-one-out (union − union без него). Duplication rate = (ΣS − dedup)/ΣS.",
      assumptions: [
        "Размеры и пересечения — в одной единице (охват % или абсолютные люди).",
        approximate ? "Для ≥3 сегментов точность ограничена отсутствием тройных пересечений — оценка." : "Для 2 сегментов расчёт точный.",
      ],
      disclaimer: "Оценка дедупликации на ВАШИХ измеренных данных. Для точного 3+ дедупа нужны тройные пересечения (single-source панель).",
    };

    const summary =
      `Дедуп-охват: ${round(totalUnion, 1)} из ${round(sumSizes, 1)} «грязного» (дублирование ${round(duplicationRate * 100, 0)}%). ` +
      `Аддитивнее всего «${mostAdditive}», избыточнее всего «${mostRedundant}». ${verdict}`;

    return toContent(summary, payload);
  },
};

// ── frequency_cap_optimizer ───────────────────────────────────────────────────

/** E[min(X, c)] and E[max(X − c, 0)] for X ~ Poisson(lambda). */
function poissonCapStats(lambda: number, c: number): { eMin: number; eMax: number } {
  const maxI = Math.max(c + 1, Math.ceil(lambda * 4) + 20);
  const pmf = poisson(lambda, maxI);
  let eMin = 0;
  let eMax = 0;
  for (let i = 0; i < pmf.length; i++) {
    eMin += Math.min(i, c) * pmf[i];
    eMax += Math.max(i - c, 0) * pmf[i];
  }
  return { eMin, eMax };
}

/** Solve λ' such that E[min(Poisson(λ'), c)] = target (delivered impr./person). */
function solveLambdaForDelivered(target: number, c: number): number | null {
  if (target >= c) return null; // infeasible: can't deliver >c per person on this universe
  let lo = target;
  let hi = Math.max(target * 2, target + c);
  // expand hi until E[min] exceeds target
  for (let k = 0; k < 60 && poissonCapStats(hi, c).eMin < target; k++) hi *= 1.6;
  for (let it = 0; it < 80; it++) {
    const mid = (lo + hi) / 2;
    const e = poissonCapStats(mid, c).eMin;
    if (e < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const frequencyCapOptimizer: ToolDef = {
  name: "frequency_cap_optimizer",
  description:
    "Frequency-cap optimizer for OLV / display. From a fixed impression pool (impressions, or budget + CPM) and the target audience universe, it (A) DIAGNOSES how many impressions land on people already past each candidate cap at the natural average frequency (wasted over-cap impressions, Poisson model), and (B) OPTIMIZES: for each cap it re-solves the per-person delivery so the freed impressions are reallocated, returning the resulting NET (1+) reach, EFFECTIVE reach at ≥N exposures, average frequency and the reach uplift vs. no cap. Recommends the cap that maximises ≥N effective reach. Deterministic media math on YOUR plan inputs — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      audienceSize: { type: "number", exclusiveMinimum: 0, description: "Target audience universe (people)" },
      budget: { type: "number", exclusiveMinimum: 0, description: "Media budget, RUB (use with cpm). Omit if you pass impressions." },
      cpm: { type: "number", exclusiveMinimum: 0, description: "Cost per 1000 impressions, RUB (required with budget)" },
      impressions: { type: "number", exclusiveMinimum: 0, description: "Gross impressions directly (alternative to budget+cpm)" },
      effectiveFreq: { type: "number", minimum: 1, description: "Effective-frequency threshold N for ≥N exposures (default 3)" },
      maxCap: { type: "number", minimum: 1, description: "Highest frequency cap to test (default 10)" },
    },
    required: ["audienceSize"],
    additionalProperties: false,
  },
  async handler(input) {
    const universe = Number(input.audienceSize);
    if (!(universe > 0)) {
      return { content: [{ type: "text", text: "Ошибка: audienceSize должен быть > 0." }], isError: true };
    }
    let impressions: number | null = null;
    if (typeof input.impressions === "number" && input.impressions > 0) {
      impressions = input.impressions;
    } else if (typeof input.budget === "number" && input.budget > 0 && typeof input.cpm === "number" && input.cpm > 0) {
      impressions = (input.budget / input.cpm) * 1000;
    }
    if (impressions == null) {
      return { content: [{ type: "text", text: "Ошибка: задай impressions, либо budget + cpm." }], isError: true };
    }
    const N = typeof input.effectiveFreq === "number" && input.effectiveFreq >= 1 ? Math.round(input.effectiveFreq) : 3;
    const maxCap = typeof input.maxCap === "number" && input.maxCap >= N ? Math.round(input.maxCap) : Math.max(10, N + 5);

    const lambda0 = impressions / universe; // natural average frequency, uncapped
    const baseMaxI = Math.max(maxCap + 2, Math.ceil(lambda0 * 4) + 20);
    const pmf0 = poisson(lambda0, baseMaxI);
    const baselineNetReachPct = (1 - pmf0[0]) * 100;
    let baselineEff = 0;
    for (let i = N; i < pmf0.length; i++) baselineEff += pmf0[i];
    const baselineEffReachPct = baselineEff * 100;

    const caps: Array<Record<string, unknown>> = [];
    let best: { cap: number; effPct: number } | null = null;
    for (let c = N; c <= maxCap; c++) {
      // (A) diagnostic: wasted over-cap impressions at the NATURAL lambda0 (no reallocation)
      const { eMax } = poissonCapStats(lambda0, c);
      const wastedImpr = universe * eMax;
      const wastedPct = impressions > 0 ? (wastedImpr / impressions) * 100 : 0;

      // (B) optimized: reallocate freed impressions → re-solve lambda' under the cap
      const target = impressions / universe;
      const lambdaPrime = solveLambdaForDelivered(target, c);
      let netReachPct = baselineNetReachPct;
      let effReachPct = baselineEffReachPct;
      let avgFreq = lambda0;
      let feasible = true;
      if (lambdaPrime == null) {
        feasible = false;
      } else {
        const maxI2 = Math.max(c + 2, Math.ceil(lambdaPrime * 4) + 20);
        const pmf = poisson(lambdaPrime, maxI2);
        netReachPct = (1 - pmf[0]) * 100;
        let eff = 0;
        for (let i = N; i < pmf.length; i++) eff += pmf[i];
        effReachPct = eff * 100; // P(X' ≥ N); since N ≤ c, min(X',c) ≥ N ⇔ X' ≥ N
        const reach = (netReachPct / 100) * universe;
        avgFreq = reach > 0 ? impressions / reach : 0;
      }

      caps.push({
        cap: c,
        overCapWastedImpressions: round(wastedImpr),
        overCapWastedPct: round(wastedPct, 1),
        optimizedNetReachPct: round(netReachPct, 1),
        optimizedEffectiveReachPct: round(effReachPct, 1),
        optimizedEffectiveReachPeople: round((effReachPct / 100) * universe),
        avgFrequencyAmongReached: round(avgFreq, 2),
        effectiveReachUpliftPp: round(effReachPct - baselineEffReachPct, 1),
        feasible,
      });

      if (feasible && (best == null || effReachPct > best.effPct)) best = { cap: c, effPct: effReachPct };
    }

    const recCap = best?.cap ?? N;
    const recRow = caps.find((r) => r.cap === recCap)!;
    const baseWastedRow = caps.find((r) => r.cap === recCap);

    const payload = {
      audienceSize: round(universe),
      impressions: round(impressions),
      naturalAvgFrequency: round(lambda0, 2),
      effectiveFreqThreshold: N,
      baseline: {
        label: "no cap",
        netReachPct: round(baselineNetReachPct, 1),
        effectiveReachPct: round(baselineEffReachPct, 1),
        effectiveReachPeople: round((baselineEffReachPct / 100) * universe),
        avgFrequency: round(lambda0, 2),
      },
      caps,
      recommendedCap: recCap,
      recommendation: recRow,
      verdict:
        `При средней частоте ${round(lambda0, 1)} оптимальная отсечка — ${recCap} показов/чел.: эффективный охват ≥${N} растёт до ${recRow.optimizedEffectiveReachPct}% ` +
        `(+${recRow.effectiveReachUpliftPp} п.п. к плану без капа), переаллокировав ~${ru(round((baseWastedRow?.overCapWastedImpressions as number) ?? 0))} «лишних» показов. ` +
        `Чем ниже кап (до N=${N}), тем выше доля достигших ≥${N}; кап выше — если важен «вес»/несколько креативов.`,
      methodology:
        "Контактная модель — Пуассон с λ=impressions/universe. (A) Диагностика: переизбыток над капом = U·E[max(X−c,0)]. " +
        "(B) Оптимизация: при переаллокации решаем λ′ из U·E[min(Poisson(λ′),c)] = impressions (все показы доставлены под капом); " +
        "net reach = U·(1−p₀(λ′)); эффективный ≥N = U·P(X′≥N) (т.к. N≤c).",
      assumptions: [
        "Случайная (пуассоновская) доставка контактов; реальные системы частоты дают иные хвосты.",
        "Переаллокация идеальна (освобождённые показы достаются недокупленным) — на практике зависит от таргетинга и инвентаря.",
        "Универсум и impressions заданы корректно; один период планирования.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ вводных, не гарантия. Сверяйте с настройками частоты в DSP/площадке и пост-кампейн данными.",
    };

    const summary =
      `Частотная отсечка: средняя частота ${round(lambda0, 1)}, рекомендуемый кап ${recCap}/чел. ` +
      `Эффективный охват ≥${N}: ${round(baselineEffReachPct, 0)}% → ${recRow.optimizedEffectiveReachPct}% (+${recRow.effectiveReachUpliftPp} п.п.). ` +
      `Переизбыток над капом ~${round((baseWastedRow?.overCapWastedPct as number) ?? 0, 0)}% показов.`;

    return toContent(summary, payload);
  },
};

export const MEDIA_TOOLS: ToolDef[] = [reachFrequency, channelOverlap, mediaFlowchart, mediaQualityScore, audienceOverlap, frequencyCapOptimizer];
