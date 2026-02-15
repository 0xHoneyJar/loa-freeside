/**
 * Admin API Routes (v4.0 - Sprint 26)
 *
 * Admin-only endpoints for:
 * - Fee waiver management (grant, revoke, list)
 * - Subscription management (list, manual overrides)
 * - Billing audit log queries
 * - System administration
 *
 * All routes require API key authentication.
 * All actions are logged in billing_audit_log.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './middleware.js';
import {
  adminRateLimiter,
  authRateLimiter,
  requireApiKeyAsync,
  ValidationError,
  NotFoundError,
} from './middleware.js';
import { config, isBillingEnabled, isVaultEnabled, getVaultClientConfig } from '../config.js';
import { waiverService, billingAuditService, gatekeeperService } from '../services/billing/index.js';
import {
  getSubscriptionByCommunityId,
  getAllActiveFeeWaivers,
  updateSubscription,
  logBillingAuditEvent,
} from '../db/billing-queries.js';
import { logger } from '../utils/logger.js';
import type {
  SubscriptionTier,
  SubscriptionStatus,
  FeeWaiver,
  BillingAuditEventType,
} from '../types/billing.js';
import { VaultSigningAdapter, VaultSecretError } from '../packages/adapters/vault/index.js';
import type { SigningAuditLog } from '../packages/core/ports/ISigningAdapter.js';
import { AdminApiKeyService } from '../services/security/AdminApiKeyService.js';

// =============================================================================
// Router Setup
// =============================================================================

export const adminRouter = Router();

// Sprint 252 (G-1): Explicit rate limiting and authentication on this router.
// Previously relied on middleware from the preceding adminRouter mount in server.ts,
// which was correct but fragile — if mount order changed, these routes would be
// unprotected. Defense-in-depth: apply directly so this router is self-contained.
adminRouter.use(requireApiKeyAsync);
adminRouter.use(adminRateLimiter);

// =============================================================================
// Middleware: Check Billing Enabled
// =============================================================================

function requireBillingEnabled(req: AuthenticatedRequest, res: Response, next: Function) {
  if (!isBillingEnabled()) {
    res.status(503).json({
      error: 'Billing system not enabled',
      message: 'The billing system is currently disabled',
    });
    return;
  }
  next();
}

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Grant waiver request schema
 */
const grantWaiverSchema = z.object({
  community_id: z.string().min(1),
  tier: z.enum(['starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise']).default('enterprise'),
  reason: z.string().min(10).max(500),
  expires_at: z.string().datetime().optional(),
  internal_notes: z.string().max(1000).optional(),
});

/**
 * Revoke waiver request schema
 */
const revokeWaiverSchema = z.object({
  reason: z.string().min(10).max(500),
});

/**
 * List waivers query schema
 */
const listWaiversSchema = z.object({
  include_inactive: z.string().transform(val => val === 'true').default('false'),
  community_id: z.string().optional(),
});

/**
 * Update subscription request schema
 */
const updateSubscriptionSchema = z.object({
  tier: z.enum(['starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise']).optional(),
  status: z.enum(['active', 'past_due', 'canceled', 'trialing', 'unpaid']).optional(),
  grace_until: z.string().datetime().optional().nullable(),
});

/**
 * Query audit log schema
 */
const queryAuditLogSchema = z.object({
  limit: z.string().transform(val => parseInt(val, 10)).default('100'),
  event_type: z.string().optional(),
  community_id: z.string().optional(),
  since: z.string().datetime().optional(),
});

// =============================================================================
// Fee Waiver Management Routes
// =============================================================================

/**
 * POST /admin/waivers
 * Grant a fee waiver to a community
 */
adminRouter.post(
  '/waivers',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const body = grantWaiverSchema.parse(req.body);

      // Get admin username from auth context
      const grantedBy = req.apiKeyId ?? 'api-key';

      logger.info(
        { communityId: body.community_id, tier: body.tier, grantedBy },
        'Admin granting fee waiver'
      );

      // Grant waiver
      const result = await waiverService.grantWaiver({
        communityId: body.community_id,
        tier: body.tier,
        reason: body.reason,
        grantedBy,
        expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
        internalNotes: body.internal_notes,
      });

      res.status(201).json({
        success: true,
        waiver: {
          id: result.waiver.id,
          community_id: result.waiver.communityId,
          tier: result.waiver.tier,
          reason: result.waiver.reason,
          granted_by: result.waiver.grantedBy,
          granted_at: result.waiver.grantedAt.toISOString(),
          expires_at: result.waiver.expiresAt?.toISOString() || null,
          created_at: result.waiver.createdAt.toISOString(),
        },
        previous_waiver_revoked: result.previousWaiverRevoked,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to grant waiver');

      if ((error as Error).message.includes('already has')) {
        res.status(409).json({
          error: 'Conflict',
          message: (error as Error).message,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/waivers
 * List all fee waivers (optionally including inactive)
 */
adminRouter.get(
  '/waivers',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate query params
      const query = listWaiversSchema.parse(req.query);

      logger.debug(
        { includeInactive: query.include_inactive, communityId: query.community_id },
        'Admin listing waivers'
      );

      // List waivers
      const waivers = waiverService.listWaivers({
        includeInactive: query.include_inactive,
        communityId: query.community_id,
      });

      res.json({
        success: true,
        count: waivers.length,
        waivers: waivers.map((w) => ({
          id: w.id,
          community_id: w.communityId,
          tier: w.tier,
          reason: w.reason,
          granted_by: w.grantedBy,
          granted_at: w.grantedAt.toISOString(),
          expires_at: w.expiresAt?.toISOString() || null,
          revoked_at: w.revokedAt?.toISOString() || null,
          revoked_by: w.revokedBy || null,
          revoke_reason: w.revokeReason || null,
          is_active: !w.revokedAt && (!w.expiresAt || w.expiresAt > new Date()),
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to list waivers');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * DELETE /admin/waivers/:communityId
 * Revoke a fee waiver
 */
adminRouter.delete(
  '/waivers/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      // Validate request body
      const body = revokeWaiverSchema.parse(req.body);

      // Get admin username from auth context
      const revokedBy = req.apiKeyId ?? 'api-key';

      logger.info(
        { communityId, revokedBy },
        'Admin revoking fee waiver'
      );

      // Revoke waiver
      await waiverService.revokeWaiver({
        communityId,
        reason: body.reason,
        revokedBy: revokedBy || 'api-key',
      });

      res.json({
        success: true,
        message: 'Fee waiver revoked successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to revoke waiver');

      if ((error as Error).message.includes('No active waiver')) {
        res.status(404).json({
          error: 'Not found',
          message: (error as Error).message,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/waivers/:communityId
 * Get waiver info for a specific community
 */
adminRouter.get(
  '/waivers/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      const info = waiverService.getWaiverInfo(communityId);

      res.json({
        success: true,
        has_waiver: info.hasWaiver,
        waiver: info.waiver ? {
          id: info.waiver.id,
          community_id: info.waiver.communityId,
          tier: info.waiver.tier,
          reason: info.waiver.reason,
          granted_by: info.waiver.grantedBy,
          granted_at: info.waiver.grantedAt.toISOString(),
          expires_at: info.waiver.expiresAt?.toISOString() || null,
        } : null,
        is_expiring_soon: info.isExpiringSoon,
        days_until_expiry: info.daysUntilExpiry,
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get waiver info');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// Subscription Management Routes
// =============================================================================

/**
 * GET /admin/subscriptions
 * List all subscriptions (with optional filters)
 */
adminRouter.get(
  '/subscriptions',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // For now, we don't have a getAllSubscriptions query
      // This would need to be added to billing-queries.ts
      // For Sprint 26, we'll return a placeholder

      res.json({
        success: true,
        message: 'Subscription listing not yet implemented',
        note: 'Query specific subscriptions via /admin/subscriptions/:communityId',
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to list subscriptions');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/subscriptions/:communityId
 * Get subscription details for a community
 */
adminRouter.get(
  '/subscriptions/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      const subscription = getSubscriptionByCommunityId(communityId);

      if (!subscription) {
        res.status(404).json({
          error: 'Not found',
          message: `No subscription found for community ${communityId}`,
        });
        return;
      }

      res.json({
        success: true,
        subscription: {
          id: subscription.id,
          community_id: subscription.communityId,
          payment_customer_id: subscription.paymentCustomerId || null,
          payment_subscription_id: subscription.paymentSubscriptionId || null,
          payment_provider: subscription.paymentProvider,
          tier: subscription.tier,
          status: subscription.status,
          grace_until: subscription.graceUntil?.toISOString() || null,
          current_period_start: subscription.currentPeriodStart?.toISOString() || null,
          current_period_end: subscription.currentPeriodEnd?.toISOString() || null,
          created_at: subscription.createdAt.toISOString(),
          updated_at: subscription.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get subscription');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * PATCH /admin/subscriptions/:communityId
 * Manual subscription override (admin only)
 */
adminRouter.patch(
  '/subscriptions/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      // Validate request body
      const body = updateSubscriptionSchema.parse(req.body);

      // Get admin username from auth context
      const actor = req.apiKeyId ?? 'api-key';

      logger.warn(
        { communityId, changes: body, actor },
        'Admin manually updating subscription'
      );

      // Check if subscription exists
      const existing = getSubscriptionByCommunityId(communityId);
      if (!existing) {
        res.status(404).json({
          error: 'Not found',
          message: `No subscription found for community ${communityId}`,
        });
        return;
      }

      // Update subscription
      const success = updateSubscription(communityId, {
        tier: body.tier,
        status: body.status,
        graceUntil: body.grace_until ? new Date(body.grace_until) : undefined,
      });

      if (!success) {
        res.status(500).json({
          error: 'Update failed',
          message: 'Failed to update subscription',
        });
        return;
      }

      // Log audit event
      logBillingAuditEvent(
        'subscription_updated',
        {
          oldTier: existing.tier,
          newTier: body.tier || existing.tier,
          changes: body,
          manual_override: true,
        },
        communityId,
        actor
      );

      // Invalidate cache
      await gatekeeperService.invalidateCache(communityId);

      // Get updated subscription
      const updated = getSubscriptionByCommunityId(communityId);

      res.json({
        success: true,
        message: 'Subscription updated successfully',
        subscription: updated ? {
          id: updated.id,
          community_id: updated.communityId,
          tier: updated.tier,
          status: updated.status,
          grace_until: updated.graceUntil?.toISOString() || null,
          updated_at: updated.updatedAt.toISOString(),
        } : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to update subscription');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// Audit Log Routes
// =============================================================================

/**
 * GET /admin/audit-log
 * Query billing audit log
 */
adminRouter.get(
  '/audit-log',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate query params
      const query = queryAuditLogSchema.parse(req.query);

      logger.debug({ query }, 'Admin querying audit log');

      // Query audit log
      const result = billingAuditService.queryAuditLog({
        limit: query.limit,
        eventType: query.event_type as BillingAuditEventType | undefined,
        communityId: query.community_id,
        since: query.since ? new Date(query.since) : undefined,
      });

      res.json({
        success: true,
        count: result.entries.length,
        has_more: result.hasMore,
        entries: result.entries.map((e) => ({
          id: e.id,
          event_type: e.eventType,
          community_id: e.communityId || null,
          event_data: e.eventData,
          actor: e.actor || null,
          created_at: e.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to query audit log');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/audit-log/statistics
 * Get audit log statistics
 */
adminRouter.get(
  '/audit-log/statistics',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { community_id } = req.query;

      const stats = billingAuditService.getStatistics(
        community_id as string | undefined
      );

      res.json({
        success: true,
        statistics: {
          event_counts: stats.eventCounts,
          total_events: stats.totalEvents,
          oldest_event: stats.oldestEvent?.toISOString() || null,
          newest_event: stats.newestEvent?.toISOString() || null,
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get audit log statistics');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// Vault Key Management Routes (Sprint 71: CRIT-2)
// =============================================================================

/**
 * Key rotation request schema
 */
const keyRotationSchema = z.object({
  key_name: z.string().min(1).max(100).optional(),
  force: z.boolean().default(false),
  reason: z.string().min(10).max(500),
});

/**
 * Key revocation request schema
 */
const keyRevocationSchema = z.object({
  key_name: z.string().min(1).max(100).optional(),
  key_version: z.number().int().positive(),
  reason: z.string().min(10).max(500),
  mfa_token: z.string().min(6).max(10), // MFA required for revocation
});

/**
 * Middleware: Check Vault Enabled
 */
function requireVaultEnabled(req: AuthenticatedRequest, res: Response, next: Function) {
  if (!isVaultEnabled()) {
    res.status(503).json({
      error: 'Vault not enabled',
      message: 'The Vault secrets management system is not configured. Set FEATURE_VAULT_ENABLED=true and configure VAULT_ADDR, VAULT_TOKEN.',
    });
    return;
  }
  next();
}

/**
 * POST /admin/keys/rotate
 * Rotate a signing key in Vault Transit
 *
 * Rotates the key to a new version. Old signatures remain valid.
 * New signatures will use the new key version.
 */
adminRouter.post(
  '/keys/rotate',
  requireVaultEnabled,
  authRateLimiter, // Sprint 252: Stricter 10 req/min for key operations
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const body = keyRotationSchema.parse(req.body);
      const actor = req.apiKeyId ?? 'api-key';

      logger.info(
        { keyName: body.key_name, actor, force: body.force },
        'Admin initiating key rotation'
      );

      // Get Vault config
      const vaultConfig = getVaultClientConfig();
      const keyName = body.key_name || vaultConfig.signingKeyName;

      // Create adapter and rotate key
      const adapter = new VaultSigningAdapter({
        vaultAddr: vaultConfig.addr,
        vaultToken: vaultConfig.token,
        vaultNamespace: vaultConfig.namespace,
        keyName,
        requestTimeout: vaultConfig.requestTimeout,
        logger,
      });

      // VaultSigningAdapter is ready after construction - no initialize() needed
      const result = await adapter.rotateKey();

      // Log audit event
      logBillingAuditEvent(
        'key_rotated' as BillingAuditEventType,
        {
          keyName,
          oldVersion: result.previousVersion,
          newVersion: result.newVersion,
          reason: body.reason,
          force: body.force,
        },
        undefined,
        actor
      );

      logger.warn(
        { keyName, oldVersion: result.previousVersion, newVersion: result.newVersion, actor },
        'Signing key rotated successfully'
      );

      res.json({
        success: true,
        rotation: {
          key_name: keyName,
          old_version: result.previousVersion,
          new_version: result.newVersion,
          rotated_at: result.rotatedAt.toISOString(),
          grace_period_ends: new Date(result.rotatedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        },
        message: 'Key rotated successfully. Old versions remain valid for signature verification.',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to rotate key');

      if ((error as Error).name === 'VaultUnavailableError') {
        res.status(503).json({
          error: 'Vault unavailable',
          message: 'Could not connect to Vault server. Please try again later.',
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * POST /admin/keys/revoke
 * Emergency revocation of a key version
 *
 * WARNING: This is a destructive operation. Signatures made with
 * the revoked key version will no longer be verifiable.
 *
 * Requires MFA token for authorization.
 */
adminRouter.post(
  '/keys/revoke',
  requireVaultEnabled,
  authRateLimiter, // Sprint 252: Stricter 10 req/min for key operations
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const body = keyRevocationSchema.parse(req.body);
      const actor = req.apiKeyId ?? 'api-key';

      // Validate MFA token (simplified - in production this would use TOTP or similar)
      // For now, we just check that a token was provided
      if (!body.mfa_token || body.mfa_token.length < 6) {
        res.status(401).json({
          error: 'MFA required',
          message: 'A valid MFA token is required for key revocation.',
        });
        return;
      }

      logger.warn(
        { keyName: body.key_name, keyVersion: body.key_version, actor },
        'Admin initiating EMERGENCY key revocation'
      );

      // Get Vault config
      const vaultConfig = getVaultClientConfig();
      const keyName = body.key_name || vaultConfig.signingKeyName;

      // Create adapter and revoke key version
      const adapter = new VaultSigningAdapter({
        vaultAddr: vaultConfig.addr,
        vaultToken: vaultConfig.token,
        vaultNamespace: vaultConfig.namespace,
        keyName,
        requestTimeout: vaultConfig.requestTimeout,
        logger,
      });

      // VaultSigningAdapter is ready after construction - no initialize() needed
      // Revoke the policy for this key version (makes it unusable)
      // Note: Actual key deletion would require Vault admin permissions
      await adapter.revokePolicy(String(body.key_version));

      // Log audit event
      logBillingAuditEvent(
        'key_revoked' as BillingAuditEventType,
        {
          keyName,
          keyVersion: body.key_version,
          reason: body.reason,
          emergency: true,
        },
        undefined,
        actor
      );

      logger.fatal(
        { keyName, keyVersion: body.key_version, actor, reason: body.reason },
        'EMERGENCY: Signing key version REVOKED'
      );

      res.json({
        success: true,
        revocation: {
          key_name: keyName,
          key_version: body.key_version,
          revoked_at: new Date().toISOString(),
          reason: body.reason,
        },
        warning: 'Key version has been revoked. Signatures made with this version can no longer be verified.',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to revoke key');

      if ((error as Error).name === 'VaultUnavailableError') {
        res.status(503).json({
          error: 'Vault unavailable',
          message: 'Could not connect to Vault server. Please try again later.',
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/keys/status
 * Get status of signing keys in Vault
 */
adminRouter.get(
  '/keys/status',
  requireVaultEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Get Vault config
      const vaultConfig = getVaultClientConfig();

      // Create adapter and get key info
      const adapter = new VaultSigningAdapter({
        vaultAddr: vaultConfig.addr,
        vaultToken: vaultConfig.token,
        vaultNamespace: vaultConfig.namespace,
        keyName: vaultConfig.signingKeyName,
        requestTimeout: vaultConfig.requestTimeout,
        logger,
      });

      // VaultSigningAdapter is ready after construction - no initialize() needed
      const publicKey = await adapter.getPublicKey();
      const auditLogs = await adapter.getAuditLogs();

      res.json({
        success: true,
        key_status: {
          vault_addr: vaultConfig.addr,
          key_name: vaultConfig.signingKeyName,
          public_key: publicKey,
          recent_operations: auditLogs.slice(-10).map((log: SigningAuditLog) => ({
            timestamp: log.timestamp.toISOString(),
            operation: log.operation,
            key_version: log.keyVersion,
            success: log.success,
          })),
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get key status');

      if ((error as Error).name === 'VaultUnavailableError') {
        res.status(503).json({
          error: 'Vault unavailable',
          message: 'Could not connect to Vault server.',
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// System Status Routes
// =============================================================================

/**
 * GET /admin/status
 * Get overall billing system status
 */
adminRouter.get(
  '/status',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const billingEnabled = isBillingEnabled();
      const vaultEnabled = isVaultEnabled();
      const activeWaiverCount = waiverService.getActiveWaiverCount();

      res.json({
        success: true,
        status: {
          billing_enabled: billingEnabled,
          vault_enabled: vaultEnabled,
          active_waivers: activeWaiverCount,
          paddle_configured: !!config.paddle?.apiKey,
          redis_configured: !!config.redis?.url,
          vault_configured: !!config.vault?.addr,
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get status');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// API Key Management Routes (Sprint 73 - HIGH-1)
// =============================================================================

/**
 * API key rotation request schema
 */
const rotateApiKeySchema = z.object({
  admin_name: z.string().min(1, 'Admin name is required').max(100),
  current_key_hint: z.string().max(8).optional(), // Last 8 chars for identification
  grace_period_hours: z.coerce.number().int().min(1).max(168).default(24), // 1-168 hours
});

/**
 * POST /admin/api-keys/rotate
 * Generate a new API key with bcrypt hashing
 *
 * Sprint 73 (HIGH-1): Secure API key rotation endpoint.
 *
 * Features:
 * - Generates cryptographically secure random key
 * - Returns bcrypt hash for storage in environment
 * - Key is shown ONLY ONCE - cannot be retrieved later
 * - Supports grace period for seamless migration
 *
 * @example
 * Request:
 * {
 *   "admin_name": "deploy_bot",
 *   "grace_period_hours": 24
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "key": {
 *     "api_key": "ak_aBc123...", // COPY THIS - shown only once!
 *     "key_hint": "aBc123ef",
 *     "key_hash": "$2b$12$...",   // Add this to ADMIN_API_KEYS env
 *     "admin_name": "deploy_bot",
 *     "grace_period_hours": 24,
 *     "env_format": "$2b$12$...:deploy_bot" // Ready-to-paste format
 *   }
 * }
 */
adminRouter.post(
  '/api-keys/rotate',
  authRateLimiter, // Sprint 252: Stricter 10 req/min for key operations
  async (req: AuthenticatedRequest, res: Response) => {
    const result = rotateApiKeySchema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues.map((i) => i.message).join(', ');
      res.status(400).json({ error: 'Validation error', message: errors });
      return;
    }

    const { admin_name, current_key_hint, grace_period_hours } = result.data;

    try {
      const keyService = new AdminApiKeyService({ bcryptRounds: 12 });

      // Generate new key
      const { apiKey, keyHint, keyHash, adminName } = await keyService.generateKey(admin_name);

      // Log the rotation (audit trail)
      logger.info(
        {
          adminName: req.adminName,
          targetAdmin: admin_name,
          keyHint,
          currentKeyHint: current_key_hint,
          gracePeriodHours: grace_period_hours,
        },
        'API key rotation initiated (Sprint 73 HIGH-1)'
      );

      // Return the new key - THIS IS THE ONLY TIME IT'S SHOWN
      res.json({
        success: true,
        key: {
          api_key: apiKey,
          key_hint: keyHint,
          key_hash: keyHash,
          admin_name: adminName,
          grace_period_hours: grace_period_hours,
          env_format: `${keyHash}:${adminName}`,
          instructions: [
            '1. Copy the api_key value - it will NOT be shown again',
            '2. Add the env_format value to your ADMIN_API_KEYS environment variable',
            `3. Keep the old key active for ${grace_period_hours} hours during migration`,
            '4. After migration, remove the old key from ADMIN_API_KEYS',
          ],
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'API key rotation failed');

      res.status(500).json({
        error: 'Key rotation failed',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/api-keys/info
 * Get information about configured API keys (without revealing secrets)
 *
 * Returns:
 * - Number of bcrypt-hashed keys configured
 * - Number of legacy plaintext keys (for migration tracking)
 * - Key hints for identification
 */
adminRouter.get(
  '/api-keys/info',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { legacyKeys, hashedKeys } = config.api.adminApiKeys;

      res.json({
        success: true,
        keys: {
          total: legacyKeys.size + hashedKeys.length,
          bcrypt_hashed: hashedKeys.length,
          legacy_plaintext: legacyKeys.size,
          security_status: legacyKeys.size > 0 ? 'MIGRATION_NEEDED' : 'SECURE',
          hashed_admins: hashedKeys.map((k) => k.adminName),
          legacy_admins: Array.from(legacyKeys.values()),
          recommendation:
            legacyKeys.size > 0
              ? 'Use POST /admin/api-keys/rotate to generate bcrypt-hashed keys and migrate'
              : 'All API keys are securely hashed with bcrypt',
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get API key info');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// User Registry Routes (Sprint 176)
// =============================================================================

import {
  getUserRegistryService,
  isUserRegistryServiceInitialized,
  IdentityNotFoundError,
  UserRegistryError,
} from '../services/user-registry/index.js';

/**
 * Middleware: Check User Registry Enabled
 */
function requireUserRegistryEnabled(req: AuthenticatedRequest, res: Response, next: Function) {
  if (!isUserRegistryServiceInitialized()) {
    res.status(503).json({
      error: 'User Registry not enabled',
      message: 'The User Registry service is not initialized. PostgreSQL may not be configured.',
    });
    return;
  }
  next();
}

/**
 * List users query schema
 */
const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // HIGH-1 FIX: Add max length to prevent performance issues with long search strings
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
});

/**
 * Event history query schema (HIGH-2 FIX: Add pagination)
 */
const eventHistorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * Suspend identity request schema
 */
const suspendIdentitySchema = z.object({
  reason: z.string().min(10).max(500),
  expires_at: z.string().datetime().optional(),
});

/**
 * Restore identity request schema
 */
const restoreIdentitySchema = z.object({
  reason: z.string().min(10).max(500),
});

/**
 * GET /admin/users
 * List all user identities with pagination
 */
adminRouter.get(
  '/users',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = listUsersSchema.parse(req.query);
      const userRegistry = getUserRegistryService();

      const result = await userRegistry.listUsers({
        page: query.page,
        limit: query.limit,
        search: query.search,
        status: query.status,
      });

      res.json({
        success: true,
        users: result.items.map((item) => ({
          identity_id: item.identity.identityId,
          discord_id: item.identity.discordId,
          discord_username: item.identity.discordUsername,
          primary_wallet: item.identity.primaryWallet,
          status: item.identity.status,
          created_at: item.identity.createdAt.toISOString(),
          updated_at: item.identity.updatedAt.toISOString(),
          wallet_count: item.wallets.length,
        })),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          has_more: result.hasMore,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to list users');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/users/stats
 * Get user registry statistics
 */
adminRouter.get(
  '/users/stats',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userRegistry = getUserRegistryService();
      const totalIdentities = await userRegistry.getIdentityCount();

      res.json({
        success: true,
        stats: {
          total_identities: totalIdentities,
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get user stats');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/users/by-discord/:discordId
 * Lookup identity by Discord ID
 */
adminRouter.get(
  '/users/by-discord/:discordId',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { discordId } = req.params;

      if (!discordId) {
        res.status(400).json({ error: 'Discord ID is required' });
        return;
      }

      const userRegistry = getUserRegistryService();
      const identity = await userRegistry.getIdentityByDiscordId(discordId);

      if (!identity) {
        res.status(404).json({
          error: 'Not found',
          message: `No identity found for Discord ID ${discordId}`,
        });
        return;
      }

      res.json({
        success: true,
        identity: {
          identity_id: identity.identity.identityId,
          discord_id: identity.identity.discordId,
          discord_username: identity.identity.discordUsername,
          primary_wallet: identity.identity.primaryWallet,
          status: identity.identity.status,
          created_at: identity.identity.createdAt.toISOString(),
          wallet_count: identity.wallets.length,
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to lookup user by Discord ID');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/users/by-wallet/:walletAddress
 * Lookup identity by wallet address
 */
adminRouter.get(
  '/users/by-wallet/:walletAddress',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { walletAddress } = req.params;

      if (!walletAddress) {
        res.status(400).json({ error: 'Wallet address is required' });
        return;
      }

      const userRegistry = getUserRegistryService();
      const identity = await userRegistry.getIdentityByWallet(walletAddress);

      if (!identity) {
        res.status(404).json({
          error: 'Not found',
          message: `No identity found for wallet ${walletAddress}`,
        });
        return;
      }

      res.json({
        success: true,
        identity: {
          identity_id: identity.identity.identityId,
          discord_id: identity.identity.discordId,
          discord_username: identity.identity.discordUsername,
          primary_wallet: identity.identity.primaryWallet,
          status: identity.identity.status,
          created_at: identity.identity.createdAt.toISOString(),
          wallet_count: identity.wallets.length,
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to lookup user by wallet');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/users/:identityId
 * Get detailed identity information including wallets and event history
 */
adminRouter.get(
  '/users/:identityId',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { identityId } = req.params;

      if (!identityId) {
        res.status(400).json({ error: 'Identity ID is required' });
        return;
      }

      const userRegistry = getUserRegistryService();
      const identity = await userRegistry.getIdentityById(identityId);

      if (!identity) {
        res.status(404).json({
          error: 'Not found',
          message: `Identity ${identityId} not found`,
        });
        return;
      }

      // Get event history
      const events = await userRegistry.getEventHistory(identityId);

      res.json({
        success: true,
        identity: {
          identity_id: identity.identity.identityId,
          discord_id: identity.identity.discordId,
          discord_username: identity.identity.discordUsername,
          discord_discriminator: identity.identity.discordDiscriminator,
          discord_avatar_hash: identity.identity.discordAvatarHash,
          primary_wallet: identity.identity.primaryWallet,
          twitter_handle: identity.identity.twitterHandle,
          telegram_id: identity.identity.telegramId,
          status: identity.identity.status,
          created_at: identity.identity.createdAt.toISOString(),
          updated_at: identity.identity.updatedAt.toISOString(),
          version: identity.identity.version,
        },
        wallets: identity.wallets.map((w) => ({
          wallet_id: w.walletId,
          address: w.address,
          chain_id: w.chainId,
          is_primary: w.isPrimary,
          verified_at: w.verifiedAt.toISOString(),
          verification_source: w.verificationSource,
          status: w.status,
        })),
        events: events.slice(-50).map((e) => ({
          event_id: e.eventId,
          event_type: e.eventType,
          occurred_at: e.occurredAt.toISOString(),
          source: e.source,
          actor_id: e.actorId,
        })),
        event_count: events.length,
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get user identity');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * POST /admin/users/:identityId/suspend
 * Suspend a user identity (admin action)
 */
adminRouter.post(
  '/users/:identityId/suspend',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { identityId } = req.params;

      if (!identityId) {
        res.status(400).json({ error: 'Identity ID is required' });
        return;
      }

      const body = suspendIdentitySchema.parse(req.body);
      const actor = req.apiKeyId ?? req.adminName ?? 'admin-api';

      const userRegistry = getUserRegistryService();

      // Verify identity exists
      const existing = await userRegistry.getIdentityById(identityId);
      if (!existing) {
        res.status(404).json({
          error: 'Not found',
          message: `Identity ${identityId} not found`,
        });
        return;
      }

      await userRegistry.suspendIdentity({
        identityId,
        reason: body.reason,
        suspendedBy: actor,
        expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
        source: 'admin_api',
      });

      logger.warn(
        { identityId, actor, reason: body.reason },
        'Admin suspended user identity'
      );

      res.json({
        success: true,
        message: 'Identity suspended successfully',
        identity_id: identityId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to suspend identity');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * POST /admin/users/:identityId/restore
 * Restore a suspended user identity
 */
adminRouter.post(
  '/users/:identityId/restore',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { identityId } = req.params;

      if (!identityId) {
        res.status(400).json({ error: 'Identity ID is required' });
        return;
      }

      const body = restoreIdentitySchema.parse(req.body);
      const actor = req.apiKeyId ?? req.adminName ?? 'admin-api';

      const userRegistry = getUserRegistryService();

      // Verify identity exists
      const existing = await userRegistry.getIdentityById(identityId);
      if (!existing) {
        res.status(404).json({
          error: 'Not found',
          message: `Identity ${identityId} not found`,
        });
        return;
      }

      await userRegistry.restoreIdentity({
        identityId,
        reason: body.reason,
        restoredBy: actor,
        source: 'admin_api',
      });

      logger.info(
        { identityId, actor, reason: body.reason },
        'Admin restored user identity'
      );

      res.json({
        success: true,
        message: 'Identity restored successfully',
        identity_id: identityId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to restore identity');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/users/:identityId/events
 * Get event history for an identity with pagination (HIGH-2 FIX)
 */
adminRouter.get(
  '/users/:identityId/events',
  requireUserRegistryEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { identityId } = req.params;

      if (!identityId) {
        res.status(400).json({ error: 'Identity ID is required' });
        return;
      }

      // HIGH-2 FIX: Add pagination to prevent bulk data exfiltration
      const query = eventHistorySchema.parse(req.query);
      const { page, limit } = query;
      const offset = (page - 1) * limit;

      const userRegistry = getUserRegistryService();

      // Verify identity exists
      const existing = await userRegistry.getIdentityById(identityId);
      if (!existing) {
        res.status(404).json({
          error: 'Not found',
          message: `Identity ${identityId} not found`,
        });
        return;
      }

      const allEvents = await userRegistry.getEventHistory(identityId);
      const totalEvents = allEvents.length;

      // Apply pagination
      const paginatedEvents = allEvents.slice(offset, offset + limit);

      res.json({
        success: true,
        identity_id: identityId,
        events: paginatedEvents.map((e) => ({
          event_id: e.eventId,
          event_type: e.eventType,
          event_data: e.eventData,
          occurred_at: e.occurredAt.toISOString(),
          source: e.source,
          actor_id: e.actorId,
          request_id: e.requestId,
        })),
        pagination: {
          page,
          limit,
          total: totalEvents,
          has_more: offset + paginatedEvents.length < totalEvents,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to get event history');
      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);
