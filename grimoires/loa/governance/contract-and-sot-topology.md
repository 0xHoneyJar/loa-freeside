---
# Straylight governance (tools/governance-doctor.sh)
use_label: usable
read_state: read
source_type: ai-derived   # authored 2026-06-19 from direct grounding (registry, freeside-cli, live probe, repo); operator may promote to operator-validated
as_of: 2026-06-19
supersedes: scattered "where do contracts live" claims across CLAUDE.md / ADR-009 / specs
---

# Contract & SoT Topology — loa-freeside

> One home per contract scope. Both parties point at the SAME home. A contract is only
> "agreed" when producer and consumer resolve to ONE canonical artifact — not a copy.
> This map names every contract/SoT surface, its single home, and its boundary, so a
> future session never has to guess which "contract" a thing means.

Authored as the governance deliverable of the 2026-06-19 TEND session (registry +
live-probe re-grounding). The companion mechanism is `tools/governance-doctor.sh`.

## The rule (single-SoT discipline)

1. Every contract scope has exactly **one** canonical home (the SoT).
2. Producer and consumer both reference that home — never a private copy.
3. The home is **verifiable**: a live instrument reads it and fails loud on drift.
4. A second copy of the same data is a **hazard**, not a convenience — drift is silent
   (see HAZARD-1 below: this exact failure is live in the repo today).

## The four surfaces (all called "contract" — DO NOT conflate)

| Scope | Governs | Canonical home (SoT) | Verifier | Status |
|---|---|---|---|---|
| **Federation (cell↔cell)** | which cells exist · deploy/runtime state · `consumes:` edges · sealed_schemas | `packages/freeside-registry/registry.yaml` | `freeside-cli doctor` | registry REAL; **sealed_schemas = 64-zero PLACEHOLDERS** (declared, not real) |
| **freeside ↔ hounfour (bilateral)** | the loa-freeside↔loa-hounfour pinned entrypoints + conformance vector | `spec/contracts/contract.json` | `spec/contracts/validate.mjs` + tests | real, in use |
| **ACVP event schemas** | BillingEntry / AnchorVerification schema conformance | `tests/e2e/contract-validator/` (ajv server) | the validator service | real |
| **ACVP protocol-definer** | the event envelope + `event_type→schema` registry | `packages/events/beacon.yaml` (in-repo BeaconV3) | `acvp_invariant: schema_enforcement` | real declaration; invariant aspirational |

The operator's "single SoT for contracts" question is about the **Federation** row — the
cell↔cell sealed_schemas. Home = the registry. The other three are DIFFERENT scopes that
share the word "contract"; they are NOT the federation contract and must not be folded in.

## Live cell state (probed 2026-06-19)

| Cell | HTTP | runtime_state |
|---|---|---|
| sonar-api (+ belt-gateway) | 200 / 200 | deployed |
| storage-api · identity-api · activities-api | 200 | deployed |
| inventory-api | 401 (auth-gated, alive) | deployed |
| score-api | 302 (live) | deployed |
| mint-api | 404 (routeless shell) | scaffolded |
| ledger-api | 404 (not deployed) | scaffolded — registered 2026-06-19 |
| mediums-api · events-api | — | not-built (libraries) |

Beacons (`*.0xhoneyjar.xyz/.well-known/beacon.json`): **all 404** — the federation-
discovery gap. Until DNS points at Railway + cells serve a beacon route, contracts cannot
auto-discover (membership-graph S2 work).

## ⚠ SoT-coherence hazards (open)

1. **HAZARD-1 — the registry has TWO read paths; the default reads a STALE copy.**
   `freeside-cli doctor` with no `--registry` calls `loadRegistry()`, which reads the
   package-bundled `@freeside/freeside-registry/registry.yaml` — a pnpm `file:` install
   COPY frozen at install time (currently missing `ledger-api`: reads 9 modules, not 10).
   The canonical source is `packages/freeside-registry/registry.yaml`. **Trustworthy
   invocation until fixed:**
   `freeside-cli doctor --registry packages/freeside-registry/registry.yaml`
   → FIX (bead): make `loadRegistry()` default to the repo-canonical source, or add a
   build-time sync, so the default path can never read a stale copy. This is the
   single-SoT rule applied to the tool that enforces it.

2. **HAZARD-2 — federation sealed_schemas are placeholders.** Every cell beacon 404s;
   sealed_schemas are 64-zero. The contracts are DECLARED, not REAL. Making them real =
   the federation-contract-suite cycle
   (`grimoires/loa/specs/enhance-federation-contract-suite.md`) — a separate high-stakes
   build (cheval council), NOT this governance session.

3. **HAZARD-3 (CLOSED 2026-06-19) — schema once broke the probe.** `events-api`'s null
   `beacon_url` violated the registry schema (which required a string), crashing
   `freeside-cli doctor`. Fixed: `beacon_url → Schema.NullOr` in
   `packages/freeside-registry/src/registry.ts`. The instrument that keeps the SoT honest
   must itself stay green — a `doctor`-runs check belongs in CI.

## Instruments

- **Live cell/deploy truth:** `freeside-cli doctor --registry packages/freeside-registry/registry.yaml`
- **Stale-artifact governance:** `tools/governance-doctor.sh` (loud → `--stamp` → `--teeth`)
- **Canonical SoT pointers** (what root docs now defer to): the `<!-- straylight-governance -->`
  banners stamped into `README.md` + `CLAUDE.md` on 2026-06-19 point live state here / to
  the registry, not to their own prose.
