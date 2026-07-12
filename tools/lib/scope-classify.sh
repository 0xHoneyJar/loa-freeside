#!/usr/bin/env bash
# tools/lib/scope-classify.sh — pnpm reverse-dependency-graph walker (SDD §1.4/§4.2, FR-1a)
#
# Given a git diff of changed files, produces the set of changed packages PLUS
# their transitive dependents, or signals fallback-to-full on cross-cutting change.
# The graph is built from every packages/**/package.json — THERE IS NO ROOT
# pnpm-workspace.yaml; edges come from per-package `file:`/`@freeside/*` specifiers.
#
# Sibling to tools/lib/domain-classify.sh (classification precedent).
#
# Used by:
#   - tools/scope-checks-sensor.sh (S1-T2) — maps in-scope packages to concrete
#     `pnpm --filter <pkg> <cmd>` commands and emits the NFR-7 verdict record.
#
# Reference: grimoires/loa/sdd.md §1.4 (FR-1a), §4.2; decisions/008-freeside-as-factory.md
#
# Graph node identity = the package `name` field (e.g. "@freeside/ordering-service"),
# because dependency specifiers reference by name and `pnpm --filter <name>` consumes it.
#
# Configuration:
#   SCOPE_REPO_ROOT — repo root the changed-file paths resolve against and under
#                     whose packages/ tree the manifests are found. Default ".".
#
# All functions are ambient-IFS-independent: emission uses quoted array expansion,
# not unquoted word-splitting, so a caller that has reset IFS still gets one
# newline-delimited package name per line (no leading/trailing whitespace).
#
# Public API (consumed by S1-T2):
#   classify_changed_packages "<newline-separated file list>"
#       -> echoes (one per line) the set of package NAMES directly changed (dedup).
#          A file with no owning package under packages/ is silently skipped here;
#          scope_for_diff() is what promotes such paths to fallback-to-full.
#
#   reverse_dependents "<pkg-name>"
#       -> echoes (one per line) the package NAMES that depend on <pkg-name> via
#          `dependencies` + `peerDependencies` + `devDependencies` (IMP-006: peer
#          and dev edges are walked, not runtime-only). DIRECT dependents only.
#
#   scope_for_diff "<newline-separated file list>"
#       -> the full scoped set: (changed pkgs U all transitive reverse-dependents),
#          one NAME per line, sorted-unique. Return code 0.
#          If ANY changed path is cross-cutting / generated-code / dev-tooling
#          (root config, shared tsconfig, .github/**, pnpm-lock.yaml, generated
#          code, or any path the graph can't attribute to one package) -> echoes
#          the sentinel "__FALLBACK_TO_FULL__" and returns 3 (a scoped walk can't
#          be trusted; conservative — a missed dependent is worse than extra CI).

# ---------------------------------------------------------------------------
# Internal: owning package NAME for a changed file, or non-zero if none.
# Walks up the directory chain (bounded to packages/) to the deepest ancestor
# that carries a package.json, then reads its `name` field.
# ---------------------------------------------------------------------------
_scope_owning_pkg_name() {
  local file="$1"
  local root="${SCOPE_REPO_ROOT:-.}"

  # Only files under packages/ can belong to a graph node.
  case "$file" in
    packages/*) ;;
    *) return 1 ;;
  esac

  local dir
  dir="$(dirname "$file")"
  while [ "$dir" != "." ] && [ "$dir" != "/" ] && [ "$dir" != "packages" ]; do
    if [ -f "$root/$dir/package.json" ]; then
      jq -r '.name // empty' "$root/$dir/package.json"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

# ---------------------------------------------------------------------------
# Internal: is this changed path cross-cutting -> force fallback-to-full?
# Returns 0 (true) when the scoped walk cannot be trusted for this path.
# ---------------------------------------------------------------------------
_scope_is_cross_cutting() {
  local file="$1"

  case "$file" in
    # Lockfile (root or nested) — changes ripple across the whole install.
    pnpm-lock.yaml|*/pnpm-lock.yaml) return 0 ;;
    # Root manifest.
    package.json) return 0 ;;
    # Any tsconfig — conservative: a shared base tsconfig affects every package.
    tsconfig*.json|*/tsconfig*.json) return 0 ;;
    # CI workflows + scripts (dev-tooling / build-config).
    .github/*) return 0 ;;
    # Generated code — codegen output the graph can't attribute cleanly.
    *.gen.ts|*.gen.js|*.gen.*|*.generated.*) return 0 ;;
    */generated/*|*/__generated__/*) return 0 ;;
  esac

  # Not under packages/ at all -> not attributable to a graph node.
  case "$file" in
    packages/*) ;;
    *) return 0 ;;
  esac

  # Under packages/ but resolving to no owning package (e.g. a stray file in the
  # packages/ root) -> can't attribute -> conservative full.
  if ! _scope_owning_pkg_name "$file" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

# ---------------------------------------------------------------------------
# Public: package NAMES directly changed by the given file list (dedup).
# ---------------------------------------------------------------------------
classify_changed_packages() {
  local files="$1"
  local f name seen=" "
  local -a found=()
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    name="$(_scope_owning_pkg_name "$f" 2>/dev/null)" || continue
    [ -z "$name" ] && continue
    case "$seen" in
      *" $name "*) ;;
      *) seen="$seen$name "; found+=("$name") ;;
    esac
  done <<< "$files"
  printf '%s\n' "${found[@]+"${found[@]}"}"
}

# ---------------------------------------------------------------------------
# Public: DIRECT reverse dependents of <pkg-name> over deps+peerDeps+devDeps.
# ---------------------------------------------------------------------------
reverse_dependents() {
  local target="$1"
  local root="${SCOPE_REPO_ROOT:-.}"
  [ -z "$target" ] && return 0

  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if jq -e --arg t "$target" '
          ((.dependencies // {}) + (.peerDependencies // {}) + (.devDependencies // {}))
          | has($t)
        ' "$f" >/dev/null 2>&1; then
      jq -r '.name // empty' "$f"
    fi
  done <<< "$(find "$root/packages" -name package.json -not -path '*/node_modules/*' 2>/dev/null)"
}

# ---------------------------------------------------------------------------
# Public: full scoped set (changed U transitive reverse-dependents), or the
# fallback-to-full sentinel + return 3 on any cross-cutting change.
# ---------------------------------------------------------------------------
scope_for_diff() {
  local files="$1"
  local f

  # Any cross-cutting path poisons the whole scoped result -> full.
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    if _scope_is_cross_cutting "$f"; then
      echo "__FALLBACK_TO_FULL__"
      return 3
    fi
  done <<< "$files"

  local seen=" "        # O(1) membership set (space-padded for substring test)
  local -a scoped=()    # ordered accumulator, emitted as quoted array
  local -a queue=()     # BFS frontier
  local p

  # Seed the frontier with the directly-changed packages.
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    case "$seen" in
      *" $p "*) ;;
      *) seen="$seen$p "; scoped+=("$p"); queue+=("$p") ;;
    esac
  done <<< "$(classify_changed_packages "$files")"

  # BFS over reverse dependents until the frontier drains.
  while [ "${#queue[@]}" -gt 0 ]; do
    local cur="${queue[0]}"
    queue=("${queue[@]:1}")   # pop front (quoted, IFS-safe; empty-safe slice)
    local dep
    while IFS= read -r dep; do
      [ -z "$dep" ] && continue
      case "$seen" in
        *" $dep "*) ;;
        *) seen="$seen$dep "; scoped+=("$dep"); queue+=("$dep") ;;
      esac
    done <<< "$(reverse_dependents "$cur")"
  done

  # Emit sorted-unique names (empty-array-safe).
  printf '%s\n' "${scoped[@]+"${scoped[@]}"}" | sort -u
}
