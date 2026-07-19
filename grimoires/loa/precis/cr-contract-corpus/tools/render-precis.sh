#!/usr/bin/env bash
# Deterministic Précis renderer: ledgers/normalized-claims.jsonl -> precis.md body.
# Claims render verbatim from the settled ledger — no re-summarization.
# Usage: render-precis.sh <normalized-claims.jsonl>  (body to stdout)
set -euo pipefail
f="$1"
render_class() {
  local class="$1" title="$2"
  local n
  n=$(jq -r --arg c "$class" 'select(.class==$c) | .id' "$f" | wc -l | tr -d ' ')
  echo ""
  echo "## $title ($n)"
  echo ""
  jq -r --arg c "$class" '
    select(.class==$c) |
    "**\(.id)**\(if .disposition=="unresolved" then " · UNRESOLVED" else "" end) — \(.claim)\n" +
    "  - sources: \(.sources | join(" · "))\n" +
    "  - provenance: \(.provenance) · confidence: \(.confidence)" +
    (if (.merged_ids | length) > 0 then "\n  - merged: \(.merged_ids | join(", "))" else "" end) +
    (if (.notes // "") != "" then "\n  - notes: \(.notes)" else "" end) + "\n"
  ' "$f"
}
render_class invariant            "Contract invariants"
render_class boundary             "Boundary decisions (what is deliberately OUT)"
render_class versioning           "Versioning and compatibility commitments"
render_class rationale            "Design rationale"
render_class rejected-alternative "Rejected alternatives"
render_class unresolved-tension   "Unresolved tensions (carried AS OPEN — do not treat as settled)"
