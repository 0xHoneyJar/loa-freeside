/**
 * freeside-mcp-gateway — federation gateway for MCP services.
 *
 * One Hono app fronts mcp.0xhoneyjar.xyz and routes path-prefixed requests
 * to upstream tenant services (codex, score, future partners). Streaming
 * bodies (SSE / Streamable-HTTP) pass through transparently — the gateway
 * does NOT buffer responses for tool calls.
 *
 * Routes:
 *   GET  /                              → federation index (HTML)
 *   GET  /.well-known/federation.json   → machine-readable tenant manifest
 *   GET  /healthz                       → ok
 *   GET  /{slug}/.well-known/mcp.json   → proxy + rewrite transports[].url
 *   *    /{slug}/*                      → proxy as-is (streaming-aware)
 *
 * Per [[hono-mcp-double-write-bug]] (memory): when forwarding streaming
 * upstreams, return `new Response(upstream.body, ...)` directly. NEVER
 * `new Response(null, 200)` after streaming starts — that triggers the
 * @hono/node-server double-write bug.
 */

import { Hono } from "hono";
import { JSONSchema, Schema } from "effect";
import { BeaconV2JsonSchema } from "@0xhoneyjar/beacon-schema";
import { TENANTS, TenantSchema, TenantsSchema, findTenant, type Tenant } from "./tenants.js";
import { checkAccess, isAuthorizedOperator } from "./auth.js";
import { refreshAllBeacons, startBeaconRefresh } from "./beacon-cache.js";
import { resolveTenant } from "./beacon-resolver.js";
import { resolveUpstreamCredential } from "./credentials-resolver.js";

const app = new Hono();

const GATEWAY_ORIGIN =
  process.env.GATEWAY_ORIGIN ?? "https://mcp.0xhoneyjar.xyz";

// ────── tenant health probing ──────

type HealthStatus = "up" | "down" | "unknown";

type HealthSnapshot = {
  status: HealthStatus;
  latencyMs?: number;
  checkedAt: number;
  error?: string;
};

const HEALTH_CACHE: Map<string, HealthSnapshot> = new Map();
const PROBE_INTERVAL_MS = 30_000;
const PROBE_TIMEOUT_MS = 4_000;

async function probeTenant(t: Tenant): Promise<HealthSnapshot> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const res = await fetch(`${t.upstream}/healthz`, {
      method: "GET",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return {
      status: res.ok ? "up" : "down",
      latencyMs: Date.now() - start,
      checkedAt: Date.now(),
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      status: "down",
      checkedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function probeAll(): Promise<void> {
  await Promise.all(
    TENANTS.map(async (t) => {
      const snap = await probeTenant(t);
      HEALTH_CACHE.set(t.slug, snap);
    }),
  );
}

// fire and forget on module load + periodic
void probeAll();
setInterval(() => {
  void probeAll();
}, PROBE_INTERVAL_MS);

// ────── beacon broadcast refresh (Cycle C v0.3 P3) ──────
// Non-blocking boot — gateway accepts requests immediately using tenants.ts
// curator fallback. First refresh completes in ~10s for the 2-tenant fleet,
// after which beacon-resolver.ts overlays beacon B-axis fields. setInterval
// drives the recurring 5min refresh per SDD §1.3. Both calls are no-ops if
// tests stop them via stopBeaconRefresh.
//
// Hotfix 2026-05-04: explicit .catch() instead of `void` prefix. `void` only
// suppresses the TS warning · Node still crashes on unhandled rejection
// (default since Node 15 with --unhandled-rejections=throw). Boot-time
// refresh fires before any caller has a stale cache to fall back to · if it
// rejects, the process exits and Railway marks the deploy FAILED. Catching
// here keeps boot truly non-blocking and lets the gateway serve curator
// fallback while individual fetches retry on the 5min schedule.
refreshAllBeacons().catch((err: unknown) => {
  console.warn(
    "[boot] refreshAllBeacons failed (gateway continues with curator fallback):",
    err,
  );
});
startBeaconRefresh();

function snapshotFor(slug: string): HealthSnapshot {
  return HEALTH_CACHE.get(slug) ?? { status: "unknown", checkedAt: 0 };
}

/**
 * Federation manifest schema (custom v0.1 — propose extension when partners adopt).
 * Defined as Effect.Schema so we get:
 *   - static TS type via Schema.Schema.Type<typeof FederationManifestSchema>
 *   - JSON Schema export at /schema/federation.json
 *   - runtime validation if we ever read manifests from external sources
 */
const FederationPricingViewSchema = Schema.Struct({
  model: Schema.String,
  unitUsd: Schema.optional(Schema.Number),
  description: Schema.String,
});

const FederationOwnerViewSchema = Schema.Struct({
  handle: Schema.String,
  contact: Schema.String,
});

const FederationTenantViewSchema = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  publisher: Schema.String,
  endpoint: Schema.String,
  discovery: Schema.String,
  documentation: Schema.optional(Schema.String),
  auth: Schema.String,
  // Wire-level header the upstream expects (registry declaration — caller composes from it).
  authHeader: Schema.optional(Schema.String),
  status: Schema.String,
  // v0.2 — flattened denormalized view; strict source-of-truth lives in /schema/tenant.json
  visibility: Schema.String,
  access: Schema.String,
  capabilities: Schema.Array(Schema.String),
  pricing: Schema.optional(FederationPricingViewSchema),
  owner: Schema.optional(FederationOwnerViewSchema),
});

const FederationManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal("0.1"),
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  publisher: Schema.String,
  origin: Schema.String,
  tenants: Schema.Array(FederationTenantViewSchema),
}).annotations({
  identifier: "FederationManifest",
  description: "Top-level manifest published at /.well-known/federation.json",
});

type FederationManifest = Schema.Schema.Type<typeof FederationManifestSchema>;
type FederationTenantView = Schema.Schema.Type<typeof FederationTenantViewSchema>;

function toTenantView(t: Tenant): FederationTenantView {
  return {
    slug: t.slug,
    name: t.name,
    description: t.description,
    publisher: t.publisher,
    endpoint: `/${t.slug}/mcp`,
    discovery: `/${t.slug}/.well-known/mcp.json`,
    documentation: t.documentation,
    auth: t.auth,
    authHeader: t.authHeader,
    status: t.status,
    visibility: t.visibility,
    access: t.access,
    capabilities: t.capabilities,
    pricing: t.pricing,
    owner: t.owner,
  };
}

function manifestForTenants(tenants: ReadonlyArray<Tenant>): FederationManifest {
  return {
    schemaVersion: "0.1",
    name: "freeside-mcp",
    title: "Freeside MCP Federation",
    description:
      "Federated gateway hosting multiple substrate-truth MCPs under one domain. Path-based routing — /{tenant}/mcp endpoints proxy to upstream services.",
    publisher: "0xHoneyJar",
    origin: GATEWAY_ORIGIN,
    tenants: tenants.map(toTenantView),
  };
}

// ────── meta routes ──────

app.get("/healthz", (c) => c.text("ok"));

// Public manifest — only `visibility: public` tenants. This is the
// auth-free discovery surface. Partner registries and external clients
// poll this; nothing here is secret.
app.get("/.well-known/federation.json", (c) => {
  const visible = TENANTS.filter((t) => t.visibility === "public");
  return c.json(manifestForTenants(visible));
});

// Internal manifest — `public` + `internal`, but never `unlisted`.
// Operator-gated via `Authorization: Bearer ${OPERATOR_API_KEY}`. Used
// by the operator harness, freeside-characters, and other known callers
// that legitimately need to enumerate internal tenants. Never advertised
// publicly.
app.get("/internal/federation.json", (c) => {
  if (!isAuthorizedOperator(c)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const visible = TENANTS.filter((t) => t.visibility !== "unlisted");
  return c.json(manifestForTenants(visible));
});

// ────── Schema export endpoints ──────
// JSONSchema.make derives a JSON-Schema document from an Effect.Schema —
// partner authors / registry tooling use these to validate their own
// tenant submissions or federation manifests. Free, no extra step.

app.get("/schema/tenant.json", (c) => c.json(JSONSchema.make(TenantSchema)));
app.get("/schema/tenants.json", (c) => c.json(JSONSchema.make(TenantsSchema)));
app.get("/schema/federation.json", (c) => c.json(JSONSchema.make(FederationManifestSchema)));

// Beacon v2 schema export (Cycle C v0.3 P3) — partner authors / construct
// build steps validate their beacon.yaml against this. Sourced from the
// @0xhoneyjar/beacon-schema package so this stays in lockstep with what
// the gateway actually decodes at refresh time.
app.get("/.well-known/beacon-schema/v2.json", (c) => c.json(BeaconV2JsonSchema));

app.get("/status.json", (c) => {
  // Bridgebuilder PR#4 finding `status-credentialkey-leaks-publicly` (MED ·
  // security): credentialKey + credentialPresent are operationally sensitive
  // reconnaissance signals (env-var naming + which tenants have unset secrets).
  // Gate them behind operator auth WITHOUT changing the response shape — keys
  // remain present but null for unauthenticated callers so smoke-prod.ts and
  // existing v0.2 consumers continue to parse the document unchanged.
  const operatorAuthorized = isAuthorizedOperator(c);
  return c.json({
    gateway: { status: "up", origin: GATEWAY_ORIGIN, checkedAt: new Date().toISOString() },
    tenants: TENANTS.map((t) => {
      const resolved = resolveTenant(t);
      // Beacon freshness — informational only · existing fields preserved
      // for v0.2 consumers. credentialPresent is a boolean (never echoes
      // the secret value); credentialKey is the env-var NAME for operator
      // diagnostics ("did I set the right Railway secret?"). Both are
      // operator-gated per bridgebuilder finding above.
      const credentialKey = operatorAuthorized
        ? (resolved.credentialsRef?.key ?? null)
        : null;
      const credentialPresent = operatorAuthorized && resolved.credentialsRef?.key
        ? Boolean(process.env[resolved.credentialsRef.key])
        : null;
      return {
        slug: t.slug,
        name: resolved.name,
        ...snapshotFor(t.slug),
        checkedAtIso: HEALTH_CACHE.get(t.slug)?.checkedAt
          ? new Date(HEALTH_CACHE.get(t.slug)!.checkedAt).toISOString()
          : null,
        upstream: t.upstream,
        beacon: {
          source: resolved.beaconSource,
          ageSec: resolved.beaconAgeSec,
          authKind: resolved.authKind,
          credentialKey,
          credentialPresent,
        },
      };
    }),
  });
});

app.get("/", (c) => c.html(renderIndex()));

// ────── proxy routes ──────

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

function pruneRequestHeaders(input: Headers): Headers {
  const out = new Headers();
  input.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.append(key, value);
  });
  return out;
}

function pruneResponseHeaders(input: Headers): Headers {
  const out = new Headers();
  input.forEach((value, key) => {
    const k = key.toLowerCase();
    if (HOP_BY_HOP.has(k)) return;
    if (k === "content-encoding") return; // upstream already decoded for us
    out.append(key, value);
  });
  return out;
}

/** Build the upstream URL from the gateway request, stripping the /{slug} prefix. */
function buildUpstreamUrl(tenant: Tenant, gatewayUrl: URL): string {
  const prefix = `/${tenant.slug}`;
  const path = gatewayUrl.pathname.startsWith(prefix)
    ? gatewayUrl.pathname.slice(prefix.length) || "/"
    : gatewayUrl.pathname;
  return new URL(path + gatewayUrl.search, tenant.upstream).toString();
}

/** Rewrite a tenant's mcp.json discovery card so transports[].url is a gateway-absolute URL. */
function rewriteDiscoveryCard(
  tenant: Tenant,
  body: unknown,
): Record<string, unknown> {
  if (typeof body !== "object" || body === null) return {} as Record<string, unknown>;
  const card = { ...(body as Record<string, unknown>) };
  if (Array.isArray((card as { transports?: unknown[] }).transports)) {
    const transports = (card as { transports: unknown[] }).transports;
    card.transports = transports.map((t) => {
      if (typeof t !== "object" || t === null) return t;
      const obj = t as { url?: string } & Record<string, unknown>;
      const url = obj.url;
      if (typeof url === "string" && url.startsWith("/")) {
        return { ...obj, url: `${GATEWAY_ORIGIN}/${tenant.slug}${url}` };
      }
      return obj;
    });
  }
  // Indicate this card was federated.
  card._federated = {
    via: GATEWAY_ORIGIN,
    tenant: tenant.slug,
  };
  return card;
}

// Mount the proxy LAST so meta routes (/, /healthz, /.well-known/*) win.
app.all("/:slug/*", async (c) => {
  const slug = c.req.param("slug");
  const tenant = findTenant(slug);

  if (!tenant) {
    return c.json(
      { error: "tenant_not_found", slug, available: TENANTS.map((t) => t.slug) },
      404,
    );
  }

  if (tenant.status === "paused") {
    return c.json(
      { error: "tenant_paused", slug, message: "Tenant is temporarily unavailable." },
      503,
    );
  }

  // v0.2 access gate — runs BEFORE forward. Tenants with `access: open`
  // (e.g. codex) pass through unchanged; `api-key`/`allowlist` require a
  // matching per-tenant bearer; `x402` returns 402 until Phase 6 wires
  // payment-proof verification.
  const gate = checkAccess(c, tenant);
  if (!gate.allowed) {
    return c.json({ error: gate.reason, slug }, gate.status);
  }

  // v0.3 broadcast layer (Cycle C P3) — overlay beacon B-axis fields on top
  // of the curator tenant, then resolve the upstream credential the gateway
  // forwards in this hop. `resolved` carries the same A-axis as `tenant`
  // (slug/upstream/visibility/access/status) plus any beacon-derived auth
  // declaration. Credential resolution fails CLOSED — a misconfigured
  // tenant returns 502 (gateway lacks creds to forward upstream) instead
  // of forwarding without auth (PRD §7.2).
  //
  // Bridgebuilder PR#4 findings:
  //   - `app-credential-failure-returns-401` (MED · api-design): semantically
  //     401 means CALLER failed auth, but here the GATEWAY lacks creds. 502
  //     Bad Gateway accurately reflects "downstream/upstream wiring broken".
  //   - `credentials-resolver-reason-leaks-in-response` (LOW · security):
  //     verbose reason (env var names, internal slug/structure) leaks to
  //     anonymous callers. Move the diagnostic to logs; callers get a
  //     stable structured error code.
  const resolved = resolveTenant(tenant);
  const cred = resolveUpstreamCredential(resolved);
  if (!cred.resolved) {
    console.warn(
      "[gateway] credential resolution failed for tenant=%s: %s",
      slug,
      cred.reason,
    );
    return c.json(
      {
        error: "upstream credential unavailable",
        code: "tenant_misconfigured",
        slug,
      },
      502,
    );
  }

  const gatewayUrl = new URL(c.req.url);
  const upstreamUrl = buildUpstreamUrl(tenant, gatewayUrl);
  const isDiscovery = gatewayUrl.pathname.endsWith("/.well-known/mcp.json");

  const headers = pruneRequestHeaders(c.req.raw.headers);
  // Identify the proxy hop for upstream observability + debugging.
  headers.set("x-forwarded-by", `freeside-mcp-gateway/${slug}`);
  headers.set("x-forwarded-host", gatewayUrl.host);

  // v0.3 — inject the resolved upstream credential when the upstream
  // declares auth (codex/auth:none short-circuits to empty header → no-op).
  // The header value is NEVER logged. Setting after pruneRequestHeaders
  // ensures we overwrite any caller-supplied header with the same name
  // (e.g. caller-side X-MCP-Key from a v0.2-era client that still sets it).
  if (cred.header) {
    headers.set(cred.header, cred.value);
  }

  const init: RequestInit & { duplex?: "half" } = {
    method: c.req.method,
    headers,
  };

  // Only forward bodies for methods that have one. `duplex: "half"` is required
  // for streaming POST bodies (Node 22+ fetch).
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    init.body = c.req.raw.body;
    init.duplex = "half";
  }

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, init as RequestInit);
  } catch (err) {
    return c.json(
      {
        error: "upstream_unreachable",
        slug,
        message: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }

  // Discovery card — buffer + rewrite transports.
  if (isDiscovery && upstreamRes.ok) {
    const card = await upstreamRes.json().catch(() => ({}));
    const rewritten = rewriteDiscoveryCard(tenant, card);
    return c.json(rewritten, upstreamRes.status as 200);
  }

  // Everything else — stream the body through. This is what makes /mcp work
  // for SSE / Streamable-HTTP responses (initialize → result, tools/call →
  // event stream). DO NOT buffer.
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: pruneResponseHeaders(upstreamRes.headers),
  });
});

// ────── HTML index ──────

function renderIndex(): string {
  const rows = TENANTS.map((t) => {
    const snap = snapshotFor(t.slug);
    const dotClass = `dot dot--${snap.status}`;
    const ageS = snap.checkedAt ? Math.max(0, Math.round((Date.now() - snap.checkedAt) / 1000)) : null;
    const ageLabel = ageS === null ? "—" : ageS < 60 ? `${ageS}s ago` : `${Math.round(ageS / 60)}m ago`;
    const latencyLabel = snap.latencyMs ? `${snap.latencyMs}ms` : "—";
    return `
      <tr>
        <td>
          <span class="${dotClass}" title="${snap.status}${snap.error ? ` · ${escapeHtml(snap.error)}` : ""}"></span>
          <code>${t.slug}</code>
        </td>
        <td>${escapeHtml(t.name)}</td>
        <td class="desc">${escapeHtml(t.description)}</td>
        <td><a href="/${t.slug}/mcp" class="endpoint">/${t.slug}/mcp</a></td>
        <td class="meta">${latencyLabel}<br><span class="age">${ageLabel}</span></td>
      </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Freeside MCP — federation gateway</title>
  <meta name="description" content="Federation gateway for MCP services. One domain, many tenants. Live status." />
  <meta http-equiv="refresh" content="30" />
  <style>
    :root {
      --bg:        oklch(0.838 0.026 75.2);
      --panel:     oklch(0.788 0.026 75.2);
      --ink:       oklch(0.203 0.01  67.2);
      --ink-2:     oklch(0.336 0.009 67.5);
      --ink-mut:   oklch(0.456 0.008 67.6);
      --rule:      color-mix(in oklch, var(--ink) 20%, transparent);
      --rule-soft: color-mix(in oklch, var(--ink) 10%, transparent);
      --up:        oklch(0.62  0.16  142);
      --down:      oklch(0.55  0.20  27);
      --unknown:   oklch(0.65  0.05  85);
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--ink);
      margin: 0;
      padding: 3rem 2rem;
      line-height: 1.6;
    }
    .container { max-width: 64rem; margin: 0 auto; }
    h1 {
      font-family: Georgia, "Iowan Old Style", "Palatino", serif;
      font-weight: 400;
      font-size: 2.2rem;
      letter-spacing: -0.015em;
      margin: 0 0 0.4rem;
    }
    .lead { color: var(--ink-mut); margin: 0 0 1.75rem; max-width: 48rem; }
    code, .endpoint {
      font-family: ui-monospace, "SF Mono", Menlo, monospace;
      font-size: 0.9em;
    }
    code {
      background: var(--panel);
      padding: 0.1em 0.4em;
      border: 1px solid var(--rule);
    }
    .endpoint { color: var(--ink); border-bottom: 1px dashed var(--rule); }
    .endpoint:hover { border-bottom-style: solid; }
    table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; background: var(--bg); }
    th, td { text-align: left; padding: 0.7rem 0.95rem; border-top: 1px solid var(--rule-soft); border-bottom: 1px solid var(--rule-soft); vertical-align: middle; }
    thead th { background: var(--panel); font-family: Georgia, serif; font-weight: 400; font-size: 0.78rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-2); border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); }
    td.desc { color: var(--ink-2); font-size: 0.92em; }
    td.meta { font-size: 0.82em; color: var(--ink-mut); white-space: nowrap; }
    td.meta .age { color: var(--ink-mut); font-size: 0.85em; }
    .dot {
      display: inline-block; width: 0.6rem; height: 0.6rem; border-radius: 50%;
      vertical-align: middle; margin-right: 0.55rem; flex: 0 0 auto;
      box-shadow: 0 0 0 1px color-mix(in oklch, currentColor 30%, transparent);
    }
    .dot--up      { background: var(--up); }
    .dot--down    { background: var(--down); }
    .dot--unknown { background: var(--unknown); }
    .legend { font-size: 0.85em; color: var(--ink-mut); margin: 0.5rem 0 0; }
    .legend .dot { box-shadow: none; }
    a { color: var(--ink); }
    section { margin-top: 2.5rem; }
    section h2 {
      font-family: Georgia, serif; font-weight: 400; font-size: 1.05rem;
      letter-spacing: 0.18em; text-transform: uppercase;
      color: var(--ink); padding-top: 1.5rem; border-top: 1px solid var(--rule-soft); margin-bottom: 0.6rem;
    }
    .meta-row { color: var(--ink-mut); font-size: 0.9em; }
    .meta-row a { color: var(--ink); }
    .footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--rule-soft); color: var(--ink-mut); font-size: 0.85em; }
    pre {
      background: var(--panel); padding: 0.85rem 1rem;
      border: 1px solid var(--rule);
      overflow-x: auto; font-size: 0.82em;
      margin: 0.5rem 0 0;
    }
    @media (max-width: 640px) {
      td.desc { display: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>freeside mcp federation</h1>
    <p class="lead">one gateway, many tenants. each path slug is an MCP service routed through <code>${escapeHtml(GATEWAY_ORIGIN)}</code>. status auto-refreshes every 30s.</p>

    <table>
      <thead>
        <tr>
          <th style="width:9rem">tenant</th>
          <th style="width:9rem">name</th>
          <th>description</th>
          <th style="width:11rem">endpoint</th>
          <th style="width:7rem">latency</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="legend">
      <span class="dot dot--up"></span> up
      &nbsp;&nbsp;
      <span class="dot dot--down"></span> down
      &nbsp;&nbsp;
      <span class="dot dot--unknown"></span> probing
    </p>

    <section>
      <h2>connect</h2>
      <p class="meta-row">install snippets per agent at <a href="https://codex.0xhoneyjar.xyz/install"><code>docs-iota-cyan.vercel.app/install</code></a>. the gateway is a streamable-http MCP — <code>POST /{tenant}/mcp</code> for JSON-RPC, <code>GET /{tenant}/mcp</code> for server events.</p>
    </section>

    <section>
      <h2>endpoints</h2>
      <pre><a href="/.well-known/federation.json">GET /.well-known/federation.json</a>   tenant manifest
<a href="/status.json">GET /status.json</a>                       live tenant health
<a href="/healthz">GET /healthz</a>                           gateway liveness
GET /{tenant}/.well-known/mcp.json     tenant discovery card (rewritten)
*   /{tenant}/mcp                      MCP transport (streamable-http)</pre>
    </section>

    <div class="footer">
      <p>building something mibera-shaped and want a tenant slot? <a href="https://github.com/0xHoneyJar/freeside-mcp-gateway/issues/new">open an issue</a>. tool-first; agents come along for the ride.</p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default app;
