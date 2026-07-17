import { randomUUID } from "node:crypto";

import {
  OPEN_DEMAND_LIMIT_PER_COMMUNITY,
  OPEN_DEMAND_LIMIT_PER_SUBJECT,
  OPEN_DEMAND_TTL_MS,
} from "./capability-demand-constants.js";
import {
  buildCapabilityDemandSupportedIntent,
  type CapabilityDemandAttentionIntent,
} from "./capability-demand-intent.js";

export type CapabilityDemandState =
  | "open"
  | "supported"
  | "notified"
  | "closed"
  | "declined"
  | "expired";

export interface CapabilityDemandRecord {
  readonly demand_id: string;
  readonly requester_subject: string;
  readonly community_ref: string;
  readonly deployment_set_digest: string;
  readonly network_ref: string;
  readonly token_standard: string;
  readonly required_capability: string;
  readonly policy_version: string;
  readonly resolution_id: string;
  readonly state: CapabilityDemandState;
  readonly transition_sequence: number;
  readonly created_at_unix_ms: number;
  readonly updated_at_unix_ms: number;
  readonly expires_at_unix_ms: number;
  readonly idempotency_key: string;
  readonly support_intent_id: string | null;
}

export interface CapabilityDemandStore {
  create(input: {
    requester_subject: string;
    community_ref: string;
    deployment_set_digest: string;
    network_ref: string;
    token_standard: string;
    required_capability: string;
    policy_version: string;
    resolution_id: string;
    idempotency_key: string;
    now_ms: number;
  }): Promise<
    | { kind: "created"; record: CapabilityDemandRecord }
    | { kind: "replay"; record: CapabilityDemandRecord }
    | { kind: "conflict" }
    | { kind: "quota_exceeded"; limit: "subject" | "community" }
  >;
  get(demandId: string): Promise<CapabilityDemandRecord | undefined>;
  list(input: {
    community_ref: string;
    requester_subject: string;
    limit: number;
    now_ms: number;
  }): Promise<ReadonlyArray<CapabilityDemandRecord>>;
  listOpenForTriage(now_ms: number): Promise<ReadonlyArray<CapabilityDemandRecord>>;
  withdraw(input: {
    demand_id: string;
    requester_subject: string;
    community_ref: string;
    now_ms: number;
  }): Promise<CapabilityDemandRecord | undefined>;
  applyCapabilitySupport(input: {
    required_capability: string;
    deployment_set_digest: string;
    network_ref: string;
    token_standard: string;
    event_id: string;
    now_ms: number;
  }): Promise<{
    transitioned: ReadonlyArray<CapabilityDemandRecord>;
    intents: ReadonlyArray<CapabilityDemandAttentionIntent>;
    replay: boolean;
  }>;
  decline(input: {
    demand_id: string;
    now_ms: number;
  }): Promise<CapabilityDemandRecord | undefined>;
  listIntents(): Promise<ReadonlyArray<CapabilityDemandAttentionIntent>>;
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

function isOpenForQuota(state: CapabilityDemandState): boolean {
  return state === "open";
}

export class InMemoryCapabilityDemandStore implements CapabilityDemandStore {
  private readonly byId = new Map<string, CapabilityDemandRecord>();
  private readonly openByCanonical = new Map<string, string>();
  private readonly idempotency = new Map<string, CapabilityDemandRecord>();
  private readonly supportEvents = new Map<string, CapabilityDemandAttentionIntent[]>();
  private readonly intents = new Map<string, CapabilityDemandAttentionIntent>();

  private expireOpenDemands(now_ms: number): void {
    for (const record of this.byId.values()) {
      if (record.state !== "open") continue;
      if (now_ms < record.expires_at_unix_ms) continue;
      const updated: CapabilityDemandRecord = {
        ...record,
        state: "expired",
        transition_sequence: record.transition_sequence + 1,
        updated_at_unix_ms: now_ms,
      };
      this.byId.set(updated.demand_id, updated);
      this.openByCanonical.delete(
        canonicalKey({
          requester_subject: record.requester_subject,
          community_ref: record.community_ref,
          deployment_set_digest: record.deployment_set_digest,
          required_capability: record.required_capability,
          policy_version: record.policy_version,
        }),
      );
    }
  }

  private countOpenForSubject(subject: string, now_ms: number): number {
    this.expireOpenDemands(now_ms);
    let count = 0;
    for (const row of this.byId.values()) {
      if (row.requester_subject === subject && isOpenForQuota(row.state)) count += 1;
    }
    return count;
  }

  private countOpenForCommunity(community: string, now_ms: number): number {
    this.expireOpenDemands(now_ms);
    let count = 0;
    for (const row of this.byId.values()) {
      if (row.community_ref === community && isOpenForQuota(row.state)) count += 1;
    }
    return count;
  }

  async create(input: {
    requester_subject: string;
    community_ref: string;
    deployment_set_digest: string;
    network_ref: string;
    token_standard: string;
    required_capability: string;
    policy_version: string;
    resolution_id: string;
    idempotency_key: string;
    now_ms: number;
  }): Promise<
    | { kind: "created"; record: CapabilityDemandRecord }
    | { kind: "replay"; record: CapabilityDemandRecord }
    | { kind: "conflict" }
    | { kind: "quota_exceeded"; limit: "subject" | "community" }
  > {
    this.expireOpenDemands(input.now_ms);

    const idemKey = `${input.requester_subject}\0${input.idempotency_key}`;
    const prior = this.idempotency.get(idemKey);
    if (prior !== undefined) {
      if (
        prior.deployment_set_digest !== input.deployment_set_digest ||
        prior.required_capability !== input.required_capability ||
        prior.policy_version !== input.policy_version ||
        prior.community_ref !== input.community_ref ||
        prior.network_ref !== input.network_ref ||
        prior.token_standard !== input.token_standard
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

    if (this.countOpenForSubject(input.requester_subject, input.now_ms) >= OPEN_DEMAND_LIMIT_PER_SUBJECT) {
      return { kind: "quota_exceeded", limit: "subject" };
    }
    if (this.countOpenForCommunity(input.community_ref, input.now_ms) >= OPEN_DEMAND_LIMIT_PER_COMMUNITY) {
      return { kind: "quota_exceeded", limit: "community" };
    }

    const record: CapabilityDemandRecord = {
      demand_id: randomUUID(),
      requester_subject: input.requester_subject,
      community_ref: input.community_ref,
      deployment_set_digest: input.deployment_set_digest,
      network_ref: input.network_ref,
      token_standard: input.token_standard,
      required_capability: input.required_capability,
      policy_version: input.policy_version,
      resolution_id: input.resolution_id,
      state: "open",
      transition_sequence: 1,
      created_at_unix_ms: input.now_ms,
      updated_at_unix_ms: input.now_ms,
      expires_at_unix_ms: input.now_ms + OPEN_DEMAND_TTL_MS,
      idempotency_key: input.idempotency_key,
      support_intent_id: null,
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
    now_ms: number;
  }): Promise<ReadonlyArray<CapabilityDemandRecord>> {
    this.expireOpenDemands(input.now_ms);
    const rows = [...this.byId.values()].filter(
      (row) =>
        row.community_ref === input.community_ref &&
        row.requester_subject === input.requester_subject,
    );
    rows.sort((a, b) => b.created_at_unix_ms - a.created_at_unix_ms);
    return rows.slice(0, input.limit);
  }

  async listOpenForTriage(now_ms: number): Promise<ReadonlyArray<CapabilityDemandRecord>> {
    this.expireOpenDemands(now_ms);
    return [...this.byId.values()].filter((row) => row.state === "open");
  }

  async withdraw(input: {
    demand_id: string;
    requester_subject: string;
    community_ref: string;
    now_ms: number;
  }): Promise<CapabilityDemandRecord | undefined> {
    this.expireOpenDemands(input.now_ms);
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
      transition_sequence: record.transition_sequence + 1,
      updated_at_unix_ms: input.now_ms,
    };
    this.byId.set(updated.demand_id, updated);
    this.openByCanonical.delete(
      canonicalKey({
        requester_subject: record.requester_subject,
        community_ref: record.community_ref,
        deployment_set_digest: record.deployment_set_digest,
        required_capability: record.required_capability,
        policy_version: record.policy_version,
      }),
    );
    return updated;
  }

  async applyCapabilitySupport(input: {
    required_capability: string;
    deployment_set_digest: string;
    network_ref: string;
    token_standard: string;
    event_id: string;
    now_ms: number;
  }): Promise<{
    transitioned: ReadonlyArray<CapabilityDemandRecord>;
    intents: ReadonlyArray<CapabilityDemandAttentionIntent>;
    replay: boolean;
  }> {
    this.expireOpenDemands(input.now_ms);

    const priorIntents = this.supportEvents.get(input.event_id);
    if (priorIntents !== undefined) {
      const transitioned = priorIntents
        .map((intent) => this.byId.get(intent.source_id))
        .filter((row): row is CapabilityDemandRecord => row !== undefined);
      return { transitioned, intents: priorIntents, replay: true };
    }

    const matches = [...this.byId.values()].filter(
      (row) =>
        row.state === "open" &&
        row.required_capability === input.required_capability &&
        row.deployment_set_digest === input.deployment_set_digest &&
        row.network_ref === input.network_ref &&
        row.token_standard === input.token_standard,
    );

    const transitioned: CapabilityDemandRecord[] = [];
    const intents: CapabilityDemandAttentionIntent[] = [];

    for (const record of matches) {
      if (record.support_intent_id !== null) {
        const existingIntent = this.intents.get(record.support_intent_id);
        if (existingIntent !== undefined) {
          transitioned.push(record);
          intents.push(existingIntent);
        }
        continue;
      }

      const nextSequence = record.transition_sequence + 1;
      const intent = buildCapabilityDemandSupportedIntent({
        demand_id: record.demand_id,
        subject_ref: record.requester_subject,
        community_ref: record.community_ref,
        transition_sequence: nextSequence,
        resolution_id: record.resolution_id,
        occurred_at_unix_ms: input.now_ms,
      });

      const updated: CapabilityDemandRecord = {
        ...record,
        state: "notified",
        transition_sequence: nextSequence,
        updated_at_unix_ms: input.now_ms,
        support_intent_id: intent.intent_id,
      };
      this.byId.set(updated.demand_id, updated);
      this.openByCanonical.delete(
        canonicalKey({
          requester_subject: record.requester_subject,
          community_ref: record.community_ref,
          deployment_set_digest: record.deployment_set_digest,
          required_capability: record.required_capability,
          policy_version: record.policy_version,
        }),
      );
      this.intents.set(intent.intent_id, intent);
      transitioned.push(updated);
      intents.push(intent);
    }

    this.supportEvents.set(input.event_id, intents);
    return { transitioned, intents, replay: false };
  }

  async decline(input: {
    demand_id: string;
    now_ms: number;
  }): Promise<CapabilityDemandRecord | undefined> {
    this.expireOpenDemands(input.now_ms);
    const record = this.byId.get(input.demand_id);
    if (record === undefined) return undefined;
    if (record.state !== "open") return record;
    const updated: CapabilityDemandRecord = {
      ...record,
      state: "declined",
      transition_sequence: record.transition_sequence + 1,
      updated_at_unix_ms: input.now_ms,
    };
    this.byId.set(updated.demand_id, updated);
    this.openByCanonical.delete(
      canonicalKey({
        requester_subject: record.requester_subject,
        community_ref: record.community_ref,
        deployment_set_digest: record.deployment_set_digest,
        required_capability: record.required_capability,
        policy_version: record.policy_version,
      }),
    );
    return updated;
  }

  async listIntents(): Promise<ReadonlyArray<CapabilityDemandAttentionIntent>> {
    return [...this.intents.values()];
  }
}

export { toPublicCapabilityDemandProjection } from "./capability-demand-projection.js";
