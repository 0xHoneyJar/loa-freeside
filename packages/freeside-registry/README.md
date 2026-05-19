# packages/freeside-registry/

**Package**: `@freeside/freeside-registry` · **Domain**: network · **Status**: scaffold

Beacon aggregator + federation manifest server for the `freeside-*` module network. Maintains `registry.yaml` (the L1 source-of-truth list of registered modules) and exposes `/federation.json` (the L5 ambient-discovery endpoint).

## Planned shape

Per [ADR-007 §D-5 + D-8](../../decisions/007-loa-freeside-absorption.md):

```
packages/freeside-registry/
├── registry.yaml                # canonical module list (parallels loa-constructs/registry.yaml)
├── src/
│   ├── server.ts                # HTTP server exposing /federation.json + /federation/{tenant}.json
│   ├── aggregator.ts            # fetches each module's /.well-known/beacon.json (5min refresh)
│   ├── visibility.ts            # public / unlisted / internal filtering per D-8
│   ├── redaction.ts             # redaction rules per D-8 (owner.email, pricing URLs, internal hostnames)
│   └── cache.ts                 # per-tenant cache partitioning per D-8
├── tests/
├── package.json
└── README.md
```

## Visibility model (D-8)

| `beacon.visibility` | Public `/federation.json` | Authenticated `/federation/{tenant}.json` | MCP `inspectModule(<slug>)` |
|---------------------|---|---|---|
| `public` | YES | YES | YES |
| `unlisted` | NO | YES (if tenant has access) | YES (if tenant has access) |
| `internal` | NO | NO | YES (if caller has tenant scope claim) |

Authentication required for non-public paths. See ADR-007 §D-8 for full threat model + auth/scope details.

## Registry schema

`registry.yaml` mirrors `loa-constructs/registry.yaml` shape:

```yaml
version: 1
modules:
  freeside-storage:
    git_url: https://github.com/0xHoneyJar/freeside-storage.git
    beacon_url: https://storage.freeside.0xhoneyjar.xyz/.well-known/beacon.json
    visibility: public
  # ...
```

## What lives here

Currently: this README. Module scaffolding lands in subsequent ADR-007 §Implementation steps (workspace creation is step 3; this README is part of step 3; functional code is steps 6-7).

## Domain boundary

Network path. CI enforced.

## Related

- [ADR-007 §D-5](../../decisions/007-loa-freeside-absorption.md) — federation manifest endpoint
- [ADR-007 §D-8](../../decisions/007-loa-freeside-absorption.md) — visibility + auth model
- [ADR-007 Appendix A](../../decisions/007-loa-freeside-absorption.md) — BeaconV3 normative schema (what registry validates against)
- `packages/beacon-schema/` — the schema package
- `apps/mcp-gateway/` — the federation router that consults this registry
- `loa-constructs/registry.yaml` — analog parent registry for the construct ecosystem
