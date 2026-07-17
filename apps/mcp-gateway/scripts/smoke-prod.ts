/**
 * End-to-end smoke against the deployed gateway.
 *
 * Exercises every surface a real MCP client touches:
 *   1. /healthz
 *   2. /.well-known/federation.json
 *   3. /status.json
 *   4. /codex/.well-known/mcp.json   (proxy + rewrite)
 *   5. initialize                    (creates session)
 *   6. notifications/initialized     (notification, returns 202)
 *   7. tools/list                    (session lookup)
 *   8. tools/call list_zones         (substantive tool call)
 *   9. tools/call lookup_zone        (substantive tool call)
 *  10. GET stream (briefly) with session header
 *  11. DELETE with session header    (close)
 *
 * Exits non-zero if anything fails.
 */

const BASE = process.env.GATEWAY_BASE ?? "https://mcp.0xhoneyjar.xyz";
const TENANT = "codex";

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  const mark = ok ? "✓" : "✗";
  console.log(`${mark} ${name}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  // 1.
  try {
    const r = await fetch(`${BASE}/healthz`);
    const t = await r.text();
    record("/healthz", r.status === 200 && t.trim() === "ok", `${r.status} ${t.trim().slice(0, 30)}`);
  } catch (e) {
    record("/healthz", false, String(e));
  }

  // 2.
  try {
    const r = await fetch(`${BASE}/.well-known/federation.json`);
    const j = (await r.json()) as { tenants?: { slug: string }[] };
    record(
      "/.well-known/federation.json",
      r.status === 200 && (j.tenants?.length ?? 0) > 0,
      `tenants=${j.tenants?.map((x) => x.slug).join(",") ?? "?"}`,
    );
  } catch (e) {
    record("/.well-known/federation.json", false, String(e));
  }

  // 3.
  try {
    const r = await fetch(`${BASE}/status.json`);
    const j = (await r.json()) as { tenants?: { slug: string; status: string; latencyMs?: number }[] };
    const codex = j.tenants?.find((t) => t.slug === TENANT);
    record(
      "/status.json",
      r.status === 200 && codex?.status === "up",
      `${codex?.status ?? "?"}, latency=${codex?.latencyMs ?? "?"}ms`,
    );
  } catch (e) {
    record("/status.json", false, String(e));
  }

  // 4.
  try {
    const r = await fetch(`${BASE}/${TENANT}/.well-known/mcp.json`);
    const j = (await r.json()) as { transports?: { url?: string }[]; _federated?: { tenant?: string } };
    const transport = j.transports?.[0]?.url ?? "";
    const ok =
      r.status === 200 &&
      j._federated?.tenant === TENANT &&
      transport.startsWith("http") &&
      transport.includes(`/${TENANT}/`);
    record(`/${TENANT}/.well-known/mcp.json`, ok, `transport=${transport}`);
  } catch (e) {
    record(`/${TENANT}/.well-known/mcp.json`, false, String(e));
  }

  // 5. initialize
  let sessionId = "";
  try {
    const r = await fetch(`${BASE}/${TENANT}/mcp`, {
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
          clientInfo: { name: "smoke-prod", version: "0.1" },
        },
      }),
    });
    const body = await r.text();
    sessionId = r.headers.get("mcp-session-id") ?? "";
    const ok = r.status === 200 && sessionId.length > 0 && body.includes("protocolVersion");
    record("POST initialize", ok, `${r.status}, sid=${sessionId.slice(0, 8)}…`);
  } catch (e) {
    record("POST initialize", false, String(e));
  }

  // 6. notifications/initialized
  try {
    const r = await fetch(`${BASE}/${TENANT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    record("POST notifications/initialized", r.status === 202, `${r.status}`);
  } catch (e) {
    record("POST notifications/initialized", false, String(e));
  }

  // 7. tools/list
  try {
    const r = await fetch(`${BASE}/${TENANT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const body = await r.text();
    const toolMatches = body.match(/"name":"[a-z_]+"/g) ?? [];
    record("POST tools/list", r.status === 200 && toolMatches.length === 8, `${r.status}, tools=${toolMatches.length}`);
  } catch (e) {
    record("POST tools/list", false, String(e));
  }

  // 8. tools/call list_zones
  try {
    const r = await fetch(`${BASE}/${TENANT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "list_zones", arguments: {} },
      }),
    });
    const body = await r.text();
    const ok = r.status === 200 && body.includes("stonehenge") && body.includes("the-warehouse");
    record("POST tools/call list_zones", ok, `${r.status}`);
  } catch (e) {
    record("POST tools/call list_zones", false, String(e));
  }

  // 9. tools/call lookup_zone
  try {
    const r = await fetch(`${BASE}/${TENANT}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "lookup_zone", arguments: { slug: "bear-cave" } },
      }),
    });
    const body = await r.text();
    const ok = r.status === 200 && body.includes("Freetekno");
    record("POST tools/call lookup_zone(bear-cave)", ok, `${r.status}`);
  } catch (e) {
    record("POST tools/call lookup_zone", false, String(e));
  }

  // 10. GET stream
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2_000); // close after 2s
    const r = await fetch(`${BASE}/${TENANT}/mcp`, {
      method: "GET",
      headers: { Accept: "text/event-stream", "Mcp-Session-Id": sessionId },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    record(
      `GET /${TENANT}/mcp (event-stream)`,
      r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/event-stream"),
      `${r.status} ${r.headers.get("content-type")}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // AbortError is expected when we close the long-poll
    record(`GET /${TENANT}/mcp (event-stream)`, msg.includes("aborted") || msg.includes("AbortError"), msg.slice(0, 60));
  }

  // 11. DELETE close
  try {
    const r = await fetch(`${BASE}/${TENANT}/mcp`, {
      method: "DELETE",
      headers: { "Mcp-Session-Id": sessionId },
    });
    record(`DELETE /${TENANT}/mcp`, r.status === 200 || r.status === 204, `${r.status}`);
  } catch (e) {
    record(`DELETE /${TENANT}/mcp`, false, String(e));
  }

  console.log();
  const passed = checks.filter((c) => c.ok).length;
  const fmt = `${passed}/${checks.length}`;
  console.log(`──── ${fmt} passed against ${BASE}`);
  if (passed !== checks.length) {
    console.log("\nFailed steps:");
    checks.filter((c) => !c.ok).forEach((c) => console.log(`  ✗ ${c.name}  ${c.detail ?? ""}`));
    process.exit(1);
  }
}

main();
