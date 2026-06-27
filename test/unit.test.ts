import { describe, it, expect } from "vitest";
import { MemoryRateLimiter } from "../src/ratelimit.js";
import { validateInput } from "../src/validate.js";
import type { JsonSchema } from "../src/tools.js";

describe("MemoryRateLimiter (token bucket)", () => {
  it("allows up to the limit, then blocks with a Retry-After", () => {
    let t = 0;
    const rl = new MemoryRateLimiter(() => t);
    const limit = 3;
    expect(rl.check("k", limit).allowed).toBe(true);
    expect(rl.check("k", limit).allowed).toBe(true);
    expect(rl.check("k", limit).allowed).toBe(true);
    const blocked = rl.check("k", limit);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("refills over time", () => {
    let t = 0;
    const rl = new MemoryRateLimiter(() => t);
    const limit = 60; // 1 token/sec
    for (let i = 0; i < 60; i++) rl.check("k", limit);
    expect(rl.check("k", limit).allowed).toBe(false);
    t += 1000; // advance 1s → 1 token back
    expect(rl.check("k", limit).allowed).toBe(true);
  });

  it("limit <= 0 disables limiting", () => {
    const rl = new MemoryRateLimiter(() => 0);
    expect(rl.check("k", 0).allowed).toBe(true);
  });

  it("keys are independent", () => {
    const rl = new MemoryRateLimiter(() => 0);
    rl.check("a", 1);
    expect(rl.check("a", 1).allowed).toBe(false);
    expect(rl.check("b", 1).allowed).toBe(true);
  });
});

describe("validateInput", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      category: { type: "string", enum: ["finance", "retail"] },
      budget: { type: "number", exclusiveMinimum: 0 },
    },
    required: ["category", "budget"],
    additionalProperties: false,
  };

  it("passes a valid object", () => {
    expect(validateInput({ category: "finance", budget: 100 }, schema).valid).toBe(true);
  });

  it("flags missing required", () => {
    const r = validateInput({ category: "finance" }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "budget")).toBe(true);
  });

  it("flags bad enum", () => {
    const r = validateInput({ category: "nope", budget: 1 }, schema);
    expect(r.valid).toBe(false);
  });

  it("flags exclusiveMinimum violation", () => {
    const r = validateInput({ category: "finance", budget: 0 }, schema);
    expect(r.valid).toBe(false);
  });

  it("flags unexpected property when additionalProperties is false", () => {
    const r = validateInput({ category: "finance", budget: 1, extra: true }, schema);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === "extra")).toBe(true);
  });

  it("flags type mismatch", () => {
    const r = validateInput({ category: 5, budget: 1 }, schema);
    expect(r.valid).toBe(false);
  });
});
