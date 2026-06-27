import { describe, it, expect } from "vitest";
import { rpc, get, devEnv, authEnv } from "./helpers.js";

describe("MCP handshake & discovery", () => {
  it("initialize returns serverInfo + protocolVersion + capabilities", async () => {
    const { status, json } = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(status).toBe(200);
    expect(json.jsonrpc).toBe("2.0");
    expect(json.id).toBe(1);
    expect(json.result.serverInfo.name).toBe("nectarin-intelligence");
    expect(typeof json.result.protocolVersion).toBe("string");
    expect(json.result.capabilities.tools).toBeDefined();
  });

  it("GET /health is ok", async () => {
    const { status, json } = await get("/health");
    expect(status).toBe(200);
    expect(json.status).toBe("ok");
  });

  it("GET /version returns name + version + toolCount + commit", async () => {
    const { status, json } = await get("/version");
    expect(status).toBe(200);
    expect(json.name).toBe("nectarin-intelligence");
    expect(typeof json.version).toBe("string");
    expect(json.toolCount).toBe(15);
    expect(json.commit).toBeDefined();
  });
});

describe("tools/list", () => {
  it("returns exactly 15 tools, each with a JSON-Schema inputSchema", async () => {
    const { status, json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(status).toBe(200);
    const tools = json.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(15);
    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema.type).toBe("object");
    }
    // Spot-check a couple of expected names from each group.
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("ru_benchmarks");
    expect(names).toContain("media_plan");
    expect(names).toContain("roi_calculator");
    expect(names).toContain("lead_qualify");
  });
});

describe("tools/call — happy paths", () => {
  it("ru_benchmarks returns benchmark rows", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "ru_benchmarks", arguments: { category: "finance", kpi: "CPA" } },
    });
    expect(json.result.isError).toBeUndefined();
    expect(json.result.structuredContent.data.results.length).toBeGreaterThan(0);
    expect(json.result.structuredContent.data.kpi).toBe("CPA");
  });

  it("media_plan returns a forecast + compliance gate for finance", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "media_plan",
        arguments: {
          budget: 5_000_000,
          goal: "performance",
          geo: "РФ",
          audience: "25-45",
          period: "сентябрь 2026",
          category: "finance",
        },
      },
    });
    const data = json.result.structuredContent.data;
    expect(data.forecast.impressions).toBeGreaterThan(0);
    expect(data.forecast.conversions).toBeGreaterThan(0);
    // finance is regulated → STOP-GATE present.
    expect(data.compliance.regulated).toBe(true);
    expect(data.compliance.gate).toContain("STOP-GATE");
  });

  it("roi_calculator returns a projection anchored to benchmarks", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "roi_calculator", arguments: { monthly_budget: 3_000_000, category: "finance" } },
    });
    const p = json.result.structuredContent.projection;
    expect(p.projectedCpa).toBeGreaterThan(0);
    expect(p.extraConversionsMonthly).toBeGreaterThanOrEqual(0);
    expect(p.cpaImprovementPct).toBeGreaterThan(0);
  });

  it("lead_qualify returns a fit score and recommended tier", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "lead_qualify",
        arguments: { company: "Acme", monthly_budget: 6_000_000, industry: "finance", goal: "performance" },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.fitScore).toBeGreaterThan(0);
    expect(sc.fitScore).toBeLessThanOrEqual(100);
    expect(sc.recommendedTier).toBe("enterprise retainer");
  });
});

describe("tools/call — error handling", () => {
  it("invalid params → -32602 (missing required + bad enum)", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      // kpi is a bad enum value and 'category' is missing.
      params: { name: "ru_benchmarks", arguments: { kpi: "NOPE" } },
    });
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32602);
    expect(json.error.message).toMatch(/Invalid params/);
  });

  it("invalid params → -32602 (numeric exclusiveMinimum violated)", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "media_plan",
        arguments: {
          budget: 0, // must be > 0
          goal: "performance",
          geo: "РФ",
          audience: "x",
          period: "p",
          category: "finance",
        },
      },
    });
    expect(json.error.code).toBe(-32602);
  });

  it("unknown tool → -32601 method-not-found", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "does_not_exist", arguments: {} },
    });
    expect(json.error).toBeDefined();
    expect(json.error.code).toBe(-32601);
  });

  it("unknown method → -32601 method-not-found", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 10, method: "no/such/method" });
    expect(json.error.code).toBe(-32601);
  });
});

describe("auth", () => {
  it("401 when DEV_BYPASS off and no bearer token", async () => {
    const { status, json, res } = await rpc(
      { jsonrpc: "2.0", id: 11, method: "tools/list" },
      authEnv()
    );
    expect(status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/resource_metadata=/);
    expect(json.error).toBeDefined();
  });

  it("dev bypass allows calls without a token", async () => {
    const { status, json } = await rpc(
      { jsonrpc: "2.0", id: 12, method: "tools/list" },
      devEnv()
    );
    expect(status).toBe(200);
    expect(json.result.tools).toHaveLength(15);
  });

  it("shared token: 401 without a bearer (even if DEV_BYPASS=1)", async () => {
    const { status, res } = await rpc(
      { jsonrpc: "2.0", id: 13, method: "tools/list" },
      devEnv({ MCP_SHARED_TOKEN: "s3cret-token" })
    );
    expect(status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/Bearer/);
  });

  it("shared token: 401 with a wrong bearer", async () => {
    const { status } = await rpc(
      { jsonrpc: "2.0", id: 14, method: "tools/list" },
      devEnv({ MCP_SHARED_TOKEN: "s3cret-token" }),
      { authorization: "Bearer wrong-token" }
    );
    expect(status).toBe(401);
  });

  it("shared token: 200 with the correct bearer", async () => {
    const { status, json } = await rpc(
      { jsonrpc: "2.0", id: 15, method: "tools/list" },
      devEnv({ MCP_SHARED_TOKEN: "s3cret-token" }),
      { authorization: "Bearer s3cret-token" }
    );
    expect(status).toBe(200);
    expect(json.result.tools).toHaveLength(15);
  });

  it("/version reports authMode shared-token when configured", async () => {
    const { json } = await get("/version", devEnv({ MCP_SHARED_TOKEN: "s3cret-token" }));
    expect(json.authMode).toBe("shared-token");
  });
});
