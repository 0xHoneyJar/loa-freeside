#!/usr/bin/env bash
# extract-routes.sh — Extract HTTP routes from Express route files
# Usage: scripts/extract-routes.sh [--json] [--count] [--diff] [--snapshot]
#
# Extracts route registrations from themes/sietch/src/api/routes/*.ts
# using pattern matching on Express router method calls.
#
# Modes:
#   (default)  Print route table to stdout
#   --json     Output JSON array of route objects
#   --count    Print total route count only
#   --diff     Compare against snapshot (new=info, missing=error, changed=warning)
#   --snapshot Save current extraction to scripts/route-snapshot.json

set -euo pipefail
LC_ALL=C; export LC_ALL

ROUTES_DIR="themes/sietch/src/api/routes"
SNAPSHOT_FILE="scripts/route-snapshot.json"
MODE="table"

for arg in "$@"; do
  case "$arg" in
    --json) MODE="json" ;;
    --count) MODE="count" ;;
    --diff) MODE="diff" ;;
    --snapshot) MODE="snapshot" ;;
    --help|-h)
      echo "Usage: $0 [--json] [--count] [--diff] [--snapshot]"
      exit 0
      ;;
  esac
done

if [[ ! -d "$ROUTES_DIR" ]]; then
  echo "ERROR: Routes directory not found: $ROUTES_DIR" >&2
  exit 1
fi

# Extract routes using a single awk pass (was ~8 subprocess spawns per line).
# Semantics preserved byte-for-byte vs the prior grep/cut/tr pipeline: same line
# filter (router|app.METHOD), first-match method (uppercased), first quoted path
# (quotes stripped), case-insensitive auth heuristic, find|sort file order, FNR line.
extract_routes() {
  local files=()
  while IFS= read -r f; do files+=("$f"); done < <(find "$ROUTES_DIR" -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' -not -name '*.integration.ts' | LC_ALL=C sort)

  if [[ ${#files[@]} -eq 0 ]]; then
    printf '[\n]\n'
    return 0
  fi

  awk '
    BEGIN { printf "["; first = 1 }
    # Same outer filter as the old grep -nE alternation
    $0 !~ /router\.(get|post|put|delete|patch|all)\(/ && \
      $0 !~ /app\.(get|post|put|delete|patch|all)\(/ { next }
    {
      # method: first .METHOD( match, drop "." and "(", uppercase (== grep -oE|head -1|tr)
      if (!match($0, /\.(get|post|put|delete|patch|all)\(/)) next
      m = substr($0, RSTART, RLENGTH); gsub(/[.(]/, "", m); method = toupper(m)
      # path: first quoted string, strip all quote chars (== grep -oE|head -1|tr -d)
      if (!match($0, /["'"'"'][^"'"'"']+["'"'"']/)) next
      p = substr($0, RSTART, RLENGTH); gsub(/["'"'"']/, "", p)
      if (p == "") next
      # auth heuristic (== grep -qiE), case-insensitive
      auth = (tolower($0) ~ /auth|jwt|token|apikey|requireauth|verifytoken/) ? "true" : "false"
      if (first) first = 0; else printf ","
      printf "\n  {\"method\":\"%s\",\"path\":\"%s\",\"auth\":%s,\"source_file\":\"%s\",\"line\":%s}", \
        method, p, auth, FILENAME, FNR
    }
    END { printf "\n]\n" }
  ' "${files[@]}"
}

routes_json=$(extract_routes)
route_count=$(echo "$routes_json" | jq 'length')

case "$MODE" in
  json)
    echo "$routes_json" | jq '.'
    ;;
  count)
    echo "$route_count"
    ;;
  table)
    echo "Extracted $route_count routes from $ROUTES_DIR"
    echo ""
    echo "$routes_json" | jq -r '.[] | "\(.method)\t\(.path)\t\(if .auth then "AUTH" else "PUBLIC" end)\t\(.source_file):\(.line)"' | column -t -s $'\t'
    ;;
  snapshot)
    echo "$routes_json" | jq '.' > "$SNAPSHOT_FILE"
    echo "Snapshot saved: $SNAPSHOT_FILE ($route_count routes)"
    ;;
  diff)
    if [[ ! -f "$SNAPSHOT_FILE" ]]; then
      echo "ERROR: No snapshot found at $SNAPSHOT_FILE. Run --snapshot first." >&2
      exit 1
    fi

    snapshot_count=$(jq 'length' "$SNAPSHOT_FILE")
    echo "Current: $route_count routes | Snapshot: $snapshot_count routes"
    echo ""

    # Find new routes (in current but not snapshot)
    new_routes=$(echo "$routes_json" | jq -r --slurpfile snap "$SNAPSHOT_FILE" '
      [.[] | . as $r | if ([$snap[][] | select(.method == $r.method and .path == $r.path)] | length) == 0 then $r else empty end]
    ')
    new_count=$(echo "$new_routes" | jq 'length')

    if [[ "$new_count" -gt 0 ]]; then
      echo "INFO: $new_count new routes:"
      echo "$new_routes" | jq -r '.[] | "  + \(.method) \(.path) (\(.source_file):\(.line))"'
    fi

    # Find missing routes (in snapshot but not current)
    missing_routes=$(jq -r --argjson current "$routes_json" '
      [.[] | . as $r | if ([$current[] | select(.method == $r.method and .path == $r.path)] | length) == 0 then $r else empty end]
    ' "$SNAPSHOT_FILE")
    missing_count=$(echo "$missing_routes" | jq 'length')

    if [[ "$missing_count" -gt 0 ]]; then
      echo "ERROR: $missing_count missing routes:"
      echo "$missing_routes" | jq -r '.[] | "  - \(.method) \(.path) (\(.source_file):\(.line))"'
      exit 1
    fi

    if [[ "$new_count" -eq 0 && "$missing_count" -eq 0 ]]; then
      echo "OK: No route changes detected."
    fi
    ;;
esac
