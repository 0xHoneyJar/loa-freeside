#!/usr/bin/env bats
# Tests for .gitattributes merge=ours protection
# Verifies project identity files are protected from upstream overwrites
# Fixes: #439 — BUTTERFREEZONE.md collateral content overwrite

setup() {
  GITATTRIBUTES="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)/.gitattributes"
  UPDATE_LOA="$(cd "$(dirname "$BATS_TEST_FILENAME")/../.." && pwd)/.claude/commands/update-loa.md"
}

# =============================================================================
# .gitattributes — Project Identity Files
# =============================================================================

@test "BUTTERFREEZONE.md has merge=ours in .gitattributes" {
  grep -qF "BUTTERFREEZONE.md merge=ours" "$GITATTRIBUTES"
}

@test "README.md has merge=ours in .gitattributes" {
  grep -qF "README.md merge=ours" "$GITATTRIBUTES"
}

@test "CHANGELOG.md has merge=ours in .gitattributes" {
  grep -qF "CHANGELOG.md merge=ours" "$GITATTRIBUTES"
}

@test "all three identity files are in the same section" {
  # All identity files should appear between "PROJECT IDENTITY" and "STATE ZONE" headers
  local section
  section=$(awk '/PROJECT IDENTITY/,/STATE ZONE/' "$GITATTRIBUTES")
  echo "$section" | grep -qF "README.md merge=ours"
  echo "$section" | grep -qF "CHANGELOG.md merge=ours"
  echo "$section" | grep -qF "BUTTERFREEZONE.md merge=ours"
}

# =============================================================================
# Phase 5.3 — Content Replacement Detection
# =============================================================================

@test "Phase 5.3 documents content-replacement detection (--diff-filter=M)" {
  grep -qF "diff-filter=M" "$UPDATE_LOA"
}

@test "Phase 5.3 lists identity files for content-replacement check" {
  grep -q "README.md.*CHANGELOG.md.*BUTTERFREEZONE.md" "$UPDATE_LOA"
}

@test "Phase 5.3 references issue #439" {
  grep -qF "#439" "$UPDATE_LOA"
}

@test "Phase 5.3 explains why --diff-filter=D is insufficient" {
  grep -q "diff-filter=D.*cannot catch\|invisible to.*diff-filter=D\|modified, not deleted" "$UPDATE_LOA"
}
