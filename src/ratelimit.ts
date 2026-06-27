/**
 * Lightweight rate limiting for NECTARIN Intelligence (Cloudflare Workers).
 *
 * Default: an in-memory token-bucket keyed per-token (falling back to per-IP).
 * This is correct and cheap for a single warm isolate / local dev, but NOT
 * globally consistent across Cloudflare's many isolates. For production-grade,
 * globally-coordinated limits, swap `MemoryRateLimiter` for a KV- or
 * Durable-Object-backed implementation — the `RateLimiter` interface below is the
 * single seam you wire (see `KvRateLimiter` / `DurableObjectRateLimiter` stubs).
 *
 * Configurable via env `RATE_LIMIT_PER_MIN` (default 60). A non-positive value
 * disables limiting.
 */

import type { Env } from "./index.js";

export interface RateLimitResult {
  allowed: boolean;
  /** Configured ceiling (requests per window). */
  limit: number;
  /** Whole tokens left after this request. */
  remaining: number;
  /** Seconds until the bucket has room again (only meaningful when blocked). */
  retryAfterSec: number;
}

export interface RateLimiter {
  check(key: string, limitPerMin: number): RateLimitResult | Promise<RateLimitResult>;
}

interface Bucket {
  tokens: number;
  /** Last refill timestamp (ms). */
  updated: number;
}

/**
 * In-memory token-bucket limiter. One bucket per key; refills continuously at
 * `limitPerMin / 60_000` tokens per ms up to a burst ceiling of `limitPerMin`.
 *
 * NOTE: state lives in the isolate's memory, so it resets on cold start and is
 * not shared across isolates. Good enough for dev and basic abuse protection;
 * use a KV/DO limiter for hard, global guarantees.
 */
export class MemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();
  /** now() is injectable for deterministic tests. */
  constructor(private now: () => number = () => Date.now()) {}

  check(key: string, limitPerMin: number): RateLimitResult {
    if (!Number.isFinite(limitPerMin) || limitPerMin <= 0) {
      // Limiting disabled.
      return { allowed: true, limit: 0, remaining: Number.POSITIVE_INFINITY, retryAfterSec: 0 };
    }

    const capacity = limitPerMin;
    const refillPerMs = limitPerMin / 60_000;
    const t = this.now();

    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: capacity, updated: t };
      this.buckets.set(key, b);
    } else {
      const elapsed = Math.max(0, t - b.updated);
      b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
      b.updated = t;
    }

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return {
        allowed: true,
        limit: capacity,
        remaining: Math.floor(b.tokens),
        retryAfterSec: 0,
      };
    }

    const deficit = 1 - b.tokens;
    const retryAfterSec = Math.max(1, Math.ceil(deficit / refillPerMs / 1000));
    return { allowed: false, limit: capacity, remaining: 0, retryAfterSec };
  }
}

/**
 * Process-wide default limiter instance. A single MemoryRateLimiter is reused
 * across requests in a warm isolate so buckets persist between calls.
 */
let defaultLimiter: RateLimiter = new MemoryRateLimiter();

/** Override the default limiter (used by tests, or to install a KV/DO limiter). */
export function setRateLimiter(limiter: RateLimiter): void {
  defaultLimiter = limiter;
}

export function getRateLimiter(): RateLimiter {
  return defaultLimiter;
}

/** Parse RATE_LIMIT_PER_MIN from env, defaulting to 60. */
export function rateLimitPerMin(env: Env): number {
  const raw = (env.RATE_LIMIT_PER_MIN ?? "").trim();
  if (!raw) return 60;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 60;
}

/**
 * Derive a stable rate-limit key from the request: prefer the bearer token
 * (hashed/truncated so we never log the full token), else the client IP.
 */
export function rateLimitKey(req: Request, subject?: string): string {
  if (subject) return `sub:${subject}`;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token) return `tok:${cheapHash(token)}`;
  }
  const ip =
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  return `ip:${ip}`;
}

/** Non-cryptographic short hash so we key on a token without retaining it. */
function cheapHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Convenience: run the default limiter for a request.
 */
export async function enforceRateLimit(
  req: Request,
  env: Env,
  subject?: string
): Promise<RateLimitResult> {
  const key = rateLimitKey(req, subject);
  return getRateLimiter().check(key, rateLimitPerMin(env));
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCTION HOOKS (stubs) — swap MemoryRateLimiter for one of these and call
// `setRateLimiter(new KvRateLimiter(env.NECTARIN_KV))` (or the DO variant) at the
// top of `fetch()`. Both give cross-isolate, globally-coordinated limits.
// ─────────────────────────────────────────────────────────────────────────────

/*
// KV-backed fixed-window limiter (eventually consistent; cheap, simple).
export class KvRateLimiter implements RateLimiter {
  constructor(private kv: KVNamespace) {}
  async check(key: string, limitPerMin: number): Promise<RateLimitResult> {
    if (limitPerMin <= 0) {
      return { allowed: true, limit: 0, remaining: Infinity, retryAfterSec: 0 };
    }
    const windowSec = 60;
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const k = `rl:${key}:${bucket}`;
    const current = Number((await this.kv.get(k)) ?? "0");
    if (current >= limitPerMin) {
      const retryAfterSec = windowSec - (Math.floor(Date.now() / 1000) % windowSec);
      return { allowed: false, limit: limitPerMin, remaining: 0, retryAfterSec };
    }
    // NB: KV is eventually consistent — small over-admission under burst is possible.
    await this.kv.put(k, String(current + 1), { expirationTtl: windowSec * 2 });
    return { allowed: true, limit: limitPerMin, remaining: limitPerMin - current - 1, retryAfterSec: 0 };
  }
}

// Durable-Object-backed limiter (strongly consistent; best for hard limits).
// Define a `RateLimiterDO` Durable Object that owns a token bucket and forward
// check() to it via a stub; bind it in wrangler.toml ([[durable_objects.bindings]]).
export class DurableObjectRateLimiter implements RateLimiter {
  constructor(private ns: DurableObjectNamespace) {}
  async check(key: string, limitPerMin: number): Promise<RateLimitResult> {
    const id = this.ns.idFromName(key);
    const stub = this.ns.get(id);
    const res = await stub.fetch("https://do/check", {
      method: "POST",
      body: JSON.stringify({ limitPerMin }),
    });
    return (await res.json()) as RateLimitResult;
  }
}
*/
