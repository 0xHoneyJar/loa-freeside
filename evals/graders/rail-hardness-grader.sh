#!/usr/bin/env bash
# rail-hardness-grader.sh — environment-design gradient-health as a baseline-gated
# CI eval (bd-uze Track B / arrakis-jnjj). Makes the rail-hardness scoreboard a
# regression gate: the alignment % becomes a number a PR cannot silently drop.
#
# Two un-fakeable checks against the board in evals/environment-design/:
#   1. SCAN  — rail-hardness-scan.mjs verifies every `hook_backed` claim resolves
#              to a real file. Exit 3 = a roleplayed gradient (claims hardness, file
#              absent) → FAIL. This is the un-fakeable-hardness guard.
#   2. READ  — rail-hardness-read.mjs --json reports alignment_pct + over_hardened.
#              FAIL if alignment_pct < alignment_floor_pct (the RATCHET — up-only,
#              operator-bumped) OR over_hardened > over_hardened_max (the anti-
#              over-hardening guard; a soft seam wrongly gated kills creativity).
#
# Args: $1=workspace  (board resolved at $workspace/evals/environment-design/)
# Exit: 0=pass, 1=fail, 2=error. JSON on stdout: {pass,score,details,grader_version}.
# Version: 1.0.0
set -uo pipefail

GRADER_VERSION="1.0.0"
fail() { printf '{"pass":false,"score":%s,"details":"%s","grader_version":"%s"}\n' "${2:-0}" "$1" "$GRADER_VERSION"; exit "${3:-1}"; }
ok()   { printf '{"pass":true,"score":%s,"details":"%s","grader_version":"%s"}\n' "$1" "$2" "$GRADER_VERSION"; exit 0; }

workspace="${1:-}"  # harness contract; unused — the board is a repo artifact, not a sandbox output

# The board (evals/environment-design/) is a REPO ARTIFACT co-located with this
# grader, NOT a fixture-sandbox output. Resolve it relative to THIS script so CI —
# which runs the BASE-trusted grader against the PR's LIVE board (graders are
# copied from base, environment-design/ stays the PR's version) — gates the real,
# current board. (A repo-artifact eval, not a skill-output eval.)
GRADER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
board_subdir="${2:-environment-design}"   # board location under evals/ (task arg; default)
case "$board_subdir" in *..*|/*) fail "invalid board subdir '$board_subdir'" 0 2 ;; esac
board="$(cd "$GRADER_DIR/../$board_subdir" 2>/dev/null && pwd || echo "$GRADER_DIR/../$board_subdir")"
read_mjs="$board/rail-hardness-read.mjs"
scan_mjs="$board/rail-hardness-scan.mjs"
baseline="$board/rail-hardness.baseline.json"
for f in "$read_mjs" "$scan_mjs" "$baseline"; do
  [ -f "$f" ] || fail "missing board file: ${f#$workspace/}" 0 2
done
command -v node >/dev/null 2>&1 || fail "node not on PATH" 0 2

# 1. SCAN — un-fakeable hardness (exit 3 = a hook claim that does not resolve).
scan_out="$(node "$scan_mjs" 2>&1)"; scan_rc=$?
if [ "$scan_rc" -ne 0 ]; then
  det="rail-hardness SCAN failed (rc=$scan_rc) — a hook_backed claim does not resolve to a real file (roleplayed gradient). $(printf '%s' "$scan_out" | grep -i 'MISSING' | head -1 | tr -d '"')"
  fail "$det" 0 1
fi

# 2. READ — alignment + over-hardened vs the ratchet baseline.
read_json="$(node "$read_mjs" --json 2>/dev/null)" || fail "rail-hardness READ --json failed" 0 2

vals="$(LRH_JSON="$read_json" LRH_BASE="$baseline" python3 - <<'PY'
import json, os, sys
try:
    r = json.loads(os.environ["LRH_JSON"])
    b = json.loads(open(os.environ["LRH_BASE"]).read())
except Exception as e:
    print(f"ERR parse: {e}"); sys.exit(0)
align = r.get("alignment_pct", -1)
overh = r.get("over_hardened", 999)
floor = b.get("alignment_floor_pct", 0)
omax  = b.get("over_hardened_max", 0)
fails = []
if align < floor: fails.append(f"alignment {align}% < floor {floor}% (regression — the ratchet only goes UP)")
if overh > omax:  fails.append(f"over_hardened {overh} > max {omax} (a soft judgment seam was wrongly hardened)")
print(json.dumps({"align": align, "overh": overh, "floor": floor, "omax": omax, "fails": fails}))
PY
)"
case "$vals" in ERR*) fail "baseline/read parse error: $vals" 0 2 ;; esac

align="$(printf '%s' "$vals" | python3 -c 'import json,sys;print(json.load(sys.stdin)["align"])' 2>/dev/null)"
nfails="$(printf '%s' "$vals" | python3 -c 'import json,sys;print(len(json.load(sys.stdin)["fails"]))' 2>/dev/null)"
[ -n "$align" ] && [ -n "$nfails" ] || fail "could not extract grade from read json" 0 2

if [ "$nfails" -gt 0 ]; then
  det="$(printf '%s' "$vals" | python3 -c 'import json,sys;print(" | ".join(json.load(sys.stdin)["fails"]))' 2>/dev/null)"
  fail "$det" "$align" 1
fi
floor="$(printf '%s' "$vals" | python3 -c 'import json,sys;print(json.load(sys.stdin)["floor"])' 2>/dev/null)"
ok "$align" "rail-hardness aligned: ${align}% >= floor ${floor}% · over_hardened 0 · all hook claims resolve"
