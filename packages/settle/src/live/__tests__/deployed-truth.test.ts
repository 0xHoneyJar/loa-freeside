/** deployed-truth instrument: HELD/FALSIFIED/INSUFFICIENT + finality/identity. (T2.1 AC) */
import { describe, it, expect } from "vitest";
import {
  DeployedTruthInstrument,
  type DeployedTruthReaders,
  type DeployedTruthExpectation,
  type RailwayMeta,
  type OnChainRead,
} from "../deployed-truth.instrument.js";
import type { Bar, ClaimInput } from "../../domain/claim.js";

const claim: ClaimInput = { id: "c1", domain: "deployed/railway/svc", statement: "svc @abc123 holds 42" };

function expectation(over: Partial<DeployedTruthExpectation> = {}): DeployedTruthExpectation {
  return {
    project: "proj",
    environment: "production",
    service: "svc",
    credential_source: "railway-token-prod",
    expected_commit: "abc123",
    expected_chain_id: 80094,
    expected_contract: "0xabc",
    expected_value: "42",
    min_finality_depth: 5,
    ...over,
  };
}
function bar(exp: DeployedTruthExpectation = expectation()): Bar {
  return { id: "b1", criterion: JSON.stringify(exp), sha: "n/a" };
}
function readers(rw: RailwayMeta | null, oc: OnChainRead | null): DeployedTruthReaders {
  return { async readRailway() { return rw; }, async readOnChain() { return oc; } };
}
const goodRw: RailwayMeta = {
  project: "proj", environment: "production", service: "svc",
  commit: "abc123", credential_source: "railway-token-prod",
};
function goodOc(over: Partial<OnChainRead> = {}): OnChainRead {
  return { chain_id: 80094, head_block: 100n, read_block: 90n, contract: "0xabc", value: "42", ...over };
}
function instrument(rw: RailwayMeta | null, oc: OnChainRead | null): DeployedTruthInstrument {
  return new DeployedTruthInstrument("sha-v1", readers(rw, oc));
}

describe("DeployedTruthInstrument", () => {
  it("HELD when deploy + on-chain match the pinned claim with finality", async () => {
    const r = await instrument(goodRw, goodOc()).settle(claim, bar());
    expect(r.verdict).toBe("HELD");
    expect(r.measurement).toBe("42");
  });

  it("FALSIFIED when the on-chain value diverges from the claim", async () => {
    const r = await instrument(goodRw, goodOc({ value: "99" })).settle(claim, bar());
    expect(r.verdict).toBe("FALSIFIED");
  });

  it("FALSIFIED when the deployed commit diverges from the claim", async () => {
    const r = await instrument({ ...goodRw, commit: "deadbeef" }, goodOc()).settle(claim, bar());
    expect(r.verdict).toBe("FALSIFIED");
  });

  it("INSUFFICIENT (not HELD) on an under-finalized read (SKP-005b)", async () => {
    // 2 confirmations < required 5
    const r = await instrument(goodRw, goodOc({ head_block: 92n, read_block: 90n })).settle(claim, bar());
    expect(r.verdict).toBe("INSUFFICIENT");
    expect(r.measurement).toMatch(/finality/);
  });

  it("INSUFFICIENT when a reader is unavailable", async () => {
    expect((await instrument(null, goodOc()).settle(claim, bar())).verdict).toBe("INSUFFICIENT");
    expect((await instrument(goodRw, null).settle(claim, bar())).verdict).toBe("INSUFFICIENT");
  });

  it("INSUFFICIENT on identity/credential/chain binding failure (SKP-007)", async () => {
    expect((await instrument({ ...goodRw, project: "other" }, goodOc()).settle(claim, bar())).verdict).toBe("INSUFFICIENT");
    expect((await instrument({ ...goodRw, credential_source: "leaked" }, goodOc()).settle(claim, bar())).verdict).toBe("INSUFFICIENT");
    expect((await instrument(goodRw, goodOc({ chain_id: 1 })).settle(claim, bar())).verdict).toBe("INSUFFICIENT");
  });

  it("INSUFFICIENT on an unparseable bar criterion", async () => {
    const r = await instrument(goodRw, goodOc()).settle(claim, { id: "b", criterion: "{not json", sha: "n/a" });
    expect(r.verdict).toBe("INSUFFICIENT");
  });
});
