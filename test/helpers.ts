/** Shared test helpers for driving the Worker's fetch() handler directly. */
import worker, { type Env } from "../src/index.js";

/** Dev-bypass env: auth disabled, generous rate limit so tests don't trip it. */
export function devEnv(overrides: Partial<Env> = {}): Env {
  return {
    DEV_BYPASS: "1",
    RATE_LIMIT_PER_MIN: "10000",
    ...overrides,
  } as Env;
}

/** Production-ish env with OAuth configured (so a token is REQUIRED). */
export function authEnv(overrides: Partial<Env> = {}): Env {
  return {
    DEV_BYPASS: "0",
    OAUTH_ISSUER: "https://auth.example.test/",
    OAUTH_AUDIENCE: "https://nectarin.example.test/mcp",
    OAUTH_JWKS_URL: "https://auth.example.test/.well-known/jwks.json",
    RATE_LIMIT_PER_MIN: "10000",
    ...overrides,
  } as Env;
}

/** POST a single JSON-RPC request to /mcp and return the parsed JSON body + status. */
export async function rpc(
  body: unknown,
  env: Env = devEnv(),
  headers: Record<string, string> = {}
): Promise<{ status: number; json: any; res: Response }> {
  const res = await worker.fetch(
    new Request("https://nectarin.example.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env
  );
  let parsed: any = null;
  const text = await res.clone().text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, json: parsed, res };
}

/** GET a path on the Worker. */
export async function get(
  path: string,
  env: Env = devEnv()
): Promise<{ status: number; json: any; res: Response }> {
  const res = await worker.fetch(
    new Request(`https://nectarin.example.test${path}`, { method: "GET" }),
    env
  );
  let parsed: any = null;
  const text = await res.clone().text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: res.status, json: parsed, res };
}
