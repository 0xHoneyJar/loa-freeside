#!/usr/bin/env bash
# =============================================================================
# tools/council-signoff.test.sh — fixture-driven tests for council-signoff.sh
# =============================================================================
# No live cheval, no live gh. Seams:
#   LOA_COUNCIL_BIN → a fake council emitting a canned verdict JSON + chosen exit
#   LOA_GH_BIN      → a fake gh that LOGS the `pr review` call (and succeeds)
# Proves: APPROVED+≥2 → approving review · CHANGES_REQUIRED → request-changes ·
#   all-dropped (exit 3) → fail-closed, NO review · APPROVED-but-1-voice →
#   fail-closed, NO review · --dry-run → no review · --comment-only → comment.
# Exit: 0 all pass · 1 a test failed.
# =============================================================================
# shellcheck disable=SC2015  # `cond && ok || bad` is the assertion idiom here; ok/bad always return 0
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
SUT="$HERE/council-signoff.sh"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
FAKE_GH_LOG="$WORK/gh.log"

# --- fake gh: logs argv, answers read calls, succeeds on `pr review` ----------
FAKE_GH="$WORK/fake-gh.sh"
cat >"$FAKE_GH" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_GH_LOG"
case "$1 $2" in
  "repo view") echo "owner/fake-repo" ;;
  *)           : ;;
esac
exit 0
EOF
chmod +x "$FAKE_GH"

# --- fake council: emits $FAKE_COUNCIL_JSON, exits $FAKE_COUNCIL_EC -----------
FAKE_COUNCIL="$WORK/fake-council.sh"
cat >"$FAKE_COUNCIL" <<'EOF'
#!/usr/bin/env bash
cat "$FAKE_COUNCIL_JSON"
exit "${FAKE_COUNCIL_EC:-0}"
EOF
chmod +x "$FAKE_COUNCIL"

# --- canned verdict envelopes (mirror cheval-council.sh's contract) ----------
J_APPROVED="$WORK/approved.json"
cat >"$J_APPROVED" <<'EOF'
{"verdict":"APPROVED","summary":"cheval-routed · 2/3 voices survived · multi_perspective=true · verdict APPROVED","panel":{"routed_via":"cheval","voices":[{"voice":"jam-reviewer-claude-headless","model_ran":"claude-headless","verdict":"APPROVED","finding_count":0,"findings":[]},{"voice":"jam-reviewer-gpt","model_ran":"codex","verdict":"APPROVED","finding_count":0,"findings":[]}],"dropped":[{"voice":"jam-reviewer-cursor","reason":"exit:2/empty"}],"voices_survived":2,"voices_planned":3,"multi_perspective_met":true}}
EOF

J_CHANGES="$WORK/changes.json"
cat >"$J_CHANGES" <<'EOF'
{"verdict":"CHANGES_REQUIRED","summary":"cheval-routed · 2/3 survived · verdict CHANGES_REQUIRED","panel":{"voices":[{"voice":"jam-reviewer-gpt","model_ran":"codex","verdict":"CHANGES_REQUIRED","finding_count":1,"findings":[{"severity":"major","title":"null deref"}]},{"voice":"jam-reviewer-claude-headless","model_ran":"claude-headless","verdict":"APPROVED","finding_count":0}],"voices_survived":2,"voices_planned":3,"multi_perspective_met":true}}
EOF

J_DROPPED="$WORK/dropped.json"
cat >"$J_DROPPED" <<'EOF'
{"verdict":"CHANGES_REQUIRED","error":"all_voices_dropped","panel":{"voices":[],"dropped":[{"voice":"a","reason":"exit:2/empty"}]}}
EOF

J_SINGLE="$WORK/single.json"
cat >"$J_SINGLE" <<'EOF'
{"verdict":"APPROVED","summary":"single-voice panel","panel":{"voices":[{"voice":"jam-reviewer-gpt","model_ran":"codex","verdict":"APPROVED","finding_count":0}],"voices_survived":1,"voices_planned":3,"multi_perspective_met":false}}
EOF

PASS=0; FAIL=0
ok()  { printf '  ok   — %s\n' "$1"; PASS=$((PASS+1)); }
bad() { printf '  FAIL — %s\n' "$1"; FAIL=$((FAIL+1)); }

run_sut() {  # $1=json file, $2=council exit code, rest=SUT args
  local jf="$1" cec="$2"; shift 2
  FAKE_GH_LOG="$FAKE_GH_LOG" \
  LOA_GH_BIN="$FAKE_GH" \
  LOA_COUNCIL_BIN="$FAKE_COUNCIL" \
  FAKE_COUNCIL_JSON="$jf" \
  FAKE_COUNCIL_EC="$cec" \
  bash "$SUT" 42 --repo "0xHoneyJar/loa-freeside" "$@"
}

echo "== council-signoff.test =="

# 1. APPROVED + 2 voices survived → approving review, exit 0 -------------------
: >"$FAKE_GH_LOG"
ec=0; run_sut "$J_APPROVED" 0 >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 0 ]] && ok "APPROVED exits 0" || bad "APPROVED expected exit 0, got $ec"
if grep -q "pr review 42" "$FAKE_GH_LOG" && grep -q -- "--approve" "$FAKE_GH_LOG"; then ok "APPROVED posted an approving review"; else bad "APPROVED did not post --approve (log: $(tr '\n' '|' <"$FAKE_GH_LOG"))"; fi

# 2. CHANGES_REQUIRED → request-changes, exit 1 -------------------------------
: >"$FAKE_GH_LOG"
ec=0; run_sut "$J_CHANGES" 1 >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 1 ]] && ok "CHANGES_REQUIRED exits 1" || bad "CHANGES expected exit 1, got $ec"
if grep -q -- "--request-changes" "$FAKE_GH_LOG" && ! grep -q -- "--approve" "$FAKE_GH_LOG"; then ok "CHANGES posted --request-changes, not --approve"; else bad "CHANGES posted wrong review event"; fi

# 3. all voices dropped (council exit 3) → FAIL-CLOSED, no review, exit 3 ------
: >"$FAKE_GH_LOG"
ec=0; run_sut "$J_DROPPED" 3 >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 3 ]] && ok "all-dropped exits 3 (fail-closed)" || bad "all-dropped expected exit 3, got $ec"
if grep -q "pr review" "$FAKE_GH_LOG"; then bad "all-dropped MUST NOT post a review"; else ok "all-dropped posted no review"; fi

# 4. APPROVED but only 1 voice survived → FAIL-CLOSED, no review, exit 3 -------
: >"$FAKE_GH_LOG"
ec=0; run_sut "$J_SINGLE" 0 >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 3 ]] && ok "single-voice APPROVED fails closed (exit 3)" || bad "single-voice expected exit 3, got $ec"
if grep -q "pr review" "$FAKE_GH_LOG"; then bad "single-voice MUST NOT approve a halved panel"; else ok "single-voice posted no review"; fi

# 5. --dry-run on APPROVED → no review POST, exit 0 ---------------------------
: >"$FAKE_GH_LOG"
ec=0; run_sut "$J_APPROVED" 0 --dry-run >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 0 ]] && ok "dry-run APPROVED exits 0" || bad "dry-run APPROVED expected exit 0, got $ec"
if grep -q "pr review" "$FAKE_GH_LOG"; then bad "dry-run MUST NOT post a review"; else ok "dry-run posted no review"; fi

# 6. --comment-only on APPROVED → posts a COMMENT review (not approve) --------
: >"$FAKE_GH_LOG"
ec=0; run_sut "$J_APPROVED" 0 --comment-only >/dev/null 2>&1 || ec=$?
[[ "$ec" -eq 0 ]] && ok "comment-only APPROVED exits 0" || bad "comment-only expected exit 0, got $ec"
if grep -q -- "--comment" "$FAKE_GH_LOG" && ! grep -q -- "--approve" "$FAKE_GH_LOG"; then ok "comment-only posted --comment (not --approve)"; else bad "comment-only posted wrong event"; fi

echo "== council-signoff: $PASS passed, $FAIL failed =="
[[ "$FAIL" -eq 0 ]]
