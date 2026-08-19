# Shared CI Baseline Failure Classification

Inventory of the recurring red gates on this repository, classified per gate
with the first actionable error, the evidence separating baseline from
patch-caused, and current status.

**Method.** A gate is "baseline" only when it is shown red on `main` — ideally
at PR #428's own base commit `8e61643` — or has never been green. Anything not
reproduced is listed as unverified, not hand-waved. No audit threshold,
scanner allowlist, or security policy was weakened to clear any of these.

## Inventory

| Gate (workflow / job) | First actionable error | Classification | Status |
|-----------------------|------------------------|----------------|--------|
| PR Validation / **Security Scan** | 3 actionable high advisories in `themes/sietch`: `@opentelemetry/propagator-jaeger` (GHSA-45rx-2jwx-cxfr), `@opentelemetry/sdk-trace-node`, `sharp <0.35.0` (GHSA-f88m-g3jw-g9cj) | Ours — the gate audits `themes/sietch`, which this PR modifies | **Fixed**: 3 → **0** actionable. Both otel packages reported `fixAvailable:true` and are pinned forward via `overrides`; `sharp` → `^0.35.3`. Fixed at the source, *not* allowlisted. Same audit against `origin/main`'s lockfile reports **16**, so the branch was already the improvement and is now clean |
| Security Audit / **NPM Security Audit** | `npm audit --audit-level=high` over every `apps/*/` and `packages/*/`, no allowlist, devDeps included | **Baseline** | Red on `main` at PR #428's exact base SHA `8e61643` — run [29787544476](https://github.com/0xHoneyJar/loa-freeside/actions/runs/29787544476), job `NPM Security Audit` = failure, step "Audit monorepo packages". Untouched by this PR's diff. Concrete fix: a dedicated remediation pass across the ~20 workspace packages; several are non-breaking (e.g. `apps/worker` postcss GHSA-r28c-9q8g-f849 is an `npm audit fix`). Out of scope here — it is a dependency-hygiene change with its own blast radius, not a payment-correctness one |
| Security / **Dependency Audit (worker, apps/worker)** | 3 high advisories in `apps/worker` (postcss GHSA-r28c-9q8g-f849 and 2 others) | **Baseline** | Same class and same root cause as the row above; `apps/worker/**` is not in this PR's diff. Reproduced locally: `cd apps/worker && npm install --package-lock-only && npm audit --audit-level=high` → 3 high |
| Agent Subsystem CI (`agent-ci`) | `tests/integration/agent-gateway.test.ts:580` — `expected undefined to be an instance of AgentGatewayError` (`STREAM_INTERRUPTED` never surfaced) | **Baseline** | Every recent `agent-ci` run on `main` is a failure (e.g. runs `29623252182`, `29621190902`, `29618999942`, `29616742471`). The test file is **not** in this PR's diff. The earlier `better-sqlite3` bindings gap *was* patch-adjacent and **is fixed** on this branch (targeted `npm rebuild better-sqlite3` after the `--ignore-scripts` install, keeping the ignore-scripts posture for everything else); the remaining failure is the pre-existing stream assertion |
| Billing E2E (`billing-e2e`) | `unable to prepare context: path ".../tests/e2e/.loa-finn-checkout" not found` → `[run-e2e] ERROR: Docker compose up failed` (exit 2) | **Baseline — has never been green** | 30/30 recorded runs failed, oldest 2026-02-27, including 3 on `main`. Two distinct defects: (a) the workflow invokes `tests/e2e/run-e2e.sh`, which only *starts* the stack — `scripts/run-e2e.sh` is the one that clones `loa-finn`; (b) `tests/e2e/run-e2e.sh` never exported `LOA_FINN_DIR`, so compose resolved its relative default against the compose file's own directory. **(b) is fixed** on this branch, and the script now fails with an explicit diagnosis instead of an opaque docker error. **(a) cannot be fixed from inside this repo**: it needs `LOA_FINN_SHA` pinned and CI read access to the private `0xHoneyJar/loa-finn` repo. Operator action required |
| BUTTERFREEZONE Validation (Advisory) | `WARN: Stale: head_sha mismatch` → validator exits 2 on warnings | **Structural on every PR** | The validator compares the generated `head_sha` against `git rev-parse HEAD`, which in a PR checkout is the synthetic merge-ref commit; it can never match a pre-generated SHA. No action: the job is `continue-on-error: true` and explicitly named Advisory (`docs-validation.yml`). The red check-run mark is expected on every PR |
| **PR Summary** | `One or more quality gates failed` (exit 1) | Aggregate, not independent | Reads the other pr-validation jobs' results. Its only failing input was Security Scan, so it follows that gate green |
| CI / Unit Tests (`themes/sietch npm test`) | — | Baseline-suspect on old heads | **Passes on this branch**: 197 files, 5520 passed / 5 skipped under Node 22 (2026-07-27, re-verified after the `sharp` major bump). Old-head failures (runs `28298505837`, `28299996815` referenced in #375) do not reproduce; treat any recurrence as patch-caused until shown otherwise |
| CI / Integration Tests | behavioral-drift cluster: `story-fragments`, `tier`, `digest`, `stats`, `billing-event-stream`, `cross-system-conservation`, plus `ChainService` env bootstrapping (`rpcUrls` undefined) | Baseline (tests drifted from current service behavior) | Fixed incrementally on this branch; **green** on the latest PR run |
| Documentation Validation | `BUTTERFREEZONE.md` crosslinks failing link validation | Baseline (docs drift) | **Fixed** on this branch: `fix(shared/docs): repair BUTTERFREEZONE.md crosslinks` |

## Rules preserved

- No audit thresholds, scanner allowlists, or security policies weakened. Where
  an advisory had a fix, it was applied; the known-unfixable allowlist was not
  extended to cover anything `npm audit` reported as fixable.
- Baseline failures are fixed at the dependency/docs/script source, not
  suppressed.
- Anything not reproduced locally or shown red on `main` is listed as
  unverified, not hand-waved.
