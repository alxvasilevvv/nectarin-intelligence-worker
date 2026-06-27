#!/usr/bin/env python3
"""Production smoke test: call every tool with minimal valid args derived from its JSON Schema."""
import json, sys, urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "https://nectarin-intelligence.alxvasilevv.workers.dev"


def rpc(method, params=None, _id=1):
    body = {"jsonrpc": "2.0", "id": _id, "method": method}
    if params is not None:
        body["params"] = params
    req = urllib.request.Request(
        BASE + "/mcp",
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": "nectarin-smoke/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def sample(schema):
    """Build a minimal valid value for a JSON-schema fragment."""
    t = schema.get("type")
    if "enum" in schema:
        return schema["enum"][0]
    if t == "number" or t == "integer":
        if "exclusiveMinimum" in schema:
            return schema["exclusiveMinimum"] + (1 if t == "integer" else 1000)
        if "minimum" in schema:
            return schema["minimum"]
        return 1000
    if t == "boolean":
        return True
    if t == "array":
        items = schema.get("items", {})
        return [sample(items)] if items else []
    if t == "object":
        return build_args(schema)
    # string fallback — use description hints lightly
    return "тест"


def build_args(schema):
    props = schema.get("properties", {})
    required = schema.get("required", list(props.keys()))
    return {k: sample(props[k]) for k in required if k in props}


def main():
    tools = rpc("tools/list", _id=2)["result"]["tools"]
    print(f"Tools discovered: {len(tools)}\n")
    ok = 0
    fail = 0
    for i, tool in enumerate(tools, start=10):
        name = tool["name"]
        args = build_args(tool.get("inputSchema", {}))
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
