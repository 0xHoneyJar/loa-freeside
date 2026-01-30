/**
 * Global User Registry Type Definitions
 * Sprint 176: Append-only, event-sourced identity store
 *
 * @module services/user-registry/types
 */

/**
 * All event types supported by the User Registry
 */
export enum IdentityEventType {
  /** New identity created */
  IDENTITY_CREATED = 'IDENTITY_CREATED',
  /** Discord account linked (initial link) */
  DISCORD_LINKED = 'DISCORD_LINKED',
  /** Discord account details updated */
  DISCORD_UPDATED = 'DISCORD_UPDATED',
  /** Wallet verified and linked */
  WALLET_VERIFIED = 'WALLET_VERIFIED',
  /** Wallet removed (soft delete) */
  WALLET_REMOVED = 'WALLET_REMOVED',
  /** Wallet set as primary */
  WALLET_SET_PRIMARY = 'WALLET_SET_PRIMARY',
  /** Twitter account linked (future) */
  TWITTER_LINKED = 'TWITTER_LINKED',
  /** Telegram account linked (future) */
  TELEGRAM_LINKED = 'TELEGRAM_LINKED',
  /** Profile information updated */
  PROFILE_UPDATED = 'PROFILE_UPDATED',
  /** Identity suspended (admin action) */
  IDENTITY_SUSPENDED = 'IDENTITY_SUSPENDED',
  /** Identity restored from suspension */
  IDENTITY_RESTORED = 'IDENTITY_RESTORED',
  /** Identity deleted (soft delete) */
  IDENTITY_DELETED = 'IDENTITY_DELETED',
}

/**
 * Event sources - where the event originated from
 */
export type EventSource =
  | 'discord_verification'  // /verify command in Discord
  | 'admin_dashboard'       // Admin UI action
  | 'admin_api'             // Admin API call
  | 'oauth_flow'            // OAuth callback (Twitter, etc.)
  | 'migration'             // Data migration script
  | 'system';               // Automated process

/**
 * Identity status values
 */
export type IdentityStatus = 'active' | 'suspended' | 'deleted';

/**
 * Wallet status values
 */
export type WalletStatus = 'active' | 'removed';

// =============================================================================
// Event Data Payloads
// =============================================================================

/**
 * Payload for IDENTITY_CREATED event
 */
export interface IdentityCreatedData {
  discord_id: string;
  discord_username: string;
  discord_discriminator?: string;
}

/**
 * Payload for DISCORD_LINKED event
 */
export interface DiscordLinkedData {
  discord_id: string;
  discord_username: string;
  discord_discriminator?: string;
  discord_avatar_hash?: string;
}

/**
 * Payload for DISCORD_UPDATED event
 */
export interface DiscordUpdatedData {
  discord_username?: string;
  discord_discriminator?: string;
  discord_avatar_hash?: string;
  previous_username?: string;
}

/**
 * Payload for WALLET_VERIFIED event
 */
export interface WalletVerifiedData {
  wallet_address: string;
  chain_id: number;
  signature: string;
  message: string;
  is_primary: boolean;
  verification_source: string;
}

/**
 * Payload for WALLET_REMOVED event
 */
export interface WalletRemovedData {
  wallet_address: string;
  reason: string;
  removed_by: string;
}

/**
 * Payload for WALLET_SET_PRIMARY event
 */
export interface WalletSetPrimaryData {
  wallet_address: string;
  previous_primary?: string;
}

/**
 * Payload for TWITTER_LINKED event (future)
 */
export interface TwitterLinkedData {
  twitter_handle: string;
  twitter_id: string;
}

/**
 * Payload for TELEGRAM_LINKED event (future)
 */
export interface TelegramLinkedData {
  telegram_id: string;
  telegram_username?: string;
}

/**
 * Payload for PROFILE_UPDATED event
 */
export interface ProfileUpdatedData {
  field: string;
  old_value?: string;
  new_value?: string;
}

/**
 * Payload for IDENTITY_SUSPENDED event
 */
export interface IdentitySuspendedData {
  reason: string;
  suspended_by: string;
  expires_at?: string;  // ISO timestamp, null = permanent
}

/**
 * Payload for IDENTITY_RESTORED event
 */
export interface IdentityRestoredData {
  reason: string;
  restored_by: string;
  previous_suspension_reason?: string;
}

/**
 * Payload for IDENTITY_DELETED event
 */
export interface IdentityDeletedData {
  reason: string;
  deleted_by: string;
}

/**
 * Union type for all event data payloads
 */
export type IdentityEventData =
  | IdentityCreatedData
  | DiscordLinkedData
  | DiscordUpdatedData
  | WalletVerifiedData
  | WalletRemovedData
  | WalletSetPrimaryData
  | TwitterLinkedData
  | TelegramLinkedData
  | ProfileUpdatedData
  | IdentitySuspendedData
  | IdentityRestoredData
  | IdentityDeletedData
  | Record<string, unknown>;

// =============================================================================
// Service Input/Output Types
// =============================================================================

/**
 * Parameters for creating a new identity
 */
export interface CreateIdentityParams {
  discordId: string;
  discordUsername: string;
  discordDiscriminator?: string;
  discordAvatarHash?: string;
  source: EventSource;
  actorId: string;
  requestId?: string;
}

/**
 * Parameters for verifying a wallet
 */
export interface VerifyWalletParams {
  identityId: string;
  walletAddress: string;
  chainId?: number;
  signature: string;
  message: string;
  isPrimary?: boolean;
  source: EventSource;
  actorId: string;
  requestId?: string;
}

/**
 * Parameters for removing a wallet
 */
export interface RemoveWalletParams {
  identityId: string;
  walletAddress: string;
  reason: string;
  source: EventSource;
  actorId: string;
  requestId?: string;
}

/**
 * Parameters for suspending an identity
 */
export interface SuspendIdentityParams {
  identityId: string;
  reason: string;
  suspendedBy: string;
  expiresAt?: Date;
  source: EventSource;
  requestId?: string;
}

/**
 * Parameters for restoring an identity
 */
export interface RestoreIdentityParams {
  identityId: string;
  reason: string;
  restoredBy: string;
  source: EventSource;
  requestId?: string;
}

/**
 * Parameters for listing users
 */
export interface ListUsersParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: IdentityStatus;
}

/**
 * Paginated list result
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * Identity with wallets
 */
export interface IdentityWithWallets {
  identity: {
    identityId: string;
    discordId: string;
    discordUsername: string | null;
    discordDiscriminator: string | null;
    discordAvatarHash: string | null;
    primaryWallet: string | null;
    twitterHandle: string | null;
    telegramId: string | null;
    status: IdentityStatus;
    createdAt: Date;
    updatedAt: Date;
    version: number;
  };
  wallets: Array<{
    walletId: string;
    address: string;
    chainId: number;
    isPrimary: boolean;
    verifiedAt: Date;
    verificationSource: string;
    status: WalletStatus;
  }>;
}

/**
 * Identity event record
 */
export interface IdentityEventRecord {
  eventId: string;
  identityId: string;
  eventType: IdentityEventType;
  eventData: IdentityEventData;
  occurredAt: Date;
  source: EventSource;
  actorId: string | null;
  requestId: string | null;
}

/**
 * Error types for the user registry service
 */
export class UserRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'UserRegistryError';
  }
}

export class IdentityNotFoundError extends UserRegistryError {
  constructor(identifier: string) {
    super(`Identity not found: ${identifier}`, 'IDENTITY_NOT_FOUND', { identifier });
    this.name = 'IdentityNotFoundError';
  }
}

export class WalletAlreadyLinkedError extends UserRegistryError {
  constructor(walletAddress: string, existingIdentityId: string) {
    super(
      `Wallet ${walletAddress} is already linked to another identity`,
      'WALLET_ALREADY_LINKED',
      { walletAddress, existingIdentityId }
    );
    this.name = 'WalletAlreadyLinkedError';
  }
}

export class IdentityAlreadyExistsError extends UserRegistryError {
  constructor(discordId: string, existingIdentityId: string) {
    super(
      `Identity already exists for Discord ID ${discordId}`,
      'IDENTITY_ALREADY_EXISTS',
      { discordId, existingIdentityId }
    );
    this.name = 'IdentityAlreadyExistsError';
  }
}

export class IdentitySuspendedError extends UserRegistryError {
  constructor(identityId: string) {
    super(`Identity ${identityId} is suspended`, 'IDENTITY_SUSPENDED', { identityId });
    this.name = 'IdentitySuspendedError';
  }
}
