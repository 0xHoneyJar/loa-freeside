/**
 * Shared primitives for the shadow-mode ledger protocol.
 *
 * The ledger is chain-agnostic (EVM + non-EVM wallets), so `WalletRef.address`
 * is shape-only (a non-empty string), NOT the EVM-specific `EthAddress` used by
 * the shadow-audit report. Alias helpers lowercase the wallet for a canonical
 * subject key (SDD §3).
 */

import { z } from 'zod';

/** A source system contributing observations. */
export const SourceKindSchema = z.enum([
  'discord',
  'identity_api',
  'sonar',
  'incumbent_bot',
  'manual_config',
  'freeside',
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * Truth status on every observation + edge (PRD §4).
 *   observed     — directly seen by a source system
 *   attested     — explicitly provided by an authority/admin
 *   inferred     — derived from observed facts
 *   estimated    — model/rule estimate (avoided in MVP unless a rule is named)
 *   unsupported  — requested, not backed by evidence
 *   abstained    — intentionally refused
 */
export const TruthStatusSchema = z.enum([
  'observed',
  'attested',
  'inferred',
  'estimated',
  'unsupported',
  'abstained',
]);
export type TruthStatus = z.infer<typeof TruthStatusSchema>;

/** A wallet reference. Chain is a lowercase slug; address is shape-only (chain-agnostic). */
export const WalletRefSchema = z
  .object({
    chain: z.string().min(1).regex(/^[a-z0-9-]+$/, 'chain must be a lowercase slug'),
    address: z.string().min(1),
  })
  .strict();
export type WalletRef = z.infer<typeof WalletRefSchema>;

// --- alias helpers (deterministic subject keys) ------------------------------

export function identityAlias(userId: string): string {
  return `identity:${userId}`;
}

export function discordAlias(discordUserId: string): string {
  return `discord:${discordUserId}`;
}

/** Wallet alias is lowercased on BOTH chain and address for canonical matching. */
export function walletAlias(wallet: WalletRef): string {
  return `wallet:${wallet.chain.toLowerCase()}:${wallet.address.toLowerCase()}`;
}

export function unresolvedAlias(eventId: string): string {
  return `unresolved:${eventId}`;
}
