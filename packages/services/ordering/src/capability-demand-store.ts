import { randomUUID } from "node:crypto";

export type CapabilityDemandState = "open" | "supported" | "notified" | "closed" | "declined" | "expired";

export interface CapabilityDemandRecord {
  readonly demand_id: string;
  readonly requester_subject: string;
  readonly community_ref: string;
  readonly deployment_set_digest: string;
  readonly required_capability: string;
  readonly policy_version: string;
  readonly resolution_id: string;
  readonly state: CapabilityDemandState;
  readonly created_at_unix_ms: number;
  readonly updated_at_unix_ms: number;
  readonly idempotency_key: string;
}

export interface CapabilityDemandStore {
  create(input: {
    requester_subject: string;
    community_ref: string;
    deployment_set_digest: string;
    required_capability: string;
    policy_version: string;
    resolution_id: string;
    idempotency_key: string;
    now_ms: number;
  }): Promise<
    | { kind: "created"; record: CapabilityDemandRecord }
    | { kind: "replay"; record: CapabilityDemandRecord }
    | { kind: "conflict" }
  >;
  get(demandId: string): Promise<CapabilityDemandRecord | undefined>;
  list(input: {
    community_ref: string;
    requester_subject: string;
    limit: number;
  }): Promise<ReadonlyArray<CapabilityDemandRecord>>;
  withdraw(input: {
    demand_id: string;
    requester_subject: string;
    community_ref: string;
    now_ms: number;
  }): Promise<CapabilityDemandRecord | undefined>;
}

function canonicalKey(input: {
  requester_subject: string;
  community_ref: string;
  deployment_set_digest: string;
  required_capability: string;
  policy_version: string;
}): string {
  return [
    input.requester_subject,
    input.community_ref,
    input.deployment_set_digest,
    input.required_capability,
    input.policy_version,
  ].join("\0");
}

export class InMemoryCapabilityDemandStore implements CapabilityDemandStore {
  private readonly byId = new Map<string, CapabilityDemandRecord>();
  private readonly openByCanonical = new Map<string, string>();
  private readonly idempotency = new Map<string, CapabilityDemandRecord>();

  async create(input: {
    requester_subject: string;
    community_ref: string;
    deployment_set_digest: string;
    required_capability: string;
    policy_version: string;
    resolution_id: string;
    idempotency_key: string;
    now_ms: number;
  }): Promise<
    | { kind: "created"; record: CapabilityDemandRecord }
    | { kind: "replay"; record: CapabilityDemandRecord }
    | { kind: "conflict" }
  > {
    const idemKey = `${input.requester_subject}\0${input.idempotency_key}`;
    const prior = this.idempotency.get(idemKey);
    if (prior !== undefined) {
      if (
        prior.deployment_set_digest !== input.deployment_set_digest ||
        prior.required_capability !== input.required_capability ||
        prior.policy_version !== input.policy_version ||
        prior.community_ref !== input.community_ref
      ) {
        return { kind: "conflict" };
      }
      return { kind: "replay", record: prior };
    }

    const canonical = canonicalKey(input);
    const existingOpenId = this.openByCanonical.get(canonical);
    if (existingOpenId !== undefined) {
      const existing = this.byId.get(existingOpenId);
      if (existing !== undefined && existing.state === "open") {
        this.idempotency.set(idemKey, existing);
        return { kind: "replay", record: existing };
      }
    }

    const record: CapabilityDemandRecord = {
      demand_id: randomUUID(),
      requester_subject: input.requester_subject,
      community_ref: input.community_ref,
      deployment_set_digest: input.deployment_set_digest,
      required_capability: input.required_capability,
      policy_version: input.policy_version,
      resolution_id: input.resolution_id,
      state: "open",
      created_at_unix_ms: input.now_ms,
      updated_at_unix_ms: input.now_ms,
      idempotency_key: input.idempotency_key,
    };
    this.byId.set(record.demand_id, record);
    this.openByCanonical.set(canonical, record.demand_id);
    this.idempotency.set(idemKey, record);
    return { kind: "created", record };
  }

  async get(demandId: string): Promise<CapabilityDemandRecord | undefined> {
    return this.byId.get(demandId);
  }

  async list(input: {
    community_ref: string;
    requester_subject: string;
    limit: number;
  }): Promise<ReadonlyArray<CapabilityDemandRecord>> {
    const rows = [...this.byId.values()].filter(
      (row) =>
        row.community_ref === input.community_ref &&
        row.requester_subject === input.requester_subject,
    );
    rows.sort((a, b) => b.created_at_unix_ms - a.created_at_unix_ms);
    return rows.slice(0, input.limit);
  }

  async withdraw(input: {
    demand_id: string;
    requester_subject: string;
    community_ref: string;
    now_ms: number;
  }): Promise<CapabilityDemandRecord | undefined> {
    const record = this.byId.get(input.demand_id);
    if (record === undefined) return undefined;
    if (
      record.requester_subject !== input.requester_subject ||
      record.community_ref !== input.community_ref
    ) {
      return undefined;
    }
    if (record.state !== "open") return record;
    const updated: CapabilityDemandRecord = {
      ...record,
      state: "closed",
      updated_at_unix_ms: input.now_ms,
    };
    this.byId.set(updated.demand_id, updated);
    return updated;
  }
}

export function toPublicCapabilityDemandProjection(record: CapabilityDemandRecord) {
  return {
    schema_version: 1 as const,
    demand_id: record.demand_id,
    community_ref: record.community_ref,
    requester_subject: record.requester_subject,
    required_capability: record.required_capability,
    policy_version: record.policy_version,
    resolution_id: record.resolution_id,
    state: record.state,
    created_at_unix_ms: record.created_at_unix_ms,
    updated_at_unix_ms: record.updated_at_unix_ms,
  };
}
