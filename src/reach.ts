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

export const MEDIA_TOOLS: ToolDef[] = [reachFrequency, channelOverlap];
