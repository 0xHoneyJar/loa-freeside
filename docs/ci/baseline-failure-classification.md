# Shared CI Baseline Failure Classification

Inventory of the recurring red gates that blocked narrow PRs (#375, #386),
classified per gate with first actionable error and current status. Scope:
shared/docs — no workflow thresholds changed.

## Inventory

| Gate (workflow / job) | First actionable error | Classification | Status |
|-----------------------|------------------------|----------------|--------|
| Documentation Validation | `BUTTERFREEZONE.md` crosslinks failing link validation | Baseline (docs drift), not patch-caused | **Fixed** on `claude/eileen1337-loa-issues-prs-9vl9hs` (PR #428): `fix(shared/docs): repair BUTTERFREEZONE.md crosslinks` |
| Security Audit / NPM Security Audit | `brace-expansion` advisory GHSA-f886-m6hf-6m8v in `apps/ingestor` | Baseline (transitive advisory), not patch-caused | **Fixed** on the same branch: `fix(platform/ingestor): bump brace-expansion` |
| CI / Unit Tests (`themes/sietch npm test`) | — | Baseline-suspect on old heads | **Passes on this branch**: 197 files, 5,506 passed / 5 skipped locally under Node 22 (2026-07-04). Old-head failures (runs `28298505837`, `28299996815` referenced in #375) do not reproduce; treat any recurrence as patch-caused until shown otherwise |
| CI / Integration Tests (`npm run test:integration`, Redis service) | not reproduced locally (needs Redis service container) | Unverified locally | Re-classify from the next CI run on a PR whose paths trigger the CI workflow; unit-suite health above makes a baseline code failure unlikely |
| Agent Subsystem CI | not reproduced locally | Unverified locally | Same re-classification path |

## Method

Per #375's plan: failures were classified against the branch that carries
the two baseline fixes rather than the historical heads (PR #372/#373/#374
are closed or superseded; PR #366 — the object of #386 — is closed as
superseded by PR #428). PR #428's triggered checks (Secret Scanning,
Dependency Scan, Socket) are all green; the heavier CI/Security Audit
workflows are path-filtered away from its diff, so their next verdict comes
from the next PR that touches `themes/sietch`/`packages/{core,adapters}`.

## Rules preserved

- No audit thresholds, scanner allowlists, or security policies weakened.
- Baseline failures fixed at the dependency/docs source, not suppressed.
- Anything not reproduced locally is listed as unverified, not hand-waved.
