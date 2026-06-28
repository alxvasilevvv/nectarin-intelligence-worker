/**
 * GROWTH LAB tool group (v2.51) for NECTARIN Intelligence — Workers.
 *
 *   • cohort_retention_curve — fit a power-law retention curve r(t)=a·t^(−b) to YOUR
 *     cohort retention points (log-log least squares), project D1/D7/D30/D90/D365,
 *     report fit quality (R²) and, given ARPU, an LTV estimate over a horizon.
 *   • viral_loop — referral/virality model: k-factor = invites × conversion, the
 *     amplification multiplier 1/(1−k), seed→total user projection, and referral-
 *     incentive economics (profit per referred user, break-even incentive ceiling).
 *
 * Deterministic growth math on YOUR numbers — planning estimates, not guarantees.
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
function round(n: number, d = 2): number {
  const f = 10 ** d;
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

interface RetentionPoint {
  day: number;
  retentionPct: number;
}

const cohortRetentionCurve: ToolDef = {
  name: "cohort_retention_curve",
  description:
    "Cohort retention modeling for a product / growth / CRM marketer. From YOUR cohort retention points (day + retention %, e.g. D1=40, D7=22, D30=12) it fits a power-law curve r(t)=a·t^(−b) via log-log least squares, projects retention at D1/D7/D30/D90/D365, reports fit quality (R²), and — given ARPU per active user per day — estimates LTV over a horizon (default 365 days) as ARPU×Σr(t). Use it to forecast long-run retention and LTV from a short observed window. Deterministic curve-fit on your data — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      points: {
        type: "array",
        minItems: 2,
        description: "Observed retention points",
        items: {
          type: "object",
          properties: {
            day: { type: "number", exclusiveMinimum: 0, description: "Day since cohort start (>0)" },
            retentionPct: { type: "number", minimum: 0, maximum: 100, description: "Retained share at that day, %" },
          },
          required: ["day", "retentionPct"],
          additionalProperties: false,
        },
      },
      arpuDaily: { type: "number", minimum: 0, description: "Optional revenue per ACTIVE user per day (RUB) — enables an LTV estimate" },
      horizonDays: { type: "number", minimum: 1, maximum: 3650, description: "LTV horizon in days (default 365)" },
    },
    required: ["points"],
    additionalProperties: false,
  },
  async handler(input) {
    const raw = Array.isArray(input?.points) ? (input.points as RetentionPoint[]) : [];
    const pts = raw
      .filter((p) => isRecord(p) && Number(p.day) > 0 && Number(p.retentionPct) > 0)
      .map((p) => ({ day: Number(p.day), retentionPct: Number(p.retentionPct) }));
    if (pts.length < 2) {
      throw new Error("Provide at least 2 retention points with day>0 and retentionPct>0.");
    }
    const horizon = clamp(Math.round(Number(input?.horizonDays) || 365), 1, 3650);

    // Log-log least squares: ln r = ln a − b·ln t.
    const xs = pts.map((p) => Math.log(p.day));
    const ys = pts.map((p) => Math.log(p.retentionPct / 100));
    const n = pts.length;
    const sx = xs.reduce((a, b) => a + b, 0);
    const sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, b) => a + b * b, 0);
    const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
    const denom = n * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom; // = −b
    const intercept = (sy - slope * sx) / n; // = ln a
    const a = Math.exp(intercept);
    const b = -slope;

    // R² on the log fit.
    const meanY = sy / n;
    let ssTot = 0;
    let ssRes = 0;
    for (let i = 0; i < n; i++) {
      const pred = intercept + slope * xs[i];
      ssRes += (ys[i] - pred) ** 2;
      ssTot += (ys[i] - meanY) ** 2;
    }
    const r2 = ssTot === 0 ? 1 : clamp(1 - ssRes / ssTot, 0, 1);

    const model = (t: number) => clamp(a * Math.pow(t, -b) * 100, 0, 100); // percent
    const milestones = [1, 7, 30, 90, 365].map((d) => ({ day: d, retentionPct: round(model(d), 1) }));

    let ltv: number | null = null;
    let retainedUserDays: number | null = null;
    const arpuDaily = Number(input?.arpuDaily);
    if (Number.isFinite(arpuDaily) && arpuDaily > 0) {
      let area = 0;
      for (let t = 1; t <= horizon; t++) area += model(t) / 100;
      retainedUserDays = round(area, 1);
      ltv = round(arpuDaily * area, 2);
    }

    const halfLifeDay = b > 0 ? round(Math.pow(a / 0.5, 1 / b), 1) : null; // day where r=50%

    const payload = {
      tool: "cohort_retention_curve",
      model: { form: "r(t) = a · t^(-b)", a: round(a, 4), b: round(b, 4), r2: round(r2, 4) },
      observed: pts,
      projected: milestones,
      halfLifeDay,
      ltv:
        ltv !== null
          ? { arpuDaily: round(arpuDaily, 2), horizonDays: horizon, retainedUserDays, ltvRub: ltv }
          : null,
      verdict:
        r2 >= 0.9
          ? "Кривая хорошо описывает данные — прогнозу можно доверять."
          : r2 >= 0.7
          ? "Умеренное соответствие — прогноз ориентировочный, добавьте точек."
          : "Слабое соответствие — мало данных или нестепенная форма; трактуйте осторожно.",
      assumptions: [
        "Степенная модель удержания (power-law) — типична для продуктовых когорт.",
        "Прогноз экстраполирует наблюдаемое окно; реальное удержание зависит от продукта и сезонности.",
        "LTV = ARPU(день) × Σ удержания по дням горизонта (без дисконтирования).",
      ],
      disclaimer: "Оценка по вашим данным, не гарантия.",
    };

    const summary =
      `Удержание r(t)=${round(a, 3)}·t^(-${round(b, 3)}) (R²=${round(r2, 3)}): ` +
      `D30≈${round(model(30), 1)}%, D90≈${round(model(90), 1)}%, D365≈${round(model(365), 1)}%` +
      (ltv !== null ? `; LTV(${horizon}д)≈${ru(ltv)} ₽.` : ".");
    return toContent(summary, payload);
  },
};

const viralLoop: ToolDef = {
  name: "viral_loop",
  description:
    "Referral / virality model for a growth marketer. From invites per user (i) and invite→signup conversion (c%), it computes the viral k-factor (k=i·c), classifies the loop (viral if k≥1), and for k<1 the amplification multiplier 1/(1−k). Given a paid/seed cohort it projects total users (seed×amplification) and the organic uplift. Optional referral-incentive economics: profit per referred user (LTV−incentive) and the break-even incentive ceiling. Deterministic growth math on your inputs — a planning estimate, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      invitesPerUser: { type: "number", minimum: 0, description: "Average invites each user sends (i)" },
      conversionPct: { type: "number", minimum: 0, maximum: 100, description: "Invite→signup conversion (c), %" },
      seedUsers: { type: "number", minimum: 0, description: "Optional paid/seed users to amplify through the loop" },
      ltvPerUser: { type: "number", minimum: 0, description: "Optional LTV per user (RUB) for incentive economics" },
      incentivePerReferral: { type: "number", minimum: 0, description: "Optional incentive paid per successful referral (RUB)" },
    },
    required: ["invitesPerUser", "conversionPct"],
    additionalProperties: false,
  },
  async handler(input) {
    const i = Math.max(0, Number(input?.invitesPerUser) || 0);
    const c = clamp(Number(input?.conversionPct) || 0, 0, 100);
    const k = round(i * (c / 100), 4);
    const isViral = k >= 1;
    const amplification = isViral ? null : round(1 / (1 - k), 3);

    let projection: Record<string, unknown> | null = null;
    const seed = Number(input?.seedUsers);
    if (Number.isFinite(seed) && seed > 0) {
      if (isViral) {
        projection = {
          seedUsers: Math.round(seed),
          note: "k≥1 — петля самоподдерживающаяся (экспоненциальный рост); конечный множитель не определён без ограничения насыщения.",
        };
      } else {
        const total = seed * (amplification as number);
        projection = {
          seedUsers: Math.round(seed),
          amplification,
          totalUsers: Math.round(total),
          organicUsers: Math.round(total - seed),
          organicSharePct: round(((total - seed) / total) * 100, 1),
        };
      }
    }

    let incentive: Record<string, unknown> | null = null;
    const ltv = Number(input?.ltvPerUser);
    const cost = Number(input?.incentivePerReferral);
    if (Number.isFinite(ltv) && ltv > 0 && Number.isFinite(cost) && cost >= 0) {
      const profitPerReferred = round(ltv - cost, 2);
      incentive = {
        ltvPerUser: round(ltv, 2),
        incentivePerReferral: round(cost, 2),
        profitPerReferredUser: profitPerReferred,
        breakEvenIncentiveCeiling: round(ltv, 2),
        profitable: profitPerReferred > 0,
        verdict:
          profitPerReferred > 0
            ? "Реферальная программа прибыльна: LTV покрывает стимул."
            : "Стимул выше LTV — программа убыточна, снизьте вознаграждение.",
      };
    }

    const payload = {
      tool: "viral_loop",
      inputs: { invitesPerUser: i, conversionPct: c },
      kFactor: k,
      classification: isViral
        ? "viral (k≥1) — самоподдерживающийся рост"
        : k >= 0.5
        ? "sub-viral, сильная амплификация"
        : k > 0
        ? "sub-viral, слабая амплификация"
        : "нет вирусности",
      amplificationMultiplier: amplification,
      projection,
      incentive,
      assumptions: [
        "k = i × c; амплификация 1/(1−k) — сумма геометрической прогрессии вкладов петли.",
        "Модель без насыщения рынка и без затухания вовлечённости со временем.",
      ],
      disclaimer: "Оценка по вашим данным, не гарантия.",
    };

    const summary =
      `k-фактор = ${k} (${isViral ? "виральный рост" : `амплификация ×${amplification}`})` +
      (projection && !isViral ? `; из ${ru(Math.round(seed))} seed → ~${ru(Math.round(seed * (amplification as number)))} юзеров.` : ".");
    return toContent(summary, payload);
  },
};

export const GROWTHLAB_TOOLS: ToolDef[] = [cohortRetentionCurve, viralLoop];
