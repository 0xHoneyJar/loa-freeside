#!/usr/bin/env bats
# Unit tests for context-manager.sh
# Part of Sprint 4: Context Management Optimization

setup() {
    # Create temp directory for test files
    export TEST_DIR="$BATS_TMPDIR/context-manager-test-$$"
    mkdir -p "$TEST_DIR"
    mkdir -p "$TEST_DIR/loa-grimoire/a2a/trajectory"
    mkdir -p "$TEST_DIR/analytics"

    # Script path
    export SCRIPT="$BATS_TEST_DIRNAME/../../.claude/scripts/context-manager.sh"

    # Create test NOTES.md with all required sections
    cat > "$TEST_DIR/loa-grimoire/NOTES.md" << 'EOF'
# NOTES.md

## Session Continuity
<!-- CRITICAL: Load this section FIRST after /clear (~100 tokens) -->

### Active Context
- **Current Bead**: bd-test-123 (Test task)
- **Last Checkpoint**: 2026-01-11T12:00:00Z
- **Reasoning State**: Testing context manager

### Lightweight Identifiers
| Identifier | Purpose | Last Verified |
|------------|---------|---------------|
| src/test.ts:10-20 | Test file | 12:00:00Z |

## Decision Log
<!-- Decisions survive context wipes - permanent record -->

### 2026-01-11T12:00:00Z - Test Decision
**Decision**: Use simplified checkpoint
**Rationale**: Reduces manual steps from 7 to 3
**Evidence**:
- `const STEPS = 3` [src/config.ts:45]
**Test Scenarios**:
1. Happy path scenario
2. Edge case scenario
3. Error handling scenario

## Active Sub-Goals
- Task 1
- Task 2
EOF

    # Create test config
    cat > "$TEST_DIR/.loa.config.yaml" << 'EOF'
context_management:
  client_compaction: true
  preserve_notes_md: true
  simplified_checkpoint: true
  auto_trajectory_log: true
  preservation_rules:
    always_preserve:
      - notes_session_continuity
      - notes_decision_log
      - trajectory_entries
      - active_beads
    compactable:
      - tool_results
      - thinking_blocks
      - verbose_debug
EOF

    # Create test trajectory file
    cat > "$TEST_DIR/loa-grimoire/a2a/trajectory/impl-$(date +%Y-%m-%d).jsonl" << 'EOF'
{"ts":"2026-01-11T12:00:00Z","agent":"implementing-tasks","action":"test"}
{"ts":"2026-01-11T12:05:00Z","agent":"implementing-tasks","action":"test2"}
EOF

    # Environment variable overrides for testing
    export CONFIG_FILE="$TEST_DIR/.loa.config.yaml"
    export NOTES_FILE="$TEST_DIR/loa-grimoire/NOTES.md"
    export GRIMOIRE_DIR="$TEST_DIR/loa-grimoire"
    export TRAJECTORY_DIR="$TEST_DIR/loa-grimoire/a2a/trajectory"
    export ANALYTICS_DIR="$TEST_DIR/analytics"
}

teardown() {
    # Clean up temp directory
    if [[ -d "$TEST_DIR" ]]; then
        rm -rf "$TEST_DIR"
    fi
}

# =============================================================================
# Basic Command Tests
# =============================================================================

@test "context-manager: shows usage with no arguments" {
    run "$SCRIPT"
    [ "$status" -eq 1 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "context-manager: shows help with --help" {
    run "$SCRIPT" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Context Manager"* ]]
    [[ "$output" == *"Commands:"* ]]
}

@test "context-manager: shows help with -h" {
    run "$SCRIPT" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Context Manager"* ]]
}

@test "context-manager: rejects unknown command" {
    run "$SCRIPT" unknown
    [ "$status" -eq 1 ]
    [[ "$output" == *"Unknown command"* ]]
}

# =============================================================================
# Status Command Tests
# =============================================================================

@test "context-manager status: shows configuration" {
    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Context Manager Status"* ]]
    [[ "$output" == *"Configuration"* ]]
}

@test "context-manager status: shows preservation status" {
    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Preservation Status"* ]]
    [[ "$output" == *"Session Continuity section present"* ]]
    [[ "$output" == *"Decision Log section present"* ]]
}

@test "context-manager status: shows trajectory entries" {
    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Trajectory entries (today): 2"* ]]
}

@test "context-manager status: --json outputs valid JSON" {
    run "$SCRIPT" status --json
    [ "$status" -eq 0 ]
    # Validate JSON structure
    echo "$output" | jq . >/dev/null 2>&1
    [ $? -eq 0 ]
    # Check expected keys
    [[ $(echo "$output" | jq -r '.config.compaction_enabled') == "true" ]]
    [[ $(echo "$output" | jq -r '.preservation.session_continuity') == "true" ]]
}

@test "context-manager status: detects missing sections" {
    # Create NOTES.md without Session Continuity
    cat > "$TEST_DIR/loa-grimoire/NOTES.md" << 'EOF'
# NOTES.md

## Active Sub-Goals
- Task 1
EOF

    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Session Continuity section missing"* ]]
}

# =============================================================================
# Rules Command Tests
# =============================================================================

@test "context-manager rules: shows preservation rules" {
    run "$SCRIPT" rules
    [ "$status" -eq 0 ]
    [[ "$output" == *"Preservation Rules"* ]]
    [[ "$output" == *"ALWAYS Preserved"* ]]
    [[ "$output" == *"COMPACTABLE"* ]]
}

@test "context-manager rules: shows all default preserved items" {
    run "$SCRIPT" rules
    [ "$status" -eq 0 ]
    [[ "$output" == *"Session Continuity"* ]]
    [[ "$output" == *"Decision Log"* ]]
    [[ "$output" == *"Trajectory entries"* ]]
    [[ "$output" == *"Active bead"* ]]
}

@test "context-manager rules: shows compactable items" {
    run "$SCRIPT" rules
    [ "$status" -eq 0 ]
    [[ "$output" == *"Tool results"* ]]
    [[ "$output" == *"Thinking blocks"* ]]
    [[ "$output" == *"Verbose debug"* ]]
}

@test "context-manager rules: --json outputs valid JSON" {
    run "$SCRIPT" rules --json
    [ "$status" -eq 0 ]
    # Validate JSON structure
    echo "$output" | jq . >/dev/null 2>&1
    [ $? -eq 0 ]
    # Check expected keys
    [[ $(echo "$output" | jq -r '.always_preserve | length') -eq 4 ]]
    [[ $(echo "$output" | jq -r '.compactable | length') -gt 0 ]]
}

# =============================================================================
# Preserve Command Tests
# =============================================================================

@test "context-manager preserve: checks all critical sections" {
    run "$SCRIPT" preserve
    [ "$status" -eq 0 ]
    [[ "$output" == *"All critical sections present"* ]]
}

@test "context-manager preserve: reports missing sections" {
    # Create NOTES.md without Decision Log
    cat > "$TEST_DIR/loa-grimoire/NOTES.md" << 'EOF'
# NOTES.md

## Session Continuity
Test content
EOF

    run "$SCRIPT" preserve
    [ "$status" -eq 0 ]
    [[ "$output" == *"Missing sections"* ]]
    [[ "$output" == *"Decision Log"* ]]
}

# =============================================================================
# Compact Command Tests
# =============================================================================

@test "context-manager compact: shows pre-check information" {
    run "$SCRIPT" compact
    [ "$status" -eq 0 ]
    [[ "$output" == *"Would be PRESERVED"* ]]
    [[ "$output" == *"Would be COMPACTED"* ]]
}

@test "context-manager compact: --dry-run shows dry run message" {
    run "$SCRIPT" compact --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run"* ]]
}

@test "context-manager compact: disabled compaction shows warning" {
    # Disable compaction in config
    cat > "$TEST_DIR/.loa.config.yaml" << 'EOF'
context_management:
  client_compaction: false
EOF

    run "$SCRIPT" compact
    [ "$status" -eq 0 ]
    [[ "$output" == *"compaction is disabled"* ]]
}

# =============================================================================
# Checkpoint Command Tests
# =============================================================================

@test "context-manager checkpoint: shows automated checks" {
    run "$SCRIPT" checkpoint
    [ "$status" -eq 0 ]
    [[ "$output" == *"Simplified Checkpoint Process"* ]]
    [[ "$output" == *"Automated Checks"* ]]
}

@test "context-manager checkpoint: shows manual steps" {
    run "$SCRIPT" checkpoint
    [ "$status" -eq 0 ]
    [[ "$output" == *"Manual Steps"* ]]
    [[ "$output" == *"Verify Decision Log updated"* ]]
    [[ "$output" == *"Verify Bead updated"* ]]
    [[ "$output" == *"Verify EDD test scenarios"* ]]
}

@test "context-manager checkpoint: detects trajectory logged" {
    run "$SCRIPT" checkpoint
    [ "$status" -eq 0 ]
    [[ "$output" == *"Trajectory logged"* ]]
}

@test "context-manager checkpoint: detects Session Continuity present" {
    run "$SCRIPT" checkpoint
    [ "$status" -eq 0 ]
    [[ "$output" == *"Session Continuity section present"* ]]
}

@test "context-manager checkpoint: detects Decision Log present" {
    run "$SCRIPT" checkpoint
    [ "$status" -eq 0 ]
    [[ "$output" == *"Decision Log section present"* ]]
}

@test "context-manager checkpoint: --dry-run shows dry run" {
    run "$SCRIPT" checkpoint --dry-run
    [ "$status" -eq 0 ]
    [[ "$output" == *"Dry run complete"* ]]
}

# =============================================================================
# Recover Command Tests
# =============================================================================

@test "context-manager recover: level 1 shows minimal recovery" {
    run "$SCRIPT" recover 1
    [ "$status" -eq 0 ]
    [[ "$output" == *"Level 1: Minimal Recovery"* ]]
    [[ "$output" == *"~100 tokens"* ]]
}

@test "context-manager recover: level 2 shows standard recovery" {
    run "$SCRIPT" recover 2
    [ "$status" -eq 0 ]
    [[ "$output" == *"Level 2: Standard Recovery"* ]]
    [[ "$output" == *"~500 tokens"* ]]
}

@test "context-manager recover: level 3 shows full recovery" {
    run "$SCRIPT" recover 3
    [ "$status" -eq 0 ]
    [[ "$output" == *"Level 3: Full Recovery"* ]]
    [[ "$output" == *"~2000 tokens"* ]]
}

@test "context-manager recover: invalid level shows error" {
    run "$SCRIPT" recover 5
    [ "$status" -eq 1 ]
    [[ "$output" == *"Invalid level"* ]]
}

@test "context-manager recover: default level is 1" {
    run "$SCRIPT" recover
    [ "$status" -eq 0 ]
    [[ "$output" == *"Level 1"* ]]
}

# =============================================================================
# Configuration Tests
# =============================================================================

@test "context-manager: respects disabled compaction config" {
    cat > "$TEST_DIR/.loa.config.yaml" << 'EOF'
context_management:
  client_compaction: false
  preserve_notes_md: true
EOF

    run "$SCRIPT" status --json
    [ "$status" -eq 0 ]
    [[ $(echo "$output" | jq -r '.config.compaction_enabled') == "false" ]]
}

@test "context-manager: respects simplified_checkpoint config" {
    cat > "$TEST_DIR/.loa.config.yaml" << 'EOF'
context_management:
  simplified_checkpoint: false
EOF

    run "$SCRIPT" status --json
    [ "$status" -eq 0 ]
    [[ $(echo "$output" | jq -r '.config.simplified_checkpoint') == "false" ]]
}

# =============================================================================
# Edge Case Tests
# =============================================================================

@test "context-manager: handles missing NOTES.md gracefully" {
    rm -f "$TEST_DIR/loa-grimoire/NOTES.md"

    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Session Continuity section missing"* ]]
}

@test "context-manager: handles missing trajectory dir gracefully" {
    rm -rf "$TEST_DIR/loa-grimoire/a2a/trajectory"

    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Trajectory entries (today): 0"* ]]
}

@test "context-manager: handles missing config file gracefully" {
    rm -f "$TEST_DIR/.loa.config.yaml"

    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    # Should use defaults
    [[ "$output" == *"Client Compaction"* ]]
}

@test "context-manager: handles empty trajectory files" {
    # Create empty trajectory file
    echo -n "" > "$TEST_DIR/loa-grimoire/a2a/trajectory/impl-$(date +%Y-%m-%d).jsonl"

    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Trajectory entries (today): 0"* ]]
}
