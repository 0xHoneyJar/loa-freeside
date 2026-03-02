#!/usr/bin/env bats
# =============================================================================
# Tests for run_with_timeout() — cross-platform timeout helper (FR-5)
# =============================================================================
# Cycle: cycle-048 (Community Feedback — Review Pipeline Hardening)
# Tests: fallback chain (timeout -> gtimeout -> perl -> none),
#        timeout fires correctly, exit code preserved.
#
# Strategy: PATH manipulation to control which timeout binary is available.
# Each test creates a minimal PATH with only the tools it wants visible.

setup() {
    BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    SCRIPT_DIR="$PROJECT_ROOT/.claude/scripts"

    export BATS_TMPDIR="${BATS_TMPDIR:-/tmp}"
    export TEST_TMPDIR="$BATS_TMPDIR/run-with-timeout-test-$$"
    mkdir -p "$TEST_TMPDIR"
    mkdir -p "$TEST_TMPDIR/bin"

    # Save original PATH for restoration
    ORIG_PATH="$PATH"

    # We need to re-source compat-lib.sh per test since we modify PATH.
    # Reset the double-source guard so it can be loaded again.
    unset _COMPAT_LIB_LOADED
}

teardown() {
    # Restore original PATH
    export PATH="$ORIG_PATH"
    cd /
    if [[ -d "$TEST_TMPDIR" ]]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# Helper: create a minimal PATH that includes only core utilities
# (bash, cat, echo, etc.) but NOT timeout/gtimeout/perl
_build_minimal_path() {
    # Include /usr/bin and /bin for core utilities
    echo "/usr/bin:/bin"
}

# Helper: create a fake 'timeout' shim that wraps the real one
_create_timeout_shim() {
    local shim_dir="$1"
    cat > "$shim_dir/timeout" << 'SHIM'
#!/usr/bin/env bash
# Shim that behaves like GNU timeout
# Uses the real timeout if available on the original PATH
exec /usr/bin/timeout "$@"
SHIM
    chmod +x "$shim_dir/timeout"
}

# Helper: create a fake 'gtimeout' shim
_create_gtimeout_shim() {
    local shim_dir="$1"
    cat > "$shim_dir/gtimeout" << 'SHIM'
#!/usr/bin/env bash
# Shim that behaves like gtimeout (Homebrew coreutils)
# Delegates to the real timeout binary
exec /usr/bin/timeout "$@"
SHIM
    chmod +x "$shim_dir/gtimeout"
}

# =============================================================================
# Fallback Chain Tests — PATH manipulation
# =============================================================================

@test "run_with_timeout: uses 'timeout' when available on PATH" {
    # Create a shim directory with a custom 'timeout' that leaves a breadcrumb
    local shim_dir="$TEST_TMPDIR/shim-timeout"
    mkdir -p "$shim_dir"
    cat > "$shim_dir/timeout" << SHIM
#!/usr/bin/env bash
# Custom timeout shim — leave breadcrumb proving we were called
echo "TIMEOUT_SHIM_CALLED" > "$TEST_TMPDIR/breadcrumb"
shift  # skip timeout value
exec "\$@"
SHIM
    chmod +x "$shim_dir/timeout"

    # PATH: shim dir first, then core utilities (no gtimeout, perl may exist)
    export PATH="$shim_dir:/usr/bin:/bin"
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    run_with_timeout 5 true
    [ -f "$TEST_TMPDIR/breadcrumb" ]
    local content
    content=$(cat "$TEST_TMPDIR/breadcrumb")
    [ "$content" = "TIMEOUT_SHIM_CALLED" ]
}

@test "run_with_timeout: uses 'gtimeout' when 'timeout' is absent" {
    # Create shim dir with only gtimeout
    local shim_dir="$TEST_TMPDIR/shim-gtimeout"
    mkdir -p "$shim_dir"
    cat > "$shim_dir/gtimeout" << SHIM
#!/usr/bin/env bash
# Custom gtimeout shim — leave breadcrumb proving we were called
echo "GTIMEOUT_SHIM_CALLED" > "$TEST_TMPDIR/breadcrumb"
shift  # skip timeout value
exec "\$@"
SHIM
    chmod +x "$shim_dir/gtimeout"

    # PATH: shim dir (no 'timeout'), plus core utilities
    # We need to ensure 'timeout' is NOT on PATH
    local clean_path="$shim_dir"
    # Add /usr/bin and /bin but shadow timeout by not including it
    # Create a filtered bin directory without timeout
    local filtered_dir="$TEST_TMPDIR/filtered-bin"
    mkdir -p "$filtered_dir"
    # Link essential binaries but NOT timeout
    for bin in bash cat echo true false sleep; do
        for dir in /usr/bin /bin; do
            if [ -x "$dir/$bin" ]; then
                ln -sf "$dir/$bin" "$filtered_dir/$bin" 2>/dev/null || true
                break
            fi
        done
    done

    export PATH="$shim_dir:$filtered_dir"
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    run_with_timeout 5 true
    [ -f "$TEST_TMPDIR/breadcrumb" ]
    local content
    content=$(cat "$TEST_TMPDIR/breadcrumb")
    [ "$content" = "GTIMEOUT_SHIM_CALLED" ]
}

@test "run_with_timeout: uses perl fallback when timeout and gtimeout are absent" {
    # Create a PATH with only perl + essential binaries (no timeout, no gtimeout)
    local filtered_dir="$TEST_TMPDIR/filtered-perl"
    mkdir -p "$filtered_dir"
    # Link perl and essential binaries
    for bin in perl bash cat echo true false sleep; do
        for dir in /usr/bin /bin; do
            if [ -x "$dir/$bin" ]; then
                ln -sf "$dir/$bin" "$filtered_dir/$bin" 2>/dev/null || true
                break
            fi
        done
    done

    export PATH="$filtered_dir"
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    # Verify timeout/gtimeout are NOT on PATH
    ! command -v timeout &>/dev/null
    ! command -v gtimeout &>/dev/null
    command -v perl &>/dev/null

    # Run a simple command through perl fallback
    local result
    result=$(run_with_timeout 5 echo "perl_fallback_works")
    [ "$result" = "perl_fallback_works" ]
}

@test "run_with_timeout: warns and runs without timeout when nothing available" {
    # Create a minimal PATH with NO timeout, gtimeout, or perl
    local filtered_dir="$TEST_TMPDIR/filtered-bare"
    mkdir -p "$filtered_dir"
    for bin in bash cat echo true false; do
        for dir in /usr/bin /bin; do
            if [ -x "$dir/$bin" ]; then
                ln -sf "$dir/$bin" "$filtered_dir/$bin" 2>/dev/null || true
                break
            fi
        done
    done

    export PATH="$filtered_dir"
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    # Verify none of the timeout mechanisms are on PATH
    ! command -v timeout &>/dev/null
    ! command -v gtimeout &>/dev/null
    ! command -v perl &>/dev/null

    # Should warn on stderr and run the command anyway
    run run_with_timeout 5 echo "no_timeout_works"
    [ "$status" -eq 0 ]
    [[ "$output" == *"WARNING"* ]]
    [[ "$output" == *"no_timeout_works"* ]]
}

# =============================================================================
# Timeout Fires Tests
# =============================================================================

@test "run_with_timeout: command killed after timeout (exit 124)" {
    # Use the real timeout (from system PATH)
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    # sleep 60 should be killed after 1 second
    run run_with_timeout 1 sleep 60
    [ "$status" -eq 124 ]
}

@test "run_with_timeout: perl fallback returns exit 124 on timeout" {
    # Create PATH with only perl (no timeout/gtimeout)
    local filtered_dir="$TEST_TMPDIR/filtered-perl-timeout"
    mkdir -p "$filtered_dir"
    for bin in perl bash sleep; do
        for dir in /usr/bin /bin; do
            if [ -x "$dir/$bin" ]; then
                ln -sf "$dir/$bin" "$filtered_dir/$bin" 2>/dev/null || true
                break
            fi
        done
    done

    export PATH="$filtered_dir"
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    # Verify we're using perl fallback
    ! command -v timeout &>/dev/null
    ! command -v gtimeout &>/dev/null
    command -v perl &>/dev/null

    # sleep 60 should be killed after 1 second with exit 124
    run run_with_timeout 1 sleep 60
    [ "$status" -eq 124 ]
}

# =============================================================================
# Exit Code Preservation Tests
# =============================================================================

@test "run_with_timeout: preserves exit code 0 on success" {
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    run run_with_timeout 5 true
    [ "$status" -eq 0 ]
}

@test "run_with_timeout: preserves non-zero exit code from command" {
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    run run_with_timeout 5 false
    [ "$status" -eq 1 ]
}

@test "run_with_timeout: preserves specific exit code (exit 42)" {
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    run run_with_timeout 5 bash -c 'exit 42'
    [ "$status" -eq 42 ]
}

@test "run_with_timeout: preserves exit code via perl fallback" {
    # Create PATH with only perl (no timeout/gtimeout)
    local filtered_dir="$TEST_TMPDIR/filtered-perl-exit"
    mkdir -p "$filtered_dir"
    for bin in perl bash; do
        for dir in /usr/bin /bin; do
            if [ -x "$dir/$bin" ]; then
                ln -sf "$dir/$bin" "$filtered_dir/$bin" 2>/dev/null || true
                break
            fi
        done
    done

    export PATH="$filtered_dir"
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    # Verify perl fallback
    ! command -v timeout &>/dev/null
    command -v perl &>/dev/null

    run run_with_timeout 5 bash -c 'exit 42'
    [ "$status" -eq 42 ]
}

# =============================================================================
# Output Preservation Tests
# =============================================================================

@test "run_with_timeout: stdout passthrough works" {
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    local result
    result=$(run_with_timeout 5 echo "hello world")
    [ "$result" = "hello world" ]
}

@test "run_with_timeout: multi-argument command works" {
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    local result
    result=$(run_with_timeout 5 printf "%s %s" "foo" "bar")
    [ "$result" = "foo bar" ]
}

# =============================================================================
# Runtime Detection Tests
# =============================================================================

@test "run_with_timeout: runtime detection allows PATH changes between calls" {
    # First call: use a shim that leaves breadcrumb "call1"
    local shim1="$TEST_TMPDIR/shim1"
    mkdir -p "$shim1"
    cat > "$shim1/timeout" << SHIM
#!/usr/bin/env bash
echo "CALL1" > "$TEST_TMPDIR/detection"
shift; exec "\$@"
SHIM
    chmod +x "$shim1/timeout"

    export PATH="$shim1:/usr/bin:/bin"
    unset _COMPAT_LIB_LOADED
    source "$SCRIPT_DIR/compat-lib.sh"

    run_with_timeout 5 true
    [ "$(cat "$TEST_TMPDIR/detection")" = "CALL1" ]

    # Second call: change PATH to use a different shim
    local shim2="$TEST_TMPDIR/shim2"
    mkdir -p "$shim2"
    cat > "$shim2/timeout" << SHIM
#!/usr/bin/env bash
echo "CALL2" > "$TEST_TMPDIR/detection"
shift; exec "\$@"
SHIM
    chmod +x "$shim2/timeout"

    export PATH="$shim2:/usr/bin:/bin"
    # Do NOT re-source — runtime detection should pick up new PATH
    run_with_timeout 5 true
    [ "$(cat "$TEST_TMPDIR/detection")" = "CALL2" ]
}
