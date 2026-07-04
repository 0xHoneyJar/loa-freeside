#!/usr/bin/env bash
# =============================================================================
# tools/consumption-doctor.sh — S2-T1/T2 (SDD §1.4/§3.5/§4.3, FR-2a/FR-2b, G-2).
# A shared package cannot report "healthy" if no REAL consumer can import it.
#
# For each shared @freeside/* package it reads the ship shape from package.json
# (exports["."]/main): a `dist/*` entry ships DIST (must be built to import), a
# `src/*` entry ships SRC (resolve+import). It then exercises the PROBED REAL
# consumers (SDD §3.5 — the packages that actually depend on it) by resolving the
# package's declared entry UNDER THE CONSUMER'S module resolution (the pnpm
# node_modules symlink) and confirming the entry file exists / imports. A
# dist-shipping package whose dist is unbuilt is `unconsumable` — the exact break
# that hid (adapters). It never trusts a self-declared "healthy" — it asks the
# real consumer's resolver.
#
# GROUND SOURCE (registered in tools/immune-instruments.yaml — S2-T3): the real
# consumer's node_modules resolution of the package + the package's own
# exports/main entry on disk. Not a self-report.
#
# VERDICT / EXIT (frozen mapping — tools/immune-check.sh + the immune-verdict schema):
#   verdict=pass          exit 0 — consumable: a real consumer resolves+imports it
#   verdict=no-consumer   exit 0 — DISTINCT honest state (FR-2b): zero real consumers.
#                                  NOT a false pass, NOT a flag — reported as-is.
#   verdict=flag          exit 2 — unconsumable: a real consumer CANNOT import it
#                                  (e.g. ships dist, dist unbuilt)
#   verdict=insufficient  exit 1 — could not ground (no package.json / bad tree)
#
# Exit-code integrity (NFR-4): $? captured before any pipe; never `| tail`/`|| true`
# /`2>/dev/null` on the verdict path.
#
# Usage:
#   tools/consumption-doctor.sh @freeside/<pkg>     # one package
#   tools/consumption-doctor.sh --all               # every shared @freeside/* package
#   tools/consumption-doctor.sh ... --probe|--json
#
# Test seam (hermetic, no real build/install): CONSUMPTION_PROBE_CMD overrides the
# per-consumer import smoke — run via `bash -c` with env PKG, CONSUMER, SHIP, ENTRY;
# exit 0 = importable (consumable), non-zero = not importable (unconsumable).
# CONSUMPTION_ROOT overrides the packages/ tree root (default repo root).
# =============================================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_ROOT="${CONSUMPTION_ROOT:-$ROOT}"

MODE="banner"; TARGET_PKG=""; ALL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)   ALL=1; shift ;;
    --probe) MODE="probe"; shift ;;
    --json)  MODE="json"; shift ;;
    -h|--help) sed -n '2,45p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "consumption-doctor: unknown flag '$1'" >&2; exit 1 ;;
    @*)  TARGET_PKG="$1"; shift ;;
    *)   echo "consumption-doctor: unexpected arg '$1'" >&2; exit 1 ;;
  esac
done
command -v jq >/dev/null 2>&1 || { echo "consumption-doctor: requires jq" >&2; exit 1; }
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# manifest path for a package NAME
_manifest_for() {
  local name="$1" m
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    [[ "$(jq -r '.name // empty' "$m" 2>/dev/null)" == "$name" ]] && { printf '%s\n' "$m"; return 0; }
  done <<< "$(find "$PKG_ROOT/packages" -name package.json -not -path '*/node_modules/*' 2>/dev/null)"
  return 1
}

# the declared "." entry (exports["."].import | exports["."] | main), leading ./ stripped
_entry_of() {
  jq -r '((.exports["."] // empty) | if type=="object" then .import else . end) // .main // "index.js"' "$1" 2>/dev/null | sed 's#^\./##'
}

# ship shape from an entry path: dist|src|other
_ship_of() { case "$1" in dist/*|*/dist/*) echo dist ;; src/*|*/src/*) echo src ;; *) echo other ;; esac; }

# consumers of NAME = packages whose deps/peer/dev reference it (dir list)
_consumers_of() {
  local name="$1" m
  while IFS= read -r m; do
    [[ -z "$m" ]] && continue
    if jq -e --arg t "$name" '((.dependencies//{})+(.peerDependencies//{})+(.devDependencies//{}))|has($t)' "$m" >/dev/null 2>&1; then
      dirname "$m"
    fi
  done <<< "$(find "$PKG_ROOT/packages" -name package.json -not -path '*/node_modules/*' 2>/dev/null)"
}

# Is NAME importable under CONSUMER_DIR's resolution? 0=yes. Seam wins for tests.
_importable() { # name consumer_dir ship entry
  local name="$1" consumer="$2" ship="$3" entry="$4"
  if [[ -n "${CONSUMPTION_PROBE_CMD:-}" ]]; then
    PKG="$name" CONSUMER="$consumer" SHIP="$ship" ENTRY="$entry" bash -c "$CONSUMPTION_PROBE_CMD"
    return $?
  fi
  # Real resolution: the package as the consumer sees it (pnpm node_modules symlink).
  local link="$consumer/node_modules/$name" pkgdir
  [[ -e "$link" ]] || return 1                       # not resolvable from this consumer
  pkgdir="$(cd "$link" 2>/dev/null && pwd -P)" || return 1
  [[ -n "$pkgdir" && -f "$pkgdir/$entry" ]]          # declared entry exists under resolved dir
}

# Evaluate ONE package -> prints "verdict exit_code detail consumer" via globals
eval_pkg() { # name -> sets EV_VERDICT EV_EXIT EV_DETAIL EV_CONSUMER
  local name="$1"
  local m; m="$(_manifest_for "$name")" || { EV_VERDICT=insufficient; EV_EXIT=1; EV_DETAIL="no manifest for $name"; EV_CONSUMER=""; return; }
  local entry ship; entry="$(_entry_of "$m")"; ship="$(_ship_of "$entry")"
  local -a consumers=(); local c
  while IFS= read -r c; do [[ -n "$c" ]] && consumers+=("$c"); done <<< "$(_consumers_of "$name")"
  if [[ "${#consumers[@]}" -eq 0 ]]; then
    EV_VERDICT=no-consumer; EV_EXIT=0; EV_DETAIL="zero real consumers (ship=$ship)"; EV_CONSUMER=""; return
  fi
  # Consumable iff at least one real consumer can import it; else unconsumable (flag).
  for c in "${consumers[@]}"; do
    if _importable "$name" "$c" "$ship" "$entry"; then
      EV_VERDICT=pass; EV_EXIT=0; EV_DETAIL="consumable via $(basename "$c") (ship=$ship, entry=$entry)"; EV_CONSUMER="$c"; return
    fi
  done
  EV_VERDICT=flag; EV_EXIT=2; EV_DETAIL="unconsumable — no real consumer can import $entry (ship=$ship; dist unbuilt?)"; EV_CONSUMER="${consumers[0]}"
}

emit_one() { # name verdict exit detail consumer
  local name="$1" verdict="$2" ec="$3" detail="$4" consumer="$5"
  local record
  record="$(jq -n --arg sv "1.0" --arg sensor "consumption-doctor" --arg target "pkg:$name" \
    --arg verdict "$verdict" --argjson exit "$ec" --arg gen "$GENERATED_AT" \
    --arg detail "$detail" --arg consumer "$(basename "$consumer" 2>/dev/null || echo "")" \
    '{schema_version:$sv, sensor:$sensor, target:$target, verdict:$verdict, exit_code:$exit,
      generated_at:$gen, evidence:{detail:$detail, consumer:$consumer,
      commands:["tools/consumption-doctor.sh " + $target[4:]]}}')"
  local dir="$ROOT/.run/immune"; mkdir -p "$dir" 2>/dev/null || true
  printf '%s\n' "$record" > "$dir/consumption-doctor-$(printf '%s' "$name" | tr '/@' '__').json" 2>/dev/null || true
  local sym; case "$verdict" in pass) sym="✓";; no-consumer) sym="○";; flag) sym="⚠";; *) sym="·";; esac
  case "$MODE" in
    json)  printf '%s\n' "$record" ;;
    *)     printf '     %s consumption-doctor · %s · verdict=%s (exit %d) · %s\n' "$sym" "$name" "$verdict" "$ec" "$detail" ;;
  esac
}

# --- Drive: one package, or --all shared @freeside/* -------------------------------
declare -a NAMES=()
if [[ "$ALL" -eq 1 ]]; then
  while IFS= read -r m; do
    n="$(jq -r '.name // empty' "$m" 2>/dev/null)"; [[ "$n" == @freeside/* ]] && NAMES+=("$n")
  done <<< "$(find "$PKG_ROOT/packages" -name package.json -not -path '*/node_modules/*' 2>/dev/null)"
elif [[ -n "$TARGET_PKG" ]]; then
  NAMES=("$TARGET_PKG")
else
  echo "consumption-doctor: pass @freeside/<pkg> or --all" >&2; exit 1
fi

WORST=0
[[ "$MODE" == "banner" ]] && printf '  ╓─ consumption-doctor · %s\n' "$GENERATED_AT"
for name in "${NAMES[@]}"; do
  eval_pkg "$name"
  emit_one "$name" "$EV_VERDICT" "$EV_EXIT" "$EV_DETAIL" "$EV_CONSUMER"
  # aggregate: PROBLEM(2) dominates INSUFFICIENT(1) dominates HEALTHY(0)
  if [[ "$EV_EXIT" -eq 2 ]]; then WORST=2; elif [[ "$EV_EXIT" -eq 1 && "$WORST" -ne 2 ]]; then WORST=1; fi
done
[[ "$MODE" == "banner" ]] && printf '  ╙─ worst verdict exit: %d\n' "$WORST"
exit "$WORST"
