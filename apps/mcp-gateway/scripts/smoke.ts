/**
 * Local smoke test against the gateway.
 *
 * Boots the gateway is NOT this script's job — start `pnpm dev` separately.
 * This script hits localhost:3000 and verifies the four key surfaces:
 *
 *   1. GET /healthz                            → "ok"
 *   2. GET /.well-known/federation.json        → tenant manifest
 *   3. GET /codex/.well-known/mcp.json         → discovery card with rewritten transports
 *   4. POST /codex/mcp                         → MCP initialize handshake (matches direct upstream)
 */

const BASE = process.env.GATEWAY_BASE ?? "http://localhost:3000";

type Check = { name: string; ok: boolean; note?: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, note?: string) {
  checks.push({ name, ok, note });
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${name}${note ? `  — ${note}` : ""}`);
}

async function run() {
  // 1. healthz
  try {
    const res = await fetch(`${BASE}/healthz`);
    const body = await res.text();
    record("/healthz", res.status === 200 && body.trim() === "ok", `status=${res.status}, body=${body.trim()}`);
  } catch (err) {
    record("/healthz", false, String(err));
  }

  // 2. federation manifest
  try {
    const res = await fetch(`${BASE}/.well-known/federation.json`);
    const json = (await res.json()) as { tenants?: { slug: string }[] };
    const hasCodex = Array.isArray(json.tenants) && json.tenants.some((t) => t.slug === "codex");
    record(
      "/.well-known/federation.json",
      res.status === 200 && hasCodex,
      `status=${res.status}, tenants=${json.tenants?.map((t) => t.slug).join(",") ?? "none"}`,
    );
  } catch (err) {
    record("/.well-known/federation.json", false, String(err));
  }

  // 3. tenant discovery card
  try {
    const res = await fetch(`${BASE}/codex/.well-known/mcp.json`);
    const json = (await res.json()) as {
      transports?: { type?: string; url?: string }[];
      _federated?: { tenant?: string };
    };
    const transport = json.transports?.[0];
    const federated = json._federated?.tenant === "codex";
    const transportRewritten =
      typeof transport?.url === "string" && transport.url.startsWith("http") && transport.url.includes("/codex/");
    record(
      "/codex/.well-known/mcp.json",
      res.status === 200 && federated && transportRewritten,
      `transport=${transport?.url ?? "missing"}`,
    );
  } catch (err) {
    record("/codex/.well-known/mcp.json", false, String(err));
  }

  // 4. MCP initialize via gateway
  try {
    const res = await fetch(`${BASE}/codex/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0.1" },
        },
      }),
    });
    const body = await res.text();
    const ok = res.status === 200 && body.includes("protocolVersion");
    record(
      "POST /codex/mcp initialize",
      ok,
      `status=${res.status}, body-head="${body.slice(0, 80).replace(/\n/g, "↵")}"`,
    );
  } catch (err) {
    record("POST /codex/mcp initialize", false, String(err));
  }

  // Summary
  console.log();
  const passed = checks.filter((c) => c.ok).length;
  console.log(`──── ${passed}/${checks.length} passed`);
  if (passed !== checks.length) process.exit(1);
}

run();
