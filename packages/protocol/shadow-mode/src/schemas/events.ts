/**
 * The 8 consumed events — payload schemas + the `ShadowEvent` discriminated
 * union (SDD §3). All `.strict()`: an unexpected key is a hard parse failure,
 * so a malformed or smuggled field cannot silently enter the append-only log.
 */

import { z } from 'zod';
import { WalletRefSchema } from './common.js';
import { envelopeBase } from './envelope.js';

// --- payloads ----------------------------------------------------------------

export const DiscordMemberSnapshotPayloadSchema = z
  .object({
    discord_user_id: z.string().min(1),
    display_name: z.string().optional(),
    role_ids: z.array(z.string()),
    joined_at: z.string().datetime().optional(),
  })
  .strict();

export const IdentityWalletLinkedPayloadSchema = z
  .object({
    user_id: z.string().min(1),
    wallet: WalletRefSchema,
    proof_ref: z.string().optional(),
  })
  .strict();

export const IdentityAccountLinkedPayloadSchema = z
  .object({
    user_id: z.string().min(1),
    account_kind: z.enum(['discord', 'telegram', 'x', 'email']),
    external_id: z.string().min(1),
    proof_ref: z.string().optional(),
  })
  .strict();

export const IdentityLinkRevokedPayloadSchema = z
  .object({
    user_id: z.string().min(1),
    /** What is being revoked: a wallet link or an account link. */
    link_kind: z.enum(['wallet', 'account']),
    wallet: WalletRefSchema.optional(),
    account_kind: z.enum(['discord', 'telegram', 'x', 'email']).optional(),
    external_id: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

export const SonarWalletAttributedPayloadSchema = z
  .object({
    wallet: WalletRefSchema,
    contract_address: z.string().min(1),
    edge_kind: z.enum([
      'minted',
      'held_at_snapshot',
      'received_transfer',
      'sent_transfer',
      'market_interaction',
    ]),
    token_id: z.string().optional(),
    tx_hash: z.string().optional(),
    block_number: z.number().int().nonnegative().optional(),
  })
  .strict();

export const IncumbentRoleObservedPayloadSchema = z
  .object({
    discord_user_id: z.string().min(1),
    incumbent: z.string().min(1),
    role_ids: z.array(z.string()),
  })
  .strict();

export const FreesideRoleComputedPayloadSchema = z
  .object({
    locator: z
      .object({
        user_id: z.string().optional(),
        discord_user_id: z.string().optional(),
        wallet: WalletRefSchema.optional(),
      })
      .strict(),
    role_ids: z.array(z.string()),
    reason: z.string().optional(),
  })
  .strict();

export const CommunityConfigUpdatedPayloadSchema = z
  .object({
    role_rank: z.record(z.string(), z.number()).optional(),
    watched_contracts: z.array(z.string()).optional(),
    incumbent_bot_ids: z.array(z.string()).optional(),
  })
  .strict();

// --- full event envelopes (discriminated on `name`) --------------------------

function event<TName extends string, TPayload extends z.ZodTypeAny>(
  name: TName,
  payload: TPayload,
) {
  return z.object({ ...envelopeBase, name: z.literal(name), payload }).strict();
}

export const ShadowEventSchema = z.discriminatedUnion('name', [
  event('discord.member.snapshot.v1', DiscordMemberSnapshotPayloadSchema),
  event('identity.wallet.linked.v1', IdentityWalletLinkedPayloadSchema),
  event('identity.account.linked.v1', IdentityAccountLinkedPayloadSchema),
  event('identity.link.revoked.v1', IdentityLinkRevokedPayloadSchema),
  event('sonar.wallet.attributed.v1', SonarWalletAttributedPayloadSchema),
  event('incumbent.role.observed.v1', IncumbentRoleObservedPayloadSchema),
  event('freeside.role.computed.v1', FreesideRoleComputedPayloadSchema),
  event('community.config.updated.v1', CommunityConfigUpdatedPayloadSchema),
]);

export type ShadowEvent = z.infer<typeof ShadowEventSchema>;

// Per-event payload types (for handler signatures).
export type DiscordMemberSnapshotPayload = z.infer<typeof DiscordMemberSnapshotPayloadSchema>;
export type IdentityWalletLinkedPayload = z.infer<typeof IdentityWalletLinkedPayloadSchema>;
export type IdentityAccountLinkedPayload = z.infer<typeof IdentityAccountLinkedPayloadSchema>;
export type IdentityLinkRevokedPayload = z.infer<typeof IdentityLinkRevokedPayloadSchema>;
export type SonarWalletAttributedPayload = z.infer<typeof SonarWalletAttributedPayloadSchema>;
export type IncumbentRoleObservedPayload = z.infer<typeof IncumbentRoleObservedPayloadSchema>;
export type FreesideRoleComputedPayload = z.infer<typeof FreesideRoleComputedPayloadSchema>;
export type CommunityConfigUpdatedPayload = z.infer<typeof CommunityConfigUpdatedPayloadSchema>;
