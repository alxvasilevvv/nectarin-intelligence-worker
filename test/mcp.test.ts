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
    expect(json.toolCount).toBe(32);
    expect(json.commit).toBeDefined();
  });
});

describe("tools/list", () => {
  it("returns exactly 20 tools, each with a JSON-Schema inputSchema", async () => {
    const { status, json } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(status).toBe(200);
    const tools = json.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools).toHaveLength(32);
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
    expect(parsed.result.tools.length).toBe(32);
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
    expect(json.result.tools).toHaveLength(32);
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
    expect(json.result.tools).toHaveLength(32);
  });

  it("/version reports authMode shared-token when configured", async () => {
    const { json } = await get("/version", devEnv({ MCP_SHARED_TOKEN: "s3cret-token" }));
    expect(json.authMode).toBe("shared-token");
  });
});

describe("prompts", () => {
  it("prompts/list returns all 7 guided prompts incl. the new ones", async () => {
    const { json } = await rpc({ jsonrpc: "2.0", id: 60, method: "prompts/list" });
    const names = json.result.prompts.map((p: any) => p.name);
    expect(json.result.prompts).toHaveLength(7);
    expect(names).toContain("full_strategy");
    expect(names).toContain("creative_lab");
    expect(names).toContain("growth_monitor");
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
