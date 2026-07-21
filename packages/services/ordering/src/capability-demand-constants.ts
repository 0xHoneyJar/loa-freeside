/** CR-208 demand/disposal thresholds (sprint §4, SDD §6.7). */
export const OPEN_DEMAND_LIMIT_PER_SUBJECT = 20;
export const OPEN_DEMAND_LIMIT_PER_COMMUNITY = 500;
export const OPEN_DEMAND_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export const CAPABILITY_DEMAND_ATTENTION_KIND = "capability_demand.supported" as const;
export const CAPABILITY_DEMAND_SOURCE_KIND = "capability_demand" as const;
export const CAPABILITY_DEMAND_INTENT_SCHEMA_VERSION = 1 as const;
