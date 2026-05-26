# @0xhoneyjar/freeside-operator-dash

**Inward-facing operator visibility surface** for the freeside `*-api` cell network. Sibling to [`apps/mcp-gateway/`](../mcp-gateway/) (which is outward-facing — federation discovery for partners + agent clients).

Per [ADR-009 §D-9](../../decisions/009-freeside-hexagonal-federation.md): two apps, two audiences, one network scope.

| App | Audience | Surface |
|---|---|---|
| `apps/mcp-gateway/` | External partners + agent clients | `mcp.0xhoneyjar.xyz` — federation discovery + per-tenant MCP routing |
| `apps/freeside-operator-dash/` (this) | THJ team (internal-operator persona per D-9) | Internal-only — cluster health, Soju-lens, phase scoreboard |

Source: [`grimoires/loa/proposals/freeside-operator-dash-kickoff.md`](../../grimoires/loa/proposals/freeside-operator-dash-kickoff.md)

## What it does

Reads [`packages/freeside-registry/registry.yaml`](../../packages/freeside-registry/registry.yaml) — the L1 canonical source-of-truth of the 8 `*-api` cells — and renders:

1. **Federation tile grid** — one tile per cell, colored by live probe state (`up` · `auth-gated` · `degraded` · `scaffold` · `down` · `unreachable`). Tiles show actual deployment URL + probed health path + latency.

2. **identity-api phase scoreboard** — G-1 through G-6 status with live evidence + beads references. Makes the BERA→Soju path immediately legible (Phase 1 deployed ✓, Phase 2 compose endpoint 400, Phase 3 Mibera dimensions 400, Phase 4 backfill not built).

3. **🌸 Soju-lens** (when `OPERATOR_WALLET` env var is set) — the actually-novel observability primitive. Parallel-fetches operator identity across every surface that exposes one (identity-api spine / compose / mibera-dims, honey-road), groups by field, surfaces DISCREPANCIES. The BERA→Soju gap is the visual headline: until Phase 3 lands, honey-road's Alchemy fallback will be the only non-null `displayName`.

## Run

```bash
# Local development (port 3030)
cd apps/freeside-operator-dash
pnpm install
pnpm dev

# With Soju-lens enabled
OPERATOR_WALLET=0xYourWalletAddress pnpm dev
```

Open http://localhost:3030/ in a browser.

### Routes

| Path | Returns |
|---|---|
| `GET /` | HTML dashboard (30s TTL cache) |
| `GET /healthz` | `{ ok: true, generatedAt: "..." }` (for self-monitoring) |
| `GET /api/state` | Full `DashState` JSON (for future client-side consumers) |

## Architecture

```
apps/freeside-operator-dash/
├── bin/http.ts           # @hono/node-server entry (PORT, default 3030)
├── src/
│   ├── app.ts            # Hono routes + cache orchestration
│   ├── registry.ts       # reads packages/freeside-registry/registry.yaml (server-side, in-process)
│   ├── probe.ts          # per-cell health probe (with HEALTH_PATH_OVERRIDES for gateway-mismatch-aware probing)
│   ├── soju-lens.ts      # parallel-fetch + discrepancy detection
│   ├── render.ts         # HTML rendering (fully baked, no browser fetches)
│   └── types.ts          # shared shapes (DashState, RegistryCell, ProbeStateKind, etc.)
├── package.json          # workspace dep on @0xhoneyjar/beacon-schema; adds `yaml`
└── tsconfig.json         # mirrors mcp-gateway's tsconfig
```

### Probe path overrides (gateway-mismatch-aware)

`apps/mcp-gateway/src/app.ts:51-74` (`probeTenant()`) hardcodes `/healthz` as the probe path, which 404s for several cells whose runtime serves health at `/`. Until `apps/mcp-gateway/src/tenants.ts` grows a per-tenant `health_path` field, this dashboard maintains `HEALTH_PATH_OVERRIDES` in `src/probe.ts`:

| Cell | Probe path | Why |
|---|---|---|
| `score-api` | `/` | Returns full status JSON (db: connected, scoring_version, etc.). `/healthz` 404s. |
| `sonar-api` | `/` | Returns `{"message":"Sonar API"}`. |
| `storage-api` | `/` | GraphQL playground HTML; non-404 means alive. |
| `inventory-api` | `/` | MCP server. 401 is the expected auth-gated response → state = `auth-gated` (not `down`). |
| All others | `/health` | Default (matches identity-api convention). |

## Scope & out-of-scope

In:
- Cluster health visualization for the 8 `*-api` cells
- Soju-lens cross-surface identity reconciliation
- identity-api phase scoreboard (G-1..G-6)

Out:
- Auth (deferred to T4 of the kickoff — until then, run behind Tailscale or guard with `OPERATOR_TOKEN`)
- The marketplace UI for external CMs (that's `score-dashboard` with `(cm-shell)` per ADR-009 §D-8 — different audience, different repo)
- Replacement for Grafana / CloudWatch — this is operator-context awareness, not infrastructure metrics
- Multi-tenant operator scoping (single THJ operator persona only for v0.1-v1.0)

## Related

- Kickoff proposal: [`grimoires/loa/proposals/freeside-operator-dash-kickoff.md`](../../grimoires/loa/proposals/freeside-operator-dash-kickoff.md)
- Bridgebuilder verdict (audit trail): [`grimoires/loa/proposals/archive/freeside-federation-topology.md`](../../grimoires/loa/proposals/archive/freeside-federation-topology.md)
- v0 spike (superseded by this): [`tools/operator-dash/`](../../tools/operator-dash/)
- Registry source: [`packages/freeside-registry/registry.yaml`](../../packages/freeside-registry/registry.yaml)
- Sibling app: [`apps/mcp-gateway/`](../mcp-gateway/)
- ADR-009: [`decisions/009-freeside-hexagonal-federation.md`](../../decisions/009-freeside-hexagonal-federation.md)
