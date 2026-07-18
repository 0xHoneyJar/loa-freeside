import { describe, expect, it } from "vitest";
import {
  advanceTrustStreamProducer,
  createTrustStreamProducerState,
  emitTrustEnvelope,
  fixtureSigners,
  FIXTURE_TENANT_SCOPE_DIGEST,
} from "@freeside/trust-envelope-protocol";
import {
  DEPENDENCY_EDGE_CAPABILITY,
  DEPENDENCY_EDGE_CONTRACT,
} from "@freeside/dependency-ledger-protocol";
import {
  createFixtureDependencyLedgerService,
} from "../dependency-ledger-service.js";
import { InMemoryDependencyLedgerStore } from "../dependency-ledger-store.js";

describe("CR-012A Ordering dependency ledger service", () => {
  it("ingests signed dependency edges through CR-009 + CR-013 intake chain", () => {
    const store = new InMemoryDependencyLedgerStore();
    const service = createFixtureDependencyLedgerService(store, () =>
      Date.parse("2026-07-17T21:00:01.000Z"),
    );
    const signers = fixtureSigners();
    let producer = createTrustStreamProducerState("sonar.public-capability.v1", 1);

    const envelope = emitTrustEnvelope({
      signer: signers.sonarPrimary,
      producer: "sonar-api",
      eventId: "12121212-1212-4121-8121-121212121212",
      streamId: producer.streamId,
      streamEpoch: producer.streamEpoch,
      sequence: producer.nextSequence,
      trustStream: true,
      issuedAtMs: Date.parse("2026-07-17T21:00:00.000Z"),
      tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
      capability: DEPENDENCY_EDGE_CAPABILITY,
      contract: DEPENDENCY_EDGE_CONTRACT,
      body: {
        schema_version: 1,
        schema_minor: 0,
        edge_kind: "evidence",
        edge_id: "13131313-1313-4131-8131-131313131313",
        derivative: {
          derivative_kind: "shared_preparation",
          derivative_id: "prep-ordering",
        },
        required_edge_ids: [],
        source_watermark: {
          stream_id: "sonar.public-capability.v1",
          stream_epoch: 1,
          sequence: 1,
        },
      },
    });
    producer = advanceTrustStreamProducer(producer);

    const result = service.ingestEnvelope(envelope);
    expect(result.kind).toBe("accepted");
    const closure = service.getDerivative("shared_preparation:prep-ordering");
    expect(closure?.state).toBe("closed");
    expect(closure?.fulfillable).toBe(true);
  });

  it("surfaces quarantine metrics without claiming G1B-1 producer replay", () => {
    const store = new InMemoryDependencyLedgerStore();
    const service = createFixtureDependencyLedgerService(store);
    const metrics = service.metrics();
    expect(metrics.quarantined_derivatives).toBe(0);
    expect(metrics.closed_derivatives).toBe(0);
  });
});
