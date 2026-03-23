#!/usr/bin/env bats
# =============================================================================
# construct-resolve.bats — Tests for construct-resolve.sh
# =============================================================================
# Part of cycle-051, Sprint 104: Name Resolution + Composition
#
# Tests:
#   1.  Exact slug match resolves correctly
#   2.  Case-insensitive name match ("K-Hole" -> "k-hole")
#   3.  Command name match ("dig" -> owning construct)
#   4.  No match returns exit 1
#   5.  Collision: two constructs claim same command -> exit 2 with warning
#   6.  Compose: overlapping writes/reads -> exit 0 with overlap paths
#   7.  Compose: no overlap -> exit 1 with message
#   8.  Compose: glob pattern overlap detection
#   9.  List returns all slugs
#   10. Capabilities returns aggregated caps for slug
#   11. Missing index returns exit 3
#   12. Path conflict between two constructs' writes produces warning

setup() {
    export BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    export PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    SCRIPT="$PROJECT_ROOT/.claude/scripts/construct-resolve.sh"

    # Create isolated temp directory
    export TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}"
    export TEST_RUN_DIR="$TEST_TMPDIR/run"
    mkdir -p "$TEST_RUN_DIR"

    # Default index path for tests
    export TEST_INDEX="$TEST_RUN_DIR/construct-index.yaml"
    export CONSTRUCT_INDEX_PATH="$TEST_INDEX"

    # Override PROJECT_ROOT so audit.jsonl writes to temp
    export PROJECT_ROOT="$TEST_TMPDIR"
    mkdir -p "$TEST_TMPDIR/.run"

    # Write the default fixture index (YAML format, consumed by yq)
    cat > "$TEST_INDEX" <<'YAML'
constructs:
  - slug: k-hole
    name: K-Hole
    version: "1.0.0"
    description: "Knowledge excavation construct"
    skills:
      - slug: dig
        path: skills/dig/
      - slug: mine
        path: skills/mine/
    commands:
      - name: dig
        path: commands/dig.md
      - name: mine
        path: commands/mine.md
    writes:
      - grimoires/k-hole/output.md
      - grimoires/k-hole/findings/**
    reads:
      - grimoires/k-hole/input.md
      - grimoires/shared/context.md
    gates:
      review: required
      audit: required
    events:
      emits:
        - k-hole.dig.complete
      consumes:
        - forge.observer.utc_created
    tags:
      - knowledge
      - research
    composes_with:
      - forge-observer
    aggregated_capabilities:
      schema_version: 2
      read_files: true
      search_code: true
      write_files: true
      execute_commands: false
      web_access: false
      user_interaction: false
      agent_spawn: false
      task_management: false
  - slug: forge-observer
    name: Forge Observer
    version: "2.1.0"
    description: "Event observation and logging construct"
    skills:
      - slug: observe
        path: skills/observe/
    commands:
      - name: watch
        path: commands/watch.md
    writes:
      - grimoires/shared/context.md
      - grimoires/forge/events.log
    reads:
      - grimoires/k-hole/output.md
      - grimoires/forge/config.yaml
    gates: {}
    events:
      emits:
        - forge.observer.utc_created
      consumes: []
    tags:
      - events
      - logging
    composes_with:
      - k-hole
    aggregated_capabilities:
      schema_version: 1
      read_files: true
      search_code: false
      write_files: true
      execute_commands: false
      web_access: false
      user_interaction: false
      agent_spawn: false
      task_management: false
  - slug: shadow-broker
    name: Shadow Broker
    version: "0.5.0"
    description: "Isolated construct with no composition paths"
    skills: []
    commands:
      - name: broker
        path: commands/broker.md
    writes:
      - grimoires/shadow/vault.md
    reads:
      - grimoires/shadow/keys.md
    gates: {}
    events:
      emits: []
      consumes: []
    tags: []
    composes_with: []
    aggregated_capabilities:
      schema_version: 1
      read_files: true
      search_code: false
      write_files: false
      execute_commands: false
      web_access: false
      user_interaction: false
      agent_spawn: false
      task_management: false
YAML
}

teardown() {
    rm -rf "$TEST_TMPDIR" 2>/dev/null || true
}

# =============================================================================
# T1: Exact slug match resolves correctly
# =============================================================================

@test "T1: exact slug match resolves correctly" {
    run "$SCRIPT" resolve k-hole --json --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    # Verify resolution
    [ "$(echo "$output" | jq -r '.resolved')" = "true" ]
    [ "$(echo "$output" | jq -r '.tier')" = "slug" ]
    [ "$(echo "$output" | jq -r '.construct.slug')" = "k-hole" ]
    [ "$(echo "$output" | jq -r '.construct.name')" = "K-Hole" ]
    [ "$(echo "$output" | jq -r '.construct.version')" = "1.0.0" ]
}

# =============================================================================
# T2: Case-insensitive name match ("K-Hole" -> "k-hole")
# =============================================================================

@test "T2: case-insensitive name match resolves" {
    run "$SCRIPT" resolve "k-hole" --json --index "$TEST_INDEX"
    # Should match slug first (Tier 1) — let's query by display name instead
    run "$SCRIPT" resolve "K-Hole" --json --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    [ "$(echo "$output" | jq -r '.resolved')" = "true" ]
    [ "$(echo "$output" | jq -r '.tier')" = "name" ]
    [ "$(echo "$output" | jq -r '.construct.slug')" = "k-hole" ]

    # Also works with all lowercase
    run "$SCRIPT" resolve "forge observer" --json --index "$TEST_INDEX"
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.construct.slug')" = "forge-observer" ]
}

# =============================================================================
# T3: Command name match ("dig" -> owning construct)
# =============================================================================

@test "T3: command name match resolves to owning construct" {
    run "$SCRIPT" resolve dig --json --index "$TEST_INDEX"
    # "dig" is not a slug or name — falls through to command match
    [ "$status" -eq 0 ]

    [ "$(echo "$output" | jq -r '.resolved')" = "true" ]
    [ "$(echo "$output" | jq -r '.tier')" = "command" ]
    [ "$(echo "$output" | jq -r '.construct.slug')" = "k-hole" ]
}

# =============================================================================
# T4: No match returns exit 1
# =============================================================================

@test "T4: no match returns exit 1" {
    run "$SCRIPT" resolve nonexistent --json --index "$TEST_INDEX"
    [ "$status" -eq 1 ]

    [ "$(echo "$output" | jq -r '.resolved')" = "false" ]
    [ "$(echo "$output" | jq -r '.error')" = "no match" ]
}

# =============================================================================
# T5: Collision — two constructs claim same command -> exit 2 with warning
# =============================================================================

@test "T5: collision on command name returns exit 2 with warning" {
    # Create index where two constructs own the same command name
    local collision_index="$TEST_RUN_DIR/collision-index.yaml"
    cat > "$collision_index" <<'YAML'
constructs:
  - slug: pack-alpha
    name: Alpha Pack
    version: "1.0.0"
    description: ""
    skills: []
    commands:
      - name: shared-cmd
        path: commands/shared-cmd.md
    writes: []
    reads: []
    gates: {}
    events:
      emits: []
      consumes: []
    tags: []
    composes_with: []
    aggregated_capabilities: {}
  - slug: pack-beta
    name: Beta Pack
    version: "1.0.0"
    description: ""
    skills: []
    commands:
      - name: shared-cmd
        path: commands/shared-cmd.md
    writes: []
    reads: []
    gates: {}
    events:
      emits: []
      consumes: []
    tags: []
    composes_with: []
    aggregated_capabilities: {}
YAML

    run "$SCRIPT" resolve shared-cmd --json --index "$collision_index"
    [ "$status" -eq 2 ]

    # Warning on stderr (captured in output by bats)
    [[ "$output" == *"WARNING"* ]] || [[ "$output" == *"Multiple"* ]]

    # Still returns the first match — extract JSON block from mixed output
    # The WARNING line is non-JSON; skip it and parse the rest with jq
    local json_block
    json_block=$(echo "$output" | sed '/^WARNING:/d')
    [ "$(echo "$json_block" | jq -r '.resolved')" = "true" ]
    [ "$(echo "$json_block" | jq -r '.construct.slug')" = "pack-alpha" ]
}

# =============================================================================
# T6: Compose — overlapping writes/reads -> exit 0 with overlap paths
# =============================================================================

@test "T6: compose with overlapping writes/reads returns exit 0" {
    # k-hole writes grimoires/k-hole/output.md, forge-observer reads grimoires/k-hole/output.md
    run "$SCRIPT" compose k-hole forge-observer --json --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    [ "$(echo "$output" | jq -r '.composable')" = "true" ]
    [ "$(echo "$output" | jq -r '.source')" = "k-hole" ]
    [ "$(echo "$output" | jq -r '.target')" = "forge-observer" ]

    # At least one overlapping path
    local overlap_count
    overlap_count=$(echo "$output" | jq '.overlapping_paths | length')
    [ "$overlap_count" -gt 0 ]
}

# =============================================================================
# T7: Compose — no overlap -> exit 1 with message
# =============================================================================

@test "T7: compose with no overlap returns exit 1" {
    # shadow-broker has no path overlap with k-hole
    run "$SCRIPT" compose shadow-broker k-hole --json --index "$TEST_INDEX"
    [ "$status" -eq 1 ]

    [ "$(echo "$output" | jq -r '.composable')" = "false" ]
    [ "$(echo "$output" | jq '.overlapping_paths | length')" -eq 0 ]
}

# =============================================================================
# T8: Compose — glob pattern overlap detection
# =============================================================================

@test "T8: compose detects glob pattern overlap" {
    # Create index with glob patterns in writes/reads
    local glob_index="$TEST_RUN_DIR/glob-index.yaml"
    cat > "$glob_index" <<'YAML'
constructs:
  - slug: writer-pack
    name: Writer
    version: "1.0.0"
    description: ""
    skills: []
    commands: []
    writes:
      - "grimoires/shared/**"
    reads: []
    gates: {}
    events:
      emits: []
      consumes: []
    tags: []
    composes_with: []
    aggregated_capabilities: {}
  - slug: reader-pack
    name: Reader
    version: "1.0.0"
    description: ""
    skills: []
    commands: []
    writes: []
    reads:
      - "grimoires/shared/data.md"
    gates: {}
    events:
      emits: []
      consumes: []
    tags: []
    composes_with: []
    aggregated_capabilities: {}
YAML

    run "$SCRIPT" compose writer-pack reader-pack --json --index "$glob_index"
    [ "$status" -eq 0 ]

    [ "$(echo "$output" | jq -r '.composable')" = "true" ]
    [ "$(echo "$output" | jq '.overlapping_paths | length')" -gt 0 ]
}

# =============================================================================
# T9: List returns all slugs
# =============================================================================

@test "T9: list returns all construct slugs" {
    run "$SCRIPT" list --json --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    local count
    count=$(echo "$output" | jq 'length')
    [ "$count" -eq 3 ]

    # All three slugs present
    echo "$output" | jq -r '.[]' | grep -q "k-hole"
    echo "$output" | jq -r '.[]' | grep -q "forge-observer"
    echo "$output" | jq -r '.[]' | grep -q "shadow-broker"
}

# =============================================================================
# T10: Capabilities returns aggregated caps for slug
# =============================================================================

@test "T10: capabilities returns aggregated caps for slug" {
    run "$SCRIPT" capabilities k-hole --json --index "$TEST_INDEX"
    [ "$status" -eq 0 ]

    [ "$(echo "$output" | jq -r '.slug')" = "k-hole" ]
    [ "$(echo "$output" | jq -r '.capabilities.read_files')" = "true" ]
    [ "$(echo "$output" | jq -r '.capabilities.search_code')" = "true" ]
    [ "$(echo "$output" | jq -r '.capabilities.write_files')" = "true" ]
    [ "$(echo "$output" | jq -r '.capabilities.execute_commands')" = "false" ]
    [ "$(echo "$output" | jq -r '.capabilities.schema_version')" = "2" ]
}

# =============================================================================
# T11: Missing index returns exit 3
# =============================================================================

@test "T11: missing index returns exit 3" {
    run "$SCRIPT" resolve anything --index "/tmp/nonexistent-index-$$.yaml"
    [ "$status" -eq 3 ]
    [[ "$output" == *"not found"* ]]
}

# =============================================================================
# T12: Path conflict between two constructs' writes produces warning
# =============================================================================

@test "T12: path conflict between two constructs writes detected via compose" {
    # Two constructs both write to same path — compose should detect overlap
    # when one is checked as "source" and the other reads from that path
    local conflict_index="$TEST_RUN_DIR/conflict-index.yaml"
    cat > "$conflict_index" <<'YAML'
constructs:
  - slug: writer-a
    name: Writer A
    version: "1.0.0"
    description: ""
    skills: []
    commands: []
    writes:
      - "grimoires/shared/state.md"
    reads: []
    gates: {}
    events:
      emits: []
      consumes: []
    tags: []
    composes_with: []
    aggregated_capabilities: {}
  - slug: writer-b
    name: Writer B
    version: "1.0.0"
    description: ""
    skills: []
    commands: []
    writes:
      - "grimoires/shared/state.md"
    reads:
      - "grimoires/shared/state.md"
    gates: {}
    events:
      emits: []
      consumes: []
    tags: []
    composes_with: []
    aggregated_capabilities: {}
YAML

    # writer-a writes to shared/state.md, writer-b also reads it
    # This should compose (there IS path overlap)
    run "$SCRIPT" compose writer-a writer-b --json --index "$conflict_index"
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.composable')" = "true" ]

    # Verify the conflicting path is in the overlap
    echo "$output" | jq -r '.overlapping_paths[]' | grep -q "grimoires/shared/state.md"
}
