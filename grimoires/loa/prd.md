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

## 7.5 Flatline integration (7 blocker-theme resolutions)

The flatline caught three places I over-copied collections-sot without accounting for the differences
(the registry is git, not a live ledger; `loa` runs on the operator's laptop; a host is not a credential).

- **`host_fp` is a SALTED CORRELATION id, not a secrecy measure (SKP-001, SKP-004, IMP-001/002).**
  Reframe: the thing that must never leak is the **credential** (user, password, full `DATABASE_URL`)
  — a database *host* is not a credential. `host_fp` exists to answer "do two cells share a DB?", so
  it must be stable + collision-resistant, and salted so a public viewer can't casually correlate or
  brute-force a low-entropy internal name. **Exact definition:** `host_fp =
  HMAC_SHA256(CLUSTER_FP_SALT, lower("${engine}://${host}:${port}/${db}"))[:16]` — credentials are
  NOT in the preimage; `CLUSTER_FP_SALT` is a single non-secret-rotating cluster constant (shared so
  fps are comparable across cells). The preimage is normalized (lowercase, default ports elided). This
  supersedes R-1's loose "includes engine+host+db" wording. (NFR-1 restated: forbid the *credential*
  and the *connection string*; the salted host_fp is permitted.)

- **The self-report is on an AUTHENTICATED surface, not the public beacon (SKP-002 ×2, IMP-003).**
  FR-1 restated: each cell exposes `GET /admin/data-store` (or an auth-gated block on its existing
  admin/health route) behind **the cell's existing auth** (the per-cell credential the registry header
  already documents — activities HS256, score static key, etc.). Contract: JSON
  `{ schema_version, engine, host_fp, reachable, migrations_applied|null }`, 5s timeout, additive
  versioning. NOT on the public `beacon.json` (engine + reachability + migration-count is topology).

- **`loa doctor --data` reaches cells the SAME way `freeside-cli doctor` already does (SKP-001-CRIT,
  IMP-004).** It probes each cell's public `deployment_url` + the operator's EXISTING per-cell
  credential (no Railway API, no new secret — G-3 holds; it reuses cluster auth `loa` already carries).
  The cell self-reports its OWN `reachable` (it can see its DB); `loa` records reachability *of the
  cell's report*. A cell `loa` can't reach from the operator's context → `unreachable` (honest, never
  guessed).

- **Ratified labels live in git; the gate is the operator's COMMIT, not a runtime cockpit grant
  (SKP-003).** FR-4 restated: the `data_store` label layer lives in `registry.yaml` (git = the
  operator-signed SoT). The agent PROPOSES a label diff (a candidate PR/edit); the operator RATIFIES
  by committing/merging it. This is the same agent-proposes/operator-ratifies shape as collections, but
  the mechanism is git ownership (+ a CODEOWNERS-gated `data_store:` path), NOT `consumeCockpitGrant`
  (which gates a live ledger write and does not compose with a shared git file). Drop the cockpit-grant
  reuse.

- **Status precedence (IMP-005), deterministic:** `contested` (derived host_fp ≠ ratified label) >
  `unreachable` (cell down / not reachable from operator) > `unreported` (no FR-1 endpoint yet) >
  `coherent`. `loa doctor --data` exits non-zero on any `contested`.

- **`migrations_applied` is nullable (IMP-008)** — a cell whose framework can't cheaply report a
  migration count returns `null`; it is never fabricated and does not fail the doctor.

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
