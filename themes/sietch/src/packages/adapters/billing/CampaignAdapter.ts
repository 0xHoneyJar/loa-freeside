/**
 * CampaignAdapter — Campaign Management Implementation
 *
 * Manages campaign lifecycle and batch grant execution.
 * Each grant creates a credit lot via ICreditLedgerService.mintLot().
 *
 * SDD refs: §1.4 CampaignService
 * Sprint refs: Task 4.2
 *
 * @module packages/adapters/billing/CampaignAdapter
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  ICampaignService,
  CampaignConfig,
  Campaign,
  CampaignStatus,
  GrantInput,
  GrantResult,
  BatchGrantResult,
} from '../../core/ports/ICampaignService.js';
import type { ICreditLedgerService } from '../../core/ports/ICreditLedgerService.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Constants
// =============================================================================

const MAX_BATCH_SIZE = 1000;

const VALID_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
  draft: ['active'],
  active: ['paused', 'completed'],
  paused: ['active', 'completed'],
  completed: [],
  expired: [],
};

// =============================================================================
// Row Types
// =============================================================================

interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  campaign_type: string;
  status: string;
  budget_micro: number;
  spent_micro: number;
  grant_formula: string;
  grant_config: string | null;
  pool_id: string | null;
  per_wallet_cap_micro: number;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Helpers
// =============================================================================

import { sqliteTimestamp } from './protocol/timestamps';

const sqliteNow = sqliteTimestamp;

function rowToCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    campaignType: row.campaign_type as Campaign['campaignType'],
    status: row.status as CampaignStatus,
    budgetMicro: BigInt(row.budget_micro),
    spentMicro: BigInt(row.spent_micro),
    grantFormula: row.grant_formula as Campaign['grantFormula'],
    grantConfig: row.grant_config ? JSON.parse(row.grant_config) : null,
    poolId: row.pool_id,
    perWalletCapMicro: BigInt(row.per_wallet_cap_micro),
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// =============================================================================
// CampaignAdapter
// =============================================================================

export class CampaignAdapter implements ICampaignService {
  private db: Database.Database;
  private ledger: ICreditLedgerService;

  constructor(db: Database.Database, ledger: ICreditLedgerService) {
    this.db = db;
    this.ledger = ledger;
  }

  // ---------------------------------------------------------------------------
  // createCampaign
  // ---------------------------------------------------------------------------

  async createCampaign(config: CampaignConfig): Promise<Campaign> {
    const id = `camp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = sqliteNow();

    this.db.prepare(
      `INSERT INTO credit_campaigns
       (id, name, description, campaign_type, status, budget_micro, grant_formula,
        grant_config, pool_id, per_wallet_cap_micro, expires_at, created_by,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      config.name,
      config.description ?? null,
      config.campaignType,
      config.budgetMicro.toString(),
      config.grantFormula,
      config.grantConfig ? JSON.stringify(config.grantConfig) : null,
      config.poolId ?? null,
      (config.perWalletCapMicro ?? 5_000_000n).toString(),
      config.expiresAt ?? null,
      config.createdBy ?? null,
      now, now,
    );

    logger.info({
      event: 'billing.campaign.created',
      campaignId: id,
      name: config.name,
      type: config.campaignType,
      budgetMicro: config.budgetMicro.toString(),
    }, `Campaign created: ${config.name}`);

    return (await this.getCampaign(id))!;
  }

  // ---------------------------------------------------------------------------
  // Status Transitions
  // ---------------------------------------------------------------------------

  async activateCampaign(campaignId: string): Promise<Campaign> {
    return this.transitionStatus(campaignId, 'active');
  }

  async pauseCampaign(campaignId: string): Promise<Campaign> {
    return this.transitionStatus(campaignId, 'paused');
  }

  async completeCampaign(campaignId: string): Promise<Campaign> {
    return this.transitionStatus(campaignId, 'completed');
  }

  private async transitionStatus(
    campaignId: string,
    newStatus: CampaignStatus,
  ): Promise<Campaign> {
    const campaign = await this.getCampaign(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    const allowed = VALID_TRANSITIONS[campaign.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Invalid campaign transition: ${campaign.status} → ${newStatus}`
      );
    }

    const now = sqliteNow();
    this.db.prepare(
      `UPDATE credit_campaigns SET status = ?, updated_at = ? WHERE id = ?`
    ).run(newStatus, now, campaignId);

    logger.info({
      event: 'billing.campaign.status',
      campaignId,
      from: campaign.status,
      to: newStatus,
    }, `Campaign ${campaignId}: ${campaign.status} → ${newStatus}`);

    return (await this.getCampaign(campaignId))!;
  }

  // ---------------------------------------------------------------------------
  // getCampaign
  // ---------------------------------------------------------------------------

  async getCampaign(campaignId: string): Promise<Campaign | null> {
    const row = this.db.prepare(
      `SELECT * FROM credit_campaigns WHERE id = ?`
    ).get(campaignId) as CampaignRow | undefined;

    return row ? rowToCampaign(row) : null;
  }

  // ---------------------------------------------------------------------------
  // batchGrant
  // ---------------------------------------------------------------------------

  async batchGrant(
    campaignId: string,
    grants: GrantInput[],
  ): Promise<BatchGrantResult> {
    if (grants.length > MAX_BATCH_SIZE) {
      throw new Error(`Batch size ${grants.length} exceeds maximum ${MAX_BATCH_SIZE}`);
    }

    if (grants.length === 0) {
      return {
        campaignId,
        totalGranted: 0,
        totalFailed: 0,
        totalAmountMicro: 0n,
        grants: [],
      };
    }

    const campaign = await this.getCampaign(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    if (campaign.status !== 'active') {
      throw new Error(`Campaign ${campaignId} is ${campaign.status}, must be active`);
    }

    // Budget enforcement: check total grant amount
    const batchTotal = grants.reduce((sum, g) => sum + g.amountMicro, 0n);
    if (campaign.spentMicro + batchTotal > campaign.budgetMicro) {
      throw new Error(
        `Batch total ${batchTotal} would exceed budget. ` +
        `Remaining: ${campaign.budgetMicro - campaign.spentMicro}`
      );
    }

    // Per-wallet cap enforcement
    for (const grant of grants) {
      if (grant.amountMicro > campaign.perWalletCapMicro) {
        throw new Error(
          `Grant for ${grant.accountId} (${grant.amountMicro}) exceeds per-wallet cap (${campaign.perWalletCapMicro})`
        );
      }
    }

    const results: GrantResult[] = [];
    let totalGranted = 0;
    let totalFailed = 0;
    let totalAmountMicro = 0n;

    for (const grant of grants) {
      const grantId = `grant_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

      try {
        // Create credit lot via ledger
        const lot = await this.ledger.mintLot(
          grant.accountId,
          grant.amountMicro,
          'grant',
          {
            sourceId: `campaign-${campaignId}-${grant.accountId}`,
            poolId: campaign.poolId ?? 'general',
            idempotencyKey: `grant:${campaignId}:${grant.accountId}`,
            description: `Campaign grant: ${campaign.name}`,
          },
        );

        // Record grant
        this.db.prepare(
          `INSERT INTO credit_grants
           (id, campaign_id, account_id, lot_id, amount_micro, grant_formula,
            formula_input, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'granted', ?)`
        ).run(
          grantId, campaignId, grant.accountId, lot.id,
          grant.amountMicro.toString(), campaign.grantFormula,
          grant.formulaInput ? JSON.stringify(grant.formulaInput) : null,
          sqliteNow(),
        );

        results.push({
          grantId,
          accountId: grant.accountId,
          lotId: lot.id,
          amountMicro: grant.amountMicro,
          status: 'granted',
        });

        totalGranted++;
        totalAmountMicro += grant.amountMicro;
      } catch (err) {
        const errorMessage = (err as Error).message;

        // Record failed grant (unless it's a duplicate — idempotent)
        if (errorMessage.includes('UNIQUE constraint')) {
          // Duplicate grant — find existing
          const existing = this.db.prepare(
            `SELECT id, lot_id, amount_micro FROM credit_grants
             WHERE campaign_id = ? AND account_id = ?`
          ).get(campaignId, grant.accountId) as {
            id: string; lot_id: string; amount_micro: string;
          } | undefined;

          if (existing) {
            results.push({
              grantId: existing.id,
              accountId: grant.accountId,
              lotId: existing.lot_id,
              amountMicro: BigInt(existing.amount_micro),
              status: 'granted',
            });
            totalGranted++;
            totalAmountMicro += BigInt(existing.amount_micro);
            continue;
          }
        }

        // Record failure
        try {
          this.db.prepare(
            `INSERT OR IGNORE INTO credit_grants
             (id, campaign_id, account_id, amount_micro, grant_formula,
              formula_input, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)`
          ).run(
            grantId, campaignId, grant.accountId,
            grant.amountMicro.toString(), campaign.grantFormula,
            grant.formulaInput ? JSON.stringify(grant.formulaInput) : null,
            sqliteNow(),
          );
        } catch {
          // Ignore insert failure for failed grants
        }

        results.push({
          grantId,
          accountId: grant.accountId,
          lotId: '',
          amountMicro: grant.amountMicro,
          status: 'failed',
        });

        totalFailed++;

        logger.error({
          event: 'billing.grant.failed',
          campaignId,
          accountId: grant.accountId,
          err: errorMessage,
        }, `Grant failed for ${grant.accountId}`);
      }
    }

    // Update campaign spent
    if (totalAmountMicro > 0n) {
      this.db.prepare(
        `UPDATE credit_campaigns
         SET spent_micro = spent_micro + ?, updated_at = ?
         WHERE id = ?`
      ).run(totalAmountMicro.toString(), sqliteNow(), campaignId);
    }

    logger.info({
      event: 'billing.campaign.batch',
      campaignId,
      totalGranted,
      totalFailed,
      totalAmountMicro: totalAmountMicro.toString(),
    }, `Batch grant: ${totalGranted} granted, ${totalFailed} failed`);

    return {
      campaignId,
      totalGranted,
      totalFailed,
      totalAmountMicro,
      grants: results,
    };
  }
}
