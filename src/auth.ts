/**
 * OAuth 2.1 bearer-token validation — production-grade (Cloudflare Workers edition).
 *
 * In production, NECTARIN Intelligence is fronted by **Unyly Connect**, which
 * handles the full OAuth 2.1 surface for remote MCP:
 *   - Dynamic Client Registration (DCR)
 *   - Authorization Code + PKCE
 *   - Token issuance / rotation / revocation
 *   - Per-user / per-tenant scopes and rate limits
 *
 * This resource server's only job is then to VALIDATE the bearer token it
 * receives (signature, issuer, audience, expiry) before serving a tool call.
 * Verification uses the WebCrypto-friendly `jose` library (works unchanged on
 * the Workers runtime) against a remote JWKS endpoint.
 *
 * Configuration (env):
 *   - OAUTH_JWKS_URL  — JWKS endpoint URL (e.g. https://auth.unyly.com/.well-known/jwks.json).
 *                       If omitted, it is derived from OAUTH_ISSUER as
 *                       `${issuer}/.well-known/jwks.json` (issuer's trailing slash handled).
 *   - OAUTH_ISSUER    — expected `iss` claim.
 *   - OAUTH_AUDIENCE  — expected `aud` claim (this resource server / the /mcp URL).
 *   - DEV_BYPASS=1    — skip verification entirely (local/dev convenience).
 *
 * MCP spec note: a 401 MUST include a `WWW-Authenticate` header pointing at the
 * protected-resource metadata so clients can discover the authorization server.
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { Env } from "./index.js";

export interface AuthContext {
  authenticated: boolean;
  subject?: string;
  scopes: string[];
  /** True when running in permissive dev mode (no real verification). */
  devBypass: boolean;
  /** Failure reason for logging / WWW-Authenticate (never leaked verbatim to client body). */
  error?: string;
}

/**
 * createRemoteJWKSet caches keys and refreshes on rotation. We memoize per JWKS
 * URL across requests so we do not re-create the fetcher (and its cache) on every
 * call within a warm isolate.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  let jwks = jwksCache.get(jwksUrl);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
    jwksCache.set(jwksUrl, jwks);
  }
  return jwks;
}

/** Resolve the JWKS URL from explicit env or derive it from the issuer. */
export function resolveJwksUrl(env: Env): string | null {
  const explicit = (env.OAUTH_JWKS_URL ?? "").trim();
  if (explicit) return explicit;
  const issuer = (env.OAUTH_ISSUER ?? "").trim();
  if (!issuer) return null;
  const base = issuer.endsWith("/") ? issuer.slice(0, -1) : issuer;
  return `${base}/.well-known/jwks.json`;
}

function isTrue(v: string | undefined): boolean {
  if (!v) return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

/**
 * Decide whether auth runs in permissive dev-bypass mode.
 * Bypass when DEV_BYPASS is truthy, OR when OAuth is not configured at all
 * (no issuer/audience AND no JWKS url) — so a fresh checkout still boots.
 */
export function isDevBypass(env: Env): boolean {
  if (isTrue(env.DEV_BYPASS)) return true;
  const issuer = (env.OAUTH_ISSUER ?? "").trim();
  const audience = (env.OAUTH_AUDIENCE ?? "").trim();
  const jwks = resolveJwksUrl(env);
  const configured = issuer.length > 0 && audience.length > 0 && Boolean(jwks);
  return !configured;
}

/**
 * Extract and verify the bearer token from the request.
 *
 * When NOT bypassing, a Bearer token is required and verified against the JWKS
 * (signature + issuer + audience + expiry). Returns an AuthContext; callers
 * check `.authenticated` and, on failure, respond with `unauthorizedResponse`.
 */
export async function authenticate(req: Request, env: Env): Promise<AuthContext> {
  if (isDevBypass(env)) {
    return { authenticated: true, scopes: ["*"], devBypass: true };
  }

  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  if (!token) {
    return { authenticated: false, scopes: [], devBypass: false, error: "missing_token" };
  }

  return verifyToken(token, env);
}

/**
 * Verify a JWT bearer token against the configured JWKS using jose.
 * Validates signature, issuer, and audience; jose enforces exp/nbf automatically.
 */
async function verifyToken(token: string, env: Env): Promise<AuthContext> {
  const jwksUrl = resolveJwksUrl(env);
  const issuer = (env.OAUTH_ISSUER ?? "").trim();
  const audience = (env.OAUTH_AUDIENCE ?? "").trim();

  if (!jwksUrl) {
    return { authenticated: false, scopes: [], devBypass: false, error: "jwks_not_configured" };
  }

  try {
    const jwks = getJwks(jwksUrl);
    const { payload } = await jwtVerify(token, jwks, {
      ...(issuer ? { issuer } : {}),
      ...(audience ? { audience } : {}),
    });
    return {
      authenticated: true,
      subject: typeof payload.sub === "string" ? payload.sub : undefined,
      scopes: extractScopes(payload),
      devBypass: false,
    };
  } catch (err) {
    // jose throws typed errors (JWTExpired, JWTClaimValidationFailed, signature, …).
    // We surface a short code for logs but NEVER put it (or a stack) in the client body.
    const code = (err as { code?: string }).code ?? "invalid_token";
    return { authenticated: false, scopes: [], devBypass: false, error: code };
  }
}

/** OAuth scopes can arrive as space-delimited `scope` or an array `scp`/`permissions`. */
function extractScopes(payload: JWTPayload): string[] {
  const scope = (payload as Record<string, unknown>).scope;
  if (typeof scope === "string") return scope.split(/\s+/).filter(Boolean);
  const scp = (payload as Record<string, unknown>).scp;
  if (Array.isArray(scp)) return scp.filter((s): s is string => typeof s === "string");
  return [];
}

/** Build a spec-compliant 401 Response with a WWW-Authenticate discovery hint. */
export function unauthorizedResponse(
  resourceMetadataUrl: string,
  extraHeaders: Record<string, string> = {},
  errorCode = "invalid_token"
): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message: "Unauthorized: missing or invalid bearer token.",
        data: { authenticate_via: "Unyly Connect (OAuth 2.1)" },
      },
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        "WWW-Authenticate": `Bearer error="${errorCode}", resource_metadata="${resourceMetadataUrl}"`,
        ...extraHeaders,
      },
    }
  );
}
