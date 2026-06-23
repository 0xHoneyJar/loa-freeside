// deploy-commit-truth — the FIRST real consumer under the laplas brake (SHADOW).
//
// Phase 2 of The Descent (enforcement-from-below), redone honestly: this replaces the fatBERA
// placeholder (an arbitrary DeFi token with no real data) with a claim that actually belongs
// in this build and needs NO external creds —
//
//   "is the running code actually the commit we claim is deployed?"
//
// verified against REAL local git. That is the ungrounded-live-state cure applied to code
// deployment: instead of an agent asserting "we shipped X", the claim runs through the settle
// gate, which abstains/falsifies when the deployed commit doesn't match the claimed one.
//
// freeside (application layer) invokes the settle gate that DESCENDED to loa-laplas (brakes
// layer) in Phase 1, composing legba — downward-only. SHADOW: records + trails, never blocks.
//
// Run:  node scripts/settle-shadow/deploy-commit-truth.shadow.mjs
// Test: node --test scripts/settle-shadow/deploy-commit-truth.shadow.test.mjs
import { verify, checkSync, makeTrailWriter, classify } from '../../../loa-laplas/scripts/settle/settle.mjs';
import { generateVerifierKeypair } from '../../../loa-laplas/scripts/legba/legba-core.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// ── the instrument: reads the ACTUAL deployed commit (git HEAD) vs the pinned claim ──────────
// Deterministic, no creds, no network. INSUFFICIENT if git can't be read; HELD if the running
// code matches the claimed commit; FALSIFIED if it has drifted.
export class DeployCommitTruthInstrument {
  constructor(sha, readHead) { this.sha = sha; this.readHead = readHead; }
  async settle(_claim, bar) {
    let exp;
    try { exp = JSON.parse(bar.criterion); } catch { return { verdict: 'INSUFFICIENT', measurement: 'unparseable bar criterion' }; }
    let head;
    try { head = await this.readHead(); } catch { head = null; }
    if (!head) return { verdict: 'INSUFFICIENT', measurement: 'could not read deployed commit (git unavailable)' };
    if (typeof exp.expected_commit !== 'string' || exp.expected_commit.length < 7)
      return { verdict: 'INSUFFICIENT', measurement: 'claim has no pinned expected_commit' };
    if (head !== exp.expected_commit)
      return { verdict: 'FALSIFIED', measurement: `deployed ${head.slice(0, 12)} != claimed ${exp.expected_commit.slice(0, 12)}` };
    return { verdict: 'HELD', measurement: head };
  }
}

export function requiredTierForDomain(domain) {
  const posture = classify(domain);
  const tier = posture === 'FAIL_CLOSED' ? 'settled' : posture === 'VERIFY_THEN_PROCEED' ? 'pinned' : 'claimed';
  return { posture, tier };
}

// ── run a claim under the brake — the testable core ─────────────────────────────────────────
// mode: 'shadow' (default — observe + trail, NEVER block) | 'enforce' (the brake BITES: throws
// BRAKE_BLOCKED on a must-settle abstain). Default stays shadow — flipping the DEFAULT to
// enforce in production is operator-gated; this only makes the capability exist + tested.
export async function runShadow({ claim, bar, instrument, now, trailPath, mode = 'shadow' }) {
  const { posture, tier: requiredTier } = requiredTierForDomain(claim.domain);
  const { privateKey, publicKeyBase64 } = generateVerifierKeypair();
  const envelope = { claim, bar, instrument_id: instrument.id ?? 'deploy-commit-truth', instrument_sha: instrument.sha ?? 'deploy-commit-truth@1' };

  const signed = await verify(envelope, instrument, privateKey, { now, ttl: 3600 });
  const decision = checkSync(signed, { trustedVerifierPublicKey: publicKeyBase64, now, requiredTier, claim_id: claim.id });

  const row = {
    ts: new Date(now * 1000).toISOString(),
    mode: mode.toUpperCase(),
    claim_id: claim.id,
    domain: claim.domain,
    bar_sha: bar.sha,
    posture,
    verdict: signed.snapshot.verdict,
    earned_tier: decision.earned_tier,
    required_tier: decision.required_tier,
    would_proceed: decision.proceed,
    enforced: mode === 'enforce',    // SHADOW observes; ENFORCE blocks
    reason: decision.reason,
  };
  if (trailPath) makeTrailWriter(trailPath).write(row);  // verdict is recorded in BOTH modes

  const mismatch = decision.proceed ? 0 : 1;  // 1 ⇒ the brake would (shadow) / did (enforce) HALT
  const status = decision.proceed ? 'ok' : (mode === 'enforce' ? 'BLOCKED' : 'HALT');
  const tile = `STATUS=${status}|SIGNAL=settle-shadow|CLAIM=${claim.domain}|TIER=${decision.earned_tier}|MISMATCH=${mismatch}|MODE=${mode.toUpperCase()}`;
  // ENFORCE: a must-settle abstain BLOCKS (the brake bites). The verdict is already trailed above.
  if (mode === 'enforce' && !decision.proceed) {
    const err = new Error(`settle-gate BLOCKED (enforce): ${decision.reason}`);
    err.code = 'BRAKE_BLOCKED'; err.tile = tile; err.row = row; err.decision = decision;
    throw err;
  }
  return { signed, decision, row, tile };
}

// ── the REAL claim: "freeside's deployed code is the claimed release commit" ─────────────────
// domain deployed/freeside classifies FAIL_CLOSED (must-settle). The bar pins the commit BEFORE
// evidence; editing it is a NEW run (sha changes).
export function deployCommitClaim(expectedCommit) {
  const expectation = { repo: 'loa-freeside', ref: 'origin/main', expected_commit: expectedCommit };
  const criterion = JSON.stringify(expectation);
  const sha = 'sha256:' + createHash('sha256').update(criterion).digest('hex');
  return { claim: { id: 'freeside-deploy-commit-truth', domain: 'deployed/freeside' }, bar: { criterion, sha } };
}

// real reader: the actual git HEAD of a repo (deterministic, no creds).
export function gitHeadReader(cwd) {
  return async () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

// ── main: run the real claim against this freeside checkout ──────────────────────────────────
// SHADOW by default. `--enforce` makes the brake BITE (exit non-zero on abstain) — the
// operator-gated production flip; here it just lets you exercise the capability by hand.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mode = process.argv.includes('--enforce') ? 'enforce' : 'shadow';
  const repo = join(fileURLToPath(import.meta.url), '..', '..', '..'); // freeside root
  const expected = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: repo, encoding: 'utf8' }).trim();
  const { claim, bar } = deployCommitClaim(expected);
  const now = Math.floor(Date.now() / 1000);
  const instrument = new DeployCommitTruthInstrument('deploy-commit-truth@1', gitHeadReader(repo));
  const trailPath = join(process.env.SETTLE_TRAIL_DIR || tmpdir(), 'deploy-commit-truth.shadow.jsonl');
  const { posture, tier } = requiredTierForDomain(claim.domain);
  console.log(`── freeside deploy-commit-truth · ${mode.toUpperCase()} · under the laplas brake (composes legba) ──`);
  console.log('claim     : freeside HEAD == origin/main', expected.slice(0, 12), '→ requiredTier', tier, `(${posture})`);
  try {
    const { signed, decision, row, tile } = await runShadow({ claim, bar, instrument, now, trailPath, mode });
    console.log('verdict   :', signed.snapshot.verdict, '→ earned_tier', decision.earned_tier, '(' + row.reason + ')');
    console.log('decision  :', decision.proceed ? 'PROCEED (deployed code matches the claim)' : 'ABSTAIN/HALT (shadow: observed, NOT enforced)');
    console.log('trail row :', JSON.stringify(row));
    console.log(tile);
  } catch (e) {
    if (e.code !== 'BRAKE_BLOCKED') throw e;
    console.log('verdict   :', e.row.verdict, '→ earned_tier', e.decision.earned_tier);
    console.log('decision  : BLOCKED by the brake (enforce):', e.decision.reason);
    console.log('trail row :', JSON.stringify(e.row));
    console.log(e.tile);
    process.exit(1); // the brake bit — a real, ungrounded deploy claim was refused
  }
}
