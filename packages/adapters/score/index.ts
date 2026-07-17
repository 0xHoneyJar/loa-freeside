/**
 * @freeside/adapters/score
 *
 * Server-side proxy to score-api for whale/concentration signals. The static
 * key never leaves the server (AC-6). Circuit-broken per call.
 */

export {
  ScoreProxy,
  defaultScoreFetcher,
} from './score-proxy.js';
export type {
  ScoreProxyConfig,
  WalletScore,
  CircuitState,
  ScoreFetcher,
  ScoreFetchArgs,
} from './types.js';
