# Product Requirements Document — Legible Data-Store Topology (runtime-as-SoT projection)

> Cycle `datastore-legibility`. The collections-sot architecture (runtime = source of truth,
> registry = re-derived projection + operator-ratified labels, drift = loud) applied one layer
> down: to the cluster's database topology. Previous PRD archived:
> prd.prev-2026-07-03-collections-sot.md.

## 1. Problem statement

The operator cannot see which database each cell is wired to. Services declare they need a
`DATABASE_URL` (grounded: `shadow-mode`, `shadow-audit`, `ordering`, `apps/worker`, `themes/sietch`
all use `pg`), but **Railway injects the real connection at boot from the dashboard, not from code**
— so `registry.yaml` tracks HTTP liveness (`deployment_url`, `runtime_state`) but has **no
data-store field** (verified: `packages/freeside-registry/registry.yaml` schema header). The result:
"so many databases I can't read into," across two substrates (per-service Railway + AWS terraform).

**The operator's keystone insight** (this session): *"what happens if this goes stale? Ideally it's
the SoT."* A hand-authored `data_store` field IS the thing that goes stale — the runtime is the real
authority, so any typed value is a drifting cache. This is the same disease as the `COLLECTION_REGISTRY`
env the last cycle retired. The registry must be a **projection of runtime truth**, not a hand cache.

## 2. The reframe (the architecture, settled with the operator)

Exactly the collections-sot shape, on infra:

| Layer | Source of truth | Who authors | Staleness |
|-------|-----------------|-------------|-----------|
| **Derivable** (host, engine, reachable, migrations) | the **runtime** (the cell's live binding) | NOBODY — re-derived every `loa doctor` run from the cell's sanitized self-report | structurally impossible (never stored by hand) |
| **Ratified** (the human meaning: `host_fp → "shadow pg, the worldline ledger"`) | the **registry** | the **operator** (one ratify gesture) | only on a real DB re-point → caught as `contested` drift, fails loud |

The registry stops being a hand-maintained SoT and becomes a **re-derived projection over runtime +
the operator's ratified labels**. "Stale" is either impossible (derived layer) or loud (drift on a
ratified label) — never a silent lie.

## 3. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Every cell's DB binding is legible via one command | `loa doctor --data` (or `freeside doctor --data`) lists each cell → {engine, host_fp, reachable, migrations} — DERIVED, never hand-typed |
| G-2 | Staleness is structurally caught, never silent | derived layer re-derived each run; a ratified-label mismatch → `contested` + non-zero exit (fails loud) |
| G-3 | Zero new secrets, no vendor coupling | no `RAILWAY_TOKEN`, no Railway API; works across Railway + AWS + local identically |
| G-4 | The durable human meaning survives re-derives | operator-ratified `data_store` label carried across every re-derive (the /recall force-chain pattern); the agent never self-ratifies |
| G-5 | No secret ever leaks into the registry or logs | the connection string / `DATABASE_URL` NEVER appears; only a one-way `host_fp = sha256(host)[:12]` + non-secret facts |

## 4. Functional requirements

- **FR-1 — sanitized DB self-report at the cell membrane.** Each cell exposes its own data-store
  facts at its beacon/health surface: `{ engine: 'postgres', host_fp: sha256(host)[:12], reachable:
  bool, migrations_applied: int }`. NEVER the connection string, user, or password. Derived at
  request time from the cell's own live `DATABASE_URL` (the cell already holds it) — this is
  derive-don't-ask via the BeaconV3 membrane the cluster already has.
- **FR-2 — `loa doctor --data` aggregates the self-reports** into a data-store projection: one row
  per cell (engine, host_fp, reachable, ratified-label-if-any, status). Read-only; JSON (agent) +
  a terse table (human).
- **FR-3 — the registry gains a ratified `data_store` LABEL layer**, NOT the live state: `data_store:
  { host_fp, label, purpose }` per cell, authored by the operator (`host_fp abc123 = "shadow pg"`).
  The live state (reachable/migrations) is never written here — it is projected fresh by FR-2.
- **FR-4 — ratification = the /recall force-chain** (reuse collections-sot's `consumeCockpitGrant`):
  a label flips to `operator-validated` only via a fresh single-consume cockpit grant. The agent has
  no path to self-author a data-store label.
- **FR-5 — drift is loud.** When a cell's derived `host_fp` no longer matches its ratified label
  (the DB was re-pointed), `loa doctor --data` classifies it `contested`, preserves the operator
  label, and exits non-zero. A cell that stops being reachable → `unreachable`. Never a silent
  overwrite of operator truth.
- **FR-6 — fail-closed legibility for cells that don't self-report yet.** A cell without the FR-1
  endpoint is marked `unreported` — NEVER guessed or inferred. Legibility that lies is worse than a
  gap (the money/ops floor).
- **FR-7 — phasing.** In-monolith services we control land FR-1 first (`shadow-mode`, `shadow-audit`,
  `ordering`, `apps/worker`, `apps/freeside-operator-dash`); external `*-api` cells (separate repos)
  adopt the self-report incrementally and read `unreported` until they do.

## 5. Non-functional / constraints

- **NFR-1** — NO connection string, `DATABASE_URL`, credential, host, port, or db-name in the
  registry, beacon, logs, or `loa` output. `host_fp` is a one-way hash; reversal is not possible.
- **NFR-2** — no Railway (or any vendor) API dependency; no new privileged secret. The AWS/terraform
  half is covered by the same self-report path (a cell reports its own DB regardless of substrate).
- **NFR-3** — Postgres stays. This cycle explicitly does NOT migrate to PlanetScale/MySQL — the
  shadow-mode spine is Postgres-native (`pg_advisory_xact_lock` ×1, `advisory` ×5, `jsonb` ×26,
  `timestamptz` ×15). A dialect swap would rewrite the ledger's integrity model. Legibility ≠ migration.
- **NFR-4** — read/derive verbs need no credentials; only the operator's `ratify` needs a cockpit grant.

## 6. Scope

**In:** FR-1 self-report for the in-monolith services (FR-7 phase 1) · FR-2 `loa doctor --data`
aggregation + projection · FR-3 registry label layer + FR-4 ratify + FR-5 drift · FR-6 `unreported`
fail-closed.

**Out (deferred, with triggers):**
- External `*-api` cells' self-report (separate repos) — trigger: after the in-monolith surface proves
  the shape.
- Any DB consolidation / migration decision (Neon vs one-shared-pg vs status quo) — this cycle makes
  the topology LEGIBLE so that decision can be made on evidence; it does not make it.
- Health/latency SLOs per DB, connection-pool metrics — trigger: once legibility surfaces a real
  reliability question.
- AWS terraform changes.

## 7. Risks & dependencies

- **R-1 — host_fp collision / ambiguity.** A truncated hash could collide, or two cells legitimately
  share one DB (then one `host_fp` maps to multiple cells — that's a *feature*: it surfaces DB
  sharing). Mitigation: `host_fp` includes engine+host+db, and the doctor shows the fan-out.
- **R-2 — a cell that lies (reports a fingerprint it isn't actually using).** The self-report is
  trusted; a compromised cell could misreport. Mitigation: `reachable` is proven by an actual probe,
  not just claimed; the fingerprint is advisory. Full attestation is out of scope (documented ceiling).
- **R-3 — external-repo cells never adopt FR-1** → they stay `unreported` forever. Accepted: honest
  gap beats a guess; the trigger to push adoption is the operator seeing the `unreported` rows.
- **Dependency**: reuses collections-sot's `consumeCockpitGrant` (shipped, #430) for FR-4.

## 8. The convergence (why this is the same thing)

This is the third instance of one pattern: **runtime/ground is the SoT → the agent derives a
projection → the operator ratifies the durable labels → drift against ratified truth fails loud.**
Collections did it for contract facts; the member graph did it for identities; this does it for the
database topology. The registry becomes legible the same way the collection registry did — by
refusing to be a hand-authored cache. Reuse the shape (cockpit grant, fold-with-contested, fail-closed).

> Sources: this session's grounding (registry.yaml schema header; `pg`/Postgres-feature counts;
> no-Railway-API-integration check; freeside-cli read surface), operator steer "what happens if this
> goes stale? Ideally it's the SoT" (2026-07-03), [[project_labelling-on-worldline-spine]] (the
> architecture this reuses), [[project_deployed-but-unconsumed-pattern]], [[feedback_ground-deployed-state-before-asserting]].
