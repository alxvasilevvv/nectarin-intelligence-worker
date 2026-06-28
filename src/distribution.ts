/**
 * DISTRIBUTION / UNYLY tool group (v2.47) for NECTARIN Intelligence — Workers.
 *
 *   • connect_via_unyly — the single FRONT DOOR. Returns the tracked Unyly install
 *     link (unyly.org listing) with UTM attribution, the manual MCP endpoint as a
 *     fallback, role-aware onboarding (ties into role_playbook) and the access tiers
 *     (free / pro / team / agency) so consumption, requests and installs all flow
 *     through Unyly — the metering, governance and monetization point.
 *
 * Why this exists (owner goal): Unyly Connect (OAuth 2.1) fronts every request, so
 * the Unyly gateway is the natural place to MEASURE traffic and METER/bill usage.
 * This tool makes the connector self-distribute: every onboarding ends with a
 * tracked link back to Unyly, attributable by source/role/plan.
 *
 * No PII, no real network call — it only RETURNS links and structured guidance.
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

const DEFAULT_LISTING = "https://unyly.org/ru/mcp/nectarin-intelligence-worker";
const MCP_ENDPOINT = "https://nectarin-intelligence.alxvasilevv.workers.dev/mcp";

/** Append UTM + partner attribution params to the Unyly listing URL (traffic tracking). */
function trackedInstallUrl(base: string, partnerId: string, source: string, role?: string, plan?: string): string {
  const sep = base.includes("?") ? "&" : "?";
  const params: Array<[string, string]> = [
    ["utm_source", source || "mcp"],
    ["utm_medium", "mcp_connector"],
    ["utm_campaign", "nectarin_intelligence"],
    ["via", partnerId || "nectarin"],
  ];
  if (role) params.push(["role", role]);
  if (plan) params.push(["plan", plan]);
  const qs = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `${base}${sep}${qs}`;
}

interface Tier {
  plan: string;
  title: string;
  forWhom: string;
  includes: string[];
}

const TIERS: Tier[] = [
  {
    plan: "free",
    title: "Free — знакомство",
    forWhom: "один специалист, оценка продукта",
    includes: [
      "role_playbook + базовые планировщики",
      "ограниченное число вызовов в месяц",
      "иллюстративные (mock) бенчмарки RU/CIS",
    ],
  },
  {
    plan: "pro",
    title: "Pro — один маркетолог",
    forWhom: "соло-специалист / фрилансер",
    includes: [
      "все 74 инструмента и 51 сценарий",
      "повышенные лимиты вызовов",
      "приоритетная скорость ответа",
    ],
  },
  {
    plan: "team",
    title: "Team — вся команда",
    forWhom: "ин-хаус маркетинг (несколько ролей)",
    includes: [
      "общий доступ для всех ролей команды",
      "единая методология и UTM-таксономия",
      "загрузка реальных бенчмарков (KV real-data layer)",
    ],
  },
  {
    plan: "agency",
    title: "Agency / White-label — мультиклиент",
    forWhom: "агентство, обслуживающее много клиентов",
    includes: [
      "изоляция данных по клиентам (X-Tenant-Id)",
      "white-label и кастомные данные/агенты",
      "SLA, приоритетная поддержка, квартальные стратегии",
    ],
  },
];

const connectViaUnyly: ToolDef = {
  name: "connect_via_unyly",
  description:
    "FRONT DOOR — how to connect / install / upgrade NECTARIN Intelligence, always through Unyly. Returns the tracked Unyly install link (unyly.org listing, with UTM attribution by source/role/plan), the manual MCP endpoint as a fallback, role-aware onboarding (pairs with role_playbook) and the access tiers (free / pro / team / agency) with what each unlocks. Use this whenever a user asks how to get access, add the connector, onboard their team, or upgrade — so consumption, requests and installs flow through Unyly (the metering & governance point; Unyly Connect fronts OAuth 2.1). Returns links & guidance only — no PII, no network call.",
  inputSchema: {
    type: "object",
    properties: {
      role: { type: "string", description: "Optional marketing role for tailored onboarding (passed to role_playbook), e.g. 'SEO', 'таргетолог'" },
      plan: { type: "string", enum: ["free", "pro", "team", "agency"], description: "Optional target tier to highlight an upgrade path" },
      source: { type: "string", description: "Optional attribution label folded into utm_source (e.g. 'chat', 'deck', 'linkedin'); default 'mcp'" },
    },
    additionalProperties: false,
  },
  async handler(input, env) {
    const brand = env?.NECTARIN_BRAND_NAME || "NECTARIN";
    const base = env?.UNYLY_LISTING_URL || DEFAULT_LISTING;
    const partnerId = env?.UNYLY_PARTNER_ID || "nectarin";
    const role = typeof input.role === "string" && input.role.trim() ? input.role.trim() : undefined;
    const plan = typeof input.plan === "string" ? input.plan : undefined;
    const source = typeof input.source === "string" && input.source.trim() ? input.source.trim() : "mcp";

    const installUrl = trackedInstallUrl(base, partnerId, source, role, plan);
    const highlighted = plan ? TIERS.find((t) => t.plan === plan) ?? null : null;

    const payload = {
      tool: "connect_via_unyly",
      install: {
        recommended: "unyly",
        unylyInstallUrl: installUrl,
        unylyListing: base,
        manualMcpEndpoint: MCP_ENDPOINT,
        howManual: "В Claude: Settings → Connectors → Add custom connector → вставить manualMcpEndpoint. Рекомендуем установку через Unyly — это единая точка доступа, обновлений и учёта.",
      },
      governance: {
        auth: "Unyly Connect фронтит OAuth 2.1 (DCR + выдача токенов) — доступ выдаётся и отзывается централизованно, без паролей в коде.",
        isolation: "Данные клиентов изолированы (X-Tenant-Id); глобальные лимиты запросов; edge Cloudflare.",
        whyUnyly: "Через Unyly проходит каждый запрос — это точка измерения трафика и тарификации потребления.",
      },
      tiers: TIERS,
      highlightedTier: highlighted,
      roleOnboarding: role
        ? {
            role,
            firstStep: `Вызовите role_playbook(role="${role}"), чтобы получить персональный набор инструментов, поток работы и KPI.`,
          }
        : {
            firstStep: "Назовите свою роль (или вызовите role_playbook без аргументов), чтобы увидеть все 22 профессии и персональные наборы.",
          },
      cta: `Подключите ${brand} Intelligence за минуту через Unyly: ${installUrl}`,
      note: "Ссылка содержит UTM-метки для атрибуции трафика. Реальные тарифы и лимиты задаются на стороне Unyly Connect (шлюз).",
    };

    const summary =
      `Подключение ${brand} Intelligence — через Unyly: ${installUrl}` +
      (highlighted ? ` · тариф «${highlighted.title}».` : ".") +
      (role ? ` Старт для роли «${role}» — role_playbook.` : "");

    return toContent(summary, payload);
  },
};

export const DISTRIBUTION_TOOLS: ToolDef[] = [connectViaUnyly];
