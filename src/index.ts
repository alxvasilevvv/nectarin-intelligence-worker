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

import { ALL_TOOLS, TOOLS_BY_NAME } from "./tools.js";
import { CATEGORIES } from "./data.js";
import { authenticate, unauthorizedResponse, authMode } from "./auth.js";
import { enforceRateLimit } from "./ratelimit.js";
import { validateInput, formatErrors } from "./validate.js";

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
  // Future bindings (see commented sections in wrangler.toml):
  // NECTARIN_KV?: KVNamespace;
  // NECTARIN_DB?: D1Database;
}

const SERVER_NAME = "nectarin-intelligence";
const SERVER_VERSION = "1.1.0";
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
];

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
];

// ── JSON-RPC method dispatch ─────────────────────────────────────────────────

interface RpcMeta {
  /** Set by handleRpc so the request logger can record which tool ran. */
  tool?: string;
}

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

    case "tools/list":
      return rpcResult(id ?? null, {
        tools: ALL_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
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
      return rpcResult(id ?? null, {
        contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }],
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = `${url.protocol}//${url.host}`;
    const resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource`;

    // ── To go live on real data, wire the data source ONCE here, e.g.:
    //     setDataSource(new KvDataSource(env.NECTARIN_KV));
    //   (import setDataSource/KvDataSource from "./data.js"). Default = mock.
    // ── For globally-coordinated rate limits, install a KV/DO limiter here, e.g.:
    //     setRateLimiter(new KvRateLimiter(env.NECTARIN_KV));

    // CORS preflight.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health probe.
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ status: "ok", server: SERVER_NAME, version: SERVER_VERSION, tools: ALL_TOOLS.length });
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

      // Batch request support.
      if (Array.isArray(payload)) {
        const responses: any[] = [];
        for (const item of payload) {
          if (!isValidRpc(item)) {
            responses.push({ jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "Invalid Request" } });
            continue;
          }
          try {
            const res = await handleRpc(item as JsonRpcRequest, env);
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
      try {
        const res = await handleRpc(payload as JsonRpcRequest, env, meta);
        // Notification → no response body.
        if (!res) {
          logRequest({ method, tool: meta.tool, ms: Date.now() - started, status: 202 });
          return new Response(null, { status: 202, headers: CORS_HEADERS });
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
