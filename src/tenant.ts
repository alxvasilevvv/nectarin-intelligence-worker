/**
 * TENANT DATA scaffold (v2.61) for NECTARIN Intelligence — Workers.
 *
 * Minimal read-only tenant metrics layer so future connectors can feed tools
 * without redesign. Mode controlled by NECTARIN_TENANT_DATA_MODE:
 *   • "mock" (default) — returns a demo metrics blob + note; no behavior change.
 *   • "kv" — reads JSON from NECTARIN_KV key `tenant:<id>:metrics` when bound.
 *
 * KV key format (documented in README):
 *   tenant:<tenantId>:metrics  →  JSON { updatedAt, metrics: { ... } }
 */

import type { ToolDef, ToolResult } from "./tools.js";
import type { Env } from "./index.js";
import type { KvLike } from "./orchestrator.js";

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

export function tenantMetricsKey(tenantId: string): string {
  return `tenant:${tenantId.trim()}:metrics`;
}

export function tenantDataMode(env?: Env): "mock" | "kv" {
  const m = env?.NECTARIN_TENANT_DATA_MODE?.trim().toLowerCase();
  return m === "kv" ? "kv" : "mock";
}

const DEMO_METRICS = {
  updatedAt: "2026-Q2-demo",
  metrics: {
    CPA: { value: 1850, target: 1500, period: "last_30d" },
    CTR: { value: 0.72, target: 0.85, period: "last_30d" },
    ROAS: { value: 3.2, target: 4.0, period: "last_30d" },
    spend: { value: 2_400_000, currency: "RUB", period: "last_30d" },
  },
};

export async function readTenantMetrics(
  tenantId: string,
  env?: Env
): Promise<{ source: "mock" | "kv" | "kv_miss"; mode: "mock" | "kv"; metrics: Record<string, unknown> | null; note: string }> {
  const mode = tenantDataMode(env);
  const id = tenantId.trim();
  if (!id) {
    return { source: "mock", mode, metrics: null, note: "Пустой tenantId." };
  }

  if (mode === "kv" && env?.NECTARIN_KV) {
    const raw = await env.NECTARIN_KV.get(tenantMetricsKey(id));
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        const blob = isRecord(parsed) ? parsed : { metrics: parsed };
        return {
          source: "kv",
          mode,
          metrics: blob,
          note: `Метрики из KV (${tenantMetricsKey(id)}).`,
        };
      } catch {
        return {
          source: "kv_miss",
          mode,
          metrics: null,
          note: `KV key ${tenantMetricsKey(id)} содержит невалидный JSON.`,
        };
      }
    }
    return {
      source: "kv_miss",
      mode,
      metrics: null,
      note: `KV key ${tenantMetricsKey(id)} не найден — загрузите JSON blob или переключите NECTARIN_TENANT_DATA_MODE=mock.`,
    };
  }

  return {
    source: "mock",
    mode,
    metrics: { ...DEMO_METRICS, tenantId: id },
    note:
      mode === "kv" && !env?.NECTARIN_KV
        ? "NECTARIN_TENANT_DATA_MODE=kv, но NECTARIN_KV не привязан — возвращён demo blob."
        : "Demo/mock tenant metrics (NECTARIN_TENANT_DATA_MODE=mock). Подключите коннектор → KV для prod.",
  };
}

const tenantMetricsSnapshot: ToolDef = {
  name: "tenant_metrics_snapshot",
  description:
    "READ-ONLY tenant metrics snapshot — foundation for future data connectors. Given a tenantId, returns the latest metrics JSON blob. With NECTARIN_TENANT_DATA_MODE=kv and NECTARIN_KV bound, reads key `tenant:<id>:metrics`; otherwise returns a demo/mock blob with a clear note. Does NOT write data. Use with kpi_alert_engine / benchmark_kpi_check for autonomous monitoring once real feeds land.",
  inputSchema: {
    type: "object",
    properties: {
      tenantId: { type: "string", description: "Tenant identifier (maps to KV key tenant:<id>:metrics)" },
    },
    required: ["tenantId"],
    additionalProperties: false,
  },
  async handler(input, env) {
    const tenantId = typeof input?.tenantId === "string" ? input.tenantId.trim() : "";
    if (!tenantId) return errResult("Нужен tenantId.");
    const result = await readTenantMetrics(tenantId, env);
    const summary =
      `Tenant «${tenantId}» (${result.mode}/${result.source}): ` +
      (result.metrics ? "метрики получены." : "данных нет.") +
      ` ${result.note}`;
    return toContent(summary, {
      tool: "tenant_metrics_snapshot",
      tenantId,
      kvKey: tenantMetricsKey(tenantId),
      ...result,
    });
  },
};

export const TENANT_TOOLS: ToolDef[] = [tenantMetricsSnapshot];
