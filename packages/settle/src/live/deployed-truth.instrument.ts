/**
 * deployed-truth — the first settle-instrument. (T2.1, SKP-004/005b/007)
 *
 * Settles "what is actually running" for the deployed-state domain: reads Railway
 * deploy metadata + an on-chain value and compares them against the pinned claim
 * (held in `bar.criterion`). Verdict HELD / FALSIFIED / INSUFFICIENT.
 *
 * SANDBOX (SKP-002b) — the execution boundary, made concrete:
 *   - I/O is limited to the two injected readers: a Railway deploy-metadata read
 *     and a read-only on-chain call. No filesystem writes. Network limited to the
 *     declared Railway API + the declared RPC endpoint.
 *   - Env scrubbed to the declared credential source; the read is rejected
 *     (INSUFFICIENT) if its credential source != the claimed one.
 *   - DETERMINISTIC: no LLM, no wall-clock, no rng. Finality is block-height
 *     based (head − read block), never time based — so an independent verifier
 *     re-executing the instrument gets the same verdict.
 *
 * Identity/finality (SKP-005b/007): the read must bind to the CLAIMED
 * project/env/service + chain/contract, and an under-finalized read is
 * INSUFFICIENT (never HELD) — absence of finality is not proof.
 */

import type { SettleInstrument, InstrumentResult } from "../ports/settle-instrument.port.js";
import type { ClaimInput, Bar } from "../domain/claim.js";

export const DEPLOYED_TRUTH_ID = "deployed-truth";

export interface RailwayMeta {
  readonly project: string;
  readonly environment: string;
  readonly service: string;
  readonly commit: string;
  readonly credential_source: string;
}

export interface OnChainRead {
  readonly chain_id: number;
  readonly head_block: bigint;
  readonly read_block: bigint;
  readonly contract: string;
  readonly value: string;
}

export interface DeployedTruthReaders {
  /** Railway deploy metadata, or null when unavailable (→ INSUFFICIENT). */
  readRailway(): Promise<RailwayMeta | null>;
  /** Read-only on-chain value, or null when unavailable (→ INSUFFICIENT). */
  readOnChain(): Promise<OnChainRead | null>;
}

/** The pinned expectation, serialized as JSON in `bar.criterion`. */
export interface DeployedTruthExpectation {
  readonly project: string;
  readonly environment: string;
  readonly service: string;
  readonly credential_source: string;
  readonly expected_commit?: string;
  readonly expected_chain_id: number;
  readonly expected_contract: string;
  readonly expected_value: string;
  /** Confirmations (head − read block) required before a read counts as settled. */
  readonly min_finality_depth: number;
}

function insufficient(measurement: string): InstrumentResult {
  return { verdict: "INSUFFICIENT", measurement };
}

export class DeployedTruthInstrument implements SettleInstrument {
  readonly id = DEPLOYED_TRUTH_ID;

  constructor(
    readonly sha: string,
    private readonly readers: DeployedTruthReaders,
  ) {}

  async settle(_claim: ClaimInput, bar: Bar): Promise<InstrumentResult> {
    let exp: DeployedTruthExpectation;
    try {
      exp = JSON.parse(bar.criterion) as DeployedTruthExpectation;
    } catch {
      return insufficient("unparseable bar criterion");
    }

    const rw = await this.readers.readRailway();
    const oc = await this.readers.readOnChain();
    if (!rw || !oc) return insufficient("deploy/on-chain read unavailable");

    // Identity binding: the read must be of the CLAIMED target (SKP-007).
    if (rw.project !== exp.project || rw.environment !== exp.environment || rw.service !== exp.service) {
      return insufficient(`identity binding failed (got ${rw.project}/${rw.environment}/${rw.service})`);
    }
    // Credential-source validation: read must come from the declared source.
    if (rw.credential_source !== exp.credential_source) {
      return insufficient(`credential source mismatch (${rw.credential_source})`);
    }
    // Chain/contract identity.
    if (oc.chain_id !== exp.expected_chain_id || oc.contract !== exp.expected_contract) {
      return insufficient(`chain/contract binding failed (chain ${oc.chain_id})`);
    }
    // Finality (SKP-005b): an under-finalized read cannot settle → INSUFFICIENT.
    const confirmations = oc.head_block - oc.read_block;
    if (confirmations < BigInt(exp.min_finality_depth)) {
      return insufficient(`under finality (${confirmations} < ${exp.min_finality_depth} confirmations)`);
    }
    // Deployed commit must match the claim, when pinned.
    if (exp.expected_commit !== undefined && rw.commit !== exp.expected_commit) {
      return { verdict: "FALSIFIED", measurement: `commit mismatch (deployed ${rw.commit} != claimed ${exp.expected_commit})` };
    }
    // The on-chain value vs the pinned claim — the actual settlement check.
    if (oc.value !== exp.expected_value) {
      return { verdict: "FALSIFIED", measurement: `value mismatch (on-chain ${oc.value} != claimed ${exp.expected_value})` };
    }
    return { verdict: "HELD", measurement: oc.value };
  }
}
