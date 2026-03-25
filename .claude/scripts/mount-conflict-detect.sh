#!/usr/bin/env bash
# mount-conflict-detect.sh — Detect rule file conflicts when Loa mounts onto a project
# Part of cycle-050: Upstream Platform Alignment (sprint-109 T5.1/T5.2)
#
# Scans Loa rules and project rules directories for *.md files with YAML
# frontmatter containing paths: arrays, then detects overlaps.
#
# Precedence model: Project rules > Loa rules > Claude Code defaults
#
# Exit codes:
#   0 — no conflicts or merge-safe
#   1 — hard failures (multi-file overlap)
#   2 — script error
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/yq-safe.sh"

# === Colors ===
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# === Globals ===
LOA_RULES_DIR=""
PROJECT_RULES_DIR=""
JSON_OUTPUT=false

# Result accumulators (newline-delimited strings to avoid array/nameref issues)
_CONFLICTS=""       # path_pattern|loa_rule|project_rule
_LOA_ONLY=""        # one filename per line
_PROJECT_ONLY=""    # one filename per line
_HARD_FAILURES=""   # path_pattern|owner1 owner2 owner3
_WARNINGS=""        # one warning per line
_MERGE_SAFE=true

# === Usage ===
usage() {
    cat <<'USAGE'
Usage: mount-conflict-detect.sh --loa-rules DIR --project-rules DIR [--json]

Options:
  --loa-rules DIR       Directory containing Loa rule files (*.md)
  --project-rules DIR   Directory containing project rule files (*.md)
  --json                Output in JSON format (default: human-readable)
  -h, --help            Show this help message

Exit codes:
  0  No conflicts or merge-safe
  1  Hard failures (multi-file overlap)
  2  Script error
USAGE
}

# === Argument Parsing ===
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --loa-rules)
                [[ $# -lt 2 ]] && { echo "ERROR: --loa-rules requires a directory argument" >&2; exit 2; }
                LOA_RULES_DIR="$2"
                shift 2
                ;;
            --project-rules)
                [[ $# -lt 2 ]] && { echo "ERROR: --project-rules requires a directory argument" >&2; exit 2; }
                PROJECT_RULES_DIR="$2"
                shift 2
                ;;
            --json)
                JSON_OUTPUT=true
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                echo "ERROR: Unknown argument: $1" >&2
                usage >&2
                exit 2
                ;;
        esac
    done

    if [[ -z "$LOA_RULES_DIR" ]]; then
        echo "ERROR: --loa-rules is required" >&2
        exit 2
    fi
    if [[ -z "$PROJECT_RULES_DIR" ]]; then
        echo "ERROR: --project-rules is required" >&2
        exit 2
    fi
    if [[ ! -d "$LOA_RULES_DIR" ]]; then
        echo "ERROR: Loa rules directory does not exist: $LOA_RULES_DIR" >&2
        exit 2
    fi
    # Project rules dir may not exist (no conflicts in that case)
}

# === Extract paths from a rule file's YAML frontmatter ===
# Args: $1 = path to .md file
# Outputs: one path pattern per line, or empty if unparseable
# Returns: 0 on success, 1 if frontmatter is missing/unparseable
extract_paths() {
    local file="$1"
    local frontmatter

    # Extract YAML frontmatter between --- delimiters
    frontmatter=$(awk '/^---$/{if(n++) exit; next} n' "$file" 2>/dev/null) || return 1

    if [[ -z "$frontmatter" ]]; then
        return 1
    fi

    # Use yq to extract paths array
    local paths
    paths=$(echo "$frontmatter" | yq eval '.paths[]' - 2>/dev/null) || return 1

    if [[ -z "$paths" || "$paths" == "null" ]]; then
        return 1
    fi

    echo "$paths"
    return 0
}

# === Append to newline-delimited accumulator ===
_append() {
    local varname="$1"
    local value="$2"
    local current="${!varname}"
    if [[ -z "$current" ]]; then
        printf -v "$varname" '%s' "$value"
    else
        printf -v "$varname" '%s\n%s' "$current" "$value"
    fi
}

# === Count lines in a newline-delimited string (empty = 0) ===
_count() {
    local value="$1"
    if [[ -z "$value" ]]; then
        echo 0
    else
        echo "$value" | wc -l | tr -d ' '
    fi
}

# === Build path-to-files mapping and classify conflicts ===
detect_conflicts() {
    # Associative array: path_pattern -> space-separated list of "source:filename"
    declare -A path_owners

    # Track which files belong to which source (newline-delimited)
    local loa_files=""
    local project_files=""

    # Scan Loa rules
    if [[ -d "$LOA_RULES_DIR" ]]; then
        for rule_file in "$LOA_RULES_DIR"/*.md; do
            [[ -f "$rule_file" ]] || continue
            local bname
            bname=$(basename "$rule_file")
            local paths
            if ! paths=$(extract_paths "$rule_file"); then
                _append _WARNINGS "WARN: Skipping unparseable Loa rule: $bname"
                continue
            fi
            _append loa_files "$bname"
            while IFS= read -r path_pattern; do
                [[ -z "$path_pattern" ]] && continue
                path_owners["$path_pattern"]="${path_owners[$path_pattern]:-} loa:$bname"
            done <<< "$paths"
        done
    fi

    # Scan project rules
    if [[ -d "$PROJECT_RULES_DIR" ]]; then
        for rule_file in "$PROJECT_RULES_DIR"/*.md; do
            [[ -f "$rule_file" ]] || continue
            local bname
            bname=$(basename "$rule_file")
            local paths
            if ! paths=$(extract_paths "$rule_file"); then
                _append _WARNINGS "WARN: Skipping unparseable project rule: $bname"
                continue
            fi
            _append project_files "$bname"
            while IFS= read -r path_pattern; do
                [[ -z "$path_pattern" ]] && continue
                path_owners["$path_pattern"]="${path_owners[$path_pattern]:-} project:$bname"
            done <<< "$paths"
        done
    fi

    # Classify conflicts
    # Track which files are involved in conflicts
    local conflicted_loa_files=""
    local conflicted_project_files=""

    for path_pattern in "${!path_owners[@]}"; do
        local owners="${path_owners[$path_pattern]}"
        # Trim leading space
        owners="${owners# }"

        local loa_count=0
        local project_count=0
        local loa_rule=""
        local project_rule=""
        local total_count=0

        for owner in $owners; do
            total_count=$((total_count + 1))
            case "$owner" in
                loa:*)
                    loa_count=$((loa_count + 1))
                    loa_rule="${owner#loa:}"
                    ;;
                project:*)
                    project_count=$((project_count + 1))
                    project_rule="${owner#project:}"
                    ;;
            esac
        done

        if [[ $total_count -ge 3 ]]; then
            # Multi-file overlap — hard failure
            _append _HARD_FAILURES "$path_pattern|$owners"
            _MERGE_SAFE=false
        elif [[ $loa_count -gt 0 && $project_count -gt 0 ]]; then
            # Conflict — project wins
            _append _CONFLICTS "$path_pattern|$loa_rule|$project_rule"
            _append conflicted_loa_files "$loa_rule"
            _append conflicted_project_files "$project_rule"
        fi
    done

    # Determine loa-only files (not involved in any conflict)
    if [[ -n "$loa_files" ]]; then
        while IFS= read -r lf; do
            [[ -z "$lf" ]] && continue
            if [[ -z "$conflicted_loa_files" ]] || ! echo "$conflicted_loa_files" | grep -qxF "$lf"; then
                _append _LOA_ONLY "$lf"
            fi
        done <<< "$loa_files"
    fi

    # Determine project-only files (not involved in any conflict)
    if [[ -n "$project_files" ]]; then
        while IFS= read -r pf; do
            [[ -z "$pf" ]] && continue
            if [[ -z "$conflicted_project_files" ]] || ! echo "$conflicted_project_files" | grep -qxF "$pf"; then
                _append _PROJECT_ONLY "$pf"
            fi
        done <<< "$project_files"
    fi

    # Output results
    if [[ "$JSON_OUTPUT" == "true" ]]; then
        output_json
    else
        output_human
    fi

    if [[ "$_MERGE_SAFE" == "false" ]]; then
        return 1
    fi
    return 0
}

# === JSON output ===
output_json() {
    local conflicts_json="[]"
    local loa_only_json="[]"
    local project_only_json="[]"
    local hard_failures_json="[]"
    local warnings_json="[]"

    # Build conflicts array
    if [[ -n "$_CONFLICTS" ]]; then
        conflicts_json="["
        local first=true
        while IFS= read -r conflict; do
            [[ -z "$conflict" ]] && continue
            local path_pattern loa_rule project_rule
            path_pattern=$(echo "$conflict" | cut -d'|' -f1)
            loa_rule=$(echo "$conflict" | cut -d'|' -f2)
            project_rule=$(echo "$conflict" | cut -d'|' -f3)
            if [[ "$first" == "true" ]]; then
                first=false
            else
                conflicts_json+=","
            fi
            conflicts_json+=$(jq -n \
                --arg pp "$path_pattern" \
                --arg lr "$loa_rule" \
                --arg pr "$project_rule" \
                '{path_pattern: $pp, loa_rule: $lr, project_rule: $pr, resolution: "project_wins"}')
        done <<< "$_CONFLICTS"
        conflicts_json+="]"
    fi

    # Build loa_only array
    if [[ -n "$_LOA_ONLY" ]]; then
        loa_only_json=$(echo "$_LOA_ONLY" | jq -R . | jq -s .)
    fi

    # Build project_only array
    if [[ -n "$_PROJECT_ONLY" ]]; then
        project_only_json=$(echo "$_PROJECT_ONLY" | jq -R . | jq -s .)
    fi

    # Build hard_failures array
    if [[ -n "$_HARD_FAILURES" ]]; then
        hard_failures_json="["
        local first=true
        while IFS= read -r hf; do
            [[ -z "$hf" ]] && continue
            local path_pattern owners
            path_pattern=$(echo "$hf" | cut -d'|' -f1)
            owners=$(echo "$hf" | cut -d'|' -f2-)
            if [[ "$first" == "true" ]]; then
                first=false
            else
                hard_failures_json+=","
            fi
            # Build files array from owners
            local files_json
            files_json=$(echo "$owners" | tr ' ' '\n' | grep -v '^$' | jq -R . | jq -s .)
            hard_failures_json+=$(jq -n \
                --arg pp "$path_pattern" \
                --argjson files "$files_json" \
                '{path_pattern: $pp, owners: $files, reason: "multi_file_overlap"}')
        done <<< "$_HARD_FAILURES"
        hard_failures_json+="]"
    fi

    # Build warnings array
    if [[ -n "$_WARNINGS" ]]; then
        warnings_json=$(echo "$_WARNINGS" | jq -R . | jq -s .)
    fi

    jq -n \
        --argjson conflicts "$conflicts_json" \
        --argjson loa_only "$loa_only_json" \
        --argjson project_only "$project_only_json" \
        --argjson hard_failures "$hard_failures_json" \
        --argjson merge_safe "$_MERGE_SAFE" \
        --argjson warnings "$warnings_json" \
        '{
            conflicts: $conflicts,
            non_conflicting: {
                loa_only: $loa_only,
                project_only: $project_only
            },
            hard_failures: $hard_failures,
            merge_safe: $merge_safe,
            warnings: $warnings
        }'
}

# === Human-readable output ===
output_human() {
    echo ""
    echo "Rule Conflict Detection"
    echo "========================"
    echo ""

    # Print warnings
    if [[ -n "$_WARNINGS" ]]; then
        while IFS= read -r warn; do
            echo -e "  ${YELLOW}${warn}${NC}"
        done <<< "$_WARNINGS"
        echo ""
    fi

    # Print hard failures
    if [[ -n "$_HARD_FAILURES" ]]; then
        while IFS= read -r hf; do
            [[ -z "$hf" ]] && continue
            local path_pattern owners
            path_pattern=$(echo "$hf" | cut -d'|' -f1)
            owners=$(echo "$hf" | cut -d'|' -f2-)
            echo -e "  ${RED}HARD FAILURE: ${path_pattern}${NC}"
            echo "    Owners: $owners"
            echo "    Resolution: Cannot merge — 3+ files claim this path"
            echo ""
        done <<< "$_HARD_FAILURES"
    fi

    # Print conflicts
    if [[ -n "$_CONFLICTS" ]]; then
        while IFS= read -r conflict; do
            [[ -z "$conflict" ]] && continue
            local path_pattern loa_rule project_rule
            path_pattern=$(echo "$conflict" | cut -d'|' -f1)
            loa_rule=$(echo "$conflict" | cut -d'|' -f2)
            project_rule=$(echo "$conflict" | cut -d'|' -f3)
            echo -e "  ${YELLOW}OVERLAP: ${path_pattern}${NC}"
            echo "    Loa rule:      $loa_rule"
            echo "    Project rule:   $project_rule"
            echo "    Resolution:     Project wins (CSS specificity)"
            echo ""
        done <<< "$_CONFLICTS"
    fi

    # Print non-conflicting loa rules
    if [[ -n "$_LOA_ONLY" ]]; then
        while IFS= read -r lf; do
            [[ -z "$lf" ]] && continue
            echo -e "  ${GREEN}NO CONFLICT: ${lf}${NC}"
            echo "    Loa only:      $lf"
            echo ""
        done <<< "$_LOA_ONLY"
    fi

    # Print non-conflicting project rules
    if [[ -n "$_PROJECT_ONLY" ]]; then
        while IFS= read -r pf; do
            [[ -z "$pf" ]] && continue
            echo -e "  ${GREEN}NO CONFLICT: ${pf}${NC}"
            echo "    Project only:  $pf"
            echo ""
        done <<< "$_PROJECT_ONLY"
    fi

    # Summary
    if [[ "$_MERGE_SAFE" == "true" ]]; then
        echo -e "  ${GREEN}Result: Merge-safe${NC}"
    else
        echo -e "  ${RED}Result: Hard failures detected — cannot auto-merge${NC}"
    fi
    echo ""
}

# === Main ===
main() {
    parse_args "$@"
    detect_conflicts
}

main "$@"
