#!/usr/bin/env bash
# =============================================================================
# tools/loa-signoff.test.sh — fixture-driven tests for loa-signoff.sh
# =============================================================================
# No live `gh`, no live suite. Seams:
#   LOA_GH_BIN          → a fake gh that LOGS every call and returns canned data
#   LOA_SIGNOFF_SUITE_CMD/DIR → an injected fake suite (exit 0 = green, non-0 = red)
# Proves the floor: RED suite → no signoff + non-zero · GREEN → signoff posted ·
#   --dry-run on GREEN → mutates nothing · bad usage → exit 2.
# Exit: 0 all pass · 1 a test failed.
# =============================================================================
# shellcheck disable=SC2015  # `cond && ok || bad` is the assertion idiom here; ok/bad always return 0
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SUT="$HERE/loa-signoff.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
FAKE_GH_LOG="$WORK/gh.log"

# --- fake gh: logs argv, answers the read calls, succeeds on the POST ---------
FAKE_GH="$WORK/fake-gh.sh"
cat >"$FAKE_GH" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_GH_LOG"
case "$1 $2" in
  "api user")   echo "test-operator" ;;
  "repo view")  echo "owner/fake-repo" ;;
  "pr view")    echo "fakesha0000000000000000000000000000000000" ;;
  *)            : ;;   # api statuses POST, etc. → succeed silently
esac
exit 0
EOF
chmod +x "$FAKE_GH"

PASS=0; FAIL=0
ok()   { printf '  ok   — %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  FAIL — %s\n' "$1"; FAIL=$((FAIL+1)); }

run_sut() {  # run the SUT with the fakes wired; capture exit code
  FAKE_GH_LOG="$FAKE_GH_LOG" \
  LOA_GH_BIN="$FAKE_GH" \
  LOA_SIGNOFF_REPO="0xHoneyJar/loa-freeside" \
  LOA_SIGNOFF_SUITE_DIR="$WORK" \
  bash "$SUT" "$@"
}

SHA="abc123def456abc123def456abc123def456abcd"

echo "== loa-signoff.test =="

# 1. RED suite → refuse, exit 1, post NOTHING ---------------------------------
: >"$FAKE_GH_LOG"
ec=0; LOA_SIGNOFF_SUITE_CMD="exit 7" run_sut --sha "$SHA" >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 1 ]] && ok "red suite exits 1" || bad "red suite expected exit 1, got $ec"
if grep -q "statuses/" "$FAKE_GH_LOG"; then bad "red suite MUST NOT post a status"; else ok "red suite posted no status"; fi

# 2. GREEN suite → sign off (status POST), exit 0 -----------------------------
: >"$FAKE_GH_LOG"
ec=0; LOA_SIGNOFF_SUITE_CMD="exit 0" run_sut --sha "$SHA" >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 0 ]] && ok "green suite exits 0" || bad "green suite expected exit 0, got $ec"
if grep -q "statuses/$SHA" "$FAKE_GH_LOG" && grep -q "state=success" "$FAKE_GH_LOG" && grep -q "context=loa-signoff" "$FAKE_GH_LOG"; then
  ok "green suite posted loa-signoff=success to head SHA"
else
  bad "green suite did not post the expected status (log: $(tr '\n' '|' <"$FAKE_GH_LOG"))"
fi

# 3. --dry-run on GREEN → no POST, exit 0 -------------------------------------
: >"$FAKE_GH_LOG"
ec=0; LOA_SIGNOFF_SUITE_CMD="exit 0" run_sut --sha "$SHA" --dry-run >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 0 ]] && ok "dry-run green exits 0" || bad "dry-run green expected exit 0, got $ec"
if grep -q "statuses/" "$FAKE_GH_LOG"; then bad "dry-run MUST NOT post a status"; else ok "dry-run posted no status"; fi

# 4. bad usage (no pr / no sha) → exit 2 --------------------------------------
ec=0; run_sut >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 2 ]] && ok "no args exits 2" || bad "no args expected exit 2, got $ec"

echo "== loa-signoff: $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]]
