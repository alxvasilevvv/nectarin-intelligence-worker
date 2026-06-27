/**
 * NECTARIN Intelligence — remote MCP server on Cloudflare Workers.
 *
 * Serves a WORKING Model Context Protocol endpoint over Streamable HTTP using a
 * small, spec-compliant JSON-RPC 2.0 handler implemented by hand. We deliberately
 * do NOT depend on `@modelcontextprotocol/sdk` here: the SDK's server transports
 * are written against Node's `http` IncomingMessage/ServerResponse and Node
 * streams, which do not exist on the Workers runtime. A hand-rolled handler is
 * smaller, has zero runtime deps, and is fully under our control — which the task
 * explicitly accepts as preferred over a broken SDK port.
 *
 * Routes:
 *   POST /mcp                                   — JSON-RPC 2.0 MCP endpoint
 *   GET  /mcp                                   — 405 (SSE GET stream not used in stateless mode)
 *   GET  /.well-known/oauth-protected-resource  — OAuth protected-resource discovery
 *   GET  /health                                — liveness probe
 *   GET  /version                               — name + version + toolCount + commit-ish
 *
 * Methods implemented: initialize, notifications/initialized (notification),
 * ping, tools/list, tools/call, prompts/list, prompts/get, resources/list,
 * resources/read.
 *
 * Production hardening: real OAuth 2.1 bearer verification (src/auth.ts, jose),
 * per-token/IP rate limiting (src/ratelimit.ts), per-tool JSON-Schema input
 * validation (src/validate.ts), structured request logging, and safe error
 * messages (no stack leakage).
 */

import { ALL_TOOLS, TOOLS_BY_NAME, describeTool } from "./tools.js";
import {
  CATEGORIES,
  KPIS,
  PLATFORMS,
  setDataSource,
  LayeredKvDataSource,
  MockDataSource,
  runWithDataSource,
  type DataSource,
} from "./data.js";
import { authenticate, unauthorizedResponse, authMode } from "./auth.js";
import {
  enforceRateLimit,
  setRateLimiter,
  KvRateLimiter,
  MemoryRateLimiter,
  DurableObjectRateLimiter,
  type DurableNamespaceLike,
} from "./ratelimit.js";
import { validateInput, formatErrors } from "./validate.js";
import { getLlmCacheStats, type KvLike } from "./orchestrator.js";

export interface Env {
  // ── OAuth 2.1 resource-server config (Unyly Connect fronts OAuth in prod) ──
  OAUTH_ISSUER?: string;
  OAUTH_AUDIENCE?: string;
  /** JWKS endpoint; if omitted it is derived from OAUTH_ISSUER. */
  OAUTH_JWKS_URL?: string;
  DEV_BYPASS?: string;
  /**
   * Optional shared-secret bearer token. When set (via `wrangler secret put
   * MCP_SHARED_TOKEN`), /mcp requires `Authorization: Bearer <token>`. Checked
   * before DEV_BYPASS/OAuth — a dependency-free way to lock the endpoint.
   */
  MCP_SHARED_TOKEN?: string;
  // ── Rate limiting ──
  /** Requests per minute per token/IP. Default 60. */
  RATE_LIMIT_PER_MIN?: string;
  // ── Observability ──
  /** Optional build/commit identifier surfaced by GET /version (set at deploy). */
  GIT_COMMIT?: string;
  // ── LLM seam (model-agnostic narrative). All optional — absent ⇒ deterministic
  //    stub. Set LLM_API_KEY via `wrangler secret put LLM_API_KEY` to go live. ──
  /** API key for the narrative model. When set, callLLM() makes a real request. */
  LLM_API_KEY?: string;
  /** "anthropic" (default) | "openai". */
  LLM_PROVIDER?: string;
  /** Model id (per-provider default when unset). */
  LLM_MODEL?: string;
  /** Optional API base override (proxy / Azure / self-host). */
  LLM_BASE_URL?: string;
  // Growth & Automation (funnel) vars — see wrangler.toml [vars] and src/growth.ts.
  // All placeholders; no tool sends PII or makes a real network call.
  NECTARIN_BOOKING_URL?: string;
  NECTARIN_CONTACT_EMAIL?: string;
  NECTARIN_BRAND_NAME?: string;
  NECTARIN_CRM_WEBHOOK_URL?: string;
  /**
   * KV namespace binding. Two uses (both optional / graceful):
   *   • callLLM() narrative response cache (cache:llm:<hash>).
   *   • LayeredKvDataSource — operator-uploaded real/override benchmarks layered
   *     over the bundled synthetic data (benchmarks:<category>, playbook:<industry>, suppliers).
   */
  NECTARIN_KV?: KvLike;
  /**
   * Optional Durable Object namespace for STRONGLY-consistent global rate limits.
   * When bound, it is preferred over the KV/memory limiter (with fail-open
   * fallback to them). See `RateLimiterDO` below and wrangler.toml.
   */
  RATE_LIMITER?: DurableNamespaceLike;
  // Future binding: NECTARIN_DB?: D1Database (per-tenant relational data).
}

const SERVER_NAME = "nectarin-intelligence";
const SERVER_VERSION = "2.12.0";
const PROTOCOL_VERSION = "2025-06-18"; // MCP protocol revision advertised on initialize.

// JSON-RPC error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
// Implementation-defined server errors (JSON-RPC reserves -32000..-32099).
const RATE_LIMITED = -32029;

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: any;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS, ...extra },
  });
}

function rpcResult(id: JsonRpcId, result: unknown): Response {
  return json({ jsonrpc: "2.0", id, result });
}

/**
 * Wrap a JSON-RPC body as a single Server-Sent Events `message` frame. Used for
 * the OPT-IN SSE response path (Streamable HTTP). Default transport stays JSON so
 * existing clients are unaffected; SSE is only used when explicitly requested.
 */
function sseResponse(body: unknown, extra: Record<string, string> = {}): Response {
  const frame = `event: message\ndata: ${JSON.stringify(body)}\n\n`;
  return new Response(frame, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...CORS_HEADERS,
      ...extra,
    },
  });
}

/**
 * SSE is OPT-IN to avoid changing behavior for existing JSON clients:
 *   • `?stream=1` query param, OR
 *   • `Accept: text/event-stream` WITHOUT also accepting application/json.
 * Clients that send `Accept: application/json, text/event-stream` (the common MCP
 * default) keep getting JSON.
 */
function wantsSse(url: URL, request: Request): boolean {
  if (url.searchParams.get("stream") === "1") return true;
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  return accept.includes("text/event-stream") && !accept.includes("application/json");
}

function rpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
  httpStatus = 200,
  extra: Record<string, string> = {}
): Response {
  return json(
    { jsonrpc: "2.0", id, error: { code, message, ...(data !== undefined ? { data } : {}) } },
    httpStatus,
    extra
  );
}

// ── Static reference content (resources) ─────────────────────────────────────

const METHODOLOGY_MD = `# NECTARIN Intelligence — Methodology

NECTARIN Intelligence is an **orchestrator–worker** AI marketing agent for the
RU/CIS market, exposed over the Model Context Protocol on Cloudflare Workers.

## Pipeline
\`Planner → workers → Synthesizer\`

- **Planner** picks the workers a tool needs (see \`PLAN\` in \`orchestrator.ts\`).
- **Workers**: dataRetriever, analyst (percentiles + forecast math:
  impressions = spend / CPM × 1000, clicks = impressions × CTR,
  conversions = spend / CPA), strategist, copywriter (stubbed \`callLLM()\`),
  compliance (STOP-GATE for pharma/finance).
- **Synthesizer** assembles outputs and stamps provenance + a MOCK-data disclaimer.

## Data
All figures are **MOCK / synthetic**, plausible for RU/CIS in RUB, bundled inline
(no DB in v1). Bind KV/D1 and swap the accessors in \`src/data.ts\` for real data.

## Model-agnostic
Narrative goes through \`callLLM()\` — swap its body for an Anthropic/OpenAI
\`fetch()\` (key via \`wrangler secret\`) without touching the pipeline.
`;

const GLOSSARY_MD = `# Glossary (RU/CIS media)

- **CPM** — Cost per Mille, цена за 1000 показов (₽).
- **CTR** — Click-Through Rate, кликабельность (%).
- **CPA** — Cost per Action, цена целевого действия (₽).
- **VTR** — View-Through Rate, досматриваемость видео (%) — для OLV.
- **OLV** — Online Video (RuTube, VK Video, OK.ru и т.д.).
- **VK Ads** — рекламная платформа VK (бывш. myTarget + VK).
- **Yandex Direct** — Яндекс Директ (поиск + РСЯ + Дзен).
- **Telegram Ads** — официальная реклама в Telegram-каналах.
- **ОРД / ЕРИР** — обязательная маркировка интернет-рекламы в РФ.
- **ПСК** — полная стоимость кредита (раскрытие в финрекламе).
- **GEO / AEO** — Generative / Answer Engine Optimization.
- **JTBD** — Jobs To Be Done. **SOV** — Share of Voice.
`;

const RESOURCES = [
  {
    uri: "nectarin://methodology",
    name: "methodology",
    title: "NECTARIN Intelligence — Methodology",
    description: "How the orchestrator plans, retrieves data, analyzes, and synthesizes outputs.",
    mimeType: "text/markdown",
    text: METHODOLOGY_MD,
  },
  {
    uri: "nectarin://glossary",
    name: "glossary",
    title: "NECTARIN Intelligence — Glossary",
    description: "RU/CIS media glossary: CPM, CTR, CPA, VTR, OLV, ОРД/ЕРИР, GEO/AEO, etc.",
    mimeType: "text/markdown",
    text: GLOSSARY_MD,
  },
  {
    // Generated on read from the live registry (see buildCatalogJson) — never drifts.
    uri: "nectarin://catalog",
    name: "catalog",
    title: "NECTARIN Intelligence — Tool & Prompt Catalog",
    description:
      "Machine-readable JSON catalog: every tool with its title, description, input schema and behavioral annotations, plus the built-in prompts. Generated live from the registry.",
    mimeType: "application/json",
    text: "",
  },
];

/** Live JSON catalog of tools (with annotations) + prompts — generated on read. */
function buildCatalogJson(): string {
  return JSON.stringify(
    {
      server: SERVER_NAME,
      version: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      counts: { tools: ALL_TOOLS.length, prompts: PROMPTS.length },
      tools: ALL_TOOLS.map(describeTool),
      prompts: PROMPTS.map((p) => ({
        name: p.name,
        title: p.title,
        description: p.description,
        arguments: p.arguments,
      })),
    },
    null,
    2
  );
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const PROMPTS = [
  {
    name: "build_media_plan",
    title: "Build a media plan",
    description: "Guided prompt that orchestrates media_plan + supporting tools into a full plan.",
    arguments: [
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: true },
      { name: "budget", description: "Budget in RUB (as text, e.g. '5 000 000')", required: true },
      { name: "goal", description: "awareness | consideration | performance | retention", required: true },
      { name: "geo", description: "Geography", required: true },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, старший медиа-стратег RU/CIS.\n` +
      `Собери медиаплан для категории «${a.category}», бюджет ${a.budget} ₽, цель «${a.goal}», гео «${a.geo}».\n\n` +
      `Шаги:\n` +
      `1) Вызови ru_benchmarks для ключевых KPI категории.\n` +
      `2) Вызови audience_insights, чтобы уточнить сегменты и JTBD.\n` +
      `3) Вызови media_plan со всеми параметрами и используй его прогноз.\n` +
      `4) Если категория регулируемая (pharma/finance) — обязательно покажи compliance-gate.\n` +
      `5) Дай краткое резюме: сплит, прогноз (охват/конверсии/CPA), риски.`,
  },
  {
    name: "full_strategy",
    title: "Full go-to-market strategy (orchestrated)",
    description:
      "One-shot flagship: runs strategy_orchestrate to assemble benchmarks, audience, competitors, a media plan + forecast, an optimized split, a creative concept, compliance and ROI into a single strategy with an executive summary.",
    arguments: [
      { name: "brand", description: "Brand name", required: true },
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: true },
      { name: "budget", description: "Monthly budget in RUB (number)", required: true },
      { name: "goal", description: "awareness | consideration | performance | retention", required: true },
      { name: "geo", description: "Geography", required: true },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, директор по стратегии RU/CIS.\n` +
      `Собери полную go-to-market стратегию для бренда «${a.brand}», категория «${a.category}», ` +
      `бюджет ${a.budget} ₽/мес, цель «${a.goal}», гео «${a.geo}».\n\n` +
      `Шаги:\n` +
      `1) Вызови strategy_orchestrate(brand, category, budget, goal, geo) — это один сквозной вызов, ` +
      `который соберёт бенчмарки, аудиторию, конкурентов, медиаплан с прогнозом, оптимизированный сплит, ` +
      `креативный концепт, комплаенс и ROI.\n` +
      `2) Покажи executiveSummary, затем разверни ключевые блоки (сплит+прогноз, оптимизация, риски/комплаенс).\n` +
      `3) Если есть STOP-GATE (pharma/finance) — явно предупреди про юридическое согласование.\n` +
      `4) Заверши конкретным следующим шагом (book_consultation или request_nectarin_proposal). ` +
      `Помни: данные mock/иллюстративные.`,
  },
  {
    name: "competitor_teardown",
    title: "Competitor teardown",
    description: "Guided prompt that runs competitor_scan + geo_aeo_audit into a teardown.",
    arguments: [
      { name: "brand", description: "Brand to tear down (or a competitor)", required: true },
      { name: "category", description: "Category context", required: true },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence. Сделай разбор конкурентного поля для бренда «${a.brand}» в категории «${a.category}».\n\n` +
      `Шаги:\n` +
      `1) competitor_scan(brand, category) — кто конкуренты, их активность и территории.\n` +
      `2) geo_aeo_audit(brand) — как бренд виден в Яндекс/GigaChat/ChatGPT.\n` +
      `3) category_playbook(category) — территории и комплаенс.\n` +
      `4) Сформулируй 3 угла отстройки и 3 быстрые рекомендации.`,
  },
  {
    name: "sell_nectarin_services",
    title: "Sell NECTARIN services",
    description:
      "Funnel prompt: quantify value, qualify the lead, capture a brief and book a call (roi_calculator → value_forecast → lead_qualify → request_nectarin_proposal → book_consultation).",
    arguments: [
      { name: "company", description: "Company / brand name", required: true },
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: true },
      { name: "monthly_budget", description: "Monthly budget in RUB (number)", required: true },
      { name: "goal", description: "Primary goal, e.g. performance | scale | awareness", required: true },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, консультант по росту. Цель — превратить маркетолога «${a.company}» в клиента NECTARIN, честно показав ценность.\n\n` +
      `Шаги:\n` +
      `1) roi_calculator(monthly_budget=${a.monthly_budget}, category=${a.category}) — покажи улучшение CPA, доп. конверсии и годовую ценность (с методом).\n` +
      `2) value_forecast(brand=${a.company}, budget=${a.monthly_budget}, horizon_months=12, category=${a.category}) — 3 сценария.\n` +
      `3) lead_qualify(company=${a.company}, monthly_budget=${a.monthly_budget}, industry=${a.category}, goal=${a.goal}) — fit-скор и рекомендуемый тариф.\n` +
      `4) Если fit ≥ 50 — предложи request_nectarin_proposal (попроси у пользователя контакт; НЕ выдумывай ПДн) и затем book_consultation.\n` +
      `5) Резюме: ценность в деньгах, тариф, следующий шаг. Будь честен: цифры — иллюстративные, на mock-бенчмарках.`,
  },
  {
    name: "automate_my_marketing",
    title: "Automate my marketing",
    description:
      "Funnel prompt: design the automation NECTARIN can run, justify it with ROI, and book onboarding (automation_recipe → roi_calculator → book_consultation).",
    arguments: [
      { name: "task", description: "weekly_reporting | creative_variants | tender_deck | competitor_monitoring", required: true },
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: false },
      { name: "monthly_budget", description: "Monthly budget in RUB (number, optional — enables ROI framing)", required: false },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence. Предложи и обоснуй автоматизацию маркетинга, которую NECTARIN запустит как управляемый сервис.\n\n` +
      `Шаги:\n` +
      `1) automation_recipe(task=${a.task}) — конкретный воркфлоу: шаги, какие внутренние инструменты, каденс, экономия времени.\n` +
      (a.monthly_budget
        ? `2) roi_calculator(monthly_budget=${a.monthly_budget}, category=${a.category ?? "retail"}) — переведи экономию времени и эффективность в деньги.\n`
        : `2) (Если пользователь назовёт бюджет — вызови roi_calculator для денежного обоснования.)\n`) +
      `3) book_consultation(topic="automation onboarding") — дай CTA и чек-лист подготовки.\n` +
      `4) Резюме: что автоматизируем, какой эффект, как стартовать. Помни: это управляемый сервис NECTARIN.`,
  },
  {
    name: "creative_lab",
    title: "Creative lab (generate → comply → test)",
    description:
      "Generate ad variants, screen them for RU ad-law risk, and plan an A/B test for the winners (creative_variants → compliance_check → ab_test_planner).",
    arguments: [
      { name: "product", description: "Product / offer to advertise", required: true },
      { name: "audience", description: "Target audience", required: true },
      { name: "channel", description: "Channel / platform (e.g. VK Ads, Telegram Ads)", required: true },
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: false },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, перформанс-креативный лид RU/CIS.\n` +
      `Сделай креативную лабораторию для «${a.product}», аудитория «${a.audience}», канал «${a.channel}»` +
      (a.category ? `, категория «${a.category}»` : "") +
      `.\n\n` +
      `Шаги:\n` +
      `1) creative_variants(product, audience, channel${a.category ? ", category" : ""}, count=5) — сгенерируй и оцени варианты.\n` +
      `2) Для 2–3 лучших вызови compliance_check — отсей рискованные формулировки (ФЗ-38/ОРД), при необходимости перепиши.\n` +
      `3) ab_test_planner — рассчитай размер выборки и срок теста для финалистов.\n` +
      `4) Резюме: победители, комплаенс-правки, план теста. Данные иллюстративные.`,
  },
  {
    name: "growth_monitor",
    title: "Growth monitor (anomaly → retention → action)",
    description:
      "Inspect a metric series for anomalies, quantify retention/unit economics, and recommend a next action (anomaly_detector → cohort_ltv + unit_economics).",
    arguments: [
      { name: "metric", description: "Metric label, e.g. 'CPA' or 'CTR'", required: true },
      { name: "series", description: "Comma-separated values oldest→newest, e.g. '100,102,98,…'", required: true },
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: false },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, аналитик роста RU/CIS.\n` +
      `Проведи мониторинг метрики «${a.metric}» по ряду: ${a.series}.\n\n` +
      `Шаги:\n` +
      `1) anomaly_detector(series=[${a.series}], metric="${a.metric}") — найди аномалии и проверь, аномальна ли последняя точка.\n` +
      `2) Если есть всплеск — сформулируй вероятные причины (промо/сезонность — сверься с seasonality_forecast).\n` +
      `3) cohort_ltv и unit_economics — оцени, как это бьёт по экономике (LTV:CAC, окупаемость).\n` +
      `4) Заверши конкретным действием (перераспределить бюджет через budget_optimizer / запустить тест / эскалация).`,
  },
  {
    name: "launch_flight",
    title: "Launch a flight (plan → tag → pace)",
    description:
      "Plan a flight, generate tracking, and set up pacing (media_plan → utm_builder → pacing_monitor + seasonality_forecast).",
    arguments: [
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: true },
      { name: "budget", description: "Flight budget in RUB (number)", required: true },
      { name: "goal", description: "awareness | consideration | performance | retention", required: true },
      { name: "geo", description: "Geography", required: true },
      { name: "landingUrl", description: "Landing page URL to tag (http/https)", required: false },
      { name: "days", description: "Flight length in days (for pacing)", required: false },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, медиа-менеджер запуска RU/CIS.\n` +
      `Запусти флайт: категория «${a.category}», бюджет ${a.budget} ₽, цель «${a.goal}», гео «${a.geo}».\n\n` +
      `Шаги:\n` +
      `1) media_plan(category, budget, goal, geo) — сплит по каналам и прогноз.\n` +
      `2) seasonality_forecast(category) — учти сезонность при распределении по неделям.\n` +
      (a.landingUrl
        ? `3) Для каждого канала собери ссылку utm_builder(url="${a.landingUrl}", source=<канал>, medium=cpc, campaign=<кампания>).\n`
        : `3) Когда будет URL лендинга — собери utm_builder по каждому каналу (source/medium/campaign).\n`) +
      `4) pacing_monitor — задай ориентир дневного расхода` +
      (a.days ? ` на ${a.days} дней` : "") +
      ` и план контроля темпа.\n` +
      `5) Резюме: план, ссылки с UTM, дневной бюджет, что мониторить. Данные иллюстративные.`,
  },
  {
    name: "performance_review",
    title: "Performance review (diagnose → reallocate)",
    description:
      "Diagnose performance and reallocate budget (anomaly_detector → attribution_model → bid_simulator → budget_optimizer).",
    arguments: [
      { name: "category", description: `Industry category (${CATEGORIES.join(", ")})`, required: true },
      { name: "budget", description: "Budget in RUB to reallocate (number)", required: true },
      { name: "goal", description: "awareness | consideration | performance | retention", required: true },
      { name: "metric", description: "Metric to inspect for anomalies, e.g. 'CPA'", required: false },
      { name: "series", description: "Comma-separated metric values oldest→newest (optional)", required: false },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, перформанс-директор RU/CIS.\n` +
      `Проведи разбор эффективности и перераспредели бюджет: категория «${a.category}», бюджет ${a.budget} ₽, цель «${a.goal}».\n\n` +
      `Шаги:\n` +
      (a.series
        ? `1) anomaly_detector(series=[${a.series}], metric="${a.metric ?? "CPA"}") — найди просадки/всплески.\n`
        : `1) Если есть ряд метрики — anomaly_detector, чтобы найти просадки/всплески.\n`) +
      `2) attribution_model — пойми, какие каналы недооценены last-touch (где реальная ценность).\n` +
      `3) bid_simulator(category) — подбери биды под целевой CPA.\n` +
      `4) budget_optimizer(category, budget, goal) — перераспредели в максимизирующий конверсии сплит.\n` +
      `5) Резюме: что чинить, куда перелить бюджет, ожидаемый эффект. Данные иллюстративные.`,
  },
  {
    name: "saturation_reallocation",
    title: "Saturation-aware budget reallocation",
    description:
      "Reallocate budget across channels using diminishing-returns response curves (response_curve), then sanity-check pacing (pacing_monitor).",
    arguments: [
      {
        name: "channels",
        description:
          "Channels with current spend & conversions, e.g. 'Yandex Direct:600000:900, VK Ads:600000:450' (name:spend:conversions)",
        required: true,
      },
      { name: "totalBudget", description: "Total budget to allocate in RUB (optional; default = sum of current spend)", required: false },
      { name: "elasticity", description: "Response elasticity b, 0<b≤1 (optional; default 0.7)", required: false },
    ],
    build: (a: Record<string, string>) =>
      `Ты — NECTARIN Intelligence, performance-аналитик RU/CIS.\n` +
      `Перераспредели бюджет по каналам с учётом убывающей отдачи.\n` +
      `Каналы (name:spend:conversions): ${a.channels}\n` +
      (a.totalBudget ? `Целевой бюджет: ${a.totalBudget} ₽.\n` : `Бюджет: реаллокация текущей суммы.\n`) +
      `\nШаги:\n` +
      `1) Распарси каналы в массив объектов {name, currentSpend, currentConversions}.\n` +
      `2) Вызови response_curve(channels${a.totalBudget ? ", totalBudget" : ""}${a.elasticity ? ", elasticity=" + a.elasticity : ""}).\n` +
      `3) Объясни рекомендованный сплит: где предельный CPA выровнен, какой канал недо/переинвестирован, ожидаемый uplift и улучшение blended CPA.\n` +
      `4) (Опц.) Для канала с самой большой добавкой бюджета вызови pacing_monitor, чтобы проверить реалистичность дневного темпа.\n` +
      `5) Дай чёткую рекомендацию и предупреждение: модель на одной точке калибровки — проверь эластичность b на истории. Данные иллюстративные.`,
  },
];

// ── JSON-RPC method dispatch ─────────────────────────────────────────────────

interface RpcMeta {
  /** Set by handleRpc so the request logger can record which tool ran. */
  tool?: string;
}

/** Candidate values for `completion/complete`, keyed by argument name. */
const COMPLETION_POOLS: Record<string, string[]> = {
  category: [...CATEGORIES],
  kpi: [...KPIS],
  platform: [...PLATFORMS],
  goal: ["awareness", "consideration", "performance", "retention"],
};

async function handleRpc(rpc: JsonRpcRequest, env: Env, meta: RpcMeta = {}): Promise<Response | null> {
  const { id, method, params } = rpc;
  const hasId = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      return rpcResult(id ?? null, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
          resources: { listChanged: false },
          completions: {},
        },
        instructions:
          "NECTARIN Intelligence — orchestrator-worker AI marketing agent for RU/CIS. All data is MOCK/synthetic. Not legal advice.",
      });

    // Notifications carry no id and expect no response body.
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return rpcResult(id ?? null, {});

    case "completion/complete": {
      // Argument autocompletion (MCP). Completes the well-known enum-valued
      // arguments shared across prompts/tools by argument NAME, filtered by the
      // partial value (case-insensitive prefix). Unknown args ⇒ empty list.
      const argName = (params?.argument?.name ?? "") as string;
      const partial = String(params?.argument?.value ?? "").toLowerCase();
      const pool = COMPLETION_POOLS[argName] ?? [];
      const values = pool.filter((v) => v.toLowerCase().startsWith(partial)).slice(0, 100);
      return rpcResult(id ?? null, {
        completion: { values, total: values.length, hasMore: false },
      });
    }

    case "tools/list":
      return rpcResult(id ?? null, {
        tools: ALL_TOOLS.map(describeTool),
      });

    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (typeof name !== "string") {
        return rpcError(id ?? null, INVALID_PARAMS, "tools/call requires a string 'name'.");
      }
      meta.tool = name;
      const tool = TOOLS_BY_NAME[name];
      if (!tool) {
        // Unknown tool → method-not-found family (-32601), per the task spec.
        return rpcError(
          id ?? null,
          METHOD_NOT_FOUND,
          `Unknown tool '${name}'. Known tools: ${ALL_TOOLS.map((t) => t.name).join(", ")}.`
        );
      }
      // Validate arguments against the tool's JSON Schema → -32602 on failure.
      const validation = validateInput(args, tool.inputSchema);
      if (!validation.valid) {
        return rpcError(
          id ?? null,
          INVALID_PARAMS,
          `Invalid params for '${name}': ${formatErrors(validation)}`,
          { errors: validation.errors }
        );
      }
      try {
        const result = await tool.handler(args, env);
        return rpcResult(id ?? null, {
          content: result.content,
          ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}),
          ...(result.isError ? { isError: true } : {}),
        });
      } catch (err) {
        // Tool errors are reported as a successful result with isError=true,
        // per MCP guidance (so the model can see and recover from them). The
        // message is the tool's own Error.message; no stack is exposed.
        console.error(JSON.stringify({ level: "error", scope: "tool", tool: name, message: safeMessage(err) }));
        return rpcResult(id ?? null, {
          content: [{ type: "text", text: `Tool '${name}' failed: ${safeMessage(err)}` }],
          isError: true,
        });
      }
    }

    case "prompts/list":
      return rpcResult(id ?? null, {
        prompts: PROMPTS.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          arguments: p.arguments,
        })),
      });

    case "prompts/get": {
      const name = params?.name;
      const args = (params?.arguments ?? {}) as Record<string, string>;
      const prompt = PROMPTS.find((p) => p.name === name);
      if (!prompt) {
        return rpcError(id ?? null, INVALID_PARAMS, `Unknown prompt '${name}'.`);
      }
      return rpcResult(id ?? null, {
        description: prompt.description,
        messages: [
          { role: "user", content: { type: "text", text: prompt.build(args) } },
        ],
      });
    }

    case "resources/list":
      return rpcResult(id ?? null, {
        resources: RESOURCES.map((r) => ({
          uri: r.uri,
          name: r.name,
          title: r.title,
          description: r.description,
          mimeType: r.mimeType,
        })),
      });

    case "resources/read": {
      const uri = params?.uri;
      const r = RESOURCES.find((x) => x.uri === uri);
      if (!r) {
        return rpcError(id ?? null, INVALID_PARAMS, `Unknown resource '${uri}'.`);
      }
      // The catalog is generated live from the registry so it never goes stale.
      const text = r.uri === "nectarin://catalog" ? buildCatalogJson() : r.text;
      return rpcResult(id ?? null, {
        contents: [{ uri: r.uri, mimeType: r.mimeType, text }],
      });
    }

    default:
      if (!hasId) return null; // unknown notification → ignore.
      return rpcError(id ?? null, METHOD_NOT_FOUND, `Method not found: ${method}`);
  }
}

// ── Observability helpers ────────────────────────────────────────────────────

/** Extract a safe message from an unknown error — never a stack, never PII. */
function safeMessage(err: unknown): string {
  if (err instanceof Error && typeof err.message === "string") return err.message;
  return "unknown error";
}

/**
 * Structured per-request log. No PII: we log the method and (for tools/call) the
 * tool name plus timing/status only — never arguments, tokens, or subjects.
 */
function logRequest(entry: { method: string; tool?: string; ms: number; status: number }): void {
  console.log(
    JSON.stringify({
      level: "info",
      scope: "mcp",
      method: entry.method,
      tool: entry.tool ?? null,
      ms: entry.ms,
      status: entry.status,
    })
  );
}

// ── HTTP entry ───────────────────────────────────────────────────────────────

/**
 * Install the data source, keyed by the KV binding identity. In production every
 * request carries the same binding object, so this installs exactly once. It only
 * re-installs if the binding identity changes (e.g. across tests) — never churns
 * under concurrency with a stable binding.
 */
let installedFor: unknown = Symbol("uninstalled");
// The installed process-global source — reused as the FALLBACK for per-tenant
// sources so tenant lookups resolve: tenant override → global override → mock.
let globalDataSource: DataSource = new MockDataSource();
function ensureDataSource(env: Env): void {
  // Identity covers both bindings so tests that swap envs reinstall correctly.
  const target: unknown = `${env.RATE_LIMITER ? "do" : ""}|${env.NECTARIN_KV ? "kv" : "mock"}`;
  if (installedFor === target) return;
  // Data source: KV-layered real/override data over mock, or pure mock.
  globalDataSource = env.NECTARIN_KV ? new LayeredKvDataSource(env.NECTARIN_KV) : new MockDataSource();
  setDataSource(globalDataSource);
  // Rate limiter precedence: Durable Object (strong) → KV (global, fail-open) →
  // memory (per-isolate). DO falls back to the KV/memory limiter on any error.
  const baseLimiter = env.NECTARIN_KV ? new KvRateLimiter(env.NECTARIN_KV) : new MemoryRateLimiter();
  setRateLimiter(env.RATE_LIMITER ? new DurableObjectRateLimiter(env.RATE_LIMITER, baseLimiter) : baseLimiter);
  installedFor = target;
}

// Tenant id: alphanumerics, dash, underscore, dot; capped length. Anything else
// is rejected (returns undefined ⇒ falls back to the global/shared data).
const TENANT_RE = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Resolve a request-scoped, tenant-specific data source from the `X-Tenant-Id`
 * header. Requires KV (no KV ⇒ no per-tenant overrides possible). The tenant
 * source layers `tenant:<id>:*` KV keys OVER the global source (which itself
 * layers global override KV keys over the bundled mock). Returns undefined when
 * there is no valid tenant or no KV — the caller then uses the shared default.
 */
function resolveTenantDataSource(request: Request, env: Env): DataSource | undefined {
  if (!env.NECTARIN_KV) return undefined;
  const raw = request.headers.get("X-Tenant-Id");
  if (!raw) return undefined;
  const id = raw.trim();
  if (!TENANT_RE.test(id)) return undefined;
  return new LayeredKvDataSource(env.NECTARIN_KV, globalDataSource, `tenant:${id}:`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource`;

    // Wire the KV-layered data source (real/override benchmarks over mock) once.
    // Absent binding ⇒ stays on the bundled synthetic data. Idempotent.
    ensureDataSource(env);

    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health probe.
    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        status: "ok",
        server: SERVER_NAME,
        version: SERVER_VERSION,
        tools: ALL_TOOLS.length,
        kv: env.NECTARIN_KV ? "bound" : "unbound",
        dataSource: env.NECTARIN_KV ? "kv-layered" : "mock",
        perTenant: env.NECTARIN_KV ? "header:X-Tenant-Id (tenant→global→mock)" : "disabled(no-kv)",
        rateLimiter: rateLimiterBackend(env),
        llmCache: getLlmCacheStats(),
      });
    }

    // Version / build info (observability).
    if (url.pathname === "/version" && request.method === "GET") {
      return json({
        name: SERVER_NAME,
        version: SERVER_VERSION,
        protocolVersion: PROTOCOL_VERSION,
        toolCount: ALL_TOOLS.length,
        commit: (env.GIT_COMMIT && env.GIT_COMMIT.trim()) || "dev",
        authMode: authMode(env),
        kv: env.NECTARIN_KV ? "bound" : "unbound",
        perTenant: env.NECTARIN_KV ? "header:X-Tenant-Id (tenant→global→mock)" : "disabled(no-kv)",
        rateLimiter: rateLimiterBackend(env),
        llmCache: getLlmCacheStats(),
      });
    }

    // OAuth protected-resource metadata (discovery).
    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return json({
        resource: (env.OAUTH_AUDIENCE && env.OAUTH_AUDIENCE.trim()) || `${origin}/mcp`,
        authorization_servers: [
          (env.OAUTH_ISSUER && env.OAUTH_ISSUER.trim()) || "https://auth.unyly.com/",
        ],
        bearer_methods_supported: ["header"],
        scopes_supported: ["mcp:tools"],
      });
    }

    // Friendly root.
    if (url.pathname === "/" && request.method === "GET") {
      return json({
        server: SERVER_NAME,
        version: SERVER_VERSION,
        mcp_endpoint: `${origin}/mcp`,
        health: `${origin}/health`,
        version_info: `${origin}/version`,
        discovery: resourceMetadataUrl,
        note: "POST JSON-RPC 2.0 to /mcp. Data is MOCK/synthetic.",
      });
    }

    // MCP endpoint.
    if (url.pathname === "/mcp") {
      if (request.method === "GET") {
        // Stateless server: no server-initiated SSE stream over GET.
        return json({ error: "Use POST for JSON-RPC. GET SSE stream is not supported in stateless mode." }, 405);
      }
      if (request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const started = Date.now();

      // OAuth 2.1 bearer verification (jose JWKS). Unyly Connect fronts the real
      // OAuth flow in production; this resource server only validates the token.
      const auth = await authenticate(request, env);
      if (!auth.authenticated) {
        logRequest({ method: "auth", ms: Date.now() - started, status: 401 });
        return unauthorizedResponse(resourceMetadataUrl, CORS_HEADERS, auth.error ?? "invalid_token");
      }

      // Rate limiting (per-token, falling back to per-IP). 429 + Retry-After.
      const rl = await enforceRateLimit(request, env, auth.subject);
      if (!rl.allowed) {
        logRequest({ method: "rate_limit", ms: Date.now() - started, status: 429 });
        return rpcError(
          null,
          RATE_LIMITED,
          `Rate limit exceeded (${rl.limit}/min). Retry in ${rl.retryAfterSec}s.`,
          { retryAfterSec: rl.retryAfterSec, limit: rl.limit },
          429,
          {
            "Retry-After": String(rl.retryAfterSec),
            "X-RateLimit-Limit": String(rl.limit),
            "X-RateLimit-Remaining": String(rl.remaining),
          }
        );
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        logRequest({ method: "(parse)", ms: Date.now() - started, status: 400 });
        return rpcError(null, PARSE_ERROR, "Invalid JSON.");
      }

      // Per-tenant data source (request-scoped via AsyncLocalStorage). When a
      // valid X-Tenant-Id + KV are present, tool data resolves tenant → global →
      // mock; otherwise withTenant is a passthrough using the shared default.
      const tenantDs = resolveTenantDataSource(request, env);
      const withTenant = <T>(fn: () => Promise<T>): Promise<T> =>
        tenantDs ? runWithDataSource(tenantDs, fn) : fn();

      // Batch request support.
      if (Array.isArray(payload)) {
        const responses: any[] = [];
        for (const item of payload) {
          if (!isValidRpc(item)) {
            responses.push({ jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "Invalid Request" } });
            continue;
          }
          try {
            const res = await withTenant(() => handleRpc(item as JsonRpcRequest, env));
            if (res) responses.push(await res.json());
          } catch (err) {
            console.error(JSON.stringify({ level: "error", scope: "mcp", message: safeMessage(err) }));
            responses.push({
              jsonrpc: "2.0",
              id: (item as JsonRpcRequest).id ?? null,
              error: { code: INTERNAL_ERROR, message: "Internal error." },
            });
          }
        }
        logRequest({ method: "batch", ms: Date.now() - started, status: 200 });
        // If every item was a notification, return 202 with no body.
        if (responses.length === 0) return new Response(null, { status: 202, headers: CORS_HEADERS });
        return json(responses);
      }

      if (!isValidRpc(payload)) {
        logRequest({ method: "(invalid)", ms: Date.now() - started, status: 400 });
        return rpcError(null, INVALID_REQUEST, "Invalid Request");
      }

      const meta: RpcMeta = {};
      const method = (payload as JsonRpcRequest).method;
      const sse = wantsSse(url, request);
      try {
        const res = await withTenant(() => handleRpc(payload as JsonRpcRequest, env, meta));
        // Notification → no response body.
        if (!res) {
          logRequest({ method, tool: meta.tool, ms: Date.now() - started, status: 202 });
          return new Response(null, { status: 202, headers: CORS_HEADERS });
        }
        // Opt-in SSE: re-emit the JSON-RPC body as a single SSE frame.
        if (sse) {
          const obj = await res.json();
          logRequest({ method, tool: meta.tool, ms: Date.now() - started, status: 200 });
          return sseResponse(obj);
        }
        logRequest({ method, tool: meta.tool, ms: Date.now() - started, status: res.status });
        return res;
      } catch (err) {
        // Safe internal error: log details server-side, return a generic message.
        console.error(JSON.stringify({ level: "error", scope: "mcp", method, tool: meta.tool, message: safeMessage(err) }));
        logRequest({ method, tool: meta.tool, ms: Date.now() - started, status: 200 });
        return rpcError((payload as JsonRpcRequest).id ?? null, INTERNAL_ERROR, "Internal error.");
      }
    }

    return json({ error: "Not found. MCP endpoint is POST /mcp." }, 404);
  },
};

function isValidRpc(v: unknown): v is JsonRpcRequest {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as any).jsonrpc === "2.0" &&
    typeof (v as any).method === "string"
  );
}

/** Human-readable label for the active rate-limit backend (observability). */
function rateLimiterBackend(env: Env): string {
  if (env.RATE_LIMITER) return "durable-object(strong, fail-open)";
  if (env.NECTARIN_KV) return "kv-global(fail-open)";
  return "memory";
}

/**
 * Durable Object: one instance per rate-limit key owns a single token bucket.
 * Because a DO is single-threaded and globally unique per id, the count is
 * exact even under a parallel burst — the strong-consistency guarantee KV lacks.
 * State is in-memory (resets if the DO is evicted, which is fine for limiting).
 *
 * Bound via wrangler.toml ([[durable_objects.bindings]] + [[migrations]]).
 */
export class RateLimiterDO {
  private tokens: number | null = null;
  private updated = 0;
  // Cloudflare constructs this with (state, env); we don't need either here.
  constructor(_state?: unknown, _env?: unknown) {}

  async fetch(request: Request): Promise<Response> {
    let limitPerMin = 60;
    try {
      const body = (await request.json()) as { limitPerMin?: number };
      if (Number.isFinite(body?.limitPerMin)) limitPerMin = Number(body.limitPerMin);
    } catch {
      /* default */
    }
    const capacity = limitPerMin;
    const refillPerMs = limitPerMin / 60_000;
    const now = Date.now();
    if (this.tokens === null) {
      this.tokens = capacity;
      this.updated = now;
    } else {
      const elapsed = Math.max(0, now - this.updated);
      this.tokens = Math.min(capacity, this.tokens + elapsed * refillPerMs);
      this.updated = now;
    }
    let result;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      result = { allowed: true, limit: capacity, remaining: Math.floor(this.tokens), retryAfterSec: 0 };
    } else {
      const deficit = 1 - this.tokens;
      const retryAfterSec = Math.max(1, Math.ceil(deficit / refillPerMs / 1000));
      result = { allowed: false, limit: capacity, remaining: 0, retryAfterSec };
    }
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  }
}
