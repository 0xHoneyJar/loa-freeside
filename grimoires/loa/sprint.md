# Sprint Plan: CI Pipeline Rehabilitation

> **Cycle**: cycle-045
> **PRD**: `grimoires/loa/prd.md` (GPT-APPROVED, 2 iter)
> **SDD**: `grimoires/loa/sdd.md` (GPT-APPROVED, 3 iter)
> **Delivery**: Staged — Sprint 1 (PR A: MVP), Sprint 2 (PR B: Security + Docker)

---

## Sprint Overview

| Sprint | Global ID | Focus | CI Gates Targeted |
|--------|-----------|-------|--------------------|
| 1 | 378 | Dependencies + Build + Lint + Tests | Build, Lint, Unit Tests |
| 2 | 379 | Security + Docker | Security Scan, Docker Build |

---

## Sprint 1: Build + Lint + Test Gates (Global ID: 378)

**Goal**: Get Build, Lint, and Unit Tests CI checks to green.
**Branch**: `fix/ci-rehab-mvp` off `main`

### Task 1.1: hounfour Re-pin + Missing Dependencies + Engine Fix

**Priority**: P0 (blocks everything)
**SDD**: §2.1, §2.2, §2.7

**Description**: Update the broken hounfour dependency pin, add missing packages to adapters, lower the conservative engine requirement, and regenerate per-package lockfiles that CI consumes. CI runs per-package `npm ci` in core, adapters, and sietch — all three lockfiles must be consistent.

**Acceptance Criteria**:
- [ ] `packages/adapters/package.json`: hounfour hash updated from `addb0bf` to `b6e0027a`
- [ ] `themes/sietch/package.json`: hounfour hash updated to `b6e0027a` (if present as direct dep, otherwise transitive via adapters)
- [ ] `packages/adapters/package.json`: `bullmq` added to `devDependencies`
- [ ] `packages/adapters/package.json`: `aws-embedded-metrics` added to `dependencies`
- [ ] `packages/adapters/package.json`: `@aws-sdk/client-secrets-manager` added to `dependencies`
- [ ] `packages/adapters/package.json`: `engines.node` lowered from `>=22` to `>=20`
- [ ] `npm install --package-lock-only` run in `packages/core` — lockfile regenerated
- [ ] `npm install --package-lock-only` run in `packages/adapters` — lockfile regenerated
- [ ] `npm install --package-lock-only` run in `themes/sietch` — lockfile regenerated
- [ ] Verification: `npm ci` succeeds in each package directory (core, adapters, sietch)
- [ ] Verification: hounfour `dist/core/index.js` exists after install

### Task 1.2: TypeScript Error Fixes

**Priority**: P0 (blocks Build gate)
**Depends on**: Task 1.1
**SDD**: §2.3

**Description**: Fix all remaining TypeScript errors after hounfour cascade clears. Only mechanical fixes — no production logic changes. Both packages use `module: "NodeNext"` + `"type": "module"`, so `.js` extensions on relative imports are correct.

**Acceptance Criteria**:
- [ ] `npm run build` succeeds for `packages/core` (tsc)
- [ ] `npm run build` succeeds for `packages/adapters` (tsc)
- [ ] `npm run build` succeeds for `themes/sietch` (tsc -p tsconfig.production.json — this is what CI Build runs)
- [ ] `npx tsc --noEmit` passes with 0 errors in `themes/sietch` (stricter check with full tsconfig)
- [ ] Fix categories applied: unused var removal (`_` prefix), null checks, `.js` extensions, type narrowing, explicit annotations
- [ ] No production logic changes — only type-level fixes

### Task 1.3: ESLint Fixes

**Priority**: P0 (blocks Lint gate)
**Depends on**: Task 1.2
**SDD**: §2.4

**Description**: Fix all ESLint errors in linted paths. Builder directory excluded via `.eslintignore`. CI Lint gate runs only in `themes/sietch` (`working-directory: ./themes/sietch`), invoking `npm run lint` which resolves to `eslint src --ext .ts` — honors `.eslintignore`, no `--no-ignore`. Adapters and core do not have CI lint gates.

**Acceptance Criteria**:
- [ ] `themes/sietch/.eslintignore` created with `src/ui/builder/` exclusion
- [ ] Auto-fixable errors applied via `npx eslint src --ext .ts --fix`
- [ ] Remaining unused imports removed manually
- [ ] Remaining unsafe-* errors fixed (type annotations, casts at module boundaries)
- [ ] `npm run lint` passes with 0 errors in `themes/sietch` (exact CI command replicated locally)
- [ ] CI Lint scope confirmed: sietch-only (`WORKING_DIR: ./themes/sietch` in workflow)

### Task 1.4: Test Infrastructure Fixes

**Priority**: P0 (blocks Unit Tests gate)
**Depends on**: Task 1.1
**SDD**: §2.6

**Description**: Fix shared test infrastructure patterns that cause cascading failures. After hounfour re-pin auto-resolves ~25 test files, fix remaining infrastructure issues.

**Acceptance Criteria**:
- [ ] Dashboard auth DI: `dashboardAuth` mock added to `DriftRoutesDeps` in affected test files
- [ ] Redis mock isolation: `ioredis` mocked at module level in affected test file
- [ ] Config mock fragility: inline mocks updated to match current config shape
- [ ] Date serialization: MFAService test assertion handles ISO string vs Date
- [ ] Logger mock: `fatal: vi.fn()` added to logger mocks where needed
- [ ] `npm test` passes all non-quarantined test files
- [ ] Any quarantined tests have GitHub issue with expiry date

### Task 1.5: PR A — MVP Validation

**Priority**: P0
**Depends on**: Tasks 1.1–1.4

**Description**: Create and push the MVP branch, verify 3 CI gates pass.

**Acceptance Criteria**:
- [ ] Branch `fix/ci-rehab-mvp` pushed to origin
- [ ] Build check: green
- [ ] Lint check: green
- [ ] Unit Tests check: green
- [ ] PR created with summary of all changes

---

## Sprint 2: Security + Docker Gates (Global ID: 379)

**Goal**: Get Security Scan and Docker Build CI checks to green. All 5 gates green.
**Branch**: `fix/ci-rehab-security` off `main` (after PR A merges)
**Depends on**: Sprint 1 merged

### Task 2.1: Non-Breaking Security Patches

**Priority**: P0
**SDD**: §2.5 Phase 1

**Description**: Apply non-breaking security fixes via `npm audit fix`. CI Security Scan runs only in `themes/sietch` (`working-directory: ./themes/sietch`), so sietch is the target. Adapters/core do not have CI security gates.

**Acceptance Criteria**:
- [ ] `npm audit fix` run in `themes/sietch`
- [ ] Resolved: `fast-xml-parser` (critical, 4 CVEs), `@aws-sdk/*` chain (high), `axios` (high), `minimatch` (high), `qs` (high), `rollup` (high)
- [ ] `npm test` still passes (no regressions from non-breaking upgrades)
- [ ] Updated lockfile committed
- [ ] CI Security Scan scope confirmed: sietch-only (`WORKING_DIR: ./themes/sietch` in workflow)

### Task 2.2: Breaking Security Patch (node-vault)

**Priority**: P1
**Depends on**: Task 2.1
**SDD**: §2.5 Phase 2

**Description**: Upgrade `node-vault` to resolve the `postman-request` → `form-data` / `tough-cookie` critical vulnerability chain. This is a semver-major change.

**Acceptance Criteria**:
- [ ] `node-vault` upgraded in `themes/sietch/package.json`
- [ ] Vault-related code reviewed for API compatibility
- [ ] `npm test` still passes
- [ ] **Contingency**: If >20 new test failures, pin `node-vault@0.10.9` with `overrides` for transitive deps — BUT only if `npm audit --audit-level=high` still exits 0 after overrides (i.e., overrides eliminate the critical/high chain). If overrides cannot achieve audit compliance, complete the major upgrade within this sprint.

### Task 2.3: Security Gate Validation

**Priority**: P0
**Depends on**: Tasks 2.1–2.2

**Acceptance Criteria**:
- [ ] `npm audit --audit-level=high` returns exit code 0
- [ ] Any remaining moderate vulnerabilities documented

### Task 2.4: Docker Build Verification

**Priority**: P0
**Depends on**: Task 2.3
**SDD**: §2.8

**Acceptance Criteria**:
- [ ] Docker Build check: green
- [ ] Dockerfile verified: uses `node:20-alpine` (matches lowered engine >=20), runs per-package `npm ci` for core/adapters/sietch with correct lockfiles in build context
- [ ] If Dockerfile changes needed: minimal adjustments only (lockfile copy paths, new adapters subdirectories, base image tag)

### Task 2.5: PR B — Final Validation

**Priority**: P0
**Depends on**: Tasks 2.1–2.4

**Acceptance Criteria**:
- [ ] Branch `fix/ci-rehab-security` pushed to origin
- [ ] All 5 required checks green: Build, Lint, Unit Tests, Security Scan, Docker Build
- [ ] PR created with summary
- [ ] PRD goals G-1 through G-5 all satisfied

---

## Risk Register

| Risk | Sprint | Mitigation | Trigger | Contingency |
|------|--------|-----------|---------|-------------|
| hounfour `b6e0027a` has different API | 1 | Compare exports before/after | TS2305 errors after re-pin | Update import sites |
| TS fixes introduce runtime bugs | 1 | Only mechanical fixes | New test failures on passing code | Revert individual files |
| `.eslintignore` not effective | 1 | Confirmed lint script honors it | Lint gate still fails | Adjust lint script glob |
| Test quarantine overuse | 1 | Max 5 quarantined files with expiry | >5 files need quarantine | Investigate root cause first |
| node-vault upgrade breaks vault | 2 | Review changelog, test vault ops | >20 new test failures | Pin with overrides |
| npm audit fix introduces regression | 2 | Run tests after each fix | Test failures after fix | Revert individual package bumps |
| Docker Build needs changes | 2 | Minimal adjustments in scope | Docker check fails | Fix lockfile paths or base image |

## Definition of Done

All PRD success criteria met:
1. `npm run build` succeeds for core, adapters, sietch
2. `npx tsc --noEmit` passes with 0 errors in sietch
3. `npm run lint` passes with 0 errors in sietch (builder excluded)
4. `npm audit --audit-level=high` returns 0 critical/high
5. `npm test` passes all non-quarantined test files
6. All 5 required GitHub Actions checks green: Build, Lint, Unit Tests, Security Scan, Docker Build
