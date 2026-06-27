/**
 * Unit tests for the KV layer: callLLM() response cache and LayeredKvDataSource.
 * These exercise the data/seam logic directly (no HTTP), with a fake KV.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { callLLM, getLlmCacheStats } from "../src/orchestrator.js";
import { LayeredKvDataSource } from "../src/data.js";
import { KvRateLimiter } from "../src/ratelimit.js";

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
