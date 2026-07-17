/**
 * Protocol version constants and digest domains for CR-006 durable resolution.
 */
export declare const COLLECTION_RESOLUTION_PROTOCOL_VERSION = "1.0.0";
export declare const COLLECTION_RESOLUTION_SCHEMA_VERSION = 1;
/** Server policy: sessions expire 15 minutes after create, or after an
 *  unchanged expired refresh that re-establishes expiry. Confirm never extends. */
export declare const RESOLUTION_TTL_MS: number;
/**
 * Bounded retention for create/confirm/refresh idempotency keys.
 * Keys older than this window are evicted; reuse after eviction is a new command.
 */
export declare const IDEMPOTENCY_KEY_RETENTION_MS: number;
export declare const RESOLUTION_DIGEST_DOMAINS: Readonly<{
    request: "collection-resolution.request";
    candidate_snapshot: "collection-resolution.candidate-snapshot";
    selection: "collection-resolution.selection";
    admission_decision: "collection-resolution.admission-decision";
    selection_relevant: "collection-resolution.selection-relevant";
}>;
//# sourceMappingURL=version.d.ts.map