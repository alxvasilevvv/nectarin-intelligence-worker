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
import type { KvLike } from "./data.js";

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
// PRODUCTION limiter — KV-backed, globally coordinated across isolates, FAIL-OPEN.
// Installed in fetch() when NECTARIN_KV is bound. A KV outage degrades to a local
// MemoryRateLimiter (never a hard lock-out of the live connector).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two-layer limiter: a per-isolate token bucket PLUS a KV fixed-window counter.
 *
 *   1. LOCAL token bucket (MemoryRateLimiter) — instant, strongly consistent
 *      within an isolate. Catches bursts that hit the same isolate immediately
 *      (KV alone can't: KV is eventually consistent, so a parallel burst all
 *      reads the same stale count and over-admits).
 *   2. KV fixed-window — cross-isolate coordination for sustained traffic, where
 *      writes have time to propagate.
 *
 * A request is blocked if EITHER layer says so (the stricter wins). The whole
 * KV layer is FAIL-OPEN: any KV error degrades to the local result, so a KV
 * outage can never hard-lock the public connector. KV remains eventually
 * consistent, so extreme cross-isolate bursts can still over-admit — for hard
 * global burst limits use a Durable Object (strongly consistent).
 */
export class KvRateLimiter implements RateLimiter {
  /** Per-isolate bucket — first line of defense and the fail-open fallback. */
  private local = new MemoryRateLimiter();
  private windowSec = 60;
  constructor(private kv: KvLike, private now: () => number = () => Date.now()) {}

  async check(key: string, limitPerMin: number): Promise<RateLimitResult> {
    if (!Number.isFinite(limitPerMin) || limitPerMin <= 0) {
      return { allowed: true, limit: 0, remaining: Number.POSITIVE_INFINITY, retryAfterSec: 0 };
    }

    // Layer 1: local bucket. If it blocks, we're done (burst caught in-isolate).
    const local = this.local.check(key, limitPerMin);
    if (!local.allowed) return local;

    // Layer 2: KV global window (fail-open on any error).
    const nowSec = Math.floor(this.now() / 1000);
    const bucket = Math.floor(nowSec / this.windowSec);
    const k = `rl:${key}:${bucket}`;
    try {
      const current = Number((await this.kv.get(k, "text")) ?? "0") || 0;
      if (current >= limitPerMin) {
        const retryAfterSec = this.windowSec - (nowSec % this.windowSec);
        return { allowed: false, limit: limitPerMin, remaining: 0, retryAfterSec: Math.max(1, retryAfterSec) };
      }
      await this.kv.put(k, String(current + 1), { expirationTtl: this.windowSec * 2 });
      const kvRemaining = limitPerMin - current - 1;
      return { allowed: true, limit: limitPerMin, remaining: Math.min(local.remaining, kvRemaining), retryAfterSec: 0 };
    } catch {
      // FAIL-OPEN: KV unavailable → honor the local decision (already allowed).
      return local;
    }
  }
}
