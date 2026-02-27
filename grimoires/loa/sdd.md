# SDD: CI Pipeline Rehabilitation

> **Version**: 1.1.0
> **Cycle**: cycle-045
> **Date**: 2026-02-27
> **PRD**: `grimoires/loa/prd.md`

## 1. Overview

This SDD documents the technical approach for fixing all 5 required CI quality gates. No new architecture is introduced — all changes are dependency updates, type fixes, lint fixes, test infrastructure repairs, and security patches.

### 1.1 CI Install Topology

The CI workflow (`.github/workflows/pr-validation.yml`) uses **per-package installs**, not a workspace root install:

- `WORKING_DIR: ./themes/sietch` — all jobs default to this directory
- Build job: `npm ci` in sietch, then `cd ../../packages/core && npm ci && npm run build`, then `cd ../adapters && npm ci && npm run build`
- Each package has its own `package-lock.json`
- Lint, Tests, and Security jobs each run `npm ci` in `themes/sietch` only

All lockfile regeneration in this SDD targets the per-package lockfiles that CI actually consumes.

## 2. Fix Categories & Approach

### 2.1 Dependency Fix: hounfour Re-pin

**Files**: `packages/adapters/package.json`, `themes/sietch/package.json`, both `package-lock.json`

**Approach**:
1. Update git commit hash from `addb0bf` to `b6e0027a` in both `package.json` files
2. Run `npm install --package-lock-only` in each package directory to regenerate per-package lockfiles
3. Verify resolved hash by running: `node -e "console.log(require('./node_modules/@0xhoneyjar/loa-hounfour/package.json').version)"` in each directory
4. Verify `dist/core/index.js` exists in installed package

**Expected cascade resolution**: ~70% of TS errors, ~74% of lint errors, ~25 test file failures

### 2.2 Missing Dependencies: packages/adapters

**File**: `packages/adapters/package.json`

| Package | Import Type | Add As |
|---------|------------|--------|
| `bullmq` | Type-only (3 files) | `devDependencies` |
| `aws-embedded-metrics` | Value import (1 file) | `dependencies` |
| `@aws-sdk/client-secrets-manager` | Value import (1 file) | `dependencies` |

### 2.3 TypeScript Error Fixes

Both packages use `module: "NodeNext"` and `moduleResolution: "NodeNext"` with `"type": "module"` in package.json. This is confirmed ESM — `.js` extensions on relative imports are correct and required.

**Post-hounfour residual errors** (estimated after cascade clears):

| Category | Fix Pattern | Module System Note |
|----------|------------|-------------------|
| TS6133/TS6196 (unused vars) | Remove or prefix with `_` | — |
| TS2532/TS18048 (possibly undefined) | Add null checks or non-null assertions where safe | — |
| TS2345 (type mismatch) | Add narrowing guards or type assertions | — |
| TS2305 (missing exports from hounfour) | Verify exports exist in `b6e0027a`; if genuinely removed, update import sites | — |
| TS2835 (relative imports need .js) | Add `.js` extensions to relative imports | Confirmed correct: `module: "NodeNext"` + `"type": "module"` in both packages |
| TS7006 (implicit any) | Add explicit type annotations | — |

### 2.4 ESLint Fixes

**Confirmed CI lint invocation**: `eslint src --ext .ts` (from `themes/sietch/package.json` `lint` script). This targets only `src/` and honors `.eslintignore`. The `--no-ignore` flag is NOT used. Additionally, `src/ui/**` is already excluded from `tsconfig.json`, so builder files are outside the TS compilation scope.

**Strategy**: Fix in dependency order so each layer resolves cleanly.

1. **Exclude builder** (20 parsing errors): Add `src/ui/builder/` to `themes/sietch/.eslintignore`. This is consistent with the PRD (G-4 scopes lint to "linted paths" with builder excluded) and with CI (which runs `eslint src --ext .ts` honoring `.eslintignore`).
2. **Auto-fix** (96 auto-fixable): Run `npx eslint src --ext .ts --fix`
3. **Unused vars** (196 errors): Remove unused imports
4. **Unsafe-* rules** (1,359 errors): Majority should auto-resolve once hounfour types resolve. Remaining need explicit type annotations or `as` casts at module boundaries.

### 2.5 Security Patches

**Actual vulnerability chains** (from `npm audit --json` in `themes/sietch`):

**Phase 1 — Non-breaking** (`npm audit fix`):

| Root Vulnerability | Severity | Dependency Chain | Fix |
|-------------------|----------|-----------------|-----|
| `fast-xml-parser` (4 CVEs: RangeError DoS, entity expansion DoS, regex injection, stack overflow) | Critical | `fast-xml-parser` → `@aws-sdk/xml-builder` → `@aws-sdk/core` → 18 `@aws-sdk/*` packages | `npm audit fix` bumps `@aws-sdk/client-s3` (and transitive deps) |
| `axios` (DoS via `__proto__` key in mergeConfig) | High | Direct dependency | `npm audit fix` bumps `axios` |
| `minimatch` (6 ReDoS vulns) | High | Transitive | `npm audit fix` |
| `qs` (2 DoS vulns via arrayLimit bypass) | High | Direct via `postman-request`, also transitive | `npm audit fix` for direct path |
| `rollup` (arbitrary file write via path traversal) | High | Transitive (via vitest/vite) | `npm audit fix` |

**Phase 2 — Breaking** (targeted, not `--force`):

| Root Vulnerability | Severity | Dependency Chain | Required Fix |
|-------------------|----------|-----------------|-------------|
| `node-vault` → `postman-request` → `form-data` (unsafe random boundary), `qs`, `tough-cookie` | Critical | `node-vault@0.10.9` depends on `postman-request` which bundles vulnerable `form-data`, `qs`, `tough-cookie` | Upgrade `node-vault` to `0.9.22` (semver-major API change). Review API changelog, test vault operations. |

**Note**: The previous SDD incorrectly listed `esbuild → vitest 4.x` and `undici → discord.js` as breaking security upgrades. These do not appear in `npm audit --audit-level=high`. The only breaking upgrade required for the security gate is `node-vault`.

**Contingency**: If the `node-vault` upgrade introduces >20 new test failures or breaks vault operations, pin `node-vault@0.10.9` with an npm `overrides` entry for `form-data` and `tough-cookie` to patched versions if available, or accept the `form-data` moderate-severity vuln and track as a follow-up issue (the `npm audit --audit-level=high` gate only blocks on critical/high).

### 2.6 Test Infrastructure Fixes

| Failure Category | Files Affected | Fix |
|-----------------|---------------|-----|
| hounfour module resolution | ~25 test files | Auto-resolves with re-pin |
| Dashboard auth DI | 2 test files (7 failures) | Add `dashboardAuth` mock to `DriftRoutesDeps` in remaining test files |
| Redis mock isolation | 1 test file (25 failures) | Mock `ioredis` at module level; prevent real connection attempts |
| Config mock fragility | ~10 test files | Fix inline mocks to match current config shape |
| Date serialization | 1 test (MFAService) | Fix assertion to handle ISO string vs Date object |
| logger.fatal not mocked | Potential hidden failures | Add `fatal: vi.fn()` to logger mocks where logger is mocked |

### 2.7 Node Engine Alignment

**Problem**: `packages/adapters` declares `engines.node: ">=22"` but CI uses Node 20. `themes/sietch` declares `engines.node: ">=20.0.0"` (no conflict).

**Approach**: Lower `packages/adapters/package.json` `engines.node` from `">=22"` to `">=20"` to match CI.

**File**: `packages/adapters/package.json`

```json
"engines": {
  "node": ">=20"
}
```

**Justification**:
- Adapters targets `ES2022` (fully supported in Node 20) with `module: "NodeNext"`
- No adapters dependencies have postinstall scripts requiring Node 22
- No Node 22-specific APIs are used in adapters source code (verified: no `fs.glob`, no `navigator`, no `import.meta.resolve` without flag)
- The `>=22` constraint was conservatively set and has never been validated — CI has always used Node 20
- This avoids the `engine-strict=false` workaround, which bypasses the check without resolving the underlying mismatch

**Verification**: The Build job (`npm ci && npm run build` + `tsc --noEmit`) and test suite running on Node 20 will confirm full compatibility. No workflow changes needed.

### 2.8 Docker Build

**Approach**: Verify Docker Build passes after all other fixes. If it fails due to dependency changes, make minimal Dockerfile adjustments (likely just lockfile copy paths or Node version).

## 3. Execution Order

Critical path — test infrastructure stabilized BEFORE security patches to enable accurate failure attribution:

```
1. hounfour re-pin ──→ 2. missing deps ──→ 3. lockfile regen
       │                                          │
       └──────────────────────────────────────────┘
                          │
                    4. TS error fixes
                          │
                    5. ESLint fixes (auto-fix + manual)
                          │
                    6. Test infrastructure fixes
                          │
                    7. Remaining test fixes (establish green baseline)
                          │
                    8. Security patches (non-breaking)
                          │
                    9. Security patches (breaking: node-vault)
                          │
                   10. Docker Build verification
                          │
                   11. CI validation (push + check)
```

**Rationale for order change**: Security patches (especially breaking ones like `node-vault`) are applied after test infrastructure is stable. This ensures any new test failures from the upgrade can be accurately attributed to the security change, not pre-existing test issues. If the `node-vault` upgrade introduces failures, the contingency (pin with overrides) can be applied with confidence.

## 4. Risk Mitigations

| Risk | Mitigation | Fallback |
|------|-----------|----------|
| node-vault 0.9.22 API changes | Review changelog, test vault operations before and after | Pin with `overrides` for transitive vulns; accept if only moderate-severity remains |
| hounfour `b6e0027a` has different API surface | Compare exports before/after | Update import sites |
| TS fixes introduce runtime bugs | Only mechanical fixes (unused vars, null checks) | Revert individual files |
| Lowering adapters engine to >=20 misses a real Node 22 dependency | Build + tsc + full test suite on Node 20 validates compatibility | Upgrade CI to Node 22 if a runtime issue surfaces |
| `.eslintignore` not honored in CI | Confirmed: lint script is `eslint src --ext .ts` (no `--no-ignore`) | Adjust lint script glob to exclude builder explicitly |

## 5. Files Modified (Expected)

| Path | Change Type |
|------|------------|
| `packages/adapters/package.json` | Dependency updates (hounfour re-pin + missing deps) |
| `packages/adapters/package-lock.json` | Regenerated (per-package, consumed by CI `npm ci`) |
| `packages/adapters/agent/*.ts` | TS error fixes (unused vars, null checks) |
| `themes/sietch/package.json` | Dependency updates (hounfour re-pin, node-vault upgrade) |
| `themes/sietch/package-lock.json` | Regenerated (per-package, consumed by CI `npm ci`) |
| `themes/sietch/.eslintignore` | Add builder exclusion |
| `themes/sietch/src/**/*.ts` | Lint fixes (unused imports, type annotations) |
| `themes/sietch/tests/**/*.test.ts` | Test mock fixes |
| `packages/adapters/package.json` | Lower `engines.node` from `>=22` to `>=20` |
