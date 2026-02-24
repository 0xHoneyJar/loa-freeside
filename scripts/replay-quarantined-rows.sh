#!/usr/bin/env bash
# replay-quarantined-rows.sh — Re-parse quarantined micro-USD rows
#
# Replays quarantined rows through parseBoundaryMicroUsd after data
# normalization fixes. Idempotent: skips rows where replayed_at IS NOT NULL.
# Sets replayed_at and increments replay_attempts on success.
# Records last_replay_error on failure.
#
# Usage:
#   ./scripts/replay-quarantined-rows.sh                 # Replay all unreplayed
#   LIMIT=10 ./scripts/replay-quarantined-rows.sh        # Replay up to 10
#   DRY_RUN=1 ./scripts/replay-quarantined-rows.sh       # Preview without writing
#   DB_PATH=/path/to/db ./scripts/replay-quarantined-rows.sh
#
# Sprint 4 (346), Task 4.4, AC-4.4.3e
# @see grimoires/loa/sprint.md

set -euo pipefail

LIMIT="${LIMIT:-1000}"
DRY_RUN="${DRY_RUN:-0}"
DB_PATH="${DB_PATH:-themes/sietch/data/arrakis.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH" >&2
  exit 1
fi

echo "[replay-quarantine] Fetching up to ${LIMIT} unreplayed quarantine entries..."

# Count unreplayed entries
UNREPLAYED=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM micro_usd_parse_failures WHERE replayed_at IS NULL;")
echo "[replay-quarantine] Found ${UNREPLAYED} unreplayed entries"

if [ "$UNREPLAYED" -eq 0 ]; then
  echo "[replay-quarantine] Nothing to replay"
  exit 0
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "[replay-quarantine] DRY_RUN mode — listing entries without replaying:"
  sqlite3 -header -column "$DB_PATH" \
    "SELECT id, table_name, original_row_id, raw_value, error_code, replay_attempts
     FROM micro_usd_parse_failures
     WHERE replayed_at IS NULL
     ORDER BY created_at ASC
     LIMIT ${LIMIT};"
  exit 0
fi

echo "[replay-quarantine] Replay requires the TypeScript runner. Use:"
echo "  npx tsx scripts/replay-quarantine-runner.ts --db ${DB_PATH} --limit ${LIMIT}"
echo ""
echo "[replay-quarantine] Or mark entries replayed manually after data fix:"
echo "  sqlite3 ${DB_PATH} \"UPDATE micro_usd_parse_failures SET replayed_at = datetime('now'), replay_attempts = replay_attempts + 1 WHERE replayed_at IS NULL AND id IN (SELECT id FROM micro_usd_parse_failures WHERE replayed_at IS NULL LIMIT ${LIMIT});\""
