#!/usr/bin/env bash
# =============================================================================
# autopoietic-health.sh — Autopoietic Health Check
# =============================================================================
# Part of: Integration & Autopoietic Verification (cycle-047, Sprint 390 Task 5.2)
#
# Measures the 6 conditions for flourishing and produces a JSON report.
# Each condition is scored 0-1 with specific remediation when missing.
#
# Conditions:
#   1. Permission  — MAY constraints in constraints.json (≥4)
#   2. Memory      — Lore artifacts (patterns.yaml, failures.yaml, ecosystem-synthesis.md)
#   3. Diversity   — Flatline protocol model providers (≥2 distinct)
#   4. Stakes      — Production deployment artifacts (terraform + Dockerfile)
#   5. Exploration — Explored visions + economic feedback config
#   6. Surprise    — Capability manifests (≥3)
#
# Output: JSON to stdout
#
# Usage:
#   autopoietic-health.sh                  # Full health check
#   autopoietic-health.sh --json           # (same, JSON is default)
#   autopoietic-health.sh --summary        # One-line summary
#
# Dependencies: jq 1.6+, yq v4+ (optional, for config checks), bash 4+
# =============================================================================

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

SUMMARY_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --summary) SUMMARY_MODE=true; shift ;;
    --json) shift ;;
    --help)
      echo "Usage: autopoietic-health.sh [--json|--summary]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

# =============================================================================
# Condition 1: Permission — MAY constraints in constraints.json
# =============================================================================

check_permission() {
  local constraints_file="${REPO_ROOT}/.claude/data/constraints.json"
  local score=0
  local remediation=""
  local count=0

  if [[ ! -f "$constraints_file" ]]; then
    remediation="constraints.json not found — run Loa update"
  else
    count=$(jq '[.constraints[] | select(.rule_type == "MAY")] | length' "$constraints_file" 2>/dev/null) || count=0
    if [[ "$count" -ge 4 ]]; then
      score=1
    elif [[ "$count" -gt 0 ]]; then
      # Partial: count/4 capped at 1.0
      score=$(echo "$count" | awk '{v=$1/4; if(v>1) v=1; printf "%.2f", v}')
    else
      remediation="No MAY constraints found — permission grants not defined"
    fi
  fi

  jq -n \
    --arg name "permission" \
    --argjson score "$score" \
    --argjson count "$count" \
    --arg remediation "$remediation" \
    '{name: $name, score: $score, detail: {may_constraints: $count, threshold: 4}, remediation: $remediation}'
}

# =============================================================================
# Condition 2: Memory — Lore artifacts exist
# =============================================================================

check_memory() {
  local lore_dir="${REPO_ROOT}/grimoires/loa/lore"
  local score=0
  local remediation=""
  local found=0
  local expected=3

  if [[ ! -d "$lore_dir" ]]; then
    remediation="grimoires/loa/lore/ directory not found"
  else
    [[ -f "${lore_dir}/patterns.yaml" ]] && found=$((found + 1))
    [[ -f "${lore_dir}/failures.yaml" ]] && found=$((found + 1))
    [[ -f "${lore_dir}/ecosystem-synthesis.md" ]] && found=$((found + 1))

    score=$(echo "$found $expected" | awk '{printf "%.2f", $1/$2}')
    if [[ "$found" -lt "$expected" ]]; then
      local missing=()
      [[ ! -f "${lore_dir}/patterns.yaml" ]] && missing+=(patterns.yaml)
      [[ ! -f "${lore_dir}/failures.yaml" ]] && missing+=(failures.yaml)
      [[ ! -f "${lore_dir}/ecosystem-synthesis.md" ]] && missing+=(ecosystem-synthesis.md)
      remediation="Missing lore files: ${missing[*]}"
    fi
  fi

  jq -n \
    --arg name "memory" \
    --argjson score "$score" \
    --argjson found "$found" \
    --argjson expected "$expected" \
    --arg remediation "$remediation" \
    '{name: $name, score: $score, detail: {files_found: $found, files_expected: $expected}, remediation: $remediation}'
}

# =============================================================================
# Condition 3: Diversity — Flatline protocol model providers (≥2)
# =============================================================================

check_diversity() {
  local config_file="${REPO_ROOT}/.loa.config.yaml"
  local score=0
  local remediation=""
  local providers=0

  if [[ ! -f "$config_file" ]] || ! command -v yq &>/dev/null; then
    remediation="flatline_protocol not configured in .loa.config.yaml"
  else
    # Count distinct model providers from flatline_protocol.models[]
    local models
    models=$(yq '.flatline_protocol.models[]' "$config_file" 2>/dev/null || echo "")

    if [[ -z "$models" ]]; then
      remediation="flatline_protocol.models not configured in .loa.config.yaml"
    else
      # Extract provider prefixes (e.g., "claude-" → anthropic, "gpt-" → openai)
      providers=$(echo "$models" | awk '
        {
          if ($0 ~ /^claude/ || $0 ~ /^anthropic/) p["anthropic"]=1
          else if ($0 ~ /^gpt/ || $0 ~ /^openai/ || $0 ~ /^o[0-9]/) p["openai"]=1
          else if ($0 ~ /^gemini/ || $0 ~ /^google/) p["google"]=1
          else if ($0 ~ /^llama/ || $0 ~ /^meta/) p["meta"]=1
          else p[$0]=1
        }
        END { print length(p) }
      ')

      if [[ "$providers" -ge 2 ]]; then
        score=1
      elif [[ "$providers" -gt 0 ]]; then
        score=$(echo "$providers" | awk '{v=$1/2; if(v>1) v=1; printf "%.2f", v}')
        remediation="Only $providers model provider — need ≥2 for diversity"
      else
        remediation="No model providers detected in flatline_protocol.models"
      fi
    fi
  fi

  jq -n \
    --arg name "diversity" \
    --argjson score "$score" \
    --argjson providers "$providers" \
    --arg remediation "$remediation" \
    '{name: $name, score: $score, detail: {distinct_providers: $providers, threshold: 2}, remediation: $remediation}'
}

# =============================================================================
# Condition 4: Stakes — Production deployment artifacts
# =============================================================================

check_stakes() {
  local score=0
  local remediation=""
  local found=0
  local expected=2

  # Check for terraform files
  local tf_count=0
  if [[ -d "${REPO_ROOT}/infrastructure/terraform" ]]; then
    tf_count=$(find "${REPO_ROOT}/infrastructure/terraform" -name "*.tf" -type f 2>/dev/null | head -5 | wc -l)
  fi
  [[ "$tf_count" -ge 1 ]] && found=$((found + 1))

  # Check for Dockerfile(s)
  local docker_count=0
  if compgen -G "${REPO_ROOT}/packages/services/*/Dockerfile" >/dev/null 2>&1; then
    docker_count=1
  elif compgen -G "${REPO_ROOT}/apps/*/Dockerfile" >/dev/null 2>&1; then
    docker_count=1
  elif [[ -f "${REPO_ROOT}/Dockerfile" ]]; then
    docker_count=1
  fi
  [[ "$docker_count" -ge 1 ]] && found=$((found + 1))

  score=$(echo "$found $expected" | awk '{printf "%.2f", $1/$2}')

  if [[ "$found" -lt "$expected" ]]; then
    local missing=()
    [[ "$tf_count" -eq 0 ]] && missing+=("infrastructure/terraform/*.tf")
    [[ "$docker_count" -eq 0 ]] && missing+=("Dockerfile")
    remediation="Missing deployment artifacts: ${missing[*]}"
  fi

  jq -n \
    --arg name "stakes" \
    --argjson score "$score" \
    --argjson tf_files "$tf_count" \
    --argjson dockerfiles "$docker_count" \
    --arg remediation "$remediation" \
    '{name: $name, score: $score, detail: {terraform_files: $tf_files, dockerfiles: $dockerfiles}, remediation: $remediation}'
}

# =============================================================================
# Condition 5: Exploration — Explored visions + economic feedback config
# =============================================================================

check_exploration() {
  local score=0
  local remediation=""
  local conditions_met=0
  local expected=2

  # Check for ≥1 vision with status: Explored
  local visions_dir="${REPO_ROOT}/grimoires/loa/visions/entries"
  local explored_count=0
  if [[ -d "$visions_dir" ]]; then
    explored_count=$(grep -rl "Status.*Explored" "$visions_dir"/*.md 2>/dev/null | wc -l) || explored_count=0
  fi
  [[ "$explored_count" -ge 1 ]] && conditions_met=$((conditions_met + 1))

  # Check for economic_feedback key in config
  local config_file="${REPO_ROOT}/.loa.config.yaml"
  local has_economic=false
  if [[ -f "$config_file" ]] && command -v yq &>/dev/null; then
    local econ_key
    econ_key=$(yq '.run_bridge.economic_feedback' "$config_file" 2>/dev/null)
    if [[ -n "$econ_key" && "$econ_key" != "null" ]]; then
      has_economic=true
      conditions_met=$((conditions_met + 1))
    fi
  fi

  score=$(echo "$conditions_met $expected" | awk '{printf "%.2f", $1/$2}')

  if [[ "$conditions_met" -lt "$expected" ]]; then
    local missing=()
    [[ "$explored_count" -eq 0 ]] && missing+=("no explored visions in registry")
    [[ "$has_economic" == "false" ]] && missing+=("run_bridge.economic_feedback not in config")
    remediation="${missing[*]}"
  fi

  jq -n \
    --arg name "exploration" \
    --argjson score "$score" \
    --argjson explored_visions "$explored_count" \
    --argjson has_economic "$([ "$has_economic" == "true" ] && echo true || echo false)" \
    --arg remediation "$remediation" \
    '{name: $name, score: $score, detail: {explored_visions: $explored_visions, has_economic_feedback: $has_economic}, remediation: $remediation}'
}

# =============================================================================
# Condition 6: Surprise Capacity — Capability manifests (≥3)
# =============================================================================

check_surprise() {
  local cap_dir="${REPO_ROOT}/.claude/capabilities"
  local score=0
  local remediation=""
  local count=0

  if [[ ! -d "$cap_dir" ]]; then
    remediation="no capability manifests — run Sprint 3"
  else
    count=$(find "$cap_dir" -name "*.yaml" -type f 2>/dev/null | wc -l) || count=0

    if [[ "$count" -ge 3 ]]; then
      score=1
    elif [[ "$count" -gt 0 ]]; then
      score=$(echo "$count" | awk '{v=$1/3; if(v>1) v=1; printf "%.2f", v}')
      remediation="Only $count capability manifests — need ≥3"
    else
      remediation="no capability manifests found in .claude/capabilities/"
    fi
  fi

  jq -n \
    --arg name "surprise_capacity" \
    --argjson score "$score" \
    --argjson count "$count" \
    --arg remediation "$remediation" \
    '{name: $name, score: $score, detail: {manifest_count: $count, threshold: 3}, remediation: $remediation}'
}

# =============================================================================
# Main — Assemble Report
# =============================================================================

main() {
  local conditions=()
  conditions+=("$(check_permission)")
  conditions+=("$(check_memory)")
  conditions+=("$(check_diversity)")
  conditions+=("$(check_stakes)")
  conditions+=("$(check_exploration)")
  conditions+=("$(check_surprise)")

  # Build JSON array of conditions
  local conditions_json="["
  local first=true
  for c in "${conditions[@]}"; do
    if [[ "$first" == "true" ]]; then
      first=false
    else
      conditions_json+=","
    fi
    conditions_json+="$c"
  done
  conditions_json+="]"

  # Compute overall score (arithmetic mean of 6 condition scores)
  local overall_score
  overall_score=$(echo "$conditions_json" | jq '[.[].score] | add / length' 2>/dev/null)

  # Classify flourishing level
  local flourishing_level="dormant"
  if (( $(echo "$overall_score >= 0.9" | bc -l 2>/dev/null || echo 0) )); then
    flourishing_level="flourishing"
  elif (( $(echo "$overall_score >= 0.7" | bc -l 2>/dev/null || echo 0) )); then
    flourishing_level="emerging"
  elif (( $(echo "$overall_score >= 0.4" | bc -l 2>/dev/null || echo 0) )); then
    flourishing_level="developing"
  fi

  local report
  report=$(jq -n \
    --argjson conditions "$conditions_json" \
    --argjson overall_score "$overall_score" \
    --arg level "$flourishing_level" \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{
      autopoietic_health: {
        timestamp: $timestamp,
        overall_score: $overall_score,
        flourishing_level: $level,
        conditions: $conditions
      }
    }')

  if [[ "$SUMMARY_MODE" == "true" ]]; then
    local passing
    passing=$(echo "$conditions_json" | jq '[.[] | select(.score > 0)] | length' 2>/dev/null)
    echo "Autopoietic health: $overall_score ($flourishing_level) — $passing/6 conditions active"
  else
    echo "$report"
  fi
}

main
