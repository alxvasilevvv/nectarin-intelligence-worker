/**
 * MARKETING OPS & LEADERSHIP tool group (v2.57) for NECTARIN Intelligence — Workers.
 * Fills two under-served leadership/planning roles in the catalogue.
 *
 *   • marketing_okr_planner — turns a qualitative OBJECTIVE into a measurable OKR set: each
 *     key result gets baseline → target, absolute delta, % change, an ambition band, a
 *     leading-vs-lagging classification and the NECTARIN tool to drive it. Flags an
 *     unbalanced set (all-lagging / all-leading). Deterministic OKR math.
 *   • content_calendar_planner — content-team CAPACITY / throughput planner: from team size,
 *     productive hours and a content mix (effort per piece + desired share) it computes total
 *     capacity, achievable pieces per type, weekly throughput, utilization vs. a requested
 *     plan and the bottleneck. Deterministic capacity math.
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

// ── 1. Marketing OKR planner ─────────────────────────────────────────────────

// Lagging (outcome) metrics vs leading (activity) metrics — classification heuristic.
const LAGGING_RE = /revenue|выручк|доход|profit|маржа|прибыл|mrr|arr|ltv|cac|cpa|roas|romi|roi|nps|csat|retention|удержан|churn|отток|aov|чек|share|доля/i;
// Metric → the NECTARIN tool best suited to move it.
const KR_TOOL_MAP: Array<{ kw: RegExp; tool: string }> = [
  { kw: /cac|cpa|cpl|cost|стоимост|расход|drr|др[р]/i, tool: "budget_optimizer" },
  { kw: /churn|отток|retention|удержан/i, tool: "churn_predictor" },
  { kw: /ltv|aov|чек|revenue|выручк|доход|маржа|unit/i, tool: "unit_economics" },
  { kw: /nps|csat|loyal|лояльн|satisf/i, tool: "nps_analysis" },
  { kw: /seo|органик|трафик|traffic|поиск|search|позици/i, tool: "seo_opportunity" },
  { kw: /lead|лид|pipeline|пайплайн|opportunit|сделк|mql|sql/i, tool: "b2b_pipeline_velocity" },
  { kw: /ctr|кликаб|creative|креатив/i, tool: "creative_testing_matrix" },
  { kw: /conversion|конверс|cvr|cr|воронк|funnel/i, tool: "funnel_model" },
  { kw: /roas|romi|\broi\b|budget|бюджет/i, tool: "budget_optimizer" },
];
function toolForMetric(metric: string): string {
  for (const m of KR_TOOL_MAP) if (m.kw.test(metric)) return m.tool;
  return "strategy_orchestrate";
}
function ambitionBand(absPct: number | null): string {
  if (absPct === null) return "не оценить (нулевая база)";
  if (absPct < 10) return "консервативная";
  if (absPct < 25) return "реалистичная";
  if (absPct < 50) return "амбициозная";
  return "очень амбициозная (растяжка)";
}

const marketingOkrPlanner: ToolDef = {
  name: "marketing_okr_planner",
  description:
    "Marketing OKR planner for a CMO / head of marketing / team lead. Give a qualitative `objective` and 1–7 `keyResults` (each: metric, baseline, target, optional unit/direction). It returns a measurable OKR: per key result the baseline → target, absolute delta, % change, an AMBITION band (conservative / realistic / ambitious / stretch by magnitude), a LEADING-vs-LAGGING classification (outcome metrics like revenue/CAC/NPS = lagging; activity metrics like traffic/leads/CTR = leading) and the NECTARIN tool to drive it. Warns when the set is unbalanced (all-lagging or all-leading). Deterministic OKR math on your numbers.",
  inputSchema: {
    type: "object",
    properties: {
      objective: { type: "string", description: "The qualitative objective, e.g. 'Стать №1 по органике в категории'" },
      timeframe: { type: "string", description: "Time horizon, e.g. 'Q3 2026', 'квартал' (default 'квартал')" },
      keyResults: {
        type: "array",
        minItems: 1,
        description: "Measurable key results (1–7)",
        items: {
          type: "object",
          properties: {
            metric: { type: "string", description: "Metric name, e.g. 'Органический трафик', 'CAC', 'NPS'" },
            baseline: { type: "number", description: "Current value" },
            target: { type: "number", description: "Target value by the end of the timeframe" },
            unit: { type: "string", description: "Optional unit, e.g. '₽', '%', 'визитов/мес'" },
            direction: { type: "string", enum: ["increase", "decrease"], description: "Optional; inferred from baseline vs target" },
          },
          required: ["metric", "baseline", "target"],
          additionalProperties: false,
        },
      },
    },
    required: ["objective", "keyResults"],
    additionalProperties: false,
  },
  async handler(input) {
    const objective = typeof input?.objective === "string" ? input.objective.trim() : "";
    if (!objective) return errResult("Нужен objective (текст цели).");
    const timeframe = typeof input?.timeframe === "string" && input.timeframe.trim() ? input.timeframe.trim() : "квартал";
    const raw = Array.isArray(input?.keyResults) ? input.keyResults : [];

    const krs: Array<Record<string, unknown>> = [];
    let leadingCount = 0;
    let laggingCount = 0;
    for (const k of raw) {
      if (!isRecord(k)) continue;
      const metric = typeof k.metric === "string" ? k.metric.trim() : "";
      const baseline = num(k.baseline);
      const target = num(k.target);
      if (!metric || baseline === null || target === null) continue;
      const direction = k.direction === "increase" || k.direction === "decrease"
        ? k.direction
        : target >= baseline ? "increase" : "decrease";
      const delta = round(target - baseline, 2);
      const pctChange = baseline !== 0 ? round((delta / Math.abs(baseline)) * 100, 1) : null;
      const type = LAGGING_RE.test(metric) ? "lagging" : "leading";
      if (type === "lagging") laggingCount++;
      else leadingCount++;
      krs.push({
        kr: krs.length + 1,
        metric,
        unit: typeof k.unit === "string" ? k.unit : null,
        baseline,
        target,
        direction,
        delta,
        pctChange,
        ambition: ambitionBand(pctChange === null ? null : Math.abs(pctChange)),
        type,
        recommendedTool: toolForMetric(metric),
      });
    }
    if (krs.length === 0) {
      return errResult("Не удалось разобрать keyResults. Нужны metric, baseline, target (числа).");
    }
    krs.forEach((k, i) => (k.kr = i + 1));

    let balanceNote: string;
    if (leadingCount === 0) balanceNote = "Все KR — отстающие (lagging): добавьте опережающий показатель (активность/трафик/лиды), чтобы управлять процессом, а не только смотреть в зеркало заднего вида.";
    else if (laggingCount === 0) balanceNote = "Все KR — опережающие (leading): добавьте отстающий бизнес-результат (выручка/CAC/NPS), чтобы зафиксировать итоговый эффект.";
    else balanceNote = "Набор сбалансирован: есть и опережающие, и отстающие показатели.";

    const mostAmbitious = [...krs].sort((a, b) =>
      (Math.abs(Number(b.pctChange ?? 0))) - (Math.abs(Number(a.pctChange ?? 0))))[0];

    const summary =
      `OKR «${objective}» (${timeframe}): ${krs.length} key results — ${laggingCount} lagging / ${leadingCount} leading. ` +
      `Самый амбициозный KR: «${mostAmbitious.metric}» (${mostAmbitious.pctChange === null ? "n/a" : `${mostAmbitious.pctChange}%`}, ${mostAmbitious.ambition}).`;

    return toContent(summary, {
      tool: "marketing_okr_planner",
      objective,
      timeframe,
      keyResults: krs,
      leadingCount,
      laggingCount,
      balanceNote,
      note: "OKR-математика: delta = target − baseline; %Δ = delta / |baseline|. Амбиция по |%Δ|: <10 консервативная, <25 реалистичная, <50 амбициозная, иначе растяжка. Классификация leading/lagging — эвристика по имени метрики; сверяйте со своей моделью.",
    });
  },
};

// ── 2. Content calendar capacity planner ─────────────────────────────────────

const contentCalendarPlanner: ToolDef = {
  name: "content_calendar_planner",
  description:
    "Content-team CAPACITY / throughput planner for a content lead / SMM manager / editor. From `people`, productive `hoursPerWeek` per person, a planning horizon in `weeks`, and a content mix (`contentTypes`: each type with effort-hours per piece, an optional desired share weightPct and an optional `planned` target count) it computes total capacity hours, the achievable pieces per type, weekly throughput, utilization vs. the requested plan and the bottleneck (the type whose demand most exceeds capacity). Deterministic capacity math — plan realistic editorial calendars, not wishful ones.",
  inputSchema: {
    type: "object",
    properties: {
      people: { type: "number", exclusiveMinimum: 0, description: "Number of content team members" },
      hoursPerWeek: { type: "number", minimum: 0, description: "Productive content hours per person per week (default 20)" },
      weeks: { type: "number", minimum: 1, description: "Planning horizon in weeks (default 4)" },
      contentTypes: {
        type: "array",
        minItems: 1,
        description: "Content mix to plan",
        items: {
          type: "object",
          properties: {
            type: { type: "string", description: "Content type, e.g. 'статья', 'reels', 'email', 'лендинг'" },
            effortHours: { type: "number", exclusiveMinimum: 0, description: "Hours to produce ONE piece" },
            weightPct: { type: "number", minimum: 0, description: "Optional desired share of capacity, %" },
            planned: { type: "number", minimum: 0, description: "Optional desired number of pieces in the horizon (gap analysis)" },
          },
          required: ["type", "effortHours"],
          additionalProperties: false,
        },
      },
    },
    required: ["people", "contentTypes"],
    additionalProperties: false,
  },
  async handler(input) {
    const people = num(input?.people);
    if (people === null || people <= 0) return errResult("Нужно положительное people (размер команды).");
    const hoursPerWeek = num(input?.hoursPerWeek) ?? 20;
    const weeks = Math.max(1, Math.round(num(input?.weeks) ?? 4));
    if (hoursPerWeek <= 0) return errResult("hoursPerWeek должно быть больше 0.");
    const raw = Array.isArray(input?.contentTypes) ? input.contentTypes : [];

    const types: Array<{ type: string; effortHours: number; weightPct: number | null; planned: number | null }> = [];
    for (const t of raw) {
      if (!isRecord(t)) continue;
      const type = typeof t.type === "string" ? t.type.trim() : "";
      const effortHours = num(t.effortHours);
      if (!type || effortHours === null || effortHours <= 0) continue;
      types.push({ type, effortHours, weightPct: num(t.weightPct), planned: num(t.planned) });
    }
    if (types.length === 0) {
      return errResult("Не удалось разобрать contentTypes. Нужны type и положительный effortHours.");
    }

    const totalCapacityHours = round(people * hoursPerWeek * weeks, 1);

    // Resolve capacity weights: use provided weightPct (normalized); else split equally.
    const providedSum = types.reduce((a, t) => a + (t.weightPct ?? 0), 0);
    const useProvided = providedSum > 0;
    const weightDenom = useProvided ? providedSum : types.length;

    const allocation = types.map((t) => {
      const weightShare = useProvided ? (t.weightPct ?? 0) / weightDenom : 1 / weightDenom;
      const allocatedHours = round(totalCapacityHours * weightShare, 1);
      const pieces = Math.floor(allocatedHours / t.effortHours);
      const throughputPerWeek = round(pieces / weeks, 2);
      const plannedPieces = t.planned !== null ? Math.round(t.planned) : null;
      const requiredHours = plannedPieces !== null ? round(plannedPieces * t.effortHours, 1) : null;
      const gapPieces = plannedPieces !== null ? pieces - plannedPieces : null;
      const feasible = plannedPieces !== null ? pieces >= plannedPieces : null;
      return {
        type: t.type,
        effortHours: t.effortHours,
        capacitySharePct: round(weightShare * 100, 1),
        allocatedHours,
        achievablePieces: pieces,
        throughputPerWeek,
        plannedPieces,
        requiredHours,
        gapPieces,
        feasible,
      };
    });

    // Bottleneck = the planned type whose demand most exceeds its achievable output.
    const shortfalls = allocation.filter((a) => a.gapPieces !== null && (a.gapPieces as number) < 0);
    const bottleneck = shortfalls.sort((a, b) => (a.gapPieces as number) - (b.gapPieces as number))[0] ?? null;

    const totalPieces = allocation.reduce((a, x) => a + x.achievablePieces, 0);
    const totalRequiredHours = allocation.reduce((a, x) => a + (x.requiredHours ?? 0), 0);
    const utilizationPct = totalRequiredHours > 0 ? round((totalRequiredHours / totalCapacityHours) * 100, 1) : null;

    const summary =
      `Капасити контент-команды: ${ru(totalCapacityHours)} ч за ${weeks} нед (${people} чел × ${hoursPerWeek} ч/нед) ⇒ ~${totalPieces} единиц контента. ` +
      (utilizationPct !== null ? `Загрузка под план: ${utilizationPct}%. ` : "") +
      (bottleneck ? `Бутылочное горлышко: «${bottleneck.type}» (не хватает ${Math.abs(bottleneck.gapPieces as number)} ед.).` : "Дефицита по заявленному плану нет.");

    return toContent(summary, {
      tool: "content_calendar_planner",
      inputs: { people, hoursPerWeek, weeks },
      totalCapacityHours,
      totalAchievablePieces: totalPieces,
      utilizationPct,
      bottleneck: bottleneck ? bottleneck.type : null,
      allocation,
      note: "Капасити = people × hoursPerWeek × weeks. Часы делятся по weightPct (нормируются) или поровну. Единицы = floor(часы_типа / effortHours). gapPieces = достижимо − план; отрицательное ⇒ дефицит. Это плановая ёмкость, заложите буфер на правки и согласования.",
    });
  },
};

export const LEADERSHIP_TOOLS: ToolDef[] = [marketingOkrPlanner, contentCalendarPlanner];
