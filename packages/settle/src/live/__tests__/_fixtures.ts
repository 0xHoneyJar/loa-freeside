/** Shared test builders. Not a *.test.ts file, so vitest does not run it. */
import { SNAPSHOT_SCHEMA, type VerificationSnapshot, type ChainHealth } from "../../domain/snapshot.js";
import type { Tier } from "../../domain/tier.js";
import type { Verdict, ClaimInput, Bar, VerdictEnvelope } from "../../domain/claim.js";
import type { SettleInstrument, InstrumentResult } from "../../ports/settle-instrument.port.js";

export interface SnapshotOpts {
  claim_id: string;
  domain: string;
  earned_tier: Tier;
  verdict?: Verdict;
  prepared_at?: number;
  ttl?: number;
  instrument_id?: string;
  instrument_sha?: string;
  bar_sha?: string;
  chain_health?: ChainHealth;
}

export function makeSnapshot(o: SnapshotOpts): VerificationSnapshot {
  return {
    schema: SNAPSHOT_SCHEMA,
    claim_id: o.claim_id,
    domain: o.domain,
    bar_sha: o.bar_sha ?? "bar-sha-1",
    instrument_id: o.instrument_id ?? "test-instrument",
    instrument_sha: o.instrument_sha ?? "inst-sha-1",
    verdict: o.verdict ?? "HELD",
    earned_tier: o.earned_tier,
    chain_health: o.chain_health ?? "ok",
    prepared_at: o.prepared_at ?? 1000,
    ttl: o.ttl ?? 1000,
  };
}

/** A SettleInstrument that always returns a fixed result — lets a test make the
 *  instrument disagree with a producer's self-report. */
export class FixedInstrument implements SettleInstrument {
  constructor(
    readonly id: string,
    readonly sha: string,
    private readonly result: InstrumentResult,
  ) {}

  async settle(_claim: ClaimInput, _bar: Bar): Promise<InstrumentResult> {
    return this.result;
  }
}

export interface EnvelopeOpts {
  instrument_id: string;
  instrument_sha: string;
  self_reported_verdict?: Verdict;
  self_reported_tier?: Tier;
  domain?: string;
}

export function makeEnvelope(o: EnvelopeOpts): VerdictEnvelope {
  return {
    claim: { id: "c1", domain: o.domain ?? "money/transfer", statement: "the thing is true" },
    bar: { id: "b1", criterion: "criterion", sha: "bar-sha-1" },
    instrument_id: o.instrument_id,
    instrument_sha: o.instrument_sha,
    self_reported_verdict: o.self_reported_verdict ?? "HELD",
    self_reported_tier: o.self_reported_tier ?? "settled",
    self_reported_measurement: "42",
  };
}
