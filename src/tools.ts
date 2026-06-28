/**
 * NECTARIN Intelligence — tool registry (Cloudflare Workers edition).
 *
 * Each tool exposes a JSON-Schema `inputSchema` (MCP `tools/list` requires JSON
 * Schema on the wire) and an async `handler`. The reference Node server used zod
 * raw shapes that the MCP SDK converted to JSON Schema; here we author the JSON
 * Schema directly so there is zero runtime SDK dependency. The handlers call the
 * shared orchestrator (`runPlan`), exactly like the Node version.
 *
 * `toContent()` renders the orchestrator's structured result into MCP content
 * blocks: a short human-readable summary plus the full JSON, with optional
 * `structuredContent` for programmatic consumers.
 */

import { runPlan } from "./orchestrator.js";
import { CATEGORIES, KPIS, PLATFORMS, DATA_META } from "./data.js";
import { GROWTH_TOOLS } from "./growth.js";
import { ANALYTICS_TOOLS } from "./analytics.js";
import { PREMIUM_TOOLS } from "./premium.js";
import { MMM_TOOLS } from "./mmm.js";
import { PLANNING_TOOLS } from "./planning.js";
import { SCENARIO_TOOLS } from "./scenario.js";
import { PROMO_TOOLS } from "./promo.js";
import { AUDIT_TOOLS } from "./audit.js";
import { BOARD_TOOLS } from "./board.js";
import { CREATIVE_OPS_TOOLS } from "./fatigue.js";
import { INFLUENCE_TOOLS } from "./influence.js";
import { MEDIA_TOOLS } from "./reach.js";
import { BRAND_TOOLS } from "./brand.js";
import { PRODUCTION_TOOLS } from "./production.js";
import { EXPERIMENTATION_TOOLS } from "./geo.js";
import { COMPETITIVE_TOOLS } from "./competitive.js";
import { SEARCH_TOOLS } from "./search.js";
import { RETAIL_TOOLS } from "./retail.js";
import { RETENTION_TOOLS } from "./retention.js";
import { EMAIL_TOOLS } from "./email.js";
import { PARTNERSHIP_TOOLS } from "./affiliate.js";
import { DISCIPLINE_TOOLS } from "./disciplines.js";
import { ROLE_TOOLS } from "./roles.js";
import { DISTRIBUTION_TOOLS } from "./distribution.js";
import { SKILL_TOOLS } from "./skills.js";
import { GROWTHLAB_TOOLS } from "./growthlab.js";
import { FEDERATION_TOOLS } from "./federation.js";
import { EXPANSION_TOOLS } from "./expansion.js";
import { B2BCX_TOOLS } from "./b2bcx.js";
import type { Env } from "./index.js";

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * MCP tool annotations (behavioral HINTS for clients — untrusted, advisory).
 * https://modelcontextprotocol.io/specification — `ToolAnnotations`.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Optional per-tool annotation overrides (merged over the safe defaults). */
  annotations?: ToolAnnotations;
  /**
   * Tool handler. `env` is optional and only consumed by the Growth & Automation
   * tools (e.g. NECTARIN_BOOKING_URL); the original intelligence tools ignore it.
   */
  handler: (input: any, env?: Env) => Promise<ToolResult>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Render a structured payload into MCP content blocks. */
export function toContent(summary: string, payload: unknown): ToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: "```json\n" + JSON.stringify(payload, null, 2) + "\n```" },
    ],
    structuredContent: isRecord(payload) ? payload : { result: payload },
  };
}

// number formatting helper (Workers V8 supports Intl/toLocaleString).
function ru(n: number): string {
  try {
    return Number(n).toLocaleString("ru-RU");
  } catch {
    return String(n);
  }
}

// ── Tool definitions ─────────────────────────────────────────────────────────

const ruBenchmarks: ToolDef = {
  name: "ru_benchmarks",
  description:
    "RU/CIS advertising benchmarks. Returns CPM/CTR/CPA/VTR ranges (p25/p50/p75) and percentile context for a category × KPI, optionally narrowed to one platform (VK Ads, Yandex Direct, Telegram Ads, OLV, Avito). Categories incl. realty, finance, auto, retail, fmcg, pharma, ecom, edtech. Includes data provenance. Mock aggregated data.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category" },
      kpi: { type: "string", enum: KPIS, description: "Metric: CPM, CTR, CPA or VTR" },
      platform: { type: "string", enum: PLATFORMS, description: "Optional single platform filter" },
    },
    required: ["category", "kpi"],
    additionalProperties: false,
  },
  async handler(input) {
    const result = await runPlan("ru_benchmarks", input);
    const d = result.data as any;
    const enriched = { ...result, provenance: DATA_META.provenance };
    const summary = `Бенчмарки ${d.kpi} в категории «${d.category}» (RU/CIS, ${d.currency}) по ${d.results.length} площадкам.`;
    return toContent(summary, enriched);
  },
};

const supplierQuality: ToolDef = {
  name: "supplier_quality",
  description:
    "Inventory / supplier quality index for RU/CIS. Filter by format and/or platform (optionally a category) to get a 0-100 quality score, fraud-risk rating, viewability/human-traffic signals, and a list of recommended (clean) formats plus suppliers to avoid. Mock data.",
  inputSchema: {
    type: "object",
    properties: {
      format: { type: "string", description: "Ad format substring, e.g. 'video', 'native', 'search'" },
      platform: { type: "string", enum: PLATFORMS, description: "Optional platform filter" },
      category: { type: "string", enum: CATEGORIES, description: "Optional category fit" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    const result = await runPlan("supplier_quality", input);
    const d = result.data as any;
    const summary = `Оценка качества инвентаря: ${d.suppliers.length} поставщиков, рекомендуемых форматов — ${d.recommendedFormats.length}, в зоне риска — ${d.avoid.length}.`;
    return toContent(summary, result);
  },
};

const mediaPlan: ToolDef = {
  name: "media_plan",
  description:
    "Build a RU/CIS media plan. Distributes a RUB budget across VK Ads / Yandex Direct / Telegram Ads / OLV based on the marketing goal, then computes a real forecast from mock benchmarks (impressions = spend / CPM * 1000, clicks = impressions * CTR, conversions = spend / CPA, plus estimated reach and blended CPA). Returns channel split %, flighting, forecast totals, per-channel detail, narrative rationale, and compliance flags.",
  inputSchema: {
    type: "object",
    properties: {
      budget: { type: "number", exclusiveMinimum: 0, description: "Total budget in RUB" },
      goal: {
        type: "string",
        enum: ["awareness", "consideration", "performance", "retention"],
        description: "Primary marketing goal — drives the channel mix",
      },
      geo: { type: "string", description: "Geography, e.g. 'РФ', 'Москва+МО', 'СНГ'" },
      audience: { type: "string", description: "Target audience description" },
      period: { type: "string", description: "Flight period, e.g. '2026-09-01..2026-09-30' or 'сентябрь 2026'" },
      category: { type: "string", enum: CATEGORIES, description: "Industry category" },
    },
    required: ["budget", "goal", "geo", "audience", "period", "category"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const result = await runPlan("media_plan", input, { env });
    const d = result.data as any;
    const t = d.forecast;
    const gate = d.compliance?.gate ? ` ⚠ ${d.compliance.gate}` : "";
    const summary =
      `Медиаплан «${input.category}» / цель «${input.goal}» / бюджет ${ru(input.budget)} ₽. ` +
      `Прогноз: ~${ru(t.impressions)} показов, ~${ru(t.estReach)} охват, ` +
      `~${ru(t.conversions)} конверсий, blended CPA ${t.blendedCpa ?? "n/a"} ₽.${gate}`;
    return toContent(summary, result);
  },
};

const categoryPlaybook: ToolDef = {
  name: "category_playbook",
  description:
    "Category go-to-market playbook for RU/CIS: communication territories, do's & don'ts, seasonal hooks, and compliance notes. Regulated categories (pharma, finance) get a STOP-GATE flag requiring legal sign-off before launch. Mock data, not legal advice.",
  inputSchema: {
    type: "object",
    properties: {
      industry: { type: "string", enum: CATEGORIES, description: "Industry / category" },
    },
    required: ["industry"],
    additionalProperties: false,
  },
  async handler(input) {
    const result = await runPlan("category_playbook", input);
    const d = result.data as any;
    const reg = d.compliance?.regulated ? " (РЕГУЛИРУЕМАЯ — нужен юр-контроль)" : "";
    const summary = `Плейбук категории «${d.industry}»${reg}: ${d.territories.length} территорий, ${d.seasonalHooks.length} сезонных поводов.`;
    return toContent(summary, result);
  },
};

const audienceInsights: ToolDef = {
  name: "audience_insights",
  description:
    "Audience insights for a RU/CIS category: key segments (with relative size and notes), Jobs-To-Be-Done, and media affinities (which channels each audience leans into). Optional geo refinement. Mock data.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category" },
      geo: { type: "string", description: "Optional geography refinement" },
    },
    required: ["category"],
    additionalProperties: false,
  },
  async handler(input) {
    const result = await runPlan("audience_insights", input);
    const d = result.data as any;
    const summary = `Аудитория «${d.category}» (${d.geo}): ${d.segments.length} сегментов, ${d.jtbd.length} JTBD.`;
    return toContent(summary, result);
  },
};

const competitorScan: ToolDef = {
  name: "competitor_scan",
  description:
    "Competitive landscape scan for RU/CIS. Provide a brand and/or category to get a list of likely competitors with estimated media activity, primary channels, and the communication territory each tends to own. Synthetic estimates — wire to real SOV monitoring (Mediascope, Brand Analytics) in production.",
  inputSchema: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Brand to analyze (optional if category given)" },
      category: { type: "string", enum: CATEGORIES, description: "Category to scan (optional if brand given)" },
    },
    additionalProperties: false,
  },
  async handler(input) {
    if (!input.brand && !input.category) input = { ...input, category: "retail" };
    const result = await runPlan("competitor_scan", input);
    const d = result.data as any;
    const summary = `Скан конкурентов (${d.subject}, категория «${d.category}»): найдено ${d.competitors.length}.`;
    return toContent(summary, result);
  },
};

const geoAeoAudit: ToolDef = {
  name: "geo_aeo_audit",
  description:
    "GEO / AEO (Generative & Answer Engine Optimization) audit for a brand: estimated visibility score inside AI answer engines and RU search — Yandex (neuro), GigaChat (Sber), YandexGPT/Alice, ChatGPT — plus concrete recommendations to improve how models describe and cite the brand. Synthetic scores.",
  inputSchema: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Brand name to audit" },
      market: { type: "string", default: "RU", description: "Market, default 'RU'" },
    },
    required: ["brand"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const result = await runPlan("geo_aeo_audit", input, { env });
    const d = result.data as any;
    const summary = `GEO/AEO аудит «${d.brand}» (${d.market}): общий индекс видимости ${d.overall}/100; ${d.recommendations.length} рекомендаций.`;
    return toContent(summary, result);
  },
};

const creativeBrief: ToolDef = {
  name: "creative_brief",
  description:
    "Generate a creative brief for a product, audience and channel: objective, single-minded proposition, tone, mandatories (incl. RU ad-labeling), channel craft notes, and 3 distinct concept territories. Narrative comes from the (stubbed) LLM grounded on structured inputs.",
  inputSchema: {
    type: "object",
    properties: {
      product: { type: "string", description: "Product or offer" },
      audience: { type: "string", description: "Target audience" },
      channel: { type: "string", description: "Primary channel, e.g. 'Telegram Ads', 'OLV', 'VK Clips'" },
    },
    required: ["product", "audience", "channel"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const result = await runPlan("creative_brief", input, { env });
    const d = result.data as any;
    const summary = `Креативный бриф «${d.product}» для «${d.audience}» в канале «${d.channel}» + ${d.conceptTerritories.length} концепта.`;
    return toContent(summary, result);
  },
};

const reportExplain: ToolDef = {
  name: "report_explain",
  description:
    'Explain a campaign metrics report in plain language. Accepts a JSON string of metrics (e.g. {"cpm":300,"ctr":0.4,"cpa":1800,"vtr":55}), returns a plain-language summary, detected anomalies (heuristic), and 3 prioritized recommendations.',
  inputSchema: {
    type: "object",
    properties: {
      metricsJson: {
        type: "string",
        description: 'JSON string of metrics, e.g. {"cpm":300,"ctr":0.4,"cpa":1800,"vtr":55,"spend":500000}',
      },
    },
    required: ["metricsJson"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const result = await runPlan("report_explain", input, { env });
    const d = result.data as any;
    if (d.error) {
      return { content: [{ type: "text", text: `Ошибка: ${d.error}` }], isError: true };
    }
    const summary = `Разбор отчёта: ${d.anomalies.length} наблюдений, ${d.recommendations.length} рекомендации.`;
    return toContent(summary, result);
  },
};

const budgetOptimizer: ToolDef = {
  name: "budget_optimizer",
  description:
    "Optimize a RUB media budget across VK Ads / Yandex Direct / Telegram Ads / OLV to MAXIMIZE conversions (not just follow a goal preset). Uses real optimization: conversions/RUB = 1/CPA, then water-fills the lowest-CPA channels first up to a per-channel cap (default 45%). Returns the optimal allocation, projected conversions & blended CPA, and the uplift vs. the goal-preset split. Mock benchmarks.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", enum: CATEGORIES, description: "Industry category (anchors benchmarks)" },
      budget: { type: "number", exclusiveMinimum: 0, description: "Total budget in RUB" },
      goal: {
        type: "string",
        enum: ["awareness", "consideration", "performance", "retention"],
        description: "Goal whose preset split is used as the comparison baseline (default performance)",
      },
      maxSharePct: {
        type: "number",
        minimum: 25,
        maximum: 100,
        description: "Per-channel cap as a percent of budget (default 45). Lower = more diversified.",
      },
    },
    required: ["category", "budget"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const result = await runPlan("budget_optimizer", input, { env });
    const d = result.data as any;
    const t = d.optimized.totals;
    const up = d.upliftVsPresetPct;
    const summary =
      `Оптимизация бюджета «${input.category}» (${ru(input.budget)} ₽): ` +
      `~${ru(t.conversions)} конверсий, blended CPA ${t.blendedCpa ?? "n/a"} ₽` +
      (up !== null ? `, +${up}% к пресету.` : ".");
    return toContent(summary, result);
  },
};

const strategyOrchestrate: ToolDef = {
  name: "strategy_orchestrate",
  description:
    "FLAGSHIP end-to-end orchestration. In ONE call NECTARIN fans out to all of its workers and returns a complete go-to-market strategy: RU/CIS CPA benchmarks, audience segments & JTBD, competitor landscape, goal-based channel split WITH a forecast (impressions/reach/conversions/blended CPA), a conversion-maximizing optimized split, a lead creative concept, compliance gate, a quick ROI framing, and an executive summary. The narrative uses a real LLM when LLM_API_KEY is set (Anthropic/OpenAI), otherwise a deterministic stub. Mock/synthetic data; not legal advice.",
  inputSchema: {
    type: "object",
    properties: {
      brand: { type: "string", description: "Brand name (optional but recommended)" },
      category: { type: "string", enum: CATEGORIES, description: "Industry category" },
      budget: { type: "number", exclusiveMinimum: 0, description: "Monthly budget in RUB" },
      goal: {
        type: "string",
        enum: ["awareness", "consideration", "performance", "retention"],
        description: "Primary marketing goal",
      },
      geo: { type: "string", description: "Geography, e.g. 'РФ', 'Москва+МО', 'СНГ'" },
      audience: { type: "string", description: "Optional audience description" },
      period: { type: "string", description: "Optional flight period, e.g. 'Q4 2026'" },
    },
    required: ["category", "budget", "goal", "geo"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const result = await runPlan("strategy_orchestrate", input, { env });
    const d = result.data as any;
    const f = d.mediaPlan?.forecast ?? {};
    const gate = d.compliance?.gate ? " ⚠ STOP-GATE (регулируемая)" : "";
    const summary =
      `Полная стратегия${d.brand ? ` «${d.brand}»` : ""} / «${input.category}» / цель «${input.goal}» / ${ru(input.budget)} ₽. ` +
      `Прогноз: ~${ru(f.estReach ?? 0)} охват, ~${ru(f.conversions ?? 0)} конверсий, blended CPA ${f.blendedCpa ?? "n/a"} ₽. ` +
      `Собрано ${d.pipeline?.length ?? 0} воркеров (бенчмарки, аудитория, конкуренты, медиаплан, оптимизация, креатив, комплаенс, ROI).${gate}`;
    return toContent(summary, result);
  },
};

// Original "Intelligence" tool group + the new orchestration/optimization tools.
const INTELLIGENCE_TOOLS: ToolDef[] = [
  ruBenchmarks,
  supplierQuality,
  mediaPlan,
  categoryPlaybook,
  audienceInsights,
  competitorScan,
  geoAeoAudit,
  creativeBrief,
  reportExplain,
  budgetOptimizer,
  strategyOrchestrate,
];

// Full registry = Intelligence + Growth & Automation + Premium Analytics + Premium tools.
export const ALL_TOOLS: ToolDef[] = [
  ...INTELLIGENCE_TOOLS,
  ...GROWTH_TOOLS,
  ...ANALYTICS_TOOLS,
  ...PREMIUM_TOOLS,
  ...MMM_TOOLS,
  ...PLANNING_TOOLS,
  ...SCENARIO_TOOLS,
  ...PROMO_TOOLS,
  ...AUDIT_TOOLS,
  ...BOARD_TOOLS,
  ...CREATIVE_OPS_TOOLS,
  ...INFLUENCE_TOOLS,
  ...MEDIA_TOOLS,
  ...BRAND_TOOLS,
  ...PRODUCTION_TOOLS,
  ...EXPERIMENTATION_TOOLS,
  ...COMPETITIVE_TOOLS,
  ...SEARCH_TOOLS,
  ...RETAIL_TOOLS,
  ...RETENTION_TOOLS,
  ...EMAIL_TOOLS,
  ...PARTNERSHIP_TOOLS,
  ...DISCIPLINE_TOOLS,
  ...ROLE_TOOLS,
  ...DISTRIBUTION_TOOLS,
  ...SKILL_TOOLS,
  ...GROWTHLAB_TOOLS,
  ...FEDERATION_TOOLS,
  ...EXPANSION_TOOLS,
  ...B2BCX_TOOLS,
];

export const TOOLS_BY_NAME: Record<string, ToolDef> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t])
);

// ── Tool annotations (MCP `tools/list` hints) ────────────────────────────────

/**
 * Safe defaults: every tool is a pure, read-only computation over MOCK/benchmark
 * data — no side effects, no external state mutation, deterministic & idempotent.
 * Tools that call an external LLM or reference NECTARIN's funnel override below.
 */
const DEFAULT_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/**
 * Per-tool overrides. LLM-backed tools are non-deterministic (idempotentHint
 * false) and reach an external model (openWorldHint true). The proposal tool
 * semantically RECORDS a brief (would POST to a CRM in prod) ⇒ not read-only.
 */
const ANNOTATION_OVERRIDES: Record<string, ToolAnnotations> = {
  creative_variants: { idempotentHint: false, openWorldHint: true },
  localize: { idempotentHint: false, openWorldHint: true },
  request_nectarin_proposal: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
  book_consultation: { openWorldHint: true },
};

const ACRONYMS = new Set([
  "ru", "cis", "roi", "ltv", "cac", "cpa", "cpm", "ctr", "vtr", "utm",
  "ab", "aeo", "geo", "kpi", "npv", "fz", "ord", "mmm", "gtm",
  "seo", "smm", "pr", "aso", "epc", "crm",
]);

/** snake_case → "Title Case" with marketing acronyms upper-cased (display name). */
export function humanizeTitle(name: string): string {
  return name
    .split("_")
    .map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/** Resolve the full annotation set for a tool (defaults ← per-tool override ← title). */
export function annotationsFor(t: ToolDef): ToolAnnotations {
  return {
    ...DEFAULT_ANNOTATIONS,
    ...ANNOTATION_OVERRIDES[t.name],
    ...t.annotations,
    title: t.annotations?.title ?? humanizeTitle(t.name),
  };
}

/** Build the MCP `tools/list` entry for a tool (name, title, schema, annotations). */
export function describeTool(t: ToolDef): {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
} {
  const annotations = annotationsFor(t);
  return {
    name: t.name,
    title: annotations.title!,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations,
  };
}
