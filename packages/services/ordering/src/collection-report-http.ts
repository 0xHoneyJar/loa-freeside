/**
 * CR-206 — authenticated collection-report list/detail HTTP edge.
 *
 *   GET /v1/collection-reports
 *   GET /v1/collection-reports/:order_id
 *
 * Auth: Bearer SERVICE_TOKEN (Dashboard BFF). Authorization scope is supplied
 * in the query string and re-checked against community_ref (never trusted alone).
 *
 * Deferred vs full CR-206: identity-row paging, encrypted export, CR-015
 * disclosure fences, artifact byte retrieval + audit. This cut unblocks
 * Dashboard CR-304 table + detail status projections.
 */

import { Hono, type Context } from "hono";
import { z } from "zod";

import type { OrderStore } from "./store.js";
import type { ResolutionStore } from "./resolution-store.js";
import {
  decodeCursor,
  encodeCursor,
  toCollectionReportListItem,
  type CollectionReportListItem,
  type CollectionReportListResponse,
} from "./collection-report-projection.js";

export interface CollectionReportHttpDeps {
  readonly store: OrderStore;
  readonly resolutionStore?: ResolutionStore;
  readonly serviceToken?: string;
}

const ScopeQuerySchema = z
  .object({
    community_ref: z.string().min(1).max(128),
    subject_id: z.string().min(1).max(256),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

function requireBearer(c: Context, token: string | undefined): boolean {
  if (!token) return true;
  return c.req.header("authorization") === `Bearer ${token}`;
}

function errorJson(
  c: Context,
  status: 400 | 401 | 403 | 404,
  code: string,
): Response {
  return c.json(
    { schema_version: 1, code },
    status,
    { "Cache-Control": "no-store" },
  );
}

async function collectionSummary(
  resolutionStore: ResolutionStore | undefined,
  resolutionId: string,
): Promise<{ name: string | null; symbol: string | null }> {
  if (!resolutionStore || resolutionId.length === 0) {
    return { name: null, symbol: null };
  }
  try {
    const record = await resolutionStore.get(resolutionId);
    if (!record) return { name: null, symbol: null };
    const selectedDigest = record.selected_collection_id?.digest;
    const candidates = record.candidate_snapshot.candidates;
    const match =
      selectedDigest !== undefined
        ? (candidates.find((c) => c.identity.collection_id.digest === selectedDigest) ??
          candidates[0])
        : candidates[0];
    return {
      name: match?.identity.name ?? null,
      symbol: match?.identity.symbol ?? null,
    };
  } catch {
    return { name: null, symbol: null };
  }
}

export function mountCollectionReportRoutes(
  app: Hono,
  deps: CollectionReportHttpDeps,
): void {
  app.get("/v1/collection-reports", async (c) => {
    if (!requireBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }

    const parsed = ScopeQuerySchema.safeParse({
      community_ref: c.req.query("community_ref"),
      subject_id: c.req.query("subject_id"),
      cursor: c.req.query("cursor") ?? undefined,
      limit: c.req.query("limit") ?? undefined,
    });
    if (!parsed.success) {
      return errorJson(c, 400, "invalid_request");
    }

    const cursor = decodeCursor(parsed.data.cursor);
    if (parsed.data.cursor !== undefined && cursor === undefined) {
      return errorJson(c, 400, "invalid_request");
    }

    const limit = parsed.data.limit ?? 25;
    const rows = await deps.store.listCollectionReports({
      community_ref: parsed.data.community_ref,
      placed_by: parsed.data.subject_id,
      limit: limit + 1,
      ...(cursor !== undefined ? { cursor } : {}),
    });

    const page = rows.slice(0, limit);
    const items: CollectionReportListItem[] = [];
    for (const row of page) {
      const inputs = row.inputs as { resolution_id?: string };
      const summary = await collectionSummary(
        deps.resolutionStore,
        typeof inputs.resolution_id === "string" ? inputs.resolution_id : "",
      );
      const item = toCollectionReportListItem(row, summary);
      if (item) items.push(item);
    }

    const last = page[page.length - 1];
    const next_cursor =
      rows.length > limit && last !== undefined
        ? encodeCursor(last.created_at_unix, last.order_id)
        : null;

    const body: CollectionReportListResponse = {
      schema_version: 1,
      items,
      next_cursor,
    };
    return c.json(body, 200, { "Cache-Control": "no-store" });
  });

  app.get("/v1/collection-reports/:order_id", async (c) => {
    if (!requireBearer(c, deps.serviceToken)) {
      return errorJson(c, 401, "unauthorized");
    }

    const community_ref = c.req.query("community_ref");
    const subject_id = c.req.query("subject_id");
    if (
      typeof community_ref !== "string" ||
      community_ref.length === 0 ||
      typeof subject_id !== "string" ||
      subject_id.length === 0
    ) {
      return errorJson(c, 400, "invalid_request");
    }

    const record = await deps.store.get(c.req.param("order_id"));
    if (!record || record.product !== "collection-report") {
      return errorJson(c, 404, "not_found");
    }
    if (record.placed_by !== subject_id) {
      return errorJson(c, 403, "forbidden");
    }
    const inputs = record.inputs as { community_ref?: unknown; resolution_id?: unknown };
    if (inputs.community_ref !== community_ref) {
      return errorJson(c, 403, "forbidden");
    }

    const summary = await collectionSummary(
      deps.resolutionStore,
      typeof inputs.resolution_id === "string" ? inputs.resolution_id : "",
    );
    const item = toCollectionReportListItem(record, summary);
    if (!item) return errorJson(c, 404, "not_found");
    return c.json(item, 200, { "Cache-Control": "no-store" });
  });
}
