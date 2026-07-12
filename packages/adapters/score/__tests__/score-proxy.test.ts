import { describe, it, expect } from 'vitest';
import { ScoreProxy } from '../score-proxy.js';
import type { ScoreFetcher } from '../types.js';

const A = '0x' + 'a'.repeat(40);

describe('ScoreProxy — key handling (AC-6)', () => {
  it('sends the static key to the transport but never returns it', async () => {
    const SECRET = 'sk-super-secret-score-key';
    let seenKey: string | undefined;
    const spy: ScoreFetcher = async ({ apiKey }) => {
      seenKey = apiKey;
      return { rank: 3, score: 1000, percentile: 0.9 };
    };
    const proxy = new ScoreProxy({ endpoint: 'http://score', apiKey: SECRET }, spy);
    const result = await proxy.getWalletScore(A);
    expect(seenKey).toBe(SECRET); // key reaches the server-side transport
    expect(JSON.stringify(result)).not.toContain(SECRET); // never in client-bound output
    expect(result).not.toHaveProperty('apiKey');
  });

  it('refuses construction without a server-side key', () => {
    expect(() => new ScoreProxy({ endpoint: 'http://score', apiKey: '' })).toThrow();
  });
});

describe('ScoreProxy — response mapping', () => {
  it('maps a score-api response to a normalized WalletScore', async () => {
    const ok: ScoreFetcher = async () => ({
      address: A.toUpperCase(),
      rank: 3,
      score: '1000',
      percentile: 0.9,
    });
    const proxy = new ScoreProxy({ endpoint: 'http://score', apiKey: 'k' }, ok);
    expect(await proxy.getWalletScore(A)).toEqual({
      address: A,
      rank: 3,
      score: '1000',
      percentile: 0.9,
    });
  });

  it('tolerates a sparse response (nulls for missing fields)', async () => {
    const sparse: ScoreFetcher = async () => ({});
    const proxy = new ScoreProxy({ endpoint: 'http://score', apiKey: 'k' }, sparse);
    expect(await proxy.getWalletScore(A)).toEqual({
      address: A,
      rank: null,
      score: null,
      percentile: null,
    });
  });
});

describe('ScoreProxy — circuit breaker (AC-6)', () => {
  it('trips open under sustained failure, then short-circuits', async () => {
    let calls = 0;
    const failing: ScoreFetcher = async () => {
      calls += 1;
      throw new Error('score-api down');
    };
    const proxy = new ScoreProxy(
      {
        endpoint: 'http://score',
        apiKey: 'k',
        volumeThreshold: 2,
        errorThresholdPercentage: 50,
        resetTimeoutMs: 60_000,
      },
      failing,
    );
    for (let i = 0; i < 8; i += 1) {
      await proxy.getWalletScore(A).catch(() => undefined);
    }
    expect(proxy.getCircuitState()).toBe('open');

    const callsAtOpen = calls;
    await proxy.getWalletScore(A).catch(() => undefined);
    expect(calls).toBe(callsAtOpen); // open breaker short-circuits — transport not hit
  });
});
