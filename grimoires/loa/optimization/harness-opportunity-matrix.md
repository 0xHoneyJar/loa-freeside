# Harness Opportunity Matrix — loa-freeside dev+CI harness

> **Pass 1 of 5 · PROFILE / BASELINE pass.** Measurement + reporting ONLY — no
> tooling/config/source/workflow was modified. Produced by applying
> `extreme-software-optimization` Phases A (baseline), B (profile), E (opportunity
> matrix), scoped to the harness (typecheck, tests, lint, tsc builds, shell
> scripts, GitHub Actions).
>
> **The One Rule (carried into passes 2–5):** profile first, prove behavior
> unchanged, one lever per commit. Every row below carries an *Isomorphism risk*
> = the behavior that MUST stay byte-identical when the lever is pulled.
>
> Date: 2026-07-07 · Host: darwin arm64 · node v22.23.1 · pnpm 9.15.9 (repo pins pnpm@9.15.4)

---

## 0. Method & conventions

- **Measured** numbers were taken on this machine with `time` / `hyperfine`
  (warm caches, `node_modules` already installed). Each is tagged **(measured)**.
- **Estimated** numbers are static-analysis inferences (cold CI installs, network
  clones, aggregate CI time) that could not be cheaply reproduced here. Tagged
  **(estimated)** with the basis stated.
- **Scoring:** `Score = (Impact × Confidence) / Effort`.
  - **Impact 1–5** = expected reduction in *aggregate, frequency-weighted*
    harness time (5 = >50% faster on a hot, per-PR / per-install path; 1 = real
    but rarely-run / cold path).
  - **Confidence 1–5** (5 = profiler/repro-confirmed, 3 = static-likely, 1 = speculative).
  - **Effort 1–5** (5 = >1 day).
- **Cutline:** implement only Score ≥ 2.0.
- **Frozen paths (never touched in any pass):** `.claude/`, `.beads/`, `.run/`,
  `*.pyc`. `lib-tests.yml`'s node matrix is a real 3× cost but is gated to
  `.claude/**` → **excluded from actionable scope**.

---

## 1. Baseline

### 1a. Measured

| Target | Command | Size | Result | Notes |
|---|---|---|---|---|
| `packages/core` typecheck | `tsc --noEmit` | code in `domain/`+`ports/` (tiny) | **~0.4 s** (measured; 0.37 s bare, 0.60 s via `pnpm`) | non-composite |
| `packages/cli` typecheck | `tsc --noEmit` | 122 files / 41 286 LOC | **1.55 s** (measured) | non-composite |
| `themes/sietch` typecheck | `tsc -p tsconfig.production.json --noEmit` | 624 files / 182 704 LOC | **8.05 s ± 0.32 s** (measured, hyperfine 3 runs) | **dominant single typecheck**; `skipLibCheck:true` already set; NO `incremental`/`composite` |
| `packages/cli` tests | `vitest run` | 34 files / 690 tests | **2.51 s** wall (measured) | internal: transform 1.67 s, collect 5.77 s, prepare 2.95 s, **tests 2.80 s** → transform/collect/prepare overhead ≈ test-exec time |
| `packages/freeside-cli` tests | `tsx --test tests/*.test.ts` | 99 tests | **2.99 s** wall (measured; user 11.8 s) | high user-time = per-file tsx type-strip spawns |
| `packages/events` lint gate | `node bin/events-lint.mjs --root ..` | 210 findings scanned | **3.74 s** (measured) | CI gate (schema-emission-floor) |
| `scripts/rebuild-hounfour-dist.sh` (postinstall) | full run, macOS | clone+`npm ci`(53 pkgs, 845 ms)+tsc+pack | **5.43 s** (measured) | **always rebuilds on macOS** — see O4.1 |

### 1b. Unmeasurable / estimated

| Target | Why unmeasurable | Estimate & basis |
|---|---|---|
| `packages/shared/nats-schemas` `vitest run` | `vitest` binary not resolvable at package level → `sh: vitest: command not found` (no local install; no hoisted workspace) | ~1–2 s once resolvable (small schema pkg) — **estimated** |
| Cold CI `npm ci` (themes/sietch) | needs network + clean runner | 20–60 s cold vs a few s warm — **estimated** from the 845 ms warm sub-install of 53 pkgs in the rebuild script, scaled to sietch's dep count |
| Aggregate `ci.yml` wall time / PR | needs a live runner | dominated by 3 test jobs × (3 uncached `npm ci` each) + redis + postgres — **estimated** heavy |

### 1c. Harness inventory (counts, verified)

- **Main-tree `package.json`:** 24 (18 under `packages/`, 4 under `apps/`, `themes/sietch` + `themes/sietch/dashboard`).
- **Packages with a `tsc`-based `typecheck` script:** ~21. **All use non-incremental `tsc --noEmit` (or `tsc -p … --noEmit`); ZERO use build-mode incremental typecheck (`tsc -b`).** Even packages declaring `composite:true` (`beacon-schema`, `events`, `protocol/*`, `services/*`, `shared/nats-schemas`) only get incremental *builds* (`tsc -b`), never incremental *typechecks* — `--noEmit` ignores `.tsbuildinfo`.
- **Distinct test runners:** 4 — `vitest run`/`vitest` (majority), `tsx --test` (`beacon-schema`, `freeside-cli`, `freeside-registry`, `mcp-gateway`), `node --test` (`dune-meter`), and `vitest run --workspace` (`themes/sietch`).
- **Lint:** sparse — `eslint src --ext .ts` in `apps/ingestor`, `apps/worker`, `themes/sietch` (+ `dashboard`/`builder` vite apps); custom `events-lint` in `packages/events`; `.prettierrc` in `themes/sietch`. **No repo-wide fast linter. No oxlint/biome anywhere** (verified: grep for `oxlint|@biomejs` → NONE).
- **Workflows:** 38. **17 have no `paths:` filter** (notably `ci.yml`, the heavy one). Docker deploy/publish workflows (`deploy-production`, `deploy-staging`, `deploy-gp-worker`, `deploy-ingestor`, `build-base-image`, `container-security`) all use `cache-from/to: type=gha` and are **release/deploy → behavior MUST NOT change in later passes.**
- **Structural fact:** **no `pnpm-workspace.yaml`** at root. Each package installs independently (own `node_modules` + own lockfiles, `file:../` links). No hoisting, no `pnpm -r`, no shared install/build graph → install & typecheck duplication is structural.

---

## 2. Domain 2 — LINT hotspots

- **No repo-wide lint gate exists.** `ci.yml` runs zero eslint. Lint is not currently a CI *bottleneck* precisely because it barely runs — the win is (a) speed where eslint *does* run, (b) making a repo-wide gate cheap enough to add without a time penalty.
- **Largest eslint surface:** `themes/sietch` — `lint: eslint src --ext .ts` over **624 TS files** (`themes/sietch/package.json:19`), config `themes/sietch/.eslintrc.cjs`, formatter `themes/sietch/.prettierrc`. eslint over 624 files is multi-second; **oxlint (Rust) is typically 50–100× faster** → sub-second.
- **Other eslint:** `apps/ingestor/package.json:14`, `apps/worker/package.json:14` (`eslint src --ext .ts`), `themes/sietch/dashboard` (`eslint .`), `themes/sietch/src/ui/builder` (`eslint . --ext ts,tsx …`).
- **Custom lint:** `packages/events` `events-lint` (`packages/events/bin/events-lint.mjs`) — measured **3.74 s** for a root scan; it is a bespoke NATS-publish tripwire, **not** a general linter (do not replace with oxlint; orthogonal).
- **Rust-tooling lever for this domain:** introduce `oxlint` as the fast gate; keep `events-lint` as-is.

## 3. Domain 3 — TEST + TYPECHECK hotspots

- **Typecheck is non-incremental everywhere.** `themes/sietch` typecheck = **8.05 s (measured)** and re-checks all 624 files every invocation. `themes/sietch/tsconfig.production.json` has `skipLibCheck:true` (already) but **no `incremental` and no `composite`** → no `.tsbuildinfo` reuse. Same pattern across ~21 packages (all `tsc --noEmit`). This is the single largest recoverable typecheck cost. `tsc -b --noEmit` + a cached `.tsbuildinfo` would let unchanged files skip.
- **Vitest fixed overhead dominates small suites.** `packages/cli` run: transform 1.67 s + collect 5.77 s + prepare 2.95 s vs **tests 2.80 s** — i.e. esbuild transform + module collection + worker prepare ≈ the actual test time. Root config `vitest.agent-ci.config.ts` sets **no `pool`/`isolate`/`deps` tuning** (defaults: threads pool, isolation on). Levers: vitest's on-disk cache, `pool`/`isolate` tuning for pure-unit packages, `deps.optimizer`. (Isolation changes are behavior-sensitive — see risk.)
- **`tsx --test` / `node --test` transpile per file, per run.** `freeside-cli` = **2.99 s** wall / **11.8 s user** for 99 tests — the user/wall gap is tsx type-stripping each file with no shared transform cache. 4 distinct runners means 4 different cold-start cost profiles and no shared cache.
- **No workspace → typecheck/test can't be driven as one incremental graph** (structural, `pnpm-workspace.yaml` absent).

## 4. Domain 4 — SHELL / BASH hotspots (`scripts/`, `tools/`, `.github/scripts/`)

- **`scripts/rebuild-hounfour-dist.sh:72` and `:229`** use `grep -oP` (Perl regex, **GNU-only**). On macOS/BSD grep this errors (`grep: invalid option -- P`) → `DIST_VERSION=""` → the up-to-date short-circuit at `:91` never passes → **a full clone + `npm ci` + tsc + npm-pack rebuild runs on EVERY install** (reproduced: **5.43 s (measured)**, and `CONTRACT_VERSION` is logged as `unknown`). Runs via root `package.json` `postinstall` (`package.json:8`) → every dev install and every CI job that installs. **Largest per-install cost, cheapest fix.**
- **`scripts/extract-routes.sh:49–73`** — nested `while read line` loop spawning ~8 subprocesses **per route line** (`echo | cut` ×2 at `:51`/`:52`, `echo | grep` ×4–5 at `:55`–`:72`). Classic O(lines)×const-spawn. Skill-invoked (route mapping), **not** per-PR → low aggregate frequency.
- **`scripts/pin-citations.sh:68` + `:150–153`** — per-line `while read` plus per-entry `jq -r` + `date -d` (subprocess per citation). Skill/docs path, low frequency.
- **`scripts/check-redis-imports.sh:54`** (runs in `ci.yml` unit-tests, per-PR) uses `grep -nP … | grep -vP …` (GNU `-P`) in the report loop — fine on Linux CI, would break a macOS pre-run; minor.
- **`scripts/staging-smoke.sh` (991 L), `tools/advisor-benchmark.sh` (501 L), `scripts/validate-deployment.sh` (401 L), `scripts/staging-deploy-all.sh` (385 L)** are the *largest* scripts but are **deploy/ops (cold, manual)**, not per-PR — large ≠ hot. Their `seq`-loops with `curl`/`node sign-test-jwt.mjs` per iteration (e.g. `staging-smoke.sh:380,454,495,627,759`) are load-generation, intentional.
- **Already optimized (do not touch):** `tools/modelinv-rollup.sh:150–166` — a prior cycle (109/T5.3) already replaced a 2N-subprocess `awk+while+per-line-jq` pipeline with a single-pass `awk|jq` (measured 11 s → <200 ms per its own comment). Low residual.

## 5. Domain 5 — CI hotspots (`.github/workflows/`)

- **`ci.yml` — NO dependency caching.** The `unit-tests` (`ci.yml:199`), `integration-tests` (`:232`), and `worker-db-tests` (`:298`) jobs each run `npm ci` in `themes/sietch` **and** `packages/core` **and** `packages/adapters` (`:213–220`, `:257–264`) with `actions/setup-node@v6` and **no `cache:` key** → cold install every job, every run. Contrast: `pr-validation.yml:53` and `security.yml:45` already use `cache:'npm'`; `agent-ci.yml:55` caches the pnpm store. The pattern is proven elsewhere but absent from the heaviest workflow.
- **`ci.yml` — NO `paths:` filter** (`ci.yml:3–7`: `push`/`pull_request` on `main`, unconditional). The full sietch install + unit + integration(redis) + worker(postgres) suite runs on **every** PR to main, including docs/workflow-only PRs. 16 other workflows are already path-filtered (e.g. `agent-ci.yml:5`, `pr-validation.yml:20`).
- **`ci.yml` `validate` job — python-per-file JSON validation** (`ci.yml:29–32`): `for file in $(find … *.json …); do python3 -m json.tool "$file"; done` spawns a fresh Python interpreter per JSON file (O(files)). Also `:105`/`:109`/`:128` use `grep -oP` (GNU) in nested `while read` link-checks. Per-PR (no path filter).
- **Redundant `rebuild-hounfour-dist.sh` (postinstall) across CI jobs** — each job that installs re-runs the postinstall; on a cold runner (no cached dist) each does the clone+build. No `actions/cache` keyed on the pinned hounfour SHA for `node_modules/@0xhoneyjar/loa-hounfour/dist`.
- **Duplicated installs *within* `ci.yml`** — sietch+core+adapters `npm ci` is repeated verbatim in unit-tests and integration-tests (no shared install job / `needs:` artifact).
- **`ci.yml` `markdown-lint`/`yaml-lint`** (`:162` `npm install -g markdownlint-cli`, `:190` `pip install yamllint`) install tools uncached every run; minor.
- **DO-NOT-CHANGE (release/publish/deploy):** `deploy-production.yml`, `deploy-staging.yml`, `deploy-gp-worker.yml`, `deploy-ingestor.yml`, `build-base-image.yml`, `container-security.yml`, `agent-key-rotation.yml`. Later passes must preserve their behavior exactly.

---

## 6. Ranked Opportunity Matrix

`Score = (Impact × Confidence) / Effort`. Sorted by Score desc. **Cutline = 2.0.**

| # | Opportunity | Dom | Location (file:line / path) | Imp | Cf | Eff | Score | Isomorphism risk (must stay identical) |
|---|---|---|---|---|---|---|---|---|
| O4.1 | Fix `grep -oP` → portable (`grep -oE`/`sed`) so postinstall short-circuits instead of always rebuilding | 4 | `scripts/rebuild-hounfour-dist.sh:72,229` | 4 | 5 | 1 | **20.0** | Extracted `CONTRACT_VERSION` string & stale-detection verdict byte-identical; a genuinely stale dist must still trigger a real rebuild |
| O5.1 | Add pnpm/npm cache to `ci.yml` test jobs (`cache:'npm'` + `cache-dependency-path`) | 5 | `.github/workflows/ci.yml:208–220,252–264,298+` | 4 | 4 | 2 | **8.0** | Same resolved dep tree; cache key must include every lockfile so a lock change busts cache |
| O5.2 | Add `paths:` filter to `ci.yml` so the heavy suite skips non-code PRs | 5 | `.github/workflows/ci.yml:3–7` | 4 | 4 | 2 | **8.0** | Filter MUST still trigger on every path that feeds sietch/core/adapters/worker tests — under-filtering = false green |
| O2.2 | Migrate `themes/sietch` lint (624 files) eslint → oxlint | 2 | `themes/sietch/package.json:19` + `.eslintrc.cjs` | 3 | 4 | 2 | **6.0** | Rule coverage parity — the set of violations flagged must not silently shrink (map eslint rules → oxlint) |
| O3.1 | Incremental typecheck: `tsc -b --noEmit` + cached `.tsbuildinfo` (start with sietch, then composite pkgs) | 3 | `themes/sietch/tsconfig.production.json` + ~21 pkg configs | 4 | 3 | 3 | **4.0** | Diagnostics identical to a clean `tsc --noEmit`; buildinfo cache key must invalidate on any input/tsconfig/TS-version change |
| O5.3 | Replace python-per-file JSON validation with one batch pass (`jq`/single `python3`) | 5 | `.github/workflows/ci.yml:29–32` | 2 | 4 | 2 | **4.0** | Same pass/fail set: every invalid JSON still fails, same excludes (`node_modules`,`.git`,`.claude`) |
| O2.1 | Add a repo-wide oxlint gate (adopt in `apps/ingestor`,`apps/worker`, extend to packages) | 2 | `apps/ingestor/package.json:14`, `apps/worker/package.json:14` | 3 | 4 | 3 | **4.0** | New gate must not weaken existing eslint findings where they overlap |
| O5.4 | Cache rebuilt hounfour `dist` across CI jobs, keyed on pinned SHA | 5 | postinstall in every installing job (`package.json:8`) | 3 | 3 | 3 | **3.0** | Cached dist must match the pinned commit SHA exactly (`SOURCE_SHA`/`DIST_HASH` guards preserved) |
| O3.2 | Tune vitest fixed overhead (on-disk cache; `pool`/`isolate`/`deps` for pure-unit pkgs) | 3 | `vitest.agent-ci.config.ts` + per-pkg `vitest.config.ts` | 3 | 3 | 3 | **3.0** | `isolate:false` shares module state across files — only for pkgs with no cross-test global mutation; test outcomes identical |
| O5.5 | Dedupe installs in `ci.yml` (shared install job + `needs:`/artifact) | 5 | `ci.yml` unit-tests vs integration-tests | 3 | 3 | 4 | **2.25** | Each downstream job sees the same `node_modules`; no test relies on a fresh per-job install |
| O2.3 | Replace prettier `--check`/format with oxc formatter / dprint (Rust) | 2 | `themes/sietch/.prettierrc`, `package.json:21` | 2 | 3 | 3 | **2.0** | Formatting output identical enough that no file is reformatted (or accept a one-time reformat commit) |
| — | **── cutline (Score ≥ 2.0) ──** | | | | | | | |
| O4.2 | `extract-routes.sh` inner loop → single `awk`/`sed` parse (drop ~8 spawns/line) | 4 | `scripts/extract-routes.sh:49–73` | 1 | 4 | 2 | 2.0 | Same route list (method/path/auth) & ordering; cold path → tiny aggregate gain |
| O5.6 | Cache/skip global `markdownlint`/`yamllint` installs in `ci.yml` | 5 | `ci.yml:162,190` | 1 | 3 | 2 | 1.5 | Same lint verdicts (both currently `|| true`, non-blocking) |
| O4.3 | `pin-citations.sh` per-entry `jq`/`date` → single-pass | 4 | `scripts/pin-citations.sh:68,150–153` | 1 | 3 | 2 | 1.5 | Same citation set & staleness verdicts |
| O3.3 | Consolidate 4 test runners → vitest (shared transform cache) | 3 | `tsx --test`/`node --test` pkgs | 2 | 2 | 4 | 1.0 | Every existing test still runs with identical assertions; risk of runner-semantic drift (node:test → vitest) |

---

## 7. Top targets per downstream pass

- **Pass 2 (LINT / oxlint):** **O2.2** sietch eslint→oxlint (6.0) → **O2.1** repo-wide oxlint gate (4.0) → **O2.3** prettier→oxc formatter (2.0).
- **Pass 3 (TEST + TYPECHECK):** **O3.1** incremental typecheck / `tsc -b --noEmit` + buildinfo cache (4.0) → **O3.2** vitest overhead tuning (3.0) → **O3.3** runner consolidation (1.0, below cutline — deprioritize).
- **Pass 4 (SHELL / rust tooling):** **O4.1** `grep -oP` portability fix (20.0 — the single highest-leverage item in the whole matrix) → **O4.2** extract-routes loop (2.0) → **O4.3** pin-citations loop (1.5). Note `modelinv-rollup.sh` already optimized; deploy scripts are cold — do not spend pass-4 budget there.
- **Pass 5 (CI):** **O5.1** ci.yml caching (8.0) → **O5.2** ci.yml path filter (8.0) → **O5.3** JSON-validate batch (4.0) → **O5.4** hounfour dist cache (3.0). Preserve deploy/publish workflow behavior exactly.

---

## 8. Pass-1 integrity note

- **No behavior changed.** This pass created only this artifact + its parent
  directory. `git status --short -- grimoires/loa/optimization/` showed the target
  clean before write; no tooling/source/workflow/config file was edited.
- **Frozen paths untouched.** No writes to `.claude/`, `.beads/`, `.run/`, or any
  `*.pyc`. (Pre-existing untracked/dirty entries in those trees are inherited
  repo noise, not from this pass.) No `git add`/`commit`/`br sync` was run.
- Measurement side-effects were confined to untracked `node_modules` (the
  hounfour dist rebuilt by running the postinstall to reproduce O4.1); no tracked
  file was modified by any measurement command.

---

## 9. Pass 2 — oxlint (LINT lever) · IMPLEMENTED

Rows **O2.2** (sietch eslint→oxlint) and **O2.1** (repo-wide oxlint gate) landed.
Full parity proof + eslint→oxlint coverage map: **`pass2-oxlint-parity.md`**.

- **Tool:** oxlint 1.73.0, pinned root devDependency; single Rust binary, no per-package install.
- **Speed:** `themes/sietch/src` **17.79 s (eslint) → 0.093 s (oxlint)** = **≈190×**; whole-repo gate `oxlint` = **0.74 s / 1844 files** (first-ever repo-wide lint).
- **Isomorphism:** oxlint fast gate covers every non-type-aware eslint rule (486 warns). The 15 type-aware `@typescript-eslint` rules (1092 warns, 8 with no oxlint equivalent) are **retained, not dropped** — enforced by `themes/sietch` `lint:types = eslint src --ext .ts` (reproduces the identical 1578-warning baseline). Blocking rules (`prefer-const`/`no-var`/`no-restricted-imports`, incl. the SDD §2.2 hounfour allowlist) covered natively with 0 false positives.
- **Scripts:** root `lint: oxlint`; `themes/sietch`/`apps/ingestor`/`apps/worker` `lint: ../../node_modules/.bin/oxlint src` (no workspace → root binary by relative path). `apps/*` prior eslint scripts were non-functional (eslint uninstalled) — pure improvement.
- **Untouched (per scope):** `packages/events` events-lint, all `.github/workflows/*.yml`, `.claude/`/`.beads/`/`.run/`/`*.pyc`. Source not auto-fixed. Root lockfile updated (expected).
