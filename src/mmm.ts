/**
 * MMM group for NECTARIN Intelligence — Cloudflare Workers.
 *
 * `mmm_optimize` — a lightweight Marketing Mix Model. For each channel it fits,
 * from the operator's OWN spend/conversions TIME SERIES (no fabricated data):
 *   • adstock (carryover): x_t = spend_t + λ·x_{t-1}, λ∈[0,0.9] grid-searched
 *   • saturation (diminishing returns): conversions ≈ a·x^b, fitted by log-log
 *     least squares with b constrained to (0,1].
 * The decay λ maximizing the fit R² is chosen per channel. It then computes the
 * conversion-maximizing steady-state budget allocation across channels via exact
 * Lagrange bisection (marginal conversions-per-RUB equalized across funded
 * channels ⇒ a single blended marginal CPA = 1/λ*).
 *
 * Fully deterministic. Honest about confidence: each channel reports its fit R²
 * and a lowConfidence flag when there aren't enough positive data points.
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

const ADSTOCK_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/** Geometric adstock transform: x_t = spend_t + λ·x_{t-1}. */
function adstock(spend: number[], lambda: number): number[] {
  const out: number[] = [];
  let carry = 0;
  for (const s of spend) {
    carry = s + lambda * carry;
    out.push(carry);
  }
  return out;
}

interface Fit {
  a: number;
  b: number;
  r2: number;
  n: number;
}

/**
 * Log-log least squares of y ≈ a·x^b over points with x>0 AND y>0.
 * Returns null when fewer than 3 positive pairs (can't fit a slope reliably).
 */
function fitPowerLogLog(x: number[], y: number[]): Fit | null {
  const X: number[] = [];
  const Y: number[] = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] > 0 && y[i] > 0) {
      X.push(Math.log(x[i]));
      Y.push(Math.log(y[i]));
    }
  }
  const n = X.length;
  if (n < 3) return null;
  const mx = X.reduce((s, v) => s + v, 0) / n;
  const my = Y.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (X[i] - mx) ** 2;
    sxy += (X[i] - mx) * (Y[i] - my);
  }
  if (sxx <= 0) return null; // no spend variation ⇒ slope undefined
  const b = sxy / sxx;
  const lnA = my - b * mx;
  // R² in log space.
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = lnA + b * X[i];
    ssRes += (Y[i] - pred) ** 2;
    ssTot += (Y[i] - my) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { a: Math.exp(lnA), b, r2, n };
}

interface ChannelFit {
  name: string;
  lambda: number;
  a: number;
  b: number;
  r2: number;
  points: number;
  lowConfidence: boolean;
  currentSpend: number; // mean per-period spend
}

/** Fit adstock λ (by max R²) + saturation a,b for one channel. */
function fitChannel(name: string, spend: number[], conversions: number[]): ChannelFit {
  const currentSpend = spend.reduce((s, v) => s + v, 0) / spend.length;
  let best: { lambda: number; fit: Fit } | null = null;
  for (const lambda of ADSTOCK_GRID) {
    const x = adstock(spend, lambda);
    const fit = fitPowerLogLog(x, conversions);
    if (fit && (!best || fit.r2 > best.fit.r2)) best = { lambda, fit };
  }
  if (!best) {
    // Not enough signal to fit — fall back to a diminishing-returns prior.
    const totalConv = conversions.reduce((s, v) => s + v, 0);
    const a = currentSpend > 0 && totalConv > 0 ? (totalConv / conversions.length) / Math.pow(currentSpend, 0.7) : 0;
    return { name, lambda: 0, a, b: 0.7, r2: 0, points: 0, lowConfidence: true, currentSpend };
  }
  // Constrain the saturation exponent to a sane diminishing-returns range.
  let b = best.fit.b;
  let { a } = best.fit;
  let lowConfidence = best.fit.r2 < 0.3 || best.fit.n < 4;
  if (!(b > 0)) {
    b = 0.3;
    lowConfidence = true;
  }
  if (b > 1) b = 1;
  return { name, lambda: best.lambda, a, b, r2: best.fit.r2, points: best.fit.n, lowConfidence, currentSpend };
}

/** Steady-state conversions for a CONSTANT per-period spend s under adstock λ. */
function steadyConversions(f: ChannelFit, s: number): number {
  if (f.a <= 0 || s <= 0) return 0;
  const xss = s / (1 - f.lambda); // geometric adstock steady state
  return f.a * Math.pow(xss, f.b);
}

/** Spend that drives marginal conversions-per-RUB to exactly `lambdaMult`. */
function spendForMarginal(f: ChannelFit, lambdaMult: number): number {
  if (f.a <= 0 || lambdaMult <= 0) return 0;
  const k = Math.pow(1 / (1 - f.lambda), f.b); // adstock steady-state gain
  // marginal(s) = a·b·k·s^{b-1} = lambdaMult  ⇒  s = (a·b·k / lambdaMult)^{1/(1-b)}
  const coeff = f.a * f.b * k;
  if (coeff <= 0) return 0;
  if (f.b >= 1) {
    // Linear (no diminishing returns): marginal is constant ⇒ all-or-nothing.
    return coeff > lambdaMult ? Infinity : 0;
  }
  return Math.pow(coeff / lambdaMult, 1 / (1 - f.b));
}

/** Allocate `budget` to maximize total steady-state conversions (Lagrange bisection). */
function allocate(fits: ChannelFit[], budget: number): number[] {
  const totalSpend = (mult: number) =>
    fits.reduce((s, f) => {
      const v = spendForMarginal(f, mult);
      return s + (Number.isFinite(v) ? v : 0);
    }, 0);
  // total spend is decreasing in the marginal multiplier; bisect in log space.
  let lo = 1e-9;
  let hi = 1e9;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (totalSpend(mid) > budget) lo = mid;
    else hi = mid;
  }
  const mult = Math.sqrt(lo * hi);
  const raw = fits.map((f) => {
    const v = spendForMarginal(f, mult);
    return Number.isFinite(v) ? v : 0;
  });
  // Numeric guard: rescale to hit the budget exactly.
  const sum = raw.reduce((s, v) => s + v, 0);
  if (sum > 0) return raw.map((v) => (v / sum) * budget);
  return fits.map(() => budget / fits.length);
}

const mmmOptimize: ToolDef = {
  name: "mmm_optimize",
  description:
    "Marketing Mix Model (MMM-lite). From each channel's spend & conversions TIME SERIES, fits adstock/carryover (geometric decay λ, grid-searched by fit R²) and saturation (conversions = a·effectiveSpend^b, log-log least squares, 0<b≤1), then computes the conversion-maximizing STEADY-STATE budget split across channels via exact Lagrange bisection (marginal CPA equalized across funded channels). Returns per-channel adstock decay, saturation elasticity, fit R²/confidence, recommended spend, projected steady-state conversions, marginal CPA, and uplift vs. current. Uses YOUR real series — deterministic, model-based decision support (not real benchmarks).",
  inputSchema: {
    type: "object",
    properties: {
      channels: {
        type: "array",
        minItems: 1,
        description: "Channels, each with aligned spend[] and conversions[] time series (≥4 periods)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Channel name" },
            spend: {
              type: "array",
              minItems: 4,
              items: { type: "number", minimum: 0 },
              description: "Per-period spend (RUB), oldest→newest",
            },
            conversions: {
              type: "array",
              minItems: 4,
              items: { type: "number", minimum: 0 },
              description: "Per-period conversions, aligned with spend",
            },
          },
          required: ["name", "spend", "conversions"],
          additionalProperties: false,
        },
      },
      totalBudget: {
        type: "number",
        exclusiveMinimum: 0,
        description: "Per-period budget to allocate (RUB). Default = sum of channels' mean per-period spend.",
      },
    },
    required: ["channels"],
    additionalProperties: false,
  },
  async handler(input) {
    const channels = (input.channels ?? []) as Array<{
      name: string;
      spend: number[];
      conversions: number[];
    }>;
    for (const c of channels) {
      if (!Array.isArray(c.spend) || !Array.isArray(c.conversions)) {
        throw new Error(`Channel '${c.name}' must have spend[] and conversions[] arrays.`);
      }
      if (c.spend.length !== c.conversions.length) {
        throw new Error(`Channel '${c.name}': spend[] and conversions[] must be the same length.`);
      }
      if (c.spend.length < 4) {
        throw new Error(`Channel '${c.name}': need at least 4 periods to fit adstock + saturation.`);
      }
    }

    const fits = channels.map((c) => fitChannel(c.name, c.spend, c.conversions));
    const warnings: string[] = [];
    for (const f of fits) {
      if (f.lowConfidence) {
        warnings.push(`Channel '${f.name}': low-confidence fit (R²=${round(f.r2, 2)}, points=${f.points}) — treat its curve as indicative.`);
      }
    }

    const currentTotal = fits.reduce((s, f) => s + f.currentSpend, 0);
    const totalBudget =
      typeof input.totalBudget === "number" && input.totalBudget > 0 ? input.totalBudget : currentTotal;

    const recommended = allocate(fits, totalBudget);
    const marginalAtMult =
      // Blended marginal multiplier (conv/RUB) implied by the solution → CPA = 1/mult.
      (() => {
        // Derive from the funded channels: at optimum marginal_i is equal; compute one.
        for (let i = 0; i < fits.length; i++) {
          const f = fits[i];
          const s = recommended[i];
          if (f.a > 0 && s > 0 && f.b < 1) {
            const k = Math.pow(1 / (1 - f.lambda), f.b);
            return f.a * f.b * k * Math.pow(s, f.b - 1);
          }
        }
        return 0;
      })();
    const blendedMarginalCPA = marginalAtMult > 0 ? round(1 / marginalAtMult) : null;

    const rows = fits.map((f, i) => {
      const recSpend = recommended[i];
      const projConv = steadyConversions(f, recSpend);
      const curConv = steadyConversions(f, f.currentSpend);
      const k = Math.pow(1 / (1 - f.lambda), f.b);
      const marginal = f.a > 0 && recSpend > 0 && f.b < 1 ? f.a * f.b * k * Math.pow(recSpend, f.b - 1) : 0;
      return {
        name: f.name,
        adstockDecay: round(f.lambda, 2),
        carryoverHalfLife: f.lambda > 0 ? round(Math.log(0.5) / Math.log(f.lambda), 1) : 0,
        saturationElasticity: round(f.b, 3),
        scaleA: round(f.a, 4),
        fitR2: round(f.r2, 3),
        dataPoints: f.points,
        lowConfidence: f.lowConfidence,
        currentSpend: round(f.currentSpend),
        recommendedSpend: round(recSpend),
        spendDeltaPct: f.currentSpend > 0 ? round(((recSpend - f.currentSpend) / f.currentSpend) * 100, 1) : null,
        currentSteadyConversions: round(curConv, 1),
        projectedConversions: round(projConv, 1),
        marginalCPA: marginal > 0 ? round(1 / marginal) : null,
      };
    });
    rows.sort((x, y) => y.recommendedSpend - x.recommendedSpend);

    const curTotalConv = fits.reduce((s, f) => s + steadyConversions(f, f.currentSpend), 0);
    const projTotalConv = rows.reduce((s, r) => s + r.projectedConversions, 0);
    const upliftPct = curTotalConv > 0 ? round(((projTotalConv - curTotalConv) / curTotalConv) * 100, 1) : null;
    const blendedCurrentCPA = curTotalConv > 0 ? round(currentTotal / curTotalConv) : null;
    const blendedProjectedCPA = projTotalConv > 0 ? round(totalBudget / projTotalConv) : null;

    const payload = {
      model: "MMM-lite: geometric adstock × power saturation (conversions = a·adstock(spend)^b)",
      periods: channels[0].spend.length,
      totalBudget: round(totalBudget),
      isReallocation: !(typeof input.totalBudget === "number" && input.totalBudget > 0),
      channels: rows,
      totals: {
        currentSpend: round(currentTotal),
        currentSteadyConversions: round(curTotalConv, 1),
        projectedConversions: round(projTotalConv, 1),
        upliftPct,
        blendedCurrentCPA,
        blendedProjectedCPA,
        blendedMarginalCPA,
      },
      methodology:
        "Per channel: adstock x_t = spend_t + λ·x_{t-1} (λ grid-searched to maximize log-log R²); saturation conversions = a·x^b via least squares (0<b≤1). Steady state for constant spend s: x_ss = s/(1-λ). Allocation maximizes Σ a_i·x_ss^b_i s.t. Σspend = budget via Lagrange bisection ⇒ marginal CPA equalized across funded channels.",
      warnings,
      disclaimer:
        "Model-based decision support, not real benchmarks. Fit quality (R²) reflects how well the historical series supports the curve; low-confidence channels should be validated before reallocating spend.",
    };

    const summary =
      `MMM по ${rows.length} каналам (${channels[0].spend.length} периодов), бюджет ${ru(round(totalBudget))} ₽: ` +
      `прогноз ${ru(round(projTotalConv, 1))} конв.` +
      (upliftPct != null ? ` (${upliftPct >= 0 ? "+" : ""}${upliftPct}% к текущему стабильному уровню)` : "") +
      (blendedMarginalCPA != null ? `, предельный CPA ~${ru(blendedMarginalCPA)} ₽.` : ".");
    return toContent(summary, payload);
  },
};

export const MMM_TOOLS: ToolDef[] = [mmmOptimize];
