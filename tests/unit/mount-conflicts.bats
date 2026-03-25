#!/usr/bin/env bats
# =============================================================================
# mount-conflicts.bats — Rule file conflict detection tests (sprint-109 T5.4)
# =============================================================================
# Tests mount-conflict-detect.sh against various rule overlap scenarios.
# Part of cycle-050: Upstream Platform Alignment.

setup() {
    export LOA_RULES="$(mktemp -d)"
    export PROJECT_RULES="$(mktemp -d)"
    export SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/mount-conflict-detect.sh"
}

teardown() {
    rm -rf "$LOA_RULES" "$PROJECT_RULES"
}

# Helper: create a rule file with frontmatter paths
create_rule() {
    local dir="$1"
    local filename="$2"
    shift 2
    local paths=("$@")

    {
        echo "---"
        echo "paths:"
        for p in "${paths[@]}"; do
            echo "  - \"$p\""
        done
        echo "origin: genesis"
        echo "version: 1"
        echo "enacted_by: cycle-049"
        echo "---"
        echo "# Rule: $filename"
    } > "$dir/$filename"
}

# MC-T1: No existing project rules → no conflicts, merge_safe: true
@test "MC-T1: no project rules yields no conflicts and merge_safe true" {
    create_rule "$LOA_RULES" "zone-system.md" ".claude/**"
    create_rule "$LOA_RULES" "zone-state.md" "grimoires/**" ".run/**"

    # Empty project rules dir (already empty from setup)
    run "$SCRIPT" --loa-rules "$LOA_RULES" --project-rules "$PROJECT_RULES" --json
    [ "$status" -eq 0 ]

    local merge_safe conflicts_count
    merge_safe=$(echo "$output" | jq -r '.merge_safe')
    conflicts_count=$(echo "$output" | jq '.conflicts | length')
    loa_count=$(echo "$output" | jq '.non_conflicting.loa_only | length')

    [ "$merge_safe" = "true" ]
    [ "$conflicts_count" -eq 0 ]
    [ "$loa_count" -eq 2 ]
}

# MC-T2: Non-overlapping rules → both listed, no conflicts, merge_safe: true
@test "MC-T2: non-overlapping rules produce no conflicts" {
    create_rule "$LOA_RULES" "zone-system.md" ".claude/**"
    create_rule "$LOA_RULES" "zone-state.md" "grimoires/**" ".run/**"
    create_rule "$PROJECT_RULES" "custom-lint.md" "src/**" "lib/**"

    run "$SCRIPT" --loa-rules "$LOA_RULES" --project-rules "$PROJECT_RULES" --json
    [ "$status" -eq 0 ]

    local merge_safe conflicts_count loa_count project_count
    merge_safe=$(echo "$output" | jq -r '.merge_safe')
    conflicts_count=$(echo "$output" | jq '.conflicts | length')
    loa_count=$(echo "$output" | jq '.non_conflicting.loa_only | length')
    project_count=$(echo "$output" | jq '.non_conflicting.project_only | length')

    [ "$merge_safe" = "true" ]
    [ "$conflicts_count" -eq 0 ]
    [ "$loa_count" -eq 2 ]
    [ "$project_count" -eq 1 ]
}

# MC-T3: Overlapping path patterns → conflict detected, resolution: project_wins
@test "MC-T3: overlapping paths produce conflict with project_wins resolution" {
    create_rule "$LOA_RULES" "zone-state.md" "grimoires/**" ".run/**"
    create_rule "$PROJECT_RULES" "my-state.md" "grimoires/**" "data/**"

    run "$SCRIPT" --loa-rules "$LOA_RULES" --project-rules "$PROJECT_RULES" --json
    [ "$status" -eq 0 ]

    local merge_safe conflicts_count resolution path_pattern
    merge_safe=$(echo "$output" | jq -r '.merge_safe')
    conflicts_count=$(echo "$output" | jq '.conflicts | length')

    [ "$merge_safe" = "true" ]
    [ "$conflicts_count" -eq 1 ]

    resolution=$(echo "$output" | jq -r '.conflicts[0].resolution')
    path_pattern=$(echo "$output" | jq -r '.conflicts[0].path_pattern')
    loa_rule=$(echo "$output" | jq -r '.conflicts[0].loa_rule')
    project_rule=$(echo "$output" | jq -r '.conflicts[0].project_rule')

    [ "$resolution" = "project_wins" ]
    [ "$path_pattern" = "grimoires/**" ]
    [ "$loa_rule" = "zone-state.md" ]
    [ "$project_rule" = "my-state.md" ]
}

# MC-T4: Multi-file overlap (3+ files with same path) → hard-fail, merge_safe: false
@test "MC-T4: multi-file overlap triggers hard failure and merge_safe false" {
    create_rule "$LOA_RULES" "zone-state.md" "grimoires/**"
    create_rule "$LOA_RULES" "zone-extra.md" "grimoires/**"
    create_rule "$PROJECT_RULES" "my-state.md" "grimoires/**"

    run "$SCRIPT" --loa-rules "$LOA_RULES" --project-rules "$PROJECT_RULES" --json
    [ "$status" -eq 1 ]

    local merge_safe hard_failures_count
    merge_safe=$(echo "$output" | jq -r '.merge_safe')
    hard_failures_count=$(echo "$output" | jq '.hard_failures | length')

    [ "$merge_safe" = "false" ]
    [ "$hard_failures_count" -eq 1 ]

    local reason path_pattern
    reason=$(echo "$output" | jq -r '.hard_failures[0].reason')
    path_pattern=$(echo "$output" | jq -r '.hard_failures[0].path_pattern')

    [ "$reason" = "multi_file_overlap" ]
    [ "$path_pattern" = "grimoires/**" ]
}

# MC-T5: Unparseable project rule (no frontmatter) → warn and skip that file
@test "MC-T5: unparseable rule file is warned and skipped" {
    create_rule "$LOA_RULES" "zone-system.md" ".claude/**"

    # Create a project rule with no frontmatter
    cat > "$PROJECT_RULES/bad-rule.md" << 'EOF'
# This rule has no YAML frontmatter
Just plain markdown content.
EOF

    run "$SCRIPT" --loa-rules "$LOA_RULES" --project-rules "$PROJECT_RULES" --json
    [ "$status" -eq 0 ]

    local merge_safe warnings_count
    merge_safe=$(echo "$output" | jq -r '.merge_safe')
    warnings_count=$(echo "$output" | jq '.warnings | length')

    [ "$merge_safe" = "true" ]
    [ "$warnings_count" -eq 1 ]

    local warning_text
    warning_text=$(echo "$output" | jq -r '.warnings[0]')
    [[ "$warning_text" == *"bad-rule.md"* ]]
}
