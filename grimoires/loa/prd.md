# PRD: CI Pipeline Rehabilitation

> **Cycle**: cycle-045
> **Codename**: Clean Slate — Zero-Error CI Pipeline
> **Status**: DRAFT
> **Created**: 2026-02-27
> **Author**: Simstim (HITL)

## 1. Problem Statement

The loa-freeside CI pipeline has 5 required quality gates — Build, Lint, Unit Tests, Security Scan, Docker Build — and **all fail or are blocked**. PRs cannot be properly gated, meaning broken code can (and does) merge to main. This accumulated during cycles 039–044 as feature work outpaced infrastructure maintenance.

Root cause analysis reveals a **single cascading dependency** (`@0xhoneyjar/loa-hounfour` pinned to a commit with broken `dist/`) causes ~70% of all failures. The remaining 30% are missing dependencies, stale test mocks, and unpatched vulnerabilities.

> Sources: CI audit (PR #102), GitHub Actions run logs, `npm audit` output

## 2. Goals & Success Metrics

| ID | Goal | Metric | Target |
|----|------|--------|--------|
| G-1 | All 5 required CI checks pass on main | Build + Lint + Tests + Security Scan + Docker Build = green | 5/5 pass |
| G-2 | Zero critical/high security vulnerabilities | `npm audit --audit-level=high` exit code 0 | 0 critical/high (moderate accepted) |
| G-3 | Test pass rate recovery | Non-quarantined failing test files | 0 (quarantined tests tracked via issues with expiry) |
| G-4 | Clean lint baseline | ESLint errors in linted paths (excludes `src/ui/builder/`) | 0 |
| G-5 | Build compiles without errors | `tsc --noEmit` exit code | 0 for both adapters and sietch |

## 3. Scope

### In Scope

1. **Dependency fix**: Re-pin `@0xhoneyjar/loa-hounfour` to `b6e0027a` (upstream fix pushed by maintainer) in both `packages/adapters` and `themes/sietch`
2. **Missing dependencies**: Add `bullmq`, `aws-embedded-metrics`, `@aws-sdk/client-secrets-manager` to `packages/adapters/package.json`
3. **TypeScript errors**: Fix remaining TS errors in adapters (~61) and sietch (~258) after hounfour re-pin resolves the cascade
4. **ESLint errors**: Fix errors across linted paths (majority expected to auto-resolve with hounfour fix; remainder are unused vars, unsafe calls)
5. **Builder exclusion**: Exclude `src/ui/builder/` from ESLint via `.eslintignore` (separate concern, not in tsconfig project — 20 parsing errors eliminated)
6. **Security vulnerabilities**: Patch all 43 vulnerabilities:
   - Non-breaking: axios, ajv, fast-xml-parser, lodash, minimatch, qs, rollup, tough-cookie via `npm audit fix`
   - Breaking: vitest 4.x (esbuild fix), node-vault (form-data fix), discord.js (undici fix) via `npm audit fix --force`
   - **Contingency**: If a breaking upgrade destabilizes more than can be resolved in-cycle, pin to a resolution override that passes `npm audit --audit-level=high` and track the remaining moderate vuln as a follow-up issue
7. **Test infrastructure**: Fix shared test patterns (may include adding minimal test helpers/fixtures):
   - Dashboard auth dependency injection (7 failures)
   - Redis mock isolation (25 failures)
   - Config mock fragility (scattered)
   - Date serialization (MFAService)
8. **Test fixes**: Address remaining test failures after hounfour re-pin clears ~25 files. Tests that cannot be fixed (e.g., testing deleted/moved code) may be quarantined with a tracked issue and expiry date.
9. **Node version alignment**: Explicitly set `engine-strict=false` in CI npm config for the adapters install step to handle Node 20 vs >=22 mismatch. Document this constraint.
10. **Docker Build**: Verify Docker Build check passes after dependency and build fixes. If Dockerfile changes are needed, make minimal adjustments in scope.

### Out of Scope

- New feature development
- Refactoring production logic (only touching what's needed for CI)
- Adding new feature tests (test helpers/fixtures for existing tests ARE in scope)
- Major CI workflow restructuring (minimal adjustments for engine-strict ARE in scope)
- Performance optimization

## 4. Technical Constraints

- Node 20 in CI; `packages/adapters` requires >=22. Mitigated by `engine-strict=false` in CI npm config.
- `required_linear_history: true` on main branch (squash merges only)
- Branch protection requires: Build, Unit Tests, Lint, Security Scan, Docker Build
- 2 approving reviews required (will use admin bypass for infrastructure PR)
- CI Security Scan check runs `npm audit --audit-level=high` (confirmed from `.github/workflows/pr-validation.yml`)

## 5. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| vitest 4.x breaks test syntax | Medium | High — 191 test files | Run full suite after upgrade; if >20 files break, pin vitest with resolution override and track as follow-up |
| discord.js upgrade breaks bot | Low | High — production bot | Review changelog, test bot startup; if breaking, pin with resolution override |
| node-vault upgrade breaks secrets | Low | Medium | Review API changes; if breaking, pin with resolution override |
| hounfour re-pin surfaces new API changes | Low | Medium | Compare exports between old and new commits |
| Lint fixes introduce subtle behavior changes | Very Low | Low | Only removing unused imports and adding type annotations |
| Docker Build needs Dockerfile changes | Low | Low | Make minimal changes if needed; Dockerfile is not declared out of scope |

## 6. Delivery Strategy

### Staged PRs (preferred if breaking upgrades are risky)

| PR | Contents | Gate |
|----|----------|------|
| PR A (MVP) | hounfour re-pin + missing deps + TS fixes + lint fixes + test infra | Build + Lint + Tests green |
| PR B | Security upgrades (non-breaking + breaking) | Security Scan green |

### Single PR (preferred if breaking upgrades go smoothly)

All changes in one PR if security upgrades don't destabilize tests.

Decision made at implementation time based on actual impact.

## 7. Success Criteria

PR(s) are mergeable when:
1. `npm run build` succeeds for packages/core, packages/adapters, themes/sietch
2. `npx tsc --noEmit` passes with 0 errors in themes/sietch
3. `npm run lint` passes with 0 errors in themes/sietch (builder excluded via `.eslintignore`)
4. `npm audit --audit-level=high` returns 0 critical/high vulnerabilities
5. `npm test` passes all non-quarantined test files. Any quarantined tests have a tracked issue with expiry date.
6. All 5 required GitHub Actions checks show green: Build, Lint, Unit Tests, Security Scan, Docker Build
