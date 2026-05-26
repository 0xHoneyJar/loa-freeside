# packages/freeside-registry/

**Package**: `@freeside/freeside-registry` · **Domain**: network · **Status**: scaffold

Beacon aggregator + federation manifest server for the `*-api` cell network (per [ADR-009 §D-2](../../decisions/009-freeside-hexagonal-federation.md)). Maintains `registry.yaml` (the L1 source-of-truth list of registered cells) and (planned) exposes `/.well-known/federation.json` (the L5 ambient-discovery endpoint). Today the federation-manifest serving lives in `apps/mcp-gateway/src/app.ts`; the planned shape below relocates it here per ADR-007 §D-5.

## Planned shape

Per [ADR-007 §D-5 + D-8](../../decisions/007-loa-freeside-absorption.md):

```
packages/freeside-registry/
├── registry.yaml                # canonical cell list (parallels loa-constructs/registry.yaml)
├── src/
│   ├── server.ts                # HTTP server exposing /.well-known/federation.json + per-tenant authenticated manifest routes
│   ├── aggregator.ts            # fetches each cell's /.well-known/beacon.json (5min refresh)
│   ├── visibility.ts            # public / unlisted / internal filtering per D-8
│   ├── redaction.ts             # redaction rules per D-8 (owner.email, pricing URLs, internal hostnames)
│   └── cache.ts                 # per-tenant cache partitioning per D-8
├── tests/
├── package.json
└── README.md
```

## Visibility model (D-8)

| `beacon.visibility` | Public `/.well-known/federation.json` | Authenticated per-tenant manifest | MCP `inspectModule(<slug>)` |
|---------------------|---|---|---|
| `public` | YES | YES | YES |
| `unlisted` | NO | YES (if tenant has access) | YES (if tenant has access) |
| `internal` | NO | NO | YES (if caller has tenant scope claim) |

Authentication required for non-public paths. See ADR-007 §D-8 for full threat model + auth/scope details.

## Registry schema

`registry.yaml` mirrors `loa-constructs/registry.yaml` shape, with the `*-api` slug convention per [ADR-009 §D-2](../../decisions/009-freeside-hexagonal-federation.md) and additional fields `deployment_url` + `runtime_state` for operator-truth marking:

```yaml
version: 1
modules:
  storage-api:
    git_url: https://github.com/0xHoneyJar/storage-api.git
    beacon_url: https://storage.0xhoneyjar.xyz/.well-known/beacon.json
    deployment_url: https://storage-api-production.up.railway.app
    visibility: public
    owner: 0xHoneyJar
    added: "2026-05-18"
    runtime_state: deployed
    notes: |
      Free-form: deploy quirks, rename-pending, health-path mismatches, etc.
  # ...
```

## What lives here

Currently: this README + the `registry.yaml` cell index. Module scaffolding (`src/server.ts`, `src/aggregator.ts`, etc.) lands in subsequent ADR-007 §Implementation steps. The federation-manifest serving today lives in `apps/mcp-gateway/src/app.ts` — relocation to `packages/freeside-registry/src/server.ts` is the planned ADR-007 §D-5 shape.

## Domain boundary

Network path. CI enforced.

## Related

- [ADR-007 §D-5](../../decisions/007-loa-freeside-absorption.md) — federation manifest endpoint
- [ADR-007 §D-8](../../decisions/007-loa-freeside-absorption.md) — visibility + auth model
- [ADR-007 Appendix A](../../decisions/007-loa-freeside-absorption.md) — BeaconV3 normative schema (what registry validates against)
- `packages/beacon-schema/` — the schema package
- `apps/mcp-gateway/` — the federation router that consults this registry
- `loa-constructs/registry.yaml` — analog parent registry for the construct ecosystem
