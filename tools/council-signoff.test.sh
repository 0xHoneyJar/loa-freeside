#!/usr/bin/env bash
# =============================================================================
# tools/council-signoff.test.sh — the SHIM delegates to `loa council`, args + exit intact.
# =============================================================================
# tools/council-signoff.sh is now a thin shim; the real council LOGIC (fail-closed verdicts,
# the >=2-distinct-family approve gate, --comment-only mapping, bin resolution) is tested in
# loa-cli/test/security/signoff_gate.mjs. Here we only guard the shim contract: forward args
# to `loa council` verbatim, propagate loa's exit, fail clearly when `loa` is absent.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASS=0; FAIL=0
ck(){ if [ "$1" = "$2" ]; then PASS=$((PASS+1)); echo "  ✓ $3"; else FAIL=$((FAIL+1)); echo "  ✗ FAIL $3 (got '$1' want '$2')"; fi }

echo "council-signoff.test — shim → 'loa council' (logic lives in loa-cli/signoff_gate.mjs)"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
REC="$TMP/rec"
cat > "$TMP/loa" <<EOF
#!/usr/bin/env bash
# the shim probes verb-recognition by CONTENT: emit the usage line on 'council --help'
if [ "\$1" = "council" ] && [ "\$2" = "--help" ]; then echo "loa council <pr> [--repo owner/name]"; exit 0; fi
printf '%s\n' "\$*" > "$REC"
exit 42
EOF
chmod +x "$TMP/loa"

# 42 = an arbitrary, unambiguous sentinel (NOT the real fail-closed 3) — proves verbatim propagation
ec=0; PATH="$TMP:$PATH" bash "$HERE/council-signoff.sh" 7 --repo o/r --comment-only >/dev/null 2>&1 || ec=$?
ck "$ec" 42 "propagates loa's exit code verbatim (arbitrary sentinel 42, distinct from real codes)"
ck "$(cat "$REC" 2>/dev/null)" "council 7 --repo o/r --comment-only" "forwards 'council 7 --repo o/r --comment-only' verbatim"

ec2=0; PATH="/usr/bin:/bin" bash "$HERE/council-signoff.sh" 7 >/dev/null 2>&1 || ec2=$?
ck "$ec2" 2 "no loa on PATH → exit 2 with a clear install message"

echo ""
[ "$FAIL" -eq 0 ] && { echo "council-signoff.test: PASS ($PASS)"; exit 0; } || { echo "council-signoff.test: FAIL ($FAIL)"; exit 1; }
