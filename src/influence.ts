/**
 * INFLUENCE tool group (v2.21) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • influencer_planner — an influencer / KOL roster evaluator and mix optimizer
 *     for Маркетинг влияния. From a roster of bloggers (followers, ER, price,
 *     optional avgViews / audience match) it computes per-creator reach, CPM, CPV,
 *     CPE, estimated target reach & conversions, eCPA and a value score, FLAGS
 *     suspicious engagement (likely bot/inflated or dead audience by follower tier),
 *     and — when a budget is given — greedily picks the best mix and reports blended
 *     reach / conversions / CPA / CPM.
 *
 * Deterministic, on the operator's OWN roster + assumptions. No LLM, no PII.
 * Decision support, not a guarantee — always validate with a test placement.
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

interface InfluencerIn {
  name: string;
  platform?: string;
  followers: number;
  avgViews?: number;
  erPct?: number;
  price: number;
  audienceMatchPct?: number;
}

type Tier = "nano" | "micro" | "macro" | "mega";
interface ErBand {
  tier: Tier;
  low: number;
  high: number;
}

function tierOf(followers: number): ErBand {
  // Illustrative typical engagement-rate bands by follower tier (RU/CIS, %).
  if (followers < 10_000) return { tier: "nano", low: 3, high: 8 };
  if (followers < 100_000) return { tier: "micro", low: 1.5, high: 4 };
  if (followers < 1_000_000) return { tier: "macro", low: 0.8, high: 2 };
  return { tier: "mega", low: 0.4, high: 1.5 };
}

interface EvaluatedInfluencer {
  name: string;
  platform: string | null;
  tier: Tier;
  followers: number;
  reach: number;
  targetReach: number;
  engagements: number | null;
  erPct: number | null;
  price: number;
  cpm: number;
  cpv: number;
  cpe: number | null;
  conversions: number;
  ecpa: number | null;
  valueScore: number;
  flags: string[];
  selected: boolean;
}

const influencerPlanner: ToolDef = {
  name: "influencer_planner",
  description:
    "Influencer / KOL roster evaluator & mix optimizer for Маркетинг влияния. For each blogger (followers, price, optional avgViews, ER%, audienceMatch%) computes reach (avgViews, or followers×reachRate), CPM, CPV, CPE, estimated target reach & conversions, eCPA and a value score; FLAGS suspicious engagement (likely inflated/bot or dead audience vs. typical band for the follower tier). When a budget is given, greedily selects the best mix (by eCPA for conversions or CPM for reach) and reports blended reach/conversions/CPA/CPM. Deterministic, on YOUR roster + assumptions — decision support, validate with a test placement.",
  inputSchema: {
    type: "object",
    properties: {
      influencers: {
        type: "array",
        minItems: 1,
        description: "Roster of creators to evaluate",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Creator name/handle" },
            platform: { type: "string", description: "Optional: Instagram / YouTube / Telegram / VK / etc." },
            followers: { type: "number", exclusiveMinimum: 0, description: "Follower/subscriber count" },
            avgViews: { type: "number", minimum: 0, description: "Optional avg views/reach per post (preferred over followers for reach)" },
            erPct: { type: "number", minimum: 0, description: "Optional engagement rate, % of reach (used for CPE and fraud flags)" },
            price: { type: "number", exclusiveMinimum: 0, description: "Integration price, RUB" },
            audienceMatchPct: { type: "number", minimum: 0, maximum: 100, description: "Optional share of audience that is target, % (default 100)" },
          },
          required: ["name", "followers", "price"],
          additionalProperties: false,
        },
      },
      budget: { type: "number", exclusiveMinimum: 0, description: "Optional total budget (RUB) to optimize the mix within" },
      goal: { type: "string", enum: ["reach", "conversions"], description: "Optimize/rank for reach or conversions. Default conversions." },
      expectedCvrPct: { type: "number", minimum: 0, maximum: 100, description: "Expected conversion rate of target reach, % (default 1.0)" },
      reachRatePct: { type: "number", exclusiveMinimum: 0, maximum: 100, description: "Reach as % of followers when avgViews absent (default 30)" },
    },
    required: ["influencers"],
    additionalProperties: false,
  },
  async handler(input) {
    const roster = (input.influencers ?? []) as InfluencerIn[];
    if (!roster.length) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы одного блогера в influencers." }], isError: true };
    }
    const goal: "reach" | "conversions" = input.goal === "reach" ? "reach" : "conversions";
    const cvr = typeof input.expectedCvrPct === "number" && input.expectedCvrPct >= 0 ? input.expectedCvrPct : 1.0;
    const reachRate =
      typeof input.reachRatePct === "number" && input.reachRatePct > 0 ? clamp(input.reachRatePct, 1, 100) : 30;
    const budget = typeof input.budget === "number" && input.budget > 0 ? input.budget : null;

    const evaluated: EvaluatedInfluencer[] = roster.map((inf) => {
      const followers = Math.max(1, Number(inf.followers));
      const price = Math.max(1, Number(inf.price));
      const band = tierOf(followers);
      const reach = inf.avgViews != null && inf.avgViews > 0 ? Number(inf.avgViews) : followers * (reachRate / 100);
      const match = inf.audienceMatchPct != null ? clamp(Number(inf.audienceMatchPct), 0, 100) : 100;
      const targetReach = reach * (match / 100);
      const erPct = inf.erPct != null && inf.erPct >= 0 ? Number(inf.erPct) : null;
      const engagements = erPct != null ? reach * (erPct / 100) : null;
      const cpm = (price / reach) * 1000;
      const cpv = price / reach;
      const cpe = engagements && engagements > 0 ? price / engagements : null;
      const conversions = targetReach * (cvr / 100);
      const ecpa = conversions > 0 ? price / conversions : null;

      const flags: string[] = [];
      if (erPct != null) {
        if (erPct > band.high * 2.5) flags.push(`ER ${erPct}% подозрительно высокий для tier=${band.tier} (норма ~${band.low}–${band.high}%) — проверь накрутку`);
        else if (erPct < band.low * 0.3) flags.push(`ER ${erPct}% подозрительно низкий для tier=${band.tier} (норма ~${band.low}–${band.high}%) — мёртвая аудитория?`);
      }
      if (inf.avgViews != null && inf.avgViews > 0 && inf.avgViews > followers * 1.5)
        flags.push("avgViews > 1.5× подписчиков — возможны вирусные выбросы или закупленные просмотры");
      if (match < 40) flags.push(`Низкое совпадение аудитории (${match}%) — слабый таргет`);

      // Value score: efficiency on the chosen objective, scaled 0–100 (higher better). Filled in after we know best metric.
      return {
        name: String(inf.name ?? ""),
        platform: inf.platform ? String(inf.platform) : null,
        tier: band.tier,
        followers,
        reach: round(reach),
        targetReach: round(targetReach),
        engagements: engagements != null ? round(engagements) : null,
        erPct,
        price: round(price),
        cpm: round(cpm),
        cpv: round(cpv, 2),
        cpe: cpe != null ? round(cpe, 2) : null,
        conversions: round(conversions, 1),
        ecpa: ecpa != null ? round(ecpa) : null,
        valueScore: 0,
        flags,
        selected: false,
      };
    });

    // Value score: relative efficiency on the objective metric (lower cost = higher score).
    const effMetric = (e: EvaluatedInfluencer) =>
      goal === "reach" ? e.cpm : e.ecpa != null ? e.ecpa : Number.POSITIVE_INFINITY;
    const effs = evaluated.map(effMetric).filter((v) => Number.isFinite(v)) as number[];
    const bestEff = effs.length ? Math.min(...effs) : 1;
    for (const e of evaluated) {
      const m = effMetric(e);
      e.valueScore = Number.isFinite(m) && m > 0 ? clamp(round((bestEff / m) * 100), 0, 100) : 0;
    }

    // Rank best-first by objective efficiency (then by reach as tiebreak).
    evaluated.sort((a, b) => {
      const ma = effMetric(a);
      const mb = effMetric(b);
      if (ma !== mb) return ma - mb;
      return b.reach - a.reach;
    });

    // Greedy mix within budget (whole buys), best efficiency first.
    let mix: EvaluatedInfluencer[] = [];
    if (budget != null) {
      let spent = 0;
      for (const e of evaluated) {
        if (spent + e.price <= budget) {
          e.selected = true;
          spent += e.price;
          mix.push(e);
        }
      }
    } else {
      mix = evaluated.filter((e) => effMetric(e) === bestEff).slice(0, 1);
      for (const e of mix) e.selected = true;
    }

    const totals = mix.reduce(
      (acc, e) => {
        acc.cost += e.price;
        acc.reach += e.reach;
        acc.targetReach += e.targetReach;
        acc.conversions += e.conversions;
        return acc;
      },
      { cost: 0, reach: 0, targetReach: 0, conversions: 0 },
    );
    const blendedCpm = totals.reach > 0 ? (totals.cost / totals.reach) * 1000 : null;
    const blendedCpa = totals.conversions > 0 ? totals.cost / totals.conversions : null;

    const flaggedNames = evaluated.filter((e) => e.flags.length).map((e) => e.name);

    const payload = {
      goal,
      budget,
      assumptionsUsed: { expectedCvrPct: round(cvr, 2), reachRatePct: round(reachRate, 1) },
      influencers: evaluated,
      recommendedMix: {
        creators: mix.map((e) => e.name),
        count: mix.length,
        totalCost: round(totals.cost),
        totalReach: round(totals.reach),
        totalTargetReach: round(totals.targetReach),
        estConversions: round(totals.conversions, 1),
        blendedCpm: blendedCpm != null ? round(blendedCpm) : null,
        blendedCpa: blendedCpa != null ? round(blendedCpa) : null,
        budgetUsedPct: budget ? round((totals.cost / budget) * 100, 1) : null,
      },
      risks: flaggedNames.length ? `Проверь: ${flaggedNames.join(", ")}` : "Явных фрод-флагов нет.",
      methodology:
        "reach = avgViews (или followers×reachRate); targetReach = reach×audienceMatch; conversions = targetReach×CVR; CPM/CPV/CPE/eCPA = price ÷ метрика. Фрод-флаги — отклонение ER от типичной полосы по tier подписчиков.",
      assumptions: [
        "Охват и конверсии — оценки на ВАШИХ вводных, не гарантированный результат.",
        "ER-полосы по tier иллюстративные (RU/CIS); используйте свои бенчмарки, если есть.",
        "Микс подбирается жадно по эффективности (целыми интеграциями), пересечение аудиторий блогеров не вычитается.",
      ],
      disclaimer: "Decision support, не гарантия. Подтверждайте тестовым размещением и постфактум-замером.",
    };

    const best = evaluated[0];
    const head = best ? `Лучший: «${best.name}» (${best.tier}, value ${best.valueScore}/100). ` : "";
    const mixLine =
      budget != null
        ? `Микс под бюджет ${ru(budget)} ₽: ${mix.length} блогеров, охват ~${ru(round(totals.reach))}` +
          (blendedCpa != null ? `, blended CPA ~${ru(round(blendedCpa))} ₽.` : ".")
        : "Передай budget, чтобы собрать оптимальный микс.";
    const summary = `Оценка ${evaluated.length} блогеров (цель: ${goal}). ${head}${mixLine}${flaggedNames.length ? ` Фрод-флаги: ${flaggedNames.length}.` : ""}`;

    return toContent(summary, payload);
  },
};

export const INFLUENCE_TOOLS: ToolDef[] = [influencerPlanner];
