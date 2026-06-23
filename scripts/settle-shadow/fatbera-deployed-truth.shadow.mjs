// fatBERA deployed-truth — the FIRST consumer running under the laplas brake (SHADOW).
//
// Phase 2 of The Descent (grimoires/loa/context/goal-the-descent.md): enforcement-from-below.
// freeside (application layer) invokes the settle gate that DESCENDED to loa-laplas (brakes
// layer) in Phase 1, which composes legba for ed25519+JCS — a downward-only cross-repo call.
//
// SHADOW MODE: records the verdict + trails it; it does NOT block. Flipping shadow→enforce is
// operator-gated and out of scope for Phase 2.
//
// Cross-repo wiring: path import to the adjacent laplas checkout (operator-chosen for the
// shadow MVP). Productionizing → publish settle as a package and version-pin.
//
// Run: node scripts/settle-shadow/fatbera-deployed-truth.shadow.mjs
import { verify, checkSync, makeTrailWriter, classify } from '../../../loa-laplas/scripts/settle/settle.mjs';
import { generateVerifierKeypair } from '../../../loa-laplas/scripts/legba/legba-core.mjs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── the deployed-truth instrument (ported from the closed freeside settle pkg) ──────────────
// Deterministic: reads Railway deploy-metadata + an on-chain value and compares them to the
// pinned claim (bar.criterion). Verdict HELD / FALSIFIED / INSUFFICIENT. With no readers wired
// (no production credentials in this environment) it returns INSUFFICIENT — an HONEST shadow
// result, NOT a fixture: "no verification path → the brake abstains."
class DeployedTruthInstrument {
  constructor(sha, readers) { this.sha = sha; this.readers = readers; }
  async settle(_claim, bar) {
    let exp;
    try { exp = JSON.parse(bar.criterion); } catch { return { verdict: 'INSUFFICIENT', measurement: 'unparseable bar criterion' }; }
    const rw = await this.readers.readRailway();
    const oc = await this.readers.readOnChain();
    if (!rw || !oc) return { verdict: 'INSUFFICIENT', measurement: 'deploy/on-chain read unavailable (no credentials in this environment)' };
    if (rw.project !== exp.project || rw.environment !== exp.environment || rw.service !== exp.service)
      return { verdict: 'INSUFFICIENT', measurement: `identity binding failed (got ${rw.project}/${rw.environment}/${rw.service})` };
    if (rw.credential_source !== exp.credential_source)
      return { verdict: 'INSUFFICIENT', measurement: `credential source mismatch (${rw.credential_source})` };
    if (oc.chain_id !== exp.expected_chain_id || oc.contract !== exp.expected_contract)
      return { verdict: 'INSUFFICIENT', measurement: `chain/contract binding failed (chain ${oc.chain_id})` };
    if (oc.head_block - oc.read_block < BigInt(exp.min_finality_depth))
      return { verdict: 'INSUFFICIENT', measurement: `under finality (${oc.head_block - oc.read_block} < ${exp.min_finality_depth} confirmations)` };
    if (exp.expected_commit !== undefined && rw.commit !== exp.expected_commit)
      return { verdict: 'FALSIFIED', measurement: `commit mismatch (deployed ${rw.commit} != claimed ${exp.expected_commit})` };
    if (oc.value !== exp.expected_value)
      return { verdict: 'FALSIFIED', measurement: `value mismatch (on-chain ${oc.value} != claimed ${exp.expected_value})` };
    return { verdict: 'HELD', measurement: oc.value };
  }
}

// ── the REAL fatBERA deployed-truth claim ───────────────────────────────────────────────────
// fatBERA = green-belt protocol (decision 010). Domain `deployed/fatbera` classifies FAIL_CLOSED
// (must-settle). The bar pins what "actually running" must be; editing it is a NEW run (sha
// changes), never an edit. The contract/value below are pin-points the operator fills from the
// fatBERA deployment; until then the readers return null and the brake honestly abstains.
const fatBeraExpectation = {
  project: 'freeside',
  environment: 'production',
  service: 'fatbera',
  credential_source: 'railway:freeside-prod',
  expected_chain_id: 80094,                      // Berachain mainnet
  expected_contract: '0x0000000000000000000000000000000000000000', // operator: pin real fatBERA address
  expected_value: '0x0',                         // operator: pin expected on-chain state
  min_finality_depth: 8,
};
const barCriterion = JSON.stringify(fatBeraExpectation);
const barSha = 'sha256:' + createHash('sha256').update(barCriterion).digest('hex'); // pinned BEFORE evidence
const claim = { id: 'fatbera-deployed-truth', domain: 'deployed/fatbera' };
const bar = { criterion: barCriterion, sha: barSha };

// Readers: this environment has NO production credentials, so they return null → INSUFFICIENT
// (honest). Wire a real Railway deploy-metadata read + a read-only RPC call to get HELD/FALSIFIED.
const readers = {
  async readRailway() { return process.env.RAILWAY_TOKEN ? null /* real read goes here */ : null; },
  async readOnChain() { return process.env.BERACHAIN_RPC ? null /* real read goes here */ : null; },
};

// ── run the claim under the brake (SHADOW) ──────────────────────────────────────────────────
const posture = classify(claim.domain);                 // deployed/** → FAIL_CLOSED (must-settle)
const requiredTier = posture === 'FAIL_CLOSED' ? 'settled' : posture === 'VERIFY_THEN_PROCEED' ? 'pinned' : 'claimed';
const now = Math.floor(Date.now() / 1000);              // gate prepared_at stamp (the instrument itself is wall-clock-free)
const { privateKey, publicKeyBase64 } = generateVerifierKeypair();
const instrument = new DeployedTruthInstrument('deployed-truth@phase2', readers);
const envelope = { claim, bar, instrument_id: 'deployed-truth', instrument_sha: 'deployed-truth@phase2' };

const signed = await verify(envelope, instrument, privateKey, { now, ttl: 3600 });
const decision = checkSync(signed, { trustedVerifierPublicKey: publicKeyBase64, now, requiredTier, claim_id: claim.id });

// ── SHADOW: record + trail; never block ─────────────────────────────────────────────────────
const trailPath = join(process.env.SETTLE_TRAIL_DIR || tmpdir(), 'fatbera-deployed-truth.shadow.jsonl');
const trail = makeTrailWriter(trailPath);
const row = {
  ts: new Date(now * 1000).toISOString(),
  mode: 'SHADOW',
  claim_id: claim.id,
  domain: claim.domain,
  bar_sha: barSha,
  posture,
  verdict: signed.snapshot.verdict,
  earned_tier: decision.earned_tier,
  required_tier: decision.required_tier,
  would_proceed: decision.proceed,
  enforced: false,                 // SHADOW: the brake observed; it did not block
  reason: decision.reason,
};
trail.write(row);

// ── detector tile: STATUS|SIGNAL|MISMATCH over the trail ────────────────────────────────────
// MISMATCH=1 means: in shadow the brake would have BLOCKED (abstain), but the app proceeded —
// the gap to review before flipping shadow→enforce.
const mismatch = decision.proceed ? 0 : 1;
const status = decision.proceed ? 'ok' : 'HALT';
const tile = `STATUS=${status}|SIGNAL=settle-shadow|CLAIM=${claim.domain}|TIER=${decision.earned_tier}|MISMATCH=${mismatch}|MODE=SHADOW`;

console.log('── fatBERA deployed-truth · SHADOW · under the laplas brake (composes legba) ──');
console.log('posture   :', posture, '→ requiredTier', requiredTier);
console.log('verdict   :', signed.snapshot.verdict, '→ earned_tier', decision.earned_tier);
console.log('decision  :', decision.proceed ? 'PROCEED' : 'ABSTAIN/HALT (shadow: observed, NOT enforced)');
console.log('reason    :', decision.reason);
console.log('trail row :', JSON.stringify(row));
console.log('trail file:', trailPath);
console.log(tile);
