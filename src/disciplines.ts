/**
 * DISCIPLINE tool groups (v2.46) for NECTARIN Intelligence — Workers.
 *
 * One deterministic planner per under-served marketing profession, so that every
 * specialist on a team has a first-class reason to use the connector:
 *
 *   • seo_opportunity        — SEO specialist (organic position → CTR → traffic → value)
 *   • social_media_planner   — SMM / community manager (reach, ER, growth per platform)
 *   • pr_value_estimator     — PR / communications (earned reach, SoV, tier/sentiment)
 *   • event_roi_planner      — event / field / webinar marketer (reg→attend→lead→pipeline)
 *   • aso_planner            — mobile / ASO marketer (impressions→installs→LTV, paid UA)
 *   • content_plan_roi       — content marketer (compounding content asset → ROI/payback)
 *
 * All math is deterministic and runs on the operator's OWN numbers. No LLM, no PII.
 * Planning estimates, not guarantees.
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

// ── seo_opportunity ────────────────────────────────────────────────────────────

/** Blended organic SERP click-through rate by position (RU desktop+mobile, illustrative). */
function organicCtr(position: number): number {
  if (position < 1) return 0;
  const table: Record<number, number> = {
    1: 0.28, 2: 0.15, 3: 0.1, 4: 0.07, 5: 0.05, 6: 0.04, 7: 0.032, 8: 0.026, 9: 0.021, 10: 0.018,
  };
  if (position <= 10) return table[Math.round(position)] ?? 0.018;
  if (position <= 20) return 0.009; // page 2
  if (position <= 30) return 0.004;
  return 0.0015;
}

const seoOpportunity: ToolDef = {
  name: "seo_opportunity",
  description:
    "SEO organic-growth opportunity model for an SEO specialist. From a list of keywords (monthlySearchVolume + currentPosition + targetPosition) and a conversion rate + value per conversion (or AOV), it applies a position→CTR curve to estimate current vs. target organic traffic, the incremental clicks, conversions and revenue per keyword, ranks the biggest opportunities, and flags 'quick wins' (page-2 keywords, positions 11–20, that are cheap to push onto page 1). Returns portfolio totals and a verdict. Deterministic SEO math on YOUR keywords — a planning estimate, not a ranking guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        minItems: 1,
        description: "Target keywords with volume and positions",
        items: {
          type: "object",
          properties: {
            keyword: { type: "string", description: "Keyword / query" },
            monthlySearchVolume: { type: "number", minimum: 0, description: "Monthly searches" },
            currentPosition: { type: "number", minimum: 0, description: "Current avg position (0/omit = not ranking)" },
            targetPosition: { type: "number", exclusiveMinimum: 0, description: "Target position (default 3)" },
          },
          required: ["keyword", "monthlySearchVolume"],
          additionalProperties: false,
        },
      },
      conversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Visit→conversion rate % (default 2)" },
      valuePerConversion: { type: "number", minimum: 0, description: "Value per conversion ₽ (or use aov)" },
      aov: { type: "number", minimum: 0, description: "Average order value ₽ (used if valuePerConversion omitted)" },
    },
    required: ["keywords"],
    additionalProperties: false,
  },
  async handler(input) {
    const keywords = (input.keywords ?? []) as Array<{ keyword: string; monthlySearchVolume: number; currentPosition?: number; targetPosition?: number }>;
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один keyword с monthlySearchVolume." }], isError: true };
    }
    const cr = clamp(Number(input.conversionRatePct ?? 2), 0, 100) / 100;
    const value = typeof input.valuePerConversion === "number" ? input.valuePerConversion : (typeof input.aov === "number" ? input.aov : 0);

    const rows = keywords.map((k) => {
      const vol = Math.max(0, Number(k.monthlySearchVolume));
      const cur = typeof k.currentPosition === "number" && k.currentPosition > 0 ? k.currentPosition : 0; // 0 = not ranking
      const tgt = typeof k.targetPosition === "number" && k.targetPosition > 0 ? k.targetPosition : 3;
      const curTraffic = cur > 0 ? vol * organicCtr(cur) : 0;
      const tgtTraffic = vol * organicCtr(tgt);
      const deltaTraffic = Math.max(0, tgtTraffic - curTraffic);
      const deltaConversions = deltaTraffic * cr;
      const deltaValue = deltaConversions * value;
      const quickWin = cur >= 11 && cur <= 20; // page 2 → page 1
      return {
        keyword: String(k.keyword),
        monthlySearchVolume: round(vol),
        currentPosition: cur || null,
        targetPosition: tgt,
        currentMonthlyTraffic: round(curTraffic),
        targetMonthlyTraffic: round(tgtTraffic),
        incrementalMonthlyTraffic: round(deltaTraffic),
        incrementalMonthlyConversions: round(deltaConversions, 1),
        incrementalMonthlyValue: round(deltaValue),
        quickWin,
      };
    });
    rows.sort((a, b) => b.incrementalMonthlyValue - a.incrementalMonthlyValue || b.incrementalMonthlyTraffic - a.incrementalMonthlyTraffic);

    const totals = rows.reduce(
      (acc, r) => {
        acc.traffic += r.incrementalMonthlyTraffic;
        acc.conv += r.incrementalMonthlyConversions;
        acc.value += r.incrementalMonthlyValue;
        return acc;
      },
      { traffic: 0, conv: 0, value: 0 }
    );
    const quickWins = rows.filter((r) => r.quickWin).map((r) => r.keyword);

    const payload = {
      conversionRatePct: round(cr * 100, 2),
      valuePerConversion: round(value),
      keywords: rows,
      totals: {
        incrementalMonthlyTraffic: round(totals.traffic),
        incrementalMonthlyConversions: round(totals.conv),
        incrementalMonthlyValue: round(totals.value),
        incrementalAnnualValue: round(totals.value * 12),
      },
      quickWins,
      topOpportunity: rows[0]?.keyword ?? null,
      verdict:
        `Потенциал органики: +${ru(round(totals.traffic))} визитов/мес и +${ru(round(totals.conv))} конверсий/мес` +
        (value > 0 ? ` (≈${ru(round(totals.value))} ₽/мес, ${ru(round(totals.value * 12))} ₽/год).` : ".") +
        (quickWins.length ? ` Быстрые победы (стр.2→1): ${quickWins.slice(0, 5).join(", ")}.` : ""),
      methodology:
        "Трафик = объём × CTR(позиция) по кривой органической выдачи (поз.1≈28%, поз.3≈10%, стр.2≈0.9%). " +
        "Прирост = трафик(цель) − трафик(сейчас); конверсии = прирост × CR; ценность = конверсии × value. Quick win = текущая позиция 11–20.",
      assumptions: [
        "CTR-кривая иллюстративная (зависит от ниши, сниппетов, доли рекламы и нулевых кликов).",
        "Объёмы и позиции заданы корректно и стабильны; сезонность не моделируется.",
        "Один и тот же CR для всех запросов; коммерческий/информационный интент не разделён.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия позиций. Сверяйте с Я.Вебмастер/Topvisor и фактическим CTR.",
    };

    const summary =
      `SEO-потенциал: +${ru(round(totals.traffic))} визитов/мес, +${ru(round(totals.conv))} конв./мес` +
      (value > 0 ? `, ≈${ru(round(totals.value))} ₽/мес` : "") +
      `. Топ: «${rows[0]?.keyword ?? "—"}»` +
      (quickWins.length ? `; быстрых побед: ${quickWins.length}.` : ".");

    return toContent(summary, payload);
  },
};

// ── social_media_planner ─────────────────────────────────────────────────────

const socialMediaPlanner: ToolDef = {
  name: "social_media_planner",
  description:
    "Organic social-media / SMM planner for an SMM or community manager. From one or more platforms (VK, Telegram, Дзен, YouTube, …) with followers, postsPerWeek, organic reachRatePct (% of followers reached per post) and engagementRatePct (of reached), it projects monthly posts, reach, impressions, engagements, follower growth (from an optional growthRatePct) and — with conversionRatePct + aov — conversions & revenue. Aggregates the portfolio, recommends a cadence, and flags low organic reach. Deterministic SMM math on YOUR numbers — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      platforms: {
        type: "array",
        minItems: 1,
        description: "Social platforms with their metrics",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Platform, e.g. 'VK', 'Telegram', 'Дзен', 'YouTube'" },
            followers: { type: "number", minimum: 0, description: "Audience / subscribers" },
            postsPerWeek: { type: "number", minimum: 0, description: "Posts per week" },
            reachRatePct: { type: "number", minimum: 0, maximum: 100, description: "Organic reach % of followers per post (default 20)" },
            engagementRatePct: { type: "number", minimum: 0, maximum: 100, description: "Engagement % of reached per post (default 3)" },
            growthRatePct: { type: "number", description: "Monthly follower growth % (optional)" },
          },
          required: ["name", "followers", "postsPerWeek"],
          additionalProperties: false,
        },
      },
      conversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Engagement→conversion rate % (optional)" },
      aov: { type: "number", minimum: 0, description: "Average order value ₽ (optional, with conversionRatePct)" },
    },
    required: ["platforms"],
    additionalProperties: false,
  },
  async handler(input) {
    const platforms = (input.platforms ?? []) as Array<{ name: string; followers: number; postsPerWeek: number; reachRatePct?: number; engagementRatePct?: number; growthRatePct?: number }>;
    if (!Array.isArray(platforms) || platforms.length === 0) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы одну платформу." }], isError: true };
    }
    const cr = typeof input.conversionRatePct === "number" ? clamp(input.conversionRatePct, 0, 100) / 100 : null;
    const aov = typeof input.aov === "number" ? input.aov : null;

    const rows = platforms.map((p) => {
      const followers = Math.max(0, Number(p.followers));
      const postsPerMonth = Math.max(0, Number(p.postsPerWeek)) * 4.33;
      const reachRate = clamp(Number(p.reachRatePct ?? 20), 0, 100) / 100;
      const er = clamp(Number(p.engagementRatePct ?? 3), 0, 100) / 100;
      const reachPerPost = followers * reachRate;
      const impressions = reachPerPost * postsPerMonth;
      const engagements = impressions * er;
      const growth = typeof p.growthRatePct === "number" ? p.growthRatePct / 100 : 0;
      const newFollowers = followers * growth;
      const lowReach = reachRate < 0.1;
      return {
        platform: String(p.name),
        followers: round(followers),
        postsPerMonth: round(postsPerMonth),
        reachР: undefined as unknown, // placeholder removed below
        reachRatePct: round(reachRate * 100, 1),
        reachPerPost: round(reachPerPost),
        monthlyImpressions: round(impressions),
        monthlyEngagements: round(engagements),
        engagementRatePct: round(er * 100, 2),
        projectedNewFollowersPerMonth: round(newFollowers),
        lowOrganicReach: lowReach,
      };
    });
    // strip placeholder key
    rows.forEach((r) => { delete (r as any).reachР; });

    const totalImpr = rows.reduce((s, r) => s + r.monthlyImpressions, 0);
    const totalEng = rows.reduce((s, r) => s + r.monthlyEngagements, 0);
    const totalNew = rows.reduce((s, r) => s + r.projectedNewFollowersPerMonth, 0);
    const conversions = cr != null ? totalEng * cr : null;
    const revenue = conversions != null && aov != null ? conversions * aov : null;

    const lowReachPlatforms = rows.filter((r) => r.lowOrganicReach).map((r) => r.platform);

    const payload = {
      platforms: rows,
      totals: {
        monthlyImpressions: round(totalImpr),
        monthlyEngagements: round(totalEng),
        projectedNewFollowersPerMonth: round(totalNew),
        conversionsPerMonth: conversions != null ? round(conversions, 1) : null,
        revenuePerMonth: revenue != null ? round(revenue) : null,
      },
      recommendations: [
        "Держи стабильную частоту: 3–7 постов/нед на VK/TG, 2–4 длинных/нед на Дзен/YouTube.",
        lowReachPlatforms.length ? `Низкий органический охват на: ${lowReachPlatforms.join(", ")} — усиль вовлекающие форматы (клипы/видео), посевы и UGC.` : "Органический охват в норме — масштабируй лучшие форматы.",
        "Перекладывай топ-посты в платное продвижение (look-alike по вовлечённым).",
      ],
      verdict:
        `Соцсети: ~${ru(round(totalImpr))} показов и ~${ru(round(totalEng))} вовлечений/мес, +${ru(round(totalNew))} подписчиков/мес` +
        (revenue != null ? `, ≈${ru(round(revenue))} ₽/мес.` : ".") +
        (lowReachPlatforms.length ? ` ⚠ Низкий охват: ${lowReachPlatforms.join(", ")}.` : ""),
      methodology:
        "Постов/мес = постов/нед × 4.33; охват/пост = подписчики × reachRate; показы = охват/пост × постов/мес; " +
        "вовлечения = показы × ER; прирост подписчиков = подписчики × growthRate; конверсии = вовлечения × CR.",
      assumptions: [
        "Органический охват и ER стабильны; на практике зависят от алгоритмов и формата.",
        "Показы внутри платформы не дедуплицируются по людям (это импрессии, не уникальный охват).",
        "Прирост подписчиков — простой месячный процент без насыщения.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия. Сверяйте с аналитикой площадок.",
    };

    const summary =
      `SMM-план: ${rows.length} площадк(и), ~${ru(round(totalImpr))} показов и ~${ru(round(totalEng))} вовлечений/мес` +
      (revenue != null ? `, ≈${ru(round(revenue))} ₽/мес` : "") +
      `. +${ru(round(totalNew))} подписчиков/мес.`;

    return toContent(summary, payload);
  },
};

// ── pr_value_estimator ───────────────────────────────────────────────────────

const TIER_WEIGHT: Record<string, number> = { tier1: 1.0, tier2: 0.6, tier3: 0.35, niche: 0.45, regional: 0.4 };
const SENTIMENT_WEIGHT: Record<string, number> = { positive: 1.0, neutral: 0.6, negative: 0.1, mixed: 0.5 };

const prValueEstimator: ToolDef = {
  name: "pr_value_estimator",
  description:
    "PR / earned-media value & share-of-voice estimator for a PR or communications manager. From a list of placements (outlet, audienceReach, optional tier and sentiment) it computes total potential reach (with an overlap discount), a tier- & sentiment-weighted QUALITY-ADJUSTED reach, and an advertising-equivalent reach value using a CPM benchmark (clearly labelled — AVE is a context metric, not an endorsed KPI). With competitorReach it computes earned share of voice. Returns a per-placement table, a PR quality score and a verdict. Deterministic on YOUR data — context, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      placements: {
        type: "array",
        minItems: 1,
        description: "Media placements / mentions",
        items: {
          type: "object",
          properties: {
            outlet: { type: "string", description: "Outlet / publication" },
            audienceReach: { type: "number", minimum: 0, description: "Audience / potential reach of the placement" },
            tier: { type: "string", enum: ["tier1", "tier2", "tier3", "niche", "regional"], description: "Outlet tier (default tier2)" },
            sentiment: { type: "string", enum: ["positive", "neutral", "negative", "mixed"], description: "Coverage sentiment (default neutral)" },
          },
          required: ["outlet", "audienceReach"],
          additionalProperties: false,
        },
      },
      cpmBenchmark: { type: "number", minimum: 0, description: "Ad CPM ₽ for advertising-equivalent reach value (default 300)" },
      overlapDiscountPct: { type: "number", minimum: 0, maximum: 90, description: "Audience overlap discount on summed reach % (default 30)" },
      competitorReach: { type: "number", minimum: 0, description: "Competitors' total earned reach (for share of voice)" },
    },
    required: ["placements"],
    additionalProperties: false,
  },
  async handler(input) {
    const placements = (input.placements ?? []) as Array<{ outlet: string; audienceReach: number; tier?: string; sentiment?: string }>;
    if (!Array.isArray(placements) || placements.length === 0) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы одно размещение." }], isError: true };
    }
    const cpm = Number(input.cpmBenchmark ?? 300);
    const overlap = clamp(Number(input.overlapDiscountPct ?? 30), 0, 90) / 100;

    const rows = placements.map((p) => {
      const reach = Math.max(0, Number(p.audienceReach));
      const tier = (p.tier as string) ?? "tier2";
      const sentiment = (p.sentiment as string) ?? "neutral";
      const tw = TIER_WEIGHT[tier] ?? 0.6;
      const sw = SENTIMENT_WEIGHT[sentiment] ?? 0.6;
      const qualityReach = reach * tw * sw;
      const adEquivValue = (reach / 1000) * cpm;
      return {
        outlet: String(p.outlet),
        audienceReach: round(reach),
        tier,
        sentiment,
        qualityAdjustedReach: round(qualityReach),
        advertisingEquivalentValue: round(adEquivValue),
      };
    });
    rows.sort((a, b) => b.qualityAdjustedReach - a.qualityAdjustedReach);

    const sumReach = rows.reduce((s, r) => s + r.audienceReach, 0);
    const dedupReach = sumReach * (1 - overlap);
    const qualityReach = rows.reduce((s, r) => s + r.qualityAdjustedReach, 0);
    const adValue = rows.reduce((s, r) => s + r.advertisingEquivalentValue, 0);
    const competitorReach = typeof input.competitorReach === "number" && input.competitorReach >= 0 ? input.competitorReach : null;
    const sovPct = competitorReach != null ? (dedupReach / (dedupReach + competitorReach || 1)) * 100 : null;

    // PR quality score 0-100: how much of raw reach survives tier×sentiment weighting.
    const prQuality = sumReach > 0 ? clamp((qualityReach / sumReach) * 100, 0, 100) : 0;

    const payload = {
      placements: rows,
      totals: {
        placements: rows.length,
        summedReach: round(sumReach),
        deduplicatedReach: round(dedupReach),
        qualityAdjustedReach: round(qualityReach),
        advertisingEquivalentValue: round(adValue),
      },
      prQualityScore: round(prQuality, 0),
      earnedShareOfVoicePct: sovPct != null ? round(sovPct, 1) : null,
      topPlacement: rows[0]?.outlet ?? null,
      verdict:
        `${rows.length} размещений: дедуп-охват ~${ru(round(dedupReach))}, качество PR ${round(prQuality, 0)}/100` +
        (sovPct != null ? `, earned SoV ${round(sovPct, 0)}%.` : ".") +
        ` Рекламный эквивалент охвата ≈${ru(round(adValue))} ₽ (контекст, не KPI).`,
      methodology:
        "Дедуп-охват = Σreach × (1 − overlap). Качественный охват = Σ(reach × tierWeight × sentimentWeight). " +
        "Рекл. эквивалент = Σ(reach/1000 × CPM). PR-score = качественный/сырой охват ×100. earned SoV = дедуп/(дедуп+конкуренты).",
      assumptions: [
        "Веса tier/sentiment иллюстративны; калибруйте под свой медиалист.",
        "AVE (рекламный эквивалент) — справочный контекст, индустрия (AMEC) не рекомендует его как самостоятельный KPI.",
        "Overlap — единый дисконт; для точности используйте измеренные пересечения аудиторий.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия. Меряйте PR по бизнес-эффекту (трафик, brand lift, share of search), а не только по охвату.",
    };

    const summary =
      `PR: ${rows.length} размещений, дедуп-охват ~${ru(round(dedupReach))}, качество ${round(prQuality, 0)}/100` +
      (sovPct != null ? `, SoV ${round(sovPct, 0)}%` : "") +
      `. Топ: «${rows[0]?.outlet ?? "—"}».`;

    return toContent(summary, payload);
  },
};

// ── event_roi_planner ────────────────────────────────────────────────────────

const eventRoiPlanner: ToolDef = {
  name: "event_roi_planner",
  description:
    "Event / webinar / field-marketing ROI planner. Projects the full funnel from an audience (invites or reach) through registrations → attendees → leads → opportunities → won deals → revenue using the rates you provide, then computes cost per registration / attendee / lead, pipeline value, ROI and a breakeven (deals or revenue needed to cover the cost). Works for webinars, conferences, expos and field events. Deterministic on YOUR numbers — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      invites: { type: "number", exclusiveMinimum: 0, description: "Invites / audience reached" },
      registrationRatePct: { type: "number", minimum: 0, maximum: 100, description: "Invites→registrations % (default 10)" },
      attendanceRatePct: { type: "number", minimum: 0, maximum: 100, description: "Registrations→attendees % (default 40)" },
      leadRatePct: { type: "number", minimum: 0, maximum: 100, description: "Attendees→qualified leads % (default 30)" },
      opportunityRatePct: { type: "number", minimum: 0, maximum: 100, description: "Leads→opportunities % (optional)" },
      winRatePct: { type: "number", minimum: 0, maximum: 100, description: "Opportunities (or leads)→won deals % (default 20)" },
      dealSize: { type: "number", minimum: 0, description: "Average won-deal value / AOV ₽" },
      eventCost: { type: "number", minimum: 0, description: "Total event cost ₽" },
    },
    required: ["invites", "dealSize", "eventCost"],
    additionalProperties: false,
  },
  async handler(input) {
    const invites = Number(input.invites);
    if (!(invites > 0)) return { content: [{ type: "text", text: "Ошибка: invites должен быть > 0." }], isError: true };
    const regRate = clamp(Number(input.registrationRatePct ?? 10), 0, 100) / 100;
    const attRate = clamp(Number(input.attendanceRatePct ?? 40), 0, 100) / 100;
    const leadRate = clamp(Number(input.leadRatePct ?? 30), 0, 100) / 100;
    const oppRate = typeof input.opportunityRatePct === "number" ? clamp(input.opportunityRatePct, 0, 100) / 100 : null;
    const winRate = clamp(Number(input.winRatePct ?? 20), 0, 100) / 100;
    const dealSize = Number(input.dealSize);
    const cost = Number(input.eventCost);

    const registrations = invites * regRate;
    const attendees = registrations * attRate;
    const leads = attendees * leadRate;
    const opportunities = oppRate != null ? leads * oppRate : leads;
    const deals = opportunities * winRate;
    const revenue = deals * dealSize;
    const profit = revenue - cost;
    const roiPct = cost > 0 ? (profit / cost) * 100 : null;
    const breakevenDeals = dealSize > 0 ? cost / dealSize : null;

    const payload = {
      funnel: {
        invites: round(invites),
        registrations: round(registrations),
        attendees: round(attendees),
        leads: round(leads),
        opportunities: round(opportunities),
        wonDeals: round(deals, 1),
      },
      economics: {
        revenue: round(revenue),
        eventCost: round(cost),
        profit: round(profit),
        roiPct: roiPct != null ? round(roiPct, 0) : null,
        costPerRegistration: registrations > 0 ? round(cost / registrations) : null,
        costPerAttendee: attendees > 0 ? round(cost / attendees) : null,
        costPerLead: leads > 0 ? round(cost / leads) : null,
        breakevenDeals: breakevenDeals != null ? round(breakevenDeals, 1) : null,
      },
      verdict:
        `Событие: ${ru(round(registrations))} регистраций → ${ru(round(attendees))} участников → ${ru(round(leads))} лидов → ${round(deals, 1)} сделок. ` +
        `Выручка ${ru(round(revenue))} ₽ против ${ru(round(cost))} ₽ затрат` +
        (roiPct != null ? ` ⇒ ROI ${round(roiPct, 0)}%.` : ".") +
        (breakevenDeals != null ? ` Окупаемость от ${round(breakevenDeals, 1)} сделок.` : ""),
      methodology:
        "Воронка: регистрации=invites×reg; участники=рег×att; лиды=участники×lead; сделки=лиды×(opp?)×win; выручка=сделки×dealSize. ROI=(выручка−затраты)/затраты.",
      assumptions: [
        "Конверсии воронки заданы корректно; реальные зависят от темы, спикеров и follow-up.",
        "Доход признаётся сразу; цикл сделки и отложенный эффект не моделируются.",
        "Если opportunityRatePct не задан — лиды напрямую конвертируются по winRate.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия. Учитывайте отложенный pipeline и influence на сделки вне атрибуции.",
    };

    const summary =
      `Event-ROI: ${ru(round(registrations))} рег., ${ru(round(attendees))} участ., ${ru(round(leads))} лидов, ${round(deals, 1)} сделок; ` +
      `выручка ${ru(round(revenue))} ₽` + (roiPct != null ? `, ROI ${round(roiPct, 0)}%.` : ".");

    return toContent(summary, payload);
  },
};

// ── aso_planner ───────────────────────────────────────────────────────────────

const asoPlanner: ToolDef = {
  name: "aso_planner",
  description:
    "App Store Optimization (ASO) & mobile-growth planner. From store impressions, the tap-through rate (impression→product page view) and the install conversion rate (page view→install), it projects page views and installs; with d1/d30 retention + ARPDAU or LTV it estimates revenue, and with a paid CPI it sizes paid user acquisition economics and breakeven. Includes an ASO uplift scenario (improve the install conversion rate by N pp → extra installs & value). Deterministic mobile math on YOUR numbers — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      monthlyImpressions: { type: "number", exclusiveMinimum: 0, description: "Store listing impressions per month" },
      tapThroughRatePct: { type: "number", minimum: 0, maximum: 100, description: "Impression→product-page-view % (default 25)" },
      installConversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Page-view→install % (default 30)" },
      ltvPerInstall: { type: "number", minimum: 0, description: "LTV per install ₽ (or use arpdau + retention)" },
      arpdau: { type: "number", minimum: 0, description: "Average revenue per daily active user ₽ (with retention)" },
      avgLifetimeDays: { type: "number", exclusiveMinimum: 0, description: "Avg active lifetime in days (with arpdau)" },
      cpi: { type: "number", minimum: 0, description: "Paid cost per install ₽ (for paid UA economics)" },
      asoUpliftPp: { type: "number", exclusiveMinimum: 0, description: "ASO scenario: + percentage points to install conversion rate" },
    },
    required: ["monthlyImpressions"],
    additionalProperties: false,
  },
  async handler(input) {
    const impressions = Number(input.monthlyImpressions);
    if (!(impressions > 0)) return { content: [{ type: "text", text: "Ошибка: monthlyImpressions должен быть > 0." }], isError: true };
    const ttr = clamp(Number(input.tapThroughRatePct ?? 25), 0, 100) / 100;
    const icr = clamp(Number(input.installConversionRatePct ?? 30), 0, 100) / 100;

    const pageViews = impressions * ttr;
    const installs = pageViews * icr;

    let ltv: number | null = null;
    if (typeof input.ltvPerInstall === "number") ltv = input.ltvPerInstall;
    else if (typeof input.arpdau === "number" && typeof input.avgLifetimeDays === "number") ltv = input.arpdau * input.avgLifetimeDays;

    const revenue = ltv != null ? installs * ltv : null;
    const cpi = typeof input.cpi === "number" ? input.cpi : null;

    let paidUa: Record<string, unknown> | null = null;
    if (cpi != null && ltv != null) {
      const margin = ltv - cpi;
      paidUa = {
        cpi: round(cpi),
        ltvPerInstall: round(ltv),
        marginPerInstall: round(margin),
        ltvToCpi: cpi > 0 ? round(ltv / cpi, 2) : null,
        profitable: margin > 0,
        note: margin > 0 ? "Платное привлечение окупается: LTV > CPI." : "Платное привлечение убыточно: LTV < CPI — снижай CPI или растий LTV/retention.",
      };
    }

    let asoScenario: Record<string, unknown> | null = null;
    if (typeof input.asoUpliftPp === "number" && input.asoUpliftPp > 0) {
      const newIcr = clamp(icr + input.asoUpliftPp / 100, 0, 1);
      const newInstalls = pageViews * newIcr;
      const extraInstalls = newInstalls - installs;
      asoScenario = {
        upliftPp: round(input.asoUpliftPp, 2),
        newInstallConversionRatePct: round(newIcr * 100, 1),
        newMonthlyInstalls: round(newInstalls),
        extraInstallsPerMonth: round(extraInstalls),
        extraValuePerMonth: ltv != null ? round(extraInstalls * ltv) : null,
        extraValuePerYear: ltv != null ? round(extraInstalls * ltv * 12) : null,
      };
    }

    const payload = {
      funnel: {
        monthlyImpressions: round(impressions),
        tapThroughRatePct: round(ttr * 100, 1),
        monthlyPageViews: round(pageViews),
        installConversionRatePct: round(icr * 100, 1),
        monthlyInstalls: round(installs),
      },
      revenue: revenue != null ? { ltvPerInstall: round(ltv as number), monthlyRevenue: round(revenue), annualRevenue: round(revenue * 12) } : null,
      paidUa,
      asoScenario,
      verdict:
        `ASO-воронка: ${ru(round(impressions))} показов → ${ru(round(pageViews))} просмотров → ${ru(round(installs))} установок/мес` +
        (revenue != null ? ` (≈${ru(round(revenue))} ₽/мес).` : ".") +
        (paidUa ? ` Платный UA: LTV/CPI ${(paidUa as any).ltvToCpi} (${(paidUa as any).profitable ? "окупается" : "убыточно"}).` : "") +
        (asoScenario ? ` +${(asoScenario as any).upliftPp} п.п. конверсии ⇒ +${ru((asoScenario as any).extraInstallsPerMonth)} установок/мес.` : ""),
      methodology:
        "pageViews = impressions×TTR; installs = pageViews×ICR; LTV = задан или ARPDAU×lifetimeDays; revenue = installs×LTV. " +
        "Платный UA: маржа = LTV−CPI, LTV/CPI. ASO-сценарий: installs при ICR+upliftPp.",
      assumptions: [
        "TTR и ICR стабильны; зависят от иконки, скриншотов, рейтинга и категории.",
        "LTV постоянен на установку; реальная монетизация зависит от retention и сезона.",
        "Органика и платный трафик смешаны в impressions, если не разделены.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия. Сверяйте с App Store/Google Play Console и MMP (AppsFlyer и т.п.).",
    };

    const summary =
      `ASO: ${ru(round(impressions))} показов → ${ru(round(installs))} установок/мес` +
      (revenue != null ? `, ≈${ru(round(revenue))} ₽/мес` : "") +
      (asoScenario ? `; +${(asoScenario as any).upliftPp} п.п. ⇒ +${ru((asoScenario as any).extraInstallsPerMonth)} устан./мес.` : ".");

    return toContent(summary, payload);
  },
};

// ── content_plan_roi ──────────────────────────────────────────────────────────

const contentPlanRoi: ToolDef = {
  name: "content_plan_roi",
  description:
    "Content-marketing ROI model that treats content as a COMPOUNDING asset. Given pieces produced per month, cost per piece, the steady-state monthly visits each piece earns (after a ramp), an optional content lifespan, plus a conversion rate and value per conversion, it simulates the library month-by-month over a horizon: cumulative published pieces, total monthly & cumulative organic visits, conversions, value, content spend, net ROI and the payback month. Shows why content pays back later but compounds. Deterministic on YOUR numbers — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      piecesPerMonth: { type: "number", exclusiveMinimum: 0, description: "Content pieces published per month" },
      costPerPiece: { type: "number", minimum: 0, description: "Fully-loaded cost per piece ₽" },
      steadyStateVisitsPerPiece: { type: "number", minimum: 0, description: "Monthly organic visits each piece earns at steady state" },
      rampMonths: { type: "number", exclusiveMinimum: 0, description: "Months for a piece to reach steady-state traffic (default 3)" },
      lifespanMonths: { type: "number", exclusiveMinimum: 0, description: "Months a piece keeps earning before decay to 0 (default 24)" },
      conversionRatePct: { type: "number", minimum: 0, maximum: 100, description: "Visit→conversion rate % (default 1.5)" },
      valuePerConversion: { type: "number", minimum: 0, description: "Value per conversion ₽" },
      horizonMonths: { type: "number", exclusiveMinimum: 0, description: "Simulation horizon in months (default 24)" },
    },
    required: ["piecesPerMonth", "costPerPiece", "steadyStateVisitsPerPiece", "valuePerConversion"],
    additionalProperties: false,
  },
  async handler(input) {
    const piecesPerMonth = Number(input.piecesPerMonth);
    const costPerPiece = Number(input.costPerPiece);
    const ssv = Number(input.steadyStateVisitsPerPiece);
    const ramp = Number(input.rampMonths ?? 3);
    const lifespan = Number(input.lifespanMonths ?? 24);
    const cr = clamp(Number(input.conversionRatePct ?? 1.5), 0, 100) / 100;
    const value = Number(input.valuePerConversion);
    const horizon = Math.round(Number(input.horizonMonths ?? 24));

    // Traffic multiplier for a piece that is `age` months old (linear ramp, flat, then off).
    const ageFactor = (age: number): number => {
      if (age < 0 || age >= lifespan) return 0;
      if (age < ramp) return (age + 1) / ramp; // months 0..ramp-1 ramp up
      return 1;
    };

    const series: Array<Record<string, number>> = [];
    let cumVisits = 0;
    let cumConversions = 0;
    let cumValue = 0;
    let cumSpend = 0;
    let paybackMonth: number | null = null;

    for (let m = 1; m <= horizon; m++) {
      // pieces published in month k (k=1..m), age at month m = m-k
      let monthlyVisits = 0;
      const publishedSoFar = piecesPerMonth * m;
      for (let k = 1; k <= m; k++) {
        const age = m - k;
        monthlyVisits += piecesPerMonth * ssv * ageFactor(age);
      }
      const monthlyConversions = monthlyVisits * cr;
      const monthlyValue = monthlyConversions * value;
      const monthlySpend = piecesPerMonth * costPerPiece;

      cumVisits += monthlyVisits;
      cumConversions += monthlyConversions;
      cumValue += monthlyValue;
      cumSpend += monthlySpend;

      if (paybackMonth == null && cumValue >= cumSpend) paybackMonth = m;

      series.push({
        month: m,
        publishedPieces: round(publishedSoFar),
        monthlyVisits: round(monthlyVisits),
        monthlyConversions: round(monthlyConversions, 1),
        monthlyValue: round(monthlyValue),
        cumulativeValue: round(cumValue),
        cumulativeSpend: round(cumSpend),
      });
    }

    const last = series[series.length - 1];
    const roiPct = cumSpend > 0 ? ((cumValue - cumSpend) / cumSpend) * 100 : null;

    const payload = {
      inputs: {
        piecesPerMonth, costPerPiece, steadyStateVisitsPerPiece: ssv, rampMonths: ramp,
        lifespanMonths: lifespan, conversionRatePct: round(cr * 100, 2), valuePerConversion: value, horizonMonths: horizon,
      },
      monthly: series,
      totals: {
        publishedPieces: round(piecesPerMonth * horizon),
        cumulativeVisits: round(cumVisits),
        cumulativeConversions: round(cumConversions),
        cumulativeValue: round(cumValue),
        cumulativeSpend: round(cumSpend),
        netProfit: round(cumValue - cumSpend),
        roiPct: roiPct != null ? round(roiPct, 0) : null,
        paybackMonth,
        exitRunRateMonthlyValue: last ? last.monthlyValue : 0,
      },
      verdict:
        `Контент за ${horizon} мес.: ${ru(round(piecesPerMonth * horizon))} материалов, ` +
        `${ru(round(cumValue))} ₽ ценности против ${ru(round(cumSpend))} ₽ затрат` +
        (roiPct != null ? ` ⇒ ROI ${round(roiPct, 0)}%` : "") +
        (paybackMonth != null ? `, окупаемость на ${paybackMonth}-м месяце.` : " (не окупается на горизонте — увеличь горизонт/трафик).") +
        ` К концу — рантрейт ${ru(round(last?.monthlyValue ?? 0))} ₽/мес (контент компаундится).`,
      methodology:
        "Каждый материал набирает трафик линейно за rampMonths, держит steadyStateVisits до lifespanMonths, затем отключается. " +
        "Месячный трафик = Σ по когортам; конверсии = трафик×CR; ценность = конверсии×value. ROI = (Σценность−Σзатраты)/Σзатраты.",
      assumptions: [
        "Кривая трафика (ramp→плато→обрыв) — упрощение; реально это плавный рост и затухание.",
        "Все материалы одинаковы по трафику; в жизни распределение длиннохвостое (немногие дают большинство).",
        "CR и ценность стабильны; интент материалов различается.",
      ],
      disclaimer: "Плановая оценка на ВАШИХ данных, не гарантия. Сверяйте с реальной кривой накопления трафика по вашим материалам.",
    };

    const summary =
      `Контент-ROI (${horizon} мес.): ${ru(round(cumValue))} ₽ ценности vs ${ru(round(cumSpend))} ₽ затрат` +
      (roiPct != null ? `, ROI ${round(roiPct, 0)}%` : "") +
      (paybackMonth != null ? `, окупаемость на ${paybackMonth}-м мес.` : ", не окупается на горизонте") +
      `. Рантрейт ${ru(round(last?.monthlyValue ?? 0))} ₽/мес.`;

    return toContent(summary, payload);
  },
};

export const DISCIPLINE_TOOLS: ToolDef[] = [
  seoOpportunity,
  socialMediaPlanner,
  prValueEstimator,
  eventRoiPlanner,
  asoPlanner,
  contentPlanRoi,
];
