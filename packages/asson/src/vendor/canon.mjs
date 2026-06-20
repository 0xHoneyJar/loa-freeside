/**
 * vendor/canon.mjs — the shared canonicalization + signing primitives.
 *
 * VENDORED (not imported) from Legba's `legba-core.mjs` (B6 / AS-10). asson and
 * Legba are one trust story in two tenses: Legba attests RUNS (gate tokens),
 * asson attests BUILDS (veve attestations). They MUST canonicalize and derive
 * key-ids identically — but asson's core stays zero-NPM-dep and self-contained
 * (it cannot import across the construct-rooms-substrate package boundary), so
 * these ~30 lines are copied here, and `test/canon-conformance.test.mjs` pins
 * byte-identity against a golden corpus generated from the real Legba source.
 *
 * Provenance — golden generated from:
 *   construct-rooms-substrate scripts/legba/legba-core.mjs
 *   @ 959c782dd243e8487c63dd644b471bca19425e79 (origin/main, 2026-06-12)
 * re-vendor when legba-core.mjs moves past that SHA: regenerate the golden via
 *   node test/canon-conformance.test.mjs --regen-against-legba <path-to-legba-core>
 * and review the git diff. A divergence is a loud, gated event, never silent.
 */
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';

/** RFC-8785-subset JCS: sorted keys, no whitespace. Byte-identical to legba-core jcs(). */
export function jcs(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(jcs).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + jcs(v[k])).join(',') + '}';
}

/** sha256 with the `sha256:` prefix over a string or Buffer (legba-core sha256 shape). */
export const sha256 = (b) => 'sha256:' + createHash('sha256').update(b).digest('hex');
/** bare hex sha256 over a string (legba-core's internal sha()). */
export const shaHex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
/** hash of an object via its canonical JCS form. */
export const hashObj = (o) => sha256(Buffer.from(jcs(o), 'utf8'));

/**
 * Key-id derivation — THE shared ceremony: sha256(signer_id ':' key_version),
 * bare hex. Identical to legba-core's `sha(\`${gatekeeperId}:${keyVersion}\`)`.
 * Build attestations (asson) and run tokens (Legba) derive key-ids the same way.
 */
export const keyId = (signerId, keyVersion = 1) => shaHex(`${signerId}:${keyVersion}`);

/** ed25519 keypair (node:crypto), the Legba/hounfour signing primitive. */
export function genKeyPair() {
  return generateKeyPairSync('ed25519');
}
/** sign canonical bytes; returns base64. */
export function signBytes(bytes, privateKey) {
  return sign(null, Buffer.from(bytes), privateKey).toString('base64');
}
/** verify a base64 ed25519 signature over canonical bytes. */
export function verifyBytes(bytes, signatureB64, publicKey) {
  return verify(null, Buffer.from(bytes), publicKey, Buffer.from(signatureB64, 'base64'));
}
