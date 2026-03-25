#!/usr/bin/env bats
# =============================================================================
# cross-platform-validation.bats — Cross-platform compat-lib validation
# =============================================================================
# Part of cycle-051, Sprint 106: Integration + E2E Validation
#
# Smoke tests verifying that the three new scripts source the correct
# shared libraries and avoid bare platform-specific commands.
#
# Tests:
#   1.  construct-index-gen.sh sources compat-lib.sh
#   2.  construct-resolve.sh sources yq-safe.sh
#   3.  archetype-resolver.sh sources both compat-lib.sh and yq-safe.sh
#   4.  No bare stat -c usage without compat-lib wrappers
#   5.  No bare date -d usage without compat-lib wrappers
#   6.  No bare readlink -f usage without compat-lib wrappers

setup() {
    export BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    export PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    export SCRIPTS_DIR="$PROJECT_ROOT/.claude/scripts"
}

# =============================================================================
# T1: construct-index-gen.sh sources compat-lib.sh
# =============================================================================

@test "T1: construct-index-gen.sh sources compat-lib.sh" {
    run grep -c 'source.*compat-lib\.sh' "$SCRIPTS_DIR/construct-index-gen.sh"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
}

# =============================================================================
# T2: construct-resolve.sh sources yq-safe.sh
# =============================================================================

@test "T2: construct-resolve.sh sources yq-safe.sh" {
    run grep -c 'source.*yq-safe\.sh' "$SCRIPTS_DIR/construct-resolve.sh"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
}

# =============================================================================
# T3: archetype-resolver.sh sources both compat-lib.sh and yq-safe.sh
# =============================================================================

@test "T3: archetype-resolver.sh sources both compat-lib.sh and yq-safe.sh" {
    run grep -c 'source.*compat-lib\.sh' "$SCRIPTS_DIR/archetype-resolver.sh"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]

    run grep -c 'source.*yq-safe\.sh' "$SCRIPTS_DIR/archetype-resolver.sh"
    [ "$status" -eq 0 ]
    [ "$output" -ge 1 ]
}

# =============================================================================
# T4: No bare stat -c usage in the three scripts
# =============================================================================

@test "T4: no bare 'stat -c' in construct scripts" {
    # grep returns exit 1 when no match (which is what we want)
    for script in construct-index-gen.sh construct-resolve.sh archetype-resolver.sh; do
        run grep -n 'stat -c' "$SCRIPTS_DIR/$script"
        # Exit 1 = no match found (good — no bare stat -c)
        [ "$status" -eq 1 ]
    done
}

# =============================================================================
# T5: No bare date -d usage in the three scripts
# =============================================================================

@test "T5: no bare 'date -d' in construct scripts" {
    for script in construct-index-gen.sh construct-resolve.sh archetype-resolver.sh; do
        # Allow 'date -d' inside comments (lines starting with #) but not in code
        # grep -v filters out comment lines first
        run bash -c "grep -v '^\s*#' '$SCRIPTS_DIR/$script' | grep -n 'date -d '"
        # Exit 1 = no match found (good)
        [ "$status" -eq 1 ]
    done
}

# =============================================================================
# T6: No bare readlink -f usage in the three scripts
# =============================================================================

@test "T6: no bare 'readlink -f' in construct scripts" {
    for script in construct-index-gen.sh construct-resolve.sh archetype-resolver.sh; do
        run grep -n 'readlink -f' "$SCRIPTS_DIR/$script"
        # Exit 1 = no match found (good)
        [ "$status" -eq 1 ]
    done
}
