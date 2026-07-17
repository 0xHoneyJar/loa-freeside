import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { mountCollectionReportRoutes } from "../collection-report-http.js";
import { InMemoryOrderStore } from "../store.js";
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
    created_at_unix?: number;
  },
) {
  const placed_at = opts.created_at_unix ?? 1_700_000_000;
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
      placed_at_unix: placed_at,
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

  // Force created_at for cursor ordering when requested.
  if (opts.created_at_unix !== undefined) {
    const record = await store.get(opts.order_id);
    if (record) {
      (record as { created_at_unix: number }).created_at_unix = opts.created_at_unix;
    }
  }
}

function appWith(store: InMemoryOrderStore) {
  const app = new Hono();
  mountCollectionReportRoutes(app, { store, serviceToken: TOKEN });
  return app;
}

describe("CR-206 collection-report HTTP", () => {
  it("requires bearer token", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const app = appWith(store);
    const res = await app.request(
      "/v1/collection-reports?community_ref=mibera&subject_id=user-a",
    );
    expect(res.status).toBe(401);
  });

  it("lists only the subject+community rows with safe projection", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    await seed(store, {
      order_id: "ord-a",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "fulfilled",
      created_at_unix: 100,
    });
    await seed(store, {
      order_id: "ord-b",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "placed",
      created_at_unix: 90,
    });
    await seed(store, {
      order_id: "ord-other-user",
      placed_by: "user-b",
      community_ref: "mibera",
      state: "placed",
      created_at_unix: 110,
    });
    await seed(store, {
      order_id: "ord-other-community",
      placed_by: "user-a",
      community_ref: "other",
      state: "placed",
      created_at_unix: 120,
    });

    const app = appWith(store);
    const res = await app.request(
      "/v1/collection-reports?community_ref=mibera&subject_id=user-a&limit=10",
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        order_id: string;
        user_status: string;
        open_action: string | null;
        placed_by?: string;
        inputs?: unknown;
      }>;
      next_cursor: string | null;
    };
    expect(body.items.map((i) => i.order_id)).toEqual(["ord-a", "ord-b"]);
    expect(body.items[0]?.user_status).toBe("ready");
    expect(body.items[0]?.open_action).toBe("open_artifact");
    expect(body.items[1]?.user_status).toBe("requested");
    expect(body.items[0]).not.toHaveProperty("placed_by");
    expect(body.items[0]).not.toHaveProperty("inputs");
  });

  it("denies cross-subject detail", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    await seed(store, {
      order_id: "ord-a",
      placed_by: "user-a",
      community_ref: "mibera",
      state: "placed",
    });
    const app = appWith(store);
    const res = await app.request(
      "/v1/collection-reports/ord-a?community_ref=mibera&subject_id=user-b",
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(403);
  });

  it("pages with immutable created_at+order_id cursor", async () => {
    const store = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    await seed(store, {
      order_id: "ord-3",
      placed_by: "user-a",
      community_ref: "mibera",
      created_at_unix: 30,
    });
    await seed(store, {
      order_id: "ord-2",
      placed_by: "user-a",
      community_ref: "mibera",
      created_at_unix: 20,
    });
    await seed(store, {
      order_id: "ord-1",
      placed_by: "user-a",
      community_ref: "mibera",
      created_at_unix: 10,
    });

    const app = appWith(store);
    const page1 = await app.request(
      "/v1/collection-reports?community_ref=mibera&subject_id=user-a&limit=2",
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    const body1 = (await page1.json()) as {
      items: Array<{ order_id: string }>;
      next_cursor: string;
    };
    expect(body1.items.map((i) => i.order_id)).toEqual(["ord-3", "ord-2"]);
    expect(body1.next_cursor).toBeTruthy();

    const page2 = await app.request(
      `/v1/collection-reports?community_ref=mibera&subject_id=user-a&limit=2&cursor=${encodeURIComponent(body1.next_cursor)}`,
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    const body2 = (await page2.json()) as {
      items: Array<{ order_id: string }>;
      next_cursor: string | null;
    };
    expect(body2.items.map((i) => i.order_id)).toEqual(["ord-1"]);
    expect(body2.next_cursor).toBeNull();
  });
});
