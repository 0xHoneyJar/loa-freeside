#!/usr/bin/env bash
# =============================================================================
# tools/loa-signoff.test.sh — the SHIM delegates to `loa signoff`, args + exit intact.
# =============================================================================
# tools/loa-signoff.sh is now a thin shim; the real signoff LOGIC (suite-run, fail-closed
# RED-refusal, the commit-status POST, the privilege boundary) is tested in
# loa-cli/test/security/signoff_gate.mjs (30 assertions). Here we only guard the shim
# contract: it forwards every arg to `loa signoff` verbatim and propagates loa's exit code,
# and fails clearly when `loa` is absent. A mock `loa` on PATH keeps this offline.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
ck(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  ✓ $3"; else FAIL=$((FAIL+1)); echo "  ✗ FAIL $3 (got '$1' want '$2')"; fi }

echo "loa-signoff.test — shim → 'loa signoff' (logic lives in loa-cli/signoff_gate.mjs)"

# A mock `loa`: the guard probe `signoff --help` exits 0 (new-enough loa); any other
# invocation records its argv and exits with sentinel 7 so we can prove exit-propagation.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
REC="$TMP/rec"
cat > "$TMP/loa" <<EOF
#!/usr/bin/env bash
# the shim probes verb-recognition by CONTENT: emit the usage line on 'signoff --help'
if [ "\$1" = "signoff" ] && [ "\$2" = "--help" ]; then echo "loa signoff <pr> [--sha <SHA>]"; exit 0; fi
printf '%s\n' "\$*" > "$REC"
exit 7
EOF
chmod +x "$TMP/loa"

ec=0; PATH="$TMP:$PATH" bash "$HERE/loa-signoff.sh" 323 --repo o/r --dry-run >/dev/null 2>&1 || ec=$?
ck "$ec" 7 "propagates loa's exit code (sentinel 7)"
ck "$(cat "$REC" 2>/dev/null)" "signoff 323 --repo o/r --dry-run" "forwards 'signoff 323 --repo o/r --dry-run' verbatim"

# `loa` absent → clear exit 2 (fail-closed, not a silent no-op)
ec2=0; PATH="/usr/bin:/bin" bash "$HERE/loa-signoff.sh" 1 >/dev/null 2>&1 || ec2=$?
ck "$ec2" 2 "no loa on PATH → exit 2 with a clear install message"

echo ""
[ "$FAIL" -eq 0 ] && { echo "loa-signoff.test: PASS ($PASS)"; exit 0; } || { echo "loa-signoff.test: FAIL ($FAIL)"; exit 1; }
