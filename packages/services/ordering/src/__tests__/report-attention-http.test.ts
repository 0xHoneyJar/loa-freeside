import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { mountCollectionReportRoutes } from "../collection-report-http.js";
import { mountReportAttentionRoutes } from "../report-attention-http.js";
import { InMemoryOrderStore } from "../store.js";
import { InMemoryReportAttentionStore } from "../report-attention-store.js";
import { ORDER_LIFECYCLE_SUBJECTS } from "@freeside/ordering-protocol";

const TOKEN = "test-service-token";

function digest() {
  return {
    algorithm: "sha-256" as const,
    domain: "collection-resolution.candidate-snapshot",
    major_version: 1,
    digest: "ab".repeat(32),
  };
}

async function seed(
  store: InMemoryOrderStore,
  opts: {
    order_id: string;
    placed_by: string;
    community_ref: string;
    state?: "placed" | "producing" | "fulfilled" | "failed";
  },
) {
  await store.placeOrder(
    {
      order_id: opts.order_id,
      product: "collection-report",
      placed_by: opts.placed_by,
      inputs: {
        schema_version: 1,
        resolution_id: `res-${opts.order_id}`,
        candidate_snapshot_digest: digest(),
        community_ref: opts.community_ref,
      },
      placed_at_unix: 1_700_000_000,
      inputs_digest: "digest",
    },
    { subject: ORDER_LIFECYCLE_SUBJECTS.placed, payload: { order_id: opts.order_id } },
  );

  if (opts.state === "producing" || opts.state === "fulfilled" || opts.state === "failed") {
    await store.transition(opts.order_id, "placed", "routing");
    await store.transition(opts.order_id, "routing", "producing");
  }
  if (opts.state === "fulfilled") {
    await store.transition(opts.order_id, "producing", "fulfilled", {
      patch: { result_ref: `artifact://${opts.order_id}` },
    });
  }
  if (opts.state === "failed") {
    await store.transition(opts.order_id, "producing", "failed", {
      patch: { refusal: { code: "capacity_rejected", reason: "full" } },
    });
  }
}

function appWith(
  store: InMemoryOrderStore,
  attention: InMemoryReportAttentionStore,
) {
  const app = new Hono();
  mountCollectionReportRoutes(app, {
    store,
    attentionStore: attention,
    serviceToken: TOKEN,
  });
  mountReportAttentionRoutes(app, {
    store,
    attentionStore: attention,
    serviceToken: TOKEN,
  });
  return app;
}

describe("CR-305 report attention", () => {
  it("routine progress has null attention_kind and unseen false", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_100 });
    const attention = new InMemoryReportAttentionStore({ now: () => 1_700_000_100 });
    await seed(store, {
      order_id: "ord-req",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "placed",
    });
    await seed(store, {
      order_id: "ord-prep",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "producing",
    });

    const app = appWith(store, attention);
    const res = await app.request(
      "/v1/collection-reports?community_ref=mibera&subject_id=user-a",
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    const body = (await res.json()) as {
      items: Array<{
        order_id: string;
        attention_kind: string | null;
        attention_unseen: boolean;
      }>;
    };
    for (const item of body.items) {
      expect(item.attention_kind).toBeNull();
      expect(item.attention_unseen).toBe(false);
    }
  });

  it("ready/failed produce attention kinds and mark-seen clears unseen", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_200 });
    const attention = new InMemoryReportAttentionStore({ now: () => 1_700_000_200 });
    await seed(store, {
      order_id: "ord-ready",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "fulfilled",
    });
    await seed(store, {
      order_id: "ord-fail",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "failed",
    });

    const app = appWith(store, attention);
    const list1 = await app.request(
      "/v1/collection-reports?community_ref=mibera&subject_id=user-a",
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    const body1 = (await list1.json()) as {
      items: Array<{
        order_id: string;
        attention_kind: string | null;
        attention_unseen: boolean;
        transition_sequence: number;
      }>;
    };
    const ready = body1.items.find((i) => i.order_id === "ord-ready");
    const failed = body1.items.find((i) => i.order_id === "ord-fail");
    expect(ready?.attention_kind).toBe("report.ready");
    expect(ready?.attention_unseen).toBe(true);
    expect(failed?.attention_kind).toBe("report.needs_attention");
    expect(failed?.attention_unseen).toBe(true);

    const seen = await app.request(
      `/v1/report-attention/collection_report_order/ord-ready/${ready!.transition_sequence}/seen`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ subject_id: "user-a", community_ref: "mibera" }),
      },
    );
    expect(seen.status).toBe(200);

    // Idempotent replay
    const seen2 = await app.request(
      `/v1/report-attention/collection_report_order/ord-ready/${ready!.transition_sequence}/seen`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ subject_id: "user-a", community_ref: "mibera" }),
      },
    );
    expect(seen2.status).toBe(200);

    const list2 = await app.request(
      "/v1/collection-reports?community_ref=mibera&subject_id=user-a",
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    const body2 = (await list2.json()) as {
      items: Array<{ order_id: string; attention_unseen: boolean }>;
    };
    expect(body2.items.find((i) => i.order_id === "ord-ready")?.attention_unseen).toBe(
      false,
    );
    expect(body2.items.find((i) => i.order_id === "ord-fail")?.attention_unseen).toBe(
      true,
    );
  });

  it("denies cross-subject mark-seen", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_300 });
    const attention = new InMemoryReportAttentionStore({ now: () => 1_700_000_300 });
    await seed(store, {
      order_id: "ord-a",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "fulfilled",
    });
    const record = await store.get("ord-a");
    const seq = record!.updated_at_unix;
    const app = appWith(store, attention);
    const res = await app.request(
      `/v1/report-attention/collection_report_order/ord-a/${seq}/seen`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ subject_id: "user-b", community_ref: "mibera" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("requires bearer for mark-seen", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_400 });
    const attention = new InMemoryReportAttentionStore();
    const app = appWith(store, attention);
    const res = await app.request(
      "/v1/report-attention/collection_report_order/ord-x/1/seen",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject_id: "user-a", community_ref: "mibera" }),
      },
    );
    expect(res.status).toBe(401);
  });
});
