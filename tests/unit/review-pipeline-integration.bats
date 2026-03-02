#!/usr/bin/env bats
# =============================================================================
# Review Pipeline Integration Tests (Sprint 4 — T4.1)
# =============================================================================
# Cycle: cycle-048 (Community Feedback — Review Pipeline Hardening)
# Tests the end-to-end review pipeline: curl config creation (FR-6),
# 401 error extraction and redaction (FR-4), and verdict extraction (FR-1).

setup() {
    BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    SCRIPT_DIR="$PROJECT_ROOT/.claude/scripts"

    export BATS_TMPDIR="${BATS_TMPDIR:-/tmp}"
    export TEST_TMPDIR="$BATS_TMPDIR/review-pipeline-integration-test-$$"
    mkdir -p "$TEST_TMPDIR/bin"

    # Set up mock environment
    export OPENAI_API_KEY="sk-test-key-for-integration-tests"
    export MAX_RETRIES=1
    export RETRY_DELAY=0

    # Reset library load guards so we can source fresh
    unset _LIB_SECURITY_LOADED
    unset _LIB_CURL_FALLBACK_LOADED

    # Source the libraries (order matters: security first, then curl fallback)
    source "$SCRIPT_DIR/lib-security.sh"
    source "$SCRIPT_DIR/lib-curl-fallback.sh"
    # normalize-json.sh is loaded by lib-curl-fallback.sh, but source explicitly
    # to ensure extract_verdict is available
    source "$SCRIPT_DIR/lib/normalize-json.sh"
}

teardown() {
    cd /
    if [[ -d "$TEST_TMPDIR" ]]; then
        rm -rf "$TEST_TMPDIR"
    fi
}

# =============================================================================
# Helper: Create a mock curl that returns a specific HTTP code and body
# =============================================================================
_create_mock_curl() {
    local http_code="$1"
    local body="$2"
    local mock_curl="$TEST_TMPDIR/bin/curl"
    cat > "$mock_curl" <<MOCK_EOF
#!/usr/bin/env bash
# Mock curl — returns preset response + HTTP code
# Write the body followed by newline and HTTP code (mimicking -w "\n%{http_code}")
printf '%s\n%s' '$body' '$http_code'
MOCK_EOF
    chmod +x "$mock_curl"
    export PATH="$TEST_TMPDIR/bin:$PATH"
}

# =============================================================================
# FR-6: Curl Config Creation Tests
# =============================================================================

@test "integration: write_curl_auth_config creates file with valid key" {
    local cfg
    cfg=$(write_curl_auth_config "Authorization" "Bearer sk-test-integration-key")
    [ -f "$cfg" ]
    local content
    content=$(cat "$cfg")
    [[ "$content" == *'Authorization: Bearer sk-test-integration-key'* ]]
    rm -f "$cfg"
}

@test "integration: write_curl_auth_config sets 0600 permissions" {
    local cfg
    cfg=$(write_curl_auth_config "Authorization" "Bearer sk-test-perms")
    [ -f "$cfg" ]
    local perms
    if [[ "$(uname)" == "Darwin" ]]; then
        perms=$(stat -f '%Lp' "$cfg")
    else
        perms=$(stat -c '%a' "$cfg")
    fi
    [ "$perms" = "600" ]
    rm -f "$cfg"
}

# =============================================================================
# FR-4: 401 Error Extraction and Redaction Tests
# =============================================================================

@test "integration: 401 with JSON error body surfaces .error.message" {
    local json_body='{"error":{"message":"Incorrect API key provided: sk-test...ests.","type":"invalid_request_error","param":null,"code":"invalid_api_key"}}'
    _create_mock_curl "401" "$json_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    [[ "$output" == *"Incorrect API key provided"* ]]
}

@test "integration: 401 with JSON error body redacts key fragments" {
    local json_body='{"error":{"message":"Incorrect API key provided: sk-proj-abc123def456ghi789jklmnop012345.","type":"invalid_request_error"}}'
    _create_mock_curl "401" "$json_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    [[ "$output" == *"Incorrect API key provided"* ]]
    [[ "$output" == *"[REDACTED]"* ]]
}

@test "integration: 401 with empty body falls back to generic message" {
    _create_mock_curl "401" ""

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    [[ "$output" == *"check OPENAI_API_KEY"* ]]
}

# =============================================================================
# FR-1: Verdict Extraction Tests
# =============================================================================

@test "integration: extract_verdict returns .overall_verdict" {
    local json='{"overall_verdict":"APPROVED","summary":"looks good"}'
    run extract_verdict "$json"
    [ "$status" -eq 0 ]
    [ "$output" = "APPROVED" ]
}

@test "integration: extract_verdict returns .verdict over .overall_verdict" {
    local json='{"verdict":"CHANGES_REQUIRED","overall_verdict":"APPROVED"}'
    run extract_verdict "$json"
    [ "$status" -eq 0 ]
    [ "$output" = "CHANGES_REQUIRED" ]
}

@test "integration: extract_verdict exits 1 for missing verdict" {
    local json='{"summary":"no verdict field at all"}'
    run extract_verdict "$json"
    [ "$status" -eq 1 ]
}

# =============================================================================
# End-to-End Flow: Config → Error → Success Verdict Path
# =============================================================================

@test "integration: e2e curl config creation feeds into API call path" {
    # Step 1: Verify curl config can be created (prerequisite for API calls)
    local cfg
    cfg=$(write_curl_auth_config "Authorization" "Bearer ${OPENAI_API_KEY}")
    [ -f "$cfg" ]
    local cfg_content
    cfg_content=$(cat "$cfg")
    [[ "$cfg_content" == *"Authorization: Bearer"* ]]
    rm -f "$cfg"

    # Step 2: Simulate 401 error path — verify error is surfaced and redacted
    local json_401='{"error":{"message":"Bad key: sk-proj-testkey0123456789abcdefghijklmn."}}'
    _create_mock_curl "401" "$json_401"

    run call_api "gpt-4o" "review this" "code content" "30"
    [ "$status" -eq 4 ]
    [[ "$output" == *"[REDACTED]"* ]]
}

@test "integration: e2e success path with verdict extraction" {
    # Mock a successful API response with .overall_verdict
    local success_body='{"choices":[{"message":{"content":"{\"overall_verdict\":\"APPROVED\",\"summary\":\"All checks pass\",\"findings\":[]}"}}]}'
    _create_mock_curl "200" "$success_body"

    run call_api "gpt-4o" "system prompt" "code content" "30"
    [ "$status" -eq 0 ]

    # run captures both stderr and stdout; extract the JSON line (last line)
    local json_line="${lines[${#lines[@]}-1]}"
    local verdict
    verdict=$(extract_verdict "$json_line")
    [ "$verdict" = "APPROVED" ]
}

@test "integration: e2e CHANGES_REQUIRED verdict flows through" {
    local success_body='{"choices":[{"message":{"content":"{\"verdict\":\"CHANGES_REQUIRED\",\"summary\":\"Issues found\",\"findings\":[{\"id\":\"F1\",\"description\":\"Bug\",\"severity\":\"high\"}]}"}}]}'
    _create_mock_curl "200" "$success_body"

    run call_api "gpt-4o" "system prompt" "code content" "30"
    [ "$status" -eq 0 ]

    # run captures both stderr and stdout; extract the JSON line (last line)
    local json_line="${lines[${#lines[@]}-1]}"
    local verdict
    verdict=$(extract_verdict "$json_line")
    [ "$verdict" = "CHANGES_REQUIRED" ]
}
