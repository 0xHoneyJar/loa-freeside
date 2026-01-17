/**
 * Score Service Protocol Types
 * Sprint S-16: Score Service & Two-Tier Orchestration
 *
 * TypeScript type definitions for the Score Service gRPC protocol.
 * These types mirror the proto definitions in apps/score-service/proto/score.proto
 * and are used by the TypeScript client to communicate with the Rust Score Service.
 *
 * @see SDD §6.1.4 Score Service (Rust Microservice)
 */
/**
 * Default Score Service client configuration
 */
export const DEFAULT_SCORE_SERVICE_CONFIG = {
    timeoutMs: 5_000, // 5s timeout per SDD §6.1.5
    errorThresholdPercentage: 50, // Trip at 50% error rate
    resetTimeoutMs: 30_000, // 30s reset timeout
    volumeThreshold: 10, // Minimum requests before tripping
    useTls: false,
    maxRetries: 2,
    retryBackoffMs: 100,
};
//# sourceMappingURL=score-service.js.map