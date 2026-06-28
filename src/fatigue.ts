/**
 * CREATIVE OPS tool group (v2.19) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • creative_fatigue — a creative burnout detector. From each creative's daily CTR
 *     series (or impressions[]+clicks[]), it finds the peak CTR, the decline from
 *     peak, the recent trend (least-squares slope), a 0–100 fatigue score + stage
 *     (fresh / maturing / fatigued / burnt), and — when CTR is still falling — an
 *     estimated number of days until it crosses the refresh threshold (default 70%
 *     of peak). Ranks creatives worst-first and recommends which to refresh now.
 *
 * Fully deterministic, on the operator's OWN performance series. No LLM, no PII.
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

/** Least-squares slope of y over index 0..n-1 (units: y per step). */
function slope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (i - mx) ** 2;
    sxy += (i - mx) * (y[i] - my);
  }
  return sxx > 0 ? sxy / sxx : 0;
}

interface CreativeIn {
  name: string;
  ctr?: number[];
  impressions?: number[];
  clicks?: number[];
}

type Stage = "fresh" | "maturing" | "fatigued" | "burnt";
type Recommendation = "healthy" | "monitor" | "prepare_refresh" | "refresh_now";

interface CreativeOut {
  name: string;
  points: number;
  peakCtr: number;
  peakDay: number;
  currentCtr: number;
  declineFromPeakPct: number;
  trendSlopePerDay: number;
  recentVsEarlyPct: number | null;
  fatigueScore: number;
  stage: Stage;
  daysToRefreshThreshold: number | null;
  recommendation: Recommendation;
  note: string;
  error?: string;
}

function analyze(c: CreativeIn, refreshThresholdPct: number): CreativeOut {
  // Resolve a CTR (%) series.
  let ctr: number[] | null = null;
  if (Array.isArray(c.ctr) && c.ctr.length >= 3) {
    ctr = c.ctr.map((v) => Number(v));
  } else if (
    Array.isArray(c.impressions) &&
    Array.isArray(c.clicks) &&
    c.impressions.length === c.clicks.length &&
    c.impressions.length >= 3
  ) {
    ctr = c.impressions.map((imp, i) => {
      const im = Number(imp);
      const cl = Number(c.clicks![i]);
      return im > 0 ? (cl / im) * 100 : 0;
    });
  }

  const base: CreativeOut = {
    name: String(c.name ?? ""),
    points: 0,
    peakCtr: 0,
    peakDay: 0,
    currentCtr: 0,
    declineFromPeakPct: 0,
    trendSlopePerDay: 0,
    recentVsEarlyPct: null,
    fatigueScore: 0,
    stage: "fresh",
    daysToRefreshThreshold: null,
    recommendation: "healthy",
    note: "",
  };

  if (!ctr || ctr.some((v) => !Number.isFinite(v))) {
    return {
      ...base,
      error: "Нужен ctr[] (в %) либо impressions[]+clicks[] одинаковой длины, ≥3 точек.",
      note: "Недостаточно данных для оценки выгорания.",
    };
  }

  const n = ctr.length;
  const peakCtr = Math.max(...ctr);
  const peakDay = ctr.indexOf(peakCtr) + 1;
  const currentCtr = ctr[n - 1];
  const declineFromPeakPct = peakCtr > 0 ? clamp(((peakCtr - currentCtr) / peakCtr) * 100, 0, 100) : 0;
  const sl = slope(ctr); // CTR points per day

  // Recent vs early thirds (momentum).
  const third = Math.max(1, Math.floor(n / 3));
  const earlyAvg = ctr.slice(0, third).reduce((s, v) => s + v, 0) / third;
  const recentAvg = ctr.slice(n - third).reduce((s, v) => s + v, 0) / third;
  const recentVsEarlyPct = earlyAvg > 0 ? round(((recentAvg - earlyAvg) / earlyAvg) * 100, 1) : null;

  // Fatigue score: decline from peak, plus a penalty if still trending down.
  let fatigueScore = declineFromPeakPct;
  if (sl < 0) fatigueScore += 10;
  if (recentVsEarlyPct != null && recentVsEarlyPct < 0) fatigueScore += 5;
  fatigueScore = clamp(round(fatigueScore), 0, 100);

  const stage: Stage =
    fatigueScore >= 70 ? "burnt" : fatigueScore >= 45 ? "fatigued" : fatigueScore >= 20 ? "maturing" : "fresh";

  // Days until CTR crosses the refresh threshold (peak × threshold%).
  const thresholdCtr = peakCtr * (refreshThresholdPct / 100);
  let daysToRefreshThreshold: number | null = null;
  if (currentCtr <= thresholdCtr) {
    daysToRefreshThreshold = 0;
  } else if (sl < 0) {
    daysToRefreshThreshold = round((currentCtr - thresholdCtr) / -sl, 1);
  }

  let recommendation: Recommendation;
  if (currentCtr <= thresholdCtr) recommendation = "refresh_now";
  else if (daysToRefreshThreshold != null && daysToRefreshThreshold <= 7) recommendation = "prepare_refresh";
  else if (sl < 0 || stage === "maturing") recommendation = "monitor";
  else recommendation = "healthy";

  const noteMap: Record<Recommendation, string> = {
    refresh_now: `CTR упал до ${round((currentCtr / (peakCtr || 1)) * 100)}% от пика — обновляй креатив сейчас.`,
    prepare_refresh: `CTR пробьёт порог обновления через ~${daysToRefreshThreshold} дн. — готовь новые версии.`,
    monitor: "Есть признаки усталости — держи на радаре, готовь варианты.",
    healthy: "Признаков выгорания нет — креатив работает.",
  };

  return {
    ...base,
    points: n,
    peakCtr: round(peakCtr, 3),
    peakDay,
    currentCtr: round(currentCtr, 3),
    declineFromPeakPct: round(declineFromPeakPct, 1),
    trendSlopePerDay: round(sl, 4),
    recentVsEarlyPct,
    fatigueScore,
    stage,
    daysToRefreshThreshold,
    recommendation,
    note: noteMap[recommendation],
  };
}

const creativeFatigue: ToolDef = {
  name: "creative_fatigue",
  description:
    "Creative burnout detector. From each creative's daily CTR series (ctr[] in %, or impressions[]+clicks[]), finds peak CTR, decline from peak, the recent least-squares trend, a 0–100 fatigue score + stage (fresh/maturing/fatigued/burnt), and — when CTR is still falling — the estimated days until it crosses the refresh threshold (default 70% of peak). Ranks creatives worst-first and recommends which to refresh now / prepare to refresh / monitor. Deterministic, on YOUR performance series — decision support, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      creatives: {
        type: "array",
        minItems: 1,
        description: "Creatives to check, each with a daily CTR series (or impressions[]+clicks[]), oldest→newest, ≥3 points",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Creative name/label" },
            ctr: {
              type: "array",
              minItems: 3,
              items: { type: "number", minimum: 0 },
              description: "Daily CTR in % (oldest→newest). Provide this OR impressions+clicks.",
            },
            impressions: {
              type: "array",
              minItems: 3,
              items: { type: "number", minimum: 0 },
              description: "Daily impressions (used with clicks[] to derive CTR if ctr[] is absent)",
            },
            clicks: {
              type: "array",
              minItems: 3,
              items: { type: "number", minimum: 0 },
              description: "Daily clicks, aligned with impressions[]",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
      refreshThresholdPct: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: 100,
        description: "Refresh when current CTR drops below this % of peak CTR. Default 70.",
      },
    },
    required: ["creatives"],
    additionalProperties: false,
  },
  async handler(input) {
    const creatives = (input.creatives ?? []) as CreativeIn[];
    const refreshThresholdPct =
      typeof input.refreshThresholdPct === "number" && input.refreshThresholdPct > 0
        ? clamp(input.refreshThresholdPct, 1, 100)
        : 70;
    if (!creatives.length) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один креатив в creatives." }], isError: true };
    }

    const results = creatives.map((c) => analyze(c, refreshThresholdPct));
    // Worst (most fatigued) first; errored creatives sink to the bottom.
    results.sort((a, b) => {
      if (a.error && !b.error) return 1;
      if (!a.error && b.error) return -1;
      return b.fatigueScore - a.fatigueScore;
    });

    const valid = results.filter((r) => !r.error);
    const refreshNow = valid.filter((r) => r.recommendation === "refresh_now").map((r) => r.name);
    const prepare = valid.filter((r) => r.recommendation === "prepare_refresh").map((r) => r.name);
    const worst = valid[0] ?? null;

    const payload = {
      refreshThresholdPct: round(refreshThresholdPct, 1),
      creatives: results,
      summary: {
        total: results.length,
        analyzed: valid.length,
        refreshNow,
        prepareRefresh: prepare,
        worstCreative: worst ? { name: worst.name, fatigueScore: worst.fatigueScore, stage: worst.stage } : null,
      },
      methodology:
        "CTR series → peak, decline from peak, least-squares slope (CTR pts/day), recent-vs-early momentum. Fatigue score = decline% + penalties for downward trend. Days-to-threshold = (CTR − peak·threshold) / −slope (only while declining).",
      assumptions: [
        "Выгорание оценивается ТОЛЬКО по динамике CTR — внешние факторы (сезон, аукцион, ставки) не разделяются.",
        `Порог обновления: CTR < ${round(refreshThresholdPct, 1)}% от пикового.`,
        "Дни до порога — линейная экстраполяция текущего тренда; при росте/плато не считаются.",
      ],
      disclaimer: "Эвристика на ВАШИХ данных, не гарантия. Подтверждайте решение тестом нового креатива.",
    };

    const head = worst
      ? `Худший: «${worst.name}» — fatigue ${worst.fatigueScore}/100 (${worst.stage}). `
      : "";
    const action = refreshNow.length
      ? `Обновить сейчас: ${refreshNow.join(", ")}.`
      : prepare.length
        ? `Готовить замену: ${prepare.join(", ")}.`
        : "Срочных замен не требуется.";
    const summary = `Проверка выгорания ${results.length} креативов (порог ${round(refreshThresholdPct, 1)}% от пика). ${head}${action}`;

    return toContent(summary, payload);
  },
};

export const CREATIVE_OPS_TOOLS: ToolDef[] = [creativeFatigue];
