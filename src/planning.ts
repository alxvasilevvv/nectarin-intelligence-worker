/**
 * PLANNING tool group (v2.14) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • gtm_calendar — a phased go-to-market roadmap (Test → Scale → Optimize) with
 *     a week-by-week budget pacing curve that leans into seasonal demand, channel
 *     emphasis per phase, KPIs, milestones and exit criteria. Fully deterministic:
 *     budget weights come from the goal, weekly spend is shaped by the RU/CIS
 *     monthly seasonality index (src/data.ts), no LLM and no PII.
 *
 * Outputs are decision-support, not legal/financial advice. Figures are
 * illustrative and anchored to the same mock RU/CIS benchmarks as the rest of
 * the suite.
 */

import { CATEGORIES, MONTHS_RU, getSeasonalityIndex } from "./data.js";
import type { ToolDef, ToolResult } from "./tools.js";

// ── local helpers (self-contained, mirrors premium.ts) ───────────────────────

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

type Goal = "awareness" | "consideration" | "performance" | "retention";

// Phase budget weights by goal: [test, scale, optimize] (sum = 1).
const PHASE_BUDGET: Record<Goal, [number, number, number]> = {
  awareness: [0.1, 0.7, 0.2],
  consideration: [0.15, 0.6, 0.25],
  performance: [0.12, 0.63, 0.25],
  retention: [0.15, 0.55, 0.3],
};

// Channel emphasis by goal, most-leaned-into first (RU/CIS inventory).
const GOAL_CHANNELS: Record<Goal, string[]> = {
  awareness: ["OLV", "VK Ads", "Telegram Ads", "Yandex Direct"],
  consideration: ["VK Ads", "Yandex Direct", "Telegram Ads", "OLV"],
  performance: ["Yandex Direct", "VK Ads", "Avito", "Telegram Ads"],
  retention: ["Telegram Ads", "VK Ads", "Yandex Direct"],
};

// KPI focus per goal.
const GOAL_KPIS: Record<Goal, string[]> = {
  awareness: ["Охват", "CPM", "VTR", "Brand lift"],
  consideration: ["CTR", "CPC", "Глубина визита", "Вовлечённость"],
  performance: ["CPA", "CR", "ROAS", "Кол-во лидов/заказов"],
  retention: ["Retention rate", "Повторные покупки", "LTV", "Отток"],
};

// Descending share weights for N channels in a phase (sum = 1).
function shareWeights(n: number): number[] {
  const presets: Record<number, number[]> = {
    1: [1],
    2: [0.6, 0.4],
    3: [0.45, 0.35, 0.2],
    4: [0.4, 0.3, 0.2, 0.1],
  };
  return presets[clamp(n, 1, 4)] ?? presets[4];
}

interface Phase {
  phase: "Test" | "Scale" | "Optimize";
  ruName: string;
  weeks: { from: number; to: number; count: number };
  budget: number;
  budgetPct: number;
  channels: Array<{ channel: string; budget: number; sharePct: number }>;
  objectives: string[];
  kpis: string[];
  exitCriteria: string;
}

const APPROX_WEEKS_PER_MONTH = 4.345;

const gtmCalendar: ToolDef = {
  name: "gtm_calendar",
  description:
    "Build a phased go-to-market roadmap for RU/CIS: splits the horizon into Test → Scale → Optimize phases, assigns goal-driven budget weights and channel emphasis per phase, then produces a WEEK-BY-WEEK budget pacing curve that leans spend into high-demand weeks using the category's monthly seasonality index. Returns per-phase objectives, KPIs and exit criteria, seasonal windows (peak/soft) inside the horizon, and milestones. Deterministic; mock seasonality/benchmarks; not legal advice. Pairs with media_plan / budget_optimizer (what to spend where) — this answers WHEN and in what sequence.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category (anchors seasonality)" },
      budget: { type: "number", exclusiveMinimum: 0, description: "Total budget for the whole horizon, in RUB" },
      goal: {
        type: "string",
        enum: ["awareness", "consideration", "performance", "retention"],
        description: "Primary goal — drives phase budget weights, channels and KPIs",
      },
      startMonth: {
        type: "integer",
        minimum: 1,
        maximum: 12,
        description: "Month the plan starts (1=January..12=December). Defaults to the current month.",
      },
      horizonWeeks: {
        type: "integer",
        minimum: 4,
        maximum: 52,
        description: "Planning horizon in weeks (default 12 — a quarter).",
      },
      geo: { type: "string", description: "Optional geography note, e.g. 'РФ', 'Москва+МО', 'СНГ'" },
    },
    required: ["category", "budget", "goal"],
    additionalProperties: false,
  },
  async handler(input) {
    const category = String(input.category);
    const goal = String(input.goal) as Goal;
    const budget = Number(input.budget);
    const geo = input.geo ? String(input.geo) : "РФ";
    const horizonWeeks = clamp(Math.round(Number(input.horizonWeeks ?? 12)), 4, 52);
    const startMonth =
      input.startMonth != null
        ? clamp(Math.round(Number(input.startMonth)), 1, 12)
        : new Date().getUTCMonth() + 1;

    if (!Number.isFinite(budget) || budget <= 0) {
      return { content: [{ type: "text", text: "Ошибка: budget должен быть положительным числом (RUB)." }], isError: true };
    }

    const seasonality = getSeasonalityIndex(category) ?? new Array(12).fill(1);

    // Map each week (0-based) to a calendar month index (0..11) and season index.
    const weekMonthIdx = (w: number): number =>
      (startMonth - 1 + Math.floor(w / APPROX_WEEKS_PER_MONTH)) % 12;

    // ── Phase week boundaries: ~25% test, ~25% optimize, remainder scale. ──
    const testWeeks = Math.max(1, Math.round(horizonWeeks * 0.25));
    const optimizeWeeks = Math.max(1, Math.round(horizonWeeks * 0.25));
    const scaleWeeks = Math.max(1, horizonWeeks - testWeeks - optimizeWeeks);
    const realTotalWeeks = testWeeks + scaleWeeks + optimizeWeeks;

    const [wTest, wScale, wOptimize] = PHASE_BUDGET[goal];
    const channels = GOAL_CHANNELS[goal];

    const phaseSpecs: Array<{
      phase: Phase["phase"];
      ruName: string;
      from: number;
      count: number;
      weight: number;
      channels: string[];
      objectives: string[];
      exitCriteria: string;
    }> = [
      {
        phase: "Test",
        ruName: "Тест / обучение",
        from: 0,
        count: testWeeks,
        weight: wTest,
        channels: channels.slice(0, 4),
        objectives: [
          "Запустить по 2–3 креатива на канал, собрать статзначимый объём данных",
          "Зафиксировать базовые CPA/CTR по каналам против бенчмарков RU/CIS",
          "Отсеять заведомо слабые связки «канал × креатив × аудитория»",
        ],
        exitCriteria: "Найдены ≥2 канала с CPA не хуже p50 бенчмарка и стабильным объёмом.",
      },
      {
        phase: "Scale",
        ruName: "Масштабирование",
        from: testWeeks,
        count: scaleWeeks,
        weight: wScale,
        channels: channels.slice(0, 2),
        objectives: [
          "Перелить бюджет в каналы-победители из фазы теста",
          "Поднять частоту/охват на лучших аудиториях, расширить look-alike",
          "Держать CPA в коридоре бенчмарка при росте объёма",
        ],
        exitCriteria: "Достигнут целевой объём конверсий при CPA ≤ план; найден потолок канала.",
      },
      {
        phase: "Optimize",
        ruName: "Оптимизация / удержание",
        from: testWeeks + scaleWeeks,
        count: optimizeWeeks,
        weight: wOptimize,
        channels: channels.slice(1, 4).length ? channels.slice(1, 4) : channels.slice(0, 2),
        objectives: [
          "Срезать неэффективные размещения, перераспределить в лучший CPA",
          "Включить ретаргет/CRM-механики и работу с повторными касаниями",
          "Подготовить выводы и план на следующий цикл",
        ],
        exitCriteria: "Blended CPA снижен относительно фазы масштабирования; готов retro + next-cycle plan.",
      },
    ];

    // ── Build phases with channel splits. ──
    const phases: Phase[] = phaseSpecs.map((s) => {
      const phaseBudget = round(budget * s.weight);
      const w = shareWeights(s.channels.length);
      const chan = s.channels.map((c, i) => ({
        channel: c,
        budget: round(phaseBudget * w[i]),
        sharePct: round(w[i] * 100, 1),
      }));
      return {
        phase: s.phase,
        ruName: s.ruName,
        weeks: { from: s.from + 1, to: s.from + s.count, count: s.count },
        budget: phaseBudget,
        budgetPct: round(s.weight * 100, 1),
        channels: chan,
        objectives: s.objectives,
        kpis: GOAL_KPIS[goal],
        exitCriteria: s.exitCriteria,
      };
    });

    // ── Week-by-week pacing: distribute each phase's budget across its weeks,
    // weighting by that week's seasonality index, normalized within the phase. ──
    const weeklyPacing: Array<{
      week: number;
      phase: Phase["phase"];
      month: string;
      seasonIndex: number;
      budget: number;
      budgetPct: number;
    }> = [];

    for (const s of phaseSpecs) {
      const phaseBudget = round(budget * s.weight);
      const idxs: number[] = [];
      let wsum = 0;
      for (let i = 0; i < s.count; i++) {
        const mIdx = weekMonthIdx(s.from + i);
        const si = seasonality[mIdx] ?? 1;
        idxs.push(si);
        wsum += si;
      }
      for (let i = 0; i < s.count; i++) {
        const wk = s.from + i;
        const mIdx = weekMonthIdx(wk);
        const wkBudget = round((phaseBudget * idxs[i]) / (wsum || 1));
        weeklyPacing.push({
          week: wk + 1,
          phase: s.phase,
          month: MONTHS_RU[mIdx],
          seasonIndex: round(seasonality[mIdx] ?? 1, 2),
          budget: wkBudget,
          budgetPct: round((wkBudget / budget) * 100, 1),
        });
      }
    }

    // ── Seasonal windows inside the horizon (peak/soft months). ──
    const seenMonths = new Set<number>();
    const seasonalWindows: Array<{ month: string; index: number; signal: string; action: string }> = [];
    for (let w = 0; w < realTotalWeeks; w++) {
      const mIdx = weekMonthIdx(w);
      if (seenMonths.has(mIdx)) continue;
      seenMonths.add(mIdx);
      const si = seasonality[mIdx] ?? 1;
      if (si >= 1.1) {
        seasonalWindows.push({
          month: MONTHS_RU[mIdx],
          index: round(si, 2),
          signal: "peak",
          action: "Высокий спрос — усилить бюджет, запустить hero-кампанию, не урезать частоту.",
        });
      } else if (si <= 0.9) {
        seasonalWindows.push({
          month: MONTHS_RU[mIdx],
          index: round(si, 2),
          signal: "soft",
          action: "Спрос ниже — экономный режим, тесты гипотез и подготовка к пику.",
        });
      }
    }

    const milestones = [
      `Неделя 1: запуск фазы «Тест» (${ru(phases[0].budget)} ₽, ${phases[0].channels.length} каналов).`,
      `Неделя ${phases[1].weeks.from}: переход в «Масштабирование» — бюджет в каналы-победители.`,
      `Неделя ${phases[2].weeks.from}: «Оптимизация» — срезаем неэффективное, включаем ретаргет/CRM.`,
      `Неделя ${horizonWeeks}: финал цикла — retro, выводы и план на следующий период.`,
    ];

    const payload = {
      category,
      goal,
      geo,
      currency: "RUB",
      startMonth: MONTHS_RU[startMonth - 1],
      horizonWeeks: realTotalWeeks,
      totalBudget: round(budget),
      phases,
      seasonalWindows,
      weeklyPacing,
      milestones,
      assumptions: [
        "Бюджет распределён по фазам по весам, зависящим от цели; внутри фазы спенд взвешен по сезонному индексу недели.",
        `Сезонность взята для категории «${category}» (помесячный индекс, среднее ≈ 1.0).`,
        "Каналы и KPI — пресет под выбранную цель; уточняются после фазы теста.",
      ],
      disclaimer: "Иллюстративный план на mock-данных RU/CIS. Не является юридической/финансовой гарантией.",
    };

    const peak = seasonalWindows.filter((s) => s.signal === "peak").map((s) => s.month);
    const summary =
      `GTM-роадмап «${category}» / цель «${goal}» / ${ru(round(budget))} ₽ / ${realTotalWeeks} нед. (${geo}). ` +
      `Фазы: Тест ${phases[0].budgetPct}% → Масштаб ${phases[1].budgetPct}% → Оптимизация ${phases[2].budgetPct}%. ` +
      (peak.length ? `Пики спроса: ${peak.join(", ")}.` : "Выраженных пиков в горизонте нет.");

    return toContent(summary, payload);
  },
};

export const PLANNING_TOOLS: ToolDef[] = [gtmCalendar];
