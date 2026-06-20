# Sprint Plan — Asson Cycle 3: keyring binding + key ceremony + graduations

> **Cycle**: asson-cli-layer cycle 3 of 5 (PRD §3 ladder; SDD §7 rung 3 + D-8) · epic `arrakis-gfgv`
> **Branch**: `asson-cli-layer/cycle-1` (stacks on cycles 1-2; leave-local) · `simstim-20260611-asson-c3`

> **Scope** (SDD D-8 + §7 row 3): the keyring binding that **closes the cycle-1 audit MEDIUM** (the `attestation` tier finally means "trusted", not "verifies against the key you handed me") → a persistent-key CI ceremony (dev→attestation upgrade) → ≥2 honest L3-attestation graduations. NOTHING from cycles 4-5: no liveness-watchdog wiring, no finn PROPOSAL consumption, no lexicon comms-gate hook.

> **Domain**: network. Commit scope `network/asson/<task>`; `domain:network` beads; paths `packages/{asson,freeside-cli}/` + `tests/asson/` only.

## Tasks

### 3.1 — Keyring data model + resolver (D-8)
`packages/asson/keyring/signers.json`: a map `key_id → {signer_id, key_version, public_key_pem, status: active|revoked, added_ts}`. Add `resolveSigner(keyring, key_id)` to `asson.mjs` (or a small `keyring.mjs` re-exported): returns the `active` entry's `public_key_pem` or null (revoked/absent → null). `key_id` is the existing bare-hex `keyId(signer_id, key_version)`.
- **Invariants**: CL-1 (resolver is pure, zero-dep — JSON read only); only `status: active` resolves.
- **Acceptance**: `resolveSigner` returns the pem for an active id; null for revoked/unknown.
- **Verification**: `node:test` covering active/revoked/unknown.

### 3.2 — Doctor keyring binding (closes the audit MEDIUM)
`doctor(veve, cliDir, { publicKey = null, keyring = null })`: when `keyring` is given, RESOLVE `veve.attestation.signed_by_key_id → public_key_pem` and verify against THAT (ignoring an explicit publicKey). Unknown/revoked id → `unattested` + an `AS-KR` finding ("signer not in keyring / revoked"). A resolved+verified `signature_type: attestation` → `attestation` tier CLEAN (no AS-2 warn). `dev_signature` still → attested-dev warn. The binding is structural: the key is fetched BY the claimed id.
- **Invariants**: CL-4 (exit codes unchanged), the binding must make a forged `signed_by_key_id` unresolvable AND a wrong-key signature fail.
- **Acceptance**: attestation signed by a keyring key + doctor-with-keyring → `earned L3 (attestation)`; a veve whose `signed_by_key_id` is tampered → `unattested` + AS-KR; a veve signed by key A but claiming key B's id → signature fails → unattested.
- **Verification**: `node:test` with the three cases (honest, forged-id, wrong-key).

### 3.3 — CI key ceremony (dev→attestation upgrade)
`packages/asson/scripts/ci-key-ceremony.mjs`: mint a PERSISTENT ed25519 keypair, write the private key to a gitignored path (`.run/asson-keys/<key_id>.pem`, 0600), write the public key + metadata to `keyring/signers.json` (status active), and expose `attestWith(veve, cliDir, key_id)` signing `signature_type: attestation`. Add `keyring/` + `.run/asson-keys/` to `.gitignore` (private keys NEVER committed).
- **Invariants**: CL-6-adjacent — private key never committed/logged; the ceremony is the ONLY producer of `attestation`-tier signatures.
- **Acceptance**: running the ceremony adds an active keyring entry + a 0600 private key file (gitignored); a veve attested via the ceremony key has `signature_type: attestation`.
- **Verification**: a bats case asserts the private key path is gitignored + 0600, the keyring entry is active.

### 3.4 — Graduations (≥2 honest L3-attestation CLIs)
Attest the `wordcount` + `lexicon-lint` examples via the ceremony key → `asson doctor <ex> --keyring keyring/signers.json` → `earned L3 (attestation)` clean. These are the "≥2 honest L3 CLIs, evidence-linked" (SDD §7 row 3). (Attest COPIES in a temp dir in tests so the committed examples stay dev_signature.)
- **Acceptance**: both examples reach `L3 (attestation)` under the keyring; the doctor cites the resolved signer.
- **Verification**: bats — 2 examples × (ceremony-attest → doctor-with-keyring → L3 attestation, exit 3-or-0).

### 3.5 — Verb `--keyring` + scope fence forward + harness + emit
`freeside-cli asson doctor <dir> [--keyring <path>]` → read the keyring JSON, pass to `doctor`. Retire the cycle-2 `no ci-key*` scope-guard assertion (the fence advances). `tests/asson/cycle3-fixtures.bats`: (a) keyring resolver active/revoked/unknown; (b) doctor binding 3 cases (honest L3-attestation, forged-id→unattested, wrong-key→unattested); (c) ceremony private key gitignored+0600; (d) **scope guard** — NONE of cycles 4-5: no `livenessVerdict`/asson-watchdog in `.claude/settings.json|hooks` (cycle-4), no `lexicon-lint` comms-gate hook (cycle-5). 5 child beads (3.1-3.5, `domain:network`); `br sync`.
- **Acceptance**: cycle-3 bats green; cycles 1-2 bats still green; epic + 5 beads `domain:network`.
- **Verification**: `bats tests/asson/cycle3-fixtures.bats` exit 0; cycles 1+2 bats exit 0.

## Sprint Verification Criteria (gate for cycle 4)

1. The keyring binding closes the MEDIUM: doctor-with-keyring resolves `signed_by_key_id`, a forged id → unattested, a wrong-key signature → fails. (The cycle-2 keyring-gate-UNBUILT assertion is now SATISFIED — fence advances.)
2. ≥2 examples reach `L3 (attestation)` (clean tier, not attested-dev) under the ceremony key.
3. The ceremony's private key is gitignored + 0600 — NEVER committed.
4. `asson doctor --keyring` works end-to-end.
5. cycle-3 bats green; cycles 1+2 bats green.
6. NO cycle-4-5 territory (scope guard green).
7. Commit scope `network/asson/*`; `domain:network` beads.
