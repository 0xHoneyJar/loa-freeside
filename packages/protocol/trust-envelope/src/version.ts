/** Wire contract major version for CR-009 trust envelopes and epoch baselines. */
export const TRUST_ENVELOPE_SCHEMA_MAJOR = 1 as const;

/** Highest schema minor this package emits and fully understands. */
export const TRUST_ENVELOPE_SCHEMA_MINOR = 0 as const;

export const TRUST_ENVELOPE_PROTOCOL_VERSION = "collection-report.trust-envelope.v1" as const;

export const TRUST_ENVELOPE_CONTRACT = {
  name: "collection-report.trust-envelope",
  major_version: TRUST_ENVELOPE_SCHEMA_MAJOR,
  minor_version: TRUST_ENVELOPE_SCHEMA_MINOR,
} as const;

/** Producer clock may lead consumer authority by at most 30 seconds (SDD §11.1). */
export const TRUST_ENVELOPE_MAX_FUTURE_SKEW_MS = 30_000;

/** Minimum stream retention covering live resolution/order reconciliation (SDD §11.1). */
export const TRUST_STREAM_MIN_RETENTION_MS = 86_400_000;

/** Default interactive envelope lifetime when producer does not override. */
export const TRUST_ENVELOPE_DEFAULT_TTL_MS = 300_000;
