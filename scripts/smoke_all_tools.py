#!/usr/bin/env python3
"""Production smoke test: call every tool with minimal valid args derived from its JSON Schema.

Usage:
    MCP_TOKEN=<shared-token> python3 scripts/smoke_all_tools.py [BASE_URL]

If the server is protected by MCP_SHARED_TOKEN, pass it via the MCP_TOKEN env var.
"""
import json, os, sys, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://nectarin-intelligence.alxvasilevv.workers.dev"
TOKEN = os.environ.get("MCP_TOKEN", "").strip()


def rpc(method, params=None, _id=1):
    body = {"jsonrpc": "2.0", "id": _id, "method": method}
    if params is not None:
        body["params"] = params
    headers = {
        "content-type": "application/json",
        "accept": "application/json",
        "user-agent": "nectarin-smoke/1.0",
    }
    if TOKEN:
        headers["authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(BASE + "/mcp", data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def sample(schema):
    """Build a minimal valid value for a JSON-schema fragment."""
    t = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if t == "number" or t == "integer":
        is_int = t == "integer"
        # Inclusive lower bound (honor exclusiveMinimum/minimum).
        if "exclusiveMinimum" in schema:
            lo = schema["exclusiveMinimum"] + (1 if is_int else 0.01)
        elif "minimum" in schema:
            lo = schema["minimum"]
        else:
            lo = None
        # Inclusive upper bound (honor exclusiveMaximum/maximum).
        if "exclusiveMaximum" in schema:
            hi = schema["exclusiveMaximum"] - (1 if is_int else 0.01)
        elif "maximum" in schema:
            hi = schema["maximum"]
        else:
            hi = None
        if lo is not None and hi is not None:
            val = (lo + hi) / 2
        elif lo is not None:
            val = lo
        elif hi is not None:
            val = hi / 2 if hi > 0 else hi
        else:
            val = 1000
        return int(val) if is_int else val
    if t == "boolean":
        return True
    if t == "array":
        items = schema.get("items", {})
        return [sample(items)] if items else []
    if t == "object":
        return build_args(schema)
    # string fallback — honor "JSON string" fields with a valid JSON literal
    desc = schema.get("description", "").lower()
    if "json" in desc:
        return '{"cpm":300,"ctr":0.4,"cpa":1800,"vtr":55,"spend":500000}'
    return "тест"


def build_args(schema):
    props = schema.get("properties", {})
    required = schema.get("required", list(props.keys()))
    return {k: sample(props[k]) for k in required if k in props}


# Per-tool extra args for CONDITIONAL requirements the JSON Schema can't express
# via plain `required` (e.g. "pass A, OR B+C"). Merged over the generic args.
OVERRIDES = {
    "unit_economics": {"cac": 3000},
}


def main():
    tools = rpc("tools/list", _id=2)["result"]["tools"]
    print(f"Tools discovered: {len(tools)}\n")
    ok = 0
    fail = 0
    for i, tool in enumerate(tools, start=10):
        name = tool["name"]
        args = {**build_args(tool.get("inputSchema", {})), **OVERRIDES.get(name, {})}
        resp = rpc("tools/call", {"name": name, "arguments": args}, _id=i)
        if "error" in resp:
            fail += 1
            print(f"  ✗ {name:<26} JSON-RPC error {resp['error']['code']}: {resp['error']['message'][:90]}")
        else:
            res = resp.get("result", {})
            if res.get("isError"):
                fail += 1
                txt = next((c.get("text", "") for c in res.get("content", []) if c.get("type") == "text"), "")
                print(f"  ✗ {name:<26} isError=true: {txt[:90]}")
            else:
                ok += 1
                txt = next((c.get("text", "") for c in res.get("content", []) if c.get("type") == "text"), "")
                print(f"  ✓ {name:<26} {txt[:80]}")
    print(f"\nRESULT: {ok} ok / {fail} failed / {len(tools)} total")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
