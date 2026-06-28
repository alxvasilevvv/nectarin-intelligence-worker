/**
 * PLAN / ENTITLEMENTS (v2.48) — tier gating for NECTARIN Intelligence.
 *
 * Monetization seam: Unyly Connect (the OAuth gateway) issues a JWT with a `plan`
 * claim (free | pro | team | agency). This module maps a small set of flagship /
 * compute-heavy tools to a MINIMUM plan, so the gateway's tier becomes real product
 * value — without the worker doing any billing itself (that lives at Unyly).
 *
 * NON-BREAKING BY DESIGN: when NO plan claim is present (dev-bypass, shared-token,
 * or a token without the claim) the effective plan is `owner` ⇒ everything is open.
 * Gating only activates when an explicit, recognised lower tier is supplied — so the
 * current authless prod deploy and the test-suite are unaffected.
 */

export type Plan = "free" | "pro" | "team" | "agency" | "owner";

const RANK: Record<Plan, number> = { free: 0, pro: 1, team: 2, agency: 3, owner: 99 };

/**
 * Minimum plan required per tool. Anything NOT listed is available on `free`
 * (a deliberately generous free tier drives adoption; the upsell is the flagship
 * orchestration, mix-modeling, incrementality and executive/export tools).
 */
export const TOOL_MIN_PLAN: Record<string, Plan> = {
  strategy_orchestrate: "pro",
  mmm_optimize: "pro",
  incrementality_meta: "pro",
  geo_holdout: "pro",
  competitive_response: "pro",
  report_export: "pro",
  board_report: "team",
  federation_invoke: "team",
  marketing_maturity_assessment: "pro",
  martech_stack_roi: "pro",
  abm_account_scoring: "pro",
  b2b_pipeline_velocity: "pro",
};

/**
 * Monthly tool-call quota per plan. The free tier is capped to create a concrete
 * upsell moment; paid tiers are effectively unlimited here (real billing is metered
 * at the Unyly gateway, not gated in the worker). `owner` (claimless) is unlimited,
 * so the current authless deploy enforces no quota.
 */
export const PLAN_MONTHLY_QUOTA: Record<Plan, number> = {
  free: 100,
  pro: Infinity,
  team: Infinity,
  agency: Infinity,
  owner: Infinity,
};

export function monthlyQuota(plan: Plan): number {
  return PLAN_MONTHLY_QUOTA[plan];
}

/** Map an arbitrary claim string to a known Plan; unknown/empty ⇒ `owner` (fail-open). */
export function normalizePlan(plan?: string | null): Plan {
  if (!plan) return "owner";
  const p = plan.trim().toLowerCase();
  if (p === "free" || p === "pro" || p === "team" || p === "agency" || p === "owner") return p;
  return "owner";
}

export function requiredPlan(tool: string): Plan | null {
  return TOOL_MIN_PLAN[tool] ?? null;
}

/** True when the caller's plan is allowed to run the tool. */
export function planAllows(plan: Plan, tool: string): boolean {
  const need = requiredPlan(tool);
  if (!need) return true;
  return RANK[plan] >= RANK[need];
}

/** Build the tracked Unyly upgrade link (UTM-attributed) for an upsell CTA. */
export function unylyUpgradeUrl(base: string, partnerId: string, plan: Plan, tool: string): string {
  const sep = base.includes("?") ? "&" : "?";
  const params: Array<[string, string]> = [
    ["utm_source", "mcp_gate"],
    ["utm_medium", "mcp_connector"],
    ["utm_campaign", "upgrade"],
    ["via", partnerId || "nectarin"],
    ["plan", plan],
    ["tool", tool],
  ];
  return `${base}${sep}${params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}`;
}
