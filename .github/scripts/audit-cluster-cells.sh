#!/usr/bin/env bash
# audit-cells.sh — Walk the freeside cluster; verify per-cell Loa mount per ADR-009 D-4.
# Part of construct-freeside / auditing-cluster-cells skill.
#
# Encodes lessons from cluster-harness-audit-2026-05-25:
#   - Use `git symbolic-ref refs/remotes/origin/HEAD` not hardcoded `origin/main` (Agent 3)
#   - Dereference submodule-style mounts via `.loa/.claude/` (Agent 4)
#   - Detect per-cell package manager (bun/pnpm/npm/yarn — cluster heterogeneous; Agent 3)
#
# Usage:
#   audit-cells.sh                  # markdown table, all cells
#   audit-cells.sh --json           # JSON output
#   audit-cells.sh --cell <slug>    # single cell only
#
# Env:
#   GITHUB_DIR  (default ~/Documents/GitHub)

set -euo pipefail

OUTPUT_FORMAT="markdown"
SINGLE_CELL=""
GITHUB_DIR="${GITHUB_DIR:-$HOME/Documents/GitHub}"
# Registry used to resolve a cell's git_url so in-monolith cells (git_url=loa-freeside,
# e.g. events-api) are handled without a separate sibling repo (bead
# arrakis-cluster-compliance-audit-crash-88ah). Overridable for hermetic tests.
AUDIT_REGISTRY_FILE="${AUDIT_REGISTRY_FILE:-$GITHUB_DIR/packages/freeside-registry/registry.yaml}"

# Cell roster + fs paths (parallel arrays for bash 3.2 compatibility)
CELL_SLUGS=(identity-api sonar-api storage-api mint-api activities-api inventory-api score-api mediums-api)
CELL_DIRS=(freeside-auth freeside-sonar freeside-storage freeside-mint freeside-activities inventory-api score-api freeside-mediums)

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) OUTPUT_FORMAT="json"; shift ;;
    --cell) SINGLE_CELL="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--json] [--cell <slug>]"
      echo ""
      echo "Walks the freeside cluster cells; reports per-cell Loa mount state."
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

cell_dir_for() {
  local target="$1"
  local i=0
  for slug in "${CELL_SLUGS[@]}"; do
    if [ "$slug" = "$target" ]; then
      echo "${CELL_DIRS[$i]}"
      return 0
    fi
    i=$((i + 1))
  done
  echo ""
}

# Resolve a cell's declared git_url from the registry (pure-awk parse, no yq dep).
# Empty when the registry is unreadable or the slug is absent.
git_url_for() {
  local target="$1"
  [ -f "$AUDIT_REGISTRY_FILE" ] || { echo ""; return; }
  awk -v want="$target" '
    /^  [A-Za-z0-9_.-]+:[ \t]*$/ { cur=$0; sub(/^  /,"",cur); sub(/:.*/,"",cur); next }
    cur==want && /^    git_url:/ { u=$0; sub(/^[ \t]*git_url:[ \t]*/,"",u); print u; exit }
  ' "$AUDIT_REGISTRY_FILE"
}

probe_cell() {
  local slug="$1"

  # In-monolith cells (git_url=loa-freeside, e.g. events-api) have no separate
  # repo or mount to audit. Emit a valid, honest record so the aggregating jq
  # never sees malformed JSON (bead arrakis-cluster-compliance-audit-crash-88ah).
  local url
  url="$(git_url_for "$slug")"
  case "$url" in
    *"/loa-freeside" | *"/loa-freeside.git")
      echo "$slug|IN_MONOLITH|(monolith)|in-monolith|—|Y|Y|Y|Y|?|clean"
      return
      ;;
  esac

  local dir
  dir="$(cell_dir_for "$slug")"
  local full="$GITHUB_DIR/$dir"

  if [ -z "$dir" ] || [ ! -d "$full" ]; then
    echo "$slug|NOT_FOUND|||||||||"
    return
  fi

  local default
  default=$(git -C "$full" symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@refs/remotes/origin/@@' || true)
  [ -z "$default" ] && default="(none)"

  local pattern="none"
  local mount_size="—"
  local mount_substantive="N"
  local size_kb=0

  if [ -f "$full/.gitmodules" ] && grep -q '^\[submodule "\.loa"\]' "$full/.gitmodules" 2>/dev/null; then
    pattern="submodule"
    if [ -d "$full/.loa/.claude" ]; then
      mount_size=$(du -sh "$full/.loa/.claude" 2>/dev/null | cut -f1)
      size_kb=$(du -sk "$full/.loa/.claude" 2>/dev/null | cut -f1)
      [ "${size_kb:-0}" -gt 5120 ] && mount_substantive="Y"
    fi
  elif [ -d "$full/.claude" ]; then
    pattern="copy"
    mount_size=$(du -sh "$full/.claude" 2>/dev/null | cut -f1)
    size_kb=$(du -sk "$full/.claude" 2>/dev/null | cut -f1)
    [ "${size_kb:-0}" -gt 5120 ] && mount_substantive="Y"
  fi

  local has_claude_md="N"; [ -f "$full/CLAUDE.md" ] && has_claude_md="Y"
  local has_grimoires="N"; [ -d "$full/grimoires/loa" ] && has_grimoires="Y"
  local has_beads="N"; [ -d "$full/.beads" ] && has_beads="Y"

  local pkg_mgr="?"
  if [ -f "$full/pnpm-lock.yaml" ]; then pkg_mgr="pnpm"
  elif [ -f "$full/bun.lock" ] || [ -f "$full/bunfig.toml" ]; then pkg_mgr="bun"
  elif [ -f "$full/package-lock.json" ]; then pkg_mgr="npm"
  elif [ -f "$full/yarn.lock" ]; then pkg_mgr="yarn"
  fi

  local drift=""
  [ "$mount_substantive" = "N" ] && drift="${drift}MOUNT_THIN;"
  [ "$has_claude_md" = "N" ] && drift="${drift}NO_CLAUDE_MD;"
  [ "$has_grimoires" = "N" ] && drift="${drift}NO_GRIMOIRES;"
  [ "$has_beads" = "N" ] && drift="${drift}NO_BEADS;"
  [ "$default" != "main" ] && drift="${drift}DEFAULT_NOT_MAIN($default);"
  [ -z "$drift" ] && drift="clean"

  echo "$slug|$full|$default|$pattern|$mount_size|$mount_substantive|$has_claude_md|$has_grimoires|$has_beads|$pkg_mgr|$drift"
}

# Filter cells
if [ -n "$SINGLE_CELL" ]; then
  CELL_SLUGS=("$SINGLE_CELL")
fi

# Collect results
RESULTS=()
for cell in "${CELL_SLUGS[@]}"; do
  RESULTS+=("$(probe_cell "$cell")")
done

# Output
if [ "$OUTPUT_FORMAT" = "json" ]; then
  # Build each per-cell record with jq (JSON-safe: --arg escapes any field
  # content), then validate with `jq empty` BEFORE aggregation. A record that
  # somehow fails validation becomes a degraded error entry — it never aborts
  # the whole audit (bead arrakis-cluster-compliance-audit-crash-88ah). This
  # replaces a raw heredoc whose string interpolation could emit invalid JSON
  # that crashed the downstream `jq --argjson` consumer.
  cell_objs=()
  for line in ${RESULTS[@]+"${RESULTS[@]}"}; do
    IFS='|' read -r slug fs def pat siz sub cmd gr bd pm drft <<< "$line"
    obj=$(jq -n \
      --arg slug "$slug" \
      --arg fs "$fs" \
      --arg defbr "$def" \
      --arg pat "$pat" \
      --arg siz "$siz" \
      --arg pm "$pm" \
      --arg drft "$drft" \
      --argjson sub "$([ "$sub" = "Y" ] && echo true || echo false)" \
      --argjson cmd "$([ "$cmd" = "Y" ] && echo true || echo false)" \
      --argjson gr "$([ "$gr" = "Y" ] && echo true || echo false)" \
      --argjson bd "$([ "$bd" = "Y" ] && echo true || echo false)" \
      '{slug: $slug, fs_path: $fs, default_branch: $defbr, mount_pattern: $pat,
        mount_size_human: $siz, substantive: $sub, claude_md_present: $cmd,
        grimoires_loa_present: $gr, beads_present: $bd, package_manager: $pm,
        drift_findings: $drft}')
    if ! printf '%s' "$obj" | jq empty 2>/dev/null; then
      obj=$(jq -n --arg slug "$slug" \
        '{slug: $slug, status: "ERROR", error: "per-cell record failed JSON validation"}')
    fi
    cell_objs+=("$obj")
  done
  printf '%s\n' ${cell_objs[@]+"${cell_objs[@]}"} | jq -s \
    --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{audit_ts: $ts, cells: .}'
else
  echo "# Cluster Cell Audit — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo ""
  printf "| %-15s | %-9s | %-8s | %-9s | %-9s | %-9s | %-7s | %-7s | %s\n" "cell" "pattern" "default" "mount" "CLAUDE.md" "grimoires" ".beads" "pkg-mgr" "drift"
  printf "| %-15s-|-%-9s-|-%-8s-|-%-9s-|-%-9s-|-%-9s-|-%-7s-|-%-7s-|-%s\n" "---------------" "---------" "--------" "---------" "---------" "---------" "-------" "-------" "-----"
  for line in "${RESULTS[@]}"; do
    IFS='|' read -r slug fs def pat siz sub cmd gr bd pm drft <<< "$line"
    printf "| %-15s | %-9s | %-8s | %-9s | %-9s | %-9s | %-7s | %-7s | %s\n" "$slug" "$pat" "$def" "$siz" "$cmd" "$gr" "$bd" "$pm" "$drft"
  done
fi
