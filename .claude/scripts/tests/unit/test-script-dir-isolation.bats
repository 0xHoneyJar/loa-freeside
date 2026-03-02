#!/usr/bin/env bats
# test-script-dir-isolation.bats — Regression test for bug-432
# Ensures that sourcing lib/ files does NOT clobber a caller's SCRIPT_DIR.

setup() {
    export PROJECT_ROOT="$BATS_TEST_TMPDIR"
    mkdir -p "$BATS_TEST_TMPDIR/grimoires/loa/a2a/compound"
    mkdir -p "$BATS_TEST_TMPDIR/grimoires/loa/a2a/events"
}

# Helper: source a lib file and check that SCRIPT_DIR survives
assert_script_dir_preserved() {
    local lib_file="$1"
    local caller_dir="/some/caller/directory"

    # Set SCRIPT_DIR as a caller would
    SCRIPT_DIR="$caller_dir"

    # Source the library
    source "$lib_file"

    # Verify SCRIPT_DIR was NOT overwritten
    if [[ "$SCRIPT_DIR" != "$caller_dir" ]]; then
        echo "SCRIPT_DIR was clobbered by $(basename "$lib_file")"
        echo "  Expected: $caller_dir"
        echo "  Got:      $SCRIPT_DIR"
        return 1
    fi
    return 0
}

@test "sourcing context-isolation-lib.sh preserves caller SCRIPT_DIR" {
    assert_script_dir_preserved "$BATS_TEST_DIRNAME/../../lib/context-isolation-lib.sh"
}

@test "sourcing api-resilience.sh preserves caller SCRIPT_DIR" {
    assert_script_dir_preserved "$BATS_TEST_DIRNAME/../../lib/api-resilience.sh"
}

@test "sourcing event-bus.sh preserves caller SCRIPT_DIR" {
    assert_script_dir_preserved "$BATS_TEST_DIRNAME/../../lib/event-bus.sh"
}

@test "sourcing schema-validator.sh preserves caller SCRIPT_DIR" {
    assert_script_dir_preserved "$BATS_TEST_DIRNAME/../../lib/schema-validator.sh"
}

@test "sourcing event-registry.sh preserves caller SCRIPT_DIR" {
    assert_script_dir_preserved "$BATS_TEST_DIRNAME/../../lib/event-registry.sh"
}

@test "sourcing validation-history.sh preserves caller SCRIPT_DIR" {
    assert_script_dir_preserved "$BATS_TEST_DIRNAME/../../lib/validation-history.sh"
}

@test "no lib file in .claude/scripts/lib/ uses bare SCRIPT_DIR assignment" {
    local lib_dir="$BATS_TEST_DIRNAME/../../lib"
    # Check that no lib file assigns to bare SCRIPT_DIR (only prefixed variants allowed)
    # Exclude comments (lines starting with #) and usage examples
    local violations
    violations=$(grep -rn '^[^#]*SCRIPT_DIR=' "$lib_dir"/*.sh 2>/dev/null | grep -v '_.*_DIR=' || true)
    if [[ -n "$violations" ]]; then
        echo "Found bare SCRIPT_DIR assignments in lib files:"
        echo "$violations"
        return 1
    fi
}
