# Sprint Plan — Cluster Secret-Parity Canary

**Status**: `candidate` — planning spec, not yet an active sprint. Promote via `/sprint-plan` (write to `sprint.md` + ledger) once the active dune-meter sprint completes and the prerequisites below are met.
**Source finding**: `packages/freeside-registry/registry.yaml` header (cluster auth model) + `grimoires/loa/drift-report.md` (Ghost G1 / gap).
**Domain**: platform / cluster immune-system (CI + a probe script). Cross-cell (identity-api ↔ activities-api).
**Author**: /ride follow-up → /implement("plan it first"), 2026-07-06.

---

## Sprint Goal

Detect **runtime drift** between `identity-api`'s `JWT_SECRET` and `activities-api`'s `IDENTITY_API_JWT_SECRET` **before** it silently 401s every cluster consumer — via a scheduled functional mint→verify canary that alarms on mismatch.

## The problem (grounded)

> From `registry.yaml` (cluster auth model, header comment): *"activities-api ← HS256 Bearer minted by identity-api, verified OFFLINE by recomputing HMAC with `IDENTITY_API_JWT_SECRET` — which MUST byte-equal identity's `JWT_SECRET` … Secret drift → every activities request 401s `bad_signature`, silently, cluster-wide. Worth a CI canary (identity mints → activities verifies → alarm on mismatch)."*

The failure is a **value** drift of two secrets that live in **separate deployment envs** (Railway, external cells). No structural/declaration check catches it — only a functional round-trip does. `cluster-compliance.yml` audits cell *structure* (CLAUDE.md/NOTES/BeaconV3 per ADR-009 D-13), not runtime auth; this canary is its runtime complement.

---

## Design decisions (settled here; open sub-decision flagged)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D-1 | **Home** | loa-freeside `.github/workflows/` (new nightly workflow) | loa-freeside is the cluster parent — it hosts `registry.yaml` + `cluster-compliance.yml` (the immune system). Cross-cell parity is a *cluster* concern, not either cell's. Mirrors the established D-13 CI pattern. |
| D-2 | **Probe shape** | Live functional **mint→verify** round-trip | Only a round-trip catches secret *value* drift (the actual failure). A static "registry declares HS256" lint catches nothing. |
| D-3 | **Not registry `expectations[]`** | Keep as a dedicated workflow (for now) | Registry `probe_kind` is `http \| graphql-lag \| event-max-age`; mint→verify fits none. A future `probe_kind: auth-parity` in `freeside-registry/src/registry.ts` could later fold it into `freeside-cli doctor`. |
| D-4 | **Cadence + alarm** | Nightly cron + `workflow_dispatch`; open a tracking issue on failure | Matches `cluster-compliance.yml` (nightly, `issues: write`, open-issue-on-drift). |
| **D-5** | **How the canary obtains a mint** | **OPEN — needs identity-api auth-surface confirmation** | identity-api is an external cell; its exact mint path for a non-interactive principal is unverified from this repo. Options: (a) a long-lived `CANARY_PRINCIPAL_TOKEN` the workflow presents to identity to mint a short HS256 token; (b) a dedicated service/canary mint endpoint. **Resolve before T-1** by inspecting `github.com/0xHoneyJar/identity-api`. |

---

## Prerequisites (operator / ops — BLOCKING for implementation)

- [ ] **PRE-1** Confirm identity-api's non-interactive mint path (resolves D-5).
- [ ] **PRE-2** Confirm a stable **auth-gated** activities-api endpoint the canary can hit (e.g., an authenticated read/health that returns 200 with a valid token, 401 `bad_signature` with a stale-secret token).
- [ ] **PRE-3** Provision a **canary principal** in identity-api (least-privilege; read-only on activities).
- [ ] **PRE-4** Register CI secrets/vars in loa-freeside: `IDENTITY_API_URL`, `ACTIVITIES_API_URL`, `CANARY_PRINCIPAL_CREDENTIAL` (shape per D-5), optional `ACTIVITIES_CANARY_PATH`.

> Until PRE-1..PRE-4 exist, the workflow cannot be E2E-verified. Implementation may build + unit-test the probe (mocked), but the live green run is gated on these.

---

## Tasks

### T-1 — Probe script (mint→verify)
**Files**: `scripts/canaries/secret-parity-probe.mjs` (Node, no new deps — use built-in `fetch`), `scripts/canaries/README.md`
**Change**:
- Read `IDENTITY_API_URL`, `ACTIVITIES_API_URL`, `CANARY_PRINCIPAL_CREDENTIAL`, `ACTIVITIES_CANARY_PATH` from env.
- Step 1: obtain an HS256 token from identity-api (per resolved D-5).
- Step 2: call the activities-api auth-gated endpoint with that token.
- Classify: `200/expected` → `parity_ok`; `401 bad_signature` → `secret_drift`; network/5xx → `unreachable`.
- Emit single-line JSON (`{status, identity_url, activities_url, http_code, latency_ms, probed_at}`) to stdout.
- Exit codes: `0` parity_ok · `2` unreachable · `3` secret_drift (alarm) · `1` config/usage error. (Mirrors `freeside-cli` exit-code convention.)
**Acceptance Criteria**:
- [ ] AC-1.1 With env unset → exit 1, actionable message (no network call).
- [ ] AC-1.2 Mocked identity-mint + activities-200 → exit 0, `status:"parity_ok"`.
- [ ] AC-1.3 Mocked activities-401-`bad_signature` → exit 3, `status:"secret_drift"`.
- [ ] AC-1.4 Mocked network error → exit 2, `status:"unreachable"`.
- [ ] AC-1.5 No secret VALUES ever printed/logged (only URLs + http_code).
**Test Requirements**: unit tests (Vitest) with a mocked `fetch` covering AC-1.2/1.3/1.4 branches + the no-secret-leak assertion. NO live network in tests.
**Dependencies**: D-5 resolved (PRE-1).

### T-2 — GitHub Actions workflow
**Files**: `.github/workflows/cluster-secret-parity-canary.yml`
**Change**:
- Triggers: `schedule` nightly cron (offset from cluster-compliance's 12:00 — e.g. `30 6 * * *`) + `workflow_dispatch` (input `open_issue_on_failure`).
- `permissions: { contents: read, issues: write }`.
- Steps: checkout → setup-node → run probe with CI secrets → on non-zero (drift/unreachable), open/update a tracking issue titled `Cluster secret-parity drift: activities-api ↔ identity-api` with the probe JSON + runbook link.
- Timeout ≤10 min; concurrency guard to avoid duplicate issues.
**Acceptance Criteria**:
- [ ] AC-2.1 `workflow_dispatch` runs the probe and surfaces its JSON in the job summary.
- [ ] AC-2.2 On exit 3, a tracking issue is opened (or updated, not duplicated) with `probed_at` + remediation link.
- [ ] AC-2.3 On exit 0, no issue; job green.
- [ ] AC-2.4 Secrets are referenced via `${{ secrets.* }}` only; none echoed.
**Test Requirements**: one live `workflow_dispatch` smoke-run after PRE-4 (operator) — the E2E gate. Static: `actionlint` clean.
**Dependencies**: T-1; PRE-2/PRE-3/PRE-4.

### T-3 — Runbook + registry cross-reference
**Files**: `grimoires/loa/runbooks/cluster-secret-parity.md`, `packages/freeside-registry/registry.yaml` (comment: point the "Worth a CI canary" note at the workflow), `grimoires/loa/NOTES.md`
**Change**:
- Runbook: what the alarm means, remediation (re-sync `IDENTITY_API_JWT_SECRET` to identity's current `JWT_SECRET`; redeploy activities-api; re-run `workflow_dispatch` to confirm green), required CI secrets list, escalation.
- Update registry comment from "Worth a CI canary" → "Canary: `.github/workflows/cluster-secret-parity-canary.yml`".
**Acceptance Criteria**:
- [ ] AC-3.1 Runbook has a copy-pasteable remediation sequence.
- [ ] AC-3.2 Required CI secrets enumerated with shape.
- [ ] AC-3.3 registry.yaml comment references the live workflow path.
**Dependencies**: T-2.

---

## Dependencies (external)
identity-api + activities-api deployed endpoints + a canary principal (external cell repos + Railway). This sprint delivers the loa-freeside-side canary; the cells must expose the surfaces in PRE-1/PRE-2.

## Risks & Mitigation
| Risk | Mitigation |
|---|---|
| Canary credential leak → cluster access | Least-privilege read-only principal; secret in GH Actions secrets only; never logged (AC-1.5/AC-2.4). |
| False alarm on cell downtime (not secret drift) | Distinct `unreachable` (exit 2) vs `secret_drift` (exit 3); only exit 3 implies rotation. |
| Duplicate nightly issues | Concurrency guard + update-existing-issue (AC-2.2). |
| D-5 unresolved → probe can't mint | PRE-1 gates T-1; do not start T-1 until identity-api mint path confirmed. |

## Success Metrics
- Secret drift detected within ≤24h (one nightly cycle) instead of via user-reported cluster-wide 401s.
- Zero secret values in logs/issues (grep audit clean).
- One green `workflow_dispatch` smoke-run recorded before the sprint is marked complete.

## Activation (how this becomes a live sprint)
1. Resolve D-5 (inspect identity-api) + complete PRE-1..PRE-4.
2. `/sprint-plan` promotes this to `grimoires/loa/sprint.md` + a ledger entry (new global sprint id; `next_sprint_number` currently 411).
3. `/implement sprint-N` (this repo's beads-first flow files T-1..T-3 as beads tasks).
4. `/review-sprint` + `/audit-sprint` gates, then the operator smoke-run (AC-2.1/AC-2.2).
