#!/usr/bin/env bash
# check-capabilities.sh — Per-cell capability boundary audit per ADR-009 D-9a.
# Part of construct-freeside / auditing-cell-capabilities skill.
#
# Checks:
#   1. No secrets in tracked .claude/ files
#   2. Framework-baseline hooks present
#   3. No shadowed framework skills
#   4. Scripts respect cluster boundaries (heuristic)
#   5. Agent-permissions inherits baseline
#
# Usage:
#   check-capabilities.sh                      # current dir; markdown output
#   check-capabilities.sh --cell <path>        # explicit cell path
#   check-capabilities.sh --json               # JSON output
#   check-capabilities.sh --ci                 # exit non-zero on FAIL (for CI)
#
# Exit codes:
#   0 = PASS or PASS-with-WARN
#   1 = FAIL (one or more checks failed; cell out of compliance)
#   2 = ERROR (script error; bad invocation; cell not found)

set -euo pipefail

CELL_PATH=""
OUTPUT_FORMAT="markdown"
CI_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cell) CELL_PATH="$2"; shift 2 ;;
    --json) OUTPUT_FORMAT="json"; shift ;;
    --ci)   CI_MODE=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--cell <path>] [--json] [--ci]"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

[ -z "$CELL_PATH" ] && CELL_PATH="$(pwd)"
[ -d "$CELL_PATH" ] || { echo "ERROR: cell path not found: $CELL_PATH" >&2; exit 2; }

# === Framework baseline (must be present in every cell) ===
BASELINE_HOOKS_PATTERNS=(
  "block-destructive-bash"
  "mutation-logger"
)

# === Framework-baseline skills (must NOT be shadowed) ===
FRAMEWORK_SKILLS=(
  "implementing-tasks"
  "designing-architecture"
  "planning-sprints"
  "reviewing-code"
  "auditing-security"
  "simstim-workflow"
  "run-bridge"
)

# === Secret patterns (loose; high-signal) ===
# Each pattern is a Perl-compatible regex; loose-match keys/tokens commonly found
SECRET_PATTERNS=(
  'sk-ant-[A-Za-z0-9_-]{16,}'      # Anthropic API keys
  'sk-[A-Za-z0-9]{40,}'            # Generic sk- API keys (OpenAI, etc.)
  'ghp_[A-Za-z0-9]{36,}'           # GitHub PAT (classic)
  'github_pat_[A-Za-z0-9_]{82,}'   # GitHub PAT (fine-grained)
  'AKIA[A-Z0-9]{16}'               # AWS access key
  'AIza[A-Za-z0-9_-]{35}'          # Google API key
  '-----BEGIN [A-Z ]+PRIVATE KEY-----'  # PEM private keys
  'xox[abp]-[A-Za-z0-9-]{50,}'     # Slack tokens
)

# === Check results (parallel arrays for bash 3.2 compat) ===
CHECK_NAMES=()
CHECK_STATUSES=()
CHECK_DETAILS=()

add_check() {
  CHECK_NAMES+=("$1")
  CHECK_STATUSES+=("$2")
  CHECK_DETAILS+=("$3")
}

# ─── Check 1: no secrets in tracked .claude/ ────────────────────────────
check_secrets() {
  local claude_dir="$CELL_PATH/.claude"
  if [ ! -d "$claude_dir" ]; then
    add_check "secrets" "SKIP" "no .claude/ to audit"
    return
  fi

  local found=()
  # Exclude false-positive hotspots: framework's own tests, prompts/lore docs that
  # contain example secrets in pattern-illustrating context, adapter test fixtures.
  local exclude_args=(
    --exclude-dir=cache
    --exclude-dir=node_modules
    --exclude-dir=.git
    --exclude-dir=__pycache__
    --exclude-dir=tests          # framework's own tests (pattern examples)
    --exclude-dir=fixtures       # test fixtures (intentional patterns)
    --exclude-dir=examples       # documentation examples
    --exclude-dir=evals          # eval fixtures
    --exclude-dir=mcp-examples   # MCP example payloads
    --exclude-dir=lore           # lore .md docs with token examples
    --exclude-dir=prompts        # prompt templates with example tokens
    --exclude="*.test.ts"
    --exclude="*.test.sh"
    --exclude="*.spec.ts"
    --exclude="*.bats"           # bash test scripts
    --exclude="*-test-fixture*"
    --exclude="*-example*"
    --exclude="*.md"             # docs often have example tokens
  )

  for pattern in "${SECRET_PATTERNS[@]}"; do
    # grep -RE for regex; head limits output noise.
    # grep returns 1 when no match; under set -e + pipefail this would kill the script.
    # Wrap with `|| true` to make no-match a no-op.
    while IFS= read -r line; do
      [ -n "$line" ] && found+=("$line")
    done < <( (grep -RE "${exclude_args[@]}" "$pattern" "$claude_dir" 2>/dev/null || true) | head -5)
  done

  if [ ${#found[@]} -eq 0 ]; then
    add_check "secrets" "PASS" ""
  else
    local count=${#found[@]}
    add_check "secrets" "FAIL" "$count potential secret(s) in .claude/ — review manually"
  fi
}

# ─── Check 2: framework-baseline hooks present ──────────────────────────
check_baseline_hooks() {
  local hooks_dir="$CELL_PATH/.claude/hooks"
  if [ ! -d "$hooks_dir" ]; then
    add_check "baseline_hooks" "WARN" ".claude/hooks/ missing (cell may use overrides)"
    return
  fi

  local present=()
  local missing=()
  for pattern in "${BASELINE_HOOKS_PATTERNS[@]}"; do
    # find + grep -q under set -e + pipefail can exit on no-match; wrap with || true
    local found_one
    found_one=$( (find "$hooks_dir" -type f -name "${pattern}*" -print -quit 2>/dev/null || true) | head -1)
    if [ -n "$found_one" ]; then
      present+=("$pattern")
    else
      missing+=("$pattern")
    fi
  done

  if [ ${#missing[@]} -eq 0 ]; then
    add_check "baseline_hooks" "PASS" "all ${#present[@]} baseline hooks present"
  else
    add_check "baseline_hooks" "FAIL" "missing: $(IFS=,; echo "${missing[*]}")"
  fi
}

# ─── Check 3: no shadowed framework skills ──────────────────────────────
check_shadowed_skills() {
  local skills_dir="$CELL_PATH/.claude/skills"
  if [ ! -d "$skills_dir" ]; then
    add_check "shadowed_skills" "SKIP" "no .claude/skills/ to audit"
    return
  fi

  local shadowed=()
  for fw_skill in "${FRAMEWORK_SKILLS[@]}"; do
    # Check if cell has a directory with the same name
    if [ -d "$skills_dir/$fw_skill" ]; then
      # Verify it's not a symlink to the framework's own (which would be legitimate inheritance)
      if [ ! -L "$skills_dir/$fw_skill" ]; then
        shadowed+=("$fw_skill")
      fi
    fi
  done

  if [ ${#shadowed[@]} -eq 0 ]; then
    add_check "shadowed_skills" "PASS" ""
  else
    # NOTE 2026-05-25 PM: copy-style mounts (the canonical pattern per ADR-009 D-4a)
    # LITERALLY copy framework skills into the cell's .claude/skills/ as part of
    # the mount recipe. So every copy-style cell will "shadow" framework skills as
    # a side effect of doctrine-compliant mounting. The right check is "did the cell
    # MODIFY the framework skill" (different content from canonical) — but that
    # requires diff against an authoritative source (loa-freeside? .loa submodule?
    # tagged loa release?). Until that's specified, demote to WARN.
    # TODO(D-9a refinement): add `--strict-shadow` flag that uses checksums.
    add_check "shadowed_skills" "WARN" "${#shadowed[@]} framework skill name(s) present in cell skills/ — expected for copy-style mounts; diff-vs-canonical check is unimplemented"
  fi
}

# ─── Check 4: scripts respect cluster boundaries (heuristic) ────────────
check_scripts_boundaries() {
  local scripts_dir="$CELL_PATH/.claude/scripts"
  if [ ! -d "$scripts_dir" ]; then
    add_check "scripts_boundaries" "SKIP" "no .claude/scripts/ to audit"
    return
  fi

  # Cluster-shared paths cells MUST NOT modify
  local forbidden_patterns=(
    'loa-freeside/packages/freeside-registry'
    'loa-freeside/.github/workflows/cluster-compliance'
    'loa-freeside/decisions/'
  )

  local violations=0
  for pattern in "${forbidden_patterns[@]}"; do
    local match_count
    # Wrap grep with `|| true` BEFORE pipe so set-e/pipefail doesn't kill us;
    # use `|| echo 0` would emit a second "0" after wc's natural "0".
    match_count=$( (grep -rE "$pattern" "$scripts_dir" 2>/dev/null || true) | wc -l | tr -d ' \n')
    [ -z "$match_count" ] && match_count=0
    violations=$((violations + match_count))
  done

  if [ "$violations" -eq 0 ]; then
    add_check "scripts_boundaries" "PASS" ""
  else
    # Heuristic — could be legitimate read-only refs OR forbidden write-attempts
    add_check "scripts_boundaries" "WARN" "$violations reference(s) to cluster-shared paths (review for write-intent)"
  fi
}

# ─── Check 5: agent-permissions inherits baseline ───────────────────────
check_agent_permissions() {
  local perms_file="$CELL_PATH/.claude/data/agent-permissions.json"
  if [ ! -f "$perms_file" ]; then
    add_check "agent_permissions" "PASS" "no override file (baseline inherited)"
    return
  fi

  # Verify the file is JSON
  if ! jq empty "$perms_file" 2>/dev/null; then
    add_check "agent_permissions" "FAIL" "agent-permissions.json is not valid JSON"
    return
  fi

  # Check it doesn't explicitly disable baseline hooks
  local disables_baseline
  disables_baseline=$(jq -r '.deny_hooks // [] | .[] | select(. | test("block-destructive-bash|mutation-logger"))' "$perms_file" 2>/dev/null)

  if [ -z "$disables_baseline" ]; then
    add_check "agent_permissions" "PASS" "no baseline-hook disablement"
  else
    add_check "agent_permissions" "FAIL" "disables baseline hook(s): $disables_baseline"
  fi
}

# ─── Run all checks ─────────────────────────────────────────────────────
check_secrets
check_baseline_hooks
check_shadowed_skills
check_scripts_boundaries
check_agent_permissions

# ─── Compute overall ───────────────────────────────────────────────────
OVERALL="PASS"
FAIL_COUNT=0
WARN_COUNT=0
PASS_COUNT=0
for status in "${CHECK_STATUSES[@]}"; do
  case "$status" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)); OVERALL="FAIL" ;;
    SKIP) ;;
  esac
done

EXIT_CODE=0
if [ "$OVERALL" = "FAIL" ] && [ "$CI_MODE" = true ]; then
  EXIT_CODE=1
fi

# ─── Output ────────────────────────────────────────────────────────────
if [ "$OUTPUT_FORMAT" = "json" ]; then
  echo "{"
  echo "  \"cell_path\": \"$CELL_PATH\","
  echo "  \"audit_ts\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"checks\": {"
  for i in "${!CHECK_NAMES[@]}"; do
    sep=","; [ $i -eq $((${#CHECK_NAMES[@]} - 1)) ] && sep=""
    printf '    "%s": { "status": "%s", "details": "%s" }%s\n' \
      "${CHECK_NAMES[$i]}" "${CHECK_STATUSES[$i]}" "${CHECK_DETAILS[$i]}" "$sep"
  done
  echo "  },"
  echo "  \"overall\": \"$OVERALL\","
  echo "  \"counts\": { \"pass\": $PASS_COUNT, \"warn\": $WARN_COUNT, \"fail\": $FAIL_COUNT },"
  echo "  \"exit_code\": $EXIT_CODE"
  echo "}"
else
  echo "# Cell Capability Audit — $CELL_PATH"
  echo "**Audit timestamp**: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  printf "| %-30s | %-6s | %s\n" "check" "status" "details"
  printf "| %-30s-|-%-6s-|-%s\n" "------------------------------" "------" "------"
  for i in "${!CHECK_NAMES[@]}"; do
    printf "| %-30s | %-6s | %s\n" "${CHECK_NAMES[$i]}" "${CHECK_STATUSES[$i]}" "${CHECK_DETAILS[$i]}"
  done
  echo ""
  echo "**OVERALL**: $OVERALL ($PASS_COUNT pass, $WARN_COUNT warn, $FAIL_COUNT fail)"
fi

exit $EXIT_CODE
