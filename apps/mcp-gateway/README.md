# freeside-mcp-gateway

> federation gateway for MCP services. one domain, many tenants.

```
mcp.0xhoneyjar.xyz/
├── /                              federation index (HTML)
├── /.well-known/federation.json   machine-readable tenant manifest
├── /healthz                       ok
├── /codex/mcp                     proxies → codex-mcp upstream
├── /codex/.well-known/mcp.json    proxies → codex-mcp discovery (rewritten)
├── /codex/healthz                 proxies → codex-mcp healthz
└── /{tenant}/...                  routing-table lookup; 404 if not found
```

## why

per [`constructs-mcp-deployment-topology`](https://github.com/0xHoneyJar/construct-mibera-codex/blob/main/grimoires) Path C:

- compute-shaped MCPs (score, indexers) self-host
- data-shaped MCPs (codex, partner registries) belong behind a gateway
- gateway gives one install line, one cert, one observability layer
- streaming bodies (SSE / Streamable-HTTP) pass through transparently

per [`substrate-over-narrative`](https://github.com/0xHoneyJar/construct-mibera-codex/blob/main/grimoires) doctrine: every tenant is a substrate-truth surface; the gateway is a routing layer, not a substrate of its own.

## the registry-broadcast doctrine (`gateway-as-registry`)

> the gateway is a registry, not a vault. the MCP itself determines what it is — its capabilities, its auth shape, its pricing — via its own manifest. the gateway broadcasts the aggregated declarations and gates access to its own routing surface.

four-axis ownership applied to MCP federation:

| axis | who owns it | example |
| --- | --- | --- |
| connectivity | gateway routes to upstream | `mcp.0xhoneyjar.xyz/{slug}/mcp` |
| servicing (index) | gateway (registry) | `/.well-known/federation.json` aggregates declarations |
| distribution (proxy) | gateway (hot path) | streaming pass-through; bytes-untouched |
| **identity + auth + capabilities** | **upstream MCP (broadcast)** | upstream's `/.well-known/mcp.json` (federation-extended) |

the gateway curator decides three things and only three: routing (slug → upstream), visibility (which manifests list this tenant), and access (gateway-side gate). everything else — what the upstream is, how it auths, what it offers, what it costs — is the upstream's own broadcast.

**v0.2 transitional shape**: tenants.ts encodes both. fields like `auth`, `authHeader`, `capabilities`, `pricing`, `owner` are curator-encoded fallback. **v0.3 destination**: gateway fetches each upstream's federation-extended `/.well-known/mcp.json` at boot, merges into the federation manifest. tenants.ts shrinks to routing + gateway policy.

## stack

- hono 4 · streamable-http-aware proxy
- node 22 alpine · railway hosted
- pnpm 8 · tsx for dev · tsc for build

## adding a tenant

edit `src/tenants.ts`. status `live` exposes the tenant; status `paused` returns 503 without removing it from the manifest.

```ts
{
  // ── registry policy (curator-owned) ──
  slug: "score",
  upstream: "https://score-api-production.up.railway.app",
  visibility: "internal",   // public | internal | unlisted
  access: "api-key",        // open | allowlist | api-key | x402
  status: "live",
  // ── upstream broadcast (transitional curator-encoded fallback in v0.2) ──
  name: "Score Mibera",
  description: "Factor metadata + behavioral signals.",
  publisher: "0xHoneyJar",
  auth: "api-key",
  authHeader: "X-MCP-Key",  // surfaces in /federation.json so callers know what to send
  capabilities: ["tools"],
  pricing: { model: "free", description: "free for known callers" },
  owner: { handle: "0xHoneyJar", contact: "https://github.com/0xHoneyJar" },
}
```

per-tenant gateway gate env: `TENANT_{SLUG_UPPER}_API_KEY` (dashes in slug → underscores). example: `TENANT_SCORE_API_KEY=...`.

operator manifest gate env: `OPERATOR_API_KEY=...` — required to access `/internal/federation.json`.

## local dev

```bash
pnpm install
pnpm dev          # port 3000
pnpm smoke        # in another terminal — hits localhost:3000
```

`pnpm smoke` exercises (proxy + manifest):

1. `GET /healthz`
2. `GET /.well-known/federation.json`
3. `GET /codex/.well-known/mcp.json` (discovery rewriting)
4. `POST /codex/mcp` (MCP `initialize` round-trip via streaming proxy)

`pnpm smoke:auth` exercises (gate logic, pure-unit · 11 cases): open · api-key · allowlist · x402 across no-bearer / wrong-bearer / correct-bearer / env-unset (fail-closed) / dashed-slug-env-name.

`pnpm smoke:prod` runs the regression suite against the deployed gateway at `mcp.0xhoneyjar.xyz`.

## environment

| var | default | what |
| --- | --- | --- |
| `PORT` | `3000` | listen port |
| `GATEWAY_ORIGIN` | `https://mcp.0xhoneyjar.xyz` | absolute origin used in rewritten discovery cards + manifest |

## deploy

railway picks up `railway.toml` automatically. healthcheck at `/healthz`. node 22 alpine.

```bash
railway up        # deploy
railway logs      # tail
```

DNS: point `mcp.0xhoneyjar.xyz` at the railway service via `railway domain add`.

## phases

| phase | scope | status |
| --- | --- | --- |
| v0.1 | gateway proxies codex only · federation index · discovery rewriting · Effect.Schema | shipped |
| v0.2 | tenant axes (visibility / access / capabilities / pricing / owner) · `/internal/federation.json` operator-gated · per-tenant access gate (`open` / `api-key` / `allowlist` / `x402` returns 402) · score-mibera as internal tenant | shipped |
| v0.3 | upstream-broadcast layer · gateway fetches federation-extended `/.well-known/mcp.json` at boot · tenants.ts shrinks to routing + gateway policy | next |
| v0.4 | x402 payment-proof verification on `access: x402` tenants | first paying consumer |
| v0.5 | per-tenant analytics + partner submission flow | partner adoption signal |

## related

- [`construct-mibera-codex`](https://github.com/0xHoneyJar/construct-mibera-codex) — codex tenant; first MCP adopting this gateway
- [`construct-freeside`](https://github.com/0xHoneyJar/construct-freeside) — operations director (KRANZ); gateway cutovers fall under coordinating-cutover skill
- [`construct-beacon`](https://github.com/0xHoneyJar/construct-beacon) — defining-mcp-tools skill; tenant authors use this to scaffold their MCP

## license

MIT
