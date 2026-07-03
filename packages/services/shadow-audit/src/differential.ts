/**
 * Shadow-mode differential (SDD sandwich-line §6c) — compare the two ownership
 * read-models (sonar Transfer-replay vs the shadow-mode projection) WITHOUT
 * cutover. It never replaces sonar; it observes divergence so the parity bar
 * (3 consecutive true-mismatch-free runs on ≥2 collections) can be measured.
 *
 * Privacy: divergent wallets are reported as SALTED HASHES only — raw wallet
 * lists never leave the service (per-cycle salt orphans old logs by design).
 * The value-semantics contract (S3-T3) governs what "agree" means per standard.
 */

import { createHash } from 'node:crypto';
import type { Balances } from './audit-service.js';

/** A wallet whose two read-model balances disagree, classified by cause. */
export interface DivergentWallet {
  /** salted hash of the wallet (never the raw address). */
  wallet_hash: string;
  sonar_balance: string; // bigint → string (JSON-safe)
  projection_balance: string;
  /**
   * `no_backfill_window`: the projection could not have seen this wallet's
   * history (its last relevant transfer precedes subscription) — expected,
   * NOT a true mismatch. `true_mismatch`: a real disagreement.
   */
  classification: 'no_backfill_window' | 'true_mismatch';
}

export interface DifferentialResult {
  collection: string;
  chain: string;
  contract: string;
  snapshot_block: number;
  /** wallets present in exactly one set OR with unequal balances. */
  divergences: DivergentWallet[];
  true_mismatch: number;
  no_backfill: number;
  /** parity iff true_mismatch === 0 (no-backfill divergences do not break parity). */
  verdict: 'parity' | 'diverged';
}

/** Per-wallet last-relevant-transfer time, for the no-backfill classifier. */
export type LastTransferAt = (walletHashInput: string) => number | undefined;

export interface DifferentialInput {
  collection: string;
  chain: string;
  contract: string;
  snapshotBlock: number;
  sonar: Balances;
  projection: Balances;
  /** epoch ms the projection began subscribing to this collection. */
  subscriptionStartedAtMs: number;
  /**
   * last-transfer time (epoch ms) for a raw wallet, from the sonar stream.
   * A divergent wallet whose last transfer PRECEDES subscription is
   * `no_backfill_window` (the projection could not have seen it).
   */
  lastTransferAtMs: (wallet: string) => number | undefined;
  /** per-run salt (rotate per cycle) — orphans old divergence logs by design. */
  salt: string;
}

function hashWallet(wallet: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${wallet.toLowerCase()}`).digest('hex').slice(0, 32);
}

/**
 * Pure differential. Deterministic given its inputs. A wallet diverges when it
 * is present in one balance set but not the other, or its balances are unequal.
 */
export function computeDifferential(input: DifferentialInput): DifferentialResult {
  const wallets = new Set<string>([...input.sonar.keys(), ...input.projection.keys()]);
  const divergences: DivergentWallet[] = [];

  for (const wallet of wallets) {
    const s = input.sonar.get(wallet) ?? 0n;
    const p = input.projection.get(wallet) ?? 0n;
    if (s === p) continue;

    const last = input.lastTransferAtMs(wallet);
    // The projection can only have seen transfers at/after it subscribed. A
    // divergence whose last transfer precedes subscription is expected.
    const classification: DivergentWallet['classification'] =
      last !== undefined && last < input.subscriptionStartedAtMs ? 'no_backfill_window' : 'true_mismatch';

    divergences.push({
      wallet_hash: hashWallet(wallet, input.salt),
      sonar_balance: s.toString(),
      projection_balance: p.toString(),
      classification,
    });
  }

  const true_mismatch = divergences.filter((d) => d.classification === 'true_mismatch').length;
  const no_backfill = divergences.length - true_mismatch;

  return {
    collection: input.collection,
    chain: input.chain,
    contract: input.contract,
    snapshot_block: input.snapshotBlock,
    divergences,
    true_mismatch,
    no_backfill,
    verdict: true_mismatch === 0 ? 'parity' : 'diverged',
  };
}

/** The structured `differential.run` log line (SDD IMP-010 evidence surface). */
export function differentialLogLine(r: DifferentialResult): Record<string, unknown> {
  return {
    event: 'differential.run',
    collection: r.collection,
    chain: r.chain,
    contract: r.contract,
    snapshot_block: r.snapshot_block,
    true_mismatch: r.true_mismatch,
    no_backfill: r.no_backfill,
    verdict: r.verdict,
  };
}

/** Flag gate (SDD §6c): the differential runs only when explicitly enabled. */
export function differentialEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SHADOW_DIFFERENTIAL_ENABLED === 'true';
}
