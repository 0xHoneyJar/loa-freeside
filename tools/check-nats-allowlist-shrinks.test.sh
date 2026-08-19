#!/usr/bin/env bash
# =============================================================================
# tools/check-nats-allowlist-shrinks.test.sh
#
# BB F1 remediation: prove the shrink-gate goes RED on a known violation, not
# green-by-default. ("Green has two causes — nothing wrong and never ran; only
# the red path distinguishes them.") Builds a throwaway git repo so the real
# origin/<base> resolution path is exercised end-to-end.
# =============================================================================
set -uo pipefail

GATE="$(cd "$(dirname "$0")" && pwd)/check-nats-allowlist-shrinks.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP" || exit 2

git init -q
git config user.email t@example.com
git config user.name tester
git checkout -q -b main

AL="packages/events/raw-nats-allowlist.yaml"
mkdir -p packages/events
printf 'version: 1\nentries:\n  - id: "a::x"\n  - id: "b::y"\nemitRaw_allowlist: []\n' > "$AL"
git add -A && git commit -qm base
# Simulate the remote-tracking ref the gate resolves first (origin/<base>).
git update-ref refs/remotes/origin/main HEAD

fail=0
run() { ALLOWLIST="$AL" BASE=main bash "$GATE" --enforce >/tmp/nats-gate-smoke.out 2>&1; echo $?; }
check() { # name expected-rc actual-rc
  if [ "$2" = "$3" ]; then
    echo "PASS: $1 (exit $3)"
  else
    echo "FAIL: $1 — expected exit $2, got $3"; sed 's/^/    /' /tmp/nats-gate-smoke.out; fail=1
  fi
}
check_msg() { # name substring  (asserts last run's output contains it)
  if grep -qF "$2" /tmp/nats-gate-smoke.out; then
    echo "PASS: $1 (output contains '$2')"
  else
    echo "FAIL: $1 — expected output to contain '$2'"; sed 's/^/    /' /tmp/nats-gate-smoke.out; fail=1
  fi
}

# 1) Count-preserving SWAP (remove b::y, add c::z) — the IMP-003 bypass — MUST fail.
printf 'version: 1\nentries:\n  - id: "a::x"\n  - id: "c::z"\nemitRaw_allowlist: []\n' > "$AL"
check "count-preserving swap goes RED" 1 "$(run)"

# 2) Pure ADDITION (append d::w) — MUST fail.
printf 'version: 1\nentries:\n  - id: "a::x"\n  - id: "b::y"\n  - id: "d::w"\nemitRaw_allowlist: []\n' > "$AL"
check "addition goes RED" 1 "$(run)"

# 3) SHRINK (remove b::y) — MUST pass.
printf 'version: 1\nentries:\n  - id: "a::x"\nemitRaw_allowlist: []\n' > "$AL"
check "shrink stays GREEN" 0 "$(run)"

# 4) UNCHANGED — MUST pass.
git show HEAD:"$AL" > "$AL"
check "unchanged stays GREEN" 0 "$(run)"

# 5) entries->emitRaw_allowlist MOVE (same id) — MUST pass (no fork churn).
printf 'version: 1\nentries:\n  - id: "a::x"\nemitRaw_allowlist:\n  - id: "b::y"\n' > "$AL"
check "entries->emitRaw move stays GREEN" 0 "$(run)"

# 6) publishEnvelope_allowlist ADDITION — MUST fail, caught by the GENERIC union
#    path (events #255). extract_ids is section-blind: it unions the PE section's
#    `- id:` lines too, so the addition trips the generic "GAINED id(s)" check.
#    There is NO PE-specific gate block anymore (it was dead code — FAGAN F4).
#    Asserting the message (not just exit 1) makes this a real regression test of
#    the union covering the PE section — it goes RED if that coverage breaks,
#    instead of passing whether or not the enforcing code exists.
git show HEAD:"$AL" > "$AL"  # reset to base
printf 'version: 1\nentries:\n  - id: "a::x"\n  - id: "b::y"\nemitRaw_allowlist: []\npublishEnvelope_allowlist:\n  - id: "src/foo.ts::publishEnvelope"\n' > "$AL"
rc6="$(run)"
check "publishEnvelope_allowlist addition goes RED" 1 "$rc6"
check_msg "publishEnvelope addition is caught by the generic union path" "GAINED id(s)"
check_msg "the offending PE id is named in the diff" "src/foo.ts::publishEnvelope"

# 7) Empty publishEnvelope_allowlist — MUST pass.
printf 'version: 1\nentries:\n  - id: "a::x"\n  - id: "b::y"\nemitRaw_allowlist: []\npublishEnvelope_allowlist: []\n' > "$AL"
check "empty publishEnvelope_allowlist stays GREEN" 0 "$(run)"

# 8) Base branch lacks publishEnvelope_allowlist section entirely — MUST pass (// [] fallback).
# The base commit (HEAD) has no publishEnvelope_allowlist; head adds it empty.
git show HEAD:"$AL" > "$AL"  # reset to base (has no publishEnvelope_allowlist)
# Temporarily add the section empty to the working copy (simulates the new section landing):
printf 'version: 1\nentries:\n  - id: "a::x"\n  - id: "b::y"\nemitRaw_allowlist: []\npublishEnvelope_allowlist: []\n' > "$AL"
check "base-lacks-section with empty head stays GREEN" 0 "$(run)"

if [ "$fail" = "0" ]; then
  echo "ALL SHRINK-GATE SMOKE TESTS PASS"
  exit 0
fi
echo "SHRINK-GATE SMOKE TESTS FAILED"
exit 1
