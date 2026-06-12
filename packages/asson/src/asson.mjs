/**
 * asson.mjs — the instrument of invocation. Zero-dependency core for the CLI layer.
 *
 * In the hounfour, the asson is the priest's rattle: the instrument of authority that
 * summons and dismisses. Here it is the toolkit that governs CLIs — the deterministic
 * skeleton of the agent economy:
 *
 *   veve      — a CLI's self-declaration manifest (schemas/veve.schema.json)
 *   attest    — sign a build: tree hash + git commit + ed25519 (same ceremony as Legba's gate tokens)
 *   vectors   — golden input/output pairs: run them (verify) or harvest them (record live behavior)
 *   policy    — derive finn CommandPolicy allowlist entries from veves (publication ≠ legality)
 *   doctor    — compute each CLI's EARNED ladder level from evidence; diff against CLAIMED
 *
 * node:crypto + node:child_process + node:fs only. Production schemas migrate to loa-hounfour.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
// Canon + signing primitives are VENDORED from Legba (B6 / AS-10) — one source
// within the package; byte-identity to legba-core is pinned by the conformance test.
import { jcs, sha256, hashObj, keyId, genKeyPair, signBytes, verifyBytes } from './vendor/canon.mjs';

export const ASSON_VERSION = '0.1.0';
export { jcs, sha256, hashObj }; // re-export the shared grammar (single source within the package)

/** Canonical output hash: JSON stdout is JCS-normalized first (whitespace-insensitive truth); text is raw bytes. */
export function hashOutput(stdout, ioOutput) {
  if (ioOutput === 'stdout_json') {
    try { return hashObj(JSON.parse(stdout)); } catch { /* fall through: malformed JSON hashes as bytes, vectors will catch it */ }
  }
  return sha256(Buffer.from(stdout, 'utf8'));
}

// ── tree hash: the codehash of a CLI directory ──────────────────────────────
export function treeHash(dir, { ignore = ['node_modules', '.git', 'veve.json'] } = {}) {
  const lines = [];
  (function walk(d) {
    for (const name of readdirSync(d).sort()) {
      if (ignore.includes(name)) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else lines.push(relative(dir, p) + ':' + sha256(readFileSync(p)));
    }
  })(dir);
  return sha256(Buffer.from(lines.join('\n'), 'utf8'));
}

// ── build attestation: the house replacement for npm --provenance ───────────
export function createSigner({ signerId = 'asson:freeside', keyVersion = 1, signatureType = 'dev_signature' } = {}) {
  const keys = genKeyPair();
  // signatureType (B1): cycle-1 local keys are 'dev_signature' (doctor → attested-dev tier);
  // the cycle-3 CI ceremony uses 'attestation'. The doctor reads this off the attestation.
  return { signerId, keyVersion, signatureType,
    key_id: keyId(signerId, keyVersion), // the shared Legba ceremony: sha256(signer_id ':' key_version) bare hex
    publicKey: keys.publicKey, _privateKey: keys.privateKey };
}

export function attestBuild(veve, cliDir, signer, { gitCommit } = {}) {
  const unattested = { ...veve }; delete unattested.attestation;
  const body = {
    tree_hash: treeHash(cliDir),
    git_commit: gitCommit ?? gitHead(cliDir),
    signed_by_key_id: signer.key_id,
    signature_type: signer.signatureType ?? 'attestation', // dev_signature (cycle 1) | attestation (cycle 3)
    ts: new Date().toISOString(),
  };
  const signature = signBytes(jcs({ veve: unattested, ...body }), signer._privateKey);
  return { ...veve, attestation: { ...body, signature } };
}

export function verifyAttestation(veve, cliDir, publicKey) {
  if (!veve.attestation) return { ok: false, reason: 'unattested' };
  const { signature, ...body } = veve.attestation;
  const unattested = { ...veve }; delete unattested.attestation;
  const checks = {
    signature: verifyBytes(jcs({ veve: unattested, ...body }), signature, publicKey),
    tree_unchanged: treeHash(cliDir) === veve.attestation.tree_hash,
  };
  return { ok: checks.signature && checks.tree_unchanged, checks };
}

function gitHead(dir) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(); }
  catch { return '0000000'; }
}

// ── invocation: one way to run a CLI, used by vectors, harvest, and (in prod) the recorder ──
export function invoke(veve, cliDir, argv = [], stdin = null) {
  const runners = { node: process.execPath, bash: 'bash', python: 'python3', bun: 'bun', binary: null };
  const entry = join(cliDir, veve.binary.entry);
  const bin = runners[veve.binary.runtime] ?? entry;
  const args = veve.binary.runtime === 'binary' ? argv : [entry, ...argv];
  try {
    const stdout = execFileSync(bin, args, { input: stdin ?? undefined, encoding: 'utf8', timeout: 30_000 });
    return { stdout, exit: 0, output_hash: hashOutput(stdout, veve.io.output) };
  } catch (e) {
    return { stdout: e.stdout ?? '', exit: e.status ?? 1,
      output_hash: hashOutput(e.stdout ?? '', veve.io.output), error: (e.stderr ?? e.message ?? '').slice(0, 500) };
  }
}

// ── golden vectors: verify pinned behavior, or harvest pins from live behavior ──
export function runVectors(veve, cliDir) {
  return (veve.vectors ?? []).map(v => {
    const r = invoke(veve, cliDir, v.argv, v.stdin);
    const pass = r.output_hash === v.expect_output_hash && r.exit === (v.expect_exit ?? 0);
    return { name: v.name, pass, expected: v.expect_output_hash, got: r.output_hash, exit: r.exit };
  });
}

/** Harvest: run live, record what IS as what MUST REMAIN. The runs that proved the need become the tests that pin the behavior. */
export function harvestVector(veve, cliDir, { name, argv = [], stdin = null }) {
  const r = invoke(veve, cliDir, argv, stdin);
  return { name, argv, stdin, expect_output_hash: r.output_hash, expect_exit: r.exit };
}

// ── policy generation: veve → finn CommandPolicy (the deployed-address-space entry) ──
// Shape matches loa-finn src/agent/sandbox.ts CommandPolicy: {binary, subcommands, deniedFlags, validatePaths}.
export function toCommandPolicy(veve, cliDir) {
  return {
    binary: join(cliDir, veve.binary.entry),
    subcommands: veve.binary.subcommands ?? [],
    deniedFlags: [],
    validatePaths: true,
    // asson extensions — finn may ignore today; the sandbox SHOULD enforce tomorrow:
    x_determinism: veve.determinism.class,
    x_network: veve.determinism.class === 'attestable' && (veve.determinism.ambient ?? []).includes('network'),
    x_veve_tree_hash: veve.attestation?.tree_hash ?? null,
    x_timeout_s: veve.liveness?.timeout_s ?? null,        // the sandbox owns the enrage timer
    x_rel_required: veve.rel_required ?? 'casual',        // competitive tool + casual room = refusal
  };
}

// ── keyring: resolve a signer's public key BY its claimed key_id (cycle-3 binding) ──
/**
 * resolveSigner — the structural binding that closes the cycle-1 audit MEDIUM.
 * The key is fetched BY the attestation's claimed `signed_by_key_id`, so a forged
 * id is unresolvable and a wrong-key signature fails the keyring's pem. Only
 * `status: active` resolves (revocation = flip to revoked). Pure JSON read.
 * @param {{[key_id:string]: {public_key_pem:string, status:string}}} keyring
 */
export function resolveSigner(keyring, keyId) {
  const e = keyring?.[keyId];
  return e && e.status === 'active' ? e.public_key_pem : null;
}

// ── the doctor: earned ladder level from evidence, never from claims ─────────
/**
 * Earned ladder level ⊥ attestation tier — two orthogonal axes (IMP-001).
 * `earned` is L1-L5 from STRUCTURE (veve + vectors + attestation-validity + determinism).
 * `attestation_tier` is the TRUST of the signature: unattested | attested-dev | attestation.
 * A cycle-1 example is L3-by-structure AND attested-dev by tier. The doctor reports both.
 * Findings are structured `{severity: fail|warn, as_id, message}` (IMP-015); exit code is
 * 0 (clean), 1 (a fail-closed finding), 3 (warn-only) (IMP-007). 2 = usage, at the CLI.
 */
export function doctor(veve, cliDir, { publicKey = null, keyring = null } = {}) {
  const findings = [];
  const fail = (as_id, message) => findings.push({ severity: 'fail', as_id, message });
  const warn = (as_id, message) => findings.push({ severity: 'warn', as_id, message });
  let earned = 1; // it exists: L1

  // L2 needs evidence of recurrence (sensed, not requested — AS-11)
  if ((veve.ladder?.evidence_runs ?? []).length >= 2) earned = 2;
  else warn('AS-11', 'L2: needs >=2 evidence_runs (recorder-sensed recurrence — done-twice-becomes-a-path)');
  if (veve.determinism.declared_by === 'author' && earned >= 2) warn('AS-5', 'L2/L3: determinism is author-declared (honor system) — prefer effect_type or trace_audit');

  // L3 needs: contract + vectors passing + attestation verifying + honest determinism
  const vecs = runVectors(veve, cliDir);
  const vecsOk = vecs.length >= 1 && vecs.every(v => v.pass);
  // resolve the verifying key: a keyring resolves it BY signed_by_key_id (the binding,
  // cycle-3 D-8); an explicit publicKey is the cycle-2 fallback. Unknown/revoked id → AS-KR fail.
  let resolvedKey = publicKey;
  let kr_unresolved = null;
  if (keyring && veve.attestation?.signed_by_key_id) {
    resolvedKey = resolveSigner(keyring, veve.attestation.signed_by_key_id);
    if (!resolvedKey) kr_unresolved = veve.attestation.signed_by_key_id;
  }
  const att = resolvedKey ? verifyAttestation(veve, cliDir, resolvedKey) : { ok: false, reason: kr_unresolved ? 'signer not in keyring or revoked' : 'no public key supplied' };
  if (kr_unresolved) fail('AS-KR', `L3: signer not in keyring or revoked (signed_by_key_id=${String(kr_unresolved).slice(0, 12)}…)`);
  // attestation tier (B1): dev-signed warns, attestation passes clean, absent fails.
  const sigType = veve.attestation?.signature_type ?? (veve.attestation ? 'attestation' : null);
  const attestation_tier = !att.ok ? 'unattested' : (sigType === 'dev_signature' ? 'attested-dev' : 'attestation');
  if (att.ok && attestation_tier === 'attested-dev') warn('AS-2', 'attestation is dev-signed (attested-dev tier) — upgrades to attestation at the CI key ceremony');

  const honest = veve.determinism.class === 're_executable'
    ? (veve.determinism.ambient ?? []).length === 0
    : (veve.determinism.ambient ?? []).length >= 1;
  if (!honest) fail('AS-1', 'L3: determinism declaration contradicts ambient list (LG-5)');

  // ── version-dispatched checks: validators support the window {0.1.0, 0.2.0} ──
  let livenessOk = true;
  if (veve.veve_version === '0.1.0') {
    warn('AS-7', 'fork-warn: veve_version 0.1.0 — valid under the window, but 0.2.0 requires a liveness declaration; upgrade in the next fork-train');
  } else {
    const lv = veve.liveness ?? {};
    if (!lv.timeout_s) { livenessOk = false; fail('AS-7', 'L3: liveness.timeout_s missing — a tool without a clock is a loiter incentive'); }
    if ((lv.mode ?? 'oneshot') === 'daemon') { livenessOk = false; fail('AS-7', 'L3: mode=daemon claiming L3 is a category error — daemons are infrastructure, not skeleton'); }
    if (!lv.expected_p95_s) warn('AS-16', 'L3-warn: no expected_p95_s — pace-blind until gecko observes a distribution');
    if (veve.rel_required === 'competitive') warn('AS-8', 'note: tool demands competitive REL — invoking room must have recorder on + gates armed');
  }

  // AS-14 (best-effort, reframed): a statically-resolvable import outside the CLI dir → warn.
  if (crossDirImports(cliDir).length) warn('AS-14', `static import(s) resolve outside the CLI dir: ${crossDirImports(cliDir).join(', ')} — attested for in-dir bytes only; runtime reach is the sandbox's concern`);

  if (!vecsOk) fail('AS-6', `L3: vectors ${vecs.filter(v => !v.pass).map(v => v.name).join(', ') || '(none)'} failing or absent`);
  if (!att.ok) fail('AS-1', 'L3: attestation missing or invalid (' + JSON.stringify(att.checks ?? att.reason) + ')');
  if (earned >= 2 && vecsOk && att.ok && honest && livenessOk) earned = 3;

  // L4/L5 are presence-checks against finn policy + freeside registry — later cycles
  const claimed = veve.ladder?.level ?? 1;
  if (claimed > earned) fail('AS-3', `DRIFT: claims L${claimed}, earns L${earned} — claims are cheap, evidence promotes`);

  const exit = findings.some(f => f.severity === 'fail') ? 1 : (findings.some(f => f.severity === 'warn') ? 3 : 0);
  return { name: veve.name, claimed, earned, attestation_tier, vectors: vecs, findings, exit };
}

/** AS-14 best-effort: static `import`/`require` specifiers in the CLI's .mjs/.js files
 *  that resolve OUTSIDE the dir. Static only — dynamic import()/eval are not detectable
 *  (that reach is governed at the sandbox, not the build attestation). */
function crossDirImports(cliDir) {
  const out = [];
  const scan = (dir) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== 'node_modules') scan(p); continue; }
      if (!/\.(mjs|js|ts)$/.test(e)) continue;
      const src = readFileSync(p, 'utf8');
      // matches `import x from '..'`, bare `import '..'`, `require('..')`, `import('..')`
      for (const m of src.matchAll(/(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('.') && spec.includes('../')) out.push(spec);
      }
    }
  };
  try { scan(cliDir); } catch { /* best-effort */ }
  return [...new Set(out)];
}
