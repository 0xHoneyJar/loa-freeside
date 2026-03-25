#!/usr/bin/env bats
# =============================================================================
# rule-lifecycle.bats — Tests for validate-rule-lifecycle.sh
# =============================================================================
# Part of cycle-050: Multi-Model Permission Architecture (FR-2)

setup() {
    export PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
    VALIDATOR="$PROJECT_ROOT/.claude/scripts/validate-rule-lifecycle.sh"
    FIXTURE_DIR="$BATS_TEST_TMPDIR/rules"
    mkdir -p "$FIXTURE_DIR"
    export RULES_DIR="$FIXTURE_DIR"
}

teardown() {
    rm -rf "$BATS_TEST_TMPDIR/rules" 2>/dev/null || true
}

# =========================================================================
# RL-T1: Valid lifecycle passes
# =========================================================================

@test "rule with valid origin, version, enacted_by passes" {
    cat > "$FIXTURE_DIR/test-rule.md" << 'EOF'
---
paths:
  - "src/**"
origin: enacted
version: 1
enacted_by: cycle-050
---
# Test Rule
EOF

    run "$VALIDATOR"
    [ "$status" -eq 0 ]
}

# =========================================================================
# RL-T2: Missing origin fails
# =========================================================================

@test "rule with missing origin fails" {
    cat > "$FIXTURE_DIR/no-origin.md" << 'EOF'
---
paths:
  - "src/**"
version: 1
enacted_by: cycle-050
---
# No Origin
EOF

    run "$VALIDATOR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Missing origin"* ]]
}

# =========================================================================
# RL-T3: Missing version fails
# =========================================================================

@test "rule with missing version fails" {
    cat > "$FIXTURE_DIR/no-version.md" << 'EOF'
---
paths:
  - "src/**"
origin: genesis
enacted_by: cycle-050
---
# No Version
EOF

    run "$VALIDATOR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Missing version"* ]]
}

# =========================================================================
# RL-T4: Missing enacted_by fails
# =========================================================================

@test "rule with missing enacted_by fails" {
    cat > "$FIXTURE_DIR/no-enacted.md" << 'EOF'
---
paths:
  - "src/**"
origin: genesis
version: 1
---
# No Enacted By
EOF

    run "$VALIDATOR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Missing enacted_by"* ]]
}
