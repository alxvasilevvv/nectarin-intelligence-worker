/**
 * FORESIGHT & STRATEGY tool group (v2.58) for NECTARIN Intelligence — Workers.
 * Three methodology-grounded, deterministic planning tools that deepen the
 * forecasting / strategy layer of the catalogue.
 *
 *   • demand_forecast — deterministic time-series forecast (Holt's linear-trend double
 *     exponential smoothing, with optional multiplicative seasonality via classical
 *     decomposition) projecting the next N periods with a residual-based confidence band.
 *     Distinct from seasonality_forecast (which returns a category seasonality index) and
 *     anomaly_detector (which flags outliers, not a forward projection).
 *   • customer_journey_map — maps the lifecycle (awareness → consideration → purchase →
 *     retention → advocacy) to channels, content and a primary KPI per stage, computes
 *     stage-to-stage conversion when volumes are supplied, and flags coverage gaps (a stage
 *     with no channels or no content) plus the biggest drop-off. Deterministic gap analysis.
 *   • competitive_positioning_map — a 2-axis perceptual / positioning map (e.g. price ×
 *     value/quality): normalizes competitors onto the plane, splits at the mean of each
 *     axis into four quadrants, places each player (incl. YOU), computes a value-for-money
 *     index and finds the empty quadrants (white-space opportunities). Deterministic.
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
function ru(n: number): string {
  try {
    return Math.round(n).toLocaleString("ru-RU");
  } catch {
    return String(Math.round(n));
  }
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ── 1. Demand forecast (Holt linear trend + optional seasonality) ────────────

// Two-sided z multipliers for the requested confidence level.
const Z_FOR_CONF: Record<number, number> = { 80: 1.2816, 90: 1.6449, 95: 1.96 };

const demandForecast: ToolDef = {
  name: "demand_forecast",
  description:
    "Deterministic demand / time-series FORECAST for any marketing series (sales, leads, traffic, revenue, installs). Give an ordered `series` of ≥3 equally-spaced observations and it projects the next `periods` using Holt's linear-trend double exponential smoothing — returning a point forecast, a residual-based confidence band (lower/upper from in-sample one-step RMSE, widening with the horizon), the fitted level & per-period trend, MAPE and fit quality. Optionally pass `seasonLength` (e.g. 12 monthly, 7 daily, 4 quarterly) with ≥2 full cycles of data to add MULTIPLICATIVE seasonality via classical decomposition (deseasonalize → Holt → reseasonalize). Distinct from seasonality_forecast (category index) and anomaly_detector (outlier flagging). Deterministic math on your numbers — a projection, not a guarantee.",
  inputSchema: {
    type: "object",
    properties: {
      series: {
        type: "array",
        minItems: 3,
        description: "Ordered, equally-spaced historical observations (oldest → newest), ≥3 numbers",
        items: { type: "number" },
      },
      periods: { type: "number", minimum: 1, maximum: 60, description: "How many future periods to project (default 6)" },
      seasonLength: { type: "number", minimum: 2, description: "Optional season length for multiplicative seasonality (e.g. 12, 7, 4). Needs ≥2 full cycles." },
      alpha: { type: "number", minimum: 0.01, maximum: 1, description: "Level smoothing 0.01–1 (default 0.5)" },
      beta: { type: "number", minimum: 0.01, maximum: 1, description: "Trend smoothing 0.01–1 (default 0.3)" },
      confidencePct: { type: "number", enum: [80, 90, 95], description: "Confidence band level (default 80)" },
      label: { type: "string", description: "Optional metric label for the summary, e.g. 'выручка', 'лиды'" },
    },
    required: ["series"],
    additionalProperties: false,
  },
  async handler(input) {
    const rawSeries = Array.isArray(input?.series) ? input.series : [];
    const series: number[] = [];
    for (const v of rawSeries) {
      const n = num(v);
      if (n !== null) series.push(n);
    }
    if (series.length < 3) {
      return errResult("Нужен series из ≥3 числовых наблюдений (упорядочены от старых к новым).");
    }
    const n = series.length;
    const periods = Math.round(clamp(num(input?.periods) ?? 6, 1, 60));
    const alpha = clamp(num(input?.alpha) ?? 0.5, 0.01, 1);
    const beta = clamp(num(input?.beta) ?? 0.3, 0.01, 1);
    const confidencePct = [80, 90, 95].includes(num(input?.confidencePct) as number)
      ? (num(input?.confidencePct) as number)
      : 80;
    const z = Z_FOR_CONF[confidencePct];
    const label = typeof input?.label === "string" && input.label.trim() ? input.label.trim() : "показатель";

    // Optional multiplicative seasonality via classical decomposition.
    let seasonLength = num(input?.seasonLength);
    let seasonalIndices: number[] | null = null;
    let seasonalityNote: string | null = null;
    if (seasonLength !== null) {
      seasonLength = Math.round(seasonLength);
      if (seasonLength < 2) {
        seasonLength = null;
      } else if (n < seasonLength * 2) {
        seasonalityNote = `Сезонность пропущена: нужно ≥2 полных цикла (${seasonLength * 2} точек), получено ${n}.`;
        seasonLength = null;
      }
    }
    const overallMean = series.reduce((a, b) => a + b, 0) / n;
    if (seasonLength && overallMean !== 0) {
      // Average ratio-to-overall-mean per seasonal position, then normalize to mean 1.
      const sums = new Array<number>(seasonLength).fill(0);
      const counts = new Array<number>(seasonLength).fill(0);
      for (let i = 0; i < n; i++) {
        const pos = i % seasonLength;
        sums[pos] += series[i] / overallMean;
        counts[pos] += 1;
      }
      const idx = sums.map((s, p) => (counts[p] > 0 ? s / counts[p] : 1));
      const idxMean = idx.reduce((a, b) => a + b, 0) / seasonLength;
      seasonalIndices = idx.map((x) => (idxMean !== 0 ? round(x / idxMean, 4) : 1));
    }

    // Deseasonalize for the trend model when seasonality is active.
    const work = seasonalIndices
      ? series.map((y, i) => y / (seasonalIndices as number[])[i % (seasonLength as number)])
      : series.slice();

    // Holt's linear method on the (deseasonalized) series; collect one-step errors.
    let level = work[0];
    let trend = work[1] - work[0];
    const errors: number[] = [];
    for (let t = 1; t < work.length; t++) {
      const fitted = level + trend; // one-step-ahead forecast for work[t]
      errors.push(work[t] - fitted);
      const prevLevel = level;
      level = alpha * work[t] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }
    // In-sample fit diagnostics (on deseasonalized scale).
    const sse = errors.reduce((a, e) => a + e * e, 0);
    const rmse = errors.length > 0 ? Math.sqrt(sse / errors.length) : 0;
    const apes: number[] = [];
    for (let t = 1; t < work.length; t++) {
      if (work[t] !== 0) apes.push(Math.abs(errors[t - 1]) / Math.abs(work[t]));
    }
    const mape = apes.length > 0 ? round((apes.reduce((a, b) => a + b, 0) / apes.length) * 100, 2) : null;
    const allNonNeg = series.every((y) => y >= 0);

    const forecast = [];
    for (let h = 1; h <= periods; h++) {
      let point = level + h * trend;
      const seasIdx = seasonalIndices ? (seasonalIndices as number[])[(n + h - 1) % (seasonLength as number)] : 1;
      point = point * seasIdx;
      const band = z * rmse * Math.sqrt(h) * seasIdx;
      let lower = point - band;
      let upper = point + band;
      if (allNonNeg) lower = Math.max(0, lower);
      forecast.push({
        period: n + h,
        horizon: h,
        pointForecast: round(point, 2),
        lower: round(lower, 2),
        upper: round(upper, 2),
        seasonalIndex: seasonalIndices ? round(seasIdx, 4) : null,
      });
    }

    const lastActual = series[n - 1];
    const finalPoint = forecast[forecast.length - 1].pointForecast;
    const trendPerPeriod = round(trend, 4);
    const direction = trend > 0 ? "рост" : trend < 0 ? "спад" : "плато";
    const totalChangePct = lastActual !== 0 ? round(((finalPoint - lastActual) / Math.abs(lastActual)) * 100, 1) : null;

    const summary =
      `Прогноз «${label}» на ${periods} пер. (Holt${seasonalIndices ? ` + сезонность ×${seasonLength}` : ""}): ` +
      `${ru(lastActual)} → ~${ru(finalPoint)}${totalChangePct !== null ? ` (${totalChangePct > 0 ? "+" : ""}${totalChangePct}%)` : ""}, ` +
      `тренд ${trendPerPeriod > 0 ? "+" : ""}${ru(trendPerPeriod)}/пер. (${direction}). ` +
      (mape !== null ? `MAPE ${mape}%. ` : "") +
      `Диапазон ${confidencePct}%.`;

    return toContent(summary, {
      tool: "demand_forecast",
      label,
      method: seasonalIndices ? "holt_linear_multiplicative_seasonal" : "holt_linear",
      params: { alpha, beta, confidencePct, seasonLength: seasonLength ?? null },
      observations: n,
      level: round(level, 2),
      trendPerPeriod,
      direction,
      rmse: round(rmse, 4),
      mapePct: mape,
      seasonalIndices,
      forecast,
      totalChangePct,
      seasonalityNote,
      note: "Метод Holt (двойное экспоненциальное сглаживание): level_t = α·y_t + (1−α)(level+trend); trend_t = β·Δlevel + (1−β)·trend; F_{t+h} = level + h·trend. Сезонность — мультипликативная классическая декомпозиция (индексы нормированы к среднему 1). Доверительный диапазон = z·RMSE·√h (RMSE по ошибкам прогноза на 1 шаг внутри выборки), расширяется с горизонтом. Это статистическая проекция тренда, а не гарантия; чем дальше горизонт, тем шире неопределённость.",
    });
  },
};

// ── 2. Customer journey map (lifecycle → channels/content/KPI + gaps) ────────

interface StageDef {
  stage: string;
  aliases: RegExp;
  defaultKpi: string;
  defaultChannels: string[];
  defaultContent: string[];
}
const DEFAULT_STAGES: StageDef[] = [
  {
    stage: "Awareness (узнаваемость)",
    aliases: /awareness|узнаваем|охват|знаком|reach|top/i,
    defaultKpi: "Охват / Reach, частота, Share-of-Search",
    defaultChannels: ["OLV", "Telegram Ads", "VK Ads", "наружная/DOOH", "PR"],
    defaultContent: ["имиджевое видео", "охватные посты", "PR-публикации"],
  },
  {
    stage: "Consideration (рассмотрение)",
    aliases: /consider|рассмотр|интерес|вовлеч|engage|mid/i,
    defaultKpi: "CTR, время на сайте, lead-magnet CR, вовлечённость",
    defaultChannels: ["Yandex Direct (РСЯ)", "SEO/контент", "ретаргетинг", "email"],
    defaultContent: ["обзоры/сравнения", "вебинар", "кейсы", "калькулятор"],
  },
  {
    stage: "Purchase (покупка)",
    aliases: /purchase|покупк|конверс|conversion|order|sale|sql|deal|сделк|bottom/i,
    defaultKpi: "CR в покупку, CPA/CAC, ROAS, AOV",
    defaultChannels: ["Yandex Direct (Поиск)", "ретаргетинг", "маркетплейсы", "отдел продаж"],
    defaultContent: ["промо-оффер", "отзывы/UGC", "демо/триал", "лендинг"],
  },
  {
    stage: "Retention (удержание)",
    aliases: /retention|удержан|повтор|repeat|loyal|лояльн|crm/i,
    defaultKpi: "Retention rate, repeat rate, LTV, churn",
    defaultChannels: ["email/CRM", "push", "программа лояльности", "комьюнити"],
    defaultContent: ["онбординг", "триггерные цепочки", "полезный контент", "апсейл-офферы"],
  },
  {
    stage: "Advocacy (адвокация)",
    aliases: /advocacy|адвокац|рефер|referral|nps|рекоменд|wom|сарафан/i,
    defaultKpi: "NPS, k-фактор / referral rate, доля UGC",
    defaultChannels: ["реферальная программа", "амбассадоры", "соцсети", "отзовики"],
    defaultContent: ["реферальный оффер", "истории клиентов", "UGC-кампании"],
  },
];
function matchStage(name: string): StageDef | null {
  for (const s of DEFAULT_STAGES) if (s.aliases.test(name)) return s;
  return null;
}

const customerJourneyMap: ToolDef = {
  name: "customer_journey_map",
  description:
    "Customer-journey / lifecycle map for a CMO, lifecycle or CRM marketer. Maps the funnel (awareness → consideration → purchase → retention → advocacy) to the channels, content and primary KPI for each stage, computes stage-to-stage CONVERSION when you pass volumes (`count`), and flags COVERAGE GAPS — any stage with no channels or no content planned — plus the biggest drop-off. Call with no args to get the best-practice template, or pass `stages` (each: stage name + optional channels[]/content[]/kpi/count) to map YOUR setup and audit it. Deterministic gap analysis on your inputs.",
  inputSchema: {
    type: "object",
    properties: {
      stages: {
        type: "array",
        description: "Optional: your lifecycle stages to audit. Omit to get the best-practice template.",
        items: {
          type: "object",
          properties: {
            stage: { type: "string", description: "Stage name, e.g. 'awareness', 'покупка', 'retention'" },
            channels: { type: "array", items: { type: "string" }, description: "Channels active at this stage" },
            content: { type: "array", items: { type: "string" }, description: "Content/assets at this stage" },
            kpi: { type: "string", description: "Optional primary KPI override for this stage" },
            count: { type: "number", minimum: 0, description: "Optional volume at this stage (for conversion math)" },
          },
          required: ["stage"],
          additionalProperties: false,
        },
      },
      business: { type: "string", description: "Optional context label, e.g. 'b2b saas', 'ecom'" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const raw = Array.isArray(input?.stages) ? input.stages : null;
    const business = typeof input?.business === "string" ? input.business.trim() : "";

    let rows: Array<{
      stage: string;
      recommendedKpi: string;
      channels: string[];
      content: string[];
      count: number | null;
    }> = [];

    if (raw === null) {
      // Template mode: return the best-practice map.
      rows = DEFAULT_STAGES.map((s) => ({
        stage: s.stage,
        recommendedKpi: s.defaultKpi,
        channels: s.defaultChannels,
        content: s.defaultContent,
        count: null,
      }));
    } else {
      const parsed: typeof rows = [];
      for (const r of raw) {
        if (!isRecord(r)) continue;
        const stage = typeof r.stage === "string" ? r.stage.trim() : "";
        if (!stage) continue;
        const def = matchStage(stage);
        const channels = Array.isArray(r.channels)
          ? r.channels.filter((c) => typeof c === "string" && c.trim()).map((c) => (c as string).trim())
          : [];
        const content = Array.isArray(r.content)
          ? r.content.filter((c) => typeof c === "string" && c.trim()).map((c) => (c as string).trim())
          : [];
        const kpi = typeof r.kpi === "string" && r.kpi.trim() ? r.kpi.trim() : def?.defaultKpi ?? "—";
        parsed.push({
          stage: def ? def.stage : stage,
          recommendedKpi: kpi,
          channels,
          content,
          count: num(r.count),
        });
      }
      if (parsed.length === 0) {
        return errResult("Не удалось разобрать stages. Каждая стадия должна иметь непустое поле stage.");
      }
      rows = parsed;
    }

    // Conversion + gap analysis.
    const stages = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1].count : null;
      const conversionFromPrev =
        prev !== null && prev !== 0 && r.count !== null ? round((r.count / prev) * 100, 1) : null;
      const dropOffPct = conversionFromPrev !== null ? round(100 - conversionFromPrev, 1) : null;
      const gaps: string[] = [];
      if (r.channels.length === 0) gaps.push("нет каналов");
      if (r.content.length === 0) gaps.push("нет контента");
      return {
        order: i + 1,
        stage: r.stage,
        recommendedKpi: r.recommendedKpi,
        channels: r.channels,
        content: r.content,
        count: r.count,
        conversionFromPrevPct: conversionFromPrev,
        dropOffPct,
        gaps,
        hasGap: gaps.length > 0,
      };
    });

    const gapStages = stages.filter((s) => s.hasGap).map((s) => s.stage);
    const dropOffs = stages.filter((s) => s.dropOffPct !== null);
    const biggestDropOff =
      dropOffs.length > 0
        ? dropOffs.reduce((a, b) => ((b.dropOffPct as number) > (a.dropOffPct as number) ? b : a))
        : null;

    const mode = raw === null ? "template" : "audit";
    const summary =
      (mode === "template"
        ? `Карта customer journey (шаблон best-practice${business ? `, ${business}` : ""}): ${stages.length} стадий с каналами, контентом и KPI. `
        : `Аудит customer journey${business ? ` (${business})` : ""}: ${stages.length} стадий. `) +
      (gapStages.length > 0 ? `Пробелы на: ${gapStages.join(", ")}. ` : "Покрытие по стадиям полное. ") +
      (biggestDropOff ? `Макс. отвал: «${biggestDropOff.stage}» (−${biggestDropOff.dropOffPct}%).` : "");

    return toContent(summary, {
      tool: "customer_journey_map",
      mode,
      business: business || null,
      stages,
      gapStages,
      biggestDropOff: biggestDropOff ? { stage: biggestDropOff.stage, dropOffPct: biggestDropOff.dropOffPct } : null,
      note: "Стадии нормализуются к канонической воронке (awareness→consideration→purchase→retention→advocacy) по ключевым словам; нераспознанные имена сохраняются как есть. Конверсия = count_тек / count_пред × 100% (нужны объёмы). Пробел = стадия без каналов или без контента. KPI — рекомендованные ориентиры, адаптируйте под свою модель атрибуции.",
    });
  },
};

// ── 3. Competitive positioning map (2-axis perceptual map + white-space) ─────

function quadrantLabel(xHigh: boolean, yHigh: boolean, xAxis: string, yAxis: string): string {
  return `${xHigh ? "высокая" : "низкая"} ${xAxis} / ${yHigh ? "высокая" : "низкая"} ${yAxis}`;
}

const competitivePositioningMap: ToolDef = {
  name: "competitive_positioning_map",
  description:
    "2-axis competitive POSITIONING / perceptual map for a brand strategist or CMO. Give ≥2 `competitors` each with an `x` and `y` score (e.g. x = price, y = value/quality; any 0–100 or absolute scales) and it places everyone on the plane, splits at the MEAN of each axis into four quadrants, assigns each player a quadrant, computes a value-for-money index (y/x), finds the empty quadrants (WHITE-SPACE opportunities), and — if one entry is flagged `isYou` — reports your quadrant and your nearest rival by normalized distance. Label the axes via `xAxis`/`yAxis`. Deterministic positioning math on your inputs.",
  inputSchema: {
    type: "object",
    properties: {
      competitors: {
        type: "array",
        minItems: 2,
        description: "Players to map (≥2). Each: name + x + y; optional isYou.",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Brand / competitor name" },
            x: { type: "number", description: "X-axis score (e.g. price)" },
            y: { type: "number", description: "Y-axis score (e.g. value/quality)" },
            isYou: { type: "boolean", description: "Mark YOUR brand (optional)" },
          },
          required: ["name", "x", "y"],
          additionalProperties: false,
        },
      },
      xAxis: { type: "string", description: "X-axis label (default 'Цена')" },
      yAxis: { type: "string", description: "Y-axis label (default 'Ценность')" },
    },
    required: ["competitors"],
    additionalProperties: false,
  },
  async handler(input) {
    const raw = Array.isArray(input?.competitors) ? input.competitors : [];
    const xAxis = typeof input?.xAxis === "string" && input.xAxis.trim() ? input.xAxis.trim() : "Цена";
    const yAxis = typeof input?.yAxis === "string" && input.yAxis.trim() ? input.yAxis.trim() : "Ценность";

    const players: Array<{ name: string; x: number; y: number; isYou: boolean }> = [];
    for (const c of raw) {
      if (!isRecord(c)) continue;
      const name = typeof c.name === "string" ? c.name.trim() : "";
      const x = num(c.x);
      const y = num(c.y);
      if (!name || x === null || y === null) continue;
      players.push({ name, x, y, isYou: c.isYou === true });
    }
    if (players.length < 2) {
      return errResult("Нужно ≥2 валидных игрока (каждый: name + числовые x и y).");
    }

    const xVals = players.map((p) => p.x);
    const yVals = players.map((p) => p.y);
    const xMid = round(xVals.reduce((a, b) => a + b, 0) / players.length, 2);
    const yMid = round(yVals.reduce((a, b) => a + b, 0) / players.length, 2);
    const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
    const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    const mapped = players.map((p) => {
      const xHigh = p.x >= xMid;
      const yHigh = p.y >= yMid;
      const quadrant = `${xHigh ? "X+" : "X-"}${yHigh ? "Y+" : "Y-"}`;
      return {
        name: p.name,
        x: p.x,
        y: p.y,
        isYou: p.isYou,
        xNorm: round((p.x - xMin) / xRange, 3),
        yNorm: round((p.y - yMin) / yRange, 3),
        xPosition: xHigh ? "high" : "low",
        yPosition: yHigh ? "high" : "low",
        quadrant,
        quadrantLabel: quadrantLabel(xHigh, yHigh, xAxis, yAxis),
        valueForMoneyIndex: p.x !== 0 ? round(p.y / p.x, 3) : null,
      };
    });

    // White-space = quadrants with no player.
    const allQuadrants: Array<{ code: string; xHigh: boolean; yHigh: boolean }> = [
      { code: "X+Y+", xHigh: true, yHigh: true },
      { code: "X+Y-", xHigh: true, yHigh: false },
      { code: "X-Y+", xHigh: false, yHigh: true },
      { code: "X-Y-", xHigh: false, yHigh: false },
    ];
    const occupied = new Set(mapped.map((m) => m.quadrant));
    const whiteSpace = allQuadrants
      .filter((q) => !occupied.has(q.code))
      .map((q) => ({ quadrant: q.code, label: quadrantLabel(q.xHigh, q.yHigh, xAxis, yAxis) }));

    // Your placement + nearest rival (normalized Euclidean distance).
    const you = mapped.find((m) => m.isYou) ?? null;
    let nearestRival: { name: string; distance: number } | null = null;
    if (you) {
      const rivals = mapped.filter((m) => !m.isYou);
      for (const r of rivals) {
        const d = round(Math.hypot(r.xNorm - you.xNorm, r.yNorm - you.yNorm), 3);
        if (nearestRival === null || d < nearestRival.distance) nearestRival = { name: r.name, distance: d };
      }
    }

    // Best value-for-money leader (highest y/x).
    const withVfm = mapped.filter((m) => m.valueForMoneyIndex !== null);
    const valueLeader =
      withVfm.length > 0
        ? withVfm.reduce((a, b) => ((b.valueForMoneyIndex as number) > (a.valueForMoneyIndex as number) ? b : a))
        : null;

    const summary =
      `Карта позиционирования (${xAxis} × ${yAxis}): ${players.length} игроков, разделители ${xAxis}=${xMid} / ${yAxis}=${yMid}. ` +
      (whiteSpace.length > 0 ? `Свободные квадранты (white-space): ${whiteSpace.length}. ` : "Все квадранты заняты. ") +
      (you ? `Вы — «${you.quadrantLabel}»${nearestRival ? `, ближайший конкурент: ${nearestRival.name}.` : "."}` : (valueLeader ? `Лидер по value-for-money: ${valueLeader.name}.` : ""));

    return toContent(summary, {
      tool: "competitive_positioning_map",
      axes: { x: xAxis, y: yAxis },
      dividers: { x: xMid, y: yMid },
      players: mapped,
      whiteSpace,
      you: you ? { name: you.name, quadrant: you.quadrant, quadrantLabel: you.quadrantLabel } : null,
      nearestRival,
      valueLeader: valueLeader ? { name: valueLeader.name, valueForMoneyIndex: valueLeader.valueForMoneyIndex } : null,
      note: "Перцептивная карта 2×2: ось X (по умолчанию Цена) × ось Y (Ценность). Разделители — среднее по каждой оси (deterministic). Квадрант X±Y± присваивается по положению относительно среднего. value-for-money = y/x (выше = лучше при X=цена). White-space — пустые квадранты как зоны потенциального позиционирования. Расстояние до конкурента — евклидово по нормированным осям [0..1]. Это качественная стратегическая рамка на ваших оценках, а не рыночное измерение.",
    });
  },
};

export const FORESIGHT_TOOLS: ToolDef[] = [demandForecast, customerJourneyMap, competitivePositioningMap];
