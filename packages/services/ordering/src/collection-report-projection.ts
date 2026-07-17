/**
 * CR-206 — safe collection-report list/detail projections for Dashboard BFF.
 *
 * Redacts raw inputs, digests, refusal internals, and operator audit.
 * User-visible status maps from order lifecycle (sprint CR-202/CR-304 vocabulary).
 */

import type { OrderRecord } from "./store.js";

export type CollectionReportUserStatus =
  | "requested"
  | "preparing_collection_data"
  | "building_report"
  | "ready"
  | "needs_attention";

export type ArtifactAvailability =
  | "none"
  | "available"
  | "expired"
  | "deleted"
  | "quarantined";

export interface CollectionReportListItem {
  readonly schema_version: 1;
  readonly order_id: string;
  readonly community_ref: string;
  readonly resolution_id: string;
  readonly user_status: CollectionReportUserStatus;
  readonly action_needed_code: string | null;
  readonly artifact_availability: ArtifactAvailability;
  readonly open_action: "open_artifact" | null;
  readonly collection_summary: {
    readonly name: string | null;
    readonly symbol: string | null;
  };
  readonly placed_at_unix: number;
  readonly updated_at_unix: number;
  readonly created_at_unix: number;
}

export interface CollectionReportListResponse {
  readonly schema_version: 1;
  readonly items: readonly CollectionReportListItem[];
  readonly next_cursor: string | null;
}

export function mapUserStatus(record: OrderRecord): CollectionReportUserStatus {
  switch (record.state) {
    case "placed":
    case "routing":
      return "requested";
    case "producing": {
      const fulfillment = record.fulfillment as
        | { readonly phase?: string; readonly stage?: string }
        | undefined;
      const phase = fulfillment?.phase ?? fulfillment?.stage ?? "";
      if (
        typeof phase === "string" &&
        (phase.includes("build") || phase.includes("render") || phase.includes("report"))
      ) {
        return "building_report";
      }
      return "preparing_collection_data";
    }
    case "fulfilled":
      return "ready";
    case "failed":
      return "needs_attention";
    default: {
      const _exhaustive: never = record.state;
      return _exhaustive;
    }
  }
}

export function mapArtifactAvailability(record: OrderRecord): ArtifactAvailability {
  if (record.state !== "fulfilled") return "none";
  if (typeof record.result_ref === "string" && record.result_ref.length > 0) {
    return "available";
  }
  // Fulfilled without a retrievable artifact — history stays, open is withheld.
  return "expired";
}

export function mapActionNeeded(record: OrderRecord): string | null {
  if (record.state === "failed") {
    const refusal = record.refusal as { readonly code?: string } | undefined;
    if (typeof refusal?.code === "string" && refusal.code.length > 0) {
      return refusal.code;
    }
    return "needs_attention";
  }
  return null;
}

export function toCollectionReportListItem(
  record: OrderRecord,
  collection: { readonly name: string | null; readonly symbol: string | null } = {
    name: null,
    symbol: null,
  },
): CollectionReportListItem | null {
  if (record.product !== "collection-report") return null;
  const inputs = record.inputs as {
    readonly community_ref?: unknown;
    readonly resolution_id?: unknown;
  };
  if (typeof inputs.community_ref !== "string" || inputs.community_ref.length === 0) {
    return null;
  }
  if (typeof inputs.resolution_id !== "string" || inputs.resolution_id.length === 0) {
    return null;
  }

  const artifact_availability = mapArtifactAvailability(record);
  return {
    schema_version: 1,
    order_id: record.order_id,
    community_ref: inputs.community_ref,
    resolution_id: inputs.resolution_id,
    user_status: mapUserStatus(record),
    action_needed_code: mapActionNeeded(record),
    artifact_availability,
    open_action: artifact_availability === "available" ? "open_artifact" : null,
    collection_summary: {
      name: collection.name,
      symbol: collection.symbol,
    },
    placed_at_unix: record.placed_at_unix,
    updated_at_unix: record.updated_at_unix,
    created_at_unix: record.created_at_unix,
  };
}

export function encodeCursor(createdAtUnix: number, orderId: string): string {
  return Buffer.from(`${createdAtUnix}:${orderId}`, "utf8").toString("base64url");
}

export function decodeCursor(
  raw: string | undefined,
): { readonly created_at_unix: number; readonly order_id: string } | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const sep = decoded.indexOf(":");
    if (sep <= 0) return undefined;
    const created = Number(decoded.slice(0, sep));
    const orderId = decoded.slice(sep + 1);
    if (!Number.isSafeInteger(created) || created < 0 || orderId.length === 0) {
      return undefined;
    }
    return { created_at_unix: created, order_id: orderId };
  } catch {
    return undefined;
  }
}
