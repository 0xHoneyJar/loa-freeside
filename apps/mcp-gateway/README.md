# apps/mcp-gateway/

**Domain**: network · **Status**: scaffold (no code yet)

TS MCP federation router for the `freeside-*` module ecosystem. Routes `mcp.0xhoneyjar.xyz/{slug}` to registered upstream modules, aggregates per-tenant beacons, and exposes `/federation.json` for ambient agent discovery.

## What lives here

This directory is the destination for code absorbed from `freeside-mcp-gateway` per [ADR-007 §Implementation step 4](../../decisions/007-loa-freeside-absorption.md). Until that absorption PR lands, this dir only contains this README.

Expected structure after absorption:

```
apps/mcp-gateway/
├── src/
│   ├── app.ts                   # entry point
│   ├── auth.ts                  # bearer-token validation
│   ├── beacon-cache.ts          # per-tenant beacon cache
│   ├── beacon-resolver.ts       # upstream beacon fetching (5min refresh)
│   ├── credentials-resolver.ts  # tenant credential resolution
│   └── tenants.ts               # registry-driven tenant rows
├── tests/
├── package.json                 # @freeside/mcp-gateway
└── README.md
```

## Domain boundary

This is a **network** path per [ADR-007 §D-3](../../decisions/007-loa-freeside-absorption.md). Commits to this directory MUST NOT mix with `grimoires/freeside-platform/` or platform-only `packages/` in the same PR. Enforced by `.github/workflows/path-domain-check.yml`.

## Related

- [ADR-007](../../decisions/007-loa-freeside-absorption.md) — dual-concern absorption doctrine
- [RFC #207](https://github.com/0xHoneyJar/loa-freeside/issues/207) — original proposal
- `packages/beacon-schema/` — BeaconV3 schema this gateway validates against
- `packages/freeside-registry/` — the registry this gateway consults
