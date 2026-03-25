#!/usr/bin/env bash
# =============================================================================
# validate-rule-lifecycle.sh — Validate rule file lifecycle metadata
# =============================================================================
# Checks all .claude/rules/*.md files for:
# - origin: genesis | enacted | migrated
# - version: positive integer
# - enacted_by: cycle reference string
#
# Part of cycle-050: Multi-Model Permission Architecture (FR-2)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
RULES_DIR="${RULES_DIR:-$PROJECT_ROOT/.claude/rules}"

# Source safe yq
# shellcheck source=yq-safe.sh
source "$SCRIPT_DIR/yq-safe.sh"

# --- CLI flags ---
JSON_OUTPUT=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json) JSON_OUTPUT=true; shift ;;
        -h|--help)
            echo "Usage: validate-rule-lifecycle.sh [--json]"
            exit 0
            ;;
        *) echo "Unknown arg: $1" >&2; exit 2 ;;
    esac
done

# --- Counters ---
total=0
errors=0
passed=0
results_json="[]"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

log_error() {
    local rule="$1" msg="$2"
    errors=$((errors + 1))
    if [[ "$JSON_OUTPUT" == "false" ]]; then
        echo -e "  ${RED}ERROR${NC}: $msg"
    fi
    results_json=$(echo "$results_json" | jq --arg r "$rule" --arg m "$msg" '. + [{"rule": $r, "level": "error", "message": $m}]')
}

validate_rule() {
    local rule_file="$1"
    local rule_name
    rule_name=$(basename "$rule_file")
    total=$((total + 1))
    local has_error=false

    if [[ "$JSON_OUTPUT" == "false" ]]; then
        echo -n "[$rule_name] "
    fi

    # Extract frontmatter
    local frontmatter
    frontmatter=$(awk '/^---$/{if(n++) exit; next} n' "$rule_file") || frontmatter=""

    if [[ -z "$frontmatter" ]]; then
        log_error "$rule_name" "No frontmatter found"
        return 0
    fi

    # Check origin
    local origin
    origin=$(echo "$frontmatter" | yq eval '.origin // ""' - 2>/dev/null) || origin=""
    if [[ -z "$origin" ]]; then
        log_error "$rule_name" "Missing origin field"
        has_error=true
    else
        case "$origin" in
            genesis|enacted|migrated) ;; # valid
            *) log_error "$rule_name" "Invalid origin: $origin (expected: genesis|enacted|migrated)"
               has_error=true ;;
        esac
    fi

    # Check version
    local version
    version=$(echo "$frontmatter" | yq eval '.version // ""' - 2>/dev/null) || version=""
    if [[ -z "$version" ]]; then
        log_error "$rule_name" "Missing version field"
        has_error=true
    elif ! [[ "$version" =~ ^[1-9][0-9]*$ ]]; then
        log_error "$rule_name" "Invalid version: $version (expected: positive integer)"
        has_error=true
    fi

    # Check enacted_by
    local enacted_by
    enacted_by=$(echo "$frontmatter" | yq eval '.enacted_by // ""' - 2>/dev/null) || enacted_by=""
    if [[ -z "$enacted_by" ]]; then
        log_error "$rule_name" "Missing enacted_by field"
        has_error=true
    fi

    if [[ "$has_error" == "false" ]]; then
        passed=$((passed + 1))
        if [[ "$JSON_OUTPUT" == "false" ]]; then
            echo -e "${GREEN}PASS${NC}"
        fi
    fi
}

# --- Main ---
if [[ "$JSON_OUTPUT" == "false" ]]; then
    echo "Rule Lifecycle Validation"
    echo "========================="
    echo ""
fi

if [[ ! -d "$RULES_DIR" ]]; then
    echo "No .claude/rules/ directory found" >&2
    exit 2
fi

for rule_file in "$RULES_DIR"/*.md; do
    [[ -f "$rule_file" ]] || continue
    validate_rule "$rule_file"
done

if [[ "$JSON_OUTPUT" == "false" ]]; then
    echo ""
    echo "Results: $total rules checked, $passed passed, $errors errors"
fi

if [[ "$JSON_OUTPUT" == "true" ]]; then
    jq -n \
        --argjson results "$results_json" \
        --argjson total "$total" \
        --argjson passed "$passed" \
        --argjson errors "$errors" \
        '{total: $total, passed: $passed, errors: $errors, results: $results}'
fi

if [[ $errors -gt 0 ]]; then
    exit 1
fi
exit 0
