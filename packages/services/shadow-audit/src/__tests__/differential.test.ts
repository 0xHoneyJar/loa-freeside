import { describe, it, expect } from 'vitest';
import { computeDifferential, differentialEnabled, differentialLogLine, type DifferentialInput } from '../differential.js';
import type { Balances } from '../audit-service.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);
const SUB = 1_000_000; // subscription started at epoch ms

function base(over: Partial<DifferentialInput>): DifferentialInput {
  return {
    collection: 'azuki', chain: '1', contract: '0xdead', snapshotBlock: 100,
    sonar: new Map<string, bigint>(), projection: new Map<string, bigint>(),
    subscriptionStartedAtMs: SUB,
    lastTransferAtMs: () => SUB + 1, // default: after subscription → true mismatch
    salt: 'test-salt',
    ...over,
  };
}

describe('computeDifferential', () => {
  it('identical balance sets → parity, no divergences', () => {
    const bal: Balances = new Map([[A, 2n], [B, 1n]]);
    const r = computeDifferential(base({ sonar: new Map(bal), projection: new Map(bal) }));
    expect(r.verdict).toBe('parity');
    expect(r.divergences).toHaveLength(0);
  });

  it('a wallet in sonar but not projection, last transfer AFTER sub → true_mismatch', () => {
    const r = computeDifferential(base({ sonar: new Map([[A, 1n]]), projection: new Map() }));
    expect(r.true_mismatch).toBe(1);
    expect(r.verdict).toBe('diverged');
    expect(r.divergences[0]!.wallet_hash).not.toContain(A); // salted hash, never raw
  });

  it('a pre-subscription divergence → no_backfill_window, parity preserved', () => {
    const r = computeDifferential(base({
      sonar: new Map([[A, 1n]]), projection: new Map(),
      lastTransferAtMs: () => SUB - 1, // before subscription
    }));
    expect(r.no_backfill).toBe(1);
    expect(r.true_mismatch).toBe(0);
    expect(r.verdict).toBe('parity'); // no-backfill does NOT break parity
  });

  it('mixes: one true mismatch + one no-backfill', () => {
    const r = computeDifferential(base({
      sonar: new Map([[A, 1n], [B, 5n]]),
      projection: new Map([[B, 5n]]), // A missing
      lastTransferAtMs: (w) => (w === A ? SUB + 10 : SUB - 10),
    }));
    // A after-sub → true_mismatch; B agrees (5==5) so no divergence at all
    expect(r.true_mismatch).toBe(1);
    expect(r.no_backfill).toBe(0);
  });

  it('unequal balances (not just presence) diverge', () => {
    const r = computeDifferential(base({ sonar: new Map([[A, 3n]]), projection: new Map([[A, 2n]]) }));
    expect(r.divergences[0]!.sonar_balance).toBe('3');
    expect(r.divergences[0]!.projection_balance).toBe('2');
  });

  it('the log line carries the evidence fields, no raw wallets', () => {
    const r = computeDifferential(base({ sonar: new Map([[A, 1n]]), projection: new Map() }));
    const line = differentialLogLine(r);
    expect(line).toMatchObject({ event: 'differential.run', collection: 'azuki', true_mismatch: 1, verdict: 'diverged' });
    expect(JSON.stringify(line)).not.toContain(A);
  });

  it('salted hash is deterministic per salt, changes with salt', () => {
    const r1 = computeDifferential(base({ sonar: new Map([[A, 1n]]), projection: new Map(), salt: 's1' }));
    const r2 = computeDifferential(base({ sonar: new Map([[A, 1n]]), projection: new Map(), salt: 's1' }));
    const r3 = computeDifferential(base({ sonar: new Map([[A, 1n]]), projection: new Map(), salt: 's2' }));
    expect(r1.divergences[0]!.wallet_hash).toBe(r2.divergences[0]!.wallet_hash);
    expect(r1.divergences[0]!.wallet_hash).not.toBe(r3.divergences[0]!.wallet_hash);
  });
});

describe('differentialEnabled (flag gate)', () => {
  it('default off', () => {
    expect(differentialEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
  it('on only when explicitly true', () => {
    expect(differentialEnabled({ SHADOW_DIFFERENTIAL_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(differentialEnabled({ SHADOW_DIFFERENTIAL_ENABLED: '1' } as NodeJS.ProcessEnv)).toBe(false);
  });
});
