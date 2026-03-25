#!/usr/bin/env bats
# =============================================================================
# agent-teams-hooks.bats — Agent Teams hook compatibility tests (FR-6)
# =============================================================================
# Validates that Loa safety hooks don't interfere with Claude Code's
# TeammateIdle and TaskCompleted events, and correctly enforce team roles.
# Part of cycle-049: Upstream Platform Alignment.

setup() {
    export PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."
    export HOOKS_DIR="$PROJECT_ROOT/.claude/hooks/safety"
}

teardown() {
    unset LOA_TEAM_MEMBER 2>/dev/null || true
}

# =========================================================================
# T1: TeammateIdle/TaskCompleted event passthrough
# =========================================================================

@test "block-destructive-bash passes through non-command input" {
    run bash -c 'echo "{\"tool_name\":\"TeammateIdle\",\"tool_input\":{}}" | "$1"' _ "$HOOKS_DIR/block-destructive-bash.sh"
    [ "$status" -eq 0 ]
}

# =========================================================================
# T2-T3: Team role guard — teammate vs lead
# =========================================================================

@test "team-role-guard blocks teammate br commands" {
    export LOA_TEAM_MEMBER="teammate-1"
    run bash -c 'echo "{\"tool_input\":{\"command\":\"br create task-1\"}}" | "$1"' _ "$HOOKS_DIR/team-role-guard.sh"
    [ "$status" -eq 2 ]
}

@test "team-role-guard allows lead br commands (no LOA_TEAM_MEMBER)" {
    unset LOA_TEAM_MEMBER
    run bash -c 'echo "{\"tool_input\":{\"command\":\"br create task-1\"}}" | "$1"' _ "$HOOKS_DIR/team-role-guard.sh"
    [ "$status" -eq 0 ]
}

# =========================================================================
# T4: Team skill guard
# =========================================================================

@test "team-skill-guard blocks teammate planning skills" {
    export LOA_TEAM_MEMBER="teammate-1"
    run bash -c 'echo "{\"tool_input\":{\"skill\":\"plan-and-analyze\"}}" | "$1"' _ "$HOOKS_DIR/team-skill-guard.sh"
    [ "$status" -eq 2 ]
}

# =========================================================================
# T5-T6: Team role guard — System Zone vs App Zone writes
# =========================================================================

@test "team-role-guard-write blocks teammate System Zone writes" {
    export LOA_TEAM_MEMBER="teammate-1"
    run bash -c 'echo "{\"tool_input\":{\"file_path\":\".claude/settings.json\"}}" | "$1"' _ "$HOOKS_DIR/team-role-guard-write.sh"
    [ "$status" -eq 2 ]
}

@test "team-role-guard-write allows teammate App Zone writes" {
    unset LOA_TEAM_MEMBER 2>/dev/null || true
    export LOA_TEAM_MEMBER="teammate-1"
    run bash -c 'echo "{\"tool_input\":{\"file_path\":\"src/index.ts\"}}" | "$1"' _ "$HOOKS_DIR/team-role-guard-write.sh"
    [ "$status" -eq 0 ]
}

# =========================================================================
# T7-T8: Red Team ATK-011 — LOA_TEAM_MEMBER unset bypass
# =========================================================================

@test "team-role-guard blocks compound command with br (unset attempt)" {
    export LOA_TEAM_MEMBER="teammate-1"
    run bash -c 'echo "{\"tool_input\":{\"command\":\"unset LOA_TEAM_MEMBER && br create task-1\"}}" | "$1"' _ "$HOOKS_DIR/team-role-guard.sh"
    # The br pattern matches against the full command string
    [ "$status" -eq 2 ]
}

@test "team-role-guard blocks env wrapper with git push" {
    export LOA_TEAM_MEMBER="teammate-1"
    run bash -c 'echo "{\"tool_input\":{\"command\":\"env -u LOA_TEAM_MEMBER git push origin main\"}}" | "$1"' _ "$HOOKS_DIR/team-role-guard.sh"
    # The git push pattern matches against the full command string
    [ "$status" -eq 2 ]
}
