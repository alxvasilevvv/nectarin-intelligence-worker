/**
 * LAUNCH & BRAND HEALTH tool group (v2.61) for NECTARIN Intelligence — Workers.
 *
 *   • brand_health_index — composite 0–100 brand-health score from funnel-stage
 *     inputs (awareness / consideration / preference / NPS) plus optional funnel
 *     conversion ratios; benchmark band interpretation.
 *   • gtm_launch_readiness — single-launch scorecard across pillars (product,
 *     messaging, channels, ops, legal/compliance) 0–5 each → readiness %,
 *     go/no-go verdict and prioritized gaps. Distinct from marketing_maturity_assessment
 *     (company-wide maturity vs. one launch).
 *
 * Deterministic on YOUR inputs — planning support, not a guarantee.
 */

import type { ToolDef, ToolResult } from "./tools.js";
import { CATEGORIES } from "./data.js";

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
function round(n: number, d = 1): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const HEALTH_BANDS = [
  { min: 75, label: "Leader", note: "Сильный бренд — фокус на защите доли и advocacy." },
  { min: 60, label: "Strong", note: "Здоровый бренд — точечно усилить слабое звено воронки." },
  { min: 40, label: "Average", note: "Средний уровень — приоритет на consideration/preference." },
  { min: 0, label: "Weak", note: "Слабое здоровье бренда — нужен системный бренд + performance микс." },
];
function bandFor(score: number): { label: string; note: string } {
  for (const b of HEALTH_BANDS) if (score >= b.min) return { label: b.label, note: b.note };
  return HEALTH_BANDS[HEALTH_BANDS.length - 1];
}

const brandHealthIndex: ToolDef = {
  name: "brand_health_index",
  description:
    "Composite BRAND HEALTH index (0–100) for a brand manager / CMO. From funnel-stage inputs — aided awareness, consideration and preference (each 0–100 %) and NPS (−100..+100) — it computes a weighted health score, optional funnel-efficiency sub-score (impression→awareness→consideration→purchase conversion ratios), a benchmark band (Weak / Average / Strong / Leader) and the weakest lever. Distinct from brand_lift (survey lift test) and share_of_search (demand proxy). Deterministic on YOUR numbers.",
  inputSchema: {
    type: "object",
    properties: {
      awareness: { type: "number", minimum: 0, maximum: 100, description: "Aided awareness, %" },
      consideration: { type: "number", minimum: 0, maximum: 100, description: "Consideration set inclusion, %" },
      preference: { type: "number", minimum: 0, maximum: 100, description: "Brand preference / top-of-mind, %" },
      nps: { type: "number", minimum: -100, maximum: 100, description: "Net Promoter Score (−100..+100)" },
      funnel: {
        type: "object",
        description: "Optional funnel conversion ratios, %",
        properties: {
          impressionToAwarenessPct: { type: "number", minimum: 0, maximum: 100 },
          awarenessToConsiderationPct: { type: "number", minimum: 0, maximum: 100 },
          considerationToPurchasePct: { type: "number", minimum: 0, maximum: 100 },
        },
        additionalProperties: false,
      },
      brand: { type: "string", description: "Optional brand name for the header" },
    },
    required: ["awareness", "consideration", "preference", "nps"],
    additionalProperties: false,
  },
  async handler(input) {
    const awareness = num(input?.awareness);
    const consideration = num(input?.consideration);
    const preference = num(input?.preference);
    const nps = num(input?.nps);
    if (awareness === null || consideration === null || preference === null || nps === null) {
      return errResult("Нужны awareness, consideration, preference (0–100) и nps (−100..+100).");
    }

    const npsNorm = clamp((nps + 100) / 2, 0, 100);
    const components = [
      { key: "awareness", label: "Осведомлённость", value: awareness, weight: 0.2, score: awareness },
      { key: "consideration", label: "Рассмотрение", value: consideration, weight: 0.2, score: consideration },
      { key: "preference", label: "Предпочтение", value: preference, weight: 0.25, score: preference },
      { key: "nps", label: "NPS (норм.)", value: nps, weight: 0.25, score: npsNorm },
    ];

    let funnelScore: number | null = null;
    const funnel = isRecord(input?.funnel) ? input.funnel : null;
    if (funnel) {
      const i2a = num(funnel.impressionToAwarenessPct);
      const a2c = num(funnel.awarenessToConsiderationPct);
      const c2p = num(funnel.considerationToPurchasePct);
      if (i2a !== null && a2c !== null && c2p !== null) {
        // Compound funnel efficiency vs. illustrative RU/CIS benchmarks (~15/40/25).
        const bench = [15, 40, 25];
        const actual = [i2a, a2c, c2p];
        const ratios = actual.map((v, i) => clamp(v / bench[i], 0, 1.5));
        funnelScore = round((ratios.reduce((a, r) => a + r, 0) / 3) * 100, 1);
        components.push({ key: "funnel", label: "Эффективность воронки", value: funnelScore, weight: 0.1, score: funnelScore });
      }
    }

    const wSum = components.reduce((a, c) => a + c.weight, 0);
    const index = round(components.reduce((a, c) => a + c.score * c.weight, 0) / wSum, 1);
    const band = bandFor(index);
    const weakest = [...components].sort((a, b) => a.score - b.score)[0];

    const brand = typeof input?.brand === "string" ? input.brand.trim() : "";
    const summary =
      `Brand Health Index${brand ? ` «${brand}»` : ""}: ${index}/100 (${band.label}). ` +
      `Слабое звено — ${weakest.label} (${weakest.score}). ${band.note}`;

    return toContent(summary, {
      tool: "brand_health_index",
      brand: brand || null,
      index,
      band: band.label,
      bandNote: band.note,
      components: components.map((c) => ({
        key: c.key,
        label: c.label,
        input: c.key === "nps" ? c.value : c.value,
        normalizedScore: c.score,
        weight: c.weight,
        contribution: round(c.score * c.weight / wSum, 1),
      })),
      funnel: funnelScore !== null ? { efficiencyScore: funnelScore, ratios: funnel } : null,
      weakestLever: { key: weakest.key, label: weakest.label, score: weakest.score },
      note: "Индекс = взвешенная сумма стадий воронки + NPS (норм. 0–100). Опциональная воронка — 10% веса vs. бенчмаркам RU/CIS. Планирование, не аудит рынка.",
    });
  },
};

interface LaunchPillar {
  key: string;
  label: string;
  weight: number;
  action: string;
}
const LAUNCH_PILLARS: LaunchPillar[] = [
  { key: "product", label: "Продукт / offer-market fit", weight: 0.22, action: "Закрыть критичные product gaps, финализировать MVP scope и acceptance criteria." },
  { key: "messaging", label: "Сообщения и позиционирование", weight: 0.2, action: "Согласовать value prop, RTB и единый messaging framework для всех каналов." },
  { key: "channels", label: "Каналы и медиамикс", weight: 0.2, action: "Подтвердить channel plan, бюджеты, KPI и tracking per channel." },
  { key: "ops", label: "Операции и исполнение", weight: 0.2, action: "RACI, SLA поддержки, CRM/сквозная аналитика, пейсинг и QA креативов." },
  { key: "legal", label: "Legal / compliance", weight: 0.18, action: "Legal sign-off, ОРД/ЕРИР, дисклеймеры и STOP-GATE для regulated категорий." },
];

const REGULATED = new Set(["pharma", "finance"]);

const gtmLaunchReadiness: ToolDef = {
  name: "gtm_launch_readiness",
  description:
    "GTM LAUNCH readiness scorecard for a product marketer / launch lead. Rate five launch pillars 0–5 (product/offer fit, messaging, channels, ops/execution, legal/compliance) and it computes a weighted readiness % (0–100), a go/no-go/conditional verdict, prioritized gaps (pillars <3) and pillar-specific actions. Optional `category` adds regulated-industry compliance notes (pharma, finance). Distinct from marketing_maturity_assessment (company-wide maturity) and gtm_calendar (timing). Deterministic self-assessment.",
  inputSchema: {
    type: "object",
    properties: {
      scores: {
        type: "object",
        description: "Self-assessment 0–5 per pillar. Keys: product, messaging, channels, ops, legal.",
        properties: {
          product: { type: "number", minimum: 0, maximum: 5 },
          messaging: { type: "number", minimum: 0, maximum: 5 },
          channels: { type: "number", minimum: 0, maximum: 5 },
          ops: { type: "number", minimum: 0, maximum: 5 },
          legal: { type: "number", minimum: 0, maximum: 5 },
        },
        additionalProperties: false,
      },
      category: { type: "string", enum: CATEGORIES, description: "Optional category for compliance context (pharma/finance ⇒ regulated)" },
      launch: { type: "string", description: "Optional launch / product name" },
    },
    required: ["scores"],
    additionalProperties: false,
  },
  async handler(input) {
    const scores = isRecord(input?.scores) ? input.scores : {};
    const assessed: Array<{ key: string; label: string; weight: number; score: number; action: string }> = [];
    const notAssessed: string[] = [];
    for (const p of LAUNCH_PILLARS) {
      const raw = num((scores as Record<string, unknown>)[p.key]);
      if (raw === null) {
        notAssessed.push(p.key);
        continue;
      }
      assessed.push({ ...p, score: clamp(raw, 0, 5) });
    }
    if (assessed.length === 0) {
      return errResult("Не передано ни одной оценки. Укажите scores с ключами product, messaging, channels, ops, legal (0–5).");
    }

    const wSum = assessed.reduce((a, p) => a + p.weight, 0);
    const readinessPct = round(
      assessed.reduce((a, p) => a + (p.score / 5) * 100 * p.weight, 0) / wSum,
      1
    );
    let verdict: string;
    let verdictNote: string;
    if (readinessPct >= 80) {
      verdict = "go";
      verdictNote = "Готовность высокая — можно запускать с контрольным чек-листом первых 72ч.";
    } else if (readinessPct >= 60) {
      verdict = "conditional_go";
      verdictNote = "Условный запуск — закрыть критичные gaps до масштабирования spend.";
    } else {
      verdict = "no_go";
      verdictNote = "Не готовы — отложить launch до закрытия gaps <3.";
    }

    const gaps = assessed
      .filter((p) => p.score < 3)
      .sort((a, b) => a.score - b.score || b.weight - a.weight)
      .map((p) => ({
        pillar: p.label,
        key: p.key,
        score: p.score,
        gapToReady: round(3 - p.score, 1),
        action: p.action,
      }));

    const category = typeof input?.category === "string" ? input.category : "";
    const regulated = REGULATED.has(category);
    const complianceNote = regulated
      ? `Категория «${category}» — regulated: legal pillar ≥4 и compliance_check обязательны до старта.`
      : category
        ? `Категория «${category}»: стандартный compliance-чек (ОРД/ЕРИР при платном трафике).`
        : null;

    const launch = typeof input?.launch === "string" ? input.launch.trim() : "";
    const summary =
      `GTM readiness${launch ? ` «${launch}»` : ""}: ${readinessPct}% → ${verdict === "go" ? "GO" : verdict === "conditional_go" ? "УСЛОВНЫЙ GO" : "NO-GO"}. ` +
      `${gaps.length} критичных gap${gaps.length === 1 ? "" : "s"} (<3/5).`;

    return toContent(summary, {
      tool: "gtm_launch_readiness",
      launch: launch || null,
      category: category || null,
      regulated,
      readinessPct,
      verdict,
      verdictNote,
      pillars: assessed.map((p) => ({
        key: p.key,
        label: p.label,
        score: p.score,
        readinessPct: round((p.score / 5) * 100, 1),
        weight: p.weight,
      })),
      notAssessed,
      gaps,
      complianceNote,
      note: "Readiness = взвешенная доля от максимума 5 по каждому pillar. GO ≥80%, conditional 60–79%, NO-GO <60%. Отличие от marketing_maturity_assessment — один launch, не зрелость компании.",
    });
  },
};

export const LAUNCH_TOOLS: ToolDef[] = [brandHealthIndex, gtmLaunchReadiness];
