#!/usr/bin/env bash
# =============================================================================
# tools/check-instrument-ground-truth.test.sh
#
# Fixture test for the M0 / G-IMMUNE enforcing lint (check-instrument-ground-truth.sh).
# Campaign: Estate Immune System · bead arrakis-estate-immune-epic-4xw6.1.
#
# THE M0 ACCEPTANCE CRITERION (campaign-immune-estate.md): "a planted
# self-reporting instrument fails the lint." Case 1 below is exactly that proof —
# an instrument that emits a verdict but reads no ground source and is not in the
# registry MUST fail the lint with exit 1.
#
# Each case builds an isolated temp repo-root so the cases never interfere and
# the lint never touches the real tools/. Run:
#   bash tools/check-instrument-ground-truth.test.sh   (exit 0 = pass, 1 = fail)
# =============================================================================
set -uo pipefail

LINT="$(cd "$(dirname "$0")" && pwd)/check-instrument-ground-truth.sh"
fail=0
LINT_OUT="$(mktemp)"   # per-run, not a shared /tmp path — safe under parallel runs

# mk_root: print a fresh temp repo-root with an empty tools/ dir.
mk_root() {
    local t; t="$(mktemp -d)"
    mkdir -p "$t/tools"
    printf '%s' "$t"
}

# run_lint <repo-root> -> echoes the lint's exit code (scanning <root>/tools).
run_lint() {
    bash "$LINT" --quiet --repo-root "$1" --root "$1/tools" --registry "$1/registry.yaml" \
        >"$LINT_OUT" 2>&1
    echo $?
}

check() { # name expected-exit actual-exit
    if [[ "$2" == "$3" ]]; then
        echo "  ✓ $1 (exit $3)"
    else
        echo "  ✗ $1 — expected exit $2, got $3"; sed 's/^/      /' "$LINT_OUT"; fail=1
    fi
}

# ── Case 1 — THE ACCEPTANCE CRITERION: a planted self-reporting instrument ────
# liar-sensor.mjs emits a verdict, reads NO ground source, and is UNREGISTERED.
# The lint MUST catch it (exit 1). This is the regression the campaign exists to
# prevent recurring.
T1="$(mk_root)"
cat > "$T1/tools/liar-sensor.mjs" <<'EOF'
#!/usr/bin/env node
// A LYING INSTRUMENT: declares a verdict from nothing — reads no ground source.
console.log('VERDICT: HEALTHY');
process.exit(0);
EOF
printf '# empty registry — the liar is not registered\n' > "$T1/registry.yaml"
check "planted self-reporting instrument (unregistered) FAILS the lint" 1 "$(run_lint "$T1")"

# ── Case 2 — a registered + grounded instrument passes clean ─────────────────
T2="$(mk_root)"
cat > "$T2/tools/good-sensor.mjs" <<'EOF'
#!/usr/bin/env node
// Re-derives its verdict from the audit log (the ground source).
import { readFileSync } from 'node:fs';
const records = readFileSync('.run/model-invoke.jsonl', 'utf8');
console.log(records.length ? 'TRUTHFUL' : 'INSUFFICIENT');
EOF
cat > "$T2/registry.yaml" <<'EOF'
tools/good-sensor.mjs:
  - ".run/model-invoke.jsonl"
EOF
check "registered + grounded instrument PASSES" 0 "$(run_lint "$T2")"

# ── Case 3 — the suppression marker exempts a glob-matched non-instrument ─────
T3="$(mk_root)"
cat > "$T3/tools/not-really-a-sensor.mjs" <<'EOF'
#!/usr/bin/env node
// immune-lint:allow demo helper that matches *-sensor.* but is not an instrument
console.log('hello');
EOF
printf '# empty registry\n' > "$T3/registry.yaml"
check "suppression marker (# immune-lint:allow) exempts the file" 0 "$(run_lint "$T3")"

# ── Case 4 — a registered instrument whose declared token is ABSENT fails ────
# (the ground-source binding: the declared read was removed/refactored away).
T4="$(mk_root)"
cat > "$T4/tools/drifted-sensor.mjs" <<'EOF'
#!/usr/bin/env node
// The declared ground-source read has been removed — only a self-report remains.
console.log('VERDICT: HEALTHY');
EOF
cat > "$T4/registry.yaml" <<'EOF'
tools/drifted-sensor.mjs:
  - ".run/model-invoke.jsonl"
EOF
check "registered instrument with ABSENT declared token FAILS" 1 "$(run_lint "$T4")"

# ── Case 5 — the opt-in header pulls a non-glob-named file into the lint ──────
# A file whose NAME doesn't match the globs but carries `# immune-instrument`
# opts in; if unregistered it must fail (proves the header is honored).
T5="$(mk_root)"
cat > "$T5/tools/healthboard.mjs" <<'EOF'
#!/usr/bin/env node
// immune-instrument
console.log('VERDICT: HEALTHY');
EOF
printf '# empty registry\n' > "$T5/registry.yaml"
check "opt-in '# immune-instrument' header pulls a non-glob file in (unregistered FAILS)" 1 "$(run_lint "$T5")"

# ── Case 6 — a test file matching the glob is NOT treated as a candidate ──────
# *.test.* files verify instruments; they must not themselves require registration.
T6="$(mk_root)"
cat > "$T6/tools/whatever-sensor.test.mjs" <<'EOF'
#!/usr/bin/env node
// a test for some sensor — not an instrument itself
console.log('PASS');
EOF
printf '# empty registry\n' > "$T6/registry.yaml"
check "a *-sensor.test.mjs file is excluded (not a candidate)" 0 "$(run_lint "$T6")"

# ── Case 7 — the suppression marker in a STRING LITERAL must NOT suppress ─────
# (line-anchoring: a smuggled marker that is not a real comment cannot evade
# the registration teeth.)
T7="$(mk_root)"
cat > "$T7/tools/sneaky-sensor.mjs" <<'EOF'
#!/usr/bin/env node
console.log('# immune-lint:allow look ma, evading registration');
EOF
printf '# empty registry\n' > "$T7/registry.yaml"
check "marker inside a string literal does NOT suppress (still FAILS)" 1 "$(run_lint "$T7")"

# ── Case 8 — the opt-in marker in a STRING LITERAL must NOT opt a file in ─────
T8="$(mk_root)"
cat > "$T8/tools/plainfile.mjs" <<'EOF'
#!/usr/bin/env node
const label = "// immune-instrument";   // a string, not a header
console.log(label);
EOF
printf '# empty registry\n' > "$T8/registry.yaml"
check "opt-in marker inside a string literal does NOT opt the file in (PASSES)" 0 "$(run_lint "$T8")"

# ── Case 9 — a *-sensor.spec.mjs file is excluded (spec tests, like .test.) ───
T9="$(mk_root)"
cat > "$T9/tools/widget-sensor.spec.mjs" <<'EOF'
#!/usr/bin/env node
// a spec for the widget sensor — not an instrument itself
console.log('PASS');
EOF
printf '# empty registry\n' > "$T9/registry.yaml"
check "a *-sensor.spec.mjs file is excluded (not a candidate)" 0 "$(run_lint "$T9")"

# ── Case 10 — a *.test.* file is excluded EVEN WITH the opt-in marker in its head ─
# Regression proof for the tri-state classification: the *.test.*/*.spec. exclusion is
# a property of the FILE, evaluated BEFORE the opt-in-header check — so a test file that
# happens to carry `# immune-instrument` near the top (e.g. it documents/exercises the
# marker) is STILL not an instrument candidate. (Pre-fix, the header path ran over test
# files and would have falsely registered this one.)
T10="$(mk_root)"
cat > "$T10/tools/marker-bearing-sensor.test.mjs" <<'EOF'
#!/usr/bin/env node
// immune-instrument
// ^ this TEST exercises the opt-in marker; the file is a test, not an instrument.
console.log('PASS');
EOF
printf '# empty registry\n' > "$T10/registry.yaml"
check "a *.test.* file with the opt-in marker in its head is STILL excluded" 0 "$(run_lint "$T10")"

# ── Case 11 — a --root OUTSIDE --repo-root is refused at startup (exit 2) ──────
# The registry keys are repo-root-relative; a scan root that doesn't resolve under
# --repo-root could only ever yield absolute keys that never match — so the lint
# refuses it loudly (arg/IO error, exit 2) instead of emitting a confusing spurious
# UNREGISTERED with an absolute path.
T11="$(mk_root)"
OUTSIDE="$(mktemp -d)"; mkdir -p "$OUTSIDE/tools"   # a directory NOT under T11
printf '# empty registry\n' > "$T11/registry.yaml"
rc11="$(bash "$LINT" --quiet --repo-root "$T11" --root "$OUTSIDE/tools" --registry "$T11/registry.yaml" >"$LINT_OUT" 2>&1; echo $?)"
check "a --root outside --repo-root is refused (exit 2)" 2 "$rc11"
rm -rf "$OUTSIDE" 2>/dev/null || true

# ── Case 12 — a registered-but-DELETED instrument yields MISSING_FILE (exit 1) ─
# Pass B binding: the registry names a file no longer on disk. tools/ is empty, so
# exit 1 here can ONLY be the MISSING_FILE violation — assert the code too (non-quiet),
# so a future refactor can't silently turn it into a different failure.
T12="$(mk_root)"
cat > "$T12/registry.yaml" <<'EOF'
tools/ghost-sensor.mjs:
  - ".run/model-invoke.jsonl"
EOF
mf_rc="$(bash "$LINT" --repo-root "$T12" --root "$T12/tools" --registry "$T12/registry.yaml" >"$LINT_OUT" 2>&1; echo $?)"
check "a registered-but-deleted instrument FAILS (exit 1)" 1 "$mf_rc"
if grep -q "MISSING_FILE" "$LINT_OUT"; then
    echo "  ✓ the violation is specifically MISSING_FILE"
else
    echo "  ✗ expected a MISSING_FILE violation"; sed 's/^/      /' "$LINT_OUT"; fail=1
fi

# cleanup
rm -rf "$T1" "$T2" "$T3" "$T4" "$T5" "$T6" "$T7" "$T8" "$T9" "$T10" "$T11" "$T12" 2>/dev/null || true

echo ""
if [[ "$fail" -eq 0 ]]; then echo "PASS: all check-instrument-ground-truth.sh assertions green"; else echo "FAIL: check-instrument-ground-truth.sh"; fi
exit "$fail"
