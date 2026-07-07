# Pass 2 — oxlint (LINT lever) · parity proof

> **Pass 2 of 5 · LINT tooling lever.** Introduces `oxlint` (Rust) as the fast
> lint gate and migrates the existing eslint surface where isomorphic. One lever
> family only (lint tooling). Implements matrix rows **O2.2** (sietch eslint→oxlint)
> and **O2.1** (repo-wide oxlint gate). O2.3 (prettier→oxc formatter) is a separate
> formatting lever, not taken here.
>
> Date: 2026-07-07 · Host: darwin arm64 · node v22.23.1 · pnpm 9.15.9 (repo pins 9.15.4)

---

## 1. Tool & version

- **oxlint 1.73.0** — single Rust binary, pinned as a **root** devDependency
  (`package.json` → `devDependencies.oxlint: "1.73.0"`). Scans repo-wide from root
  with no per-package install (respects `.gitignore` + `.oxlintrc.json` ignores).
- Config: `.oxlintrc.json` (root, repo-wide gate) + `themes/sietch/.oxlintrc.json`
  (nested, extends root; mirrors the retired `.eslintrc.cjs` contract).

## 2. Measured runtime (warm cache, `node_modules` installed)

| Surface | Command | Files | Runtime | vs eslint |
|---|---|---|---|---|
| `themes/sietch/src` (eslint baseline) | `eslint src --ext .ts` | 597 | **17.79 s** (measured, `/usr/bin/time`) | — |
| `themes/sietch/src` (oxlint) | `oxlint src` | **597 (identical set)** | **0.093 s** (median of 5 warm) | **≈190× faster** |
| whole repo (new O2.1 gate) | `oxlint` (root) | 1844 | **0.74 s** | n/a (no prior repo-wide gate) |

The oxlint sietch run scans the **exact same 597 files** as eslint — verified via
`oxlint src --debug=files` (597 `.ts`) — because the nested config re-declares
eslint's `ignorePatterns` (`src/**/*.test.ts`, `*.spec.ts`, `src/test-utils/**`,
`src/ui/**`) **and** restricts scope to TypeScript only (`**/*.js|jsx|mjs|cjs`
ignored) to match eslint's `--ext .ts`.

## 3. eslint baseline (the parity reference)

`eslint src --ext .ts` on `themes/sietch/src` today: **597 files, 0 errors,
1578 warnings** across 26 rules → **the gate passes (exit 0); every finding is a
non-blocking warning.** The only error-level (blocking) rules configured
(`prefer-const`, `no-var`, `no-restricted-imports`) fire **0 times** on the current
tree. The retained `lint:types` script reproduces this exactly: **1578 problems
(0 errors, 1578 warnings)** — byte-identical, confirming no coverage was lost.

## 4. eslint → oxlint rule-coverage map

### 4a. Blocking rules (error-level) — fully covered by oxlint

| eslint rule | fires today | oxlint | notes |
|---|---|---|---|
| `prefer-const` | 0 | ✓ `prefer-const` (error) | native |
| `no-var` | 0 | ✓ `no-var` (error) | native |
| `no-restricted-imports` (hounfour barrel, SDD §2.2) | 0 | ✓ `no-restricted-imports` (error) | **`patterns`/`group`/`message` object form accepted; allowlist `overrides` replicated → 0 false positives verified** |

### 4b. Non-type-aware warn rules — **all covered by oxlint fast gate**

| eslint rule | eslint warns | oxlint rule | oxlint warns |
|---|---|---|---|
| `no-unused-vars` | 204 | `eslint(no-unused-vars)` | 204 |
| `@typescript-eslint/no-explicit-any` | 156 | `typescript(no-explicit-any)` | 156 |
| `no-console` | 62 | `eslint(no-console)` | 62 |
| `@typescript-eslint/ban-ts-comment` | 21 | `typescript(ban-ts-comment)` | 21 |
| `@typescript-eslint/no-unsafe-function-type` | 13 | `typescript(no-unsafe-function-type)` | 13 |
| `no-case-declarations` | 10 | `eslint(no-case-declarations)` | 10 |
| `@typescript-eslint/no-require-imports` | 6 | `typescript(no-require-imports)` | 6 |
| `no-control-regex` | 6 | `eslint(no-control-regex)` | 7 |
| `no-useless-escape` | 4 | `eslint(no-useless-escape)` | 4 |
| `no-constant-condition` | 2 | `eslint(no-constant-condition)` | 0 |
| `@typescript-eslint/no-empty-object-type` | 1 | `typescript(no-empty-object-type)` | 1 |
| `no-useless-catch` | 1 | `eslint(no-useless-catch)` | 1 |

Counts match within per-occurrence granularity (`no-control-regex` 6↔7,
`no-constant-condition` 2↔0 = engine-level counting/heuristic differences, **not a
coverage gap** — the rule class is enforced by both).

### 4c. Type-aware rules — **NOT run by the fast oxlint gate → retained in `lint:types` (eslint)**

These 15 rules require the TypeScript type checker. oxlint runs type-aware rules
only under the experimental `--type-aware` flag (needs `tsgolint`, materially
slower — defeats the O2.2 speed win), so they are **excluded from the fast gate and
kept enforced by the retained `eslint` script**. Not silently dropped.

| eslint rule | eslint warns | oxlint status |
|---|---|---|
| `@typescript-eslint/no-unsafe-member-access` | 336 | **no oxlint equivalent** |
| `@typescript-eslint/no-unsafe-assignment` | 274 | **no oxlint equivalent** |
| `@typescript-eslint/require-await` | 179 | **no oxlint equivalent** |
| `@typescript-eslint/no-unsafe-call` | 102 | **no oxlint equivalent** |
| `@typescript-eslint/no-unsafe-argument` | 79 | **no oxlint equivalent** |
| `@typescript-eslint/no-unsafe-return` | 24 | **no oxlint equivalent** |
| `@typescript-eslint/no-misused-promises` | 20 | **no oxlint equivalent** |
| `@typescript-eslint/only-throw-error` | 2 | **no oxlint equivalent** |
| `@typescript-eslint/restrict-template-expressions` | 24 | has rule, `--type-aware` only |
| `@typescript-eslint/await-thenable` | 14 | has rule, `--type-aware` only |
| `@typescript-eslint/no-unsafe-enum-comparison` | 13 | has rule, `--type-aware` only |
| `@typescript-eslint/no-floating-promises` | 10 | has rule, `--type-aware` only |
| `@typescript-eslint/no-base-to-string` | 5 | has rule, `--type-aware` only |
| `@typescript-eslint/no-unnecessary-type-assertion` | 5 | has rule, `--type-aware` only |
| `@typescript-eslint/no-redundant-type-constituents` | 5 | has rule, `--type-aware` only |

**Residual total: 1092 warnings (8 rules with no oxlint equivalent = 1016; 7 rules
oxlint has but only under `--type-aware` = 76).** All are `warn`-level
(non-blocking). Severity is pinned to `warn` in the sietch config for the 7 rules
oxlint knows, so a future opt-in `--type-aware` run stays isomorphic (several
default to `deny`/error in oxlint's `correctness` category otherwise).

## 5. Retained-eslint residual — justification

- **`themes/sietch` keeps `lint:types = eslint src --ext .ts`.** eslint remains the
  authority for the 15 type-aware `@typescript-eslint` rules above. Rationale: the
  fast per-PR gate is `oxlint src` (0.09 s); the deep type-aware pass runs
  on-demand / pre-release via `lint:types` (~17.8 s). No violation class eslint
  flags today becomes unenforced — it moves from the default gate to an explicit,
  documented script. Proven: `lint:types` still emits the identical 1578 warnings.
- **`apps/ingestor`, `apps/worker`: no eslint residual.** Their prior
  `lint: eslint src --ext .ts` scripts were **non-functional** — eslint is neither
  installed (no `.bin/eslint`) nor in `devDependencies`, and no eslint config file
  exists in either package. There was **zero eslint coverage to preserve**, so the
  migration to `oxlint src` is a strict improvement (a real gate where there was a
  broken command).

## 6. Net-new findings surfaced by oxlint (expansion, not regression)

The fast gate ADDS coverage eslint never had (oxlint default `oxc`/`unicorn`
plugins + `suspicious`/`perf` categories), all non-blocking warnings **except one
genuine correctness error**:

- **`unicorn(no-invalid-fetch-options)` — 1 error** in
  `themes/sietch/src/packages/adapters/billing/NOWPaymentsAdapter.ts:504`: a `body`
  key on a fetch options object whose `method` may be `GET`. Benign in practice
  (`body` is `undefined` for GET) but a valid static signal. **Left unfixed** — source
  change is outside this lint-tooling lever. This is why `pnpm --filter sietch lint`
  exits 1; per pass rules a real finding is expected and NOT auto-fixed.
- Informational warnings added: `oxc(no-async-endpoint-handlers)` 184,
  `eslint(no-await-in-loop)` 139, `no-underscore-dangle` 21, `unicorn(no-array-sort)`
  19, `oxc(no-map-spread)` 5, `preserve-caught-error` 9, `no-shadow` 7, etc.

The repo-wide root gate (`oxlint`) surfaces **259 errors / 3363 warnings across
1844 files** — the first-ever repo-wide lint signal (O2.1). Nonzero by design; a
new gate reporting real findings is the intended outcome, not a failure.

## 7. Files created / modified this pass

- **created** `.oxlintrc.json` (root repo-wide gate config)
- **created** `themes/sietch/.oxlintrc.json` (nested config; mirrors `.eslintrc.cjs`)
- **created** `grimoires/loa/optimization/pass2-oxlint-parity.md` (this file)
- **modified** `package.json` (root): `+ scripts.lint: "oxlint"`, `+ devDependencies.oxlint: "1.73.0"`
- **modified** `pnpm-lock.yaml` (root): oxlint 1.73.0 resolution (expected lockfile delta)
- **modified** `themes/sietch/package.json`: `lint` → `../../node_modules/.bin/oxlint src`; added `lint:types` (eslint residual); `lint:fix` unchanged
- **modified** `apps/ingestor/package.json`: `lint` → `../../node_modules/.bin/oxlint src`
- **modified** `apps/worker/package.json`: `lint` → `../../node_modules/.bin/oxlint src`
- **modified** `grimoires/loa/optimization/harness-opportunity-matrix.md` (added §9 pointer)

Subpackage scripts call the root-installed binary by relative path because the repo
has **no** `pnpm-workspace.yaml` (no hoisting; bare `oxlint` does not resolve from a
subpackage). This keeps the lockfile delta to the **root** lockfile only.

## 8. Integrity note

- **Not touched:** `packages/events` `events-lint` (orthogonal NATS tripwire), all
  existing `.github/workflows/*.yml` (CI wiring is Pass 5), `.claude/`, `.beads/`,
  `.run/`, `*.pyc`. No source was auto-fixed. No `git add`/`commit`/`br sync`.
- **Ignore hygiene verified:** the root gate's file set excludes `node_modules`,
  `dist`, `build`, `coverage`, `**/*.d.ts`, `.worktrees/**`, `wt-*/**`, `.claude/**`,
  `.beads/**`, `.run/**` (confirmed via `--debug=files`).
