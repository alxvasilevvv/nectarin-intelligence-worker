# NECTARIN Intelligence — remote MCP on Cloudflare Workers

A **deploy-ready** remote [Model Context Protocol](https://modelcontextprotocol.io)
server for **NECTARIN Intelligence** — an orchestrator-worker AI marketing agent
for the RU/CIS market. It runs entirely on a single Cloudflare Worker, serves MCP
over **Streamable HTTP (JSON-RPC 2.0)**, and ships with **mock/synthetic RU data**
so v1 needs no database.

Go live with `npx wrangler deploy` using your own Cloudflare token.

> All figures are **MOCK / synthetic**, plausible for RU/CIS in RUB. Not legal advice.
> Swap the data accessors in `src/data.ts` for real data when ready (KV/D1 stubs are in `wrangler.toml`).

---

## What's inside

- **`src/index.ts`** — the Worker. A small, spec-compliant JSON-RPC 2.0 MCP handler
  (no `@modelcontextprotocol/sdk` dependency — the SDK's transports target Node's
  `http`/streams, which don't exist on Workers, so a hand-rolled handler is cleaner
  and dependency-free). Implements `initialize`, `tools/list`, `tools/call`,
  `prompts/list`, `prompts/get`, `resources/list`, `resources/read`, `ping`, and
  the `notifications/*` no-ops, with proper JSON-RPC results/errors.
- **`src/tools.ts`** — the tool registry. It composes two groups: the 11
  **Intelligence** tools (incl. the flagship `strategy_orchestrate` and the
  `budget_optimizer`) and the 6 **Growth & Automation** tools (see the table
  below), each with a JSON-Schema `inputSchema` + async handler.
- **`src/growth.ts`** — the 6 **Growth & Automation** tools (the funnel layer):
  `roi_calculator`, `lead_qualify`, `request_nectarin_proposal`,
  `book_consultation`, `automation_recipe`, `value_forecast`. Deterministic,
  synthetic logic anchored to the same mock benchmarks; **no PII is sent and no
  real network call is made** (proposal/booking are clearly-marked stubs).
- **`src/orchestrator.ts`** — the planner → workers (dataRetriever, analyst,
  strategist, copywriter, compliance) → synthesizer pipeline. `media_plan` math is
  real: `impressions = spend / CPM × 1000`, `clicks = impressions × CTR`,
  `conversions = spend / CPA`, plus estimated reach and blended CPA. The flagship
  **`strategy_orchestrate`** fans out to every worker in one call (benchmarks +
  audience + competitors + plan/forecast + optimized split + creative + compliance
  + ROI + executive summary). **`budget_optimizer`** solves the conversion-maximizing
  channel split (water-fill by CPA under a per-channel cap). The `callLLM()` seam is
  **real-or-stub**: it calls Anthropic/OpenAI when `LLM_API_KEY` is set and falls
  back to a deterministic stub otherwise (and on any model error), so the pipeline
  never breaks.
- **`src/data.ts`** — synthetic benchmarks / suppliers / playbooks behind a
  `DataSource` interface (default `MockDataSource`; `KvDataSource`/`HttpDataSource`
  stubs included). See **`DATA_SCHEMA.md`** for the exact data NECTARIN must supply.
- **`src/auth.ts`** — **real OAuth 2.1 bearer verification** via `jose`
  (`createRemoteJWKSet` + `jwtVerify`) against a JWKS URL — validates signature,
  issuer, audience, expiry. In production **Unyly Connect** fronts OAuth 2.1
  (DCR + PKCE); this resource server only validates the token. `DEV_BYPASS=1`
  disables the check for local/dev.
- **`src/ratelimit.ts`** — per-token/IP token-bucket rate limiter
  (`RATE_LIMIT_PER_MIN`, default 60), with KV/Durable-Object hooks for production.
- **`src/validate.ts`** — per-tool JSON-Schema input validation (`-32602`).

### HTTP routes
| Method | Path | Purpose |
|---|---|---|
| POST | `/mcp` | JSON-RPC 2.0 MCP endpoint (auth + rate limit) |
| GET | `/.well-known/oauth-protected-resource` | OAuth discovery |
| GET | `/health` | Liveness probe |
| GET | `/version` | name + version + toolCount + commit + authMode |
| GET | `/` | Friendly index (endpoint URLs) |

### JSON-RPC error codes
`-32700` parse · `-32600` invalid request · `-32601` unknown method/tool ·
`-32602` invalid params (schema validation) · `-32603` internal (safe message) ·
`-32029` rate limited (HTTP 429). A 401 carries `WWW-Authenticate` with the
`resource_metadata` discovery pointer.

---

## Tools (17 total)

### Intelligence group (inform + orchestrate)
| Tool | What it does |
|---|---|
| `strategy_orchestrate` | **Flagship.** One call → full go-to-market strategy: benchmarks + audience + competitors + media plan/forecast + optimized split + creative concept + compliance + ROI + executive summary. |
| `budget_optimizer` | Conversion-maximizing budget split (water-fill by CPA under a per-channel cap) + uplift vs. the goal preset. |
| `ru_benchmarks` | CPM/CTR/CPA/VTR percentiles for a category × KPI (× platform). |
| `supplier_quality` | Inventory quality index, fraud risk, recommended/avoid suppliers. |
| `media_plan` | RUB budget split + real forecast (impr/clicks/conv/reach/blended CPA). |
| `category_playbook` | Territories, do's & don'ts, seasonal hooks, compliance gate. |
| `audience_insights` | Segments, JTBD, media affinities for a category. |
| `competitor_scan` | Likely competitors, activity, channels, owned territory. |
| `geo_aeo_audit` | Brand visibility inside AI answer engines + RU search. |
| `creative_brief` | Objective, proposition, mandatories + 3 concept territories. |
| `report_explain` | Plain-language report read, anomalies, prioritized fixes. |

### Growth & Automation group (convert + automate) — drives the funnel
These tools turn the agent from an advisor into a revenue engine. Together they
walk a marketer down the funnel: **acquire marketers → qualify → proposal →
managed services**, and frame NECTARIN as automation, not just advice.

| Tool | What it does | Funnel stage |
|---|---|---|
| `roi_calculator` | Projects CPA improvement, extra conversions & est. annual value from the mock benchmarks (method shown). | Acquire / show value |
| `value_forecast` | 3-scenario (conservative/base/ambitious) reach + efficiency + savings projection, assumptions stated. | Acquire / show value |
| `lead_qualify` | 0-100 fit score + recommended tier (self-serve / managed / enterprise retainer) via budget thresholds + signals. | Qualify |
| `request_nectarin_proposal` | Structured RFP/brief + **clearly-stubbed** submission reference. **Sends nothing** (no CRM/webhook/email); privacy note included. | Proposal |
| `book_consultation` | Scheduling CTA with a booking URL from `NECTARIN_BOOKING_URL` + a "what to prepare" checklist. | Proposal → close |
| `automation_recipe` | Concrete multi-agent workflow (steps, internal tools, cadence, est. time saved) NECTARIN runs as a managed service. | Managed services |

> **Funnel logic & safety.** All Growth figures are synthetic/illustrative and
> anchored to the same mock RU/CIS benchmarks (`src/data.ts`) — internally
> consistent, but not guarantees. No tool transmits PII or makes a real network
> call. `request_nectarin_proposal` only **returns** a brief for human review;
> the exact spot for a real CRM/webhook POST is commented in `src/growth.ts`
> (gated behind `NECTARIN_CRM_WEBHOOK_URL`, left blank on purpose).

#### Growth & Automation env vars (`wrangler.toml` `[vars]`)
| Var | Purpose | Default |
|---|---|---|
| `NECTARIN_BOOKING_URL` | Scheduling link returned by `book_consultation`. | `https://nectarin.example/booking` (placeholder) |
| `NECTARIN_CONTACT_EMAIL` | Funnel inbox shown in proposal next-steps. | `hello@nectarin.example` (placeholder) |
| `NECTARIN_BRAND_NAME` | Brand label used in copy. | `NECTARIN` |
| `NECTARIN_CRM_WEBHOOK_URL` | Where a real proposal would POST. Blank = nothing is ever sent. | `""` |

---

## Go live — exact steps

From this folder (`nectarin-intelligence-worker/`):

```bash
# 1. Install dependencies
npm install

# 2. Authenticate to Cloudflare (interactive browser login)
npx wrangler login
#    …or, for CI / headless, set a scoped API token instead of logging in:
#    export CLOUDFLARE_API_TOKEN="<your-token-with-Workers-Scripts-Edit>"
#    (optionally also export CLOUDFLARE_ACCOUNT_ID="<your-account-id>")

# 3. Deploy
npx wrangler deploy
```

Wrangler prints the live URL, e.g.:

```
https://nectarin-intelligence.<your-subdomain>.workers.dev
```

Your **MCP endpoint** is that URL + `/mcp`:

```
https://nectarin-intelligence.<your-subdomain>.workers.dev/mcp
```

### Add to Claude (Custom Connector)
1. Claude → **Settings → Connectors → Add custom connector**.
2. Name: `NECTARIN Intelligence`. URL: the `/mcp` URL above.
3. Save. Because `DEV_BYPASS="1"` is set in `wrangler.toml`, the server accepts
   requests without a token out of the box — good for a first smoke test. Turn auth
   on before any real/shared use (see **Security** below).

### Smoke test with curl
```bash
# Replace with your deployed host.
HOST="https://nectarin-intelligence.<your-subdomain>.workers.dev"

# Health
curl -s "$HOST/health"

# MCP initialize
curl -s "$HOST/mcp" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'

# List tools
curl -s "$HOST/mcp" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call media_plan (real forecast + compliance gate for finance)
curl -s "$HOST/mcp" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"media_plan","arguments":{"budget":5000000,"goal":"performance","geo":"РФ","audience":"25-45","period":"сентябрь 2026","category":"finance"}}}'
```

`initialize` returns `serverInfo`, `protocolVersion`, and `capabilities`;
`tools/list` returns all 17 tools (11 Intelligence + 6 Growth & Automation);
`media_plan` returns the split, forecast totals, per-channel detail, and a
STOP-GATE flag for regulated categories.

```bash
# Flagship: full orchestrated strategy in one call
curl -s "$HOST/mcp" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"strategy_orchestrate","arguments":{"brand":"Acme","category":"finance","budget":8000000,"goal":"performance","geo":"РФ"}}}'

# Optimize the channel split to maximize conversions
curl -s "$HOST/mcp" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"budget_optimizer","arguments":{"category":"retail","budget":4000000,"goal":"performance"}}}'
```

```bash
# Funnel example: ROI pitch (synthetic, anchored to mock benchmarks)
curl -s "$HOST/mcp" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"roi_calculator","arguments":{"monthly_budget":3000000,"category":"finance"}}}'

# Qualify a lead → tier recommendation
curl -s "$HOST/mcp" \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"lead_qualify","arguments":{"company":"Acme","monthly_budget":6000000,"industry":"finance","goal":"performance"}}}'
```

---

## Local development

```bash
cp .dev.vars.example .dev.vars   # edit if needed; .dev.vars is gitignored
npm run dev                      # wrangler dev → http://localhost:8787/mcp
npm run typecheck                # tsc --noEmit
npm test                         # vitest run (30 tests)
npm run dry                      # wrangler deploy --dry-run --outdir dist (no Cloudflare auth needed)
```

### Tests

`npm test` runs the vitest suite against the Worker's `fetch()` handler directly:
initialize handshake, `tools/list` (17 tools), happy-path `tools/call`
(`ru_benchmarks`, `media_plan`, `roi_calculator`, `lead_qualify`,
`budget_optimizer`, `strategy_orchestrate`), invalid params (`-32602`), unknown
tool/method (`-32601`), the auth 401 path (`DEV_BYPASS` off, no token), plus unit
tests for the rate limiter and validator.

---

## Production configuration

Everything below is off by default so the server runs locally with zero secrets.
Turn it on for real/shared use.

### Environment variables (`wrangler.toml` `[vars]`)
| Var | Purpose | Default |
|---|---|---|
| `DEV_BYPASS` | `"1"` skips auth (dev). Set `"0"` to enforce OAuth. | `"1"` |
| `OAUTH_ISSUER` | Expected `iss`; also derives the JWKS URL if `OAUTH_JWKS_URL` is blank. | `""` |
| `OAUTH_AUDIENCE` | Expected `aud` (your `/mcp` URL). | `""` |
| `OAUTH_JWKS_URL` | JWKS endpoint; blank → `${OAUTH_ISSUER}/.well-known/jwks.json`. | `""` |
| `RATE_LIMIT_PER_MIN` | Requests/min per token (or IP). `0` disables. | `60` |
| `GIT_COMMIT` | Build id surfaced by `GET /version`. | `dev` |
| `NECTARIN_BOOKING_URL` / `…_CONTACT_EMAIL` / `…_BRAND_NAME` / `…_CRM_WEBHOOK_URL` | Growth funnel (placeholders; no PII sent). | see table above |

### Secrets (never in `wrangler.toml` / git)
Use Cloudflare secrets for anything sensitive:
```bash
npx wrangler secret put LLM_API_KEY            # enables REAL narrative (Anthropic/OpenAI)
npx wrangler secret put NECTARIN_DATA_API_KEY  # if using HttpDataSource
```
`.dev.vars` is for local dev only and is gitignored.

### Enable a real LLM narrative (optional)
`callLLM()` is **real-or-stub**. With no key it returns a deterministic stub, so
the server runs fully offline. To switch narrative copy (`media_plan` rationale,
`creative_brief` concepts, `geo_aeo_audit` summary, and the `strategy_orchestrate`
executive summary) to a real model:
```bash
npx wrangler secret put LLM_API_KEY   # required to go live
```
Optional `[vars]`: `LLM_PROVIDER` (`anthropic` default | `openai`), `LLM_MODEL`
(per-provider default otherwise), `LLM_BASE_URL` (proxy/Azure/self-host). Any model
error degrades gracefully back to the stub — a tool call never fails because of the LLM.

### Enable OAuth 2.1 (real bearer verification)
1. In `wrangler.toml` `[vars]` set `DEV_BYPASS = "0"` and fill `OAUTH_ISSUER`,
   `OAUTH_AUDIENCE` (= your `/mcp` URL), and optionally `OAUTH_JWKS_URL`.
2. That's it — `src/auth.ts` already verifies the JWT with `jose`
   (`createRemoteJWKSet` + `jwtVerify`): signature, issuer, audience, expiry. A
   failed/missing token → HTTP 401 with `WWW-Authenticate: Bearer error=…,
   resource_metadata="…"`. **Unyly Connect** is the authorization server (DCR +
   PKCE, issuance/rotation, per-tenant scopes); this Worker only validates.

### Rate limits
- Default is an **in-memory token-bucket** per token/IP (`RATE_LIMIT_PER_MIN`).
  It is per-isolate, so for hard global limits install a shared limiter: implement
  `KvRateLimiter` or `DurableObjectRateLimiter` (stubs in `src/ratelimit.ts`) and
  call `setRateLimiter(new KvRateLimiter(env.NECTARIN_KV))` at the top of `fetch()`.
- Over-limit → JSON-RPC `-32029` + HTTP 429 with `Retry-After`/`X-RateLimit-*`.

### Swapping the data source (mock → real)
1. Provide the datasets in **`DATA_SCHEMA.md`** (`benchmarks`, `playbooks`,
   `suppliers`) via KV, D1, or an internal HTTP API.
2. Implement `KvDataSource` or `HttpDataSource` in `src/data.ts` (stubs included).
3. Add the binding in `wrangler.toml`, then call `setDataSource(...)` **once** at
   the top of `fetch()` in `src/index.ts`. No tool/orchestrator changes needed.
4. (Optional) Swap `callLLM()` in `src/orchestrator.ts` for a real model `fetch()`.

---

## Wiring real data later

`src/data.ts` defines a **`DataSource`** interface (`getMetric`,
`getCategoryBenchmarks`, `getPlaybook`, `getSuppliers`); the default is
`MockDataSource` over inline synthetic objects. Tools read **only** through this
interface, so going real is a one-line wiring change — no upstream edits.

1. Create the store and paste its ID into the commented block in `wrangler.toml`:
   ```bash
   npx wrangler kv namespace create NECTARIN_KV
   # or
   npx wrangler d1 create nectarin-intelligence
   ```
2. Implement `KvDataSource` or `HttpDataSource` in `src/data.ts` (commented stubs
   included) against the data described in **`DATA_SCHEMA.md`**.
3. Call `setDataSource(new KvDataSource(env.NECTARIN_KV))` once at the top of
   `fetch()` in `src/index.ts`.
4. Swap `callLLM()` in `src/orchestrator.ts` from the stub to an Anthropic/OpenAI
   `fetch()` call (key from `wrangler secret`) for real narrative copy.

> **`DATA_SCHEMA.md`** is the client handoff: it lists the exact tables/collections
> (`benchmarks`, `playbooks`, `suppliers`), columns, types, example rows, and which
> tool consumes each. Hand it to NECTARIN to source the data.

---

## Resources & prompts exposed

- Resources: `nectarin://methodology`, `nectarin://glossary`.
- Prompts: `build_media_plan`, **`full_strategy`** (one-shot flagship via
  `strategy_orchestrate`), `competitor_teardown`, and the two funnel
  orchestrators **`sell_nectarin_services`** (roi_calculator → value_forecast →
  lead_qualify → request_nectarin_proposal → book_consultation) and
  **`automate_my_marketing`** (automation_recipe → roi_calculator →
  book_consultation).
