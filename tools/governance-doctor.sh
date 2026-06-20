#!/usr/bin/env bash
# tools/governance-doctor.sh
# =============================================================================
# Straylight stale-artifact immune system for loa-freeside.
#
# WHY: loa-freeside is a former monolith. Capabilities were extracted into
# external *-api cells, leaving stale "corpses" behind (grimoires/loa/reality/*
# is the big one — old /ride captures of monolith source). Ungoverned + stale
# artifacts cause future agent sessions to GROUND ON THEM AS TRUTH — the failure
# the operator named ("future sessions suffer"). A one-time cleanup decays the
# next time a cell extracts. This doctor is the standing mechanism instead.
#
# THE TRIAD (estate-immune-system pattern):
#   LOUD   — scan the truth-surface set, classify each, print a status tile.
#   STAMP  — `--stamp` writes a Straylight governance block onto CORPSES only
#            (DEMOTION: it withholds authority, never grants it — the agent
#            never self-promotes, per the force chain).
#   TEETH  — `--teeth` exits 1 when a CORPSE or a HAND-GOVERN root doc is
#            ungoverned-and-stale, so CI / a pre-commit hook fails on silent rot.
#
# THREE TIERS (deliberately NOT one bucket — a numb gate that fires on every
# recent brief is noise, per the operator's "CI sensors must not be numb"):
#   QUARANTINE  reality/*  — old monolith captures. Auto-stampable. In the gate.
#   WATCH       context/*, federation specs — recent session briefs. REPORTED for
#               governance-debt visibility, never auto-quarantined, never gated.
#   HAND_GOVERN README / CLAUDE.md / BUTTERFREEZONE — need accurate banners by
#               hand (not a mechanical stamp). Reported + gated.
#
# A "governed" artifact carries leading frontmatter with these Straylight keys:
#   use_label    usable | background_only | mark_as_contested | do_not_use_for_action
#   read_state   unread | skimmed | read | validated
#   source_type  operator-validated | operator-authored | ai-derived | ai-autogen
#   as_of        ISO date the claims were last verified (the staleness anchor)
#
# STALE = effective date (as_of → filename YYYY-MM-DD → git commit → mtime) older
# than STALE_DAYS AND use_label still asserts authority (usable / none). A corpse
# stamped do_not_use_for_action is GOVERNED-AND-QUARANTINED: never stale, because
# it no longer claims to be true.
#
# CANONICAL SoT (what corpses should defer to):
#   packages/freeside-registry/registry.yaml  +  `freeside-cli doctor` live-probe
#
# Usage:
#   tools/governance-doctor.sh            # LOUD report (read-only)
#   tools/governance-doctor.sh --json     # machine-readable report
#   tools/governance-doctor.sh --stamp    # write governance blocks onto CORPSES
#   tools/governance-doctor.sh --teeth    # exit 1 if a corpse/root doc is ungoverned-stale
# =============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STALE_DAYS="${GOVERNANCE_STALE_DAYS:-30}"
SOT_POINTER="packages/freeside-registry/registry.yaml (+ freeside-cli doctor live-probe)"
MODE="report"
case "${1:-}" in
  --json)  MODE="json";;
  --stamp) MODE="stamp";;
  --teeth) MODE="teeth";;
esac

# Tier globs (resolved from repo root). Edit as surfaces are added/extracted.
QUARANTINE_GLOBS=( "grimoires/loa/reality/*.md" )
WATCH_GLOBS=(
  "grimoires/loa/context/*.md"
  "grimoires/loa/specs/enhance-freeside-api-surface.md"
  "grimoires/loa/specs/enhance-federation-contract-suite.md"
)
HAND_GOVERN=( "README.md" "CLAUDE.md" "BUTTERFREEZONE.md" )

# -----------------------------------------------------------------------------
has_governance() {
  local f="$1" head; head="$(head -25 "$f" 2>/dev/null || true)"
  grep -qE '^[[:space:]]*use_label:'   <<<"$head" && \
  grep -qE '^[[:space:]]*read_state:'  <<<"$head" && \
  grep -qE '^[[:space:]]*source_type:' <<<"$head"
}
quarantined() {  # use_label withdraws authority → corpse already neutralized
  head -25 "$1" 2>/dev/null | grep -qE '^[[:space:]]*use_label:[[:space:]]*(do_not_use_for_action|background_only|mark_as_contested)'
}
to_days() {      # ISO date -> days-ago
  local d="$1" epoch now
  epoch="$(date -j -f "%Y-%m-%d" "$d" "+%s" 2>/dev/null || date -d "$d" "+%s" 2>/dev/null || echo 0)"
  now="$(date "+%s")"; echo $(( (now - epoch) / 86400 ))
}
age_days() {     # as_of -> filename date -> git commit -> mtime -> 9999
  local f="$1" d
  d="$(head -25 "$f" 2>/dev/null | grep -oE '^[[:space:]]*as_of:[[:space:]]*[0-9]{4}-[0-9]{2}-[0-9]{2}' | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
  [[ -z "$d" ]] && d="$(basename "$f" | grep -oE '^[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)"
  [[ -z "$d" ]] && d="$(git log -1 --format=%cs -- "$f" 2>/dev/null || true)"
  if [[ -z "$d" ]]; then
    d="$(date -r "$f" "+%Y-%m-%d" 2>/dev/null || true)"   # mtime (untracked files)
  fi
  [[ -z "$d" ]] && { echo 9999; return; }
  to_days "$d"
}
classify() {     # GOVERNED_FRESH GOVERNED_QUARANTINED UNGOVERNED_FRESH UNGOVERNED_STALE
  local f="$1" age; age="$(age_days "$f")"
  if has_governance "$f"; then
    if quarantined "$f"; then echo "GOVERNED_QUARANTINED"; else echo "GOVERNED_FRESH"; fi
  elif (( age > STALE_DAYS )); then echo "UNGOVERNED_STALE"
  else echo "UNGOVERNED_FRESH"; fi
}
tile() {
  case "$1" in
    GOVERNED_FRESH)       echo "✅ governed";;
    GOVERNED_QUARANTINED) echo "🔒 quarantined";;
    UNGOVERNED_FRESH)     echo "🟡 ungoverned";;
    UNGOVERNED_STALE)     echo "⚫ UNGOVERNED+STALE";;
  esac
}
stamp_corpse() { # Prepend a quarantine block (corpses only). Skips files that
                 # already have frontmatter (never auto-merge hand-authored meta).
  local f="$1" age today tmp
  head -1 "$f" | grep -qE '^(---|<!--)' && { echo "  ↳ SKIP (has frontmatter): $f"; return; }
  age="$(age_days "$f")"; today="$(date +%Y-%m-%d)"; tmp="$(mktemp)"
  {
    echo "---"
    echo "# Straylight governance — quarantined by tools/governance-doctor.sh"
    echo "use_label: do_not_use_for_action"
    echo "read_state: read"
    echo "source_type: ai-autogen   # generated by /ride from monolith source"
    echo "as_of: $today"
    echo "staleness_note: >-"
    echo "  CORPSE. This is a ~${age}d-old /ride capture of the loa-freeside MONOLITH."
    echo "  Most of what it describes has been EXTRACTED into external *-api cells."
    echo "  Do NOT ground on it. For live truth, probe the registry:"
    echo "superseded_by: $SOT_POINTER"
    echo "---"
    echo ""
    cat "$f"
  } > "$tmp"
  mv "$tmp" "$f"; echo "  ↳ quarantined: $f"
}

shopt -s nullglob
resolve() { local out=(); for g in "$@"; do for m in $g; do [[ -f "$m" ]] && out+=("$m"); done; done; printf '%s\n' "${out[@]}"; }
mapfile -t Q_FILES < <(resolve "${QUARANTINE_GLOBS[@]}")
mapfile -t W_FILES < <(resolve "${WATCH_GLOBS[@]}")
mapfile -t H_FILES < <(resolve "${HAND_GOVERN[@]}")

if [[ "$MODE" == "json" ]]; then
  printf '{\n  "checked_at": "%s",\n  "stale_days": %s,\n  "artifacts": [\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$STALE_DAYS"
  first=1
  for f in "${Q_FILES[@]}" "${W_FILES[@]}" "${H_FILES[@]}"; do
    [[ $first -eq 0 ]] && printf ',\n'; first=0
    printf '    {"path": "%s", "tier": "%s", "status": "%s", "age_days": %s}' \
      "$f" "$([[ " ${Q_FILES[*]} " == *" $f "* ]] && echo quarantine || { [[ " ${H_FILES[*]} " == *" $f "* ]] && echo hand_govern || echo watch; })" \
      "$(classify "$f")" "$(age_days "$f")"
  done
  printf '\n  ]\n}\n'; exit 0
fi

gate_fail=0
section() { # $1 title; remaining = files; $LAST flag handled by caller
  echo "── $1 ──────────────────────────────────────────────────────"
}
echo "═══════════════════════════════════════════════════════════════════════"
echo " governance-doctor · loa-freeside · stale>${STALE_DAYS}d · $(date +%Y-%m-%d)"
echo " SoT: $SOT_POINTER"
echo "═══════════════════════════════════════════════════════════════════════"

section "QUARANTINE — monolith corpses (auto-stamp + gated)"
for f in "${Q_FILES[@]}"; do
  c="$(classify "$f")"
  printf "  %-22s %5sd  %s\n" "$(tile "$c")" "$(age_days "$f")" "$f"
  [[ "$c" == "UNGOVERNED_STALE" ]] && gate_fail=$((gate_fail+1))
  [[ "$MODE" == "stamp" && "$c" == UNGOVERNED_* ]] && stamp_corpse "$f"
done

section "HAND-GOVERN — root docs (gated; banner by hand)"
for f in "${H_FILES[@]}"; do
  c="$(classify "$f")"
  printf "  %-22s %5sd  %s\n" "$(tile "$c")" "$(age_days "$f")" "$f"
  [[ "$c" == "UNGOVERNED_STALE" ]] && gate_fail=$((gate_fail+1))
done

section "WATCH — recent briefs/specs (debt visibility; not gated)"
w_ungoverned=0
for f in "${W_FILES[@]}"; do
  c="$(classify "$f")"
  printf "  %-22s %5sd  %s\n" "$(tile "$c")" "$(age_days "$f")" "$f"
  [[ "$c" == UNGOVERNED_* ]] && w_ungoverned=$((w_ungoverned+1))
done

echo "───────────────────────────────────────────────────────────────────────"
echo "  gate-relevant ungoverned-stale: $gate_fail   ·   watch-tier ungoverned: $w_ungoverned"
if [[ "$MODE" == "teeth" ]]; then
  if (( gate_fail > 0 )); then
    echo "  TEETH: ✗ $gate_fail corpse/root doc(s) ungoverned-stale — run --stamp or add a banner." >&2
    exit 1
  fi
  echo "  TEETH: ✓ corpses + root docs all governed."
fi
exit 0
