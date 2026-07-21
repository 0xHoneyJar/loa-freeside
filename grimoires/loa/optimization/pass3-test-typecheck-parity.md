# Pass 3 — Test-runner & typecheck optimization · PARITY REPORT

> **Pass 3 of 5** of the `extreme-software-optimization` skill loop. Levers:
> **O3.1** incremental typecheck (`tsc -b`/`incremental` + `.tsbuildinfo`) and
> **O3.2** vitest fixed-overhead tuning. Scope: **`packages/cli` only** (fully
> clean working tree; sietch was off-limits because its `package.json` /
> `vitest.workspace.ts` are pre-existing dirty). One lever family, config-only,
> zero source/test/behavior changes.
>
> Date: 2026-07-06 · Host: darwin arm64 · node v22.23.1 · TypeScript 5.9.3 · vitest (local)

---

## Files changed (all under `packages/cli/`, config-only)

| File | Change | Why |
|---|---|---|
| `packages/cli/tsconfig.typecheck.json` | **new** — extends `tsconfig.json`, adds `noEmit: true` + `incremental: true` + `tsBuildInfoFile: ./node_modules/.cache/tsc/cli-typecheck.tsbuildinfo` | O3.1 — a dedicated typecheck config so the incremental `.tsbuildinfo` cache is isolated from the `build` (emit) script's state. buildinfo lives under `node_modules/` (already gitignored — verified via `git check-ignore`), so **no `.gitignore` edit needed**. |
| `packages/cli/package.json` | `typecheck` script `tsc --noEmit` → `tsc -p tsconfig.typecheck.json` | O3.1 — route the typecheck through the incremental config. `build` script (`tsc`, emits to `dist`) is **untouched** → build path unaffected. |
| `packages/cli/vitest.config.ts` | add `test.isolate: false` (+ explanatory comment) | O3.2 — share the module registry across test files within a worker; eliminates per-file re-setup. |
| `grimoires/loa/optimization/pass3-test-typecheck-parity.md` | **new** — this report | — |

**Deliberately NOT changed:** `packages/cli/tsconfig.json` (base config, shared with `build` — left byte-identical so emit behavior is unchanged).

---

## O3.1 — Incremental typecheck

### Timings (`packages/cli`, 122 files)

| Command | Wall time | Notes |
|---|---|---|
| **Before:** `tsc --noEmit` | **1.24 – 1.54 s** (3 runs) | non-incremental; re-checks all files every run |
| **After (cold):** `npm run typecheck` (`tsc -p tsconfig.typecheck.json`), fresh cache | **1.35 – 1.45 s** | writes 272 KB `.tsbuildinfo`; parity with baseline (expected — cold = full check) |
| **After (warm):** same, `.tsbuildinfo` present | **0.77 – 1.01 s** | ~2× faster than cold; the recoverable local-dev cost |

Bare-`tsc` warm runs measured **0.65 – 0.67 s** (npm wrapper adds ~0.1–0.3 s). CI with no cache gets the cold cost (parity, no regression); repeated local typechecks get the warm 2× win.

### Isomorphism proof — diagnostics IDENTICAL

`tsc` diagnostics are the observable behavior. Verified the full sorted diagnostic
set is byte-identical between the canonical `tsc --noEmit` and the new
`tsc -p tsconfig.typecheck.json`:

```
$ diff <(tsc --noEmit | grep 'error TS' | sort) \
       <(npm run --silent typecheck | grep 'error TS' | sort)
→ IDENTICAL diagnostics (18 errors)
```

- 18 pre-existing errors (mix of TS6133 unused, TS2307 missing `@aws-sdk/*` optional
  deps, TS2339) preserved exactly on cold AND warm (all 4 runs reported `errors=18`).
- Independent 3-way check earlier (`tsc --noEmit` vs `extends+noEmit` vs
  `extends+noEmit+incremental`) — all three produced the **same 18 sorted
  diagnostics**, confirming `incremental` alone changes zero diagnostics.
- **Ordering / cache-key safety:** `.tsbuildinfo` invalidates on any input, tsconfig,
  or TS-version change (TypeScript's own file-hash + options-digest mechanism) — a
  genuinely changed file still gets re-checked and re-reports.

---

## O3.2 — Vitest fixed-overhead tuning (`isolate: false`)

### Levers tested (all preserved test results identically)

| Lever | Result | Verdict |
|---|---|---|
| `--poolOptions.threads.singleThread` | no measurable win (overhead is transform/collect, not worker count) | rejected |
| `--no-file-parallelism` | **slower** (549–746 ms vs 323–351 ms on ingestor) | rejected |
| **`isolate: false`** | **~14% faster on `packages/cli`**, results identical | **applied** |

### Timings (`packages/cli` vitest, 34 files / 690 tests)

Median of 6 warm runs each (high-variance machine — medians reported):

| Config | Median wall | Runs (s) |
|---|---|---|
| **Before** — isolate on (vitest default) | **1.965 s** | 2.07 1.91 2.08 1.84 1.94 1.99 |
| **After** — `isolate: false` | **1.69 s** | 1.41 1.39 1.89 2.16 1.49 2.04 |

~14% median improvement (min-run 1.39 s vs 1.84 s). Earlier sample showed a wider
gap (baseline 2.02–2.61 s → 1.44–1.97 s).

### Isomorphism proof — test results IDENTICAL

Ran the full suite before and after (via the config change AND via `--isolate`/`--no-isolate` CLI toggle):

```
Before (isolate on):   Test Files 7 failed | 27 passed (34)   Tests 664 passed | 26 skipped (690)
After  (isolate:false): Test Files 7 failed | 27 passed (34)   Tests 664 passed | 26 skipped (690)
```

Identical across 3 consecutive `npm test` runs. The 7 pre-existing failing files
(caused by absent optional `@aws-sdk/*` modules) fail identically; the 664 passing
and 26 skipped are unchanged. `isolate: false` shares module state across files
within a worker — proven safe for this suite's current tests (no cross-file global
mutation observed). Marked in-config with a `loa:shortcut` comment naming the
ceiling (re-enable if a future test depends on per-file module isolation).

---

## Checked but left alone

| Target | Why not touched |
|---|---|
| `themes/sietch` typecheck (8.05 s — the dominant cost) | `themes/sietch/package.json` + `vitest.workspace.ts` are **pre-existing dirty** (off-limits per pass constraints); enabling incremental there would need a package.json/script edit. Skipped to avoid corrupting the operator's uncommitted work. |
| `apps/ingestor` / `apps/worker` / `packages/sandbox` vitest | `singleThread`/`no-parallelism` gave no win on small suites; `sandbox` + `operator-dash` lack local `vitest`/`tsc` binaries (can't measure). `ingestor` `isolate:false` verified isomorphic but ~0 net win (4 files, overhead is transform-bound). Concentrated the proven lever on `packages/cli`. |
| `packages/cli/tsconfig.json` (base) | Shared with `build` (emit). Left byte-identical so build behavior is provably unchanged. |
| Lint (`.oxlintrc.json`, lint scripts) | Pass 2 territory — untouched. |
| `.claude/`, `.beads/`, `.run/`, `*.pyc`, any `pnpm-lock.yaml`, root `.gitignore` | Frozen / dirty — untouched. |

---

## Integrity note

- **No commit / add / stash** run — orchestrator commits.
- Only 4 files written, all under `packages/cli/` (3) + this report (1). No forbidden/dirty file touched.
- Zero source-code / test-body / behavior changes — config only.
- New `.tsbuildinfo` lives under gitignored `node_modules/` — no `.gitignore` change.
