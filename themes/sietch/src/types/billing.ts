/**
 * Billing Type Definitions (v4.0 - Sprint 23)
 *
 * Type definitions for the billing system including:
 * - Subscription tiers and features
 * - Paddle integration types
 * - Entitlement system types
 * - Fee waiver types
 * - Crypto payment types (Sprint 155: NOWPayments Integration)
 */

// =============================================================================
// Subscription Tiers
// =============================================================================

/**
 * Available subscription tiers
 * Ordered from lowest to highest access level
 */
export type SubscriptionTier =
  | 'starter'     // Free tier - 100 members
  | 'basic'       // $29/mo - 500 members
  | 'premium'     // $99/mo - 1000 members
  | 'exclusive'   // $199/mo - 2500 members
  | 'elite'       // $449/mo - 10000 members
  | 'enterprise'; // Custom - unlimited

/**
 * Subscription status
 */
export type SubscriptionStatus =
  | 'active'      // Paid and current
  | 'past_due'    // Payment failed, in grace period
  | 'canceled'    // Will not renew
  | 'trialing'    // Trial period
  | 'unpaid';     // Grace period expired

/**
 * Tier hierarchy for comparison (higher number = more access)
 */
export const TIER_HIERARCHY: Record<SubscriptionTier, number> = {
  starter: 0,
  basic: 1,
  premium: 2,
  exclusive: 3,
  elite: 4,
  enterprise: 5,
};

// =============================================================================
// Features
// =============================================================================

/**
 * Gated features that can be controlled by subscription tier
 */
export type Feature =
  // Core features (Starter+)
  | 'discord_bot'
  | 'basic_onboarding'
  | 'member_profiles'
  // Basic+ features
  | 'stats_leaderboard'
  | 'position_alerts'
  | 'custom_nym'
  // Premium+ features
  | 'nine_tier_system'
  | 'custom_pfp'
  | 'weekly_digest'
  | 'activity_tracking'
  | 'score_badge'           // Free for Premium+, purchasable for lower tiers
  // Exclusive+ features
  | 'admin_analytics'
  | 'naib_dynamics'
  | 'water_sharer_badge'
  // Elite+ features
  | 'custom_branding'
  | 'priority_support'
  | 'api_access'
  // Enterprise only
  | 'white_label'
  | 'dedicated_support'
  | 'custom_integrations';

/**
 * Feature access result from Gatekeeper
 */
export interface AccessResult {
  /** Whether access is granted */
  canAccess: boolean;
  /** Current subscription tier */
  tier: SubscriptionTier;
  /** Minimum tier required for this feature */
  requiredTier: SubscriptionTier;
  /** Whether currently in grace period */
  inGracePeriod: boolean;
  /** URL to upgrade subscription (if access denied) */
  upgradeUrl?: string;
  /** Human-readable reason for denial */
  reason?: string;
}

// =============================================================================
// Payment Provider
// =============================================================================

/**
 * Supported payment providers
 * - paddle: Recurring fiat subscriptions
 * - stripe: Legacy (migrated to Paddle)
 * - nowpayments: One-time crypto payments (Sprint 155)
 */
export type PaymentProvider = 'paddle' | 'stripe' | 'nowpayments';

// =============================================================================
// Subscription
// =============================================================================

/**
 * Subscription record stored in database
 */
export interface Subscription {
  /** Unique subscription ID (UUID) */
  id: string;
  /** Community identifier */
  communityId: string;
  /** Payment provider customer ID */
  paymentCustomerId?: string;
  /** Payment provider subscription ID */
  paymentSubscriptionId?: string;
  /** Payment provider (paddle or stripe) */
  paymentProvider: PaymentProvider;
  /** Current subscription tier */
  tier: SubscriptionTier;
  /** Subscription status */
  status: SubscriptionStatus;
  /** Grace period end timestamp (null if not in grace) */
  graceUntil?: Date;
  /** Current billing period start */
  currentPeriodStart?: Date;
  /** Current billing period end */
  currentPeriodEnd?: Date;
  /** Record creation timestamp */
  createdAt: Date;
  /** Record update timestamp */
  updatedAt: Date;
}

/**
 * Subscription creation parameters
 */
export interface CreateSubscriptionParams {
  communityId: string;
  paymentCustomerId?: string;
  paymentSubscriptionId?: string;
  paymentProvider?: PaymentProvider;
  tier?: SubscriptionTier;
  status?: SubscriptionStatus;
  /** Billing period start (optional, for crypto payments) */
  currentPeriodStart?: Date;
  /** Billing period end (optional, for crypto payments) */
  currentPeriodEnd?: Date;
}

/**
 * Subscription update parameters
 */
export interface UpdateSubscriptionParams {
  paymentCustomerId?: string;
  paymentSubscriptionId?: string;
  paymentProvider?: PaymentProvider;
  tier?: SubscriptionTier;
  status?: SubscriptionStatus;
  graceUntil?: Date | null;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
}

// =============================================================================
// Fee Waivers
// =============================================================================

/**
 * Fee waiver record stored in database
 */
export interface FeeWaiver {
  /** Unique waiver ID (UUID) */
  id: string;
  /** Community receiving the waiver */
  communityId: string;
  /** Tier features granted by waiver */
  tier: SubscriptionTier;
  /** Reason for granting waiver */
  reason: string;
  /** Admin who granted the waiver */
  grantedBy: string;
  /** When waiver was granted */
  grantedAt: Date;
  /** When waiver expires (null = permanent) */
  expiresAt?: Date;
  /** When waiver was revoked (null = active) */
  revokedAt?: Date;
  /** Admin who revoked (if revoked) */
  revokedBy?: string;
  /** Reason for revocation */
  revokeReason?: string;
  /** Record creation timestamp */
  createdAt: Date;
  /** Record update timestamp */
  updatedAt: Date;
}

/**
 * Fee waiver creation parameters
 */
export interface CreateFeeWaiverParams {
  communityId: string;
  tier: SubscriptionTier;
  reason: string;
  grantedBy: string;
  expiresAt?: Date;
}

/**
 * Fee waiver revocation parameters
 */
export interface RevokeFeeWaiverParams {
  revokedBy: string;
  revokeReason: string;
}

// =============================================================================
// Entitlements
// =============================================================================

/**
 * Entitlement source - how the entitlement was determined
 */
export type EntitlementSource = 'subscription' | 'waiver' | 'free' | 'boost';

/**
 * Community entitlements (cached result)
 */
export interface Entitlements {
  /** Community identifier */
  communityId: string;
  /** Effective subscription tier */
  tier: SubscriptionTier;
  /** Maximum members allowed */
  maxMembers: number;
  /** List of enabled features */
  features: Feature[];
  /** How entitlement was determined */
  source: EntitlementSource;
  /** Whether currently in grace period */
  inGracePeriod: boolean;
  /** Grace period end time (if applicable) */
  graceUntil?: Date;
  /** Cache timestamp */
  cachedAt: Date;
  /** Cache expiration timestamp */
  expiresAt: Date;
}

/**
 * Tier information for API response
 */
export interface TierInfo {
  /** Tier name */
  tier: SubscriptionTier;
  /** Display name */
  name: string;
  /** Monthly price in USD */
  price: number;
  /** Maximum members allowed */
  maxMembers: number;
  /** How entitlement was determined */
  source: EntitlementSource;
  /** Whether currently in grace period */
  inGracePeriod: boolean;
}

// =============================================================================
// Webhook Events
// =============================================================================

/**
 * Webhook event record stored in database
 */
export interface WebhookEvent {
  /** Unique event ID (UUID) */
  id: string;
  /** Provider event ID (Paddle or Stripe) */
  providerEventId: string;
  /** Event type (normalized) */
  eventType: string;
  /** Processing status */
  status: 'processing' | 'processed' | 'failed';
  /** Event payload (JSON string) */
  payload: string;
  /** Error message if failed */
  errorMessage?: string;
  /** When event was received */
  receivedAt: Date;
  /** When event was processed */
  processedAt?: Date;
  /** Record creation timestamp */
  createdAt: Date;
}

/**
 * Supported Paddle webhook event types (normalized)
 */
export type PaddleEventType =
  | 'subscription.created'
  | 'subscription.activated'
  | 'subscription.updated'
  | 'subscription.canceled'
  | 'transaction.completed'
  | 'transaction.payment_failed';

// =============================================================================
// Billing Audit Log
// =============================================================================

/**
 * Billing audit log entry
 */
export interface BillingAuditEntry {
  /** Unique entry ID */
  id: number;
  /** Event type */
  eventType: BillingAuditEventType;
  /** Community affected */
  communityId?: string;
  /** Event data (parsed JSON) */
  eventData: Record<string, unknown>;
  /** Actor who triggered the event */
  actor?: string;
  /** Event timestamp */
  createdAt: Date;
}

/**
 * Billing audit event types
 */
export type BillingAuditEventType =
  | 'subscription_created'
  | 'subscription_activated'
  | 'subscription_updated'
  | 'subscription_canceled'
  | 'subscription_paused'
  | 'subscription_resumed'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'grace_period_started'
  | 'grace_period_ended'
  | 'waiver_granted'
  | 'waiver_revoked'
  | 'feature_denied'
  | 'entitlement_cached'
  | 'webhook_processed'
  | 'webhook_failed'
  // Crypto payment events (Sprint 157: NOWPayments Integration)
  | 'crypto_payment_created'
  | 'crypto_payment_status_updated'
  | 'crypto_payment_completed'
  | 'crypto_payment_failed'
  | 'crypto_payment_expired'
  | 'crypto_webhook_received'
  | 'crypto_webhook_failed'
  | 'subscription_activated_crypto'
  // Admin reconciliation events (Sprint 318, Task 5.5)
  | 'admin_manual_reconciliation';

// =============================================================================
// Billing Service Types
// =============================================================================

/**
 * Checkout session creation parameters
 */
export interface CreateCheckoutParams {
  /** Community identifier */
  communityId: string;
  /** Target subscription tier */
  tier: SubscriptionTier;
  /** URL to redirect after successful checkout */
  successUrl: string;
  /** URL to redirect if checkout is canceled */
  cancelUrl: string;
  /** Payment provider customer ID (optional, created if not provided) */
  customerId?: string;
  /** Additional metadata */
  metadata?: Record<string, string>;
}

/**
 * Checkout session result
 */
export interface CheckoutResult {
  /** Checkout session ID */
  sessionId: string;
  /** Checkout URL to redirect user to */
  url: string;
  /** Client token for embedded checkout (Paddle.js) */
  clientToken?: string;
}

/**
 * Customer portal session creation parameters
 */
export interface CreatePortalParams {
  /** Community identifier */
  communityId: string;
  /** URL to redirect after leaving portal */
  returnUrl: string;
}

/**
 * Customer portal result
 */
export interface PortalResult {
  /** Portal URL to redirect user to */
  url: string;
}

/**
 * Subscription retrieval result
 */
export interface SubscriptionResult {
  /** Whether subscription exists */
  exists: boolean;
  /** Subscription details (if exists) */
  subscription?: Subscription;
  /** Tier information */
  tierInfo?: TierInfo;
}

// =============================================================================
// API Response Types
// =============================================================================

/**
 * Billing status API response
 */
export interface BillingStatusResponse {
  /** Whether billing is enabled */
  enabled: boolean;
  /** Current subscription (if any) */
  subscription?: {
    tier: SubscriptionTier;
    status: SubscriptionStatus;
    currentPeriodEnd?: string;
    inGracePeriod: boolean;
  };
  /** Active waiver (if any) */
  waiver?: {
    tier: SubscriptionTier;
    expiresAt?: string;
  };
  /** Effective tier (considering subscription, waiver, free) */
  effectiveTier: SubscriptionTier;
  /** Maximum members allowed */
  maxMembers: number;
}

/**
 * Entitlements API response
 */
export interface EntitlementsResponse {
  /** Community identifier */
  communityId: string;
  /** Current tier */
  tier: SubscriptionTier;
  /** Tier display name */
  tierName: string;
  /** Maximum members allowed */
  maxMembers: number;
  /** List of enabled features */
  features: Feature[];
  /** Entitlement source */
  source: EntitlementSource;
  /** Grace period status */
  inGracePeriod: boolean;
  /** Grace period end (if applicable) */
  graceUntil?: string;
}

/**
 * Feature check API response
 */
export interface FeatureCheckResponse {
  /** Feature being checked */
  feature: Feature;
  /** Whether access is granted */
  canAccess: boolean;
  /** Current tier */
  currentTier: SubscriptionTier;
  /** Required tier for feature */
  requiredTier: SubscriptionTier;
  /** Upgrade URL (if denied) */
  upgradeUrl?: string;
}

// =============================================================================
// Score Badge Types (v4.0 - Sprint 27)
// =============================================================================

/**
 * Badge display style options
 */
export type BadgeStyle = 'default' | 'minimal' | 'detailed';

/**
 * Badge purchase record stored in database
 */
export interface BadgePurchase {
  /** Unique purchase ID (UUID) */
  id: string;
  /** Member who purchased the badge */
  memberId: string;
  /** Payment provider transaction ID */
  paymentId?: string;
  /** Purchase timestamp */
  purchasedAt: Date;
  /** Record creation timestamp */
  createdAt: Date;
}

/**
 * Badge settings record stored in database
 */
export interface BadgeSettings {
  /** Member identifier (primary key) */
  memberId: string;
  /** Display badge on Discord */
  displayOnDiscord: boolean;
  /** Display badge on Telegram */
  displayOnTelegram: boolean;
  /** Badge display style */
  badgeStyle: BadgeStyle;
  /** Record creation timestamp */
  createdAt: Date;
  /** Record update timestamp */
  updatedAt: Date;
}

/**
 * Badge purchase creation parameters
 */
export interface CreateBadgePurchaseParams {
  memberId: string;
  paymentId?: string;
}

/**
 * Badge settings update parameters
 */
export interface UpdateBadgeSettingsParams {
  displayOnDiscord?: boolean;
  displayOnTelegram?: boolean;
  badgeStyle?: BadgeStyle;
}

/**
 * Badge entitlement check result
 */
export interface BadgeEntitlementResult {
  /** Whether user has badge access */
  hasAccess: boolean;
  /** Reason for access (premium tier or purchased) */
  reason: 'premium_tier' | 'purchased' | 'none';
  /** Whether purchase is required */
  purchaseRequired: boolean;
  /** Purchase price in cents (if purchase required) */
  priceInCents?: number;
  /** Price ID (if purchase required) */
  priceId?: string;
}

/**
 * Badge display result
 */
export interface BadgeDisplay {
  /** Formatted badge string */
  display: string;
  /** Whether badge is enabled for platform */
  enabled: boolean;
  /** Badge style used */
  style: BadgeStyle;
}

/**
 * Badge API response types
 */

/**
 * Badge entitlement API response
 */
export interface BadgeEntitlementResponse {
  /** Member identifier */
  memberId: string;
  /** Whether badge is accessible */
  hasAccess: boolean;
  /** Access reason */
  reason: 'premium_tier' | 'purchased' | 'none';
  /** Whether purchase is required */
  purchaseRequired: boolean;
  /** Purchase price (if required) */
  price?: string;
  /** Purchase URL (if required) */
  purchaseUrl?: string;
}

/**
 * Badge display API response
 */
export interface BadgeDisplayResponse {
  /** Member identifier */
  memberId: string;
  /** Platform (discord or telegram) */
  platform: string;
  /** Badge display string */
  display: string;
  /** Whether badge is enabled */
  enabled: boolean;
  /** Badge style */
  style: BadgeStyle;
  /** Member conviction score */
  score?: number;
  /** Member tier */
  tier?: string;
}

/**
 * Badge settings API response
 */
export interface BadgeSettingsResponse {
  /** Member identifier */
  memberId: string;
  /** Display on Discord */
  displayOnDiscord: boolean;
  /** Display on Telegram */
  displayOnTelegram: boolean;
  /** Badge style */
  badgeStyle: BadgeStyle;
}

// =============================================================================
// Community Boost Types (v4.0 - Sprint 28)
// =============================================================================

/**
 * Boost level enumeration (1-3)
 * Higher levels unlock more perks
 */
export type BoostLevel = 1 | 2 | 3;

/**
 * Boost purchase record stored in database
 */
export interface BoostPurchase {
  /** Unique purchase ID (UUID) */
  id: string;
  /** Member who purchased the boost */
  memberId: string;
  /** Community being boosted */
  communityId: string;
  /** Payment provider transaction ID */
  paymentId?: string;
  /** Number of months purchased */
  monthsPurchased: number;
  /** Amount paid in cents */
  amountPaidCents: number;
  /** Purchase timestamp */
  purchasedAt: Date;
  /** When boost expires */
  expiresAt: Date;
  /** Whether boost is still active */
  isActive: boolean;
  /** Record creation timestamp */
  createdAt: Date;
}

/**
 * Community boost aggregation (sum of all active boosts)
 */
export interface CommunityBoostStatus {
  /** Community identifier */
  communityId: string;
  /** Total number of active boosters */
  totalBoosters: number;
  /** Current boost level (1-3, 0 if none) */
  level: BoostLevel | 0;
  /** Total boost months accumulated */
  totalBoostMonths: number;
  /** Progress to next level (0-100) */
  progressToNextLevel: number;
  /** Boosts needed for next level */
  boostsNeededForNextLevel: number;
  /** Active perks at current level */
  perks: BoostPerk[];
}

/**
 * Booster perk definition
 */
export interface BoostPerk {
  /** Perk identifier */
  id: string;
  /** Perk display name */
  name: string;
  /** Perk description */
  description: string;
  /** Minimum level required */
  minLevel: BoostLevel;
  /** Whether perk is community-wide or booster-only */
  scope: 'community' | 'booster';
}

/**
 * Individual booster record
 */
export interface Booster {
  /** Member identifier */
  memberId: string;
  /** Member nym/display name */
  nym?: string;
  /** First boost date */
  firstBoostDate: Date;
  /** Most recent boost date */
  lastBoostDate: Date;
  /** Total months boosted */
  totalMonthsBoosted: number;
  /** Current active boost expiry */
  currentBoostExpiry?: Date;
  /** Whether currently boosting */
  isActive: boolean;
}

/**
 * Boost purchase creation parameters
 */
export interface CreateBoostPurchaseParams {
  memberId: string;
  communityId: string;
  paymentId?: string;
  monthsPurchased: number;
  amountPaidCents: number;
}

/**
 * Boost pricing configuration
 */
export interface BoostPricing {
  /** Price per month in cents */
  pricePerMonthCents: number;
  /** Available bundle options */
  bundles: BoostBundle[];
}

/**
 * Boost bundle option
 */
export interface BoostBundle {
  /** Number of months */
  months: number;
  /** Total price in cents */
  priceCents: number;
  /** Discount percentage (0-100) */
  discountPercent: number;
  /** Payment provider price ID */
  priceId?: string;
}

/**
 * Boost level thresholds
 */
export interface BoostLevelThresholds {
  /** Boosters needed for level 1 */
  level1: number;
  /** Boosters needed for level 2 */
  level2: number;
  /** Boosters needed for level 3 */
  level3: number;
}

// =============================================================================
// Boost API Response Types
// =============================================================================

/**
 * Boost status API response
 */
export interface BoostStatusResponse {
  /** Community identifier */
  communityId: string;
  /** Current boost level */
  level: BoostLevel | 0;
  /** Total active boosters */
  totalBoosters: number;
  /** Progress percentage to next level */
  progressPercent: number;
  /** Boosters needed for next level */
  boostersNeeded: number;
  /** Active perks */
  perks: string[];
}

/**
 * Booster list API response
 */
export interface BoosterListResponse {
  /** Community identifier */
  communityId: string;
  /** List of boosters */
  boosters: {
    memberId: string;
    nym?: string;
    monthsBoosted: number;
    isActive: boolean;
    boostExpiry?: string;
  }[];
  /** Total count */
  totalCount: number;
}

/**
 * Boost purchase API response
 */
export interface BoostPurchaseResponse {
  /** Purchase ID */
  purchaseId: string;
  /** Checkout URL (if not already purchased) */
  checkoutUrl?: string;
  /** Success indicator */
  success: boolean;
  /** New boost expiry date */
  expiresAt?: string;
  /** Updated community level */
  newLevel?: BoostLevel | 0;
}

/**
 * Boost pricing API response
 */
export interface BoostPricingResponse {
  /** Price per month in USD */
  pricePerMonth: string;
  /** Available bundles */
  bundles: {
    months: number;
    price: string;
    discountPercent: number;
  }[];
}

/**
 * Booster perks API response
 */
export interface BoosterPerksResponse {
  /** Member identifier */
  memberId: string;
  /** Whether member is a booster */
  isBooster: boolean;
  /** Booster-only perks unlocked */
  boosterPerks: string[];
  /** Community-wide perks from boost level */
  communityPerks: string[];
  /** Boost expiry date (if booster) */
  boostExpiry?: string;
}

// =============================================================================
// Crypto Payment Types (Sprint 155: NOWPayments Integration)
// =============================================================================

/**
 * Supported cryptocurrencies for payment
 */
export type CryptoCurrency =
  | 'btc'    // Bitcoin
  | 'eth'    // Ethereum
  | 'usdt'   // Tether (ERC-20)
  | 'usdc'   // USD Coin
  | 'ltc'    // Litecoin
  | 'doge'   // Dogecoin
  | 'matic'  // Polygon
  | 'sol';   // Solana

/**
 * Crypto payment status (NOWPayments statuses)
 */
export type CryptoPaymentStatus =
  | 'waiting'        // Waiting for customer payment
  | 'confirming'     // Payment received, waiting for confirmations
  | 'confirmed'      // Payment confirmed, not yet credited
  | 'sending'        // Sending funds to merchant
  | 'partially_paid' // Partial payment received
  | 'finished'       // Payment completed successfully
  | 'failed'         // Payment failed
  | 'refunded'       // Payment refunded
  | 'expired';       // Payment expired

/**
 * Crypto payment record stored in database
 */
export interface CryptoPayment {
  /** Internal UUID (cp_xxx prefix) */
  id: string;
  /** NOWPayments payment_id */
  paymentId: string;
  /** Target community for subscription */
  communityId: string;
  /** Subscription tier being purchased */
  tier: SubscriptionTier;
  /** Price amount in USD */
  priceAmount: number;
  /** Price currency (always 'usd') */
  priceCurrency: 'usd';
  /** Expected crypto amount */
  payAmount?: number;
  /** Crypto currency code */
  payCurrency?: CryptoCurrency;
  /** Blockchain address to pay to */
  payAddress?: string;
  /** Payment status */
  status: CryptoPaymentStatus;
  /** Actual amount received (may differ from payAmount) */
  actuallyPaid?: number;
  /** Our order reference for tracking */
  orderId?: string;
  /** Record creation timestamp */
  createdAt: Date;
  /** Record update timestamp */
  updatedAt: Date;
  /** Payment expiration timestamp */
  expiresAt?: Date;
  /** Timestamp when payment completed */
  finishedAt?: Date;
}

/**
 * Crypto payment creation parameters
 */
export interface CreateCryptoPaymentParams {
  /** NOWPayments payment_id */
  paymentId: string;
  /** Target community */
  communityId: string;
  /** Subscription tier */
  tier: SubscriptionTier;
  /** Price in USD */
  priceAmount: number;
  /** Expected crypto amount */
  payAmount?: number;
  /** Crypto currency */
  payCurrency?: CryptoCurrency;
  /** Payment address */
  payAddress?: string;
  /** Our order reference */
  orderId?: string;
  /** Payment expiration */
  expiresAt?: Date;
}

/**
 * Crypto payment status update parameters
 */
export interface UpdateCryptoPaymentParams {
  /** New payment status */
  status?: CryptoPaymentStatus;
  /** Actual amount received */
  actuallyPaid?: number;
  /** Timestamp when payment completed */
  finishedAt?: Date;
}

/**
 * Crypto payment list options
 */
export interface ListCryptoPaymentsOptions {
  /** Filter by community */
  communityId?: string;
  /** Filter by status */
  status?: CryptoPaymentStatus;
  /** Limit results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}
