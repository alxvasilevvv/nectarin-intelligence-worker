/**
 * EXPANSION tool group (v2.54) for NECTARIN Intelligence — Workers.
 * Broadens the professional coverage with three deterministic, methodology-grounded models:
 *
 *   • marketing_maturity_assessment — CMO / marketing-transformation scorecard. Rates 7
 *     capability dimensions (0–5), computes a weighted 0–100 maturity index + level
 *     (Nascent→Leading), pinpoints strengths & gaps and emits a prioritized 90-day roadmap.
 *   • martech_stack_roi — marketing-ops / RevOps stack auditor. From your tools (cost,
 *     utilization, category) it finds wasted spend, category redundancy and low-utilization
 *     cut candidates, and projects consolidation savings + a utilization-weighted ROI.
 *   • pricing_psm — Van Westendorp Price Sensitivity Meter for product / pricing research.
 *     From respondents' four price points it builds the four cumulative curves and locates
 *     OPP, IPP, PMC, PME and the acceptable price range.
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

// ── 1. Marketing maturity assessment ─────────────────────────────────────────

interface Dimension {
  key: string;
  label: string;
  weight: number;
  action: string;
}
const MATURITY_DIMENSIONS: Dimension[] = [
  { key: "strategy", label: "Стратегия и позиционирование", weight: 0.18, action: "Зафиксировать измеримые цели (OKR), ICP и позиционирование; связать маркетинг-цели с выручкой." },
  { key: "data", label: "Данные и аналитика", weight: 0.18, action: "Свести данные в единый слой (CDP/DWH), наладить сбор событий и дашборды по воронке." },
  { key: "measurement", label: "Измеримость и атрибуция", weight: 0.16, action: "Внедрить инкрементальные тесты (geo/holdout) и многоканальную атрибуцию вместо last-click." },
  { key: "channels", label: "Каналы и охват", weight: 0.14, action: "Диверсифицировать микс по воронке и калибровать сплит через MMM/оптимизатор бюджета." },
  { key: "martech", label: "MarTech и автоматизация", weight: 0.12, action: "Закрыть разрывы стека, автоматизировать рутину (репортинг, триггеры) и убрать дубли инструментов." },
  { key: "team", label: "Команда и процессы", weight: 0.12, action: "Описать роли/RACI, ритуалы планирования и единый бэклог гипотез с приоритизацией." },
  { key: "creative", label: "Креатив и контент", weight: 0.10, action: "Поставить на поток тестирование креативов и контроль усталости (ротация по частоте)." },
];

const MATURITY_LEVELS = [
  { min: 0, level: 1, name: "Nascent (зарождающийся)" },
  { min: 30, level: 2, name: "Emerging (формирующийся)" },
  { min: 50, level: 3, name: "Developing (развивающийся)" },
  { min: 70, level: 4, name: "Mature (зрелый)" },
  { min: 85, level: 5, name: "Leading (лидер)" },
];
function levelFor(score: number): { level: number; name: string } {
  let chosen = MATURITY_LEVELS[0];
  for (const l of MATURITY_LEVELS) if (score >= l.min) chosen = l;
  return { level: chosen.level, name: chosen.name };
}

const marketingMaturityAssessment: ToolDef = {
  name: "marketing_maturity_assessment",
  description:
    "Marketing maturity scorecard for a CMO / head of marketing / transformation lead. Rate 7 capability dimensions 0–5 (strategy, data, measurement, channels, martech, team, creative) and it computes a weighted 0–100 maturity index, the maturity LEVEL (1 Nascent → 5 Leading), per-dimension strengths vs. gaps (with the weighted shortfall to 'leading'), and a prioritized 90-day roadmap targeting the highest-leverage gaps first. Provide any subset of dimensions; unrated ones are reported as not assessed. Deterministic weighting on your self-assessment — a planning compass, not an audit of a live account (use marketing_audit / account_audit for that).",
  inputSchema: {
    type: "object",
    properties: {
      scores: {
        type: "object",
        description:
          "Self-assessment 0–5 per dimension. Keys: strategy, data, measurement, channels, martech, team, creative. Provide any subset.",
        properties: {
          strategy: { type: "number", minimum: 0, maximum: 5 },
          data: { type: "number", minimum: 0, maximum: 5 },
          measurement: { type: "number", minimum: 0, maximum: 5 },
          channels: { type: "number", minimum: 0, maximum: 5 },
          martech: { type: "number", minimum: 0, maximum: 5 },
          team: { type: "number", minimum: 0, maximum: 5 },
          creative: { type: "number", minimum: 0, maximum: 5 },
        },
        additionalProperties: false,
      },
      company: { type: "string", description: "Optional company / brand name for the header" },
    },
    required: ["scores"],
    additionalProperties: false,
  },
  async handler(input) {
    const scores = isRecord(input?.scores) ? input.scores : {};
    const assessed: Array<{ key: string; label: string; weight: number; score: number; action: string }> = [];
    const notAssessed: string[] = [];
    for (const d of MATURITY_DIMENSIONS) {
      const raw = num((scores as Record<string, unknown>)[d.key]);
      if (raw === null) {
        notAssessed.push(d.key);
        continue;
      }
      const s = Math.max(0, Math.min(5, raw));
      assessed.push({ key: d.key, label: d.label, weight: d.weight, score: s, action: d.action });
    }
    if (assessed.length === 0) {
      return errResult("Не передано ни одной оценки. Укажите scores с ключами вроде strategy, data, measurement (0–5).");
    }
    const weightSum = assessed.reduce((a, d) => a + d.weight, 0);
    const overall = round(assessed.reduce((a, d) => a + d.weight * (d.score / 5) * 100, 0) / weightSum, 1);
    const lvl = levelFor(overall);

    const perDimension = assessed
      .map((d) => {
        const shortfall = round(d.weight * (5 - d.score), 4);
        const status = d.score >= 4 ? "сильная сторона" : d.score <= 2 ? "критический разрыв" : "в развитии";
        return { ...d, weightedShortfall: shortfall, status };
      })
      .sort((a, b) => b.weightedShortfall - a.weightedShortfall);

    const strengths = perDimension.filter((d) => d.score >= 4).map((d) => d.label);
    const gaps = perDimension.filter((d) => d.score < 4);
    const roadmap = gaps.slice(0, 3).map((d, i) => ({
      priority: i + 1,
      dimension: d.label,
      currentScore: d.score,
      action: d.action,
    }));

    const header = input?.company ? `«${input.company}» — ` : "";
    const summary =
      `${header}Индекс зрелости маркетинга ${overall}/100 — уровень ${lvl.level}/5 (${lvl.name}). ` +
      `Сильных сторон: ${strengths.length}; разрывов: ${gaps.length}. ` +
      `Приоритет №1: ${roadmap[0]?.dimension ?? "—"}.`;

    return toContent(summary, {
      tool: "marketing_maturity_assessment",
      company: input?.company ?? null,
      overallScore: overall,
      level: lvl.level,
      levelName: lvl.name,
      dimensionsAssessed: assessed.length,
      notAssessed,
      perDimension,
      strengths,
      roadmap,
      note: "Веса дименшнов фиксированы (сумма=1). Оценка по самодиагностике 0–5 — ориентир для плана развития.",
    });
  },
};

// ── 2. MarTech stack ROI ─────────────────────────────────────────────────────

interface MartechTool {
  name: string;
  annualCost: number;
  utilizationPct: number;
  category: string;
  satisfaction?: number;
}

const martechStackRoi: ToolDef = {
  name: "martech_stack_roi",
  description:
    "MarTech stack ROI & rationalization for a marketing-ops / RevOps lead. From your tools (name, annualCost ₽, utilizationPct 0–100, category, optional satisfaction 1–5) it computes total annual spend, wasted spend (cost × idle share), category redundancy (multiple tools in one category ⇒ keep the best-utilized, flag the rest), low-utilization cut candidates (<30%), projected consolidation savings, and a utilization-weighted ROI of the stack. Returns a ranked rationalization plan. Deterministic accounting on your inputs.",
  inputSchema: {
    type: "object",
    properties: {
      tools: {
        type: "array",
        minItems: 1,
        description: "Your martech tools",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Tool name" },
            annualCost: { type: "number", minimum: 0, description: "Annual cost in RUB" },
            utilizationPct: { type: "number", minimum: 0, maximum: 100, description: "How much of its capability you actually use, 0–100" },
            category: { type: "string", description: "Functional category, e.g. 'analytics', 'email', 'CDP', 'CRM'" },
            satisfaction: { type: "number", minimum: 1, maximum: 5, description: "Optional team satisfaction 1–5" },
          },
          required: ["name", "annualCost", "utilizationPct", "category"],
          additionalProperties: false,
        },
      },
      lowUtilizationThresholdPct: { type: "number", minimum: 0, maximum: 100, description: "Cut-candidate threshold (default 30)" },
    },
    required: ["tools"],
    additionalProperties: false,
  },
  async handler(input) {
    const rawTools = Array.isArray(input?.tools) ? input.tools : [];
    const tools: MartechTool[] = [];
    for (const t of rawTools) {
      if (!isRecord(t)) continue;
      const cost = num(t.annualCost);
      const util = num(t.utilizationPct);
      const name = typeof t.name === "string" ? t.name : "";
      const category = (typeof t.category === "string" ? t.category : "").trim().toLowerCase();
      if (!name || cost === null || util === null || !category) continue;
      tools.push({
        name,
        annualCost: Math.max(0, cost),
        utilizationPct: Math.max(0, Math.min(100, util)),
        category,
        satisfaction: num(t.satisfaction) ?? undefined,
      });
    }
    if (tools.length === 0) {
      return errResult("Не удалось разобрать ни одного инструмента. Нужны поля name, annualCost, utilizationPct, category.");
    }
    const threshold = num(input?.lowUtilizationThresholdPct) ?? 30;

    const totalSpend = tools.reduce((a, t) => a + t.annualCost, 0);
    const totalWaste = tools.reduce((a, t) => a + t.annualCost * (1 - t.utilizationPct / 100), 0);
    const effectiveValue = totalSpend - totalWaste; // utilization-weighted "used" spend

    // Category redundancy: keep the best-scored tool per category (utilization × satisfaction), flag the rest.
    const byCategory = new Map<string, MartechTool[]>();
    for (const t of tools) {
      const arr = byCategory.get(t.category) ?? [];
      arr.push(t);
      byCategory.set(t.category, arr);
    }
    const redundant: Array<{ name: string; category: string; annualCost: number; keptInstead: string }> = [];
    const redundantNames = new Set<string>();
    for (const [cat, arr] of byCategory) {
      if (arr.length < 2) continue;
      const ranked = [...arr].sort(
        (a, b) => b.utilizationPct * (b.satisfaction ?? 3) - a.utilizationPct * (a.satisfaction ?? 3)
      );
      const keep = ranked[0];
      for (const t of ranked.slice(1)) {
        redundant.push({ name: t.name, category: cat, annualCost: round(t.annualCost), keptInstead: keep.name });
        redundantNames.add(t.name);
      }
    }
    const redundantSavings = redundant.reduce((a, r) => a + r.annualCost, 0);

    // Low-utilization cut candidates (not already flagged as redundant).
    const lowUtil = tools
      .filter((t) => t.utilizationPct < threshold && !redundantNames.has(t.name))
      .map((t) => ({ name: t.name, category: t.category, utilizationPct: t.utilizationPct, annualCost: round(t.annualCost) }));
    const lowUtilSavings = lowUtil.reduce((a, t) => a + t.annualCost, 0);

    const projectedSavings = redundantSavings + lowUtilSavings;
    const stackRoi = totalSpend > 0 ? round(effectiveValue / totalSpend, 3) : 0; // share of spend actually utilized

    const ranking = [...tools]
      .map((t) => ({
        name: t.name,
        category: t.category,
        annualCost: round(t.annualCost),
        utilizationPct: t.utilizationPct,
        wasted: round(t.annualCost * (1 - t.utilizationPct / 100)),
        verdict: redundantNames.has(t.name)
          ? "дубль — консолидировать"
          : t.utilizationPct < threshold
            ? "низкое использование — пересмотреть"
            : t.utilizationPct >= 70
              ? "оставить"
              : "докрутить адопшн",
      }))
      .sort((a, b) => b.wasted - a.wasted);

    const summary =
      `MarTech-стек: ${tools.length} инструментов, бюджет ${Math.round(totalSpend).toLocaleString("ru-RU")} ₽/год. ` +
      `Потери на простое ~${Math.round(totalWaste).toLocaleString("ru-RU")} ₽; ` +
      `потенциал экономии (дубли+низкий аптейк) ~${Math.round(projectedSavings).toLocaleString("ru-RU")} ₽. ` +
      `Утилизация бюджета (ROI-прокси) ${Math.round(stackRoi * 100)}%.`;

    return toContent(summary, {
      tool: "martech_stack_roi",
      totals: {
        toolCount: tools.length,
        totalAnnualSpend: round(totalSpend),
        wastedSpend: round(totalWaste),
        effectiveValue: round(effectiveValue),
        utilizationRoi: stackRoi,
        projectedSavings: round(projectedSavings),
        savingsSharePct: totalSpend > 0 ? round((projectedSavings / totalSpend) * 100, 1) : 0,
      },
      redundancy: redundant,
      lowUtilizationCandidates: lowUtil,
      ranking,
      thresholdPct: threshold,
      note: "ROI-прокси = доля бюджета, реально используемая (utilization-weighted). Экономия консервативна: дубли + инструменты ниже порога.",
    });
  },
};

// ── 3. Van Westendorp Price Sensitivity Meter ────────────────────────────────

interface PsmRespondent {
  tooCheap: number;
  cheap: number;
  expensive: number;
  tooExpensive: number;
}

function intersection(
  grid: number[],
  fA: (p: number) => number,
  fB: (p: number) => number
): number | null {
  for (let i = 0; i < grid.length - 1; i++) {
    const p0 = grid[i];
    const p1 = grid[i + 1];
    const d0 = fA(p0) - fB(p0);
    const d1 = fA(p1) - fB(p1);
    if (d0 === 0) return p0;
    if (d0 * d1 < 0) {
      const frac = -d0 / (d1 - d0);
      return p0 + (p1 - p0) * frac;
    }
  }
  return null;
}

const pricingPsm: ToolDef = {
  name: "pricing_psm",
  description:
    "Van Westendorp Price Sensitivity Meter (PSM) for product / pricing research. From survey respondents — each giving four prices: tooCheap (so cheap quality is doubted), cheap (a bargain), expensive (starting to be pricey but worth considering), tooExpensive (would not buy) — it builds the four cumulative curves and locates the OPP (Optimal Price Point), IPP (Indifference Price Point), and the acceptable price band PMC→PME (points of marginal cheapness/expensiveness). Respondents with non-monotonic prices are dropped and reported. Deterministic intersection of empirical curves on your data.",
  inputSchema: {
    type: "object",
    properties: {
      respondents: {
        type: "array",
        minItems: 3,
        description: "Survey responses; each respondent gives four ascending prices.",
        items: {
          type: "object",
          properties: {
            tooCheap: { type: "number", minimum: 0 },
            cheap: { type: "number", minimum: 0 },
            expensive: { type: "number", minimum: 0 },
            tooExpensive: { type: "number", minimum: 0 },
          },
          required: ["tooCheap", "cheap", "expensive", "tooExpensive"],
          additionalProperties: false,
        },
      },
      currency: { type: "string", description: "Currency label for display (default '₽')" },
    },
    required: ["respondents"],
    additionalProperties: false,
  },
  async handler(input) {
    const raw = Array.isArray(input?.respondents) ? input.respondents : [];
    const valid: PsmRespondent[] = [];
    let dropped = 0;
    for (const r of raw) {
      if (!isRecord(r)) {
        dropped++;
        continue;
      }
      const tc = num(r.tooCheap);
      const ch = num(r.cheap);
      const ex = num(r.expensive);
      const te = num(r.tooExpensive);
      if (tc === null || ch === null || ex === null || te === null) {
        dropped++;
        continue;
      }
      if (!(tc <= ch && ch <= ex && ex <= te)) {
        dropped++; // non-monotonic ⇒ invalid per Van Westendorp
        continue;
      }
      valid.push({ tooCheap: tc, cheap: ch, expensive: ex, tooExpensive: te });
    }
    if (valid.length < 3) {
      return errResult(
        `Недостаточно валидных ответов (${valid.length}). Нужно ≥3 с монотонными ценами tooCheap ≤ cheap ≤ expensive ≤ tooExpensive.`,
        { dropped }
      );
    }
    const n = valid.length;

    // Cumulative curves (share 0..1):
    //   tooCheap(p)  = share whose tooCheap  ≥ p   (decreasing)
    //   cheap(p)     = share whose cheap     ≥ p   ("not expensive", decreasing)
    //   expensive(p) = share whose expensive ≤ p   ("not cheap", increasing)
    //   tooExp(p)    = share whose tooExpensive ≤ p (increasing)
    const fTooCheap = (p: number) => valid.filter((r) => r.tooCheap >= p).length / n;
    const fCheap = (p: number) => valid.filter((r) => r.cheap >= p).length / n;
    const fExpensive = (p: number) => valid.filter((r) => r.expensive <= p).length / n;
    const fTooExp = (p: number) => valid.filter((r) => r.tooExpensive <= p).length / n;

    const prices = new Set<number>();
    for (const r of valid) {
      prices.add(r.tooCheap);
      prices.add(r.cheap);
      prices.add(r.expensive);
      prices.add(r.tooExpensive);
    }
    const grid = [...prices].sort((a, b) => a - b);

    const opp = intersection(grid, fTooCheap, fTooExp); // optimal price point
    const ipp = intersection(grid, fCheap, fExpensive); // indifference price point
    const pmc = intersection(grid, fTooCheap, fExpensive); // point of marginal cheapness
    const pme = intersection(grid, fCheap, fTooExp); // point of marginal expensiveness

    const cur = (typeof input?.currency === "string" && input.currency) || "₽";
    const r2 = (x: number | null) => (x === null ? null : round(x, 2));
    const acceptableRange = pmc !== null && pme !== null ? [round(pmc, 2), round(pme, 2)] : null;

    const curve = grid.map((p) => ({
      price: round(p, 2),
      tooCheap: round(fTooCheap(p), 3),
      cheap: round(fCheap(p), 3),
      expensive: round(fExpensive(p), 3),
      tooExpensive: round(fTooExp(p), 3),
    }));

    const summary =
      `PSM (Van Westendorp) по ${n} ответам${dropped ? ` (отброшено ${dropped})` : ""}: ` +
      `OPP ${r2(opp) ?? "—"} ${cur}, IPP ${r2(ipp) ?? "—"} ${cur}, ` +
      `приемлемый диапазон ${acceptableRange ? `${acceptableRange[0]}–${acceptableRange[1]} ${cur}` : "—"}.`;

    return toContent(summary, {
      tool: "pricing_psm",
      respondentsValid: n,
      respondentsDropped: dropped,
      currency: cur,
      optimalPricePoint: r2(opp),
      indifferencePricePoint: r2(ipp),
      pointOfMarginalCheapness: r2(pmc),
      pointOfMarginalExpensiveness: r2(pme),
      acceptablePriceRange: acceptableRange,
      curve,
      note: "OPP — точка минимального сопротивления (too cheap = too expensive). IPP — «нормальная» цена (cheap = expensive). Приемлемый диапазон PMC→PME. Ответы с немонотонными ценами отброшены.",
    });
  },
};

export const EXPANSION_TOOLS: ToolDef[] = [marketingMaturityAssessment, martechStackRoi, pricingPsm];
