/**
 * keyring-binding.test.mjs — cycle-3 D-8: the keyring binding that closes the
 * cycle-1 audit MEDIUM. Uses an INLINE keyring (no ceremony, no pollution of the
 * committed signers.json). Proves: an attestation resolved BY signed_by_key_id
 * verifies (attestation tier), a forged id is unresolvable, a wrong-key fails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigner, attestBuild, doctor, resolveSigner } from '../src/asson.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WC = join(__dirname, '..', 'examples', 'wordcount');

// build a signer whose attestation is `attestation` tier + a keyring that holds its pubkey
function enrolled(signatureType = 'attestation') {
  const s = createSigner({ signerId: 'asson:test', keyVersion: 1, signatureType });
  const keyring = {
    [s.key_id]: {
      signer_id: 'asson:test', key_version: 1,
      public_key_pem: s.publicKey.export({ type: 'spki', format: 'pem' }),
      status: 'active',
    },
  };
  return { s, keyring };
}

function attestedCopy(signer) {
  const dir = mkdtempSync(join(tmpdir(), 'asson-kr-'));
  cpSync(WC, dir, { recursive: true });
  const attested = attestBuild(JSON.parse(readFileSync(join(dir, 'veve.json'))), dir, signer);
  writeFileSync(join(dir, 'veve.json'), JSON.stringify(attested));
  return { dir, attested };
}

test('resolveSigner: active resolves, revoked + unknown return null', () => {
  const kr = { abc: { public_key_pem: 'PEM', status: 'active' }, def: { public_key_pem: 'X', status: 'revoked' } };
  assert.equal(resolveSigner(kr, 'abc'), 'PEM');
  assert.equal(resolveSigner(kr, 'def'), null);
  assert.equal(resolveSigner(kr, 'ghost'), null);
  assert.equal(resolveSigner(null, 'abc'), null);
});

test('D-8 HONEST: keyring resolves signed_by_key_id → L3 attestation (clean tier, no AS-2)', () => {
  const { s, keyring } = enrolled('attestation');
  const { dir, attested } = attestedCopy(s);
  const r = doctor(attested, dir, { keyring });
  assert.equal(r.earned, 3, 'earns L3');
  assert.equal(r.attestation_tier, 'attestation', 'trusted tier');
  assert.equal(r.findings.some((f) => f.as_id === 'AS-2'), false, 'no dev-signed warn');
});

test('D-8 FORGED id: tampered signed_by_key_id is unresolvable → unattested + AS-KR', () => {
  const { s, keyring } = enrolled('attestation');
  const { dir, attested } = attestedCopy(s);
  attested.attestation.signed_by_key_id = 'de'.repeat(32);
  const r = doctor(attested, dir, { keyring });
  assert.equal(r.attestation_tier, 'unattested');
  assert.equal(r.findings.some((f) => f.as_id === 'AS-KR'), true, 'AS-KR finding');
});

test('D-8 WRONG key: keyring pem belongs to a different key than signed → signature fails → unattested', () => {
  const { s, keyring } = enrolled('attestation');
  const { dir, attested } = attestedCopy(s);
  // point the same key_id at a DIFFERENT key's pem
  const other = createSigner({ signerId: 'asson:other', keyVersion: 1 });
  const kr2 = { [s.key_id]: { ...keyring[s.key_id], public_key_pem: other.publicKey.export({ type: 'spki', format: 'pem' }) } };
  const r = doctor(attested, dir, { keyring: kr2 });
  assert.equal(r.attestation_tier, 'unattested', 'wrong key → signature fails → unattested');
  // not AS-KR (the id resolved) — it fails at the signature check (AS-1)
  assert.equal(r.findings.some((f) => f.as_id === 'AS-KR'), false);
});
