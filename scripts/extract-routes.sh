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

# Extract routes using grep patterns for Express router methods
extract_routes() {
  local routes="["
  local first=true

  while IFS= read -r file; do
    local rel_path="$file"

    # Match: router.METHOD('path', ...) or router.METHOD("path", ...)
    while IFS= read -r line; do
      local line_num method path auth
      line_num=$(echo "$line" | cut -d: -f1)
      local content=$(echo "$line" | cut -d: -f2-)

      # Extract method
      if echo "$content" | grep -qE 'router\.(get|post|put|delete|patch|all)\('; then
        method=$(echo "$content" | grep -oE '\.(get|post|put|delete|patch|all)\(' | head -1 | tr -d '.(' | tr '[:lower:]' '[:upper:]')
      elif echo "$content" | grep -qE 'app\.(get|post|put|delete|patch|all)\('; then
        method=$(echo "$content" | grep -oE '\.(get|post|put|delete|patch|all)\(' | head -1 | tr -d '.(' | tr '[:lower:]' '[:upper:]')
      else
        continue
      fi

      # Extract path (single or double quoted)
      path=$(echo "$content" | grep -oE "['\"][^'\"]+['\"]" | head -1 | tr -d "'" | tr -d '"')

      if [[ -z "$path" ]]; then
        continue
      fi

      # Determine auth requirement (heuristic: presence of auth middleware)
      auth="false"
      if echo "$content" | grep -qiE 'auth|jwt|token|apiKey|requireAuth|verifyToken'; then
        auth="true"
      fi

      [[ "$first" == "true" ]] && first=false || routes+=","
      routes+=$(printf '\n  {"method":"%s","path":"%s","auth":%s,"source_file":"%s","line":%s}' \
        "$method" "$path" "$auth" "$rel_path" "$line_num")
    done < <(grep -nE 'router\.(get|post|put|delete|patch|all)\(|app\.(get|post|put|delete|patch|all)\(' "$file" 2>/dev/null || true)
  done < <(find "$ROUTES_DIR" -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' -not -name '*.integration.ts' | LC_ALL=C sort)

  routes+=$'\n]'
  echo "$routes"
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
