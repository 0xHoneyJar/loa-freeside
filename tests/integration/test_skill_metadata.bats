#!/usr/bin/env bats
# =============================================================================
# test_skill_metadata.bats — Integration tests for skill capabilities + rules
# =============================================================================
# Cross-component validation for cycle-050 Multi-Model Permission Architecture.
# Validates that all 25 skills and 3 rule files pass validation together.

setup() {
    export PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
    CAP_VALIDATOR="$PROJECT_ROOT/.claude/scripts/validate-skill-capabilities.sh"
    RULE_VALIDATOR="$PROJECT_ROOT/.claude/scripts/validate-rule-lifecycle.sh"
}

# =========================================================================
# SM-T1: All 25 skills have complete frontmatter
# =========================================================================

@test "all 25 skills have capabilities field" {
    run "$CAP_VALIDATOR" --json
    [ "$status" -eq 0 ]
    total=$(echo "$output" | jq -r '.total')
    [ "$total" -eq 25 ]
}

# =========================================================================
# SM-T2: Capabilities vs allowed-tools consistency across all skills
# =========================================================================

@test "capabilities consistency check passes across all 25 skills" {
    run "$CAP_VALIDATOR" --json
    [ "$status" -eq 0 ]
    errors=$(echo "$output" | jq -r '.errors')
    [ "$errors" -eq 0 ]
}

# =========================================================================
# SM-T3: Cost-profile assigned to all 25 skills
# =========================================================================

@test "all 25 skills have cost-profile assigned" {
    local count=0
    local missing=""
    for skill_dir in "$PROJECT_ROOT"/.claude/skills/*/; do
        [ -d "$skill_dir" ] || continue
        local name
        name=$(basename "$skill_dir")
        # Skip internal sub-skills
        case "$name" in
            flatline-reviewer|flatline-scorer|flatline-skeptic|gpt-reviewer) continue ;;
        esac
        local skill_md="$skill_dir/SKILL.md"
        [ -f "$skill_md" ] || continue
        local frontmatter
        frontmatter=$(awk '/^---$/{if(n++) exit; next} n' "$skill_md")
        local cp
        cp=$(echo "$frontmatter" | yq eval '.cost-profile // ""' - 2>/dev/null) || cp=""
        if [[ -n "$cp" && "$cp" != "null" ]]; then
            count=$((count + 1))
        else
            missing="$missing $name"
        fi
    done
    [ "$count" -eq 25 ] || {
        echo "Only $count/25 skills have cost-profile. Missing:$missing"
        false
    }
}

# =========================================================================
# SM-T4: Rule lifecycle metadata complete
# =========================================================================

@test "all rule files have lifecycle metadata" {
    run "$RULE_VALIDATOR" --json
    [ "$status" -eq 0 ]
    total=$(echo "$output" | jq -r '.total')
    [ "$total" -eq 3 ]
    errors=$(echo "$output" | jq -r '.errors')
    [ "$errors" -eq 0 ]
}

# =========================================================================
# SM-T5: Both validators interoperate (zero errors combined)
# =========================================================================

@test "both validators run together with zero errors" {
    run "$CAP_VALIDATOR" --json
    cap_status=$status
    cap_errors=$(echo "$output" | jq -r '.errors')

    run "$RULE_VALIDATOR" --json
    rule_status=$status
    rule_errors=$(echo "$output" | jq -r '.errors')

    [ "$cap_status" -eq 0 ]
    [ "$rule_status" -eq 0 ]
    [ "$cap_errors" -eq 0 ]
    [ "$rule_errors" -eq 0 ]
}
