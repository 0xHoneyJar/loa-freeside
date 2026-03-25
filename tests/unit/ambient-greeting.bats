#!/usr/bin/env bats
# =============================================================================
# ambient-greeting.bats — Tests for archetype-resolver.sh greeting subcommand
# =============================================================================
# Part of cycle-051, Sprint 105: Operator OS + Ambient Greeting
#
# Tests:
#   1.  Greeting includes construct names and versions
#   2.  Greeting includes compositions from composes_with
#   3.  Greeting includes open thread count
#   4.  No greeting when ambient_greeting is false
#   5.  No greeting when no constructs installed
#   6.  Thread auto-archive (>30 days old)

setup() {
    export BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    export PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    SCRIPT="$PROJECT_ROOT/.claude/scripts/archetype-resolver.sh"

    # Create isolated temp directory
    export TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
    export TEST_RUN_DIR="$TEST_TMPDIR/.run"
    mkdir -p "$TEST_RUN_DIR"

    # Override state file paths for isolation
    export ARCHETYPE_FILE="$TEST_RUN_DIR/archetype.yaml"
    export THREADS_FILE="$TEST_RUN_DIR/open-threads.jsonl"

    # Create default config with ambient_greeting enabled
    export TEST_CONFIG="$TEST_TMPDIR/.loa.config.yaml"
    cat > "$TEST_CONFIG" << 'YAML'
operator_os:
  modes:
    dig:
      constructs: [k-hole]
      entry_point: /dig
constructs:
  ambient_greeting: true
  thread_archive_days: 30
YAML

    # Create default index with constructs
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
      "writes": ["grimoires/research/output.md"],
      "reads": [],
      "gates": {"review": true, "audit": false},
      "events": {"emits": [], "consumes": []},
      "tags": ["research"],
      "composes_with": ["artisan"],
      "quick_start": "dig",
      "aggregated_capabilities": {}
    },
    {
      "slug": "artisan",
      "name": "Artisan",
      "version": "1.0.0",
      "description": "Creative construct",
      "skills": [],
      "commands": [{"name": "feel", "path": "commands/feel.md"}, {"name": "observe", "path": "commands/observe.md"}],
      "writes": [],
      "reads": ["grimoires/research/output.md"],
      "gates": {},
      "events": {"emits": [], "consumes": []},
      "tags": ["creative"],
      "composes_with": ["k-hole"],
      "quick_start": "feel",
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
# T1: Greeting includes construct names and versions
# =============================================================================

@test "T1: greeting includes construct names and versions" {
    run "$SCRIPT" greeting --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Should list both constructs with versions
    [[ "$output" == *"k-hole (v1.2.1)"* ]]
    [[ "$output" == *"artisan (v1.0.0)"* ]]
    [[ "$output" == *"Active:"* ]]
}

# =============================================================================
# T2: Greeting includes compositions from composes_with
# =============================================================================

@test "T2: greeting includes compositions from composes_with" {
    run "$SCRIPT" greeting --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Should show composition relationships
    [[ "$output" == *"Compositions:"* ]]
    [[ "$output" == *"k-hole"* ]]
    [[ "$output" == *"artisan"* ]]
}

# =============================================================================
# T3: Greeting includes open thread count
# =============================================================================

@test "T3: greeting includes open thread count" {
    # Create some open threads
    local now_iso
    now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    echo "{\"id\": \"t1\", \"status\": \"open\", \"created_at\": \"$now_iso\", \"title\": \"Thread 1\"}" > "$THREADS_FILE"
    echo "{\"id\": \"t2\", \"status\": \"open\", \"created_at\": \"$now_iso\", \"title\": \"Thread 2\"}" >> "$THREADS_FILE"
    echo "{\"id\": \"t3\", \"status\": \"closed\", \"created_at\": \"$now_iso\", \"title\": \"Thread 3\"}" >> "$THREADS_FILE"

    run "$SCRIPT" greeting --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Should report 2 open threads (not the closed one)
    [[ "$output" == *"2 open threads"* ]]
    [[ "$output" == *"Beads:"* ]]
}

# =============================================================================
# T4: No greeting when ambient_greeting is false
# =============================================================================

@test "T4: no greeting when ambient_greeting is false" {
    # Override config with ambient_greeting false
    cat > "$TEST_CONFIG" << 'YAML'
constructs:
  ambient_greeting: false
YAML

    run "$SCRIPT" greeting --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Output should be empty
    [ -z "$output" ]
}

# =============================================================================
# T5: No greeting when no constructs installed
# =============================================================================

@test "T5: no greeting when no constructs installed" {
    # Create an empty index
    cat > "$TEST_INDEX" << 'JSON'
{
  "generated_at": "2026-03-23T10:00:00Z",
  "constructs": []
}
JSON

    run "$SCRIPT" greeting --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Output should be empty
    [ -z "$output" ]
}

# =============================================================================
# T6: Thread auto-archive (>30 days old)
# =============================================================================

@test "T6: thread auto-archive for threads older than 30 days" {
    # Create threads: one recent, one old (> 30 days)
    local now_iso old_iso
    now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # 45 days ago
    old_iso=$(date -u -d "45 days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
              date -u -v-45d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
              echo "2026-02-06T10:00:00Z")

    echo "{\"id\": \"recent\", \"status\": \"open\", \"created_at\": \"$now_iso\", \"title\": \"Recent\"}" > "$THREADS_FILE"
    echo "{\"id\": \"stale\", \"status\": \"open\", \"created_at\": \"$old_iso\", \"title\": \"Stale\"}" >> "$THREADS_FILE"

    run "$SCRIPT" greeting --config "$TEST_CONFIG" --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Should report only 1 open thread (the recent one)
    [[ "$output" == *"1 open threads"* ]]

    # Verify the stale thread was archived in the file
    local stale_status
    stale_status=$(jq -r 'select(.id == "stale") | .status' "$THREADS_FILE")
    [ "$stale_status" = "archived" ]
}
