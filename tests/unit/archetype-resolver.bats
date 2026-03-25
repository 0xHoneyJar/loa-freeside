#!/usr/bin/env bats
# =============================================================================
# archetype-resolver.bats — Tests for archetype-resolver.sh
# =============================================================================
# Part of cycle-051, Sprint 105: Operator OS + Ambient Greeting
#
# Tests:
#   1.  Activate valid mode with installed construct succeeds
#   2.  Activate mode with multiple constructs succeeds
#   3.  Gate merge: restrictive wins (true + false -> true)
#   4.  Gate merge: null treated as no-gate (null + false -> false)
#   5.  Activate with uninstalled construct -> exit 2
#   6.  Activate undefined mode -> exit 1
#   7.  Deactivate removes archetype.yaml
#   8.  Status with active mode shows state
#   9.  Status without mode shows "No active mode"
#   10. Missing config -> exit 4

setup() {
    export BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    export PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    SCRIPT="$PROJECT_ROOT/.claude/scripts/archetype-resolver.sh"

    # Create isolated temp directory
    export TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
    export TEST_RUN_DIR="$TEST_TMPDIR/.run"
    mkdir -p "$TEST_RUN_DIR"

    # Override ARCHETYPE_FILE and PROJECT_ROOT for isolation
    export ARCHETYPE_FILE="$TEST_RUN_DIR/archetype.yaml"
    export THREADS_FILE="$TEST_RUN_DIR/open-threads.jsonl"

    # Create a fixture config
    export TEST_CONFIG="$TEST_TMPDIR/.loa.config.yaml"
    cat > "$TEST_CONFIG" << 'YAML'
operator_os:
  modes:
    dig:
      constructs: [k-hole]
      entry_point: /dig
    feel:
      constructs: [artisan, observer]
      entry_point: /feel
    mixed:
      constructs: [gated-true, gated-false]
      entry_point: /mixed
    null-gate-mode:
      constructs: [no-gates, gated-false]
      entry_point: /nullgate
    missing-construct-mode:
      constructs: [nonexistent-pack]
      entry_point: /missing
constructs:
  ambient_greeting: false
  thread_archive_days: 30
YAML

    # Create a fixture construct index (JSON)
    export TEST_INDEX="$TEST_RUN_DIR/construct-index.yaml"
    cat > "$TEST_INDEX" << 'JSON'
{
  "generated_at": "2026-03-23T10:00:00Z",
  "constructs": [
    {
      "slug": "k-hole",
      "name": "K-Hole",
      "version": "1.2.1",
      "description": "Deep research construct",
      "skills": [],
      "commands": [{"name": "dig", "path": "commands/dig.md"}],
      "writes": ["grimoires/research/"],
      "reads": [],
      "gates": {"review": true, "audit": false},
      "events": {"emits": [], "consumes": []},
      "tags": ["research"],
      "composes_with": ["observer"],
      "aggregated_capabilities": {}
    },
    {
      "slug": "artisan",
      "name": "Artisan",
      "version": "1.0.0",
      "description": "Creative construct",
      "skills": [],
      "commands": [{"name": "feel", "path": "commands/feel.md"}],
      "writes": [],
      "reads": ["grimoires/research/"],
      "gates": {},
      "events": {"emits": [], "consumes": []},
      "tags": ["creative"],
      "composes_with": [],
      "aggregated_capabilities": {}
    },
    {
      "slug": "observer",
      "name": "Observer",
      "version": "0.9.0",
      "description": "Observation construct",
      "skills": [],
      "commands": [{"name": "observe", "path": "commands/observe.md"}],
      "writes": [],
      "reads": [],
      "gates": {"review": false, "audit": true},
      "events": {"emits": [], "consumes": []},
      "tags": ["observe"],
      "composes_with": ["k-hole"],
      "aggregated_capabilities": {}
    },
    {
      "slug": "gated-true",
      "name": "Gated True",
      "version": "1.0.0",
      "description": "Construct with review:true, audit:true",
      "skills": [],
      "commands": [],
      "writes": [],
      "reads": [],
      "gates": {"review": true, "audit": true},
      "events": {"emits": [], "consumes": []},
      "tags": [],
      "composes_with": [],
      "aggregated_capabilities": {}
    },
    {
      "slug": "gated-false",
      "name": "Gated False",
      "version": "1.0.0",
      "description": "Construct with review:false, audit:false",
      "skills": [],
      "commands": [],
      "writes": [],
      "reads": [],
      "gates": {"review": false, "audit": false},
      "events": {"emits": [], "consumes": []},
      "tags": [],
      "composes_with": [],
      "aggregated_capabilities": {}
    },
    {
      "slug": "no-gates",
      "name": "No Gates",
      "version": "1.0.0",
      "description": "Construct with no gates at all",
      "skills": [],
      "commands": [],
      "writes": [],
      "reads": [],
      "gates": {},
      "events": {"emits": [], "consumes": []},
      "tags": [],
      "composes_with": [],
      "aggregated_capabilities": {}
    }
  ]
}
JSON
}

teardown() {
    rm -rf "$TEST_TMPDIR" 2>/dev/null || true
}

# =============================================================================
# T1: Activate valid mode with installed construct succeeds
# =============================================================================

@test "T1: activate valid mode with installed construct succeeds" {
    run "$SCRIPT" activate dig --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]
    [ -f "$ARCHETYPE_FILE" ]

    # Verify active_mode
    local mode
    mode=$(yq eval '.active_mode' "$ARCHETYPE_FILE" 2>/dev/null || jq -r '.active_mode' "$ARCHETYPE_FILE")
    [ "$mode" = "dig" ]

    # Verify entry_point
    local ep
    ep=$(yq eval '.entry_point' "$ARCHETYPE_FILE" 2>/dev/null || jq -r '.entry_point' "$ARCHETYPE_FILE")
    [ "$ep" = "/dig" ]

    # Verify k-hole is in active_constructs
    local slug
    slug=$(yq eval -o=json '.active_constructs' "$ARCHETYPE_FILE" 2>/dev/null | jq -r '.[0].slug')
    [ "$slug" = "k-hole" ]
}

# =============================================================================
# T2: Activate mode with multiple constructs succeeds
# =============================================================================

@test "T2: activate mode with multiple constructs succeeds" {
    run "$SCRIPT" activate feel --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]
    [ -f "$ARCHETYPE_FILE" ]

    local count
    count=$(yq eval -o=json '.active_constructs' "$ARCHETYPE_FILE" 2>/dev/null | jq 'length')
    [ "$count" -eq 2 ]

    # Both slugs present
    local slugs
    slugs=$(yq eval -o=json '.active_constructs' "$ARCHETYPE_FILE" 2>/dev/null | jq -r '.[].slug' | sort)
    echo "$slugs" | grep -q "artisan"
    echo "$slugs" | grep -q "observer"
}

# =============================================================================
# T3: Gate merge: restrictive wins (true + false -> true)
# =============================================================================

@test "T3: gate merge — restrictive wins (true + false -> true)" {
    run "$SCRIPT" activate mixed --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # gated-true has review:true, audit:true
    # gated-false has review:false, audit:false
    # Merged: most-restrictive wins → review:true, audit:true
    local review audit
    review=$(yq eval '.merged_gates.review' "$ARCHETYPE_FILE" 2>/dev/null || jq -r '.merged_gates.review' "$ARCHETYPE_FILE")
    audit=$(yq eval '.merged_gates.audit' "$ARCHETYPE_FILE" 2>/dev/null || jq -r '.merged_gates.audit' "$ARCHETYPE_FILE")

    [ "$review" = "true" ]
    [ "$audit" = "true" ]
}

# =============================================================================
# T4: Gate merge: null treated as no-gate (null + false -> false)
# =============================================================================

@test "T4: gate merge — null treated as no-gate (null + false -> false)" {
    run "$SCRIPT" activate null-gate-mode --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # no-gates has gates: {} (null for review/audit)
    # gated-false has review:false, audit:false
    # Merged: null is no-gate, false stays false → false
    local review audit
    review=$(yq eval '.merged_gates.review' "$ARCHETYPE_FILE" 2>/dev/null || jq -r '.merged_gates.review' "$ARCHETYPE_FILE")
    audit=$(yq eval '.merged_gates.audit' "$ARCHETYPE_FILE" 2>/dev/null || jq -r '.merged_gates.audit' "$ARCHETYPE_FILE")

    [ "$review" = "false" ]
    [ "$audit" = "false" ]
}

# =============================================================================
# T5: Activate with uninstalled construct -> exit 2
# =============================================================================

@test "T5: activate with uninstalled construct exits 2" {
    run "$SCRIPT" activate missing-construct-mode --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 2 ]
    [[ "$output" == *"not installed"* ]]
}

# =============================================================================
# T6: Activate undefined mode -> exit 1
# =============================================================================

@test "T6: activate undefined mode exits 1" {
    run "$SCRIPT" activate nonexistent-mode --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 1 ]
    [[ "$output" == *"not defined"* ]]
}

# =============================================================================
# T7: Deactivate removes archetype.yaml
# =============================================================================

@test "T7: deactivate removes archetype.yaml" {
    # First activate
    run "$SCRIPT" activate dig --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]
    [ -f "$ARCHETYPE_FILE" ]

    # Then deactivate
    run "$SCRIPT" deactivate
    [ "$status" -eq 0 ]
    [ ! -f "$ARCHETYPE_FILE" ]
}

# =============================================================================
# T8: Status with active mode shows state
# =============================================================================

@test "T8: status with active mode shows state" {
    # Activate first
    run "$SCRIPT" activate dig --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Check status (text)
    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"Active mode: dig"* ]]
    [[ "$output" == *"k-hole"* ]]

    # Check status (json)
    run "$SCRIPT" status --json
    [ "$status" -eq 0 ]
    local active_mode
    active_mode=$(echo "$output" | jq -r '.active_mode')
    [ "$active_mode" = "dig" ]
    [ "$(echo "$output" | jq -r '.active')" = "true" ]
}

# =============================================================================
# T9: Status without mode shows "No active mode"
# =============================================================================

@test "T9: status without mode shows 'No active mode'" {
    # No archetype.yaml exists
    run "$SCRIPT" status
    [ "$status" -eq 0 ]
    [[ "$output" == *"No active mode"* ]]

    # JSON variant
    run "$SCRIPT" status --json
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.active')" = "false" ]
}

# =============================================================================
# T10: Missing config -> exit 4
# =============================================================================

@test "T10: missing config exits 4" {
    run "$SCRIPT" activate dig --config "$TEST_TMPDIR/nonexistent.yaml" --index "$TEST_INDEX"
    [ "$status" -eq 4 ]
    [[ "$output" == *"Config file not found"* ]]
}
