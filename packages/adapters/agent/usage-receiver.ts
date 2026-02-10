/**
 * Usage Receiver — Inbound usage reports from loa-finn
 *
 * 7-step validation pipeline:
 *   1. Extract report_id from JWT claims
 *   2. Verify JWS payload signature
 *   3. Decode and parse JWS payload JSON
 *   4. Schema validate + bounds check
 *   5. report_id cross-check (JWT claim vs JWS payload)
 *   6. PG insert (idempotent via partial unique index on report_id)
 *   7. Redis INCRBY committed counter (warn-only on failure)
 *
 * @see SDD §3.2 UsageReceiver
 * @see ADR-005 Budget Unit Convention
 */

import { z } from 'zod'
import type { Redis } from 'ioredis'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type { Logger } from 'pino'
import type { S2SJwtValidator, S2SJwtPayload } from './s2s-jwt-validator.js'
import { microUsdToMicroCents, parseMicroUnit, MAX_MICRO_USD } from './budget-unit-bridge.js'
import { validatePoolClaims } from './pool-mapping.js'
import { agentUsageLog } from '../storage/agent-schema.js'

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface UsageReceiverDeps {
  s2sValidator: S2SJwtValidator
  db: PostgresJsDatabase<any>
  redis: Redis
  logger: Logger
}

export interface UsageReceiverConfig {
  /** Maximum cost per report in micro-USD (default: 100B = $100K) */
  maxCostMicroUsd: bigint
  /** Maximum report_id length (default: 256) */
  maxReportIdLength: number
}

export interface UsageReport {
  report_id: string
  community_id: string
  user_wallet: string
  model_alias: string
  prompt_tokens: number
  completion_tokens: number
  cost_micro: number | string
  pool_id?: string
  access_level?: string
  allowed_pools?: string[]
}

export interface UsageReceiverResult {
  status: 'accepted' | 'duplicate'
  report_id: string
}

// --------------------------------------------------------------------------
// Zod Schema — raw wire format (before bigint conversion)
// --------------------------------------------------------------------------

const MAX_TOKENS = 100_000_000 // 100M tokens per report

const usageReportSchema = z.object({
  report_id: z.string().min(1).max(256),
  community_id: z.string().uuid(),
  user_wallet: z.string().min(1).max(256),
  model_alias: z.string().min(1).max(64),
  prompt_tokens: z.number().int().nonnegative().max(MAX_TOKENS),
  completion_tokens: z.number().int().nonnegative().max(MAX_TOKENS),
  cost_micro: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  pool_id: z.string().min(1).max(128).optional(),
  access_level: z.string().min(1).max(64).optional(),
  allowed_pools: z.array(z.string().min(1).max(128)).optional(),
})

// --------------------------------------------------------------------------
// UsageReceiver
// --------------------------------------------------------------------------

export class UsageReceiver {
  private readonly s2sValidator: S2SJwtValidator
  private readonly db: PostgresJsDatabase<any>
  private readonly redis: Redis
  private readonly logger: Logger
  private readonly config: UsageReceiverConfig

  constructor(deps: UsageReceiverDeps, config: UsageReceiverConfig) {
    this.s2sValidator = deps.s2sValidator
    this.db = deps.db
    this.redis = deps.redis
    this.logger = deps.logger
    this.config = config
  }

  /**
   * Process an inbound usage report.
   * @param jwtClaims - Already-validated S2S JWT claims (from middleware)
   * @param jwsCompact - JWS compact serialization of the report payload
   */
  async receive(jwtClaims: S2SJwtPayload, jwsCompact: string): Promise<UsageReceiverResult> {
    // Step 1: Extract and validate report_id + jti from JWT claims
    const jwtReportId = jwtClaims.report_id
    if (!jwtReportId) {
      throw new UsageReceiverError('JWT missing report_id claim', 400)
    }
    if (jwtReportId.length > this.config.maxReportIdLength) {
      throw new UsageReceiverError('JWT report_id exceeds max length', 400)
    }
    const originalJti = jwtClaims.jti ?? jwtReportId // fallback to report_id if jti absent

    // Step 2: Verify JWS payload signature (uses same JWKS as JWT)
    const payloadBytes = await this.s2sValidator.verifyJws(jwsCompact)

    // Step 3: Decode JWS payload
    let rawPayload: unknown
    try {
      rawPayload = JSON.parse(new TextDecoder().decode(payloadBytes))
    } catch {
      throw new UsageReceiverError('JWS payload is not valid JSON', 400)
    }

    // Step 4: Schema validate + bounds check
    const parsed = usageReportSchema.safeParse(rawPayload)
    if (!parsed.success) {
      throw new UsageReceiverError(
        `Invalid usage report: ${parsed.error.issues[0]?.message ?? 'validation failed'}`,
        400,
      )
    }
    const report = parsed.data

    // Enforce configurable report_id length on payload too
    if (report.report_id.length > this.config.maxReportIdLength) {
      throw new UsageReceiverError('report_id exceeds max length', 400)
    }

    // Reject unsafe numeric cost_micro (precision already lost by JSON parser)
    if (typeof report.cost_micro === 'number' && !Number.isSafeInteger(report.cost_micro)) {
      throw new UsageReceiverError('cost_micro exceeds safe integer range — send as string', 400)
    }

    // Bounds check: cost_micro within safety cap (route through string for bigint safety)
    const costMicroRaw = typeof report.cost_micro === 'number'
      ? report.cost_micro.toString()
      : report.cost_micro
    const costMicroUsd = parseMicroUnit(costMicroRaw, 'cost_micro')
    if (costMicroUsd > this.config.maxCostMicroUsd) {
      throw new UsageReceiverError(
        `cost_micro ${costMicroUsd} exceeds cap (max: ${this.config.maxCostMicroUsd})`,
        400,
      )
    }

    // Step 5: report_id cross-check (JWT vs JWS payload)
    if (report.report_id !== jwtReportId) {
      throw new UsageReceiverError(
        `report_id mismatch: JWT="${jwtReportId}" vs payload="${report.report_id}"`,
        400,
      )
    }

    // Step 5b: Pool claim cross-validation (F-5 defense-in-depth, warn-only)
    if (report.pool_id && report.access_level && report.allowed_pools) {
      const claimResult = validatePoolClaims(
        report.pool_id,
        report.allowed_pools,
        report.access_level as any,
      )
      if (!claimResult.valid) {
        this.logger.warn(
          {
            event: 'pool-claim-mismatch',
            reportId: report.report_id,
            poolId: report.pool_id,
            accessLevel: report.access_level,
            allowedPools: report.allowed_pools,
            reason: claimResult.reason,
          },
          'Pool claim validation failed — possible key compromise or config drift',
        )
      }
    }

    // Convert micro-USD → micro-cents for arrakis storage
    const costMicroCents = microUsdToMicroCents(costMicroUsd)

    // Step 6: PG insert (idempotent — ON CONFLICT DO NOTHING via report_id unique index)
    const isDuplicate = await this.insertUsageLog(report, costMicroUsd, costMicroCents, originalJti)
    if (isDuplicate) {
      this.logger.info({ reportId: report.report_id }, 'Duplicate usage report — skipped')
      return { status: 'duplicate', report_id: report.report_id }
    }

    // Step 7: Redis INCRBY committed counter (warn-only on failure)
    await this.updateRedisCounter(report.community_id, costMicroCents)

    this.logger.info(
      { reportId: report.report_id, communityId: report.community_id, costMicroUsd: costMicroUsd.toString() },
      'Usage report accepted',
    )
    return { status: 'accepted', report_id: report.report_id }
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private async insertUsageLog(
    report: UsageReport,
    costMicroUsd: bigint,
    costMicroCents: bigint,
    originalJti: string,
  ): Promise<boolean> {
    try {
      const result = await this.db
        .insert(agentUsageLog)
        .values({
          communityId: report.community_id,
          userWallet: report.user_wallet,
          modelAlias: report.model_alias,
          promptTokens: report.prompt_tokens,
          completionTokens: report.completion_tokens,
          costCents: costMicroCents,
          estimatedCostCents: 0,
          idempotencyKey: report.report_id,
          traceId: report.report_id,
          source: 'usage-report',
          reportId: report.report_id,
          poolId: report.pool_id ?? null,
          costMicroUsd,
          originalJti,
        })
        .onConflictDoNothing()
        .returning({ id: agentUsageLog.id })

      // If no rows returned, the report_id already exists (duplicate)
      return result.length === 0
    } catch (err) {
      this.logger.error({ err, reportId: report.report_id }, 'PG insert failed')
      throw new UsageReceiverError('Internal error storing usage report', 500)
    }
  }

  private async updateRedisCounter(communityId: string, costMicroCents: bigint): Promise<void> {
    const month = getCurrentMonth()
    const key = `agent:budget:committed:${communityId}:${month}`
    try {
      // ioredis accepts string args for INCRBY (bigint-safe)
      await this.redis.incrby(key, costMicroCents.toString())
    } catch (err) {
      // Warn only — PG is source of truth, drift monitor will reconcile
      this.logger.warn({ err, key, costMicroCents: costMicroCents.toString() }, 'Redis INCRBY failed — PG is source of truth')
    }
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Get current month key in YYYY-MM format */
function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

// --------------------------------------------------------------------------
// Error
// --------------------------------------------------------------------------

export class UsageReceiverError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'UsageReceiverError'
  }
}
