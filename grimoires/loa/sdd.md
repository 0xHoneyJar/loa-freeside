# SDD: Community Feedback — Review Pipeline Hardening

**Cycle**: cycle-048
**PRD**: grimoires/loa/prd.md
**Created**: 2026-02-28
**Flatline Review**: Passed — 5 HIGH findings integrated, 0 BLOCKERS

## 1. Architecture Overview

Six targeted fixes to the review pipeline, all in the `.claude/scripts/` System Zone (authorized for this cycle per PRD Section 5). The fixes share a common pattern: centralize logic that is currently duplicated across call sites, then migrate all sites to the centralized helper.

**Implementation order** (dependency-driven):
1. FR-6 (curl config guard) — no dependencies, used by FR-4
2. FR-4 (error surfacing) — uses FR-6's `write_curl_auth_config()`
3. FR-1 (verdict parsing) — modifies same file as FR-4, must follow
4. FR-3 (flatline readiness) — independent, can parallel with FR-1
5. FR-5 (timeout helper) — independent, can parallel with FR-1
6. FR-2 (YAML regex) — TypeScript, isolated from shell changes

## 2. Detailed Design

### 2.1 FR-1: Centralized Verdict Extraction

**Design decision**: Create `extract_verdict()` in `lib/normalize-json.sh` as a single normalization point, rather than patching 7+ individual call sites with fallback logic.

**New function** in `.claude/scripts/lib/normalize-json.sh`:

```bash
# extract_verdict — Resilient verdict extraction with field fallback
# Returns: verdict string on stdout, exit 0 on success, exit 1 on missing
# Usage: verdict=$(echo "$json" | extract_verdict)
extract_verdict() {
  local json="${1:-$(cat)}"
  local verdict
  verdict=$(echo "$json" | jq -r '.verdict // .overall_verdict // empty' 2>/dev/null)
  if [[ -z "$verdict" ]]; then
    return 1
  fi
  echo "$verdict"
}
```

**Call sites to migrate** (11 implementation + 22 test locations):

| File | Lines | Current Pattern | Migration |
|------|-------|-----------------|-----------|
| `gpt-review-api.sh` | 116, 131 | `jq -e '.verdict'` | `extract_verdict` existence check |
| `lib-curl-fallback.sh` | 318 | `jq -r '.verdict // empty'` | `extract_verdict` |
| `lib-route-table.sh` | 202, 581 | `jq -e '.verdict'`, `jq -r '.verdict // empty'` | `extract_verdict` |
| `lib/normalize-json.sh` | 250 | `jq -r '.verdict // ""'` | `extract_verdict` (self-use) |
| `post-pr-audit.sh` | 370, 491 | `jq -r '.verdict' "$file"` (file-based, no fallback) | `extract_verdict < "$file"` |
| `cache-manager.sh` | 580-581 | `jq -e '.verdict'` + `jq -r '.verdict // "stored"'` | `extract_verdict` with "stored" default |
| `condense.sh` | 217, 352 | `jq -r '.verdict // .status // .result // "UNKNOWN"'` | Already resilient — leave as-is |

**condense.sh exception**: Lines 217 and 352 already use triple-fallback (`.verdict // .status // .result // "UNKNOWN"`). These are in the condensation pipeline where any status value suffices. No change needed.

**Test updates**: 22 locations across 3 test files (`test-gpt-review-integration.bats`, `test-gpt-review-codex-adapter.bats`, `test-gpt-review-multipass.bats`) use `.verdict` in assertions. These should test with both `.verdict` and `.overall_verdict` response shapes.

**New test file**: `tests/unit/extract-verdict.bats`
- Test `.verdict` present → returns verdict
- Test `.overall_verdict` present → returns overall_verdict
- Test both present → `.verdict` takes precedence
- Test neither present → exit 1
- Test null verdict → exit 1
- Test enum validation downstream (APPROVED, CHANGES_REQUIRED, DECISION_NEEDED, SKIPPED)

### 2.2 FR-2: Bridgebuilder YAML Regex Fix

**Target**: `.claude/skills/bridgebuilder-review/resources/config.ts` line 189

**Current regex**:
```regex
/^bridgebuilder:\s*\n((?:\s+.+\n?)*)/m
```

**Fixed regex**:
```regex
/^bridgebuilder:\s*\n((?:[ \t]+.+\n?)*)/m
```

**Design notes**:
- The `\s+` in the inner capture group matches `\n`, causing the capture to bleed past the `bridgebuilder:` section into subsequent sections. `[ \t]+` restricts to horizontal whitespace only.
- The `^` anchor with multiline flag matches any line start. `bridgebuilder_design_review:` would NOT match because the regex requires exactly `bridgebuilder:` followed by optional whitespace and newline — `bridgebuilder_design_review:` has additional characters before the colon.
- **dist/ is tracked in git** (not gitignored). After the TypeScript change, run `npm run build` and commit the updated dist/ output. Verify with `git diff --exit-code dist/`.
- Existing `config.test.ts` tests bypass `loadYamlConfig()` entirely (pass yamlConfig directly to `resolveConfig()`), so they don't exercise the regex.

**Test strategy**: Add tests to `config.test.ts` that exercise `loadYamlConfig()` directly:
1. Create temp YAML file with `bridgebuilder:` before `red_team:` (which has `enabled: false`)
2. Verify `loadYamlConfig()` returns `{ enabled: true }` for bridgebuilder
3. Verify `bridgebuilder_design_review:` is NOT captured as a `bridgebuilder:` match
4. Verify section ordering independence (bridgebuilder after red_team)

### 2.3 FR-3: Flatline Readiness Script

**New file**: `.claude/scripts/flatline-readiness.sh`

**Interface** (mirrors `beads-health.sh`):

```
Usage: flatline-readiness.sh [--json] [--quick]
Exit codes:
  0 = READY       (all configured providers available)
  1 = DISABLED    (flatline_protocol.enabled is false)
  2 = NO_API_KEYS (zero provider keys present)
  3 = DEGRADED    (some but not all provider keys present)
```

**Provider mapping logic**:

```bash
# Map model names to provider + env var
map_model_to_provider() {
  local model="$1"
  case "$model" in
    opus|claude-*|anthropic-*)
      echo "anthropic:ANTHROPIC_API_KEY" ;;
    gpt-*|openai-*)
      echo "openai:OPENAI_API_KEY" ;;
    gemini-*|google-*)
      # GOOGLE_API_KEY is canonical (per cheval.py, google_adapter.py)
      # GEMINI_API_KEY accepted as alias with deprecation warning
      echo "google:GOOGLE_API_KEY:GEMINI_API_KEY" ;;
    *)
      echo "unknown:" ;;
  esac
}
```

**Config reading**: Uses `yq` to extract `flatline_protocol.models.{primary,secondary,tertiary}` from `.loa.config.yaml`.

**JSON output schema**:
```json
{
  "status": "READY",
  "exit_code": 0,
  "providers": {
    "anthropic": { "configured": true, "available": true, "env_var": "ANTHROPIC_API_KEY" },
    "openai": { "configured": true, "available": true, "env_var": "OPENAI_API_KEY" },
    "google": { "configured": true, "available": true, "env_var": "GOOGLE_API_KEY" }
  },
  "models": {
    "primary": "opus",
    "secondary": "gpt-5.3-codex",
    "tertiary": "gemini-2.5-pro"
  },
  "recommendations": [],
  "timestamp": "2026-02-28T09:00:00Z"
}
```

**GEMINI_API_KEY alias handling**: If `GOOGLE_API_KEY` is unset but `GEMINI_API_KEY` is set, use it with a stderr warning: `"WARNING: GEMINI_API_KEY is deprecated, use GOOGLE_API_KEY"`.

**Integration point**: Called from simstim Phase 0 preflight. Status logged to trajectory. DEGRADED triggers a warning but does not block the workflow (operator decides).

**Test file**: `tests/unit/flatline-readiness.bats`
- DISABLED: `flatline_protocol.enabled: false` → exit 1
- NO_API_KEYS: all keys unset → exit 2
- DEGRADED: only ANTHROPIC_API_KEY set → exit 3
- READY: all 3 keys set → exit 0
- GEMINI_API_KEY alias: only GEMINI_API_KEY set for google → exit 0 with deprecation warning
- `--json` output structure validation
- `PROJECT_ROOT` override for test isolation

### 2.4 FR-4: API Error Message Surfacing

**Target**: `.claude/scripts/lib-curl-fallback.sh` lines 255-257

**Current code** (401 handler in `call_api()`):
```bash
401)
  echo "ERROR: Authentication failed - check OPENAI_API_KEY" >&2
  return 4
  ;;
```

**Updated code**:
```bash
401)
  # Extract provider error message if available
  local api_error=""
  if [[ -n "$response" ]]; then
    api_error=$(echo "$response" | jq -r '.error.message // empty' 2>/dev/null)
    # Redact potential key fragments before display
    # Note: redact_log_output() takes positional arg, not stdin (Flatline fix)
    if [[ -n "$api_error" ]]; then
      api_error=$(redact_log_output "$api_error")
    fi
  fi
  if [[ -n "$api_error" ]]; then
    echo "ERROR: API authentication failed: $api_error" >&2
  else
    echo "ERROR: Authentication failed - check API key for provider" >&2
  fi
  return 4
  ;;
```

**Dependencies**: `redact_log_output()` from `lib-security.sh` (already sourced in the call chain).

**Edge cases**:
- HTML response body (proxy/CDN 401) → `jq` returns empty, falls through to generic message
- Empty response body → `$response` is empty, skips extraction
- JSON without `.error` key → `jq` returns empty, falls through
- `.error.message` contains key fragment → `redact_log_output()` catches it

**Scope boundary**: Only the direct curl path (`call_api()`). The model-invoke path (`call_api_via_model_invoke()`) is out of scope per PRD.

**Test**: `tests/unit/api-error-surfacing.bats`
- Mock 401 with JSON error body → shows API error message
- Mock 401 with HTML body → falls back to generic
- Mock 401 with empty body → falls back to generic
- Mock 401 with key fragment in error → redacted before display

### 2.5 FR-5: Canonical `run_with_timeout()`

**Target**: `.claude/scripts/compat-lib.sh`

**Existing implementations to consolidate**:
1. `post-pr-orchestrator.sh:104-133` — array-based, timeout/manual fallback
2. `post-pr-e2e.sh:103-142` — string-based with security allowlist
3. `golden-path.sh:403` — bare `timeout 2` with no fallback

**Canonical implementation**:

```bash
# run_with_timeout — Portable timeout execution
# Usage: run_with_timeout <seconds> <command> [args...]
# Exit codes: command's exit code, or 124 on timeout
# Fallback: timeout → gtimeout → perl alarm → run without timeout (with warning)
run_with_timeout() {
  local timeout_val="$1"
  shift

  # Runtime detection (not cached) to support test PATH manipulation
  if command -v timeout &>/dev/null; then
    timeout "$timeout_val" "$@"
  elif command -v gtimeout &>/dev/null; then
    gtimeout "$timeout_val" "$@"
  elif command -v perl &>/dev/null; then
    # Note: exec replaces process image, losing $SIG{ALRM} handler.
    # Use system() to fork+exec, preserving alarm handler in parent.
    perl -e '
      $SIG{ALRM} = sub { kill 9, $pid; exit 124 };
      alarm(shift @ARGV);
      $pid = fork();
      if ($pid == 0) { exec @ARGV; die "exec failed: $!" }
      waitpid($pid, 0);
      exit($? >> 8);
    ' "$timeout_val" "$@"
  else
    echo "WARNING: No timeout mechanism available, running without timeout" >&2
    "$@"
  fi
}
```

**Design decisions**:
- **Runtime detection** (not cached at source time) — differs from compat-lib.sh's existing pattern of caching at source time. This is intentional: tests need to manipulate PATH between calls.
- **Array-based** execution (`"$@"`) — safer than string interpolation, no injection risk.
- **Exit code 124** convention preserved (standard for GNU timeout).
- **perl alarm** as third fallback — uses fork+waitpid pattern (not bare `exec`) to preserve the `$SIG{ALRM}` handler. Bare `exec` replaces the process image, losing the signal handler and producing exit 142 instead of 124. _(Flatline SPR-11 fix)_
- **Security allowlist** from `post-pr-e2e.sh` is NOT included in the canonical version — that's a separate concern for the caller. The e2e file will keep its `validate_command()` call before invoking `run_with_timeout()`.

**Migration plan**:
1. Add `run_with_timeout()` to compat-lib.sh
2. `post-pr-orchestrator.sh`: replace local implementation with `source compat-lib.sh` + call
3. `post-pr-e2e.sh`: keep `validate_command()`, replace timeout logic with `run_with_timeout()`
4. `golden-path.sh:403`: replace bare `timeout 2` with `run_with_timeout 2`

**CI lint rule**: Add to `.github/workflows/shell-compat-lint.yml` (or existing CI) a check that flags bare `timeout` command usage outside of `run_with_timeout()`:
```bash
# Flag bare timeout usage in .sh files (excluding compat-lib.sh itself)
grep -rn 'timeout [0-9]' .claude/scripts/ --include='*.sh' | grep -v 'compat-lib.sh' | grep -v 'run_with_timeout' | grep -v '#'
```

**Test file**: `tests/unit/run-with-timeout.bats`
- PATH with `timeout` → uses timeout
- PATH without `timeout` but with `gtimeout` → uses gtimeout
- PATH without both but with `perl` → uses perl alarm
- PATH without all three → warns and runs without timeout
- Timeout fires correctly (command killed after N seconds)
- Non-timeout command completes with correct exit code

### 2.6 FR-6: Curl Config Injection Guard

**Target**: `.claude/scripts/lib-security.sh`

**New function**:

```bash
# write_curl_auth_config — Secure curl config file creation
# Usage: config_path=$(write_curl_auth_config "$api_key" ["$header_name"])
# Returns: path to temp file on stdout (caller must rm after use)
# Exit 1 with error message on invalid key
write_curl_auth_config() {
  local api_key="$1"
  local header_name="${2:-Authorization: Bearer}"

  # Validate key: reject injection vectors
  if [[ "$api_key" =~ [$'\r\n\0\\'] ]]; then
    echo "ERROR: API key contains invalid characters (CR/LF/null/backslash)" >&2
    return 1
  fi

  local config_path
  config_path=$(mktemp)
  chmod 600 "$config_path"

  # Use printf (not echo) to avoid -n/-e interpretation
  # Escape double quotes in key value
  local escaped_key="${api_key//\"/\\\"}"
  printf 'header = "%s %s"\n' "$header_name" "$escaped_key" > "$config_path"

  echo "$config_path"
}
```

**Call sites to migrate**:

| File | Lines | Current Pattern | Notes |
|------|-------|-----------------|-------|
| `lib-curl-fallback.sh` | 211-215 | `mktemp` + `chmod 600` + `printf` | Bearer auth |
| `constructs-auth.sh` | 156-159 | `mktemp` + `chmod 600` + `echo` | Bearer auth |
| `constructs-browse.sh` | 117-120, 179-182 | `mktemp` + `chmod 600` + `echo` | Bearer auth |

**Migration pattern**:
```bash
# Before (each site):
local curl_config=$(mktemp)
chmod 600 "$curl_config"
echo "header = \"Authorization: Bearer ${api_key}\"" > "$curl_config"

# After:
local curl_config
curl_config=$(write_curl_auth_config "$api_key") || return 1
```

**Content-Type headers**: Some sites also write `Content-Type` to the same config file. The helper returns the path, so callers can append additional headers:
```bash
curl_config=$(write_curl_auth_config "$api_key") || return 1
printf 'header = "Content-Type: application/json"\n' >> "$curl_config"
```

**CI regression check**: Add to CI a grep that flags raw curl config creation outside of `lib-security.sh`:
```bash
# Flag raw Authorization Bearer patterns in .sh files (excluding lib-security.sh)
grep -rn 'Authorization.*Bearer' .claude/scripts/ --include='*.sh' | grep -v 'lib-security.sh' | grep -v '#'
```

**Test file**: `tests/unit/curl-config-guard.bats`
- Valid key → correct curl config content
- Key with CR → rejected (exit 1)
- Key with LF → rejected (exit 1)
- Key with null byte → rejected (exit 1)
- Key with backslash → rejected (exit 1)
- Key with double quote → properly escaped
- Key with base64 chars (+, /, =) → accepted
- Config file permissions → 0600
- Config file path → starts with /tmp

## 3. Cross-Cutting Concerns

### 3.1 System Zone Authorization

All target files are in `.claude/scripts/` (System Zone). The PRD authorizes System Zone writes for this cycle. The safety hook `team-role-guard-write.sh` will need to be accounted for in Agent Teams mode — the team lead must perform these writes.

### 3.2 Test Isolation

Pre-existing 271 BATS failures may interfere. New tests should:
- Be runnable individually: `bats tests/unit/<specific-file>.bats`
- Not depend on test infrastructure from failing tests
- Use `PROJECT_ROOT` override for filesystem isolation

### 3.3 Integration Test

A single integration test (`tests/unit/review-pipeline-integration.bats`) should exercise FR-1 + FR-4 + FR-6 together:
1. Create curl config via `write_curl_auth_config()` (FR-6)
2. Mock a 401 response with JSON error body (FR-4)
3. Mock a success response with `.overall_verdict` instead of `.verdict` (FR-1)
4. Verify: error surfaced with redaction, verdict extracted correctly

## 4. File Manifest

### New files
| File | FR | Purpose |
|------|-----|---------|
| `.claude/scripts/flatline-readiness.sh` | FR-3 | Flatline readiness check |
| `tests/unit/flatline-readiness.bats` | FR-3 | Readiness tests |
| `tests/unit/extract-verdict.bats` | FR-1 | Verdict extraction tests |
| `tests/unit/api-error-surfacing.bats` | FR-4 | Error surfacing tests |
| `tests/unit/run-with-timeout.bats` | FR-5 | Timeout helper tests |
| `tests/unit/curl-config-guard.bats` | FR-6 | Injection guard tests |
| `tests/unit/review-pipeline-integration.bats` | FR-1,4,6 | Integration test |

### Modified files
| File | FR | Change |
|------|-----|--------|
| `.claude/scripts/lib/normalize-json.sh` | FR-1 | Add `extract_verdict()` |
| `.claude/scripts/gpt-review-api.sh` | FR-1 | Use `extract_verdict()` |
| `.claude/scripts/lib-curl-fallback.sh` | FR-1, FR-4, FR-6 | Verdict, error surfacing, curl config |
| `.claude/scripts/lib-route-table.sh` | FR-1 | Use `extract_verdict()` |
| `.claude/scripts/post-pr-audit.sh` | FR-1 | Use `extract_verdict()` |
| `.claude/scripts/cache-manager.sh` | FR-1 | Use `extract_verdict()` |
| `.claude/scripts/lib-security.sh` | FR-6 | Add `write_curl_auth_config()` |
| `.claude/scripts/constructs-auth.sh` | FR-6 | Migrate to `write_curl_auth_config()` |
| `.claude/scripts/constructs-browse.sh` | FR-6 | Migrate to `write_curl_auth_config()` |
| `.claude/scripts/compat-lib.sh` | FR-5 | Add `run_with_timeout()` |
| `.claude/scripts/post-pr-orchestrator.sh` | FR-5 | Migrate to `compat-lib.sh` helper |
| `.claude/scripts/post-pr-e2e.sh` | FR-5 | Migrate timeout logic |
| `.claude/scripts/golden-path.sh` | FR-5 | Replace bare `timeout` |
| `.claude/skills/bridgebuilder-review/resources/config.ts` | FR-2 | Regex fix |
| `.claude/skills/bridgebuilder-review/resources/config.test.ts` | FR-2 | Add loadYamlConfig tests |
| `.claude/protocols/cross-platform-shell.md` | FR-5, FR-6 | Document patterns |

### Unchanged files (already resilient)
| File | Reason |
|------|--------|
| `.claude/scripts/condense.sh` | Lines 217, 352 already use triple-fallback pattern |

## 5. Security Considerations

- **FR-4**: Error messages pass through `redact_log_output()` before display — prevents API key fragment leakage
- **FR-6**: Injection guard uses denylist (CR/LF/null/backslash) + escaping (quotes) — allows valid base64 characters
- **FR-6**: `mktemp` + `chmod 600` pattern centralized — single point of enforcement
- **FR-3**: No API calls made — only checks env var presence (no key material transmitted)
- **All**: No `.env` file reading (SKP-003 security decision maintained)

## 6. Sprint Mapping

| Sprint | FRs | Rationale |
|--------|-----|-----------|
| Sprint 1 | FR-6, FR-4, FR-2 | Foundation (curl guard) + error surfacing + TS regex (early to minimize dist/ merge conflicts) |
| Sprint 2 | FR-1, FR-3 | Verdict centralization + readiness script |
| Sprint 3 | FR-5 | Timeout consolidation + migration |
| Sprint 4 | Integration test, CI lint rules, protocol docs | Cross-FR validation, regression checks, documentation |
