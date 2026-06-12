#!/usr/bin/env bats
# Asson cycle-5 acceptance: the comms gate — THREE INDEPENDENT LINTERS (AS-9/B5).
# Hermetic: both external linter slots are stubbed (ASSON_AISTENCH/ASSON_VOCABBANK)
# so the COMPOSITION mechanism is tested CI-portably. The real ai-stench integration
# was verified manually. asson owns only the legal register (lexicon-lint, in-package).

ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PKG="$ROOT/packages/asson"
GATE="$PKG/scripts/comms-gate.mjs"
FIX="$ROOT/tests/asson/fixtures/comms"
LEXLINT="$PKG/examples/lexicon-lint/bin/lexicon-lint.mjs"

# all three slots present (legal in-package + stubbed voice + stubbed vocab)
gate() { ASSON_AISTENCH="$FIX/stub-voice-lint.mjs" ASSON_VOCABBANK="$FIX/stub-vocab-lint.mjs" node "$GATE" "$1" 2>&1; }

@test "(a) competitive comms trips ALL THREE linters → BLOCKED, exit 1" {
  run gate "$FIX/competitive.txt"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "legal-register (asson): FLAGGED"
  echo "$output" | grep -q "voice (ai-stench): FLAGGED"
  echo "$output" | grep -q "product-vocab (vocabulary-bank): FLAGGED"
  echo "$output" | grep -q "3 linter(s) ran → BLOCKED"
}

# independence: each linter fires on its OWN input class, the others stay clean
@test "(b) INDEPENDENCE: legal-only → only legal flags (voice + vocab clean)" {
  run gate "$FIX/legal-only.txt"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "legal-register (asson): FLAGGED"
  echo "$output" | grep -q "voice (ai-stench): clean"
  echo "$output" | grep -q "product-vocab (vocabulary-bank): clean"
}
@test "(b) INDEPENDENCE: voice-only → only voice flags" {
  run gate "$FIX/voice-only.txt"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "legal-register (asson): clean"
  echo "$output" | grep -q "voice (ai-stench): FLAGGED"
}
@test "(b) INDEPENDENCE: vocab-only → only vocab flags" {
  run gate "$FIX/vocab-only.txt"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "legal-register (asson): clean"
  echo "$output" | grep -q "product-vocab (vocabulary-bank): FLAGGED"
}

@test "(c) clean comms → all linters pass, exit 0" {
  run gate "$FIX/clean.txt"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "3 linter(s) ran → clean"
}

# (d) asson's OWN linter (legal register) standalone — the one asson owns
@test "(d) legal-register linter: offchain → exit 3, clean → exit 0" {
  run bash -c "echo '{\"text\":\"the offchain transfer\",\"rel\":\"competitive\"}' | node '$LEXLINT'"
  [ "$status" -eq 3 ]
  run bash -c "echo '{\"text\":\"the ledger entry\",\"rel\":\"competitive\"}' | node '$LEXLINT'"
  [ "$status" -eq 0 ]
}

# (e) a missing linter is SKIPPED (reported), never a silent pass
@test "(e) absent linter → skipped (not a pass): no vocab stub → only 2 run" {
  run bash -c "ASSON_AISTENCH='$FIX/stub-voice-lint.mjs' node '$GATE' '$FIX/clean.txt' 2>&1"
  [ "$status" -eq 0 ]
  echo "$output" | grep -q "product-vocab (vocabulary-bank): unavailable (skipped, not a pass)"
  echo "$output" | grep -q "2 linter(s) ran"
}

# scope guard: the gate is a SCRIPT, NOT a .claude/ hook (System Zone respected — the
# hook registration is an operator-gated handoff, like the cycle-4 watchdog).
@test "scope guard (f): comms-gate is a package script, NOT wired into System Zone (.claude/)" {
  [ -f "$PKG/scripts/comms-gate.mjs" ]
  run bash -c "grep -rl 'comms-gate' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}
