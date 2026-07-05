/**
 * Contract tests · ordering verbs (fulfillment-surface S2, SDD §3.1).
 *
 * A scripted node:http fixture server plays the ordering-service PUBLIC contract
 * (PR-A, SDD D7) — zero new deps, zero live network in the default run. Each row
 * of the SDD §3.1 verb table is pinned: response schema + exit code.
 *
 * Anti-fixture-tautology (S2-T6): ORDERING_DIFFERENTIAL=1 runs one live shape
 * comparison against the deployed service; skipped visibly otherwise.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { orderVerb } from "../src/verbs/order.js";
import { kitchenVerb } from "../src/verbs/kitchen.js";
import { fulfillVerb } from "../src/verbs/fulfill.js";
import { EXIT, isPublicOrder } from "../src/lib/ordering-schemas.js";

const TOKEN = "test-token-sekrit";

// ─── fixture server: scripted route → [responses] (shift per hit) ────────────
type Scripted = { status: number; body: unknown };
type Script = Map<string, Scripted[]>; // "METHOD path" → queue (last entry repeats)

function makeOrder(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    order_id: "ord-fx-1",
    product: "community-onboarding",
    state: "producing",
    placed_at_unix: 1_700_000_000,
    updated_at_unix: 1_700_000_100,
    recipe_id: "community-onboarding",
    ingredients: { sonar: "pending", score: "pending", worlds_manifest: "complete", discord_observer: "optional", shadow_preview: "blocked" },
    probe_meta: { worlds_manifest: { status: "complete", probed_at_unix: 1_700_000_050, source: "interval" } },
    operator_audit: [],
    ...over,
  };
}

async function withServer(script: Script, fn: (baseUrl: string, hits: string[]) => Promise<void>): Promise<void> {
  const hits: string[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const key = `${req.method} ${req.url}`;
    hits.push(key);
    const queue = script.get(key);
    if (!queue || queue.length === 0) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unscripted route: " + key }));
      return;
    }
    const entry = queue.length > 1 ? queue.shift()! : queue[0];
    res.writeHead(entry.status, { "content-type": "application/json" });
    res.end(JSON.stringify(entry.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`, hits);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

/**
 * Run a verb with env + captured stdout lines.
 * Sets ORDERING_SERVICE_URL_UNSAFE_HTTP=1 to bypass the HTTPS check for test
 * HTTP servers — this is test infrastructure only, never in production.
 */
async function runVerb(
  verb: (args: string[]) => Promise<number>,
  args: string[],
  baseUrl: string,
  opts: { token?: string } = {},
): Promise<{ code: number; lines: unknown[] }> {
  const prevUrl = process.env.ORDERING_SERVICE_URL;
  const prevTok = process.env.ORDERING_SERVICE_TOKEN;
  const prevUnsafeHttp = process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP;
  process.env.ORDERING_SERVICE_URL = baseUrl;
  process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP = "1";
  if (opts.token !== undefined) process.env.ORDERING_SERVICE_TOKEN = opts.token;
  else delete process.env.ORDERING_SERVICE_TOKEN;

  const lines: unknown[] = [];
  const origLog = console.log;
  console.log = (msg?: unknown) => {
    lines.push(typeof msg === "string" ? JSON.parse(msg) : msg);
  };
  try {
    const code = await verb(args);
    return { code, lines };
  } finally {
    console.log = origLog;
    if (prevUrl === undefined) delete process.env.ORDERING_SERVICE_URL;
    else process.env.ORDERING_SERVICE_URL = prevUrl;
    if (prevUnsafeHttp === undefined) delete process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP;
    else process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP = prevUnsafeHttp;
    if (prevTok === undefined) delete process.env.ORDERING_SERVICE_TOKEN;
    else process.env.ORDERING_SERVICE_TOKEN = prevTok;
  }
}

/**
 * Like runVerb but does NOT set ORDERING_SERVICE_URL_UNSAFE_HTTP — used for HTTPS
 * enforcement tests where the protocol check must fire.
 */
async function runVerbExact(
  verb: (args: string[]) => Promise<number>,
  args: string[],
  url: string,
  opts: { token?: string } = {},
): Promise<{ code: number; lines: unknown[] }> {
  const prevUrl = process.env.ORDERING_SERVICE_URL;
  const prevTok = process.env.ORDERING_SERVICE_TOKEN;
  const prevUnsafeHttp = process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP;
  process.env.ORDERING_SERVICE_URL = url;
  delete process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP;
  if (opts.token !== undefined) process.env.ORDERING_SERVICE_TOKEN = opts.token;
  else delete process.env.ORDERING_SERVICE_TOKEN;

  const lines: unknown[] = [];
  const origLog = console.log;
  console.log = (m?: unknown) => lines.push(typeof m === "string" ? JSON.parse(m) : m);
  try {
    const code = await verb(args);
    return { code, lines };
  } finally {
    console.log = origLog;
    if (prevUrl === undefined) delete process.env.ORDERING_SERVICE_URL;
    else process.env.ORDERING_SERVICE_URL = prevUrl;
    if (prevUnsafeHttp === undefined) delete process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP;
    else process.env.ORDERING_SERVICE_URL_UNSAFE_HTTP = prevUnsafeHttp;
    if (prevTok === undefined) delete process.env.ORDERING_SERVICE_TOKEN;
    else process.env.ORDERING_SERVICE_TOKEN = prevTok;
  }
}

// ─── S2-T1: config + error envelope + redaction ──────────────────────────────

test("order: missing ORDERING_SERVICE_URL → usage envelope, exit 1", async () => {
  const prev = process.env.ORDERING_SERVICE_URL;
  delete process.env.ORDERING_SERVICE_URL;
  const lines: unknown[] = [];
  const origLog = console.log;
  console.log = (m?: unknown) => lines.push(JSON.parse(String(m)));
  try {
    const code = await orderVerb(["status", "x"]);
    assert.equal(code, EXIT.USAGE);
    const env = lines[0] as { error: string; hint?: string };
    assert.match(env.error, /ORDERING_SERVICE_URL/);
    assert.ok(env.hint);
  } finally {
    console.log = origLog;
    if (prev !== undefined) process.env.ORDERING_SERVICE_URL = prev;
  }
});

test("redaction: token value never appears in any output line (NFR-1)", async () => {
  const script: Script = new Map([["POST /v1/orders/ord-fx-1/reprobe", [{ status: 401, body: { error: "unauthorized" } }]]]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(kitchenVerb, ["probe", "ord-fx-1"], baseUrl, { token: TOKEN });
    assert.equal(code, EXIT.API_ERROR);
    assert.ok(!JSON.stringify(lines).includes(TOKEN), "token leaked into output");
  });
});

test("error envelope: every failure path emits {error, ...} single object (FR-7a)", async () => {
  const script: Script = new Map([["GET /v1/orders/nope", [{ status: 404, body: { error: "order not found" } }]]]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(orderVerb, ["status", "nope"], baseUrl);
    assert.equal(code, EXIT.API_ERROR);
    const env = lines[0] as { error: string; http_status: number };
    assert.equal(env.error, "order not found");
    assert.equal(env.http_status, 404);
  });
});

// ─── S2-T1 additions: URL config validation (AC-29, AC-30) ───────────────────

test("url-config: http:// URL → exit 1, error mentions https, no HTTP call (AC-29)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code, lines } = await runVerbExact(kitchenVerb, ["probe", "ord-fx-1"], baseUrl, { token: TOKEN });
    assert.equal(code, EXIT.USAGE);
    assert.match((lines[0] as { error: string }).error, /https/i);
    assert.equal(hits.length, 0, "no HTTP call should be made for http:// URL");
  });
});

test("url-config: unparseable URL → exit 1, no HTTP call (AC-30)", async () => {
  await withServer(new Map(), async (_baseUrl, hits) => {
    const { code } = await runVerbExact(orderVerb, ["status", "ord-fx-1"], "not a url");
    assert.equal(code, EXIT.USAGE);
    assert.equal(hits.length, 0, "no HTTP call should be made for invalid URL");
  });
});

// ─── S2-T2: order place|status|ingredients ───────────────────────────────────

test("order place: POSTs envelope, prints {order_id}, exit 0", async () => {
  const script: Script = new Map([["POST /v1/orders", [{ status: 200, body: { order_id: "ord-new-1" } }]]]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(
      orderVerb,
      ["place", "--preset", "community-onboarding", "--inputs", '{"chain_id":"8453"}'],
      baseUrl,
    );
    assert.equal(code, EXIT.OK);
    assert.deepEqual(lines[0], { order_id: "ord-new-1" });
  });
});

test("order place: unknown preset surfaces server 400 + available_presets verbatim (FR-1)", async () => {
  const script: Script = new Map([
    ["POST /v1/orders", [{ status: 400, body: { error: "unknown product: espresso", available_presets: ["access-risk-audit", "community-onboarding"] } }]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(orderVerb, ["place", "--preset", "espresso", "--inputs", "{}"], baseUrl);
    assert.equal(code, EXIT.API_ERROR);
    const env = lines[0] as Record<string, unknown>;
    assert.deepEqual(env.available_presets, ["access-risk-audit", "community-onboarding"]);
  });
});

test("order status: PublicOrder passes guard, printed single-line, exit 0", async () => {
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder() }]]]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(orderVerb, ["status", "ord-fx-1"], baseUrl);
    assert.equal(code, EXIT.OK);
    assert.ok(isPublicOrder(lines[0]));
  });
});

test("order status: contract drift (missing order_id) → drift envelope, exit 3", async () => {
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: { nope: true } }]]]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(orderVerb, ["status", "ord-fx-1"], baseUrl);
    assert.equal(code, EXIT.API_ERROR);
    assert.match((lines[0] as { error: string }).error, /contract/);
  });
});

test("order ingredients: per-ingredient view joins probe_meta freshness", async () => {
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder() }]]]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(orderVerb, ["ingredients", "ord-fx-1"], baseUrl);
    assert.equal(code, EXIT.OK);
    const view = lines[0] as { ingredients: Record<string, { status: string; probed_at_unix?: number }> };
    assert.equal(view.ingredients.worlds_manifest.status, "complete");
    assert.equal(view.ingredients.worlds_manifest.probed_at_unix, 1_700_000_050);
    assert.equal(view.ingredients.sonar.probed_at_unix, undefined);
  });
});

// ─── S2-T3: kitchen probe|advance ────────────────────────────────────────────

test("kitchen probe: fresh outcome → exit 0; sends token; body carries probes", async () => {
  const script: Script = new Map([
    ["POST /v1/orders/ord-fx-1/reprobe", [{ status: 200, body: { ...makeOrder(), probes: { sonar: { status: "complete", probed_at_unix: 1, source: "reprobe", freshness: "fresh" } } } }]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(kitchenVerb, ["probe", "ord-fx-1", "--ingredient", "sonar"], baseUrl, { token: TOKEN });
    assert.equal(code, EXIT.OK);
    const out = lines[0] as { probes: Record<string, { freshness: string }> };
    assert.equal(out.probes.sonar.freshness, "fresh");
  });
});

test("kitchen probe: ANY ambiguous ingredient → exit 4 (FR-4)", async () => {
  const script: Script = new Map([
    ["POST /v1/orders/ord-fx-1/reprobe", [{ status: 200, body: { ...makeOrder(), probes: { sonar: { probed_at_unix: 1, source: "reprobe", freshness: "ambiguous", error_class: "timeout" } } } }]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code } = await runVerb(kitchenVerb, ["probe", "ord-fx-1"], baseUrl, { token: TOKEN });
    assert.equal(code, EXIT.AMBIGUOUS);
  });
});

test("kitchen probe: cooldown 429 surfaced distinctly with retry_after_unix", async () => {
  const script: Script = new Map([
    ["POST /v1/orders/ord-fx-1/reprobe", [{ status: 429, body: { error: "reprobe cooldown active", retry_after_unix: 1_700_000_999 } }]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(kitchenVerb, ["probe", "ord-fx-1"], baseUrl, { token: TOKEN });
    assert.equal(code, EXIT.API_ERROR);
    const env = lines[0] as Record<string, unknown>;
    assert.equal(env.http_status, 429);
    assert.equal(env.retry_after_unix, 1_700_000_999);
  });
});

test("kitchen probe: missing token → usage envelope, exit 1, NO request sent", async () => {
  const script: Script = new Map();
  await withServer(script, async (baseUrl, hits) => {
    const { code } = await runVerb(kitchenVerb, ["probe", "ord-fx-1"], baseUrl, {});
    assert.equal(code, EXIT.USAGE);
    assert.equal(hits.length, 0, "no HTTP call should be made without a token");
  });
});

test("kitchen advance: invalid --status rejected client-side, NO request sent (FR-5)", async () => {
  const script: Script = new Map();
  await withServer(script, async (baseUrl, hits) => {
    const { code, lines } = await runVerb(
      kitchenVerb,
      ["advance", "ord-fx-1", "--ingredient", "sonar", "--status", "done"],
      baseUrl,
      { token: TOKEN },
    );
    assert.equal(code, EXIT.USAGE);
    assert.match((lines[0] as { hint: string }).hint, /pending\|in_progress\|complete/);
    assert.equal(hits.length, 0);
  });
});

test("kitchen advance: unknown ingredient (not on the order) rejected before write", async () => {
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder() }]]]);
  await withServer(script, async (baseUrl, hits) => {
    const { code, lines } = await runVerb(
      kitchenVerb,
      ["advance", "ord-fx-1", "--ingredient", "espresso", "--status", "complete"],
      baseUrl,
      { token: TOKEN },
    );
    assert.equal(code, EXIT.USAGE);
    assert.match((lines[0] as { hint: string }).hint, /sonar/);
    assert.ok(!hits.some((h) => h.includes("advance-ingredient")), "write must not be sent");
  });
});

test("kitchen advance: DRIFTED 200 GET body → exit 3, NO write sent (DISS-001 fail-closed)", async () => {
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: { nope: true } }]]]);
  await withServer(script, async (baseUrl, hits) => {
    const { code, lines } = await runVerb(
      kitchenVerb,
      ["advance", "ord-fx-1", "--ingredient", "sonar", "--status", "complete"],
      baseUrl,
      { token: TOKEN },
    );
    assert.equal(code, EXIT.API_ERROR);
    assert.match((lines[0] as { error: string }).error, /contract/);
    assert.ok(!hits.some((h) => h.includes("advance-ingredient")), "write must not be sent on drift");
  });
});

test("kitchen advance: order WITHOUT ingredients checklist → exit 4, NO write sent (DISS-001)", async () => {
  const noChecklist = makeOrder();
  delete (noChecklist as Record<string, unknown>).ingredients;
  delete (noChecklist as Record<string, unknown>).probe_meta;
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: noChecklist }]]]);
  await withServer(script, async (baseUrl, hits) => {
    const { code, lines } = await runVerb(
      kitchenVerb,
      ["advance", "ord-fx-1", "--ingredient", "sonar", "--status", "complete"],
      baseUrl,
      { token: TOKEN },
    );
    assert.equal(code, EXIT.AMBIGUOUS);
    assert.match((lines[0] as { error: string }).error, /no ingredients checklist/);
    assert.ok(!hits.some((h) => h.includes("advance-ingredient")), "write must not be sent without checklist");
  });
});

test("kitchen advance: happy path sends caller_note, prints audit tail, exit 0", async () => {
  const advanced = makeOrder({ operator_audit: [{ event: "operator.advance", ingredient: "sonar", status: "complete", token_label: "ordering-service-token", caller_note: "probes green", evidence: null, at_unix: 1 }] });
  const script: Script = new Map([
    ["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder() }]],
    ["POST /v1/orders/ord-fx-1/advance-ingredient", [{ status: 200, body: advanced }]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb(
      kitchenVerb,
      ["advance", "ord-fx-1", "--ingredient", "sonar", "--status", "complete", "--note", "probes green"],
      baseUrl,
      { token: TOKEN },
    );
    assert.equal(code, EXIT.OK);
    const out = lines[0] as { operator_audit_tail: { caller_note: string } };
    assert.equal(out.operator_audit_tail.caller_note, "probes green");
  });
});

test("kitchen advance: terminal-order conflict → exit 4 with server truth", async () => {
  const script: Script = new Map([
    ["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder({ state: "fulfilled" }) }]],
    ["POST /v1/orders/ord-fx-1/advance-ingredient", [{ status: 400, body: { error: "order already terminal" } }]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code } = await runVerb(
      kitchenVerb,
      ["advance", "ord-fx-1", "--ingredient", "sonar", "--status", "complete"],
      baseUrl,
      { token: TOKEN },
    );
    assert.equal(code, EXIT.AMBIGUOUS);
  });
});

// ─── S2-T4: fulfill watch ────────────────────────────────────────────────────

const noSleep = async (_ms: number): Promise<void> => {};

test("fulfill watch: change-only lines, fulfilled → exit 0", async () => {
  const producing = makeOrder();
  const fulfilled = makeOrder({ state: "fulfilled", fulfillment: { world_slug: "azuki", contact_email: "x@y.z", chain_id: "1", contract_address: "0x1" } });
  const script: Script = new Map([
    ["GET /v1/orders/ord-fx-1", [
      { status: 200, body: producing },
      { status: 200, body: producing }, // unchanged — must NOT emit a second line
      { status: 200, body: fulfilled },
    ]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--interval", "1"], baseUrl);
    assert.equal(code, EXIT.OK);
    assert.equal(lines.length, 2, "one line per CHANGE only");
    assert.equal((lines[1] as { state: string; world_slug: string }).world_slug, "azuki");
  });
});

test("fulfill watch: failed → exit 6", async () => {
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder({ state: "failed", refusal: { code: "x", reason: "y" } }) }]]]);
  await withServer(script, async (baseUrl) => {
    const { code } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1"], baseUrl);
    assert.equal(code, EXIT.ORDER_FAILED);
  });
});

test("fulfill watch: --timeout hits → timeout line, exit 5", async () => {
  // Rewritten for T-2: uses integer args and injected now to simulate elapsed time.
  // --timeout 2 --interval 1 satisfies the interval < timeout guard.
  // nowFn returns T0 on call 0 (startedAt), T0+2000 on all subsequent calls —
  // simulates 2 s elapsed after first poll, exceeding the 2 s timeout.
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder() }]]]);
  await withServer(script, async (baseUrl) => {
    const T0 = Date.now();
    let nowCalls = 0;
    const nowFn = (): number => (nowCalls++ === 0 ? T0 : T0 + 2000);
    const { code, lines } = await runVerb(
      (a) => fulfillVerb(a, noSleep, nowFn),
      ["watch", "ord-fx-1", "--timeout", "2", "--interval", "1"],
      baseUrl,
    );
    assert.equal(code, EXIT.WATCH_TIMEOUT);
    const last = lines.at(-1) as { watch: string };
    assert.equal(last.watch, "timeout");
  });
});

test("fulfill watch: --once prints snapshot and exits 0 without polling", async () => {
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body: makeOrder() }]]]);
  await withServer(script, async (baseUrl, hits) => {
    const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--once"], baseUrl);
    assert.equal(code, EXIT.OK);
    assert.equal(lines.length, 1);
    assert.equal(hits.length, 1);
  });
});

test("fulfill watch: transient failures exhausted → exit 2, surfaced (G-5)", async () => {
  // Unreachable base URL (closed port) — every poll is a transport failure.
  const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--interval", "1"], "http://127.0.0.1:9");
  assert.equal(code, EXIT.UNREACHABLE);
  assert.match((lines.at(-1) as { hint: string }).hint, /consecutive poll failures/);
});

// ─── S2-T4 additions: integer flag validation (AC-31–AC-35) ──────────────────

test("fulfill watch: --timeout 0 → exit 1, no HTTP call (AC-31)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--timeout", "0"], baseUrl);
    assert.equal(code, EXIT.USAGE);
    assert.match((lines[0] as { error: string }).error, /must be > 0/);
    assert.equal(hits.length, 0);
  });
});

test("fulfill watch: --timeout -5 → exit 1, no HTTP call (AC-32)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--timeout", "-5"], baseUrl);
    assert.equal(code, EXIT.USAGE);
    assert.equal(hits.length, 0);
  });
});

test("fulfill watch: --timeout abc → exit 1, names --timeout (AC-33)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--timeout", "abc"], baseUrl);
    assert.equal(code, EXIT.USAGE);
    assert.match((lines[0] as { error: string }).error, /--timeout/);
    assert.equal(hits.length, 0);
  });
});

test("fulfill watch: --interval 0 → exit 1, no HTTP call (AC-34)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--interval", "0"], baseUrl);
    assert.equal(code, EXIT.USAGE);
    assert.equal(hits.length, 0);
  });
});

test("fulfill watch: --timeout 10 --interval 10 → exit 1, interval must be less than timeout (AC-35)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code, lines } = await runVerb(
      (a) => fulfillVerb(a, noSleep),
      ["watch", "ord-fx-1", "--timeout", "10", "--interval", "10"],
      baseUrl,
    );
    assert.equal(code, EXIT.USAGE);
    assert.match((lines[0] as { error: string }).error, /--interval must be less than --timeout/);
    assert.equal(hits.length, 0);
  });
});

// ─── S2-T3 additions: per-request timeout testability (AC-39) ────────────────

test("ordering-client: per-request timeout → exit 2, UNREACHABLE (AC-39)", async () => {
  // Custom server that delays 500 ms before responding — simulates a slow service.
  const slowServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(makeOrder()));
    }, 500);
  });
  await new Promise<void>((r) => slowServer.listen(0, "127.0.0.1", r));
  const { port } = slowServer.address() as AddressInfo;

  const prevTimeout = process.env.ORDERING_REQUEST_TIMEOUT_MS;
  process.env.ORDERING_REQUEST_TIMEOUT_MS = "50";
  try {
    const { code, lines } = await runVerb(orderVerb, ["status", "slow-ord"], `http://127.0.0.1:${port}`);
    assert.equal(code, EXIT.UNREACHABLE);
    assert.match((lines[0] as { error: string }).error, /timed out/);
  } finally {
    if (prevTimeout === undefined) delete process.env.ORDERING_REQUEST_TIMEOUT_MS;
    else process.env.ORDERING_REQUEST_TIMEOUT_MS = prevTimeout;
    await new Promise<void>((r) => slowServer.close(() => r()));
  }
});

// ─── S2-T4 additions: missing assertion coverage (AC-19, AC-26, AC-27, AC-37, AC-38) ──

test("url-safety: order_id with / is encodeURIComponent-escaped (AC-19)", async () => {
  // If the server receives GET /v1/orders/abc/123 (unencoded) it returns 404.
  // Correct encoding → GET /v1/orders/abc%2F123 → 200.
  const script: Script = new Map([["GET /v1/orders/abc%2F123", [{ status: 200, body: makeOrder({ order_id: "abc/123" }) }]]]);
  await withServer(script, async (baseUrl, hits) => {
    const { code } = await runVerb(orderVerb, ["status", "abc/123"], baseUrl);
    assert.equal(code, EXIT.OK);
    assert.equal(hits[0], "GET /v1/orders/abc%2F123");
  });
});

test("order place: malformed inline JSON → exit 1 (AC-26 / AC-37)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code } = await runVerb(orderVerb, ["place", "--preset", "x", "--inputs", '{"bad: json'], baseUrl);
    assert.equal(code, EXIT.USAGE);
    assert.equal(hits.length, 0);
  });
});

test("order place: @missing-file → exit 1, names file (AC-27)", async () => {
  await withServer(new Map(), async (baseUrl, hits) => {
    const { code, lines } = await runVerb(
      orderVerb,
      ["place", "--preset", "x", "--inputs", "@/tmp/__loa_nonexistent_fixture__.json"],
      baseUrl,
    );
    assert.equal(code, EXIT.USAGE);
    assert.ok(
      JSON.stringify(lines[0]).includes("__loa_nonexistent_fixture__"),
      "error should name the missing file path",
    );
    assert.equal(hits.length, 0);
  });
});

test("fulfill watch: poll response missing state → exit 3, ErrorEnvelope (AC-38)", async () => {
  // Body matches order shape except missing 'state' — fails isPublicOrder guard.
  const body = { order_id: "ord-fx-1", product: "x", placed_at_unix: 0, updated_at_unix: 0 };
  const script: Script = new Map([["GET /v1/orders/ord-fx-1", [{ status: 200, body }]]]);
  await withServer(script, async (baseUrl) => {
    const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--once"], baseUrl);
    assert.equal(code, EXIT.API_ERROR);
    assert.match((lines[0] as { error: string }).error, /contract/);
  });
});

// ─── S2-T6: differential vs deployed (env-gated, anti-fixture-tautology) ─────

test("differential: fixture PublicOrder shape matches the DEPLOYED service", { skip: process.env.ORDERING_DIFFERENTIAL !== "1" ? "set ORDERING_DIFFERENTIAL=1 (+ ORDERING_SERVICE_URL, ORDERING_DIFF_ORDER_ID) to run against the live service" : false }, async () => {
  const baseUrl = process.env.ORDERING_SERVICE_URL!;
  const orderId = process.env.ORDERING_DIFF_ORDER_ID ?? "6ddc06f5-0c6f-42b8-8377-768a4c2a302e";
  const res = await fetch(`${baseUrl}/v1/orders/${orderId}`);
  assert.equal(res.status, 200);
  const live = await res.json();
  assert.ok(isPublicOrder(live), "deployed GET /v1/orders/:id no longer matches the PublicOrder mirror — fixture drift");
  const fixtureKeys = Object.keys(makeOrder()).sort();
  const liveKeys = Object.keys(live as Record<string, unknown>).sort();
  const unknownToFixture = liveKeys.filter((k) => !fixtureKeys.includes(k) && !["resolved_buildings", "result_ref", "output", "refusal", "fulfillment", "ingredient_jobs"].includes(k));
  assert.deepEqual(unknownToFixture, [], `live service returns keys the fixture never models: ${unknownToFixture.join(",")}`);
});

// ─── FAGAN Phase-B review pins (loopback-only bypass · watch flag semantics) ──

test("url-config: remote http URL refused even with UNSAFE_HTTP set (fail-closed)", async () => {
  const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--once"], "http://ordering.example.com");
  assert.equal(code, EXIT.USAGE);
  assert.match((lines[0] as { error: string }).error, /https/i);
});

test("fulfill watch: lone --timeout below default interval clamps instead of failing", async () => {
  const fulfilled = makeOrder({ state: "fulfilled", fulfillment: { world_slug: "azuki", contact_email: "x@y.z", chain_id: "1", contract_address: "0x1" } });
  const script: Script = new Map([
    ["GET /v1/orders/ord-fx-1", [{ status: 200, body: fulfilled }]],
  ]);
  await withServer(script, async (baseUrl) => {
    const { code } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--timeout", "10"], baseUrl);
    assert.equal(code, EXIT.OK, "a lone --timeout smaller than the default interval must not be a usage error");
  });
});

test("fulfill watch: explicit --interval >= --timeout stays a usage error", async () => {
  const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--interval", "20", "--timeout", "10"], "https://ordering.example.com");
  assert.equal(code, EXIT.USAGE);
  assert.match((lines[0] as { error: string }).error, /--interval must be less than --timeout/);
});

test("fulfill watch: flag missing its value → explicit 'requires a value' error", async () => {
  const { code, lines } = await runVerb((a) => fulfillVerb(a, noSleep), ["watch", "ord-fx-1", "--interval", "--once"], "https://ordering.example.com");
  assert.equal(code, EXIT.USAGE);
  assert.match((lines[0] as { error: string }).error, /requires a value/);
});
