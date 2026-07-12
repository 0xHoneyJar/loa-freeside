/**
 * Score adapter — server-side proxy to score-api for whale/concentration.
 *
 * The static score-api key is held SERVER-SIDE ONLY (FR-8 / AC-6) and never
 * appears in any client-bound payload. This whale/concentration signal is
 * aggregate analysis (rank/score), NOT a per-member access score — the access
 * decision is always a band (see the protocol AccessDecisionRecord).
 */

export interface ScoreProxyConfig {
  /** Base URL of score-api. */
  endpoint: string;
  /** Static API key — server-side only, never returned or logged. */
  apiKey: string;
  timeoutMs?: number;
  errorThresholdPercentage?: number;
  resetTimeoutMs?: number;
  volumeThreshold?: number;
}

/**
 * Whale/concentration signal for a wallet. Exact score-api field shape is
 * [ASSUMPTION] pending live confirmation; validated on ingest so a drift fails
 * loud rather than silently mis-reads.
 */
export interface WalletScore {
  address: string;
  rank: number | null;
  /** Stringified (may exceed Number range). */
  score: string | null;
  percentile: number | null;
}

export type CircuitState = 'closed' | 'open' | 'halfOpen';

export interface ScoreFetchArgs {
  endpoint: string;
  address: string;
  apiKey: string;
  timeoutMs: number;
}

/** One score-api lookup. Injectable so the proxy is testable without network
 *  and the key-handling path is isolated. */
export type ScoreFetcher = (args: ScoreFetchArgs) => Promise<unknown>;
