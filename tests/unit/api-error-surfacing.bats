#!/usr/bin/env bats
# =============================================================================
# Tests for API error surfacing in 401 handler (FR-4)
# =============================================================================
# Cycle: cycle-048 (Community Feedback — Review Pipeline Hardening)
# Tests: JSON error body, HTML fallback, empty body fallback,
#        key fragment redaction, JSON without .error fallback.

setup() {
    BATS_TEST_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")" && pwd)"
    PROJECT_ROOT="$(cd "$BATS_TEST_DIR/../.." && pwd)"
    SCRIPT_DIR="$PROJECT_ROOT/.claude/scripts"

    export BATS_TMPDIR="${BATS_TMPDIR:-/tmp}"
    export TEST_TMPDIR="$BATS_TMPDIR/api-error-surfacing-test-$$"
    mkdir -p "$TEST_TMPDIR/bin"

    # Set up mock environment
    export OPENAI_API_KEY="sk-test-key-for-unit-tests"
    export MAX_RETRIES=1
    export RETRY_DELAY=0

    # Reset library load guards so we can source fresh
    unset _LIB_SECURITY_LOADED
    unset _LIB_CURL_FALLBACK_LOADED

    # Source the libraries
    source "$SCRIPT_DIR/lib-security.sh"
    source "$SCRIPT_DIR/lib-curl-fallback.sh"
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
# JSON Error Body Tests
# =============================================================================

@test "401 handler: surfaces .error.message from JSON response" {
    local json_body='{"error":{"message":"Incorrect API key provided: sk-test...ests.","type":"invalid_request_error","param":null,"code":"invalid_api_key"}}'
    _create_mock_curl "401" "$json_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    # Should contain the specific error message
    [[ "$output" == *"Incorrect API key provided"* ]]
    # Should NOT contain the generic fallback
    [[ "$output" != *"check OPENAI_API_KEY"* ]]
}

@test "401 handler: redacts API key fragments from error message" {
    # Use a key fragment long enough to trigger redaction (sk-proj- + 20+ alphanum chars)
    local json_body='{"error":{"message":"Incorrect API key provided: sk-proj-abc123def456ghi789jklmnop012345.","type":"invalid_request_error"}}'
    _create_mock_curl "401" "$json_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    # The error message should be surfaced
    [[ "$output" == *"Incorrect API key provided"* ]]
    # The sk-proj-... key fragment should be redacted by redact_log_output
    [[ "$output" == *"[REDACTED]"* ]]
}

# =============================================================================
# HTML Fallback Tests
# =============================================================================

@test "401 handler: HTML response falls back to generic message" {
    local html_body='<html><body><h1>401 Unauthorized</h1></body></html>'
    _create_mock_curl "401" "$html_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    # Should fall back to generic message (jq will fail on HTML)
    [[ "$output" == *"check OPENAI_API_KEY"* ]]
}

# =============================================================================
# Empty Body Fallback Tests
# =============================================================================

@test "401 handler: empty response body falls back to generic message" {
    _create_mock_curl "401" ""

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    [[ "$output" == *"check OPENAI_API_KEY"* ]]
}

# =============================================================================
# JSON Without .error Field
# =============================================================================

@test "401 handler: JSON without .error.message falls back to generic message" {
    local json_body='{"status":"unauthorized","detail":"bad key"}'
    _create_mock_curl "401" "$json_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    # .error.message is absent, so should fall back to generic
    [[ "$output" == *"check OPENAI_API_KEY"* ]]
}

@test "401 handler: JSON with null .error.message falls back to generic message" {
    local json_body='{"error":{"message":null,"type":"auth_error"}}'
    _create_mock_curl "401" "$json_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
    [[ "$output" == *"check OPENAI_API_KEY"* ]]
}

# =============================================================================
# Exit Code Tests
# =============================================================================

@test "401 handler: returns exit code 4" {
    local json_body='{"error":{"message":"Invalid auth"}}'
    _create_mock_curl "401" "$json_body"

    run call_api "gpt-4o" "system prompt" "content" "30"
    [ "$status" -eq 4 ]
}
