# ADR-012: Unify cluster liveness on the declared health contract

- **Status:** Proposed
- **Date:** 2026-06-20
- **Supersedes / relates:** ADR-008 (factory), ADR-011 (loa launcher · front door), ADR-009 (hexagonal federation)
- **Domain:** shared (the decision spans platform + network; implementation phases are scoped per-domain)

## Context

Liveness sensing — "is this cell up, and is it serving what it claims?" — is the
cluster's **single most-duplicated capability**, and it is actively drifting. It exists in
**six representations across two declaration contracts**, and the one hardened, spec-driven
implementation is orphaned from all of them:

1. `packages/freeside-registry/registry.yaml` → `runtime_state` field — **hand-typed** ("deployed because someone typed it").
2. The same file's dated `# Live-probe state (2026-05-25)` comment — a stale snapshot.
3. `apps/freeside-operator-dash/src/probe.ts` — its own probe, **no SSRF guard**, a per-slug `HEALTH_PATH_OVERRIDES` table + per-slug `if` special-cases.
4. `apps/mcp-gateway` `probeTenant()` (`app.ts:56`) — hits a hardcoded `${upstream}/healthz`.
5. `freeside-cli` `doctor --remote` — an explicit **stub** (`beacon_unreachable`).
6. `loa-cli/lib/probe.mjs` — the real one: SSRF-hardened (inet_aton/CIDR canonicalization, redirect re-guard), grant-gated, and it already reads a declared health contract (`service.{deployment_url, health_path, expected_status, auth_class, expected_body_marker}`) and classifies `live` / `gated-live` / `live-drifted` / `down` / `scaffold` / `unprobed`. **Consumed by nobody.**

They already disagree. `score-api` serves health at `/`; the gateway probes `/healthz` →
404 → reports the tenant **down** despite it being operational. Both `tenants.ts:197-201`
and `operator-dash/probe.ts:4-6` carry comments **explicitly deferring "a per-tenant
`health_path` field"** — i.e. both hand-rolled probes are waiting for the exact contract
`loa probe.mjs` already reads.

### Live evidence (the drift is real, and fast)

A probe of all 9 cells at the canonical health path each cell's own note declares
(`grimoires/loa/context/2026-06-20-cluster-coherence-snapshot.md`, 2026-06-20):

- Health paths are **shattered**: `/health` (activities, identity), `/` (sonar, storage),
  `/`+401 MCP (inventory), `/health`→404 (mint). A single-path prober misclassifies the majority.
- `score-api` `/` now returns **302**, not the health JSON the registry note hand-types — the
  field drifted within ~25 days. This is the `capability ≠ liveness` defection by construction:
  a maintained string cannot stay true.

## Decision

Adopt a **single declared health contract**, read by a **single probe**.

1. **Declare** `service: { deployment_url, health_path, expected_status, auth_class,
   expected_body_marker }` per cell. **SoT = `freeside-registry`** (the L1 module registry,
   ADR-007 §D-1) — the place a cell's federation-facing facts already live.
2. **One reader:** `loa-cli/lib/probe.mjs`. `freeside-cli doctor --remote` calls it; `loa
   census` derives lifecycle from it; the gateway and operator-dash read `health_path` from the
   declared contract instead of baking it.
3. **Derive, don't type:** `runtime_state` becomes a *derived* output of `classifyLifecycle(probe
   × corpse)` (ADR companion: the move-3 contract flip), not a maintained input. The dated
   comment is retired.
4. **Delete** the duplicates: the `HEALTH_PATH_OVERRIDES` table, the hardcoded `/healthz`, the
   doctor `--remote` stub, and the thrice-deferred per-tenant `health_path` TODO.

The naming IS the anti-corruption layer: "where is health?" is answered **once**, in the
declared contract, never re-decided per consumer.

## Consequences

**Positive** — deletes 3 hand-rolled probes + a stub + an override table + a thrice-deferred
TODO; removes the SSRF gap (the hand-rolled probes lack the guard `loa probe.mjs` has); fixes the
`score-api` "shows down" bug as a side effect; makes liveness a *derived, verifiable* fact, not a
hand-typed claim that drifts within a month.

**Cost / risk** — a migration across repos (registry schema + 2 consumers + freeside-cli). Each
cell's true `health_path` must be captured once (done — see appendix). `expected_body_marker`
guards the Railway "health-check measures process liveness only → false-healthy" case the registry
already worries about (`registry.yaml:175`) but cannot enforce today.

**Not chosen** — leaving each consumer to keep its own probe (status quo: guarantees continued
drift); or a new central health *service* (over-built — `loa probe.mjs` already exists and is
grant-gated/finn-safe).

## Migration (phased — each phase ships independently)

- **Phase 0 — declare** (`domain:platform`): add the `service` health contract to the
  `freeside-registry` schema (Effect Schema in `registry.ts`) + populate all 9 cells (appendix).
  Additive; no consumer change.
- **Phase 1 — gateway** (`domain:network`): `probeTenant()` reads `tenant.health_path` /
  `expected_status` from the declared contract; delete the hardcoded `/healthz`. Fixes score-api.
- **Phase 2 — operator-dash** (`domain:platform`): read the declared field; delete
  `HEALTH_PATH_OVERRIDES` + the per-slug `if`s.
- **Phase 3 — unify reader** (`domain:shared`): `freeside-cli doctor --remote` + `loa census`
  probe via `loa probe.mjs` as the single reader; land the move-3 `runtime_state` derivation;
  retire the dated comment.

Tracking: `arrakis-0jq7` (this), `arrakis-ybqz` (move-3 derive). Each phase is a normal
implement→review→audit cycle.

## Appendix — the declared health contract (live ground truth, 2026-06-20)

```yaml
# per-cell `service:` block for freeside-registry (Phase 0). Probed live 2026-06-20.
activities-api: { health_path: /health, expected_status: 200, auth_class: none,       expected_body_marker: '"service":"activities-api"' }
identity-api:   { health_path: /health, expected_status: 200, auth_class: none,       expected_body_marker: '"ok":true' }
inventory-api:  { health_path: /,        expected_status: 401, auth_class: static-key } # MCP, auth-gated → gated-live
sonar-api:      { health_path: /,        expected_status: 200, auth_class: none,       expected_body_marker: '"message":"Sonar API"' }
storage-api:    { health_path: /,        expected_status: 200, auth_class: none }       # GraphQL Playground HTML
score-api:      { health_path: /,        expected_status: 302, auth_class: none }       # ⚠ / now 302 (was health JSON) — verify the real liveness path before landing
mint-api:       { runtime_state: scaffolded }   # /health 404 (Railway edge) — no stable health route; classify scaffold
events-api:     { runtime_state: not-built }     # library, no deployment_url
mediums-api:    { runtime_state: not-built }     # npm-only, no HTTP runtime
```

> `score-api` is flagged: `/` returning 302 means the documented liveness path moved. Phase 1
> MUST re-resolve score-api's real health path (likely a redirect target or `/health`) before
> wiring — do not encode the 302 as `expected_status` without confirming it's stable.
