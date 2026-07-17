import { describe, expect, it } from "vitest";
import {
  buildTimeHealthSnapshot,
  PinnedKeyRegistry,
} from "@freeside/signing-key-custody-protocol";
import {
  advanceTrustStreamProducer,
  createTrustStreamProducerState,
  emitTrustEnvelope,
  fixtureSigners,
  FIXTURE_TENANT_SCOPE_DIGEST,
} from "@freeside/trust-envelope-protocol";

import {
  createDependencyLedgerInboxState,
  DEPENDENCY_EDGE_CAPABILITY,
  DEPENDENCY_EDGE_CONTRACT,
  ingestDependencyEdgeEnvelope,
  reconcileLedger,
} from "../index.js";
import { buildDependencyLedgerFixtureRegistryDocument } from "../fixture-registry.js";

const ACCEPTED_AT_MS = Date.parse("2026-07-17T21:00:01.000Z");
const ISSUED_AT_MS = Date.parse("2026-07-17T21:00:00.000Z");

const buildRegistry = () =>
  new PinnedKeyRegistry(buildDependencyLedgerFixtureRegistryDocument("2026-07-17T21:00:00.000Z"));

const buildTimeHealth = () =>
  buildTimeHealthSnapshot({
    evaluatedAtMs: ACCEPTED_AT_MS,
    databaseUnixMs: ACCEPTED_AT_MS,
    authoritativeSources: [
      {
        source_id: "ntp-a",
        observed_at: "2026-07-17T21:00:01.000Z",
        unix_ms: ACCEPTED_AT_MS,
        uncertainty_ms: 5,
      },
      {
        source_id: "ntp-b",
        observed_at: "2026-07-17T21:00:01.000Z",
        unix_ms: ACCEPTED_AT_MS + 10,
        uncertainty_ms: 8,
      },
    ],
  });

const emitEdge = (input: {
  eventId: string;
  sequence: number;
  body: Record<string, unknown>;
  producerState: ReturnType<typeof createTrustStreamProducerState>;
}) => {
  const signers = fixtureSigners();
  const envelope = emitTrustEnvelope({
    signer: signers.sonarPrimary,
    producer: "sonar-api",
    eventId: input.eventId,
    streamId: input.producerState.streamId,
    streamEpoch: input.producerState.streamEpoch,
    sequence: input.sequence,
    trustStream: true,
    issuedAtMs: ISSUED_AT_MS,
    tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
    capability: DEPENDENCY_EDGE_CAPABILITY,
    contract: DEPENDENCY_EDGE_CONTRACT,
    body: input.body,
  });
  return { envelope, nextProducer: advanceTrustStreamProducer(input.producerState) };
};

describe("CR-012A dependency ledger inbox", () => {
  it("closes a derivative when required evidence edges and watermarks are complete", () => {
    const registry = buildRegistry();
    const timeHealth = buildTimeHealth();
    const state = createDependencyLedgerInboxState();
    let producer = createTrustStreamProducerState("sonar.public-capability.v1", 1);

    const rootEdgeId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leafEdgeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    const root = emitEdge({
      eventId: "11111111-1111-4111-8111-111111111111",
      sequence: 1,
      producerState: producer,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "evidence",
        edge_id: rootEdgeId,
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-alpha",
        },
        required_edge_ids: [],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 1,
        },
      },
    });
    producer = root.nextProducer;

    const leaf = emitEdge({
      eventId: "22222222-2222-4222-8222-222222222222",
      sequence: 2,
      producerState: producer,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "evidence",
        edge_id: leafEdgeId,
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-alpha",
        },
        required_edge_ids: [rootEdgeId],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 2,
        },
      },
    });

    for (const envelope of [root.envelope, leaf.envelope]) {
      const result = ingestDependencyEdgeEnvelope({
        envelope,
        pinnedRegistry: registry,
        timeHealth,
        acceptedAtMs: ACCEPTED_AT_MS,
        state,
        intakeContext: "fixture",
      });
      expect(result.kind).toBe("accepted");
    }

    const closure = state.derivatives.get("shared_preparation:prep-alpha");
    expect(closure?.state).toBe("closed");
    expect(closure?.fulfillable).toBe(true);
  });

  it("quarantines on lost required edge and reconciles backfill", () => {
    const registry = buildRegistry();
    const timeHealth = buildTimeHealth();
    const state = createDependencyLedgerInboxState();
    let producer = createTrustStreamProducerState("sonar.public-capability.v1", 1);

    const rootEdgeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const leafEdgeId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    const leafOnly = emitEdge({
      eventId: "33333333-3333-4333-8333-333333333333",
      sequence: 1,
      producerState: producer,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "evidence",
        edge_id: leafEdgeId,
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-beta",
        },
        required_edge_ids: [rootEdgeId],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 1,
        },
      },
    });

    ingestDependencyEdgeEnvelope({
      envelope: leafOnly.envelope,
      pinnedRegistry: registry,
      timeHealth,
      acceptedAtMs: ACCEPTED_AT_MS,
      state,
      intakeContext: "fixture",
    });

    const quarantined = state.derivatives.get("shared_preparation:prep-beta");
    expect(quarantined?.state).toBe("quarantined");
    expect(quarantined?.quarantine_reason).toBe("missing_required_edges");

    const report = reconcileLedger(
      state,
      [
        {
          derivative_key: "shared_preparation:prep-beta",
          expected_edge_ids: [rootEdgeId, leafEdgeId],
        },
      ],
      ACCEPTED_AT_MS,
    );
    expect(report.findings.some((finding) => finding.kind === "lost_edge")).toBe(true);

    const root = emitEdge({
      eventId: "44444444-4444-4444-8444-444444444444",
      sequence: 2,
      producerState: leafOnly.nextProducer,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "evidence",
        edge_id: rootEdgeId,
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-beta",
        },
        required_edge_ids: [],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 2,
        },
      },
    });

    ingestDependencyEdgeEnvelope({
      envelope: root.envelope,
      pinnedRegistry: registry,
      timeHealth,
      acceptedAtMs: ACCEPTED_AT_MS + 1,
      state,
      intakeContext: "fixture",
    });

    const closed = state.derivatives.get("shared_preparation:prep-beta");
    expect(closed?.state).toBe("closed");
    expect(closed?.fulfillable).toBe(true);
  });

  it("accepts duplicated event_id replay idempotently", () => {
    const registry = buildRegistry();
    const timeHealth = buildTimeHealth();
    const state = createDependencyLedgerInboxState();
    const producer = createTrustStreamProducerState("sonar.public-capability.v1", 1);

    const emitted = emitEdge({
      eventId: "55555555-5555-4555-8555-555555555555",
      sequence: 1,
      producerState: producer,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "evidence",
        edge_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        derivative: {
          derivative_kind: "capability_evidence",
          derivative_id: "deploy-gamma",
        },
        required_edge_ids: [],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 1,
        },
      },
    });

    const first = ingestDependencyEdgeEnvelope({
      envelope: emitted.envelope,
      pinnedRegistry: registry,
      timeHealth,
      acceptedAtMs: ACCEPTED_AT_MS,
      state,
      intakeContext: "fixture",
    });
    const second = ingestDependencyEdgeEnvelope({
      envelope: emitted.envelope,
      pinnedRegistry: registry,
      timeHealth,
      acceptedAtMs: ACCEPTED_AT_MS,
      state,
      intakeContext: "fixture",
    });

    expect(first.kind).toBe("accepted");
    expect(second.kind).toBe("accepted");
    if (first.kind === "accepted" && second.kind === "accepted") {
      expect(second.replay).toBe(true);
      expect(second.edge.event_id).toBe(first.edge.event_id);
    }
    expect(state.edgesByEventId.size).toBe(1);
    expect(state.metrics.duplicate_replays).toBeGreaterThan(0);
  });

  it("denies reachable derivatives on signing-key compromise invalidation", () => {
    const registry = buildRegistry();
    const timeHealth = buildTimeHealth();
    const state = createDependencyLedgerInboxState();
    let producer = createTrustStreamProducerState("sonar.public-capability.v1", 1);

    const evidence = emitEdge({
      eventId: "66666666-6666-4666-8666-666666666666",
      sequence: 1,
      producerState: producer,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "evidence",
        edge_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-delta",
        },
        required_edge_ids: [],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 1,
        },
      },
    });
    producer = evidence.nextProducer;

    ingestDependencyEdgeEnvelope({
      envelope: evidence.envelope,
      pinnedRegistry: registry,
      timeHealth,
      acceptedAtMs: ACCEPTED_AT_MS,
      state,
      intakeContext: "fixture",
    });

    const compromise = emitEdge({
      eventId: "77777777-7777-4777-8777-777777777777",
      sequence: 2,
      producerState: producer,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "invalidation",
        edge_id: "88888888-8888-4888-8888-888888888888",
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-delta",
        },
        required_edge_ids: [],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 2,
        },
        invalidation: {
          reason: "signing_key_compromised",
          compromised_signing_key_id: "sonar-fixture-primary",
        },
      },
    });

    ingestDependencyEdgeEnvelope({
      envelope: compromise.envelope,
      pinnedRegistry: registry,
      timeHealth,
      acceptedAtMs: ACCEPTED_AT_MS,
      state,
      intakeContext: "fixture",
    });

    const denied = state.derivatives.get("shared_preparation:prep-delta");
    expect(denied?.state).toBe("denied");
    expect(denied?.fulfillable).toBe(false);
    expect(denied?.denied_reason).toBe("signing_key_compromised");
  });

  it("rejects unsupported schema_minor (mixed-version enforcement)", () => {
    const registry = buildRegistry();
    const timeHealth = buildTimeHealth();
    const state = createDependencyLedgerInboxState();
    const producer = createTrustStreamProducerState("sonar.public-capability.v1", 1);

    const emitted = emitEdge({
      eventId: "99999999-9999-4999-8999-999999999999",
      sequence: 1,
      producerState: producer,
      body: {
        schema_version: 1,
        schema_minor: 99,
        edge_kind: "evidence",
        edge_id: "10101010-1010-4101-8101-101010101010",
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-epsilon",
        },
        required_edge_ids: [],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 1,
        },
      },
    });

    const result = ingestDependencyEdgeEnvelope({
      envelope: emitted.envelope,
      pinnedRegistry: registry,
      timeHealth,
      acceptedAtMs: ACCEPTED_AT_MS,
      state,
      intakeContext: "fixture",
    });

    expect(result.kind).toBe("rejected");
  });
});
