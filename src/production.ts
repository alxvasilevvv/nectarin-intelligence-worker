/**
 * PRODUCTION tool group (v2.25) for NECTARIN Intelligence — Cloudflare Workers.
 *
 *   • production_estimator — a creative production budget & timeline estimator for
 *     Производство. From a list of deliverables (asset type × quantity ×
 *     complexity) and a quality tier, it applies an illustrative RU rate card to
 *     produce a per-deliverable cost & effort breakdown, a subtotal, contingency
 *     and optional rush surcharge, a total cost RANGE, and a critical-path timeline
 *     estimate (production is partly parallel, not purely additive).
 *
 * Heuristic rate card, fully deterministic. No LLM, no PII. A planning ballpark —
 * always confirm against real vendor quotes.
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

interface RateCard {
  cost: number; // base RUB per unit
  days: number; // base working days per unit (single stream)
  label: string;
}

// Illustrative RU production rate card (per single asset, standard complexity).
const RATES: Record<string, RateCard> = {
  video: { cost: 800_000, days: 25, label: "Ключевое видео / OLV-ролик" },
  video_cutdown: { cost: 120_000, days: 4, label: "Адаптация/каткдаун видео" },
  static: { cost: 40_000, days: 2, label: "Статичный баннер / KV-адаптация" },
  key_visual: { cost: 180_000, days: 7, label: "Ключевой визуал (KV)" },
  animated_banner: { cost: 70_000, days: 3, label: "Анимированный баннер" },
  social_post: { cost: 25_000, days: 1.5, label: "Пост для соцсетей" },
  photo: { cost: 150_000, days: 5, label: "Фотосъёмка (сет)" },
  landing: { cost: 300_000, days: 12, label: "Лендинг / промо-страница" },
  audio: { cost: 90_000, days: 4, label: "Аудио/радиоролик" },
};

const COMPLEXITY: Record<string, number> = { simple: 0.7, standard: 1.0, complex: 1.6 };
const TIER: Record<string, number> = { economy: 0.75, standard: 1.0, premium: 1.5 };

interface DeliverableIn {
  type: string;
  quantity?: number;
  complexity?: string;
}

const productionEstimator: ToolDef = {
  name: "production_estimator",
  description:
    "Creative production budget & timeline estimator for Производство. From a list of deliverables (asset type × quantity × complexity) and a quality tier (economy/standard/premium), applies an illustrative RU rate card to give a per-deliverable cost & effort breakdown, a subtotal, contingency and optional rush surcharge, a total cost RANGE (±20%), and a critical-path timeline estimate (production is partly parallel). Asset types: video, video_cutdown, static, key_visual, animated_banner, social_post, photo, landing, audio. Heuristic & deterministic — a planning ballpark, confirm with real vendor quotes.",
  inputSchema: {
    type: "object",
    properties: {
      deliverables: {
        type: "array",
        minItems: 1,
        description: "Assets to produce",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Asset type: video | video_cutdown | static | key_visual | animated_banner | social_post | photo | landing | audio",
            },
            quantity: { type: "number", exclusiveMinimum: 0, description: "How many of this asset (default 1)" },
            complexity: { type: "string", enum: ["simple", "standard", "complex"], description: "Complexity (default standard)" },
          },
          required: ["type"],
          additionalProperties: false,
        },
      },
      tier: { type: "string", enum: ["economy", "standard", "premium"], description: "Quality/production tier (default standard)" },
      rushPct: { type: "number", minimum: 0, maximum: 100, description: "Optional rush surcharge, % (compresses timeline too)" },
      contingencyPct: { type: "number", minimum: 0, maximum: 50, description: "Contingency buffer, % (default 10)" },
    },
    required: ["deliverables"],
    additionalProperties: false,
  },
  async handler(input) {
    const deliverables = (input.deliverables ?? []) as DeliverableIn[];
    if (!deliverables.length) {
      return { content: [{ type: "text", text: "Ошибка: передай хотя бы один deliverable." }], isError: true };
    }
    const tierKey = typeof input.tier === "string" && TIER[input.tier] ? input.tier : "standard";
    const tierMult = TIER[tierKey];
    const rushPct = typeof input.rushPct === "number" && input.rushPct > 0 ? Math.min(input.rushPct, 100) : 0;
    const contingencyPct = typeof input.contingencyPct === "number" && input.contingencyPct >= 0 ? Math.min(input.contingencyPct, 50) : 10;

    const notes: string[] = [];
    const lines = deliverables.map((d) => {
      const typeKey = String(d.type ?? "").toLowerCase();
      const card = RATES[typeKey] ?? { cost: 50_000, days: 2, label: `Прочее (${d.type})` };
      if (!RATES[typeKey]) notes.push(`Неизвестный тип «${d.type}» — взята общая ставка (50 000 ₽ / 2 дня).`);
      const qty = typeof d.quantity === "number" && d.quantity > 0 ? d.quantity : 1;
      const compKey = typeof d.complexity === "string" && COMPLEXITY[d.complexity] ? d.complexity : "standard";
      const compMult = COMPLEXITY[compKey];
      const unitCost = card.cost * compMult * tierMult;
      const cost = unitCost * qty;
      const unitDays = card.days * compMult;
      const effortDays = unitDays * qty;
      return {
        type: typeKey,
        label: card.label,
        quantity: qty,
        complexity: compKey,
        unitCost: round(unitCost),
        cost: round(cost),
        unitDays: round(unitDays, 1),
        effortDays: round(effortDays, 1),
      };
    });

    const subtotal = lines.reduce((s, l) => s + l.cost, 0);
    const contingency = subtotal * (contingencyPct / 100);
    const rush = (subtotal + contingency) * (rushPct / 100);
    const total = subtotal + contingency + rush;
    const totalRange = { low: round(total * 0.8), high: round(total * 1.2) };

    // Timeline: critical path = longest single stream; the rest overlaps (15% of remaining effort).
    const criticalPath = Math.max(...lines.map((l) => l.unitDays));
    const totalEffort = lines.reduce((s, l) => s + l.effortDays, 0);
    const restEffort = Math.max(0, totalEffort - criticalPath);
    let timelineDays = criticalPath + 0.15 * restEffort;
    if (rushPct > 0) timelineDays *= 1 - Math.min(0.4, rushPct / 100 / 2); // rush compresses up to 40%
    const timelineWeeks = timelineDays / 5;

    const payload = {
      tier: tierKey,
      currency: "RUB",
      deliverables: lines,
      costs: {
        subtotal: round(subtotal),
        contingencyPct,
        contingency: round(contingency),
        rushPct,
        rush: round(rush),
        total: round(total),
        totalRange,
      },
      timeline: {
        criticalPathDays: round(criticalPath, 1),
        totalEffortDays: round(totalEffort, 1),
        estimatedWorkingDays: round(timelineDays, 1),
        estimatedWeeks: round(timelineWeeks, 1),
        note: "Критический путь (самый длинный поток) + 15% параллельного остатка; rush сжимает до 40%.",
      },
      methodology:
        "Illustrative RU rate card × complexity (simple 0.7 / standard 1.0 / complex 1.6) × tier (economy 0.75 / standard 1.0 / premium 1.5). Контингенция и rush — надбавки. Таймлайн = критический путь + частичное распараллеливание.",
      assumptions: [
        "Ставки иллюстративные (RU), без учёта прав на музыку/талант/медиа-выкупа и пост-продакшн-вариаций.",
        "Сроки — рабочие дни, при условии своевременных согласований клиента.",
        "Реальные сметы зависят от подрядчика, локаций, каста и сложности — это плановая вилка.",
      ],
      disclaimer: "Плановый ориентир, не оффер. Подтверждайте реальными сметами подрядчиков.",
      notes: notes.length ? notes : undefined,
    };

    const summary =
      `Смета продакшна (${tierKey}): ${lines.length} позиций, итого ~${ru(round(total))} ₽ ` +
      `(вилка ${ru(totalRange.low)}–${ru(totalRange.high)} ₽), срок ~${round(timelineWeeks, 1)} нед. ` +
      `(${round(timelineDays, 1)} раб. дн.).` +
      (rushPct ? ` Учтён rush +${rushPct}%.` : "");

    return toContent(summary, payload);
  },
};

export const PRODUCTION_TOOLS: ToolDef[] = [productionEstimator];
