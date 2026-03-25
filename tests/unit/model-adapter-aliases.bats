#!/usr/bin/env bats
# =============================================================================
# model-adapter-aliases.bats — Backward compat alias verification (FR-3)
# =============================================================================
# Verifies deprecated Opus model IDs resolve correctly through all maps.
# Part of cycle-049: Upstream Platform Alignment.

setup() {
    export PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
    export SCRIPT_DIR="$PROJECT_ROOT/.claude/scripts"
    export FLATLINE_MOCK_MODE=true
}

# Helper: dry-run a model and capture the resolved model ID from stderr
resolve_model() {
    local model="$1"
    "$SCRIPT_DIR/model-adapter.sh.legacy" \
        --model "$model" --mode review \
        --input "$PROJECT_ROOT/grimoires/loa/prd.md" \
        --dry-run 2>&1 | grep -oP 'Model: \S+ \(\K[^)]+' || echo "RESOLVE_FAILED"
}

# Helper: dry-run and check exit code (0 = validation passed + dry-run ok)
validate_model() {
    local model="$1"
    "$SCRIPT_DIR/model-adapter.sh.legacy" \
        --model "$model" --mode review \
        --input "$PROJECT_ROOT/grimoires/loa/prd.md" \
        --dry-run > /dev/null 2>&1
}

# T1: Registry validation passes with all entries
@test "validate_model_registry passes with no errors" {
    validate_model "opus"
}

# T2: claude-opus-4-0 resolves to claude-opus-4-6
@test "claude-opus-4-0 resolves to claude-opus-4-6" {
    result=$(resolve_model "claude-opus-4-0")
    [ "$result" = "claude-opus-4-6" ]
}

# T3: claude-opus-4-1 resolves to claude-opus-4-6
@test "claude-opus-4-1 resolves to claude-opus-4-6" {
    result=$(resolve_model "claude-opus-4-1")
    [ "$result" = "claude-opus-4-6" ]
}

# T4: claude-opus-4.0 (dotted) resolves to claude-opus-4-6
@test "claude-opus-4.0 resolves to claude-opus-4-6" {
    result=$(resolve_model "claude-opus-4.0")
    [ "$result" = "claude-opus-4-6" ]
}

# T5: claude-opus-4.1 (dotted) resolves to claude-opus-4-6
@test "claude-opus-4.1 resolves to claude-opus-4-6" {
    result=$(resolve_model "claude-opus-4.1")
    [ "$result" = "claude-opus-4-6" ]
}

# T6: claude-opus-4-5 (hyphenated) resolves to claude-opus-4-6
@test "claude-opus-4-5 resolves to claude-opus-4-6" {
    result=$(resolve_model "claude-opus-4-5")
    [ "$result" = "claude-opus-4-6" ]
}

# T7: Existing claude-opus-4.5 alias unchanged (regression)
@test "existing claude-opus-4.5 alias still resolves to claude-opus-4-6" {
    result=$(resolve_model "claude-opus-4.5")
    [ "$result" = "claude-opus-4-6" ]
}

# T8: MODEL_TO_ALIAS in v2 shim resolves for new keys
@test "v2 shim MODEL_TO_ALIAS contains new aliases" {
    # Check that the v2 shim file contains all new keys
    for key in "claude-opus-4-5" "claude-opus-4.1" "claude-opus-4-1" "claude-opus-4.0" "claude-opus-4-0"; do
        grep -q "\"$key\"" "$SCRIPT_DIR/model-adapter.sh" || {
            echo "Missing key in v2 shim: $key"
            return 1
        }
    done
}

# T9: Existing opus shorthand still works (regression)
@test "existing opus shorthand resolves to claude-opus-4-6" {
    result=$(resolve_model "opus")
    [ "$result" = "claude-opus-4-6" ]
}

# T10: Unknown model fails with exit 2
@test "unknown model claude-opus-99 fails validation" {
    run "$SCRIPT_DIR/model-adapter.sh.legacy" \
        --model "claude-opus-99" --mode review \
        --input "$PROJECT_ROOT/grimoires/loa/prd.md" \
        --dry-run
    [ "$status" -eq 2 ]
}
