#!/usr/bin/env bash
# =============================================================================
# tools/quarantine/gate.sh — Sprint-1 T4 · FR-1 (the anti-masking teeth)
# =============================================================================
# A required CI gate over the manifest's quarantine[] list. Quarantine excludes
# a STRANDED test from the required suite — that exclusion is the masking risk
# the gate exists to neutralise (Flatline SKP-003). For each quarantined file it
# FAILS on:
#   1. past-expiry           — quarantine is time-boxed, not eternal.
#   2. missing owner/evidence — no anonymous quarantine; someone owns de-quarantine.
#   3. signature drift        — the test's assertion surface changed vs the
#      recorded stranded_signature. A planted conservation/auth/balance
#      regression IS a changed assertion surface, so this catches an attempt to
#      hide a real bug inside an excluded file.
#
# Modes:
#   tools/quarantine/gate.sh                 # check every quarantine[] entry (CI)
#   tools/quarantine/gate.sh --snapshot F    # print the signature of test file F
#                                            # (record it as stranded_signature)
# Exit: 0 = all entries pass, 1 = a tooth fired, 2 = env/parse error.
#
# Signature = sha256 over the sorted, whitespace-normalised set of assertion-
# bearing lines (expect(...) / assert...). Order-independent; sensitive to any
# added / removed / modified assertion. For a quarantined (untrusted, mid-
# extraction) file, ANY assertion change must force a human re-review + re-snapshot.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${MANIFEST:-$ROOT/tools/extraction/extraction-manifest.yaml}"
TEST_ROOT="${TEST_ROOT:-$ROOT/themes/sietch}"   # quarantine[].file is relative to here

# Portable sha256 (repo convention: funnel through sha256_portable; local
# fallback keeps tools/ self-contained on macOS/BSD where sha256sum is absent).
if [[ -r "$ROOT/.claude/scripts/compat-lib.sh" ]]; then
  # shellcheck disable=SC1091
  source "$ROOT/.claude/scripts/compat-lib.sh" 2>/dev/null || true
fi
if ! declare -F sha256_portable >/dev/null 2>&1; then
  # shellcheck disable=SC2120  # called with no args (reads stdin) by design
  sha256_portable() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"  # check-no-raw-sha256sum: ok
    else shasum -a 256 "$@"; fi
  }
fi

assertion_signature() {
  # $1 = absolute path to a test file → echoes "sha256:<hex>"
  # shellcheck disable=SC2119  # sha256_portable reads stdin here, no file arg
  local f="$1" hex
  hex="$(grep -nE 'expect\(|(^|[^A-Za-z0-9_])assert(\.|\()' "$f" 2>/dev/null \
    | sed -E 's/^[0-9]+://; s/[[:space:]]+/ /g; s/^ //; s/ $//' \
    | LC_ALL=C sort \
    | sha256_portable \
    | awk '{print $1}')"
  echo "sha256:${hex}"
}

# ── --snapshot mode ──
if [[ "${1:-}" == "--snapshot" ]]; then
  f="${2:-}"
  [[ -n "$f" ]] || { echo "::error::--snapshot needs a file path" >&2; exit 2; }
  [[ -f "$f" ]] || f="$TEST_ROOT/$f"
  [[ -f "$f" ]] || { echo "::error::test file not found: ${2:-}" >&2; exit 2; }
  assertion_signature "$f"
  exit 0
fi

# ── check mode ──
[[ -f "$MANIFEST" ]] || { echo "::error::manifest not found: $MANIFEST" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "::error::python3 required to read the YAML manifest" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "::error::jq required" >&2; exit 2; }

# YAML → JSON (default=str coerces YAML dates) → compact quarantine rows
rows="$(python3 -c 'import sys,yaml,json;json.dump(yaml.safe_load(open(sys.argv[1])) or {},sys.stdout,default=str)' "$MANIFEST" \
  | jq -c '(.quarantine // [])[]')"

if [[ -z "$rows" ]]; then
  echo "✓ quarantine gate: no quarantine[] entries (required suite excludes nothing)"
  exit 0
fi

TODAY="$(date -u +%Y-%m-%d)"
fail=0
count=0

while IFS= read -r row; do
  [[ -z "$row" ]] && continue
  count=$((count + 1))
  file="$(jq -r '.file // ""'   <<<"$row")"
  owner="$(jq -r '.owner // ""' <<<"$row")"
  expiry="$(jq -r '.expiry // ""' <<<"$row")"
  reason="$(jq -r '.reason // .evidence // ""' <<<"$row")"
  bead="$(jq -r '.bead // ""'   <<<"$row")"
  recorded="$(jq -r '.stranded_signature // ""' <<<"$row")"
  abs="$TEST_ROOT/$file"

  # 2. owner / evidence teeth
  [[ -n "$owner" ]]  || { echo "::error::[$file] missing owner — no anonymous quarantine"; fail=1; }
  [[ -n "$reason" ]] || { echo "::error::[$file] missing reason/evidence"; fail=1; }
  [[ -n "$bead" ]]   || { echo "::error::[$file] missing tracking bead"; fail=1; }

  # 1. expiry tooth (ISO dates compare lexicographically)
  if [[ -z "$expiry" ]]; then
    echo "::error::[$file] missing expiry — quarantine must be time-boxed"; fail=1
  elif [[ "$TODAY" > "$expiry" ]]; then
    echo "::error::[$file] quarantine EXPIRED ($expiry < $TODAY) — fix the test or re-justify (owner: ${owner:-?}, bead: ${bead:-?})"; fail=1
  fi

  # 3. signature-drift tooth (SKP-003 anti-masking)
  if [[ ! -f "$abs" ]]; then
    echo "::warning::[$file] quarantined file not found — stale entry? remove it from the manifest"
  elif [[ -z "$recorded" ]]; then
    echo "::error::[$file] no stranded_signature recorded — run: tools/quarantine/gate.sh --snapshot $file"; fail=1
  else
    current="$(assertion_signature "$abs")"
    if [[ "$current" != "$recorded" ]]; then
      echo "::error::[$file] assertion-signature DRIFT — recorded=$recorded current=$current"
      echo "          a quarantined test's assertions changed. A planted conservation/auth/balance"
      echo "          regression looks exactly like this. Re-review the diff; if legitimately stranded,"
      echo "          re-snapshot (tools/quarantine/gate.sh --snapshot $file) and justify in the bead."
      fail=1
    fi
  fi
done <<< "$rows"

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "::error::quarantine gate FAILED — $count entr(y/ies) checked"
  exit 1
fi
echo "✓ quarantine gate: $count entr(y/ies) pass — none expired, all owned+beaded, no assertion drift"
exit 0
