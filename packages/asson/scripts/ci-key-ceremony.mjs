#!/usr/bin/env node
/**
 * ci-key-ceremony.mjs — the dev→attestation upgrade (cycle 3, SDD D-8).
 *
 * Mints a PERSISTENT ed25519 keypair, writes the PRIVATE key to a gitignored
 * 0600 file (`.run/asson-keys/<key_id>.pem`) and the PUBLIC key + metadata to the
 * keyring (`packages/asson/keyring/signers.json`, status active). The doctor, given
 * the keyring, resolves a signature BY its `signed_by_key_id` (resolveSigner) — so a
 * signature minted here earns the `attestation` tier, the trusted upgrade from the
 * ephemeral `dev_signature`. The private key is NEVER committed or logged.
 *
 * Usage:
 *   node scripts/ci-key-ceremony.mjs enroll [--signer <id>] [--version <n>]   → adds an active keyring entry, persists the private key
 *   node scripts/ci-key-ceremony.mjs revoke <key_id>                          → flips a keyring entry to revoked
 *   import { attestWith } from './ci-key-ceremony.mjs'                         → sign a veve with an enrolled key (signature_type: attestation)
 */
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attestBuild } from '../src/asson.mjs';
import { keyId } from '../src/vendor/canon.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, '..');
// ASSON_KEYRING / ASSON_KEYDIR let tests point at temp paths so the committed
// keyring (and real private keys) are never touched by a test run.
const KEYRING = process.env.ASSON_KEYRING || join(PKG, 'keyring', 'signers.json');
const KEYDIR = process.env.ASSON_KEYDIR || join(PKG, '.run', 'asson-keys'); // gitignored

const loadKeyring = () => (existsSync(KEYRING) ? JSON.parse(readFileSync(KEYRING, 'utf8')) : {});
const saveKeyring = (k) => writeFileSync(KEYRING, JSON.stringify(k, null, 2) + '\n');
const flag = (name, def) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; };

/** Enroll a persistent signer: keyring gets the public key (active); the private key lands 0600, gitignored. */
export function enroll({ signerId = 'asson:ci', keyVersion = 1, nowIso } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const id = keyId(signerId, keyVersion);
  mkdirSync(KEYDIR, { recursive: true });
  const privPath = join(KEYDIR, `${id}.pem`);
  writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  chmodSync(privPath, 0o600); // never world-readable
  const keyring = loadKeyring();
  keyring[id] = {
    signer_id: signerId,
    key_version: keyVersion,
    public_key_pem: publicKey.export({ type: 'spki', format: 'pem' }),
    status: 'active',
    added_ts: nowIso ?? new Date().toISOString(),
  };
  saveKeyring(keyring);
  return { key_id: id, privPath, publicKey };
}

export function revoke(id) {
  const keyring = loadKeyring();
  if (!keyring[id]) throw new Error(`no keyring entry for ${id}`);
  keyring[id].status = 'revoked';
  saveKeyring(keyring);
  return id;
}

/** Sign a veve with an enrolled key → signature_type: attestation (the trusted tier). */
export function attestWith(veve, cliDir, id, { gitCommit } = {}) {
  const keyring = loadKeyring();
  const entry = keyring[id];
  if (!entry || entry.status !== 'active') throw new Error(`signer ${id} is not active`);
  const privPath = join(KEYDIR, `${id}.pem`);
  if (!existsSync(privPath)) throw new Error(`private key for ${id} not found (enroll first)`);
  const _privateKey = createPrivateKey(readFileSync(privPath, 'utf8'));
  const signer = { signerId: entry.signer_id, keyVersion: entry.key_version, signatureType: 'attestation', key_id: id, publicKey: entry.public_key_pem, _privateKey };
  return attestBuild(veve, cliDir, signer, { gitCommit });
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith('ci-key-ceremony.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'enroll') {
    const r = enroll({ signerId: flag('--signer', 'asson:ci'), keyVersion: Number(flag('--version', '1')) });
    console.log(`enrolled ${r.key_id} (private key 0600 at ${r.privPath}, gitignored)`);
  } else if (cmd === 'revoke') {
    console.log(`revoked ${revoke(process.argv[3])}`);
  } else {
    console.error('usage: ci-key-ceremony.mjs enroll [--signer <id>] [--version <n>] | revoke <key_id>');
    process.exit(2);
  }
}
