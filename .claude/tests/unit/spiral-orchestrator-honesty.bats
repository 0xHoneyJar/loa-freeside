#!/usr/bin/env bats
# =============================================================================
# spiral-orchestrator-honesty.bats — G2 / G-HONEST negative tests
# =============================================================================
# The autonomous spiral engine must NOT be able to bank FABRICATED convergence.
# Two honesty invariants are pinned here (each FAILS on the pre-fix code):
#
#   1. Real dispatch is the DEFAULT. A no-env overnight run must NOT silently
#      resolve to the STUB dispatcher (the foot-gun: an unattended loop banking
#      convergence over fabricated stub output).
#
#   2. A stub run is NON-BANKABLE. When the stub IS explicitly invoked
#      (SPIRAL_USE_STUB=1, for plumbing tests), it must not emit an APPROVED
#      verdict that the quality gate can bank as a passed/converged cycle. Its
#      cycle-outcome verdicts must be null (→ quality gate fail-closed STOP),
#      never APPROVED.
#
# Bead: arrakis-estate-immune-epic-4xw6.3 (G2 / G-HONEST)
# =============================================================================

setup() {
    SCRIPT_DIR_T="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    PROJECT_ROOT_T="$(git -C "$SCRIPT_DIR_T" rev-parse --show-toplevel)"
    ORCH="$PROJECT_ROOT_T/.claude/scripts/spiral-orchestrator.sh"

    # Source the orchestrator (main-guard prevents main() from running).
    # shellcheck disable=SC1090
    source "$ORCH"

    TEST_CYCLE_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$TEST_CYCLE_DIR"
}

# --- Invariant 1: real dispatch is the default (foot-gun closed) -------------

@test "dispatch mode defaults to REAL when no env vars are set" {
    unset SPIRAL_USE_STUB SPIRAL_REAL_DISPATCH 2>/dev/null || true
    run _resolve_dispatch_mode
    [ "$status" -eq 0 ]
    # The fabricated-convergence foot-gun: the silent default must NEVER be STUB.
    [ "$output" = "REAL" ]
}

@test "explicit SPIRAL_USE_STUB=1 still selects STUB (opt-in preserved)" {
    SPIRAL_USE_STUB=1 run _resolve_dispatch_mode
    [ "$status" -eq 0 ]
    [[ "$output" == *"STUB"* ]]
}

@test "SPIRAL_REAL_DISPATCH=1 resolves to REAL (back-compat)" {
    unset SPIRAL_USE_STUB 2>/dev/null || true
    SPIRAL_REAL_DISPATCH=1 run _resolve_dispatch_mode
    [ "$status" -eq 0 ]
    [ "$output" = "REAL" ]
}

# --- Invariant 2: a stub run cannot be banked as convergence -----------------

@test "stub does not write a bankable APPROVED review verdict" {
    _simstim_stub "$TEST_CYCLE_DIR" "cycle-honesty-test"
    # The pre-fix stub wrote 'APPROVED' as the verdict — that is exactly the
    # fabricated convergence this invariant forbids.
    run grep -E '^APPROVED$' "$TEST_CYCLE_DIR/reviewer.md"
    [ "$status" -ne 0 ]
}

@test "stub cycle-outcome verdicts are JSON null + exit_status failed (non-bankable)" {
    _simstim_stub "$TEST_CYCLE_DIR" "cycle-honesty-test"
    sidecar="$TEST_CYCLE_DIR/cycle-outcome.json"
    [ -f "$sidecar" ]
    # jq -e distinguishes JSON null from the string "null": a string verdict
    # would be a schema violation the weaker `-r` check would silently pass.
    # exit_status pinned to exactly "failed" (not merely "not success").
    run jq -e '.review_verdict == null and .audit_verdict == null and .exit_status == "failed"' "$sidecar"
    [ "$status" -eq 0 ]
}

@test "a stub cycle fail-closes the quality gate (cannot bank convergence end-to-end)" {
    # stub → harvest → quality gate. Null verdicts must STOP the spiral, never
    # record an APPROVED, converged cycle. This pins the BEHAVIOR, not just the
    # sidecar fields.
    _simstim_stub "$TEST_CYCLE_DIR" "cycle-e2e"
    harvest="$(harvest_phase "$TEST_CYCLE_DIR" "cycle-e2e")"
    # The harvested cycle record must carry null verdicts (tier-1 sidecar wins).
    run jq -e '.review_verdict == null and .audit_verdict == null' <<<"$harvest"
    [ "$status" -eq 0 ]
    # Drive check_quality_gate over a state whose last cycle is this harvest.
    STATE_FILE="$TEST_CYCLE_DIR/state.json"
    jq -n --argjson h "$harvest" '{cycles: [$h]}' > "$STATE_FILE"
    # Returns 0 == STOP (fail-closed on null verdict) — convergence not banked.
    run check_quality_gate
    [ "$status" -eq 0 ]
}

@test "dispatch-script stub also writes a non-bankable (null-verdict) sidecar" {
    dispatch="$PROJECT_ROOT_T/.claude/scripts/spiral-simstim-dispatch.sh"
    run env SPIRAL_USE_STUB=1 PROJECT_ROOT="$TEST_CYCLE_DIR" \
        "$dispatch" "$TEST_CYCLE_DIR/dc" "cycle-dispatch"
    [ "$status" -eq 0 ]
    sidecar="$TEST_CYCLE_DIR/dc/cycle-outcome.json"
    [ -f "$sidecar" ]
    run jq -e '.review_verdict == null and .audit_verdict == null and .exit_status == "failed"' "$sidecar"
    [ "$status" -eq 0 ]
}

@test "stub reviewer.md is loudly marked NOT REAL / NOT BANKABLE" {
    _simstim_stub "$TEST_CYCLE_DIR" "cycle-honesty-test"
    run grep -iE "stub|not bankable|not real|fabricated" "$TEST_CYCLE_DIR/reviewer.md"
    [ "$status" -eq 0 ]
}
