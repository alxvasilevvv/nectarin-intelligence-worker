/**
 * FEDERATION tool group (v2.52) for NECTARIN Intelligence — Workers.
 *
 * Phase C of the roadmap: NECTARIN is the marketing HUB; the best specialist MCP
 * servers in the world are added AROUND it — and always THROUGH Unyly. `mcp_federation`
 * is the discovery + routing layer: it knows which external MCPs complement NECTARIN
 * (live keyword data, web analytics, ad-platform pulls, creative generation, social
 * listening, CRM, scraping, translation…), what each one adds, which native NECTARIN
 * tools it pairs with, and returns a tracked Unyly connect link for each — so every
 * install and every request flows through unyly.org (the metering & billing point).
 *
 * What this DOES: discovery, capability/goal/role routing, tracked Unyly connect links,
 * and (when `UNYLY_GATEWAY_TOKEN` is set) runtime proxying via the live Unyly gateway
 * at `https://gateway.unyly.org/mcp/<slug>` — one token, zero per-server URL config.
 * Per-server `FED_<KEY>_URL` overrides still work for backward compatibility.
 */

import type { ToolDef, ToolResult } from "./tools.js";
import type { Env } from "./index.js";

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

const DEFAULT_MARKETPLACE = "https://unyly.org/ru/mcp";
const DEFAULT_GATEWAY_URL = "https://gateway.unyly.org";

function gatewayBase(env: Env | undefined): string {
  return (env?.UNYLY_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
}

function gatewayToken(env: Env | undefined): string {
  const rec = env as unknown as Record<string, string | undefined> | undefined;
  return (rec?.UNYLY_GATEWAY_TOKEN ?? rec?.FED_GATEWAY_TOKEN ?? "").trim();
}

function gatewayUrlForSlug(env: Env | undefined, slug: string): string | null {
  const token = gatewayToken(env);
  if (!token || !slug) return null;
  return `${gatewayBase(env)}/mcp/${slug}`;
}

/** Resolve federated endpoint: per-server override wins, else Unyly gateway when token set. */
function resolveFedEndpoint(
  env: Env | undefined,
  s: FederatedServer
): { url: string; token: string; via: "override" | "gateway" } | null {
  const envRec = env as unknown as Record<string, string | undefined>;
  const overrideUrl = (envRec[`FED_${s.key.toUpperCase()}_URL`] ?? "").trim();
  if (overrideUrl) {
    return {
      url: overrideUrl,
      token: (envRec[`FED_${s.key.toUpperCase()}_TOKEN`] ?? "").trim(),
      via: "override",
    };
  }
  const gwUrl = gatewayUrlForSlug(env, s.slug);
  if (gwUrl) return { url: gwUrl, token: gatewayToken(env), via: "gateway" };
  return null;
}

/** Build a tracked Unyly connect link for a federated server (traffic attribution). */
function trackedConnectUrl(marketplace: string, slug: string, partnerId: string, source: string): string {
  const base = `${marketplace.replace(/\/+$/, "")}/${slug}`;
  const params: Array<[string, string]> = [
    ["utm_source", source || "mcp_federation"],
    ["utm_medium", "mcp_connector"],
    ["utm_campaign", "federation"],
    ["via", partnerId || "nectarin"],
    ["hub", "nectarin-intelligence"],
  ];
  return `${base}?${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}

interface FederatedServer {
  key: string;
  name: string;
  category: string;
  /** What NEW value it adds on top of NECTARIN's native (mostly mock/planning) tools. */
  adds: string;
  capabilities: string[];
  /** Native NECTARIN tools this server feeds / pairs with. */
  pairsWith: string[];
  roles: string[];
  /** Unyly marketplace slug. */
  slug: string;
  status: "available" | "coming_soon";
}

/**
 * Illustrative federation catalogue. These are the CLASSES of specialist MCPs that
 * complement NECTARIN; the actual listings live on the Unyly marketplace (the owner
 * curates them). Each provides live/generative capability NECTARIN intentionally does
 * not bundle (NECTARIN ships deterministic models on mock/your data).
 */
const SERVERS: FederatedServer[] = [
  {
    key: "keyword_data",
    name: "Keyword & SERP Data",
    category: "SEO / Search",
    adds: "Живые объёмы запросов, позиции и SERP-фичи (то, что NECTARIN считает по ВАШИМ ключам — теперь с реальными данными).",
    capabilities: ["search volume", "rank tracking", "SERP features", "keyword ideas"],
    pairsWith: ["seo_opportunity", "search_planner", "content_plan_roi"],
    roles: ["SEO", "Контент"],
    slug: "keyword-data",
    status: "available",
  },
  {
    key: "web_analytics",
    name: "Web Analytics Connector",
    category: "Analytics",
    adds: "Подключение GA4 / Яндекс.Метрики: реальные сессии, конверсии, источники — на вход моделям воронки и атрибуции.",
    capabilities: ["GA4", "Yandex Metrica", "events", "conversions", "channels"],
    pairsWith: ["funnel_model", "utm_taxonomy_qa", "landing_cro_audit"],
    roles: ["Аналитик", "Marketing Ops", "Перформанс"],
    slug: "web-analytics",
    status: "available",
  },
  {
    key: "ad_platforms",
    name: "Ad Platforms Live (Direct / VK)",
    category: "Paid Media",
    adds: "Живые выгрузки из Яндекс.Директ / VK Ads: фактический spend, показы, CPA — вместо mock-бенчмарков.",
    capabilities: ["Yandex Direct", "VK Ads", "spend", "impressions", "live CPA"],
    pairsWith: ["budget_optimizer", "response_curve", "budget_pacing_forecast", "mmm_optimize"],
    roles: ["Перформанс", "Медиапленер"],
    slug: "ad-platforms-live",
    status: "available",
  },
  {
    key: "creative_gen",
    name: "Creative Generation",
    category: "Creative",
    adds: "Генерация изображений / видео / текстов под бренд — продакшн концептов, которые NECTARIN оценивает и тестирует.",
    capabilities: ["image gen", "video gen", "copy gen", "brand styles"],
    pairsWith: ["creative_variants", "creative_testing_matrix", "production_estimator"],
    roles: ["Креатив", "SMM"],
    slug: "creative-generation",
    status: "available",
  },
  {
    key: "social_listening",
    name: "Social Listening",
    category: "Social / PR",
    adds: "Живые упоминания, тональность и доля голоса из соцсетей и медиа — на вход PR- и SOV-моделям.",
    capabilities: ["mentions", "sentiment", "share of voice", "trends"],
    pairsWith: ["pr_value_estimator", "sov_tracker", "share_of_search"],
    roles: ["PR", "SMM", "Бренд"],
    slug: "social-listening",
    status: "available",
  },
  {
    key: "crm_data",
    name: "CRM Data Connector",
    category: "CRM / Retention",
    adds: "Подключение CRM (amoCRM / Bitrix24 и др.): реальные сделки, когорты и RFM на вход моделям удержания.",
    capabilities: ["deals", "cohorts", "RFM inputs", "LTV inputs"],
    pairsWith: ["rfm_segmenter", "churn_predictor", "cohort_retention_curve", "email_campaign_planner"],
    roles: ["CRM", "Продукт / GTM"],
    slug: "crm-data",
    status: "available",
  },
  {
    key: "marketplace_data",
    name: "Marketplace Data (Ozon / WB)",
    category: "E-commerce",
    adds: "Живые данные Ozon / Wildberries / Я.Маркет: продажи, ставки ритейл-медиа, ДРР — для масштабирования продаж.",
    capabilities: ["sales", "retail media bids", "ДРР", "stock"],
    pairsWith: ["retail_media_planner", "price_optimizer", "promo_planner"],
    roles: ["Маркетплейсы", "Цена / промо"],
    slug: "marketplace-data",
    status: "coming_soon",
  },
  {
    key: "localization",
    name: "Localization / Translation",
    category: "Content / Global",
    adds: "Перевод и локализация кампаний и креатива под СНГ-рынки с сохранением смысла и комплаенса.",
    capabilities: ["translation", "transcreation", "locale QA"],
    pairsWith: ["content_plan_roi", "compliance_check", "creative_variants"],
    roles: ["Контент", "Бренд"],
    slug: "localization",
    status: "coming_soon",
  },
];

function scoreServer(s: FederatedServer, q: string): number {
  const hay = [s.name, s.category, s.adds, ...s.capabilities, ...s.pairsWith, ...s.roles, s.key]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const token of q.split(/[\s,]+/).filter((t) => t.length >= 3)) {
    if (hay.includes(token)) score++;
  }
  return score;
}

const mcpFederation: ToolDef = {
  name: "mcp_federation",
  description:
    "FEDERATION / marketplace router — NECTARIN is the marketing hub; the best specialist MCP servers are added around it, always through Unyly. With NO arguments it lists the catalogue of complementary external MCPs (live keyword data, web analytics, ad-platform pulls, creative generation, social listening, CRM data, marketplace data, localization) with what each adds and which native NECTARIN tools it pairs with. Given a `capability`/`goal`/`role` it recommends the right servers; given a `server` key it returns details. Every entry includes a tracked Unyly connect link so installs & consumption flow through unyly.org (the metering/billing point). Discovery + routing + links only — no PII, no network call; runtime proxying is brokered by the Unyly gateway.",
  inputSchema: {
    type: "object",
    properties: {
      server: { type: "string", description: "A server key for details, e.g. 'keyword_data', 'web_analytics'" },
      capability: { type: "string", description: "A capability you need, e.g. 'rank tracking', 'GA4', 'image gen'" },
      goal: { type: "string", description: "Free-text goal (RU/EN), e.g. 'нужны живые данные Директа'" },
      role: { type: "string", description: "Optional role to tailor recommendations, e.g. 'SEO', 'аналитик'" },
      source: { type: "string", description: "Optional attribution label folded into utm_source (default 'mcp_federation')" },
    },
    additionalProperties: false,
  },
  async handler(input, env) {
    const marketplace = (env?.UNYLY_MARKETPLACE_URL && env.UNYLY_MARKETPLACE_URL.trim()) || DEFAULT_MARKETPLACE;
    const partnerId = env?.UNYLY_PARTNER_ID || "nectarin";
    const source = typeof input?.source === "string" && input.source.trim() ? input.source.trim() : "mcp_federation";

    const link = (s: FederatedServer) => trackedConnectUrl(marketplace, s.slug, partnerId, source);
    const gw = gatewayBase(env);
    const view = (s: FederatedServer) => ({
      server: s.key,
      name: s.name,
      category: s.category,
      status: s.status,
      adds: s.adds,
      capabilities: s.capabilities,
      pairsWith: s.pairsWith,
      roles: s.roles,
      gatewayUrl: `${gw}/mcp/${s.slug}`,
      connectViaUnyly: link(s),
    });

    const governance = {
      principle: "NECTARIN — хаб; внешние MCP подключаются вокруг него и ТОЛЬКО через Unyly.",
      why: "Через Unyly Connect (OAuth 2.1) проходит каждый запрос — это единая точка доступа, изоляции, измерения трафика и тарификации потребления.",
      runtime:
        "Discovery + маршрутизация + трекнутые ссылки. Рантайм-прокси через шлюз Unyly (`UNYLY_GATEWAY_TOKEN` → `gateway.unyly.org/mcp/<slug>`) или per-server `FED_<KEY>_URL`.",
    };

    // 1) Specific server.
    const serverKey = typeof input?.server === "string" ? input.server.trim().toLowerCase() : "";
    if (serverKey) {
      const s = SERVERS.find((x) => x.key === serverKey);
      if (!s) {
        const payload = { tool: "mcp_federation", matched: false, query: serverKey, available: SERVERS.map((x) => x.key) };
        return toContent(`Сервер «${serverKey}» не найден. Доступно: ${SERVERS.map((x) => x.key).join(", ")}.`, payload);
      }
      const payload = { tool: "mcp_federation", matched: true, server: view(s), governance };
      return toContent(`${s.name}: ${s.adds} Подключение через Unyly: ${link(s)}`, payload);
    }

    // 2) Capability / goal / role routing.
    const query = [input?.capability, input?.goal, input?.role]
      .filter((x) => typeof x === "string" && x.trim())
      .join(" ")
      .toLowerCase();
    if (query) {
      const ranked = SERVERS.map((s) => ({ s, score: scoreServer(s, query) }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .map((r) => view(r.s));
      const recommendations = ranked.length ? ranked : SERVERS.map(view);
      const payload = {
        tool: "mcp_federation",
        query,
        matched: ranked.length > 0,
        recommendations,
        governance,
        cta: "Подключите рекомендованный сервер через Unyly (ссылка в connectViaUnyly), затем используйте его данные на вход парным инструментам NECTARIN.",
      };
      const top = recommendations[0];
      return toContent(
        `Под запрос «${query}» рекомендую: ${recommendations.slice(0, 3).map((r: any) => r.name).join(", ")}. ` +
          `Старт: ${top?.name} → ${top?.connectViaUnyly}`,
        payload
      );
    }

    // 3) Full catalogue.
    const byCategory: Record<string, ReturnType<typeof view>[]> = {};
    for (const s of SERVERS) (byCategory[s.category] ||= []).push(view(s));
    const payload = {
      tool: "mcp_federation",
      count: SERVERS.length,
      available: SERVERS.filter((s) => s.status === "available").length,
      catalog: SERVERS.map(view),
      byCategory,
      governance,
      howTo: "Вызовите mcp_federation(capability=\"...\") или (goal=\"...\") для рекомендаций, либо (server=\"<key>\") для деталей.",
    };
    return toContent(
      `Федерация MCP: ${SERVERS.length} специализированных сервера вокруг NECTARIN — все подключаются через Unyly.`,
      payload
    );
  },
};

/**
 * Runtime proxy to an external federated MCP — fail-CLOSED. Calls out when either:
 *   1) `FED_<KEY>_URL` (+ optional `FED_<KEY>_TOKEN`) is set for that server, OR
 *   2) `UNYLY_GATEWAY_TOKEN` (or `FED_GATEWAY_TOKEN`) is set → `{gateway}/mcp/{slug}`.
 * The user only picks a server KEY from the known registry (no arbitrary URL ⇒ no SSRF).
 * Without config it returns a tracked Unyly connect link and does NO network call.
 */
async function callExternalMcp(
  url: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
  timeoutMs = 8000
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return { ok: false, error: `upstream_http_${res.status}` };
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body && body.error) {
      return { ok: false, error: typeof body.error.message === "string" ? body.error.message : "upstream_error" };
    }
    return { ok: true, result: body?.result };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, error: name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

const federationInvoke: ToolDef = {
  name: "federation_invoke",
  description:
    "FEDERATION runtime — call a tool on a federated external MCP server THROUGH NECTARIN (the hub). Fail-closed: reaches out when `UNYLY_GATEWAY_TOKEN` is set (calls `gateway.unyly.org/mcp/<slug>` with one token for all servers) or when per-server `FED_<KEY>_URL` is set (override). You pick a `server` from the mcp_federation catalogue and the external `tool` name + `arguments`; NECTARIN proxies a single JSON-RPC tools/call and returns the result. If neither gateway token nor per-server URL is configured, it returns a tracked Unyly connect link and makes NO network call. No arbitrary URLs (only known registry keys) — traffic flows through Unyly-brokered endpoints.",
  inputSchema: {
    type: "object",
    properties: {
      server: { type: "string", description: "Federated server key from mcp_federation, e.g. 'keyword_data'" },
      tool: { type: "string", description: "Tool name to call on that external MCP server" },
      arguments: { type: "object", description: "Arguments object to pass to the external tool", additionalProperties: true },
    },
    required: ["server"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const marketplace = (env?.UNYLY_MARKETPLACE_URL && env.UNYLY_MARKETPLACE_URL.trim()) || DEFAULT_MARKETPLACE;
    const partnerId = env?.UNYLY_PARTNER_ID || "nectarin";
    const serverKey = typeof input?.server === "string" ? input.server.trim().toLowerCase() : "";
    const s = SERVERS.find((x) => x.key === serverKey);
    if (!s) {
      return {
        content: [{ type: "text", text: `Сервер «${serverKey}» не найден. Доступно: ${SERVERS.map((x) => x.key).join(", ")}.` }],
        structuredContent: { tool: "federation_invoke", matched: false, available: SERVERS.map((x) => x.key) },
        isError: true,
      };
    }
    const connect = trackedConnectUrl(marketplace, s.slug, partnerId, "federation_invoke");
    const endpoint = resolveFedEndpoint(env, s);

    if (!endpoint) {
      return toContent(
        `«${s.name}» ещё не подключён. Подключите через Unyly: ${connect}`,
        {
          tool: "federation_invoke",
          server: s.key,
          configured: false,
          connectViaUnyly: connect,
          gatewayUrl: `${gatewayBase(env)}/mcp/${s.slug}`,
          note:
            "Рантайм-вызов включается при UNYLY_GATEWAY_TOKEN (один токен → gateway.unyly.org/mcp/<slug>) или per-server FED_<KEY>_URL. Health: GET …/mcp/ping.",
        }
      );
    }
    const { url, token, via } = endpoint;

    const toolName = typeof input?.tool === "string" ? input.tool.trim() : "";
    if (!toolName) {
      return {
        content: [{ type: "text", text: `Укажите параметр tool — имя инструмента сервера «${s.name}».` }],
        structuredContent: { tool: "federation_invoke", server: s.key, configured: true, via, error: "missing_tool" },
        isError: true,
      };
    }
    const args = isRecord(input?.arguments) ? (input.arguments as Record<string, unknown>) : {};

    const out = await callExternalMcp(url, token, toolName, args);
    if (!out.ok) {
      const pingUrl = `${gatewayBase(env)}/mcp/ping`;
      return {
        content: [{ type: "text", text: `Ошибка вызова ${s.name}.${toolName}: ${out.error}` }],
        structuredContent: {
          tool: "federation_invoke",
          server: s.key,
          configured: true,
          via,
          ok: false,
          error: out.error,
          ...(via === "gateway" ? { gatewayPing: pingUrl, hint: `Check gateway health: GET ${pingUrl}` } : {}),
        },
        isError: true,
      };
    }
    return toContent(`${s.name}.${toolName} → ответ получен через федерацию (Unyly-брокеринг).`, {
      tool: "federation_invoke",
      server: s.key,
      toolCalled: toolName,
      configured: true,
      via,
      ok: true,
      upstreamResult: out.result,
    });
  },
};

export const FEDERATION_TOOLS: ToolDef[] = [mcpFederation, federationInvoke];
