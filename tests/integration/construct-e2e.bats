#!/usr/bin/env bats
# =============================================================================
# construct-e2e.bats — End-to-end integration tests for construct lifecycle
# =============================================================================
# Part of cycle-051, Sprint 106: Integration + E2E Validation
#
# Exercises the full construct lifecycle: index generation -> resolution ->
# composition -> mode activation -> greeting -> capabilities.
#
# Tests:
#   1.  E2E full construct lifecycle
#   2.  G-1: Index generated with all required fields
#   3.  G-2: Name resolution works for slug + name + command
#   4.  G-3: Composition detection (two constructs with overlapping paths)
#   5.  G-4: Mode activation writes archetype
#   6.  G-5: Greeting displays when opted in
#   7.  G-6: Capabilities aggregated correctly

setup() {
    export BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    export PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"

    # Create isolated temp directory
    export TEST_TMPDIR="${BATS_TEST_TMPDIR:-$(mktemp -d)}/e2e-$$"
    mkdir -p "$TEST_TMPDIR/.run"
    mkdir -p "$TEST_TMPDIR/.claude/scripts"

    # Override state file paths for isolation
    export ARCHETYPE_FILE="$TEST_TMPDIR/.run/archetype.yaml"
    export ARCHETYPE_PATH="$TEST_TMPDIR/.run/archetype.yaml"
    export THREADS_FILE="$TEST_TMPDIR/.run/open-threads.jsonl"
}

teardown() {
    rm -rf "$TEST_TMPDIR" 2>/dev/null || true
}

# =============================================================================
# Helper: create the standard mock pack structure
# =============================================================================

_setup_mock_environment() {
    # Setup mock pack
    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs/test-construct"
    mkdir -p "$packs_dir/skills/test-skill" "$packs_dir/commands"
    echo '{"name":"Test Construct","slug":"test-construct","version":"1.0.0","description":"A test construct for E2E testing","skills":[{"slug":"test-skill","path":"skills/test-skill/"}],"commands":[{"name":"test","path":"commands/test.md"}],"tags":["testing"],"events":{"emits":[{"name":"test.complete"}],"consumes":[]}}' > "$packs_dir/manifest.json"

    # Mock SKILL.md with capabilities
    local skills_dir="$TEST_TMPDIR/.claude/skills/test-skill"
    mkdir -p "$skills_dir"
    cat > "$skills_dir/SKILL.md" << 'SKILL_EOF'
---
name: test-skill
capabilities:
  schema_version: 1
  read_files: true
  search_code: true
  write_files: false
  execute_commands: false
  web_access: false
  user_interaction: false
  agent_spawn: false
  task_management: false
cost-profile: lightweight
---
# Test Skill
SKILL_EOF

    # Mock config with mode
    cat > "$TEST_TMPDIR/.loa.config.yaml" << 'CFG_EOF'
operator_os:
  modes:
    test-mode:
      constructs: [test-construct]
      entry_point: /test
constructs:
  ambient_greeting: true
  thread_archive_days: 30
CFG_EOF
}

# =============================================================================
# T1: E2E full construct lifecycle
# =============================================================================

@test "E2E: full construct lifecycle" {
    _setup_mock_environment

    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs"

    # Step 1: Generate index
    LOA_PACKS_DIR="$packs_dir" LOA_SKILLS_DIR="$TEST_TMPDIR/.claude/skills" \
        run "$PROJECT_ROOT/.claude/scripts/construct-index-gen.sh" --output "$TEST_TMPDIR/.run/construct-index.yaml" --quiet
    [ "$status" -eq 0 ]
    [ -f "$TEST_TMPDIR/.run/construct-index.yaml" ]

    # Step 2: Resolve by slug
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/construct-index.yaml" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" resolve test-construct
    [ "$status" -eq 0 ]

    # Step 3: Resolve by command
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/construct-index.yaml" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" resolve test
    [ "$status" -eq 0 ]

    # Step 4: List constructs
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/construct-index.yaml" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" list
    [ "$status" -eq 0 ]
    [[ "$output" == *"test-construct"* ]]

    # Step 5: Activate mode
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/construct-index.yaml" \
    ARCHETYPE_FILE="$TEST_TMPDIR/.run/archetype.yaml" \
    THREADS_FILE="$TEST_TMPDIR/.run/open-threads.jsonl" \
        run "$PROJECT_ROOT/.claude/scripts/archetype-resolver.sh" activate test-mode \
            --config "$TEST_TMPDIR/.loa.config.yaml" \
            --index "$TEST_TMPDIR/.run/construct-index.yaml"
    [ "$status" -eq 0 ]
    [ -f "$TEST_TMPDIR/.run/archetype.yaml" ]

    # Step 6: Greeting
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/construct-index.yaml" \
    ARCHETYPE_FILE="$TEST_TMPDIR/.run/archetype.yaml" \
    THREADS_FILE="$TEST_TMPDIR/.run/open-threads.jsonl" \
        run "$PROJECT_ROOT/.claude/scripts/archetype-resolver.sh" greeting \
            --config "$TEST_TMPDIR/.loa.config.yaml" \
            --index "$TEST_TMPDIR/.run/construct-index.yaml"
    [ "$status" -eq 0 ]
    [[ "$output" == *"test-construct"* ]]

    # Step 7: Check capabilities
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/construct-index.yaml" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" capabilities test-construct
    [ "$status" -eq 0 ]
    [[ "$output" == *"read_files"* ]]
}

# =============================================================================
# G-1: Index generated with all required fields
# =============================================================================

@test "G-1: index generated with all required fields" {
    _setup_mock_environment

    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs"

    LOA_PACKS_DIR="$packs_dir" LOA_SKILLS_DIR="$TEST_TMPDIR/.claude/skills" \
        run "$PROJECT_ROOT/.claude/scripts/construct-index-gen.sh" --json --output "$TEST_TMPDIR/.run/index.json" --quiet
    [ "$status" -eq 0 ]
    [ -f "$TEST_TMPDIR/.run/index.json" ]

    # Verify top-level fields
    [ "$(jq -r '.generated_at' "$TEST_TMPDIR/.run/index.json")" != "null" ]
    [ "$(jq '.constructs | length' "$TEST_TMPDIR/.run/index.json")" -eq 1 ]

    # Verify required construct fields
    local entry="$TEST_TMPDIR/.run/index.json"
    [ "$(jq -r '.constructs[0].slug' "$entry")" = "test-construct" ]
    [ "$(jq -r '.constructs[0].name' "$entry")" = "Test Construct" ]
    [ "$(jq -r '.constructs[0].version' "$entry")" = "1.0.0" ]
    [ "$(jq '.constructs[0].skills | length' "$entry")" -eq 1 ]
    [ "$(jq '.constructs[0].commands | length' "$entry")" -eq 1 ]
    [ "$(jq '.constructs[0].tags | length' "$entry")" -eq 1 ]
    [ "$(jq '.constructs[0].events.emits | length' "$entry")" -eq 1 ]

    # Verify aggregated_capabilities is present
    [ "$(jq '.constructs[0].aggregated_capabilities | type' "$entry")" = '"object"' ]
}

# =============================================================================
# G-2: Name resolution works for slug + name + command
# =============================================================================

@test "G-2: name resolution works for slug, name, and command" {
    _setup_mock_environment

    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs"

    LOA_PACKS_DIR="$packs_dir" LOA_SKILLS_DIR="$TEST_TMPDIR/.claude/skills" \
        "$PROJECT_ROOT/.claude/scripts/construct-index-gen.sh" --json --output "$TEST_TMPDIR/.run/index.json" --quiet

    # Slug resolution
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/index.json" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" resolve test-construct --json
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.resolved')" = "true" ]
    [ "$(echo "$output" | jq -r '.tier')" = "slug" ]

    # Name resolution (case-insensitive)
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/index.json" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" resolve "Test Construct" --json
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.resolved')" = "true" ]
    [ "$(echo "$output" | jq -r '.tier')" = "name" ]

    # Command resolution
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/index.json" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" resolve test --json
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.resolved')" = "true" ]
    [ "$(echo "$output" | jq -r '.tier')" = "command" ]
}

# =============================================================================
# G-3: Composition detection (two constructs with overlapping paths)
# =============================================================================

@test "G-3: composition detection for overlapping write/read paths" {
    # Create two packs with overlapping write/read paths
    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs"
    mkdir -p "$packs_dir/writer-construct" "$packs_dir/reader-construct"

    echo '{"name":"Writer","slug":"writer-construct","version":"1.0.0","description":"Writes output","skills":[],"commands":[{"name":"write","path":"commands/write.md"}],"tags":["writer"],"events":{"emits":[],"consumes":[]}}' \
        > "$packs_dir/writer-construct/manifest.json"

    cat > "$packs_dir/writer-construct/construct.yaml" << 'YAML'
writes:
  - grimoires/shared/data.md
reads: []
YAML

    echo '{"name":"Reader","slug":"reader-construct","version":"1.0.0","description":"Reads input","skills":[],"commands":[{"name":"read","path":"commands/read.md"}],"tags":["reader"],"events":{"emits":[],"consumes":[]}}' \
        > "$packs_dir/reader-construct/manifest.json"

    cat > "$packs_dir/reader-construct/construct.yaml" << 'YAML'
writes: []
reads:
  - grimoires/shared/data.md
YAML

    # Generate index
    LOA_PACKS_DIR="$packs_dir" LOA_SKILLS_DIR="$TEST_TMPDIR/.claude/skills" \
        "$PROJECT_ROOT/.claude/scripts/construct-index-gen.sh" --json --output "$TEST_TMPDIR/.run/index.json" --quiet

    # composes_with should be populated
    local writer_composes reader_composes
    writer_composes=$(jq -r '.constructs[] | select(.slug == "writer-construct") | .composes_with | length' "$TEST_TMPDIR/.run/index.json")
    reader_composes=$(jq -r '.constructs[] | select(.slug == "reader-construct") | .composes_with | length' "$TEST_TMPDIR/.run/index.json")

    [ "$writer_composes" -gt 0 ]
    [ "$reader_composes" -gt 0 ]

    # Compose check also works
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/index.json" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" compose writer-construct reader-construct --json
    [ "$status" -eq 0 ]
    [ "$(echo "$output" | jq -r '.composable')" = "true" ]
}

# =============================================================================
# G-4: Mode activation writes archetype
# =============================================================================

@test "G-4: mode activation writes archetype with correct fields" {
    _setup_mock_environment

    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs"

    # Generate index
    LOA_PACKS_DIR="$packs_dir" LOA_SKILLS_DIR="$TEST_TMPDIR/.claude/skills" \
        "$PROJECT_ROOT/.claude/scripts/construct-index-gen.sh" --json --output "$TEST_TMPDIR/.run/index.json" --quiet

    # Activate mode
    ARCHETYPE_FILE="$TEST_TMPDIR/.run/archetype.yaml" \
    THREADS_FILE="$TEST_TMPDIR/.run/open-threads.jsonl" \
        run "$PROJECT_ROOT/.claude/scripts/archetype-resolver.sh" activate test-mode \
            --config "$TEST_TMPDIR/.loa.config.yaml" \
            --index "$TEST_TMPDIR/.run/index.json"
    [ "$status" -eq 0 ]
    [ -f "$TEST_TMPDIR/.run/archetype.yaml" ]

    # Verify archetype contents
    local archetype_json
    if jq empty "$TEST_TMPDIR/.run/archetype.yaml" 2>/dev/null; then
        archetype_json=$(jq '.' "$TEST_TMPDIR/.run/archetype.yaml")
    else
        archetype_json=$(yq eval -o=json '.' "$TEST_TMPDIR/.run/archetype.yaml")
    fi

    [ "$(echo "$archetype_json" | jq -r '.active_mode')" = "test-mode" ]
    [ "$(echo "$archetype_json" | jq -r '.entry_point')" = "/test" ]
    [ "$(echo "$archetype_json" | jq -r '.active_constructs[0].slug')" = "test-construct" ]
    [ "$(echo "$archetype_json" | jq -r '.activated_at')" != "null" ]
}

# =============================================================================
# G-5: Greeting displays when opted in
# =============================================================================

@test "G-5: greeting displays when ambient_greeting is true" {
    _setup_mock_environment

    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs"

    # Generate index
    LOA_PACKS_DIR="$packs_dir" LOA_SKILLS_DIR="$TEST_TMPDIR/.claude/skills" \
        "$PROJECT_ROOT/.claude/scripts/construct-index-gen.sh" --json --output "$TEST_TMPDIR/.run/index.json" --quiet

    # Run greeting
    ARCHETYPE_FILE="$TEST_TMPDIR/.run/archetype.yaml" \
    THREADS_FILE="$TEST_TMPDIR/.run/open-threads.jsonl" \
        run "$PROJECT_ROOT/.claude/scripts/archetype-resolver.sh" greeting \
            --config "$TEST_TMPDIR/.loa.config.yaml" \
            --index "$TEST_TMPDIR/.run/index.json"
    [ "$status" -eq 0 ]

    # Should contain Active line with construct info
    [[ "$output" == *"Active:"* ]]
    [[ "$output" == *"test-construct"* ]]
    [[ "$output" == *"v1.0.0"* ]]

    # Should contain Entry line with command
    [[ "$output" == *"Entry:"* ]]
    [[ "$output" == *"/test"* ]]
}

# =============================================================================
# G-6: Capabilities aggregated correctly
# =============================================================================

@test "G-6: capabilities aggregated correctly from SKILL.md frontmatter" {
    _setup_mock_environment

    local packs_dir="$TEST_TMPDIR/.claude/constructs/packs"

    # Generate index (JSON for easy querying)
    LOA_PACKS_DIR="$packs_dir" LOA_SKILLS_DIR="$TEST_TMPDIR/.claude/skills" \
        "$PROJECT_ROOT/.claude/scripts/construct-index-gen.sh" --json --output "$TEST_TMPDIR/.run/index.json" --quiet

    # Query capabilities via construct-resolve
    CONSTRUCT_INDEX_PATH="$TEST_TMPDIR/.run/index.json" \
    PROJECT_ROOT="$TEST_TMPDIR" \
        run "$PROJECT_ROOT/.claude/scripts/construct-resolve.sh" capabilities test-construct --json
    [ "$status" -eq 0 ]

    # Verify capability values match SKILL.md frontmatter
    [ "$(echo "$output" | jq -r '.capabilities.read_files')" = "true" ]
    [ "$(echo "$output" | jq -r '.capabilities.search_code')" = "true" ]
    [ "$(echo "$output" | jq -r '.capabilities.write_files')" = "false" ]
    [ "$(echo "$output" | jq -r '.capabilities.execute_commands')" = "false" ]
    [ "$(echo "$output" | jq -r '.capabilities.web_access')" = "false" ]
    [ "$(echo "$output" | jq -r '.capabilities.schema_version')" = "1" ]
}
