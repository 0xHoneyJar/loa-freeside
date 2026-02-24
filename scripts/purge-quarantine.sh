#!/usr/bin/env bash
# purge-quarantine.sh — 30-day retention purge for micro_usd_parse_failures
#
# Deletes quarantined rows older than 30 days (configurable via RETENTION_DAYS).
# Safe to run idempotently — will not delete rows younger than retention period.
#
# Usage:
#   ./scripts/purge-quarantine.sh                    # Default: 30 days
#   RETENTION_DAYS=7 ./scripts/purge-quarantine.sh   # Custom retention
#   DB_PATH=/path/to/db ./scripts/purge-quarantine.sh
#
# Sprint 4 (346), Task 4.4, AC-4.4.3d
# @see grimoires/loa/sprint.md

set -euo pipefail

RETENTION_DAYS="${RETENTION_DAYS:-30}"
DB_PATH="${DB_PATH:-themes/sietch/data/arrakis.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH" >&2
  exit 1
fi

echo "[purge-quarantine] Purging rows older than ${RETENTION_DAYS} days from micro_usd_parse_failures..."

DELETED=$(sqlite3 "$DB_PATH" <<SQL
DELETE FROM micro_usd_parse_failures
WHERE created_at < datetime('now', '-${RETENTION_DAYS} days');
SELECT changes();
SQL
)

echo "[purge-quarantine] Deleted ${DELETED} rows"

# Report remaining
REMAINING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM micro_usd_parse_failures;")
UNREPLAYED=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM micro_usd_parse_failures WHERE replayed_at IS NULL;")

echo "[purge-quarantine] Remaining: ${REMAINING} total, ${UNREPLAYED} unreplayed"
