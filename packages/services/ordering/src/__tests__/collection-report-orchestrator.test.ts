import { describe, expect, it } from "vitest";
import { ORDER_LIFECYCLE_SUBJECTS } from "@freeside/ordering-protocol";

import { CollectionReportOrchestrator } from "../collection-report-orchestrator.js";
import { OrderOrchestrator } from "../orchestrator.js";
import { InMemoryOrderStore } from "../store.js";
import { ConfigCapabilityResolver } from "../resolver.js";
import type { AuditPort } from "../audit-acl.js";
import type { Cta } from "@freeside/shadow-audit-protocol";

const CTA: Cta = {
  product: "https://example.test/audit",
  conversation: "https://example.test/talk",
};

function digest() {
  return {
    algorithm: "sha-256" as const,
    domain: "collection-resolution.candidate-snapshot",
    major_version: 1,
    digest: "ab".repeat(32),
  };
}

class NoopAudit implements AuditPort {
  async invoke() {
    return {
      ok: true as const,
      output: {} as never,
      uncertain: false,
      unmatchedRoleHolders: 0,
    };
  }
}

describe("CollectionReportOrchestrator", () => {
  it("drives placed → producing and holds (no fake fulfill / no invalid-inputs)", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_500 });
    await store.placeOrder(
      {
        order_id: "cr-ord-1",
        product: "collection-report",
        placed_by: "user-a",
        inputs: {
          schema_version: 1,
          resolution_id: "res-1",
          candidate_snapshot_digest: digest(),
          community_ref: "mibera",
        },
        placed_at_unix: 1_700_000_500,
        inputs_digest: "digest",
      },
      {
        subject: ORDER_LIFECYCLE_SUBJECTS.placed,
        payload: { order_id: "cr-ord-1" },
      },
    );

    const orch = new CollectionReportOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver({
        "collection-index": {
          building: "sonar-api",
          endpoint: "http://sonar.internal",
        },
      }),
      now: () => 1_700_000_500_000,
    });

    const result = await orch.process("cr-ord-1", (await store.get("cr-ord-1"))!);
    expect(result.success).toBe(true);
    const record = await store.get("cr-ord-1");
    expect(record?.state).toBe("producing");
    expect(record?.refusal).toBeUndefined();
  });

  it("OrderOrchestrator dispatches collection-report away from access-risk path", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_600 });
    await store.placeOrder(
      {
        order_id: "cr-ord-2",
        product: "collection-report",
        placed_by: "user-a",
        inputs: {
          schema_version: 1,
          resolution_id: "res-2",
          candidate_snapshot_digest: digest(),
          community_ref: "mibera",
        },
        placed_at_unix: 1_700_000_600,
        inputs_digest: "digest",
      },
      {
        subject: ORDER_LIFECYCLE_SUBJECTS.placed,
        payload: { order_id: "cr-ord-2" },
      },
    );

    const orchestrator = new OrderOrchestrator({
      store,
      resolver: new ConfigCapabilityResolver({
        "collection-index": {
          building: "sonar-api",
          endpoint: "http://sonar.internal",
        },
      }),
      audit: new NoopAudit(),
      communities: () => undefined,
      cta: CTA,
      now: () => 1_700_000_600_000,
    });

    const result = await orchestrator.process("cr-ord-2");
    expect(result.success).toBe(true);
    const record = await store.get("cr-ord-2");
    expect(record?.state).toBe("producing");
    expect(record?.refusal?.code).toBeUndefined();
  });
});
