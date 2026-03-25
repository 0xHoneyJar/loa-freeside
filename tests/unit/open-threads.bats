#!/usr/bin/env bats
# =============================================================================
# open-threads.bats — Tests for open thread lifecycle
# =============================================================================
# Part of cycle-051, Sprint 106: Integration + E2E Validation
#
# Tests:
#   1.  Append thread: write JSONL line, verify valid JSON with jq
#   2.  Close thread: append close line, verify valid JSONL
#   3.  Auto-archive: stale thread (60 days) archived by greeting

setup() {
    export BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    export PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    SCRIPT="$PROJECT_ROOT/.claude/scripts/archetype-resolver.sh"

    export TEST_TMPDIR="$BATS_TEST_TMPDIR/threads-$$"
    mkdir -p "$TEST_TMPDIR/.run"
    export THREADS_FILE="$TEST_TMPDIR/.run/open-threads.jsonl"

    # Override state file paths for isolation
    export ARCHETYPE_FILE="$TEST_TMPDIR/.run/archetype.yaml"
}

teardown() {
    rm -rf "$TEST_TMPDIR"
}

# =============================================================================
# T1: Append thread — write JSONL line, verify valid JSON with jq
# =============================================================================

@test "T1: append thread creates valid JSONL entry" {
    local now_iso
    now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Append a thread as JSONL
    jq -cn \
        --arg id "thread-001" \
        --arg topic "Investigate build failure" \
        --arg construct "k-hole" \
        --arg created_at "$now_iso" \
        --arg status "open" \
        '{id: $id, topic: $topic, construct: $construct, created_at: $created_at, status: $status}' \
        >> "$THREADS_FILE"

    # File should exist
    [ -f "$THREADS_FILE" ]

    # Every line must be valid JSON
    local invalid_lines=0
    while IFS= read -r line; do
        if ! echo "$line" | jq empty 2>/dev/null; then
            invalid_lines=$((invalid_lines + 1))
        fi
    done < "$THREADS_FILE"
    [ "$invalid_lines" -eq 0 ]

    # Verify fields
    local parsed_id parsed_status
    parsed_id=$(jq -r '.id' "$THREADS_FILE")
    parsed_status=$(jq -r '.status' "$THREADS_FILE")
    [ "$parsed_id" = "thread-001" ]
    [ "$parsed_status" = "open" ]
}

# =============================================================================
# T2: Close thread — append close line, verify valid JSONL
# =============================================================================

@test "T2: close thread appends line with status closed" {
    local now_iso
    now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

    # Append open thread
    jq -cn \
        --arg id "thread-002" \
        --arg topic "Review architecture" \
        --arg construct "forge-observer" \
        --arg created_at "$now_iso" \
        --arg status "open" \
        '{id: $id, topic: $topic, construct: $construct, created_at: $created_at, status: $status}' \
        >> "$THREADS_FILE"

    # Close the same thread (append new line)
    jq -cn \
        --arg id "thread-002" \
        --arg topic "Review architecture" \
        --arg construct "forge-observer" \
        --arg created_at "$now_iso" \
        --arg status "closed" \
        '{id: $id, topic: $topic, construct: $construct, created_at: $created_at, status: $status}' \
        >> "$THREADS_FILE"

    # File should have 2 lines
    local line_count
    line_count=$(wc -l < "$THREADS_FILE" | tr -d ' ')
    [ "$line_count" -eq 2 ]

    # Every line must be valid JSON
    local invalid_lines=0
    while IFS= read -r line; do
        if ! echo "$line" | jq empty 2>/dev/null; then
            invalid_lines=$((invalid_lines + 1))
        fi
    done < "$THREADS_FILE"
    [ "$invalid_lines" -eq 0 ]

    # Last line should have status closed
    local last_status
    last_status=$(tail -n 1 "$THREADS_FILE" | jq -r '.status')
    [ "$last_status" = "closed" ]
}

# =============================================================================
# T3: Auto-archive — stale thread (60 days old) archived by greeting function
# =============================================================================

@test "T3: auto-archive archives threads older than threshold" {
    # Create config with ambient_greeting enabled and 30 day archive threshold
    local test_config="$TEST_TMPDIR/.loa.config.yaml"
    cat > "$test_config" << 'YAML'
operator_os:
  modes:
    test:
      constructs: [test-construct]
      entry_point: /test
constructs:
  ambient_greeting: true
  thread_archive_days: 30
YAML

    # Create index with at least one construct
    local test_index="$TEST_TMPDIR/.run/construct-index.yaml"
    cat > "$test_index" << 'JSON'
{
  "generated_at": "2026-03-23T10:00:00Z",
  "constructs": [
    {
      "slug": "test-construct",
      "name": "Test Construct",
      "version": "1.0.0",
      "description": "Test",
      "skills": [],
      "commands": [{"name": "test", "path": "commands/test.md"}],
      "writes": [],
      "reads": [],
      "gates": {},
      "events": {"emits": [], "consumes": []},
      "tags": [],
      "composes_with": [],
      "quick_start": "test",
      "aggregated_capabilities": {}
    }
  ]
}
JSON

    # Create threads: one recent (today), one stale (60 days ago)
    local now_iso old_iso
    now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    # 60 days ago — try GNU date, then BSD date, then hardcoded
    old_iso=$(date -u -d "60 days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
              date -u -v-60d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
              echo "2026-01-22T10:00:00Z")

    echo "{\"id\": \"recent-thread\", \"status\": \"open\", \"created_at\": \"$now_iso\", \"topic\": \"Recent work\"}" > "$THREADS_FILE"
    echo "{\"id\": \"stale-thread\", \"status\": \"open\", \"created_at\": \"$old_iso\", \"topic\": \"Old work\"}" >> "$THREADS_FILE"

    # Run greeting — it auto-archives stale threads
    run "$SCRIPT" greeting --config "$test_config" --index "$test_index"
    [ "$status" -eq 0 ]

    # Verify the stale thread status is now "archived"
    local stale_status
    stale_status=$(jq -r 'select(.id == "stale-thread") | .status' "$THREADS_FILE")
    [ "$stale_status" = "archived" ]

    # Verify the recent thread is still open
    local recent_status
    recent_status=$(jq -r 'select(.id == "recent-thread") | .status' "$THREADS_FILE")
    [ "$recent_status" = "open" ]
}
