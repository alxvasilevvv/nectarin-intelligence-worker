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
    expect(json.toolCount).toBe(63);
    expect(json.commit).toBeDefined();
  });
});

describe("tools/list", () => {
  it("returns exactly 20 tools, each with a JSON-Schema inputSchema", async () => {
    const { status, json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(status).toBe(200);
    const tools = json.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(63);
    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.inputSchema.type).toBe("object");
      // Every tool advertises a display title + behavioral annotations (MCP hints).
      expect(typeof t.title).toBe("string");
      expect(t.title.length).toBeGreaterThan(0);
      expect(typeof t.annotations.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations.idempotentHint).toBe("boolean");
      expect(typeof t.annotations.openWorldHint).toBe("boolean");
      expect(t.annotations.destructiveHint).toBe(false);
    }
    // Spot-check a couple of expected names from each group.
    const names = tools.map((t: any) => t.name);
    expect(names).toContain("ru_benchmarks");
    expect(names).toContain("media_plan");
    expect(names).toContain("roi_calculator");
    expect(names).toContain("lead_qualify");
    expect(names).toContain("budget_optimizer");
    expect(names).toContain("strategy_orchestrate");
    expect(names).toContain("compliance_check");
    expect(names).toContain("ab_test_planner");
    expect(names).toContain("unit_economics");
    expect(names).toContain("funnel_model");
    expect(names).toContain("seasonality_forecast");
    expect(names).toContain("creative_score");
    expect(names).toContain("attribution_model");
    expect(names).toContain("bid_simulator");
    expect(names).toContain("report_export");
    expect(names).toContain("localize");
    expect(names).toContain("creative_variants");
    expect(names).toContain("anomaly_detector");
    expect(names).toContain("cohort_ltv");
    expect(names).toContain("utm_builder");
    expect(names).toContain("pacing_monitor");
    expect(names).toContain("response_curve");
    expect(names).toContain("mmm_optimize");
    expect(names).toContain("gtm_calendar");
    expect(names).toContain("scenario_planner");
    expect(names).toContain("promo_planner");
    expect(names).toContain("board_report");
    expect(names).toContain("creative_fatigue");
    expect(names).toContain("price_optimizer");
    expect(names).toContain("influencer_planner");
    expect(names).toContain("reach_frequency");
    expect(names).toContain("brand_lift");
    expect(names).toContain("channel_overlap");
    expect(names).toContain("production_estimator");
    expect(names).toContain("media_flowchart");
    expect(names).toContain("geo_holdout");
    expect(names).toContain("sov_tracker");
    expect(names).toContain("media_quality_score");
    expect(names).toContain("competitive_response");
    expect(names).toContain("budget_pacing_forecast");
    expect(names).toContain("audience_overlap");
    expect(names).toContain("creative_rotation");
    expect(names).toContain("utm_taxonomy_qa");
    expect(names).toContain("incrementality_meta");
    expect(names).toContain("search_planner");
    expect(names).toContain("retail_media_planner");
    expect(names).toContain("share_of_search");
    expect(names).toContain("churn_predictor");
    expect(names).toContain("frequency_cap_optimizer");
    expect(names).toContain("creative_testing_matrix");
    expect(names).toContain("marketing_audit");
    expect(names).toContain("landing_cro_audit");
  });

  it("annotations: pure tools are read-only/idempotent; LLM & funnel tools are flagged", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 21, method: "tools/list" });
    const byName: Record<string, any> = Object.fromEntries(
      json.result.tools.map((t: any) => [t.name, t])
    );
    // Pure computation over mock data → read-only + idempotent + closed-world.
    expect(byName.ru_benchmarks.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
    // LLM-backed → non-idempotent + open-world (reaches an external model).
    expect(byName.creative_variants.annotations).toMatchObject({
      idempotentHint: false,
      openWorldHint: true,
    });
    // Records a brief (would POST to a CRM in prod) → not read-only.
    expect(byName.request_nectarin_proposal.annotations.readOnlyHint).toBe(false);
    // Acronyms are upper-cased in the generated title.
    expect(byName.roi_calculator.title).toBe("ROI Calculator");
    expect(byName.utm_builder.title).toBe("UTM Builder");
  });
});

describe("completion/complete", () => {
  it("initialize advertises the completions capability", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 40, method: "initialize", params: {} });
    expect(json.result.capabilities.completions).toBeDefined();
  });

  it("completes category by case-insensitive prefix", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 41,
      method: "completion/complete",
      params: { ref: { type: "ref/prompt", name: "build_media_plan" }, argument: { name: "category", value: "re" } },
    });
    const values = json.result.completion.values;
    expect(values).toContain("realty");
    expect(values).toContain("retail");
    expect(values).not.toContain("finance");
    expect(json.result.completion.hasMore).toBe(false);
  });

  it("completes goal and kpi argument pools", async () => {
    const goal = await rpc({
      jsonrpc: "2.0",
      id: 42,
      method: "completion/complete",
      params: { ref: { type: "ref/prompt", name: "build_media_plan" }, argument: { name: "goal", value: "per" } },
    });
    expect(goal.json.result.completion.values).toEqual(["performance"]);

    const kpi = await rpc({
      jsonrpc: "2.0",
      id: 43,
      method: "completion/complete",
      params: { ref: { type: "ref/prompt", name: "x" }, argument: { name: "kpi", value: "" } },
    });
    expect(kpi.json.result.completion.values).toEqual(["CPM", "CTR", "CPA", "VTR"]);
  });

  it("returns an empty list for an unknown argument", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 44,
      method: "completion/complete",
      params: { ref: { type: "ref/prompt", name: "x" }, argument: { name: "nope", value: "a" } },
    });
    expect(json.result.completion.values).toEqual([]);
  });
});

describe("resources", () => {
  it("resources/list returns the methodology, glossary and live catalog", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 30, method: "resources/list" });
    const uris = json.result.resources.map((r: any) => r.uri);
    expect(uris).toContain("nectarin://methodology");
    expect(uris).toContain("nectarin://glossary");
    expect(uris).toContain("nectarin://catalog");
  });

  it("resources/read nectarin://catalog returns a live JSON tool+prompt catalog", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 31,
      method: "resources/read",
      params: { uri: "nectarin://catalog" },
    });
    const c = json.result.contents[0];
    expect(c.mimeType).toBe("application/json");
    const catalog = JSON.parse(c.text);
    expect(catalog.counts.tools).toBe(63);
    expect(catalog.tools).toHaveLength(63);
    // Catalog entries carry the same annotations as tools/list.
    const ru = catalog.tools.find((t: any) => t.name === "ru_benchmarks");
    expect(ru.annotations.readOnlyHint).toBe(true);
    expect(ru.title).toBe("RU Benchmarks");
    expect(catalog.prompts.length).toBeGreaterThanOrEqual(9);
  });

  it("resources/read rejects an unknown uri", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 32,
      method: "resources/read",
      params: { uri: "nectarin://nope" },
    });
    expect(json.error).toBeDefined();
  });
});

describe("per-tenant data routing (X-Tenant-Id header)", () => {
  function fakeKv(initial: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>(Object.entries(initial));
    return {
      async get(key: string, type?: "text" | "json") {
        const v = store.get(key);
        if (v == null) return null;
        if (type === "json") return typeof v === "string" ? JSON.parse(v) : v;
        return typeof v === "string" ? v : JSON.stringify(v);
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    };
  }
  const tenantOverride = {
    "tenant:e2e:benchmarks:retail": {
      "VK Ads": {
        CPM: { p25: 1, p50: 2, p75: 3 },
        CTR: { p25: 1, p50: 1, p75: 1 },
        CPA: { p25: 54321, p50: 54321, p75: 54321 },
        VTR: { p25: 1, p50: 1, p75: 1 },
      },
    },
  };

  it("serves a tenant's KV override only when the X-Tenant-Id header is present", async () => {
    const env = devEnv({ NECTARIN_KV: fakeKv(tenantOverride) as any });
    const call = (headers: Record<string, string>) =>
      rpc(
        {
          jsonrpc: "2.0",
          id: 99,
          method: "tools/call",
          params: { name: "ru_benchmarks", arguments: { category: "retail", kpi: "CPA" } },
        },
        env,
        headers
      );

    // With the tenant header → the override (distinctive CPA 54321) is returned.
    const withTenant = await call({ "X-Tenant-Id": "e2e" });
    const tenantRows = withTenant.json.result.structuredContent.data.results;
    expect(tenantRows.some((r: any) => r.range.p50 === 54321)).toBe(true);

    // Without the header → shared/global data, which does NOT carry the override.
    const noTenant = await call({});
    const baseRows = noTenant.json.result.structuredContent.data.results;
    expect(baseRows.some((r: any) => r.range.p50 === 54321)).toBe(false);

    // An invalid tenant id is rejected → behaves like no tenant (no override).
    const badTenant = await call({ "X-Tenant-Id": "bad id!" });
    const badRows = badTenant.json.result.structuredContent.data.results;
    expect(badRows.some((r: any) => r.range.p50 === 54321)).toBe(false);
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

  it("budget_optimizer maximizes conversions and respects the per-channel cap", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 16,
      method: "tools/call",
      params: { name: "budget_optimizer", arguments: { category: "retail", budget: 4_000_000, goal: "performance" } },
    });
    const d = json.result.structuredContent.data;
    const alloc = d.optimized.allocation;
    expect(Array.isArray(alloc)).toBe(true);
    // Spend sums to (about) the budget.
    const spend = alloc.reduce((a: number, c: any) => a + c.spend, 0);
    expect(Math.abs(spend - 4_000_000)).toBeLessThan(2);
    // No channel exceeds the cap (45% default) of the budget.
    for (const c of alloc) expect(c.sharePct).toBeLessThanOrEqual(45.1);
    // Optimizer must not be worse than the preset on conversions.
    expect(d.optimized.totals.conversions).toBeGreaterThanOrEqual(d.baselinePreset.totals.conversions);
    expect(d.optimized.totals.blendedCpa).toBeGreaterThan(0);
  });

  it("strategy_orchestrate assembles a full strategy from all workers", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 17,
      method: "tools/call",
      params: {
        name: "strategy_orchestrate",
        arguments: { brand: "Acme", category: "finance", budget: 8_000_000, goal: "performance", geo: "РФ" },
      },
    });
    const d = json.result.structuredContent.data;
    expect(typeof d.executiveSummary).toBe("string");
    expect(d.mediaPlan.forecast.conversions).toBeGreaterThan(0);
    expect(Array.isArray(d.optimizedSplit.allocation)).toBe(true);
    expect(d.benchmarks.results.length).toBeGreaterThan(0);
    expect(d.audience.segments.length).toBeGreaterThan(0);
    expect(d.competitors.competitors.length).toBeGreaterThan(0);
    expect(d.creativeConcepts.length).toBeGreaterThan(0);
    // finance is regulated → STOP-GATE present.
    expect(d.compliance.regulated).toBe(true);
    expect(d.roi.estAnnualValueRub).toBeGreaterThan(0);
    expect(d.pipeline.length).toBeGreaterThan(0);
  });

  it("compliance_check flags superlatives and pharma warning + scores", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 18,
      method: "tools/call",
      params: {
        name: "compliance_check",
        arguments: { copy: "Лучший препарат — излечивает за 1 день!", category: "pharma" },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.complianceScore).toBeLessThan(80);
    expect(sc.riskLevel).toBe("high");
    expect(sc.counts.high).toBeGreaterThan(0);
    const areas = sc.findings.map((f: any) => f.area).join(" | ");
    expect(areas).toMatch(/Превосходн|противопоказан|фарма/i);
    // ОРД marking reminder is always present.
    expect(areas).toMatch(/ОРД/);
  });

  it("compliance_check catches superlative + guaranteed return (finance)", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "compliance_check",
        arguments: { copy: "Лучший вклад! Гарантированная доходность 30%", category: "finance" },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.counts.high).toBeGreaterThanOrEqual(2);
    expect(sc.complianceScore).toBeLessThan(60);
    const areas = sc.findings.map((f: any) => f.area).join(" | ");
    expect(areas).toMatch(/Превосходн/);
    expect(areas).toMatch(/доходност/i);
  });

  it("ab_test_planner computes sample size and duration", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 19,
      method: "tools/call",
      params: {
        name: "ab_test_planner",
        arguments: { baselineRatePct: 5, mdeRelPct: 10, dailyVisitorsPerVariant: 2000 },
      },
    });
    const r = json.result.structuredContent.result;
    expect(r.sampleSizePerVariant).toBeGreaterThan(0);
    expect(r.totalSampleSize).toBe(r.sampleSizePerVariant * 2);
    expect(r.estDurationDays).toBeGreaterThan(0);
    expect(r.recommendedMinRuntimeDays).toBeGreaterThanOrEqual(14);
  });

  it("unit_economics derives CAC, LTV:CAC and a verdict", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: {
        name: "unit_economics",
        arguments: {
          aov: 5000,
          grossMarginPct: 40,
          monthlySpend: 1_000_000,
          newCustomers: 500,
          purchasesPerYear: 3,
          lifespanYears: 2,
        },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.derived.cac).toBe(2000);
    expect(sc.metrics.ltv).toBe(12000);
    expect(sc.metrics.ltvToCac).toBe(6);
    expect(sc.metrics.paybackMonths).toBeGreaterThan(0);
    expect(typeof sc.verdict).toBe("string");
    expect(sc.healthy).toBe(true);
  });

  it("funnel_model returns ordered scenarios and a biggest leak", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 22,
      method: "tools/call",
      params: { name: "funnel_model", arguments: { budget: 5_000_000, category: "retail", aov: 4000 } },
    });
    const sc = json.result.structuredContent;
    const { conservative, base, optimistic } = sc.scenarios;
    expect(base.sales).toBeGreaterThan(0);
    // optimistic >= base >= conservative on sales.
    expect(optimistic.sales).toBeGreaterThanOrEqual(base.sales);
    expect(base.sales).toBeGreaterThanOrEqual(conservative.sales);
    expect(base.roas).toBeGreaterThan(0);
    expect(typeof sc.biggestLeak.stage).toBe("string");
    expect(sc.provenance).toBeDefined();
  });

  it("seasonality_forecast splits an annual budget across 12 months", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 23,
      method: "tools/call",
      params: { name: "seasonality_forecast", arguments: { category: "finance", annualBudget: 12_000_000 } },
    });
    const sc = json.result.structuredContent;
    expect(sc.months).toHaveLength(12);
    const total = sc.months.reduce((a: number, m: any) => a + m.budget, 0);
    expect(Math.abs(total - 12_000_000)).toBeLessThan(12_000); // rounding tolerance
    expect(sc.peak.index).toBeGreaterThanOrEqual(sc.trough.index);
  });

  it("creative_score scores and flags compliance risk", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 24,
      method: "tools/call",
      params: {
        name: "creative_score",
        arguments: { headline: "Лучший вклад в банке", body: "Откройте вклад", category: "finance" },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.score).toBeGreaterThanOrEqual(0);
    expect(sc.score).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D"]).toContain(sc.grade);
    expect(sc.complianceFlag).toBe(true);
    expect(Array.isArray(sc.checks)).toBe(true);
  });

  it("ru_benchmarks supports the new ecom category + returns provenance", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 25,
      method: "tools/call",
      params: { name: "ru_benchmarks", arguments: { category: "ecom", kpi: "CPA" } },
    });
    const r = json.result.structuredContent;
    expect(r.data.results.length).toBeGreaterThan(0);
    expect(r.provenance).toBeDefined();
    expect(r.provenance.synthetic).toBe(true);
  });

  it("budget_optimizer includes Avito for retail (new platform)", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 26,
      method: "tools/call",
      params: { name: "budget_optimizer", arguments: { category: "retail", budget: 4_000_000, goal: "performance" } },
    });
    const alloc = json.result.structuredContent.data.optimized.allocation;
    const platforms = alloc.map((c: any) => c.platform);
    expect(platforms).toContain("Avito");
  });

  it("seasonality_forecast works for the new edtech category", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 27,
      method: "tools/call",
      params: { name: "seasonality_forecast", arguments: { category: "edtech" } },
    });
    const sc = json.result.structuredContent;
    expect(sc.months).toHaveLength(12);
    // September is a known edtech peak.
    expect(sc.peak.month).toBe("Сентябрь");
  });

  it("attribution_model credits channels across 5 models", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 28,
      method: "tools/call",
      params: {
        name: "attribution_model",
        arguments: {
          paths: [
            { channels: ["VK Ads", "Yandex Direct"], conversions: 100 },
            { channels: ["OLV", "VK Ads", "Yandex Direct"], conversions: 50 },
          ],
        },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.byChannel.length).toBe(3);
    // last-touch must hand 100% of all conversions to the final touch (Yandex Direct here).
    const yandex = sc.byChannel.find((c: any) => c.channel === "Yandex Direct");
    expect(yandex.credited.lastTouch).toBe(150);
    // first-touch credits OLV only for the path it starts.
    const olv = sc.byChannel.find((c: any) => c.channel === "OLV");
    expect(olv.credited.firstTouch).toBe(50);
  });

  it("bid_simulator returns a curve and a recommended bid", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 29,
      method: "tools/call",
      params: { name: "bid_simulator", arguments: { category: "retail", dailyBudget: 200000 } },
    });
    const sc = json.result.structuredContent;
    expect(Array.isArray(sc.curve)).toBe(true);
    expect(sc.curve.length).toBeGreaterThan(3);
    expect(sc.recommended.bid).toBeGreaterThan(0);
    expect(sc.reference.cpc).toBeGreaterThan(0);
    // win-rate must be monotonically non-decreasing in bid multiple.
    for (let i = 1; i < sc.curve.length; i++) {
      expect(sc.curve[i].winRatePct).toBeGreaterThanOrEqual(sc.curve[i - 1].winRatePct);
    }
  });

  it("report_export builds slides + markdown from a strategy payload", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: {
        name: "report_export",
        arguments: {
          title: "Стратегия 2026",
          brand: "Acme",
          strategy: {
            executiveSummary: "Краткое резюме стратегии.",
            mediaPlan: { forecast: { impressions: 1000000, clicks: 12000, conversions: 800, blendedCpa: 1500 } },
            optimizedSplit: { allocation: [{ platform: "Yandex Direct", sharePct: 45, spend: 1800000 }] },
            roi: { estAnnualValueRub: 50000000, estRoiX: 3.2 },
            compliance: { regulated: true },
          },
        },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.slides.length).toBeGreaterThan(3);
    expect(sc.slides[0].title).toBe("Стратегия 2026");
    expect(typeof sc.markdown).toBe("string");
    expect(sc.markdown).toContain("Executive Summary");
    expect(typeof sc.onePager).toBe("string");
  });

  it("localize returns original text + note when no LLM key is set", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: { name: "localize", arguments: { text: "Откройте вклад сегодня", targetLang: "en" } },
    });
    const sc = json.result.structuredContent;
    // Test env has no LLM key → graceful fallback to original.
    expect(sc.usedLlm).toBe(false);
    expect(sc.localized).toBe("Откройте вклад сегодня");
    expect(sc.input.langName).toBe("английский");
  });
});

describe("premium tools (v2.1)", () => {
  it("creative_variants returns ranked, scored variants (template fallback)", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: { name: "creative_variants", arguments: { product: "Кэшбэк-карта", audience: "молодые специалисты", channel: "VK Ads", count: 3 } },
    });
    const sc = json.result.structuredContent;
    expect(sc.usedLlm).toBe(false);
    expect(sc.variants).toHaveLength(3);
    // Ranked best-first.
    expect(sc.variants[0].score).toBeGreaterThanOrEqual(sc.variants[1].score);
    for (const v of sc.variants) {
      expect(typeof v.headline).toBe("string");
      expect(typeof v.score).toBe("number");
      expect(["A", "B", "C", "D"]).toContain(v.grade);
    }
  });

  it("anomaly_detector flags an obvious spike and the latest point", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 51,
      method: "tools/call",
      params: { name: "anomaly_detector", arguments: { series: [100, 102, 98, 101, 99, 100, 103, 500], metric: "CPA" } },
    });
    const sc = json.result.structuredContent;
    expect(sc.anomalies.length).toBeGreaterThanOrEqual(1);
    expect(sc.latest.anomaly).toBe(true);
    expect(sc.anomalies.some((a: any) => a.value === 500 && a.direction === "up")).toBe(true);
  });

  it("anomaly_detector reports no anomalies on a flat series", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 52,
      method: "tools/call",
      params: { name: "anomaly_detector", arguments: { series: [50, 50, 50, 50, 50] } },
    });
    expect(json.result.structuredContent.anomalies).toHaveLength(0);
  });

  it("cohort_ltv computes LTV and payback from a churn rate + CAC", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 53,
      method: "tools/call",
      params: { name: "cohort_ltv", arguments: { cohortSize: 1000, arpu: 500, monthlyChurnPct: 10, periods: 12, grossMarginPct: 80, cac: 1500 } },
    });
    const sc = json.result.structuredContent;
    expect(sc.ltvPerCustomer).toBeGreaterThan(0);
    expect(sc.totalLtv).toBeGreaterThan(0);
    expect(sc.ltvCacRatio).toBeGreaterThan(0);
    expect(sc.table.length).toBe(13); // periods + period 0
  });

  it("cohort_ltv errors helpfully when no retention source is given", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 54,
      method: "tools/call",
      params: { name: "cohort_ltv", arguments: { cohortSize: 100, arpu: 300 } },
    });
    expect(json.result.isError).toBe(true);
    expect(JSON.stringify(json.result)).toContain("retentionCurve");
  });

  it("utm_builder builds an encoded, normalized tracking URL", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 55,
      method: "tools/call",
      params: { name: "utm_builder", arguments: { url: "https://shop.example/landing?ref=x", source: "VK Ads", medium: "CPC", campaign: "Spring Sale 2026" } },
    });
    const sc = json.result.structuredContent;
    expect(sc.url).toContain("utm_source=vk_ads");
    expect(sc.url).toContain("utm_campaign=spring_sale_2026");
    expect(sc.url).toContain("ref=x"); // preserves existing query
    expect(sc.warnings.length).toBeGreaterThan(0); // flagged uppercase/spaces
  });

  it("utm_builder rejects a non-http url", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 56,
      method: "tools/call",
      params: { name: "utm_builder", arguments: { url: "ftp://x", source: "a", medium: "b", campaign: "c" } },
    });
    expect(json.result.isError).toBe(true);
  });

  it("pacing_monitor flags overspend and recommends a daily cap", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 57,
      method: "tools/call",
      params: { name: "pacing_monitor", arguments: { totalBudget: 300000, daysTotal: 30, daysElapsed: 10, spendToDate: 200000 } },
    });
    const sc = json.result.structuredContent;
    expect(sc.status).toBe("over");
    expect(sc.pace).toBeGreaterThan(1);
    expect(sc.recommendedDailySpend).toBeGreaterThan(0);
  });

  it("pacing_monitor reports on-track within the band", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 58,
      method: "tools/call",
      params: { name: "pacing_monitor", arguments: { totalBudget: 300000, daysTotal: 30, daysElapsed: 10, spendToDate: 100000 } },
    });
    expect(json.result.structuredContent.status).toBe("on-track");
  });

  it("response_curve reallocates toward the more efficient channel (diminishing returns)", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 59,
      method: "tools/call",
      params: {
        name: "response_curve",
        arguments: {
          // Channel A is ~2× more cost-efficient (more conversions per RUB).
          channels: [
            { name: "A", currentSpend: 100000, currentConversions: 200 },
            { name: "B", currentSpend: 100000, currentConversions: 100 },
          ],
          elasticity: 0.6,
        },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.isReallocation).toBe(true);
    expect(sc.totalBudget).toBe(200000);
    const a = sc.channels.find((c: any) => c.name === "A");
    const b = sc.channels.find((c: any) => c.name === "B");
    // The efficient channel should get more budget than the weaker one.
    expect(a.recommendedSpend).toBeGreaterThan(b.recommendedSpend);
    // Reallocation at equal total should not reduce projected conversions.
    expect(sc.totals.projectedConversions).toBeGreaterThanOrEqual(sc.totals.currentConversions);
    // At the optimum, marginal CPA is equalized across funded channels.
    expect(Math.abs(a.marginalCPA - b.marginalCPA)).toBeLessThanOrEqual(1);
  });

  it("mmm_optimize fits adstock+saturation and reallocates toward the higher-ROI channel", async () => {
    // Channel A converts ~2× per RUB vs B across the series → should win budget.
    // Concave (diminishing-returns) response: conv = k·sqrt(spend); A twice as efficient.
    const spend = [100000, 120000, 90000, 110000, 130000, 100000];
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 70,
      method: "tools/call",
      params: {
        name: "mmm_optimize",
        arguments: {
          channels: [
            { name: "A", spend, conversions: spend.map((s) => Math.round(3 * Math.sqrt(s))) },
            { name: "B", spend, conversions: spend.map((s) => Math.round(1.5 * Math.sqrt(s))) },
          ],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.periods).toBe(6);
    const a = sc.channels.find((c: any) => c.name === "A");
    const b = sc.channels.find((c: any) => c.name === "B");
    expect(a.recommendedSpend).toBeGreaterThan(b.recommendedSpend);
    // Each channel reports a fitted decay, elasticity and fit quality.
    expect(typeof a.adstockDecay).toBe("number");
    expect(a.saturationElasticity).toBeGreaterThan(0);
    expect(a.saturationElasticity).toBeLessThanOrEqual(1);
    expect(typeof a.fitR2).toBe("number");
    // Reallocation at equal total should not reduce projected steady-state conversions.
    expect(sc.totals.projectedConversions).toBeGreaterThanOrEqual(sc.totals.currentSteadyConversions - 0.5);
  });

  it("mmm_optimize errors on mismatched series lengths", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 71,
      method: "tools/call",
      params: {
        name: "mmm_optimize",
        arguments: { channels: [{ name: "A", spend: [1, 2, 3, 4, 5], conversions: [1, 2, 3, 4] }] },
      },
    });
    expect(json.result.isError).toBe(true);
  });

  it("gtm_calendar builds Test→Scale→Optimize phases with seasonally-weighted weekly pacing", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 72,
      method: "tools/call",
      params: {
        name: "gtm_calendar",
        arguments: { category: "ecom", budget: 12000000, goal: "performance", horizonWeeks: 12, startMonth: 9 },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.phases).toHaveLength(3);
    expect(sc.phases.map((p: any) => p.phase)).toEqual(["Test", "Scale", "Optimize"]);
    // Scale gets the largest budget share for a performance goal.
    expect(sc.phases[1].budget).toBeGreaterThan(sc.phases[0].budget);
    expect(sc.phases[1].budget).toBeGreaterThan(sc.phases[2].budget);
    // Phase budgets sum to ~total (rounding tolerance).
    const sum = sc.phases.reduce((a: number, p: any) => a + p.budget, 0);
    expect(Math.abs(sum - sc.totalBudget)).toBeLessThanOrEqual(3);
    // Weekly pacing covers the horizon and each week names a month + season index.
    expect(sc.weeklyPacing).toHaveLength(sc.horizonWeeks);
    expect(typeof sc.weeklyPacing[0].month).toBe("string");
    expect(sc.weeklyPacing[0].seasonIndex).toBeGreaterThan(0);
    // ecom peaks in Nov (index 1.40): starting Sep/12wk horizon should flag a peak window.
    expect(sc.seasonalWindows.some((w: any) => w.signal === "peak")).toBe(true);
  });

  it("marketing_audit scores channels vs benchmarks and recommends reallocation", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 73,
      method: "tools/call",
      params: {
        name: "marketing_audit",
        arguments: {
          category: "ecom",
          channels: [
            { name: "Yandex Direct", spend: 900000, conversions: 900 },
            { name: "VK Ads", spend: 600000, conversions: 60 },
            { name: "Telegram Ads", spend: 200000, conversions: 0 },
          ],
          targetCpa: 1500,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(typeof sc.healthScore).toBe("number");
    expect(["A", "B", "C", "D"]).toContain(sc.grade);
    expect(sc.channels).toHaveLength(3);
    // Blended CPA = 1,700,000 / 960 ≈ 1771.
    expect(sc.blendedCpa).toBeGreaterThan(0);
    // The untracked Telegram channel (0 conversions) is flagged.
    const tg = sc.channels.find((c: any) => c.name === "Telegram Ads");
    expect(tg.verdict).toBe("untracked");
    expect(tg.cpa).toBeNull();
    // At least one prioritized recommendation is returned.
    expect(sc.recommendations.length).toBeGreaterThan(0);
    expect(sc.recommendations[0].priority).toBe(1);
  });

  it("scenario_planner ranks what-if scenarios and recommends one (with ROI)", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 74,
      method: "tools/call",
      params: {
        name: "scenario_planner",
        arguments: {
          channels: [
            { name: "Yandex Direct", currentSpend: 900000, currentConversions: 600 },
            { name: "VK Ads", currentSpend: 600000, currentConversions: 180 },
          ],
          scenarios: [
            { name: "Консервативный", budgetMultiplier: 0.8 },
            { name: "Агрессивный", budgetMultiplier: 1.5 },
          ],
          objective: "max_roi",
          revenuePerConversion: 4000,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // Baseline ("Текущий") + 2 user scenarios = 3 candidates ranked.
    expect(sc.scenarios).toHaveLength(3);
    expect(sc.ranking).toHaveLength(3);
    expect(sc.ranking[0].recommended).toBe(true);
    expect(sc.recommendation.scenario).toBe(sc.ranking[0].name);
    // Diminishing returns: aggressive (×1.5) yields fewer than 1.5× the conversions.
    const baseline = sc.scenarios.find((s: any) => s.isBaseline);
    const aggressive = sc.scenarios.find((s: any) => s.name === "Агрессивный");
    expect(aggressive.totalConversions).toBeLessThan(baseline.totalConversions * 1.5);
    expect(aggressive.totalConversions).toBeGreaterThan(baseline.totalConversions);
    // ROI fields populated when revenuePerConversion is supplied.
    expect(typeof aggressive.roiPct).toBe("number");
    expect(sc.recommendation.elasticitySensitivity).toHaveLength(2);
  });

  it("promo_planner computes break-even uplift and projects promo ROI", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 75,
      method: "tools/call",
      params: {
        name: "promo_planner",
        arguments: {
          product: "Подписка PRO",
          price: 1000,
          unitCost: 400,
          baselineUnits: 1000,
          discountPct: 20,
          expectedUpliftPct: 60,
          promoFixedCost: 50000,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // Regular margin 600, promo price 800, promo margin 400.
    expect(sc.economics.promoPrice).toBe(800);
    expect(sc.economics.promoUnitMargin).toBe(400);
    // Break-even uplift = (baselineProfit+fixed)/(units*promoMargin) - 1
    //   = (600000+50000)/(1000*400) - 1 = 0.625 → 62.5%.
    expect(sc.breakevenUpliftPct).toBeCloseTo(62.5, 1);
    // Expected uplift 60% < 62.5% break-even ⇒ not yet profitable.
    expect(sc.projection.beatsBreakeven).toBe(false);
    expect(sc.verdict).toBe("needs_more_uplift");
    expect(typeof sc.projection.incrementalProfit).toBe("number");
  });

  it("promo_planner flags a margin-destroying discount", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 76,
      method: "tools/call",
      params: {
        name: "promo_planner",
        arguments: { price: 1000, unitCost: 900, baselineUnits: 500, discountPct: 20 },
      },
    });
    const sc = json.result.structuredContent;
    // Promo price 800 < unitCost 900 ⇒ negative promo margin.
    expect(sc.economics.promoUnitMargin).toBeLessThan(0);
    expect(sc.breakevenUpliftPct).toBeNull();
    expect(sc.verdict).toBe("margin_destroying");
    expect(sc.warnings.length).toBeGreaterThan(0);
  });

  it("board_report orchestrates audit + scenario into an executive one-pager", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 77,
      method: "tools/call",
      params: {
        name: "board_report",
        arguments: {
          category: "ecom",
          company: "Acme",
          period: "Q3 2026",
          channels: [
            { name: "Yandex Direct", spend: 900000, conversions: 900 },
            { name: "VK Ads", spend: 600000, conversions: 60 },
            { name: "Telegram Ads", spend: 200000, conversions: 0 },
          ],
          targetCpa: 1500,
          revenuePerConversion: 4000,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.header.category).toBe("ecom");
    expect(["A", "B", "C", "D"]).toContain(sc.status.grade);
    expect(typeof sc.status.healthScore).toBe("number");
    // Metrics carry revenue/ROI when revenuePerConversion is supplied.
    expect(typeof sc.metrics.roiPct).toBe("number");
    expect(sc.metrics.revenue).toBeGreaterThan(0);
    // Composed from the two sub-tools.
    expect(sc.composedFrom).toEqual(["marketing_audit", "scenario_planner"]);
    // Risks surface the untracked Telegram channel.
    expect(sc.risks.join(" ")).toContain("Telegram Ads");
    // +15% budget upside computed (diminishing returns ⇒ positive but bounded).
    expect(sc.upside.projectedExtraConversions).toBeGreaterThan(0);
    expect(typeof sc.nextStep).toBe("string");
  });

  it("creative_fatigue flags a burning-out creative and ranks worst-first", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 78,
      method: "tools/call",
      params: {
        name: "creative_fatigue",
        arguments: {
          creatives: [
            { name: "Видео A", ctr: [2.1, 2.0, 1.7, 1.4, 1.1, 0.9] },
            { name: "Карусель B", ctr: [1.3, 1.35, 1.3, 1.28, 1.32, 1.3] },
          ],
          refreshThresholdPct: 70,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.creatives).toHaveLength(2);
    // Видео A peaked at 2.1, now 0.9 (~43% of peak < 70%) ⇒ refresh now, worst-first.
    const worst = sc.creatives[0];
    expect(worst.name).toBe("Видео A");
    expect(worst.recommendation).toBe("refresh_now");
    expect(worst.declineFromPeakPct).toBeGreaterThan(30);
    expect(sc.summary.refreshNow).toContain("Видео A");
    // Карусель B is roughly flat ⇒ not a refresh-now candidate.
    const flat = sc.creatives.find((c: any) => c.name === "Карусель B");
    expect(flat.recommendation).not.toBe("refresh_now");
  });

  it("price_optimizer fits elastic demand and finds the profit-max price", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 79,
      method: "tools/call",
      params: {
        name: "price_optimizer",
        arguments: {
          product: "Подписка PRO",
          // Q ≈ a·P^(-2): elastic demand (e≈2).
          observations: [
            { price: 800, units: 1563 },
            { price: 1000, units: 1000 },
            { price: 1250, units: 640 },
          ],
          unitCost: 400,
          currentPrice: 1000,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.fit.regime).toBe("elastic");
    expect(sc.fit.elasticity).toBeGreaterThan(1);
    // P* = cost·e/(e−1) ≈ 400·2/1 = 800.
    expect(sc.optimalPrice).toBeGreaterThan(650);
    expect(sc.optimalPrice).toBeLessThan(950);
    expect(sc.atOptimal.profit).toBeGreaterThan(0);
    expect(typeof sc.current.profitUpliftVsOptimal).toBe("number");
  });

  it("influencer_planner ranks roster, flags fraud and builds a budget mix", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 80,
      method: "tools/call",
      params: {
        name: "influencer_planner",
        arguments: {
          influencers: [
            { name: "Микро A", followers: 50000, price: 60000, erPct: 3.0, audienceMatchPct: 80 },
            { name: "Мега B", followers: 2000000, price: 700000, erPct: 0.9 },
            { name: "Накрутка C", followers: 80000, price: 90000, erPct: 25 },
          ],
          budget: 200000,
          goal: "conversions",
          expectedCvrPct: 1.5,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.influencers).toHaveLength(3);
    // Накрутка C has an absurd ER for its tier ⇒ a fraud flag.
    const fraud = sc.influencers.find((i: any) => i.name === "Накрутка C");
    expect(fraud.flags.length).toBeGreaterThan(0);
    // Budget mix should stay within budget and pick ≥1 creator.
    expect(sc.recommendedMix.count).toBeGreaterThanOrEqual(1);
    expect(sc.recommendedMix.totalCost).toBeLessThanOrEqual(200000);
    expect(sc.recommendedMix.estConversions).toBeGreaterThan(0);
  });

  it("reach_frequency computes net/effective reach from budget+cpm and universe", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 81,
      method: "tools/call",
      params: {
        name: "reach_frequency",
        arguments: { audienceSize: 1_000_000, budget: 3_000_000, cpm: 300, effectiveFreq: 3, frequencyCap: 5 },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // 3,000,000 / 300 * 1000 = 10,000,000 impressions ⇒ λ=10 ⇒ near-total net reach.
    expect(sc.grossImpressions).toBe(10000000);
    expect(sc.netReach.pct).toBeGreaterThan(95);
    expect(sc.averageFrequency).toBeGreaterThan(3);
    expect(sc.effectiveReach.pct).toBeGreaterThan(90);
    expect(sc.costPerReachedPerson).toBeGreaterThan(0);
    // With λ=10 and cap=5 there should be meaningful over-cap waste.
    expect(sc.frequencyCap.wastedImpressionsAboveCap).toBeGreaterThan(0);
  });

  it("brand_lift (measure) computes a significant lift with z-test and CI", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 82,
      method: "tools/call",
      params: {
        name: "brand_lift",
        arguments: {
          metric: "ad recall",
          control: { n: 800, positive: 120 },
          exposed: { n: 800, positive: 240 },
          alpha: 0.05,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.mode).toBe("measure");
    expect(sc.control.ratePct).toBe(15);
    expect(sc.exposed.ratePct).toBe(30);
    expect(sc.absoluteLiftPp).toBeCloseTo(15, 1);
    expect(sc.significant).toBe(true);
    expect(sc.pValue).toBeLessThan(0.05);
    expect(sc.absoluteLiftCiPp).toHaveLength(2);
  });

  it("brand_lift (design) returns a required sample size per cell", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 83,
      method: "tools/call",
      params: {
        name: "brand_lift",
        arguments: { metric: "awareness", baseRatePct: 20, targetAbsoluteLiftPp: 5, alpha: 0.05, power: 0.8 },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.mode).toBe("design");
    expect(sc.requiredSamplePerCell).toBeGreaterThan(0);
    expect(sc.requiredSampleTotal).toBe(sc.requiredSamplePerCell * 2);
  });

  it("channel_overlap dedupes cross-channel reach and ranks incremental contribution", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 84,
      method: "tools/call",
      params: {
        name: "channel_overlap",
        arguments: {
          audienceSize: 1_000_000,
          channels: [
            { name: "TV", reachPct: 50 },
            { name: "OLV", reachPct: 30 },
            { name: "Соцсети", reachPct: 20 },
          ],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // Combined = 1-(0.5*0.7*0.8)=0.72 ⇒ 72%.
    expect(sc.combinedReach.pct).toBeCloseTo(72, 0);
    // Gross summed = 100% of universe; duplication = gross - combined > 0.
    expect(sc.grossSummedReach).toBe(1000000);
    expect(sc.duplication.people).toBeGreaterThan(0);
    expect(sc.channels).toHaveLength(3);
    // TV has the largest individual reach ⇒ most additive unique reach here.
    expect(sc.mostAdditiveChannel.name).toBe("TV");
  });

  it("production_estimator builds a costed breakdown with a timeline and range", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 85,
      method: "tools/call",
      params: {
        name: "production_estimator",
        arguments: {
          deliverables: [
            { type: "video", quantity: 1, complexity: "complex" },
            { type: "video_cutdown", quantity: 6 },
            { type: "static", quantity: 20 },
          ],
          tier: "premium",
          rushPct: 20,
          contingencyPct: 10,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.tier).toBe("premium");
    expect(sc.deliverables).toHaveLength(3);
    expect(sc.costs.total).toBeGreaterThan(0);
    expect(sc.costs.rush).toBeGreaterThan(0);
    expect(sc.costs.totalRange.low).toBeLessThan(sc.costs.total);
    expect(sc.costs.totalRange.high).toBeGreaterThan(sc.costs.total);
    expect(sc.timeline.estimatedWeeks).toBeGreaterThan(0);
  });

  it("media_flowchart distributes budget front-loaded with a channel split", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 86,
      method: "tools/call",
      params: {
        name: "media_flowchart",
        arguments: {
          totalBudget: 10_000_000,
          weeks: 8,
          pattern: "front_loaded",
          channels: [
            { name: "OLV", sharePct: 50 },
            { name: "Соцсети", sharePct: 30 },
            { name: "Поиск", sharePct: 20 },
          ],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.pattern).toBe("front_loaded");
    expect(sc.flowchart).toHaveLength(8);
    // Front-loaded ⇒ week 1 is the peak and bigger than week 8.
    expect(sc.peakWeek.week).toBe(1);
    expect(sc.flowchart[0].budget).toBeGreaterThan(sc.flowchart[7].budget);
    // Weekly budgets sum to the total (within rounding).
    const sum = sc.flowchart.reduce((s: number, r: any) => s + r.budget, 0);
    expect(Math.abs(sum - 10_000_000)).toBeLessThan(50);
    // Channel split present on on-air weeks.
    expect(sc.flowchart[0].channels).toHaveLength(3);
  });

  it("geo_holdout (measure) computes a significant incremental lift", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 87,
      method: "tools/call",
      params: {
        name: "geo_holdout",
        arguments: { testConversions: 1200, counterfactualConversions: 1000, testSpend: 500000, alpha: 0.05 },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.mode).toBe("measure");
    expect(sc.incrementalConversions).toBe(200);
    expect(sc.liftPct).toBeCloseTo(20, 0);
    expect(sc.significant).toBe(true);
    expect(sc.incrementalCpa).toBe(2500);
  });

  it("geo_holdout (design) returns MDE and required baseline for a target lift", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 88,
      method: "tools/call",
      params: {
        name: "geo_holdout",
        arguments: { baselineConversions: 5000, targetLiftPct: 10, weeklyBaselineConversions: 1000, alpha: 0.05, power: 0.8 },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.mode).toBe("design");
    expect(sc.minimumDetectableLiftPct).toBeGreaterThan(0);
    expect(sc.target.requiredBaselineConversions).toBeGreaterThan(0);
    expect(sc.target.recommendedWeeks).toBeGreaterThan(0);
  });

  it("sov_tracker computes SOV, ESOV and predicted share growth", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 89,
      method: "tools/call",
      params: {
        name: "sov_tracker",
        arguments: {
          brandSpend: 10_000_000,
          competitors: [
            { name: "A", spend: 8_000_000 },
            { name: "B", spend: 7_000_000 },
          ],
          marketSharePct: 30,
          targetShareGrowthPp: 2,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // SOV = 10M / 25M = 40%; ESOV = 40 - 30 = 10pp; growth = 10 * 0.05 = 0.5pp.
    expect(sc.sovPct).toBeCloseTo(40, 0);
    expect(sc.esovPp).toBeCloseTo(10, 0);
    expect(sc.predictedAnnualShareGrowthPp).toBeCloseTo(0.5, 1);
    expect(sc.stance).toBe("investing_for_growth");
    expect(sc.target.requiredSovPct).toBeGreaterThan(40);
  });

  it("media_quality_score grades delivery and flags weak metrics", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 90,
      method: "tools/call",
      params: {
        name: "media_quality_score",
        arguments: {
          placement: "Сеть X",
          isVideo: true,
          viewabilityPct: 45,
          invalidTrafficPct: 8,
          completionPct: 60,
          brandSafePct: 92,
          onTargetPct: 75,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.qualityScore).toBeGreaterThanOrEqual(0);
    expect(sc.qualityScore).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(sc.grade);
    // Viewability 45% < 70% video threshold and IVT 8% > 3% ⇒ both flagged.
    expect(sc.flags).toContain("Viewability");
    expect(sc.flags).toContain("Invalid traffic (IVT)");
    expect(sc.metrics.length).toBe(5);
  });

  it("competitive_response models SOV erosion and sizes the defense budget", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 91,
      method: "tools/call",
      params: {
        name: "competitive_response",
        arguments: { yourSpend: 10_000_000, competitorSpend: 10_000_000, competitorIncreasePct: 50 },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // SOV before = 50%; after comp +50% (15M): 10/25 = 40% ⇒ erosion 10pp.
    expect(sc.sovBeforePct).toBeCloseTo(50, 0);
    expect(sc.sovAfterPct).toBeCloseTo(40, 0);
    expect(sc.sovErosionPp).toBeCloseTo(10, 0);
    expect(sc.cpmInflationPct).toBeGreaterThan(0);
    expect(sc.posture).toBe("defend_or_pivot");
    // Defend 50% vs 15M competitor ⇒ need 15M ⇒ +5M.
    expect(sc.defense.additionalSpendToDefend).toBeCloseTo(5_000_000, -3);
  });

  it("budget_pacing_forecast projects overpacing from a rising trend", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 92,
      method: "tools/call",
      params: {
        name: "budget_pacing_forecast",
        arguments: {
          totalBudget: 1_000_000,
          daysTotal: 30,
          daysElapsed: 10,
          spendToDate: 300_000,
          recentDailySpend: [40_000, 45_000, 50_000],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.usedTrend).toBe(true);
    // trend ~45k/day → 300k + 45k*20 = 1.2M ⇒ +20% over budget.
    expect(sc.projectedEndSpend).toBeGreaterThan(1_000_000);
    expect(sc.status).toBe("overpacing");
    expect(sc.willExhaustEarly).toBe(true);
    expect(sc.recommendedDailyRate).toBeCloseTo(35_000, -3);
  });

  it("audience_overlap dedups two segments exactly and rates duplication", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 93,
      method: "tools/call",
      params: {
        name: "audience_overlap",
        arguments: {
          segments: [
            { name: "VK", size: 40 },
            { name: "Telegram", size: 30 },
          ],
          overlaps: [{ a: "VK", b: "Telegram", overlap: 12 }],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // Union = 40 + 30 - 12 = 58; gross 70 ⇒ duplication 12/70 = 17.1%.
    expect(sc.grossReach).toBeCloseTo(70, 0);
    expect(sc.dedupReach).toBeCloseTo(58, 0);
    expect(sc.duplicationPct).toBeCloseTo(17.1, 0);
    expect(sc.approximate).toBe(false);
    expect(sc.perSegment.length).toBe(2);
  });

  it("audience_overlap flags ≥3 segments as an approximate estimate", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 94,
      method: "tools/call",
      params: {
        name: "audience_overlap",
        arguments: {
          segments: [
            { name: "VK", size: 40 },
            { name: "Telegram", size: 30 },
            { name: "OLV", size: 25 },
          ],
          overlaps: [
            { a: "VK", b: "Telegram", overlap: 12 },
            { a: "VK", b: "OLV", overlap: 8 },
            { a: "Telegram", b: "OLV", overlap: 6 },
          ],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.approximate).toBe(true);
    expect(sc.dedupReach).toBeLessThan(sc.grossReach);
    expect(sc.duplicationMatrix.length).toBe(3);
  });

  it("creative_rotation allocates by fatigue-adjusted value and retires burnt creatives", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 95,
      method: "tools/call",
      params: {
        name: "creative_rotation",
        arguments: {
          creatives: [
            { name: "A", performance: 1.8, cumulativeImpressions: 500_000 },
            { name: "B", performance: 1.2, cumulativeImpressions: 3_000_000 },
            { name: "C", performance: 2.1, cumulativeImpressions: 100_000 },
          ],
          nextPeriodImpressions: 1_000_000,
          maxSharePct: 40,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // B has 3M served > 2M half-life ⇒ decay < 0.5 ⇒ retire.
    expect(sc.retire).toContain("B");
    expect(sc.newCreativesNeeded).toBe(1);
    // No creative exceeds the 40% cap.
    const maxShare = Math.max(...sc.creatives.map((c) => c.sharePct));
    expect(maxShare).toBeLessThanOrEqual(40.01);
    expect(sc.projectedOutcomes).toBeGreaterThan(0);
  });

  it("utm_taxonomy_qa scores consistency and finds variant clusters", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 97,
      method: "tools/call",
      params: {
        name: "utm_taxonomy_qa",
        arguments: {
          urls: [
            "https://x.ru/?utm_source=vk&utm_medium=cpc&utm_campaign=spring",
            "https://x.ru/?utm_source=VK&utm_medium=social&utm_campaign=spring sale",
            "https://x.ru/?utm_medium=cpc&utm_campaign=spring",
          ],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.urlsAudited).toBe(3);
    // "vk" vs "VK" → uppercase + variant cluster; "spring sale" → spaces; row 3 missing utm_source.
    expect(sc.issueCounts.uppercase).toBeGreaterThanOrEqual(1);
    expect(sc.issueCounts.spaces).toBeGreaterThanOrEqual(1);
    expect(sc.issueCounts.missing_required).toBeGreaterThanOrEqual(1);
    expect(sc.variantClusters.length).toBeGreaterThanOrEqual(1);
    expect(sc.consistencyScore).toBeLessThan(100);
  });

  it("incrementality_meta pools tests and reports heterogeneity", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: {
        name: "incrementality_meta",
        arguments: {
          tests: [
            { name: "Geo Q1", liftPct: 8, se: 3 },
            { name: "AB June", liftPct: 6, se: 2 },
            { name: "Holdout South", liftPct: 10, se: 4 },
          ],
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.testsPooled).toBe(3);
    // Pooled lift should sit between the min and max inputs.
    expect(sc.fixedEffect.pooledLiftPct).toBeGreaterThan(6);
    expect(sc.fixedEffect.pooledLiftPct).toBeLessThan(10);
    expect(sc.fixedEffect.significant).toBe(true);
    expect(sc.heterogeneity.I2Pct).toBeGreaterThanOrEqual(0);
    expect(["fixed_effect", "random_effects"]).toContain(sc.preferredModel);
    const wSum = sc.perTest.reduce((s, t) => s + t.weightFixedPct, 0);
    expect(wSum).toBeCloseTo(100, 0);
  });

  it("search_planner allocates a budget to the most efficient keywords first", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: {
        name: "search_planner",
        arguments: {
          keywords: [
            { term: "купить диван", volume: 40000, cpc: 35, ctr: 5, cvr: 3 },
            { term: "диван цена", volume: 12000, cpc: 28, ctr: 4, cvr: 1 },
          ],
          monthlyBudget: 100000,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.keywordsCount).toBe(2);
    // Total allocated spend cannot exceed the budget.
    expect(sc.totals.spend).toBeLessThanOrEqual(100000);
    expect(sc.totals.conversions).toBeGreaterThan(0);
    expect(sc.totals.blendedCpa).toBeGreaterThan(0);
    // The high-CVR keyword should be flagged the higher priority.
    const buy = sc.keywords.find((k) => k.term === "купить диван");
    expect(buy.priority).toBe("high");
  });

  it("search_planner falls back to default CTR/CVR and notes it", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: {
        name: "search_planner",
        arguments: { keywords: [{ term: "ключ", volume: 10000, cpc: 30 }] },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.keywords[0].ctrPct).toBe(4);
    expect(sc.keywords[0].cvrPct).toBe(2);
    expect(sc.assumptions.some((a: string) => a.includes("дефолт"))).toBe(true);
  });

  it("retail_media_planner computes ДРР/ROAS and allocates a budget profit-first", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 103,
      method: "tools/call",
      params: {
        name: "retail_media_planner",
        arguments: {
          placements: [
            { name: "Ozon поиск", type: "search", model: "CPC", cpc: 18, cvr: 6 },
            { name: "WB карточка", type: "catalog", model: "CPM", cpm: 250, ctr: 1.2, cvr: 5 },
          ],
          aov: 2500,
          commissionPct: 15,
          monthlyBudget: 300000,
          targetDrrPct: 20,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.placementsCount).toBe(2);
    expect(sc.totals).not.toBeNull();
    expect(sc.totals.spend).toBeLessThanOrEqual(300000);
    expect(sc.totals.revenue).toBeGreaterThan(0);
    expect(typeof sc.totals.blendedDrrPct).toBe("number");
    // Each placement reports a ROAS and a ДРР.
    expect(typeof sc.placements[0].roas).toBe("number");
    expect(sc.targetDrrCheck.targetDrrPct).toBe(20);
  });

  it("retail_media_planner reports unit economics only when no budget/caps are given", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 104,
      method: "tools/call",
      params: {
        name: "retail_media_planner",
        arguments: {
          placements: [{ name: "Я.Маркет", model: "CPC", cpc: 20, cvr: 4 }],
          aov: 3000,
        },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.totals).toBeNull();
    expect(sc.placements[0].roas).toBeGreaterThan(0);
    expect(sc.warnings.some((w: string) => w.includes("капов"))).toBe(true);
  });

  it("share_of_search computes SoS, rank and the SoS↔share gap", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 105,
      method: "tools/call",
      params: {
        name: "share_of_search",
        arguments: {
          brandVolume: 120000,
          competitors: [
            { name: "Конкурент A", volume: 90000 },
            { name: "Конкурент B", volume: 60000 },
          ],
          marketSharePct: 35,
          previousSosPct: 40,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    // 120000 / 270000 ≈ 44.4%
    expect(sc.sosPct).toBeCloseTo(44.4, 0);
    expect(sc.rank).toBe(1);
    expect(sc.fieldSize).toBe(3);
    // SoS (44.4) > share (35) ⇒ demand ahead of share.
    expect(sc.sosShareGapPp).toBeGreaterThan(0);
    expect(sc.stance).toBe("demand_ahead_of_share");
    expect(sc.sosTrendPp).toBeCloseTo(4.4, 0);
    expect(sc.projectedMarketSharePct).toBeGreaterThan(35);
  });

  it("share_of_search accepts a direct sosPct and notes a missing share reference", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 106,
      method: "tools/call",
      params: { name: "share_of_search", arguments: { sosPct: 30 } },
    });
    const sc = json.result.structuredContent;
    expect(sc.sosPct).toBe(30);
    expect(sc.stance).toBe("no_share_reference");
    expect(sc.sosShareGapPp).toBeNull();
  });

  it("churn_predictor computes churn, revenue at risk and retention ROI", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 107,
      method: "tools/call",
      params: {
        name: "churn_predictor",
        arguments: {
          monthlyChurnRatePct: 5,
          customers: 10000,
          arpuMonthly: 1000,
          horizonMonths: 12,
          reduceChurnByPp: 1.5,
          programCost: 3000000,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.monthlyChurnPct).toBe(5);
    // annual churn 1-(0.95)^12 ≈ 46%
    expect(sc.annualChurnPct).toBeGreaterThan(40);
    expect(sc.avgLifetimeMonths).toBeCloseTo(20, 0);
    expect(sc.ltvPerCustomer).toBeGreaterThan(0);
    expect(sc.revenue.revenueAtRiskOverHorizon).toBeGreaterThan(0);
    // lower churn ⇒ higher LTV
    expect(sc.retentionInitiative.newLtv).toBeGreaterThan(sc.ltvPerCustomer);
    expect(typeof sc.retentionInitiative.roiPct).toBe("number");
  });

  it("churn_predictor derives monthly churn from a cohort", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 108,
      method: "tools/call",
      params: {
        name: "churn_predictor",
        arguments: { customersStart: 1000, customersRetained: 820, periodMonths: 3 },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.churnSource).toBe("cohort");
    // 1-(0.82)^(1/3) ≈ 6.4%
    expect(sc.monthlyChurnPct).toBeCloseTo(6.4, 0);
  });

  it("frequency_cap_optimizer recommends a cap and quantifies over-cap waste", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 109,
      method: "tools/call",
      params: {
        name: "frequency_cap_optimizer",
        arguments: { audienceSize: 1000000, impressions: 8000000, effectiveFreq: 3, maxCap: 10 },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.naturalAvgFrequency).toBeCloseTo(8, 0);
    expect(sc.caps.length).toBeGreaterThan(0);
    // A recommended cap exists and lies within the tested range.
    expect(sc.recommendedCap).toBeGreaterThanOrEqual(3);
    expect(sc.recommendedCap).toBeLessThanOrEqual(10);
    // Optimizing should not reduce effective reach below the baseline.
    expect(sc.recommendation.optimizedEffectiveReachPct).toBeGreaterThanOrEqual(sc.baseline.effectiveReachPct);
    // At a heavy avg frequency of 8, a low cap wastes a large share of impressions.
    const capAt3 = sc.caps.find((c) => c.cap === 3);
    expect(capAt3.overCapWastedPct).toBeGreaterThan(0);
  });

  it("creative_testing_matrix flags a clear winner against control", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 110,
      method: "tools/call",
      params: {
        name: "creative_testing_matrix",
        arguments: {
          arms: [
            { name: "Контроль", visitors: 50000, conversions: 1500 },
            { name: "Вариант A", visitors: 50000, conversions: 1900 },
            { name: "Вариант B", visitors: 50000, conversions: 1520 },
          ],
          control: "Контроль",
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.control.name).toBe("Контроль");
    expect(sc.comparisons).toBe(2);
    const a = sc.arms.find((x) => x.name === "Вариант A");
    // +400 conv on 50k each is a large, significant lift.
    expect(a.significant).toBe(true);
    expect(a.decision).toBe("WINNER");
    const b = sc.arms.find((x) => x.name === "Вариант B");
    expect(b.significant).toBe(false);
  });

  it("creative_testing_matrix keeps testing when the effect is not yet significant", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 111,
      method: "tools/call",
      params: {
        name: "creative_testing_matrix",
        arguments: {
          arms: [
            { name: "Control", visitors: 800, conversions: 40 },
            { name: "B", visitors: 800, conversions: 46 },
          ],
        },
      },
    });
    const sc = json.result.structuredContent;
    const b = sc.arms[0];
    expect(b.significant).toBe(false);
    expect(["KEEP_TESTING", "INSUFFICIENT_DATA"]).toContain(b.decision);
    if (b.decision === "KEEP_TESTING") expect(b.additionalSamplePerArm).toBeGreaterThan(0);
  });

  it("landing_cro_audit scores a weak page, lists issues and projects uplift", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 112,
      method: "tools/call",
      params: {
        name: "landing_cro_audit",
        arguments: {
          conversionRatePct: 1.5,
          loadTimeSec: 5.5,
          bounceRatePct: 72,
          mobileConversionRatePct: 0.6,
          formFields: 11,
          hasClearCta: false,
          aboveFoldCta: false,
          hasSocialProof: false,
          hasTrustSignals: false,
          monthlyVisitors: 100000,
          aov: 4000,
        },
      },
    });
    expect(json.result.isError).toBeUndefined();
    const sc = json.result.structuredContent;
    expect(sc.croScore).toBeLessThan(60); // a clearly weak page
    expect(["D", "F"]).toContain(sc.grade);
    expect(sc.prioritizedIssues.length).toBeGreaterThan(0);
    expect(sc.projectedRelativeUpliftPct).toBeGreaterThan(0);
    expect(sc.projection.projectedCRPct).toBeGreaterThan(sc.projection.currentCRPct);
    expect(sc.projection.incrementalRevenuePerMonth).toBeGreaterThan(0);
  });

  it("landing_cro_audit errors when no signals are supplied", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 113,
      method: "tools/call",
      params: { name: "landing_cro_audit", arguments: {} },
    });
    expect(json.result.isError).toBe(true);
  });

  it("response_curve splits evenly and warns when no channel has conversions", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 60,
      method: "tools/call",
      params: {
        name: "response_curve",
        arguments: {
          channels: [
            { name: "A", currentSpend: 50000, currentConversions: 0 },
            { name: "B", currentSpend: 50000, currentConversions: 0 },
          ],
        },
      },
    });
    const sc = json.result.structuredContent;
    expect(sc.channels[0].recommendedSpend).toBe(sc.channels[1].recommendedSpend);
    expect(sc.warnings.length).toBeGreaterThan(0);
  });
});

describe("infrastructure: KV data + SSE", () => {
  // In-memory KV double honoring the type hint.
  function fakeKv(initial: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>(Object.entries(initial));
    return {
      async get(key: string, type?: "text" | "json") {
        const v = store.get(key);
        if (v == null) return null;
        if (type === "json") return typeof v === "string" ? JSON.parse(v) : v;
        return typeof v === "string" ? v : JSON.stringify(v);
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    };
  }

  it("ru_benchmarks reflects KV override benchmarks when NECTARIN_KV is bound", async () => {
    const override = {
      "VK Ads": {
        CPM: { p25: 1, p50: 2, p75: 3 },
        CTR: { p25: 1, p50: 1, p75: 1 },
        CPA: { p25: 111, p50: 222, p75: 333 },
        VTR: { p25: 1, p50: 1, p75: 1 },
      },
    };
    const env = devEnv({ NECTARIN_KV: fakeKv({ "benchmarks:retail": override }) as any });
    const { status, json } = await rpc(
      { jsonrpc: "2.0", id: 40, method: "tools/call", params: { name: "ru_benchmarks", arguments: { category: "retail", kpi: "CPA" } } },
      env
    );
    expect(status).toBe(200);
    // The override (p50 = 222, single platform) should be visible in the output.
    expect(JSON.stringify(json.result)).toContain("222");
    // restore mock for later tests by issuing a plain devEnv request
    await rpc({ jsonrpc: "2.0", id: 41, method: "ping" });
  });

  it("/health reports kv binding + dataSource + llmCache", async () => {
    const env = devEnv({ NECTARIN_KV: fakeKv() as any });
    const { json } = await get("/health", env);
    expect(json.kv).toBe("bound");
    expect(json.dataSource).toBe("kv-layered");
    expect(json.llmCache).toBeDefined();
    await rpc({ jsonrpc: "2.0", id: 42, method: "ping" }); // reset data source to mock
  });

  it("returns an SSE frame when the client opts in via Accept: text/event-stream", async () => {
    const { res } = await rpc(
      { jsonrpc: "2.0", id: 43, method: "tools/list" },
      devEnv(),
      { accept: "text/event-stream" }
    );
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body.startsWith("event: message")).toBe(true);
    expect(body).toContain('"jsonrpc":"2.0"');
    // The SSE data line must carry the tools/list result.
    const dataLine = body.split("\n").find((l) => l.startsWith("data: "))!;
    const parsed = JSON.parse(dataLine.slice("data: ".length));
    expect(parsed.result.tools.length).toBe(63);
  });

  it("still returns JSON for the common Accept (application/json + event-stream)", async () => {
    const { status, json } = await rpc(
      { jsonrpc: "2.0", id: 44, method: "ping" },
      devEnv(),
      { accept: "application/json, text/event-stream" }
    );
    expect(status).toBe(200);
    expect(json.jsonrpc).toBe("2.0");
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
    expect(json.result.tools).toHaveLength(63);
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
    expect(json.result.tools).toHaveLength(63);
  });

  it("/version reports authMode shared-token when configured", async () => {
    const { json } = await get("/version", devEnv({ MCP_SHARED_TOKEN: "s3cret-token" }));
    expect(json.authMode).toBe("shared-token");
  });
});

describe("prompts", () => {
  it("prompts/list returns all 40 guided prompts incl. the new ones", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 60, method: "prompts/list" });
    const names = json.result.prompts.map((p: any) => p.name);
    expect(json.result.prompts).toHaveLength(40);
    expect(names).toContain("full_strategy");
    expect(names).toContain("creative_lab");
    expect(names).toContain("growth_monitor");
    expect(names).toContain("launch_flight");
    expect(names).toContain("performance_review");
    expect(names).toContain("saturation_reallocation");
    expect(names).toContain("mmm_planning");
    expect(names).toContain("quarter_plan");
    expect(names).toContain("account_audit");
    expect(names).toContain("scenario_review");
    expect(names).toContain("promo_review");
    expect(names).toContain("exec_report");
    expect(names).toContain("creative_fatigue_check");
    expect(names).toContain("price_optimization");
    expect(names).toContain("influencer_plan");
    expect(names).toContain("olv_plan");
    expect(names).toContain("brand_lift_study");
    expect(names).toContain("omnichannel_reach");
    expect(names).toContain("production_budget");
    expect(names).toContain("flighting_plan");
    expect(names).toContain("geo_test");
    expect(names).toContain("sov_analysis");
    expect(names).toContain("media_quality_check");
    expect(names).toContain("competitive_wargame");
    expect(names).toContain("pacing_forecast");
    expect(names).toContain("audience_dedup");
    expect(names).toContain("creative_rotation_plan");
    expect(names).toContain("utm_audit");
    expect(names).toContain("meta_analysis");
    expect(names).toContain("search_plan");
    expect(names).toContain("retail_media_plan");
    expect(names).toContain("share_of_search_check");
    expect(names).toContain("churn_analysis");
    expect(names).toContain("frequency_cap_plan");
    expect(names).toContain("creative_test_readout");
    expect(names).toContain("landing_cro_audit_run");
  });

  it("prompts/get quarter_plan embeds the inputs and calls gtm_calendar", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 68,
      method: "prompts/get",
      params: { name: "quarter_plan", arguments: { category: "ecom", budget: "12000000", goal: "performance", horizonWeeks: "12" } },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("gtm_calendar");
    expect(text).toContain("ecom");
    expect(text).toContain("12000000");
  });

  it("prompts/get account_audit embeds the channels and calls marketing_audit", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 69,
      method: "prompts/get",
      params: { name: "account_audit", arguments: { category: "ecom", channels: "Yandex Direct:900000:520, VK Ads:600000:180", targetCpa: "1500" } },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("marketing_audit");
    expect(text).toContain("Yandex Direct:900000:520");
    expect(text).toContain("1500");
  });

  it("prompts/get scenario_review embeds the inputs and calls scenario_planner", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 70,
      method: "prompts/get",
      params: {
        name: "scenario_review",
        arguments: {
          channels: "Yandex Direct:900000:600, VK Ads:600000:180",
          scenarios: "Консервативный:0.8, Базовый:1.0, Агрессивный:1.5",
          objective: "max_roi",
          revenuePerConversion: "4000",
        },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("scenario_planner");
    expect(text).toContain("Yandex Direct:900000:600");
    expect(text).toContain("Агрессивный:1.5");
    expect(text).toContain("4000");
  });

  it("prompts/get promo_review embeds the inputs and calls promo_planner", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 71,
      method: "prompts/get",
      params: {
        name: "promo_review",
        arguments: {
          price: "1000",
          unitCost: "400",
          baselineUnits: "1000",
          discountPct: "20",
          expectedUpliftPct: "60",
          product: "Подписка PRO",
        },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("promo_planner");
    expect(text).toContain("Подписка PRO");
    expect(text).toContain("20%");
  });

  it("prompts/get exec_report embeds the inputs and calls board_report", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 72,
      method: "prompts/get",
      params: {
        name: "exec_report",
        arguments: {
          category: "ecom",
          company: "Acme",
          channels: "Yandex Direct:900000:900, VK Ads:600000:60, Telegram Ads:200000:0",
          targetCpa: "1500",
        },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("board_report");
    expect(text).toContain("Acme");
    expect(text).toContain("Yandex Direct:900000:900");
  });

  it("prompts/get creative_fatigue_check embeds the series and calls creative_fatigue", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 73,
      method: "prompts/get",
      params: {
        name: "creative_fatigue_check",
        arguments: { creatives: "Видео A:2.1,2.0,1.7,1.4,1.1; Карусель B:1.3,1.35,1.3,1.28" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("creative_fatigue");
    expect(text).toContain("Видео A:2.1,2.0,1.7,1.4,1.1");
  });

  it("prompts/get price_optimization embeds the inputs and calls price_optimizer", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 74,
      method: "prompts/get",
      params: {
        name: "price_optimization",
        arguments: { observations: "1000:520, 900:640, 800:760", unitCost: "400", currentPrice: "1000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("price_optimizer");
    expect(text).toContain("1000:520, 900:640, 800:760");
    expect(text).toContain("400");
  });

  it("prompts/get influencer_plan embeds the roster and calls influencer_planner", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 75,
      method: "prompts/get",
      params: {
        name: "influencer_plan",
        arguments: { influencers: "Блогер A|250000|180000|3.2; Блогер B|1200000|600000|0.9", budget: "500000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("influencer_planner");
    expect(text).toContain("Блогер A|250000|180000|3.2");
  });

  it("prompts/get olv_plan embeds the inputs and calls reach_frequency", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 76,
      method: "prompts/get",
      params: {
        name: "olv_plan",
        arguments: { audienceSize: "1000000", budget: "3000000", cpm: "300", effectiveFreq: "3" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("reach_frequency");
    expect(text).toContain("1000000");
  });

  it("prompts/get brand_lift_study (measure) embeds cells and calls brand_lift", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 77,
      method: "prompts/get",
      params: {
        name: "brand_lift_study",
        arguments: { metric: "ad recall", control: "600,90", exposed: "600,150" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("brand_lift");
    expect(text).toContain("600,90");
  });

  it("prompts/get omnichannel_reach embeds channels and calls channel_overlap", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 78,
      method: "prompts/get",
      params: {
        name: "omnichannel_reach",
        arguments: { audienceSize: "1000000", channels: "TV:45; OLV:30; Соцсети:25" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("channel_overlap");
    expect(text).toContain("TV:45; OLV:30; Соцсети:25");
  });

  it("prompts/get production_budget embeds deliverables and calls production_estimator", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 79,
      method: "prompts/get",
      params: {
        name: "production_budget",
        arguments: { deliverables: "video×1:complex; video_cutdown×6; static×20", tier: "premium" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("production_estimator");
    expect(text).toContain("video×1:complex");
  });

  it("prompts/get flighting_plan embeds inputs and calls media_flowchart", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 80,
      method: "prompts/get",
      params: {
        name: "flighting_plan",
        arguments: { totalBudget: "10000000", weeks: "8", pattern: "burst", channels: "OLV:50; Соцсети:30; Поиск:20" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("media_flowchart");
    expect(text).toContain("OLV:50; Соцсети:30; Поиск:20");
  });

  it("prompts/get geo_test (measure) embeds inputs and calls geo_holdout", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 81,
      method: "prompts/get",
      params: {
        name: "geo_test",
        arguments: { testConversions: "1200", counterfactualConversions: "1000", testSpend: "500000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("geo_holdout");
    expect(text).toContain("1200");
  });

  it("prompts/get sov_analysis embeds inputs and calls sov_tracker", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 82,
      method: "prompts/get",
      params: {
        name: "sov_analysis",
        arguments: { brandSpend: "10000000", competitors: "Конкурент A:8000000; Конкурент B:5000000", marketSharePct: "30" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("sov_tracker");
    expect(text).toContain("Конкурент A:8000000");
  });

  it("prompts/get media_quality_check embeds inputs and calls media_quality_score", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 83,
      method: "prompts/get",
      params: {
        name: "media_quality_check",
        arguments: { placement: "Сеть X", viewabilityPct: "45", invalidTrafficPct: "8" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("media_quality_score");
    expect(text).toContain("Сеть X");
  });

  it("prompts/get competitive_wargame embeds inputs and calls competitive_response", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 84,
      method: "prompts/get",
      params: {
        name: "competitive_wargame",
        arguments: { yourSpend: "10000000", competitorSpend: "10000000", competitorIncreasePct: "50" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("competitive_response");
    expect(text).toContain("10000000");
  });

  it("prompts/get pacing_forecast embeds inputs and calls budget_pacing_forecast", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 85,
      method: "prompts/get",
      params: {
        name: "pacing_forecast",
        arguments: { totalBudget: "1000000", daysTotal: "30", daysElapsed: "10", spendToDate: "300000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("budget_pacing_forecast");
    expect(text).toContain("1000000");
  });

  it("prompts/get audience_dedup embeds inputs and calls audience_overlap", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 86,
      method: "prompts/get",
      params: {
        name: "audience_dedup",
        arguments: { segments: "VK:40; Telegram:30; OLV:25", overlaps: "VK|Telegram:12; VK|OLV:8; Telegram|OLV:6" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("audience_overlap");
    expect(text).toContain("VK:40");
  });

  it("prompts/get creative_rotation_plan embeds inputs and calls creative_rotation", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 96,
      method: "prompts/get",
      params: {
        name: "creative_rotation_plan",
        arguments: { creatives: "A:1.8:500000; B:1.2:2500000; C:2.1:100000", nextPeriodImpressions: "1000000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("creative_rotation");
    expect(text).toContain("A:1.8:500000");
  });

  it("prompts/get utm_audit embeds the urls and calls utm_taxonomy_qa", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 98,
      method: "prompts/get",
      params: {
        name: "utm_audit",
        arguments: { urls: "https://x.ru/?utm_source=vk&utm_medium=cpc&utm_campaign=spring" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("utm_taxonomy_qa");
    expect(text).toContain("utm_source=vk");
  });

  it("prompts/get meta_analysis embeds the tests and calls incrementality_meta", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 100,
      method: "prompts/get",
      params: {
        name: "meta_analysis",
        arguments: { tests: "Geo Q1:8:3; AB June:6:2; Holdout South:10:4" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("incrementality_meta");
    expect(text).toContain("Geo Q1:8:3");
  });

  it("prompts/get search_plan embeds the keywords and calls search_planner", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 101,
      method: "prompts/get",
      params: {
        name: "search_plan",
        arguments: { keywords: "купить диван:40000:35:5:3; диван цена:12000:28", monthlyBudget: "100000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("search_planner");
    expect(text).toContain("купить диван:40000:35:5:3");
    expect(text).toContain("100000");
  });

  it("prompts/get retail_media_plan embeds the placements and calls retail_media_planner", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 102,
      method: "prompts/get",
      params: {
        name: "retail_media_plan",
        arguments: { placements: "Ozon поиск:CPC:18:6; WB карточка:CPM:250:5:1.2", aov: "2500", commissionPct: "15", monthlyBudget: "300000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("retail_media_planner");
    expect(text).toContain("Ozon поиск:CPC:18:6");
    expect(text).toContain("2500");
  });

  it("prompts/get share_of_search_check embeds the brands and calls share_of_search", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 103,
      method: "prompts/get",
      params: {
        name: "share_of_search_check",
        arguments: { competitors: "Наш бренд:120000, Конкурент A:90000", brand: "Наш бренд", marketSharePct: "35" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("share_of_search");
    expect(text).toContain("Наш бренд:120000");
    expect(text).toContain("35");
  });

  it("prompts/get churn_analysis embeds the inputs and calls churn_predictor", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 104,
      method: "prompts/get",
      params: {
        name: "churn_analysis",
        arguments: { churn: "5", customers: "10000", arpuMonthly: "1000", initiative: "1.5:3000000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("churn_predictor");
    expect(text).toContain("10000");
    expect(text).toContain("1.5:3000000");
  });

  it("prompts/get frequency_cap_plan embeds inputs and calls frequency_cap_optimizer", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 105,
      method: "prompts/get",
      params: {
        name: "frequency_cap_plan",
        arguments: { audienceSize: "1000000", impressions: "8000000", effectiveFreq: "3" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("frequency_cap_optimizer");
    expect(text).toContain("1000000");
    expect(text).toContain("8000000");
  });

  it("prompts/get creative_test_readout embeds the arms and calls creative_testing_matrix", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 106,
      method: "prompts/get",
      params: {
        name: "creative_test_readout",
        arguments: { arms: "Контроль:10000:320; Вариант A:10100:372", control: "Контроль" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("creative_testing_matrix");
    expect(text).toContain("Контроль:10000:320");
  });

  it("prompts/get landing_cro_audit_run embeds inputs and calls landing_cro_audit", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 107,
      method: "prompts/get",
      params: {
        name: "landing_cro_audit_run",
        arguments: { conversionRatePct: "1.5", loadTimeSec: "5.5", monthlyVisitors: "100000" },
      },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("landing_cro_audit");
    expect(text).toContain("1.5");
    expect(text).toContain("100000");
  });

  it("prompts/get mmm_planning embeds the series and calls mmm_optimize", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 67,
      method: "prompts/get",
      params: { name: "mmm_planning", arguments: { data: "Yandex Direct | spend: 500000,520000,480000,510000 | conv: 820,840,790,825", totalBudget: "1000000" } },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("mmm_optimize");
    expect(text).toContain("Yandex Direct");
    expect(text).toContain("1000000");
  });

  it("prompts/get saturation_reallocation embeds the channels and calls response_curve", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 66,
      method: "prompts/get",
      params: { name: "saturation_reallocation", arguments: { channels: "Yandex Direct:600000:900, VK Ads:600000:450", elasticity: "0.6" } },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("response_curve");
    expect(text).toContain("Yandex Direct:600000:900");
    expect(text).toContain("0.6");
  });

  it("prompts/get creative_lab interpolates args into a user message", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 61,
      method: "prompts/get",
      params: { name: "creative_lab", arguments: { product: "Кэшбэк-карта", audience: "студенты", channel: "VK Ads" } },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("creative_variants");
    expect(text).toContain("Кэшбэк-карта");
    expect(text).toContain("ab_test_planner");
  });

  it("prompts/get growth_monitor embeds the series", async () => {
    const { json } = await rpc({
      jsonrpc: "2.0",
      id: 62,
      method: "prompts/get",
      params: { name: "growth_monitor", arguments: { metric: "CPA", series: "100,102,98,480" } },
    });
    const text = json.result.messages[0].content.text;
    expect(text).toContain("anomaly_detector");
    expect(text).toContain("100,102,98,480");
  });
});
