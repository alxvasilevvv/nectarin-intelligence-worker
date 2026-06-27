/**
 * Unit tests for the KV layer: callLLM() response cache and LayeredKvDataSource.
 * These exercise the data/seam logic directly (no HTTP), with a fake KV.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { callLLM, getLlmCacheStats } from "../src/orchestrator.js";
import {
  LayeredKvDataSource,
  MockDataSource,
  runWithDataSource,
  getCategoryBenchmarks,
} from "../src/data.js";
import { KvRateLimiter, DurableObjectRateLimiter, MemoryRateLimiter } from "../src/ratelimit.js";
import { RateLimiterDO } from "../src/index.js";

/** In-memory KV double honoring the "text" | "json" type hint. */
function fakeKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callLLM KV cache", () => {
  it("stores on miss then serves from cache without a second fetch", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ content: [{ type: "text", text: "narrative-A" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const kv = fakeKv();
    const env = { LLM_API_KEY: "test-key", LLM_PROVIDER: "anthropic", LLM_MODEL: "m", LLM_BASE_URL: "https://x.test", NECTARIN_KV: kv };
    const req = { system: "sys", prompt: "hello" };

    const before = getLlmCacheStats();
    const first = await callLLM(req, env as any);
    expect(first).toBe("narrative-A");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await callLLM(req, env as any);
    expect(second).toBe("narrative-A");
    // Cache hit ⇒ fetch NOT called again.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const after = getLlmCacheStats();
    expect(after.stores).toBeGreaterThan(before.stores);
    expect(after.hits).toBeGreaterThan(before.hits);
  });

  it("falls back to the deterministic stub (and never throws) on LLM error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    const kv = fakeKv();
    const out = await callLLM(
      { system: "s", prompt: "p" },
      { LLM_API_KEY: "k", NECTARIN_KV: kv } as any
    );
    expect(out).toContain("(LLM-stub:");
  });
});

describe("LayeredKvDataSource", () => {
  it("returns KV override benchmarks when present", async () => {
    const override = {
      "VK Ads": {
        CPM: { p25: 1, p50: 2, p75: 3 },
        CTR: { p25: 1, p50: 1, p75: 1 },
        CPA: { p25: 111, p50: 222, p75: 333 },
        VTR: { p25: 1, p50: 1, p75: 1 },
      },
    };
    const ds = new LayeredKvDataSource(fakeKv({ "benchmarks:retail": override }) as any);
    const bm = await ds.getCategoryBenchmarks("retail");
    expect(bm?.["VK Ads"].CPA.p50).toBe(222);
    const metric = await ds.getMetric("retail", "VK Ads", "CPA");
    expect(metric?.p50).toBe(222);
  });

  it("falls back to bundled mock data when KV has no override", async () => {
    const ds = new LayeredKvDataSource(fakeKv() as any);
    const bm = await ds.getCategoryBenchmarks("finance");
    // finance exists in the bundled mock with all platforms.
    expect(bm).toBeDefined();
    expect(Object.keys(bm ?? {}).length).toBeGreaterThan(0);
  });

  it("survives a KV that throws (graceful fallback)", async () => {
    const throwingKv = {
      async get() {
        throw new Error("kv down");
      },
      async put() {
        throw new Error("kv down");
      },
    };
    const ds = new LayeredKvDataSource(throwingKv as any);
    const bm = await ds.getCategoryBenchmarks("retail");
    expect(bm).toBeDefined(); // fell back to mock despite KV errors
  });
});

describe("per-tenant data (LayeredKvDataSource keyPrefix + AsyncLocalStorage)", () => {
  const bm = (cpa: number) => ({
    "VK Ads": {
      CPM: { p25: 1, p50: 2, p75: 3 },
      CTR: { p25: 1, p50: 1, p75: 1 },
      CPA: { p25: cpa, p50: cpa, p75: cpa },
      VTR: { p25: 1, p50: 1, p75: 1 },
    },
  });

  it("resolves tenant → global → mock in that order", async () => {
    const kv = fakeKv({
      "tenant:acme:benchmarks:retail": bm(11),
      "benchmarks:retail": bm(22),
      "benchmarks:finance": bm(33), // global-only override
    });
    const globalLayered = new LayeredKvDataSource(kv as any);
    const acme = new LayeredKvDataSource(kv as any, globalLayered, "tenant:acme:");

    // 1. tenant override wins
    expect((await acme.getMetric("retail", "VK Ads", "CPA"))?.p50).toBe(11);
    // 2. no tenant key → falls through to the global override
    expect((await acme.getMetric("finance", "VK Ads", "CPA"))?.p50).toBe(33);
    // 3. no tenant/global key → falls through to the bundled mock
    const mockBm = await acme.getCategoryBenchmarks("ecom");
    expect(mockBm).toBeDefined();
    expect(Object.keys(mockBm ?? {}).length).toBeGreaterThan(0);
  });

  it("a different tenant does NOT see another tenant's override", async () => {
    const kv = fakeKv({ "tenant:acme:benchmarks:retail": bm(11), "benchmarks:retail": bm(22) });
    const globalLayered = new LayeredKvDataSource(kv as any);
    const other = new LayeredKvDataSource(kv as any, globalLayered, "tenant:other:");
    // other tenant has no override → sees the global value, not acme's.
    expect((await other.getMetric("retail", "VK Ads", "CPA"))?.p50).toBe(22);
  });

  it("module accessors honor the request-scoped data source via runWithDataSource", async () => {
    const kv = fakeKv({ "tenant:acme:benchmarks:retail": bm(99) });
    const tenantDs = new LayeredKvDataSource(kv as any, new MockDataSource(), "tenant:acme:");

    // Inside the ALS context the accessor (async, awaits internally) sees the tenant DS.
    const inside = await runWithDataSource(tenantDs, () => getCategoryBenchmarks("retail"));
    expect(inside?.["VK Ads"].CPA.p50).toBe(99);

    // Outside the context it falls back to the process-global default (mock).
    const outside = await getCategoryBenchmarks("retail");
    expect(outside?.["VK Ads"]?.CPA.p50).not.toBe(99);
  });
});

describe("KvRateLimiter", () => {
  it("enforces a global fixed-window limit across calls", async () => {
    const kv = fakeKv();
    const now = () => 1_000_000_000_000; // frozen → single window
    const rl = new KvRateLimiter(kv as any, now);
    const k = "sub:user-1";
    const r1 = await rl.check(k, 3);
    const r2 = await rl.check(k, 3);
    const r3 = await rl.check(k, 3);
    const r4 = await rl.check(k, 3);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
    expect(r4.allowed).toBe(false);
    expect(r4.retryAfterSec).toBeGreaterThan(0);
    expect(r4.limit).toBe(3);
  });

  it("fails OPEN to a local limiter when KV errors (never hard-locks)", async () => {
    const throwingKv = {
      async get() {
        throw new Error("kv down");
      },
      async put() {
        throw new Error("kv down");
      },
    };
    const rl = new KvRateLimiter(throwingKv as any);
    // Generous limit ⇒ fallback memory limiter admits the request.
    const r = await rl.check("sub:user-2", 1000);
    expect(r.allowed).toBe(true);
  });

  it("treats a non-positive limit as disabled", async () => {
    const rl = new KvRateLimiter(fakeKv() as any);
    const r = await rl.check("sub:user-3", 0);
    expect(r.allowed).toBe(true);
  });
});

describe("DurableObjectRateLimiter + RateLimiterDO", () => {
  /** Fake DO namespace: one RateLimiterDO instance per id name (strong + exact). */
  function fakeNs() {
    const instances = new Map<string, RateLimiterDO>();
    return {
      idFromName(name: string) {
        return name;
      },
      get(id: unknown) {
        const key = String(id);
        if (!instances.has(key)) instances.set(key, new RateLimiterDO());
        const inst = instances.get(key)!;
        return {
          fetch: (_input: any, init?: any) =>
            inst.fetch(new Request("https://do/check", { method: "POST", body: init?.body })),
        };
      },
    };
  }

  it("enforces an exact limit even across rapid calls (strong consistency)", async () => {
    const rl = new DurableObjectRateLimiter(fakeNs() as any, new MemoryRateLimiter());
    const k = "sub:do-user";
    // First 5 allowed (full bucket), 6th blocked — counted exactly by the DO.
    const results = [] as boolean[];
    for (let i = 0; i < 6; i++) results.push((await rl.check(k, 5)).allowed);
    expect(results.slice(0, 5).every(Boolean)).toBe(true);
    expect(results[5]).toBe(false);
  });

  it("fails OPEN to the fallback limiter when the DO throws", async () => {
    const throwingNs = {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async () => {
          throw new Error("DO down");
        },
      }),
    };
    const rl = new DurableObjectRateLimiter(throwingNs as any, new MemoryRateLimiter());
    const r = await rl.check("sub:do-user-2", 1000);
    expect(r.allowed).toBe(true);
  });

  it("RateLimiterDO blocks after the bucket drains", async () => {
    const do_ = new RateLimiterDO();
    const call = async () =>
      JSON.parse(await (await do_.fetch(new Request("https://do/check", { method: "POST", body: JSON.stringify({ limitPerMin: 2 }) }))).text());
    expect((await call()).allowed).toBe(true);
    expect((await call()).allowed).toBe(true);
    const third = await call();
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThan(0);
  });
});
