#!/usr/bin/env bash
# ecosystem-stats.sh — Collect statistics for docs/ECOSYSTEM.md
# Usage: scripts/ecosystem-stats.sh [--fresh] [--json]
#
# Measures: file counts, test counts, line counts per repo.
# Caches results to grimoires/loa/cache/ecosystem-stats.json (7-day TTL).
# --fresh: Force re-collection, ignore cache.
# --json: Output raw JSON instead of table.

set -euo pipefail
LC_ALL=C; export LC_ALL

CACHE_DIR="grimoires/loa/cache"
CACHE_FILE="${CACHE_DIR}/ecosystem-stats.json"
CACHE_TTL_DAYS=7
FRESH=false
JSON_OUTPUT=false

REPOS=(
  "loa-freeside:local"
  "loa:0xHoneyJar/loa"
  "loa-hounfour:0xHoneyJar/loa-hounfour"
  "loa-finn:0xHoneyJar/loa-finn"
  "loa-dixie:0xHoneyJar/loa-dixie"
)

for arg in "$@"; do
  case "$arg" in
    --fresh) FRESH=true ;;
    --json) JSON_OUTPUT=true ;;
    --help|-h)
      echo "Usage: $0 [--fresh] [--json]"
      echo "  --fresh  Force re-collection (ignore cache)"
      echo "  --json   Output raw JSON"
      exit 0
      ;;
  esac
done

# Check cache freshness
if [[ "$FRESH" == "false" && -f "$CACHE_FILE" ]]; then
  cache_age=$(( ($(date +%s) - $(stat -c %Y "$CACHE_FILE" 2>/dev/null || stat -f %m "$CACHE_FILE" 2>/dev/null)) / 86400 ))
  if [[ $cache_age -lt $CACHE_TTL_DAYS ]]; then
    if [[ "$JSON_OUTPUT" == "true" ]]; then
      cat "$CACHE_FILE"
    else
      echo "Using cached stats (${cache_age}d old, TTL=${CACHE_TTL_DAYS}d). Use --fresh to refresh."
      jq -r '.repos[] | "  \(.name): \(.ts_files) TS files, \(.test_files) tests, tag \(.latest_tag)"' "$CACHE_FILE"
    fi
    exit 0
  fi
fi

mkdir -p "$CACHE_DIR"

collect_local_stats() {
  local name="$1"
  local ts_files test_files tf_files route_files latest_tag commit_sha

  ts_files=$(find packages themes apps -name '*.ts' -o -name '*.tsx' 2>/dev/null | grep -v node_modules | grep -v dist | wc -l | tr -d ' ')
  test_files=$(find . \( -name '*.test.ts' -o -name '*.spec.ts' -o -name '*.test.js' \) 2>/dev/null | grep -v node_modules | wc -l | tr -d ' ')
  tf_files=$(find infrastructure/terraform -name '*.tf' 2>/dev/null | wc -l | tr -d ' ')
  route_files=$(find themes/sietch/src/api/routes -name '*.ts' 2>/dev/null | wc -l | tr -d ' ')
  latest_tag=$(git describe --tags --abbrev=0 2>/dev/null || echo "unknown")
  commit_sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

  printf '{"name":"%s","ts_files":%s,"test_files":%s,"tf_files":%s,"route_files":%s,"latest_tag":"%s","commit_sha":"%s"}' \
    "$name" "$ts_files" "$test_files" "$tf_files" "$route_files" "$latest_tag" "$commit_sha"
}

collect_remote_stats() {
  local name="$1"
  local gh_repo="$2"
  local latest_tag commit_sha

  if command -v gh &>/dev/null; then
    latest_tag=$(gh api "repos/${gh_repo}/tags?per_page=1" --jq '.[0].name' 2>/dev/null || echo "unknown")
    commit_sha=$(gh api "repos/${gh_repo}/tags?per_page=1" --jq '.[0].commit.sha[:7]' 2>/dev/null || echo "unknown")
  else
    latest_tag="unknown"
    commit_sha="unknown"
  fi

  printf '{"name":"%s","ts_files":null,"test_files":null,"tf_files":null,"route_files":null,"latest_tag":"%s","commit_sha":"%s"}' \
    "$name" "$latest_tag" "$commit_sha"
}

# Collect all stats
results="["
first=true
for entry in "${REPOS[@]}"; do
  name="${entry%%:*}"
  source="${entry#*:}"

  [[ "$first" == "true" ]] && first=false || results+=","

  if [[ "$source" == "local" ]]; then
    results+=$(collect_local_stats "$name")
  else
    results+=$(collect_remote_stats "$name" "$source")
  fi
done
results+="]"

# Wrap in metadata
output=$(printf '{"measured_at":"%s","repos":%s}' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$results")

# Write cache
echo "$output" | jq '.' > "$CACHE_FILE"

# Output
if [[ "$JSON_OUTPUT" == "true" ]]; then
  echo "$output" | jq '.'
else
  echo "Ecosystem stats collected:"
  echo "$output" | jq -r '.repos[] | "  \(.name): \(.ts_files // "—") TS files, \(.test_files // "—") tests, tag \(.latest_tag)"'
  echo ""
  echo "Cached to $CACHE_FILE (TTL: ${CACHE_TTL_DAYS} days)"
fi
