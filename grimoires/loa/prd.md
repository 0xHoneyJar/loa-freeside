# PRD: Community Feedback — Review Pipeline Hardening

**Cycle**: cycle-048
**Created**: 2026-02-28
**Sources**: Issues #425, #426, #427, #430 (community feedback from zkSoju, gumibera)
**Flatline Review**: Passed — 8 HIGH_CONSENSUS findings integrated, 0 BLOCKERS

## 1. Problem Statement

The Loa review pipeline has several reliability gaps discovered during real-world usage across loa-constructs (v2.8.0), loa-finn, loa-hounfour, loa-freeside, and loa-dixie. These range from parsing failures that block the review loop (#427.1), to stale state propagation that silently skips quality gates (#430), to a YAML parser bug that disables the Bridgebuilder (#425). Each individually causes friction; together they undermine confidence in the review pipeline as a whole.

> Sources: #427 (zkSoju, loa-constructs cycle-036), #426 (zkSoju), #425 (zkSoju), #430 (gumibera, simstim cycle-018)

## 2. Goals & Success Criteria

| Goal | Metric | Source |
|------|--------|--------|
| GPT review loop completes without false-negative exit codes | All verdict check sites handle both `.verdict` and `.overall_verdict` | #427.1 |
| Bridgebuilder config parsing works regardless of YAML section ordering | Regex uses `[ \t]+` not `\s+` for section capture | #425 |
| Flatline readiness validated fresh per cycle | `flatline-readiness.sh` checks all configured providers (incl. Gemini) | #430 |
| 401 errors surface actual API error message | `lib-curl-fallback.sh` extracts `.error.message` from response body | #426 |
| Cross-platform `timeout` usage documented and portable | Canonical `run_with_timeout()` in compat-lib.sh, existing ad-hoc implementations migrated | #427.2 |
| Curl config injection guard standardized | API key validated before writing curl config; all existing sites migrated | #427.4 |

## 3. User Context

**Primary persona**: Loa operator running multi-model review pipelines (simstim, run-bridge, gpt-review) across macOS and Linux.

**Pain points** (from feedback):
- "Agent carried stale skip decisions without verification" (#430)
- "Useful approvals that the parser rejected" (#427.1)
- "Observe 'disabled' error despite `enabled: true` being set" (#425)
- "Had to curl API directly to see 'Incorrect API key' error" (#426)

## 4. Functional Requirements

### FR-1: GPT Verdict Parsing Resilience (#427.1)

**Problem**: The review pipeline checks `.verdict` in multiple locations across the codebase. GPT 5.3-codex returns `.overall_verdict` on re-review iterations, causing exit code 5 (format error). The PRD originally identified only `gpt-review-api.sh` lines 116 and 131, but Flatline review found `.verdict`-only checks in at least 7 locations across 4+ files.

**Affected files** (Flatline-identified):
- `gpt-review-api.sh` lines 116, 131 — legacy codex path
- `lib-curl-fallback.sh` line 318 — terminal verdict validation in `call_api()`
- `lib-route-table.sh` lines 202, 581 — declarative route table validation
- `lib/normalize-json.sh` line 250 — `validate_agent_response()` schema check
- Existing BATS tests in `test-gpt-review-integration.bats` — `.verdict`-only assertions

**Fix**:
- Create centralized `extract_verdict()` helper in `lib/normalize-json.sh`: `jq -r '.verdict // .overall_verdict // "UNKNOWN"'`
- Apply normalization early in the response pipeline (before any validation)
- Update all call sites to use the centralized helper
- Update existing test assertions to use the normalized pattern

**Acceptance criteria**:
- GPT review completes when response contains `.overall_verdict` instead of `.verdict`
- Existing `.verdict` responses continue to work unchanged
- All verdict check sites (7+) use centralized `extract_verdict()`
- BATS test covers both field names through the `call_api()`, `validate_review_result()`, and `validate_agent_response()` paths
- Existing `test-gpt-review-integration.bats` assertions updated

**Implementation order**: Implement AFTER FR-4 (both modify `lib-curl-fallback.sh`)

### FR-2: Bridgebuilder YAML Parser Fix (#425)

**Problem**: `config.ts` line 189 regex `/^bridgebuilder:\s*\n((?:\s+.+\n?)*)/m` uses `\s+` which matches newlines, causing capture to bleed through all subsequent YAML sections. Last `enabled: false` from any later section overwrites bridgebuilder's `enabled: true`.

**Context** (Flatline-clarified): The upstream Loa repo's `.loa.config.yaml` has no top-level `bridgebuilder:` section — it has `bridgebuilder_design_review:` and `run_bridge.bridgebuilder:`. The bug manifests in downstream repos (loa-constructs, loa-finn, etc.) that DO have standalone `bridgebuilder:` sections. The regex's `^` in multiline mode matches any line start, so it could also false-match `bridgebuilder_design_review:` as a prefix. The existing `config.test.ts` tests bypass `loadYamlConfig()` entirely (passing yamlConfig directly to `resolveConfig()`), so they don't exercise the regex.

**Fix**:
- Replace `\s+` with `[ \t]+` in the inner capture group
- Updated regex: `/^bridgebuilder:\s*\n((?:[ \t]+.+\n?)*)/m`
- Verify regex does NOT match `bridgebuilder_design_review:` (prefix false positive)
- Rebuild TypeScript → dist/

**Acceptance criteria**:
- Bridgebuilder reads `enabled: true` correctly regardless of section ordering in `.loa.config.yaml`
- Existing config.test.ts passes
- New test exercises `loadYamlConfig()` directly (not just `resolveConfig()` with injected config)
- New test: config with `bridgebuilder:` before `red_team:` (which has `enabled: false`) parses correctly
- New test: config with `bridgebuilder_design_review:` is NOT captured by `bridgebuilder:` regex
- Built dist/ output committed and matches TypeScript source (`npm run build && git diff --exit-code dist/`)

### FR-3: Flatline Readiness — 3-Model Validation (#430)

**Problem**: Simstim Phase 0 doesn't validate Flatline readiness. Agents inherit stale skip decisions from previous cycles. PR #431 adds a readiness check but only validates 2 of 3 configured providers.

**This is a NEW FILE** (Flatline-clarified): `flatline-readiness.sh` does not exist in the repository. This is greenfield implementation, not a patch. Scope estimation should account for writing the full script from scratch.

**Fix** (supersedes PR #431):
- Create `.claude/scripts/flatline-readiness.sh` (new file)
- Reads configured models from `.loa.config.yaml` (primary, secondary, tertiary)
- Maps models to API key env vars:
  - `opus` / `claude-*` → `ANTHROPIC_API_KEY`
  - `gpt-*` → `OPENAI_API_KEY`
  - `gemini-*` → `GOOGLE_API_KEY` (canonical) with `GEMINI_API_KEY` as accepted alias + deprecation warning
- Reports status based on provider availability:
  - `READY` (exit 0): All configured provider keys present
  - `DISABLED` (exit 1): `flatline_protocol.enabled` is false or absent
  - `NO_API_KEYS` (exit 2): Zero provider keys present
  - `DEGRADED` (exit 3): 1+ but not all provider keys present
- Integration into `simstim-orchestrator.sh` preflight (from PR #431)
- SKILL.md updated with fresh-per-cycle validation warning
- Mirrors `beads-health.sh` pattern (same exit codes, flags, PROJECT_ROOT override)

**Output schema** (`--json`):
```json
{
  "status": "READY|DEGRADED|NO_API_KEYS|DISABLED",
  "providers": {
    "anthropic": { "configured": true, "available": true },
    "openai": { "configured": true, "available": true },
    "google": { "configured": true, "available": true, "env_var": "GOOGLE_API_KEY" }
  },
  "recommendations": ["..."]
}
```

**Acceptance criteria**:
- `flatline-readiness.sh --json` reports correct status for all provider combinations
- Gemini availability checked when `flatline_protocol.models.tertiary` is configured
- Both `GOOGLE_API_KEY` and `GEMINI_API_KEY` accepted; `GEMINI_API_KEY` triggers deprecation warning
- `tests/unit/flatline-readiness.bats` covers READY, DEGRADED, NO_API_KEYS, DISABLED
- Simstim preflight logs Flatline status to trajectory

### FR-4: API Error Message Surfacing (#426)

**Problem**: `lib-curl-fallback.sh` 401 handler (lines 255-257) prints generic "Authentication failed" for 401 errors. The actual API error message (e.g., "Incorrect API key provided") is discarded.

**Fix**:
- Extract `.error.message` from response body via `jq -r '.error.message // empty' 2>/dev/null`
- Pass extracted message through `redact_secrets()` before display (prevents API key fragment leakage)
- Show both: specific error first, generic fallback second
- Handle non-JSON error bodies gracefully (HTML from proxies/CDNs, empty bodies, JSON without `.error` key)

**Note**: `.env` sourcing is intentionally NOT supported (SKP-003 security decision — env-only auth prevents credential file exposure). This is documented behavior, not a bug.

**Scope note**: This FR covers the direct curl path in `call_api()` only. The model-invoke path (`call_api_via_model_invoke()`) also swallows errors but is a separate concern for a future cycle.

**Acceptance criteria**:
- 401 responses show the API provider's error message (after secret redaction)
- Non-JSON error bodies (HTML, empty, malformed) fall back gracefully to generic message
- Error messages passed through `redact_secrets()` before display
- BATS test verifies error extraction for: valid JSON error, HTML body, empty body, JSON without `.error`

**Implementation order**: Implement BEFORE FR-1 (both modify `lib-curl-fallback.sh`)

### FR-5: Cross-Platform `timeout` Helper (#427.2)

**Problem**: `timeout` command doesn't exist on stock macOS. Scripts use ad-hoc fallback chains. At least 2 incompatible `run_with_timeout()` implementations already exist (`post-pr-orchestrator.sh` line 105, `post-pr-e2e.sh` line 103), plus a bare `timeout` call in `golden-path.sh` line 403.

**Fix**:
- Add canonical `run_with_timeout()` to `.claude/scripts/compat-lib.sh`
- Fallback chain: `timeout` → `gtimeout` → `perl -e 'alarm(N); exec @ARGV'` → warn and run without timeout
- Runtime detection (not cached at source time) to support test PATH manipulation
- Migrate existing implementations:
  - `post-pr-orchestrator.sh` line 105 → use `compat-lib.sh` helper
  - `post-pr-e2e.sh` line 103 → use `compat-lib.sh` helper (preserve security allowlist logic separately)
  - `golden-path.sh` line 403 → use `compat-lib.sh` helper
- Document in `.claude/protocols/cross-platform-shell.md`
- CI lint (`shell-compat-lint.yml`) should flag bare `timeout` usage

**Acceptance criteria**:
- `run_with_timeout 10 sleep 20` terminates after 10s on both macOS and Linux
- Function exists in compat-lib.sh with runtime detection (not cached)
- Existing ad-hoc implementations (3 sites) migrated to canonical helper
- BATS test covers all fallback paths using PATH manipulation to simulate each scenario
- CI lint rule flags bare `timeout` command usage
- Protocol doc updated

### FR-6: Curl Config Injection Guard (#427.4)

**Problem**: SHELL-002 documents curl config files for API key protection but doesn't warn about CR/LF injection in key values.

**Affected curl config sites** (Flatline-identified):
- `lib-curl-fallback.sh` lines 211-215
- `constructs-auth.sh` lines 156-159
- `constructs-browse.sh` lines 117-120, 179-182

**Fix**:
- Add `write_curl_auth_config()` helper to `lib-security.sh`
- Returns path to config file (enforces `mktemp` + `chmod 600` centrally)
- Validates key contents: rejects `\r`, `\n`, `\0`, `\` (backslash); escapes `"` in curl config output
- Uses `printf` not `echo` for config file writing
- Migrate all existing curl config creation sites to use the new helper
- Document pattern in SHELL-002 section of cross-platform protocol

**Acceptance criteria**:
- Keys containing CR/LF/null/backslash are rejected with clear error message
- Keys with quotes are properly escaped in curl config output
- Valid keys (including base64 characters `+`, `/`, `=`) write correct curl config
- All existing curl config sites (3 files, 4 locations) migrated to `write_curl_auth_config()`
- CI grep check for raw `printf.*Authorization.*Bearer` patterns prevents regression
- BATS test covers injection vectors and valid key edge cases

## 5. Technical & Non-Functional

- **System Zone authorization**: All target files are in `.claude/scripts/` and `.claude/skills/` (System Zone). These are framework-internal fixes to the review pipeline itself, requiring authorized System Zone writes for this cycle. Safety hooks (`team-role-guard-write.sh`) must be accounted for in Agent Teams mode.
- All fixes must include BATS tests (Shell Tests CI now functional after #434)
- TypeScript changes (FR-2) must rebuild dist/ and pass existing tests
- No new runtime dependencies
- Cross-platform: all changes must work on macOS (Darwin) and Linux (Ubuntu CI)
- Pre-existing BATS test failures (271): New tests should be runnable in isolation (`bats tests/unit/<specific-file>.bats`) to avoid interference
- FR-4 must be implemented before FR-1 (both modify `lib-curl-fallback.sh` in adjacent code paths)
- Integration test: A single BATS test should exercise FR-1 (verdict normalization) + FR-4 (error surfacing) + FR-6 (curl config guard) in a single review pipeline pass

## 6. Scope

### In scope
- FR-1 through FR-6 as described above
- Migration of existing ad-hoc implementations to centralized helpers (FR-5, FR-6)

### Out of scope
- Deployment platform awareness for `/bug` triage (#426 enhancement suggestion) — future cycle
- `.env` file sourcing for API keys — intentional security decision (SKP-003)
- Shell Tests 271 pre-existing test failures — separate tech debt issue
- Model-invoke path error surfacing (`call_api_via_model_invoke()`) — future cycle
- Full YAML parser replacement for config.ts — the regex fix is sufficient for the reported bug

## 7. Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| PR #431 conflicts with FR-3 | Close #431, implement fresh from this PRD |
| TypeScript rebuild for FR-2 may produce merge conflicts with concurrent TS PRs | Merge quickly after building; verify deterministic build output |
| `GOOGLE_API_KEY` vs `GEMINI_API_KEY` naming inconsistency | **Resolved**: `GOOGLE_API_KEY` is canonical (per cheval.py, google_adapter.py); `GEMINI_API_KEY` accepted as alias with deprecation warning |
| Curl injection guard may break existing key formats | Use allowlist for known-safe characters; reject only definite injection vectors |
| FR-1 + FR-4 touch adjacent code in `lib-curl-fallback.sh` | Implement FR-4 first, FR-1 second; shared integration test verifies no interaction bugs |
| All FRs require System Zone writes | Framework-internal fixes authorized for cycle-048; safety hooks accounted for |
| 271 pre-existing BATS failures may mask new test results | Run new tests in isolation first, then verify in full suite |

## 8. Issue References

| Issue | Status | Disposition |
|-------|--------|-------------|
| #421 | Closed | Fixed by #434 (gpt-5.3-codex default) |
| #425 | Open | FR-2 |
| #426 | Open | FR-4 (error surfacing); .env sourcing is by-design; deployment context is future |
| #427 | Open | FR-1 (verdict), FR-5 (timeout), FR-6 (curl guard); finding 3 fixed by #434 |
| #430 | Open | FR-3 (supersedes PR #431) |

## 9. Flatline Review Log

**Phase**: PRD review (cycle-048 Phase 2)
**Reviewers**: Opus (reviewer) + Opus (skeptic)
**Findings**: 16 reviewer + 16 skeptic = 32 total
**HIGH_CONSENSUS**: 8 findings integrated (FR-1 scope expansion, FR-2 context clarification, FR-3 greenfield reframe, FR-4 redaction + non-JSON handling, FR-5 migration scope, FR-6 migration checklist, System Zone authorization, implementation sequencing)
**DISPUTED**: 1 (GOOGLE_API_KEY resolution — resolved by checking both, integrated)
**PRAISE**: 2 (scope discipline, centralization approach)
**BLOCKERS**: 0
