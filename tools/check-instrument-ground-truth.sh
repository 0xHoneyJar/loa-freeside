#!/usr/bin/env bash
# =============================================================================
# tools/check-instrument-ground-truth.sh
#
# Campaign: Estate Immune System · M0 / G-IMMUNE — "every verdict/health/goal/
# sensor re-derives from a ground source; a lint blocks NEW self-reporting
# instruments." Bead: arrakis-estate-immune-epic-4xw6.1.
#
# This is the "re-derive-from-ground-truth" ENFORCING lint — the campaign's
# anti-recurrence keystone. It dissolves the lying-instruments cluster
# permanently by making it MECHANICALLY impossible to land a new immune
# instrument that has not been bound, in a reviewer-visible diff, to the ground
# source it re-derives its verdict from.
#
# IT IS A STRUCTURAL REGRESSION-CATCHER, NOT A SEMANTIC VERIFIER.
# It enforces exactly TWO mechanical contracts — nothing fuzzier:
#
#   (1) REGISTRATION (the teeth). Every file under the scan root that LOOKS like
#       an immune instrument — name matches `*-sensor.*`, `*-doctor.*`, or
#       `gate-*.*`, OR it carries an opt-in `# immune-instrument` header — MUST
#       be a key in the registry (tools/immune-instruments.yaml). A NEW,
#       unregistered instrument FAILS the lint. That is the
#       "blocks new self-reporting instruments" mechanism: you cannot add an
#       instrument without a reviewer signing off on its ground source in the
#       registry diff.
#
#   (2) GROUND-SOURCE PRESENCE (the binding). For every registered instrument,
#       each declared ground-source token must LITERALLY appear (fixed-string
#       grep) in the instrument's source. If the declared read is removed or
#       refactored away, the token vanishes and the lint fails — forcing a
#       re-confirmation of where the instrument actually gets its truth.
#
# WHAT IT DELIBERATELY DOES NOT DO (the fuzziness guard — do NOT add this):
# it does NOT try to semantically detect "emits a verdict but reads no ground
# source." That is statically intractable and false-positive-prone. The HUMAN
# APPROVING THE REGISTRY DIFF owns the semantic judgement ("is this token really
# the ground source?"). This lint only guarantees the claim was MADE and the
# declared read still EXISTS — a tight tripwire, never a broad analyzer. Same
# discipline as tools/check-no-direct-llm-fetch.sh (its sibling): literal
# substrings, an opt-in registry, a reviewer-visible suppression marker, and the
# exit code IS the verdict.
#
# Suppression (reviewer-visible, per-file): a file the globs catch but that is
# NOT actually an instrument can opt OUT of the registration requirement with a
# comment marker anywhere in the file:
#     # immune-lint:allow <reason>
# The marker + reason are visible in the PR diff; the human owns the call.
#
# ACCEPTED RISKS (PR review remains the gate — mirrors check-no-direct-llm-fetch.sh's
# accepted-risk stanza). The opt-in / suppression markers are matched LINE-ANCHORED
# to a real comment start, which defeats same-line string-literal smuggling (tested).
# It does NOT track quote / template-literal / heredoc state — a contrived file could
# embed a physical line `# immune-instrument` or `# immune-lint:allow` INSIDE a
# multiline string to spoof a marker. Defending that fully needs string-context
# analysis that is statically intractable and false-positive-prone — the exact "broad
# analyzer" this lint is designed NOT to be (it is a regression-catcher for ACCIDENTAL
# drift, not an adversarial-evasion boundary). The markers are reviewer-visible by
# construction, so a spoofed marker is visible in the PR diff and the human review is
# the real gate; an opt-in false-match also fails TOWARD more governance (it forces a
# registry row or an explicit suppression), never toward a silent ungrounded instrument.
#
# Usage:
#   tools/check-instrument-ground-truth.sh                 # scan tools/, default registry
#   tools/check-instrument-ground-truth.sh --root <dir>    # add a scan root (repeatable)
#   tools/check-instrument-ground-truth.sh --registry <f>  # use a specific registry
#   tools/check-instrument-ground-truth.sh --repo-root <d> # base for relative path keys
#   tools/check-instrument-ground-truth.sh --probe         # one-line STATUS tile (banner-style)
#   tools/check-instrument-ground-truth.sh --quiet         # exit-code only
#   tools/check-instrument-ground-truth.sh --help
#
# Exit codes (the verdict — capture $? before any pipe, per [[gate-output-never-piped]]):
#   0  clean — every candidate is registered AND every declared token is present
#   1  violation — an unregistered candidate, a missing declared token, or a
#      registered instrument whose file is gone
#   2  argument / I/O error (e.g. registry unreadable)
#
# Tested by tools/check-instrument-ground-truth.test.sh (the M0 acceptance
# fixture: a PLANTED self-reporting instrument must fail this lint with exit 1).
# =============================================================================

set -euo pipefail

# Repo root defaults to this script's parent dir (tools/..). Overridable so the
# fixture test can root the lint at a temp dir.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${LOA_IMMUNE_REPO_ROOT:-$(cd "$SELF_DIR/.." && pwd)}"
REGISTRY=""
QUIET=0
PROBE=0
declare -a SCAN_ROOTS=()

# Tri-state classification of a filename (a property of the FILE, evaluated ONCE so
# it governs BOTH the name path and the opt-in-header path — a *.test.*/*.spec. file
# carrying an `# immune-instrument` marker in its head is STILL excluded):
#   0 = name-candidate  (matches an instrument name-glob)
#   2 = excluded        (a test/spec — never an instrument, regardless of any header)
#   1 = neither         (not name-matched; the opt-in header may still pull it in)
# Intentionally narrow — only the three shapes immune instruments are named with.
_name_candidacy() {
    case "$1" in
        *.test.*|*.spec.*) return 2 ;;  # tests/specs verify instruments; they are not instruments
        *-sensor.*|*-doctor.*|gate-*.*) return 0 ;;
        *) return 1 ;;
    esac
}

# Opt-in header: a file NOT matching the name-globs can still be governed by
# placing this marker on its own comment line in the head (first 40 lines).
# Both REs are LINE-ANCHORED to a (possibly indented) comment start — `#` for
# sh/py, `//` for mjs/ts — so the marker only counts as a real comment, never a
# match smuggled inside a string literal or a trailing inline-code comment. The
# OPTIN trailing `[[:space:]:]|$` guard stops a reference to
# `immune-instruments.yaml` from reading as an opt-in.
OPTIN_RE='^[[:space:]]*(#|//)[[:space:]]*immune-instrument([[:space:]:]|$)'
# Reviewer-visible opt-OUT for a glob-matched file that is not really an
# instrument. The distinctive `:allow` suffix makes a collision implausible.
SUPPRESS_RE='^[[:space:]]*(#|//)[[:space:]]*immune-lint:allow'
SUPPRESS_MARKER='# immune-lint:allow'   # display form (also matches `// immune-lint:allow`)

# --------------------------------------------------------------------------
# CLI arg parsing
# --------------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
    case "$1" in
        --quiet|-q) QUIET=1; shift ;;
        --probe) PROBE=1; shift ;;
        --root)
            [[ $# -ge 2 ]] || { printf 'check-instrument-ground-truth.sh: --root requires a path\n' >&2; exit 2; }
            SCAN_ROOTS+=("$2"); shift 2 ;;
        --registry)
            [[ $# -ge 2 ]] || { printf 'check-instrument-ground-truth.sh: --registry requires a path\n' >&2; exit 2; }
            REGISTRY="$2"; shift 2 ;;
        --repo-root)
            [[ $# -ge 2 ]] || { printf 'check-instrument-ground-truth.sh: --repo-root requires a path\n' >&2; exit 2; }
            REPO_ROOT="$(cd "$2" && pwd)"; shift 2 ;;
        --help|-h)
            sed -n '/^# Usage:/,/^# Tested/p' "$0" | sed 's/^# \?//'
            exit 0 ;;
        *)
            printf 'check-instrument-ground-truth.sh: unknown arg %q\n' "$1" >&2
            exit 2 ;;
    esac
done

[[ -n "$REGISTRY" ]] || REGISTRY="$REPO_ROOT/tools/immune-instruments.yaml"
[[ ${#SCAN_ROOTS[@]} -gt 0 ]] || SCAN_ROOTS=("$REPO_ROOT/tools")

if [[ ! -f "$REGISTRY" ]]; then
    printf 'check-instrument-ground-truth.sh: registry not found: %q\n' "$REGISTRY" >&2
    exit 2
fi

# Validate + canonicalize every scan root up front. Two startup contracts:
#   (a) each root must EXIST as a directory — a lint that inspects zero files and
#       exits 0 is the false-green this campaign kills; refuse to scan nothing.
#   (b) each root must resolve UNDER --repo-root. The registry keys are
#       repo-root-relative (rel="${f#"$REPO_ROOT/"}"), so a root outside REPO_ROOT
#       would yield an absolute key that can never match the registry — a confusing
#       spurious UNREGISTERED. Make the --root/registry-key contract explicit by
#       failing loud (exit 2) instead. Canonicalizing here also makes the prefix
#       strip exact for relative/symlinked roots.
for i in "${!SCAN_ROOTS[@]}"; do
    root="${SCAN_ROOTS[$i]}"
    if [[ ! -d "$root" ]]; then
        printf 'check-instrument-ground-truth.sh: scan root %q is not a directory — refusing to scan nothing\n' "$root" >&2
        exit 2
    fi
    abs_root="$(cd "$root" && pwd)"
    if [[ "$abs_root" != "$REPO_ROOT" && "$abs_root" != "$REPO_ROOT"/* ]]; then
        printf 'check-instrument-ground-truth.sh: scan root %q does not resolve under --repo-root %q\n' "$root" "$REPO_ROOT" >&2
        printf '  (registry keys are repo-root-relative; a root outside it can never match)\n' >&2
        exit 2
    fi
    SCAN_ROOTS[i]="$abs_root"
done

# --------------------------------------------------------------------------
# Registry parser (flat YAML map: "<path>:" then "  - \"<token>\"" lines).
# Hermetic — an awk parser for this fixed shape, so the lint needs no `yq`.
# Emits a tab-delimited stream: "KEY\t<path>" and "TOK\t<path>\t<token>".
# Full-line comments (^[space]*#) and blank lines are skipped; the comment rule
# runs first so a comment ending in ':' is never mistaken for a key. tokval()
# takes the FIRST quoted segment (so a trailing inline comment after the close
# quote is ignored, per YAML) and strips a trailing " #..." from unquoted values.
# SQ is a literal single quote passed via -v, so the program needs no shell-side
# quote escaping.
# --------------------------------------------------------------------------

# shellcheck disable=SC2016  # the awk program is a literal — $0/regex must NOT expand in bash
REGISTRY_PARSE_AWK='
function tokval(s,   r, i) {
    if (substr(s, 1, 1) == "\"") { r = substr(s, 2); i = index(r, "\""); return (i > 0) ? substr(r, 1, i - 1) : r }
    if (substr(s, 1, 1) == SQ)   { r = substr(s, 2); i = index(r, SQ);   return (i > 0) ? substr(r, 1, i - 1) : r }
    sub(/[ \t]+#.*$/, "", s); sub(/[ \t]+$/, "", s); return s
}
function keyval(s) {
    if (s ~ /^".*"$/) return substr(s, 2, length(s) - 2)
    if (substr(s, 1, 1) == SQ && substr(s, length(s), 1) == SQ) return substr(s, 2, length(s) - 2)
    return s
}
/^[[:space:]]*#/ { next }
/^[[:space:]]*$/ { next }
/^[[:space:]]+-[[:space:]]/ {
    line = $0
    sub(/^[[:space:]]+-[[:space:]]+/, "", line)
    if (key != "") print "TOK\t" key "\t" tokval(line)
    next
}
/^[^[:space:]].*:[[:space:]]*$/ {
    key = $0
    sub(/:[[:space:]]*$/, "", key)
    print "KEY\t" keyval(key)
    next
}
'

declare -A REGISTERED=()
declare -A TOKENS=()        # path -> newline-delimited tokens

while IFS=$'\t' read -r kind a b; do
    case "$kind" in
        KEY) REGISTERED["$a"]=1; [[ -n "${TOKENS[$a]+x}" ]] || TOKENS["$a"]="" ;;
        TOK) TOKENS["$a"]+="$b"$'\n' ;;
    esac
done < <(awk -v SQ="'" "$REGISTRY_PARSE_AWK" "$REGISTRY")

# --------------------------------------------------------------------------
# Pass A — REGISTRATION teeth. Every on-disk candidate must be registered
# (or carry the suppression marker). An unregistered candidate is a NEW
# self-reporting instrument that was never bound to a ground source.
# --------------------------------------------------------------------------

violations=""
candidates=0
suppressed=0

_is_suppressed() { grep -qE -- "$SUPPRESS_RE" "$1"; }

for root in "${SCAN_ROOTS[@]}"; do
    # Roots are validated + canonicalized at startup (exist, under --repo-root).
    # find's stderr is left visible so an unreadable subtree is never silently skipped.
    while IFS= read -r -d '' f; do
        name="${f##*/}"
        # Classify the file ONCE (tri-state). `|| class=$?` keeps set -e happy while
        # capturing a non-zero return; the exclusion (class 2) is evaluated here so a
        # *.test.*/*.spec. file can never reach the opt-in-header path below.
        class=0
        _name_candidacy "$name" || class=$?
        is_cand=0
        case "$class" in
            0) is_cand=1 ;;   # name-matched instrument candidate
            2) continue ;;    # excluded test/spec — never a candidate, header or not
            *)                # 1 = neither: the opt-in header may still pull it in
                # Capture the head into a var and grep a here-string rather than
                # `head | grep -q`: under pipefail an early grep -q match would SIGPIPE
                # head and the pipeline would (wrongly) read as no-match.
                head_txt="$(head -40 -- "$f" 2>/dev/null || true)"
                if grep -qE -- "$OPTIN_RE" <<< "$head_txt"; then is_cand=1; fi
                ;;
        esac
        [[ $is_cand -eq 1 ]] || continue

        rel="${f#"$REPO_ROOT/"}"
        candidates=$((candidates + 1))

        if _is_suppressed "$f"; then
            suppressed=$((suppressed + 1))
            continue
        fi
        if [[ -z "${REGISTERED[$rel]+x}" ]]; then
            violations+="UNREGISTERED	$rel	candidate immune instrument is not in the registry"$'\n'
        fi
    done < <(find "$root" -type f -print0 | sort -z)
done

# --------------------------------------------------------------------------
# Pass B — GROUND-SOURCE PRESENCE binding. Every registered instrument's file
# must exist and literally contain each declared ground-source token.
# --------------------------------------------------------------------------

registered_checked=0
for rel in "${!REGISTERED[@]}"; do
    abs="$REPO_ROOT/$rel"
    if [[ ! -f "$abs" ]]; then
        violations+="MISSING_FILE	$rel	registered instrument file not found (remove the registry entry or restore the file)"$'\n'
        continue
    fi
    toks="${TOKENS[$rel]:-}"
    if [[ -z "${toks//$'\n'/}" ]]; then
        violations+="NO_TOKEN	$rel	registered instrument declares no ground-source token"$'\n'
        continue
    fi
    registered_checked=$((registered_checked + 1))
    while IFS= read -r tok; do
        [[ -n "$tok" ]] || continue
        if ! grep -qF -- "$tok" "$abs"; then
            violations+="TOKEN_ABSENT	$rel	declared ground-source token not found in source: ${tok}"$'\n'
        fi
    done <<< "$toks"
done

# --------------------------------------------------------------------------
# Report — exit code IS the verdict.
# --------------------------------------------------------------------------

vcount="$(printf '%s' "$violations" | sed '/^$/d' | wc -l | tr -d ' ')"

# --probe: one-line banner-style STATUS tile (mirrors the .mjs doctors' --probe).
# Exit code keeps the lint's own contract (0 clean / 1 violation) so the tile and
# the verdict stay consistent.
if [[ $PROBE -eq 1 ]]; then
    if [[ -n "$violations" ]]; then
        printf '⚠ ground-truth-lint · %s violation(s) — unregistered/ungrounded immune instrument(s)\n' "$vcount"
        exit 1
    fi
    printf '✓ ground-truth-lint · %s instrument(s) grounded (candidates=%s, suppressed=%s)\n' \
        "$registered_checked" "$candidates" "$suppressed"
    exit 0
fi

if [[ -n "$violations" ]]; then
    if [[ $QUIET -eq 0 ]]; then
        printf 'M0 / G-IMMUNE: immune-instrument ground-truth lint FAILED\n' >&2
        printf 'Every immune instrument must be registered in %s and bound to a ground source.\n' "${REGISTRY#"$REPO_ROOT/"}" >&2
        printf '\nViolations:\n' >&2
        printf '%s' "$violations" | sed '/^$/d' | while IFS=$'\t' read -r code path msg; do
            printf '  [%s] %s\n        %s\n' "$code" "$path" "$msg" >&2
        done
        printf '\nTo fix:\n' >&2
        printf '  - NEW instrument: add its path + the literal ground-source token(s) it reads\n' >&2
        printf '    its truth from to %s (a reviewer signs off on the ground source).\n' "${REGISTRY#"$REPO_ROOT/"}" >&2
        printf '  - NOT an instrument: add the per-file marker  %s <reason>\n' "$SUPPRESS_MARKER" >&2
        printf '  - TOKEN_ABSENT: the declared read was removed/refactored — re-confirm the\n' >&2
        printf '    ground source and update the token in the registry.\n' >&2
    fi
    exit 1
fi

if [[ $QUIET -eq 0 ]]; then
    printf 'OK — every immune instrument re-derives from a registered ground source\n'
    printf '(candidates=%d, suppressed=%d, registered_checked=%d)\n' \
        "$candidates" "$suppressed" "$registered_checked"
fi
exit 0
