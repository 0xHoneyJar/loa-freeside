import { digestOf } from "./digest.js";
import {
  CAPABILITY_DEMAND_ATTENTION_KIND,
  CAPABILITY_DEMAND_INTENT_SCHEMA_VERSION,
  CAPABILITY_DEMAND_SOURCE_KIND,
} from "./capability-demand-constants.js";

export interface CapabilityDemandAttentionIntent {
  readonly schema_version: typeof CAPABILITY_DEMAND_INTENT_SCHEMA_VERSION;
  readonly intent_id: string;
  readonly kind: typeof CAPABILITY_DEMAND_ATTENTION_KIND;
  readonly subject_ref: string;
  readonly source_kind: typeof CAPABILITY_DEMAND_SOURCE_KIND;
  readonly source_id: string;
  readonly community_ref: string;
  readonly transition_sequence: number;
  readonly deep_link_path: string;
  readonly occurred_at_unix_ms: number;
}

export function stableCapabilityDemandIntentId(input: {
  demand_id: string;
  transition_sequence: number;
  subject_ref: string;
}): string {
  return digestOf({
    schema_version: CAPABILITY_DEMAND_INTENT_SCHEMA_VERSION,
    kind: CAPABILITY_DEMAND_ATTENTION_KIND,
    source_kind: CAPABILITY_DEMAND_SOURCE_KIND,
    source_id: input.demand_id,
    transition_sequence: input.transition_sequence,
    subject_ref: input.subject_ref,
  });
}

export function buildCapabilityDemandSupportedIntent(input: {
  demand_id: string;
  subject_ref: string;
  community_ref: string;
  transition_sequence: number;
  resolution_id: string;
  occurred_at_unix_ms: number;
}): CapabilityDemandAttentionIntent {
  const intent_id = stableCapabilityDemandIntentId({
    demand_id: input.demand_id,
    transition_sequence: input.transition_sequence,
    subject_ref: input.subject_ref,
  });
  return {
    schema_version: CAPABILITY_DEMAND_INTENT_SCHEMA_VERSION,
    intent_id,
    kind: CAPABILITY_DEMAND_ATTENTION_KIND,
    subject_ref: input.subject_ref,
    source_kind: CAPABILITY_DEMAND_SOURCE_KIND,
    source_id: input.demand_id,
    community_ref: input.community_ref,
    transition_sequence: input.transition_sequence,
    deep_link_path: `/reports/resolutions/${encodeURIComponent(input.resolution_id)}`,
    occurred_at_unix_ms: input.occurred_at_unix_ms,
  };
}
