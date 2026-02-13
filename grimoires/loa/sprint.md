# Sprint Plan: Bridgebuilder Round 9 — E2E Infrastructure Hardening

**Version**: 1.0.0
**Date**: February 13, 2026
**Cycle**: cycle-021
**Codename**: The Dead Drop
**Source**: [Bridgebuilder Round 9 — PR #57](https://github.com/0xHoneyJar/arrakis/pull/57)
**PRD**: `prd-hounfour-finish-line.md`
**SDD**: `sdd-hounfour-finish-line.md`
**RFC**: [0xHoneyJar/loa-finn#31](https://github.com/0xHoneyJar/loa-finn/issues/31)

---

## Overview

| Attribute | Value |
|-----------|-------|
| **Total Sprints** | 2 |
| **Sprint Timebox** | 1 day each (solo AI-assisted) |
| **Developer** | Solo (AI-assisted) |
| **Repos** | arrakis (primary) |
| **Global Sprint IDs** | 214, 215 |
| **Branch** | `feature/e2e-deployment-extract` (PR #57) |

### Context

PR #57 extracted ~1,400 lines of E2E infrastructure and deployment validation scripts from the now-closed PR #53. Bridgebuilder Round 9 reviewed the extraction and identified 8 findings (1 HIGH, 4 MEDIUM, 3 LOW) focused on supply chain integrity, trust boundary hardening, and operational polish. This sprint plan implements all 8 findings.

### Goals

| ID | Goal | BB9 Finding | Metric |
|----|------|-------------|--------|
| G-1 | Close supply chain integrity gap in E2E runner | R9-1 (HIGH) | SHA verification after checkout |
| G-2 | Harden trust boundaries (key material, JWKS volume) | R9-2, R9-3 | Key shredding in cleanup, atomic JWKS write |
| G-3 | Fix cross-version Docker Compose parsing | R9-4 | `jq -s` normalization for NDJSON/array |
| G-4 | Add TLS certificate expiry check for staging | R9-5 | WARN when cert < 7 days from expiry |
| G-5 | Polish operational ergonomics (timer, ESM, compat refs) | R9-6, R9-7, R9-8 | No misleading 0ms timings, ESM consistency, SHA-based compat refs |

### Findings Summary

| # | Severity | Finding | Sprint |
|---|----------|---------|--------|
| R9-1 | HIGH | SHA pinning without integrity verification | 1 |
| R9-2 | MEDIUM | Ephemeral key material left on disk without shredding | 1 |
| R9-3 | MEDIUM | JWKS shared volume trust boundary without integrity check | 1 |
| R9-4 | MEDIUM | Health poll parsing fragile across Docker Compose v2 formats | 1 |
| R9-5 | MEDIUM | Deployment validator missing TLS certificate expiry check | 2 |
| R9-6 | LOW | `timer_ms()` fallback yields misleading 0ms readings | 2 |
| R9-7 | LOW | `sign-test-jwt.js` uses CommonJS in ESM-native codebase | 2 |
| R9-8 | LOW | Compatibility matrix references closed PR numbers | 2 |

---

## Sprint 1: Supply Chain & Trust Boundary Hardening (Global ID: 214)

**Goal**: Close the HIGH-severity supply chain gap, harden ephemeral key lifecycle, make JWKS writes atomic, and fix Docker Compose JSON parsing across versions.

### Task 1.1: SHA Integrity Verification After Checkout (R9-1)

**ID**: arrakis-r9-1
**File**: `scripts/run-e2e.sh`
**Priority**: HIGH

**Problem**: Line 26 validates that `LOA_FINN_SHA` is present (`${LOA_FINN_SHA:?...}`) but after `git checkout "$LOA_FINN_SHA"`, there's no verification that `HEAD` actually matches the expected SHA. In CI, abbreviated SHA matches, symbolic refs, or compromised env vars could silently check out the wrong code.

**Solution**: After each `git checkout "$LOA_FINN_SHA"` call (lines 109 and 121), add a `git rev-parse HEAD` verification step that compares the full 40-character SHA against the expected value and logs the tree hash for audit trail.

**Implementation**:

1. After the `git checkout` in the existing-checkout branch (line 109-112), add:
   ```bash
   actual_sha=$(git rev-parse HEAD)
   if [ "$actual_sha" != "$LOA_FINN_SHA" ]; then
     echo "[run-e2e] INTEGRITY VIOLATION: expected $LOA_FINN_SHA, got $actual_sha"
     exit 2
   fi
   echo "[run-e2e] SHA verified: $actual_sha (tree: $(git rev-parse HEAD^{tree}))"
   ```

2. Apply the same verification after the fresh-clone checkout (line 121-124).

3. Log the tree hash alongside the commit hash for full provenance chain.

**Acceptance Criteria**:
- AC-1.1.1: After `git checkout`, `git rev-parse HEAD` is compared against `$LOA_FINN_SHA`
- AC-1.1.2: Mismatch exits with code 2 and `INTEGRITY VIOLATION` message
- AC-1.1.3: Successful verification logs full SHA and tree hash
- AC-1.1.4: Both checkout paths (existing + fresh clone) include verification

---

### Task 1.2: Ephemeral Key Material Shredding (R9-2)

**ID**: arrakis-r9-2
**File**: `scripts/run-e2e.sh`
**Priority**: MEDIUM

**Problem**: The `cleanup()` trap at line 59-65 tears down Docker Compose but leaves the generated ES256 keypair in `.e2e-keys/` on disk. While these are test keys, the pattern should enforce generate-use-shred to prevent copy-paste into staging contexts.

**Solution**: Add key material cleanup to the `cleanup()` trap function.

**Implementation**:

1. Update `cleanup()` to shred the `.e2e-keys/` directory:
   ```bash
   cleanup() {
     echo ""
     echo "═══════════════════════════════════════════════════════"
     echo "  Tearing down Docker Compose stack..."
     echo "═══════════════════════════════════════════════════════"
     # Shred ephemeral key material
     if [ -d "$REPO_ROOT/.e2e-keys" ]; then
       rm -rf "$REPO_ROOT/.e2e-keys"
       echo "[run-e2e] Ephemeral keys shredded"
     fi
     docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
   }
   ```

2. Add a comment in `generate_test_keypair()` noting the lifecycle: "Keys are shredded in cleanup() trap"

**Acceptance Criteria**:
- AC-1.2.1: `.e2e-keys/` directory removed in `cleanup()` trap
- AC-1.2.2: Key shredding happens before Docker teardown (keys removed even if Docker teardown fails)
- AC-1.2.3: Comment documents the generate-use-shred lifecycle
- AC-1.2.4: `cleanup()` is idempotent (no error if `.e2e-keys/` doesn't exist)

---

### Task 1.3: Atomic JWKS Write with JSON Validation (R9-3)

**ID**: arrakis-r9-3
**File**: `tests/e2e/e2e-entrypoint.sh`
**Priority**: MEDIUM

**Problem**: Lines 33-35 write JWKS directly to `$JWKS_EXPORT_PATH` via `curl > file`. If the curl fails mid-write or the JWKS endpoint returns an error body, loa-finn reads partial or invalid JSON from the shared volume.

**Solution**: Write to a temporary file, validate JSON structure, then atomically rename.

**Implementation**:

1. Replace the direct curl write with atomic write pattern:
   ```sh
   curl -sf http://localhost:3000/.well-known/jwks.json > "${JWKS_EXPORT_PATH}.tmp"
   # Validate JSON structure before committing
   if ! jq empty "${JWKS_EXPORT_PATH}.tmp" 2>/dev/null; then
     echo "[e2e-entrypoint] ERROR: JWKS is not valid JSON"
     rm -f "${JWKS_EXPORT_PATH}.tmp"
     exit 1
   fi
   # Atomic rename — POSIX guarantees readers never see partial data
   mv "${JWKS_EXPORT_PATH}.tmp" "$JWKS_EXPORT_PATH"
   ```

2. **Ensure `jq` is available in the E2E Docker image**. The `e2e` stage in `themes/sietch/Dockerfile` extends `production` which installs `curl` via `apk add`. Add `jq` to the same `apk add` line in the production stage, OR add a separate `RUN apk add --no-cache jq` in the `e2e` stage (preferred — keeps production image minimal). Verify by running `docker run --rm <e2e-image> jq --version`.

3. Add a `command -v jq` guard in the entrypoint before using it:
   ```sh
   if ! command -v jq > /dev/null 2>&1; then
     echo "[e2e-entrypoint] WARNING: jq not found, skipping JWKS JSON validation"
     curl -sf http://localhost:3000/.well-known/jwks.json > "$JWKS_EXPORT_PATH"
   else
     curl -sf http://localhost:3000/.well-known/jwks.json > "${JWKS_EXPORT_PATH}.tmp"
     if ! jq empty "${JWKS_EXPORT_PATH}.tmp" 2>/dev/null; then
       echo "[e2e-entrypoint] ERROR: JWKS is not valid JSON"
       rm -f "${JWKS_EXPORT_PATH}.tmp"
       exit 1
     fi
     mv "${JWKS_EXPORT_PATH}.tmp" "$JWKS_EXPORT_PATH"
   fi
   ```

**Acceptance Criteria**:
- AC-1.3.1: JWKS written to `.tmp` file first, then atomically renamed via `mv`
- AC-1.3.2: `jq empty` validates JSON structure before rename
- AC-1.3.3: Invalid JSON causes exit 1 with actionable error message
- AC-1.3.4: Temp file cleaned up on validation failure
- AC-1.3.5: `jq` installed in E2E Docker image stage (`themes/sietch/Dockerfile` e2e stage)
- AC-1.3.6: `docker run --rm <e2e-image> jq --version` succeeds (verifiable in goal check)
- AC-1.3.7: Graceful fallback if `jq` not found (direct write with warning, not hard failure)

---

### Task 1.4: Docker Compose JSON Output Normalization (R9-4)

**ID**: arrakis-r9-4
**File**: `scripts/run-e2e.sh`
**Priority**: MEDIUM

**Problem**: Lines 170-176 use `docker compose ps --format json | jq -r 'select(...)'` which works for NDJSON output but silently produces wrong results if Docker Compose v2.24+ emits a JSON array instead.

**Solution**: Add `jq -s '.[]'` normalization to handle both NDJSON and array formats.

**Implementation**:

1. Update both `unhealthy` and `all_running` commands (lines 170-176):
   ```bash
   unhealthy=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
     | jq -s '.[] | select(.Health != "healthy" and .Health != "") | .Name' 2>/dev/null \
     | wc -l)

   all_running=$(docker compose -f "$COMPOSE_FILE" ps --format json 2>/dev/null \
     | jq -s '.[] | select(.State == "running") | .Name' 2>/dev/null \
     | wc -l)
   ```

2. Add a comment explaining the `jq -s` normalization:
   ```bash
   # NOTE: Docker Compose v2 --format json output varies by version:
   #   v2.20-v2.23: NDJSON (one JSON object per line)
   #   v2.24+: may emit a JSON array
   # The -s (slurp) flag normalizes both formats into a consistent stream.
   ```

**Acceptance Criteria**:
- AC-1.4.1: Both `unhealthy` and `all_running` use `jq -s '.[] | select(...)'`
- AC-1.4.2: Comment documents the NDJSON vs array format difference
- AC-1.4.3: Health check works correctly with both Docker Compose v2.20 and v2.24+ output formats
- AC-1.4.4: No functional change when Docker Compose emits NDJSON (backward compatible)

---

### Task 1.5: Sprint 1 Goal Check

**ID**: arrakis-r9-gc1
**Priority**: HIGH

- Verify `scripts/run-e2e.sh --help` still works (no syntax errors introduced)
- Verify `bash -n scripts/run-e2e.sh` passes (syntax validation)
- Verify `bash -n scripts/validate-deployment.sh` passes
- Verify `tests/e2e/e2e-entrypoint.sh` has valid sh syntax
- Review SHA verification logic covers both checkout paths
- Review cleanup() shreds keys before Docker teardown
- Review JWKS write is atomic (tmp + mv pattern)
- Review jq -s normalization on both health poll commands

---

## Sprint 2: Operational Polish & Consistency (Global ID: 215)

**Goal**: Add TLS certificate check for staging deployments, fix timer precision disclosure, migrate JWT signer to ESM, and update compatibility matrix to content-addressable references.

### Task 2.1: TLS Certificate Expiry Check (R9-5)

**ID**: arrakis-r9-5
**File**: `scripts/validate-deployment.sh`
**Priority**: MEDIUM

**Problem**: For HTTPS URLs (staging/production), the deployment validator doesn't check TLS certificate expiry. A certificate expiring in 2 days passes validation silently.

**Solution**: Add a conditional TLS certificate check after the health endpoint check, only when the URL is HTTPS. Use `openssl s_client` to inspect the certificate and WARN if expiry is within 7 days. Gate on `command -v openssl` to avoid hard failures.

**Implementation**:

1. Note: `validate-deployment.sh` uses `#!/usr/bin/env bash` and `[[ ]]` already (line 32). All new conditionals should use POSIX `[ ]` where possible for robustness, but `case` statement is preferred for the HTTPS prefix check to be fully POSIX-compatible.

2. After the health endpoint check (line 152), add a TLS check block:
   ```bash
   # Check 1b: TLS certificate expiry (HTTPS only)
   case "$URL" in
     https://*)
       if ! command -v openssl > /dev/null 2>&1; then
         check_warn "TLS certificate" "0" "openssl not found — skipping certificate check"
       else
         start=$(timer_ms)
         host="${URL#https://}"
         host="${host%%/*}"  # Strip path
         port=443
         case "$host" in
           *:*) port="${host##*:}"; host="${host%%:*}" ;;
         esac
         cert_expiry=$(echo | openssl s_client -connect "${host}:${port}" -servername "${host}" 2>/dev/null \
           | openssl x509 -noout -enddate 2>/dev/null \
           | cut -d= -f2)
         elapsed=$(( $(timer_ms) - start ))
         if [ -n "$cert_expiry" ]; then
           expiry_epoch=$(date -d "$cert_expiry" +%s 2>/dev/null || date -jf "%b %d %T %Y %Z" "$cert_expiry" +%s 2>/dev/null || echo 0)
           if [ "$expiry_epoch" -gt 0 ]; then
             days_remaining=$(( (expiry_epoch - $(date +%s)) / 86400 ))
             if [ "$days_remaining" -lt 7 ]; then
               check_warn "TLS certificate" "$elapsed" "expires in ${days_remaining} days ($cert_expiry)"
             else
               check_pass "TLS certificate (expires in ${days_remaining} days)" "$elapsed"
             fi
           else
             check_warn "TLS certificate" "$elapsed" "could not parse expiry date"
           fi
         else
           check_warn "TLS certificate" "$elapsed" "could not retrieve certificate"
         fi
       fi
       ;;
   esac
   ```

3. The `command -v openssl` gate ensures missing openssl emits WARN and skips (never crashes under `set -e`).

**Acceptance Criteria**:
- AC-2.1.1: TLS check only runs for `https://` URLs (skipped for `http://` via `case` guard)
- AC-2.1.2: WARN when certificate expires within 7 days
- AC-2.1.3: PASS when certificate has >7 days remaining (shows days in output)
- AC-2.1.4: Missing `openssl` emits WARN and skips (tested: `PATH= bash validate-deployment.sh --url https://...` should not crash)
- AC-2.1.5: Handles URLs with custom ports (e.g., `https://host:8443/`)
- AC-2.1.6: No `[[ ]]` bashisms in TLS check block (uses `case` and `[ ]` for portability)

---

### Task 2.2: Timer Precision Disclosure (R9-6)

**ID**: arrakis-r9-6
**File**: `scripts/validate-deployment.sh`
**Priority**: LOW

**Problem**: Lines 108-115: `timer_ms()` falls back to `$(date +%s) * 1000` when `EPOCHREALTIME` isn't available, producing 1-second resolution labeled as milliseconds. A 200ms check shows `0ms`.

**Solution**: Add a precision notice when the fallback is used, and try `date +%s%N` as an intermediate fallback (available on GNU date).

**Implementation**:

1. Update `timer_ms()` with three-tier fallback:
   ```bash
   timer_ms() {
     if [ -n "${EPOCHREALTIME:-}" ]; then
       # Bash 5+ — true millisecond precision
       echo "${EPOCHREALTIME/./}" | cut -c1-13
     elif date +%s%N > /dev/null 2>&1; then
       # GNU date — nanosecond precision, truncate to ms
       echo "$(( $(date +%s%N) / 1000000 ))"
     else
       # POSIX fallback — second precision (±1000ms)
       echo "$(($(date +%s) * 1000))"
     fi
   }
   ```

2. Add a one-time precision notice at the start of validation:
   ```bash
   if [ -z "${EPOCHREALTIME:-}" ]; then
     if ! date +%s%N > /dev/null 2>&1; then
       echo "  NOTE  Timing precision: ±1000ms (upgrade to bash 5+ for millisecond precision)"
     fi
   fi
   ```

**Acceptance Criteria**:
- AC-2.2.1: Three-tier timer fallback: EPOCHREALTIME > date %s%N > date %s
- AC-2.2.2: Precision notice logged when using lowest-precision fallback
- AC-2.2.3: No functional change for environments with EPOCHREALTIME
- AC-2.2.4: `date +%s%N` fallback produces correct millisecond values

---

### Task 2.3: Migrate sign-test-jwt.js to ESM (R9-7)

**ID**: arrakis-r9-7
**File**: `scripts/sign-test-jwt.js`
**Priority**: LOW

**Problem**: Uses CommonJS `require()` while the rest of the codebase is ESM/TypeScript. Not a bug, but a consistency smell.

**Solution**: Convert to ESM with `import` statements. Since this is a standalone script, rename to `.mjs` to enable ESM without affecting the root package.json.

**Implementation**:

1. Rename `scripts/sign-test-jwt.js` to `scripts/sign-test-jwt.mjs`

2. Convert to ESM:
   ```javascript
   #!/usr/bin/env node
   /**
    * sign-test-jwt.mjs — Sign a test JWT for deployment validation.
    * ...
    */
   import { importPKCS8, SignJWT } from 'jose';
   import { readFileSync } from 'node:fs';
   import { randomUUID } from 'node:crypto';

   // ... rest of implementation with ESM syntax
   ```

3. Update callers:
   - `scripts/validate-deployment.sh` line 199: change `sign-test-jwt.js` to `sign-test-jwt.mjs`

**Acceptance Criteria**:
- AC-2.3.1: Script uses ESM `import` syntax
- AC-2.3.2: File renamed to `.mjs` extension
- AC-2.3.3: All callers updated to reference new filename
- AC-2.3.4: `node scripts/sign-test-jwt.mjs <key>` produces valid JWT
- AC-2.3.5: `node scripts/sign-test-jwt.mjs` (no args) exits with code 2 and usage message

---

### Task 2.4: Update Compatibility Matrix to Content-Addressable References (R9-8)

**ID**: arrakis-r9-8
**File**: `tests/e2e/contracts/compatibility.json`
**Priority**: LOW

**Problem**: References `>=PR#52` and `>=PR#53 (pending)` — PR #53 is closed, and PR numbers are mutable workflow references, not code-history references.

**Solution**: Update to content-addressable references (commit SHAs resolved from git, not hardcoded).

**Implementation**:

1. **Resolve the correct reference from git** before editing the file:
   ```bash
   # Find the merge commit for PR #55 (The Capability Mesh) which is the latest
   # merge that includes the contract package on main
   merge_sha=$(git log --oneline --merges --grep="#55" origin/main | head -1 | cut -d' ' -f1)
   full_sha=$(git rev-parse "$merge_sha")
   # Verify the SHA exists
   git cat-file -e "${full_sha}^{commit}" || echo "ERROR: SHA not found"
   # Check for a version tag
   git tag --contains "$full_sha" | head -5
   ```

2. Update `compatibility.json` using the resolved references:
   ```json
   {
     "contract_version": "1.0.0",
     "compatibility": [
       {
         "arrakis": ">=<resolved_tag_or_sha>",
         "loa_finn": "pending (see RFC #31 Gate 12)",
         "contract": "1.0.0",
         "notes": "Initial contract — pool claims, ensemble, BYOK, streaming"
       }
     ],
     "breaking_changes": [],
     "deprecations": []
   }
   ```
   Use full 40-char SHA if no annotated tag exists. Prefer `>=v1.33.0` if the tag resolves correctly via `git show-ref --tags v1.33.0`.

3. Update `tests/e2e/contracts/README.md` compatibility matrix example to use version tags instead of PR numbers.

**Acceptance Criteria**:
- AC-2.4.1: No PR number references in `compatibility.json`
- AC-2.4.2: arrakis version references a verifiable commit SHA or release tag resolved from `git` (not hardcoded). Verified by `git cat-file -e <sha>^{commit}` or `git show-ref --tags <tag>`
- AC-2.4.3: loa-finn version references RFC #31 Gate 12 (deferred)
- AC-2.4.4: README example updated to show version tag format
- AC-2.4.5: `compatibility.json` is valid JSON (`jq . compatibility.json` succeeds)

---

### Task 2.5: Sprint 2 Goal Check

**ID**: arrakis-r9-gc2
**Priority**: HIGH

- Verify `bash -n scripts/validate-deployment.sh` passes
- Verify `node scripts/sign-test-jwt.mjs` exits 2 with usage message (no key arg)
- Verify `jq . tests/e2e/contracts/compatibility.json` succeeds (valid JSON)
- Verify no PR number references remain in `compatibility.json`
- Verify TLS check is conditional on HTTPS URL prefix
- Verify timer precision fallback chain works
- Run `scripts/validate-deployment.sh --help` to confirm no regressions

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `jq` not available in E2E Docker image | Medium | High | Check alpine base includes jq, add to Dockerfile if not |
| `date +%s%N` not available on macOS | Medium | Low | Three-tier fallback handles this gracefully |
| `.mjs` rename breaks existing CI references | Low | Medium | Search for all `sign-test-jwt.js` references before rename |
| TLS check fails on self-signed staging certs | Medium | Low | Use WARN (not FAIL) for certificate issues |

## Dependencies

- Sprint 2 is independent of Sprint 1 (no code dependencies between tasks)
- Task 1.3 (atomic JWKS) requires confirming `jq` is in the E2E Docker image
- Task 2.3 (ESM migration) requires updating `validate-deployment.sh` caller reference
- Task 2.4 (compat matrix) requires knowing the arrakis release tag (v1.33.0 = PR #55 merge commit f93c1e8)
