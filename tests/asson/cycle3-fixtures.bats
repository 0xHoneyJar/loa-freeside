#!/usr/bin/env bats
# Asson cycle-3 acceptance: keyring binding + key ceremony + graduations.
# The binding's 3 cases live in packages/asson/test/keyring-binding.test.mjs (node:test);
# here we gate the ceremony (persistent key, gitignore, 0600), the CLI --keyring path,
# and the graduations — all against TEMP keyrings (the committed signers.json is untouched).

ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PKG="$ROOT/packages/asson"
CLI="$ROOT/packages/freeside-cli"
CEREMONY="$PKG/scripts/ci-key-ceremony.mjs"

# (a) the binding node:test is green (the 3 D-8 cases + resolveSigner units)
@test "(a) keyring binding node:test green (D-8: honest/forged/wrong-key + resolveSigner)" {
  run bash -c "cd '$PKG' && node --test test/keyring-binding.test.mjs"
  [ "$status" -eq 0 ]
}

# (b) ceremony enroll → active keyring entry + a 0600 private key under a gitignored path
@test "(b) ceremony enroll: active keyring entry + private key 0600, NEVER committed" {
  kr="$(mktemp -d)/signers.json"; kd="$(mktemp -d)/keys"
  run bash -c "ASSON_KEYRING='$kr' ASSON_KEYDIR='$kd' node '$CEREMONY' enroll --signer asson:bats --version 1"
  [ "$status" -eq 0 ]
  # exactly one active entry
  run bash -c "python3 -c \"import json; d=json.load(open('$kr')); e=list(d.values())[0]; print(e['status'], e['signer_id'])\""
  [ "$output" = "active asson:bats" ]
  # private key file is 0600
  keyfile="$(ls $kd/*.pem)"
  perms="$(stat -f '%Lp' "$keyfile")"
  [ "$perms" = "600" ]
  # the real key dir is gitignored (private keys never committed)
  grep -q "asson-keys" "$ROOT/.gitignore"
}

# (c) graduations: 2 examples attested via the ceremony key → doctor --keyring → L3 attestation
@test "(c) graduations: wordcount + lexicon-lint reach L3 (attestation) under the keyring" {
  kr="$(mktemp -d)/signers.json"; kd="$(mktemp -d)/keys"
  for ex in wordcount lexicon-lint; do
    dir="$(mktemp -d)/$ex"; mkdir -p "$dir"; cp -r "$PKG/examples/$ex/"* "$dir"
    run bash -c "ASSON_KEYRING='$kr' ASSON_KEYDIR='$kd' node --input-type=module -e \"
      import { enroll, attestWith } from '$CEREMONY';
      import { readFileSync, writeFileSync } from 'node:fs';
      const { key_id } = enroll({ signerId: 'asson:grad-$ex', keyVersion: 1 });
      const v = JSON.parse(readFileSync('$dir/veve.json'));
      writeFileSync('$dir/veve.json', JSON.stringify(attestWith(v, '$dir', key_id)));
    \""
    [ "$status" -eq 0 ]
    run bash -c "cd '$CLI' && npx tsx bin/freeside-cli.ts asson doctor '$dir' --keyring '$kr' 2>/dev/null"
    echo "$output" | grep -q "Earned: L3 (attestation)"
  done
}

# (c2) the CLI binding rejects a forged signer (unattested, not L3)
@test "(c2) doctor --keyring: a forged signed_by_key_id → NOT L3 attestation" {
  kr="$(mktemp -d)/signers.json"; kd="$(mktemp -d)/keys"
  dir="$(mktemp -d)/wc"; mkdir -p "$dir"; cp -r "$PKG/examples/wordcount/"* "$dir"
  run bash -c "ASSON_KEYRING='$kr' ASSON_KEYDIR='$kd' node --input-type=module -e \"
    import { enroll, attestWith } from '$CEREMONY';
    import { readFileSync, writeFileSync } from 'node:fs';
    const { key_id } = enroll({ signerId: 'asson:forge', keyVersion: 1 });
    const v = JSON.parse(readFileSync('$dir/veve.json'));
    const a = attestWith(v, '$dir', key_id);
    a.attestation.signed_by_key_id = 'de'.repeat(32);   // forge the claimed id
    writeFileSync('$dir/veve.json', JSON.stringify(a));
  \""
  [ "$status" -eq 0 ]
  run bash -c "cd '$CLI' && npx tsx bin/freeside-cli.ts asson doctor '$dir' --keyring '$kr' 2>/dev/null"
  ! echo "$output" | grep -q "Earned: L3 (attestation)"
  echo "$output" | grep -qE "L2|unattested"
}

# (d) scope guard — concrete denylist: NONE of cycles 4-5 exist
@test "scope guard (d): no cycle-4 watchdog wired into settings/hooks" {
  run bash -c "grep -rl 'livenessVerdict' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}
@test "scope guard (d): no cycle-5 lexicon-lint comms-gate hook registration" {
  run bash -c "grep -rl 'lexicon-lint' $ROOT/.claude/settings.json $ROOT/.claude/hooks 2>/dev/null | wc -l | tr -d ' '"
  [ "$output" = "0" ]
}
