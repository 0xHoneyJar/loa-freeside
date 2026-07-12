/**
 * ScoreProxy — server-side proxy to score-api with a circuit breaker (AC-6).
 *
 * The static key is injected once, used only in the outbound request header,
 * and never returned or logged. Each call is circuit-broken (opossum) with a
 * timeout so one audit cannot exhaust score-api, and the breaker trips under
 * sustained failure.
 */

import CircuitBreaker from 'opossum';
import { z } from 'zod';
import type {
  CircuitState,
  ScoreFetcher,
  ScoreProxyConfig,
  WalletScore,
} from './types.js';

const DEFAULTS = {
  timeoutMs: 5_000,
  errorThresholdPercentage: 50,
  resetTimeoutMs: 10_000,
  volumeThreshold: 3,
};

const RawScoreSchema = z.object({
  address: z.string().optional(),
  rank: z.number().int().nullish(),
  score: z
    .union([z.string(), z.number()])
    .nullish()
    .transform((v) => (v == null ? null : String(v))),
  percentile: z.number().nullish(),
});

export const defaultScoreFetcher: ScoreFetcher = async ({
  endpoint,
  address,
  apiKey,
  timeoutMs,
}) => {
  const url = `${endpoint.replace(/\/$/, '')}/v1/wallets/${address}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      // Static key travels ONLY in this server-side request header.
      headers: { Accept: 'application/json', 'x-api-key': apiKey },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`score-api ${res.status}: ${await res.text()}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

export class ScoreProxy {
  private readonly endpoint: string;
  // Held server-side only; never serialized into a return value or log line.
  readonly #apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetcher: ScoreFetcher;
  private readonly breaker: CircuitBreaker<unknown[], unknown>;

  constructor(config: ScoreProxyConfig, fetcher: ScoreFetcher = defaultScoreFetcher) {
    if (!config.apiKey) {
      throw new Error('ScoreProxy requires a server-side apiKey');
    }
    this.endpoint = config.endpoint;
    this.#apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs ?? DEFAULTS.timeoutMs;
    this.fetcher = fetcher;
    this.breaker = new CircuitBreaker(
      async <T>(fn: () => Promise<T>): Promise<T> => fn(),
      {
        timeout: this.timeoutMs,
        errorThresholdPercentage:
          config.errorThresholdPercentage ?? DEFAULTS.errorThresholdPercentage,
        resetTimeout: config.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs,
        volumeThreshold: config.volumeThreshold ?? DEFAULTS.volumeThreshold,
      },
    );
  }

  /** Fetch the whale/concentration signal for one wallet. */
  async getWalletScore(address: string): Promise<WalletScore> {
    const raw = await this.breaker.fire(() =>
      this.fetcher({
        endpoint: this.endpoint,
        address,
        apiKey: this.#apiKey,
        timeoutMs: this.timeoutMs,
      }),
    );
    const parsed = RawScoreSchema.parse(raw);
    return {
      address: (parsed.address ?? address).toLowerCase(),
      rank: parsed.rank ?? null,
      score: parsed.score ?? null,
      percentile: parsed.percentile ?? null,
    };
  }

  getCircuitState(): CircuitState {
    if (this.breaker.opened) return 'open';
    if (this.breaker.halfOpen) return 'halfOpen';
    return 'closed';
  }
}
