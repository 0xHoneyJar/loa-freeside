import type { CapabilityDemandRecord, CapabilityDemandState } from "./capability-demand-store.js";

/** Reports-facing support row — never a report order or Preparing state. */
export type SupportRequestUserStatus =
  | "open"
  | "support_ready"
  | "withdrawn"
  | "declined"
  | "expired";

export interface SupportRequestListItem {
  readonly schema_version: 1;
  readonly row_kind: "support_request";
  readonly demand_id: string;
  readonly community_ref: string;
  readonly requester_subject: string;
  readonly required_capability: string;
  readonly policy_version: string;
  readonly resolution_id: string;
  readonly network_ref: string;
  readonly token_standard: string;
  readonly deployment_set_digest: string;
  readonly lifecycle_state: CapabilityDemandState;
  readonly user_status: SupportRequestUserStatus;
  readonly transition_sequence: number;
  readonly created_at_unix_ms: number;
  readonly updated_at_unix_ms: number;
  readonly expires_at_unix_ms: number;
}

export interface CapabilityDemandTriageBucket {
  readonly network_ref: string;
  readonly token_standard: string;
  readonly deployment_set_digest: string;
  readonly required_capability: string;
  readonly unique_open_demand_count: number;
}

export interface CapabilityDemandTriageAggregate {
  readonly schema_version: 1;
  readonly generated_at_unix_ms: number;
  readonly buckets: readonly CapabilityDemandTriageBucket[];
}

export function mapSupportRequestUserStatus(
  state: CapabilityDemandState,
): SupportRequestUserStatus {
  switch (state) {
    case "open":
      return "open";
    case "supported":
    case "notified":
      return "support_ready";
    case "closed":
      return "withdrawn";
    case "declined":
      return "declined";
    case "expired":
      return "expired";
    default: {
      const _exhaustive: never = state;
      return _exhaustive;
    }
  }
}

export function toSupportRequestListItem(
  record: CapabilityDemandRecord,
): SupportRequestListItem {
  return {
    schema_version: 1,
    row_kind: "support_request",
    demand_id: record.demand_id,
    community_ref: record.community_ref,
    requester_subject: record.requester_subject,
    required_capability: record.required_capability,
    policy_version: record.policy_version,
    resolution_id: record.resolution_id,
    network_ref: record.network_ref,
    token_standard: record.token_standard,
    deployment_set_digest: record.deployment_set_digest,
    lifecycle_state: record.state,
    user_status: mapSupportRequestUserStatus(record.state),
    transition_sequence: record.transition_sequence,
    created_at_unix_ms: record.created_at_unix_ms,
    updated_at_unix_ms: record.updated_at_unix_ms,
    expires_at_unix_ms: record.expires_at_unix_ms,
  };
}

export function buildTriageAggregate(
  records: readonly CapabilityDemandRecord[],
  now_ms: number,
): CapabilityDemandTriageAggregate {
  const open = records.filter((row) => row.state === "open");
  const bucketMap = new Map<string, CapabilityDemandTriageBucket>();
  for (const row of open) {
    const key = [
      row.network_ref,
      row.token_standard,
      row.deployment_set_digest,
      row.required_capability,
    ].join("\0");
    const existing = bucketMap.get(key);
    if (existing !== undefined) {
      bucketMap.set(key, {
        ...existing,
        unique_open_demand_count: existing.unique_open_demand_count + 1,
      });
    } else {
      bucketMap.set(key, {
        network_ref: row.network_ref,
        token_standard: row.token_standard,
        deployment_set_digest: row.deployment_set_digest,
        required_capability: row.required_capability,
        unique_open_demand_count: 1,
      });
    }
  }
  const buckets = [...bucketMap.values()].sort((a, b) => {
    const byNetwork = a.network_ref.localeCompare(b.network_ref);
    if (byNetwork !== 0) return byNetwork;
    const byStandard = a.token_standard.localeCompare(b.token_standard);
    if (byStandard !== 0) return byStandard;
    return a.deployment_set_digest.localeCompare(b.deployment_set_digest);
  });
  return {
    schema_version: 1,
    generated_at_unix_ms: now_ms,
    buckets,
  };
}

export function toPublicCapabilityDemandProjection(record: CapabilityDemandRecord) {
  return toSupportRequestListItem(record);
}
