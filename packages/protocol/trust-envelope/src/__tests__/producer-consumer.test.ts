import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  TrustEnvelopeRejectedError,
  createStreamConsumerState,
  decodeFixtureScenarioBundle,
  fixtureRegistryFromBundle,
  ingestTrustEnvelope,
  installEpochBaseline,
  requestGapRepairRange,
  verifyTrustEnvelope,
  FIXTURE_STREAM_ID,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/scenarios");

describe("shared producer/consumer fixtures (CR-009)", () => {
  const bundle = decodeFixtureScenarioBundle(
    JSON.parse(readFileSync(join(fixturesDir, "producer-consumer.shared.json"), "utf8")),
  );
  const registry = fixtureRegistryFromBundle(bundle);
  const acceptedAtMs = (bundle as { accepted_at_ms?: number }).accepted_at_ms ?? Date.parse(
    "2026-07-17T21:00:01.000Z",
  );

  it("passes verification for every accept fixture", () => {
    for (const scenario of bundle.envelopes.filter((entry) => entry.expect === "accept")) {
      expect(() =>
        verifyTrustEnvelope({
          envelope: scenario.envelope,
          registry,
          acceptedAtMs,
        }),
      ).not.toThrow();
    }
  });

  it("rejects verify-stage fixtures before persistence", () => {
    for (const scenario of bundle.envelopes.filter(
      (entry) => entry.expect === "reject" && entry.reject_stage === "verify",
    )) {
      try {
        verifyTrustEnvelope({
          envelope: scenario.envelope,
          registry,
          acceptedAtMs,
        });
        expect.fail(`expected rejection for ${scenario.id}`);
      } catch (error) {
        expect(error).toBeInstanceOf(TrustEnvelopeRejectedError);
        if (scenario.reject_reason !== undefined) {
          expect((error as TrustEnvelopeRejectedError).reason).toBe(scenario.reject_reason);
        }
      }
    }
  });

  it("rejects ingest-stage fixtures at the inbox boundary", () => {
    let state = createStreamConsumerState(FIXTURE_STREAM_ID, 1);
    const accepted = bundle.envelopes.find((entry) => entry.id === "valid-primary");
    const rotated = bundle.envelopes.find((entry) => entry.id === "rotation-overlap-new-key");
    expect(accepted).toBeDefined();
    expect(rotated).toBeDefined();

    for (const envelope of [accepted!, rotated!]) {
      const result = ingestTrustEnvelope({
        envelope: envelope.envelope,
        registry,
        acceptedAtMs,
        state,
      });
      expect(result.kind).toBe("accepted");
      if (result.kind === "accepted") state = result.state;
    }

    for (const scenario of bundle.envelopes.filter(
      (entry) => entry.expect === "reject" && entry.reject_stage === "ingest",
    )) {
      const result = ingestTrustEnvelope({
        envelope: scenario.envelope,
        registry,
        acceptedAtMs,
        state,
      });
      expect(result.kind, scenario.id).toBe("rejected");
      if (result.kind === "rejected" && scenario.reject_reason !== undefined) {
        expect(result.error.reason).toBe(scenario.reject_reason);
      }
    }
  });

  it("covers rotation, gap repair, epoch baseline, replay, and disaster recovery", () => {
    let state = createStreamConsumerState(FIXTURE_STREAM_ID, 1);

    const accepted = bundle.envelopes.find((entry) => entry.id === "valid-primary");
    const rotated = bundle.envelopes.find((entry) => entry.id === "rotation-overlap-new-key");
    const gap = bundle.envelopes.find((entry) => entry.id === "sequence-gap");
    const epochWithoutBaseline = bundle.envelopes.find(
      (entry) => entry.id === "epoch-without-baseline",
    );
    const baselineScenario = bundle.baselines?.find((entry) => entry.id === "epoch-2-complete");

    expect(accepted).toBeDefined();
    expect(rotated).toBeDefined();
    expect(gap).toBeDefined();
    expect(epochWithoutBaseline).toBeDefined();
    expect(baselineScenario).toBeDefined();

    const first = ingestTrustEnvelope({
      envelope: accepted!.envelope,
      registry,
      acceptedAtMs,
      state,
    });
    expect(first.kind).toBe("accepted");

    const second = ingestTrustEnvelope({
      envelope: rotated!.envelope,
      registry,
      acceptedAtMs,
      state: first.state,
    });
    expect(second.kind).toBe("accepted");

    const replay = ingestTrustEnvelope({
      envelope: accepted!.envelope,
      registry,
      acceptedAtMs,
      state: second.state,
    });
    expect(replay.kind).toBe("rejected");
    if (replay.kind === "rejected") {
      expect(replay.error.reason).toBe("event_id_replay");
    }

    const gapResult = ingestTrustEnvelope({
      envelope: gap!.envelope,
      registry,
      acceptedAtMs,
      state: second.state,
    });
    expect(gapResult.kind).toBe("rejected");
    if (gapResult.kind === "rejected") {
      expect(gapResult.error.reason).toBe("sequence_gap");
      expect(requestGapRepairRange(gapResult.state)).toEqual({ fromSequence: 3, toSequence: 5 });
      // BB #497: gap reject must not poison event_id or skip missing sequences.
      expect(gapResult.state.seenEventIds.has(gap!.envelope.header.event_id)).toBe(false);
      expect(gapResult.state.highestContiguousSequence).toBe(
        second.state.highestContiguousSequence,
      );
    }

    // Redelivery of the same jumped-ahead envelope still reports sequence_gap
    // (not event_id_replay) until the missing range is repaired in order.
    const gapRedelivery = ingestTrustEnvelope({
      envelope: gap!.envelope,
      registry,
      acceptedAtMs,
      state: gapResult.state,
    });
    expect(gapRedelivery.kind).toBe("rejected");
    if (gapRedelivery.kind === "rejected") {
      expect(gapRedelivery.error.reason).toBe("sequence_gap");
    }

    const epochReject = ingestTrustEnvelope({
      envelope: epochWithoutBaseline!.envelope,
      registry,
      acceptedAtMs,
      state: second.state,
    });
    expect(epochReject.kind).toBe("rejected");

    state = installEpochBaseline({
      baseline: baselineScenario!.baseline,
      registry,
      acceptedAtMs,
      state: second.state,
      expectedBaselineDigest: baselineScenario!.baseline.baseline_digest,
    });
    expect(state.streamEpoch).toBe(2);
    expect(state.baselineInstalled).toBe(true);

    const resumedOldEpoch = ingestTrustEnvelope({
      envelope: accepted!.envelope,
      registry,
      acceptedAtMs,
      state,
    });
    expect(resumedOldEpoch.kind).toBe("rejected");
    if (resumedOldEpoch.kind === "rejected") {
      expect(resumedOldEpoch.error.reason).toBe("epoch_resume_forbidden");
    }
  });
});
