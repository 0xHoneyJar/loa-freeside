#!/usr/bin/env bats
# Asson cycle-2 acceptance fixtures (sprint Task 2.5).

ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PKG="$ROOT/packages/asson"

# (a) the asson verb EXISTS + freeside-cli tsc --noEmit clean
@test "(a) asson verb exists and freeside-cli typechecks cleanly" {
  [ -f "$ROOT/packages/freeside-cli/src/verbs/asson.ts" ]
  run bash -c "cd $ROOT/packages/freeside-cli && npx tsc --noEmit"
  [ "$status" -eq 0 ]
}

# (b) asson doctor against the wordcount example exits 0/3 with earned: L3
@test "(b) asson doctor: a re-attested wordcount earns L3 (attested-dev) via --public-key" {
  TMP="$(mktemp -d)"
  CLI_DIR="$TMP/wc"; mkdir -p "$CLI_DIR"
  cp -r "$ROOT/packages/asson/examples/wordcount/"* "$CLI_DIR"

  # The checked-in dev_signature's ephemeral key is gone, so re-attest in-process and
  # export the public key to a PEM the doctor reads. The PEM lives OUTSIDE the CLI dir —
  # treeHash covers every non-veve.json file, so a key file inside would change the tree
  # between attest and verify and break the attestation.
  node --input-type=module -e "
    import { createSigner, attestBuild } from 'file://$PKG/src/asson.mjs';
    import { readFileSync, writeFileSync } from 'node:fs';
    const s = createSigner();
    const v = JSON.parse(readFileSync('$CLI_DIR/veve.json'));
    writeFileSync('$CLI_DIR/veve.json', JSON.stringify(attestBuild(v, '$CLI_DIR', s)));
    writeFileSync('$TMP/pub.pem', s.publicKey.export({ type: 'spki', format: 'pem' }));
  "
  run bash -c "cd $ROOT/packages/freeside-cli && npx tsx bin/freeside-cli.ts asson doctor '$CLI_DIR' --public-key '$TMP/pub.pem' 2>/dev/null"
  echo "$output" | grep -q "Earned: L3 (attested-dev)"
  [ "$status" -eq 3 ]
}

# (b2) the rest of the verb set: policy emits CommandPolicy, attest is mutation-guarded, harvest honors B7
@test "(b2) asson policy emits a parseable CommandPolicy with the finn fields" {
  run bash -c "cd $ROOT/packages/freeside-cli && npx tsx bin/freeside-cli.ts asson policy $ROOT/packages/asson/examples/wordcount 2>/dev/null"
  [ "$status" -eq 0 ]
  echo "$output" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert all(k in d for k in ("binary","subcommands","validatePaths","x_determinism"))'
}

@test "CL-5 (b3) attest without --write leaves veve.json byte-identical" {
  before="$(shasum "$PKG/examples/wordcount/veve.json" | cut -d' ' -f1)"
  run bash -c "cd $ROOT/packages/freeside-cli && npx tsx bin/freeside-cli.ts asson attest $ROOT/packages/asson/examples/wordcount 2>/dev/null"
  [ "$status" -eq 0 ]
  after="$(shasum "$PKG/examples/wordcount/veve.json" | cut -d' ' -f1)"
  [ "$before" = "$after" ]
}

@test "B7 asson harvest refuses a non-deterministic CLI (two runs differ → exit 1)" {
  run bash -c "cd $ROOT/packages/freeside-cli && npx tsx bin/freeside-cli.ts asson harvest $ROOT/tests/asson/fixtures/nondeterministic --name r -- 2>&1"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "non-deterministic"
}

# (c) drift-sensor exit-code matrix (D-7 / CL-6) — hermetic cases.
# The match→0 path requires the live legba repo AT the pinned SHA (you cannot point a
# temp repo's HEAD at a non-existent object), so it is verified live, not in CI. The
# three hermetic cases + the internal-consistency gate are what guard the sensor here.
@test "(c) drift sensor: no-path → 3, nonexistent → 3, drift → 1, internal-consistency holds" {
  SENSOR="node $PKG/scripts/check-legba-drift.mjs"

  # 1. No path → 3 (warn — never 0-when-uncheckable). Reaching this branch also proves
  #    the internal-consistency check (canon pin == golden SHA) passed.
  run $SENSOR
  [ "$status" -eq 3 ]

  # 2. Nonexistent path → 3
  run $SENSOR "/tmp/definitely-does-not-exist-12345"
  [ "$status" -eq 3 ]

  # 3. A real repo whose HEAD != the pin → 1 (drift)
  LEGBA_DIR="$(mktemp -d)"
  ( cd "$LEGBA_DIR" && git init -q && git config user.email t@t && git config user.name t && git commit -q --allow-empty -m seed )
  run $SENSOR "$LEGBA_DIR"
  rm -rf "$LEGBA_DIR"
  [ "$status" -eq 1 ]
}

@test "(c2) drift sensor internal-consistency: canon pin == conformance golden SHA" {
  pin="$(grep -oE '[0-9a-f]{40}' "$PKG/src/vendor/canon.mjs" | head -1)"
  golden="$(python3 -c "import json,re; s=json.load(open('$PKG/test/fixtures/canon-golden.json'))['generated_from']; print(re.search(r'[0-9a-f]{40}', s).group())")"
  [ -n "$pin" ]
  [ "$pin" = "$golden" ]
}

# (d) SCOPE GUARD — concrete denylist (B4): NO cycle-3-5 artifacts exist
@test "scope guard (d): cycle-3 fence advanced — the key ceremony now exists (was: absent)" {
  # RETIRED: cycle-3 legitimately created scripts/ci-key-ceremony.mjs; the fence moved
  # forward to tests/asson/cycle3-fixtures.bats (which denylists cycles 4-5).
  [ -f "$PKG/scripts/ci-key-ceremony.mjs" ]
}
@test "scope guard (d): no cycle-4 watchdog wired into a live settings.json" {
  run bash -c "grep -rl 'livenessVerdict' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}
@test "scope guard (d): no cycle-5 lexicon-lint comms-gate hook registration" {
  run bash -c "grep -rl 'lexicon-lint' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}
@test "scope guard (d): cycle-3 fence advanced — keyring binding now BUILT (closes the audit MEDIUM)" {
  # RETIRED: cycle-3 built the binding (resolveSigner + doctor keyring param). The
  # cycle-1/2 audit MEDIUM is closed; the binding's correctness is gated by
  # packages/asson/test/keyring-binding.test.mjs + cycle3-fixtures.bats.
  run bash -c "grep -c 'resolveSigner' '$PKG/src/asson.mjs'"
  [ "$output" -ge 1 ]
}

# C-1: malformed input → clean Error + exit 1 (no raw node stack trace leaking paths)
@test "C-1 graceful errors: malformed veve.json → clean Error, exit 1 (no stack trace)" {
  tmp="$(mktemp -d)"; printf '%s' '{ not valid json' > "$tmp/veve.json"
  # no pipe on the status'd command — a trailing | grep would mask the doctor exit (gate-output-never-piped)
  run bash -c "cd $ROOT/packages/freeside-cli && npx tsx bin/freeside-cli.ts asson doctor '$tmp' 2>&1"
  [ "$status" -eq 1 ]
  echo "$output" | grep -q "is not valid JSON"
  ! echo "$output" | grep -q "node:internal/"
}
