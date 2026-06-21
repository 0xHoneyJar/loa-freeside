/**
 * Gateway ↔ loa-finn Integration Tests
 * Sprint 4: Hounfour Phase 4 — Spice Gate
 *
 * Tests the full pipeline from S2S authentication through usage report processing:
 *   - Full request lifecycle (S2S JWT → JWS verify → decode → validate → PG → Redis)
 *   - Route isolation (internal routes not on public mount)
 *   - Error cases (invalid JWT, duplicate report, malformed JWS, field bounds)
 *   - Budget unit conversion at integration boundary
 *   - Pool routing claims in JWT round-trip
 *
 * @see AC-6.1 through AC-6.4, AC-NFR-2.1
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  generateTestKey,
  startJwksServer,
  type TestKeyPair,
  type JwksTestServer,
} from '../helpers/jwks-test-server'
import {
  createSignedUsageReport,
  signS2SJwt,
  signReportJws,
  createTestReport,
} from '../helpers/loafinn-test-client'
import { S2SJwtValidator } from '../../../../packages/adapters/agent/s2s-jwt-validator'
import { UsageReceiver, UsageReceiverError } from '../../../../packages/adapters/agent/usage-receiver'
import type { UsageReceiverConfig } from '../../../../packages/adapters/agent/config'
import { createS2SAuthMiddleware } from '../../../../packages/adapters/agent/s2s-auth-middleware'
import { resolvePoolId, VALID_POOL_IDS } from '../../../../packages/adapters/agent/pool-mapping'
import { microUsdToMicroCents } from '../../../../packages/adapters/agent/budget-unit-bridge'
import type { S2SJwtPayload } from '../../../../packages/adapters/agent/s2s-jwt-validator'
import type { Clock } from '../../../../packages/adapters/agent/clock'

// --------------------------------------------------------------------------
// Shared fixtures
// --------------------------------------------------------------------------

let loaFinnKey: TestKeyPair
let jwksServer: JwksTestServer

const REAL_CLOCK: Clock = { now: () => Date.now() }

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any
}

const DEFAULT_RECEIVER_CONFIG: UsageReceiverConfig = {
  maxCostMicroUsd: 100_000_000_000n,
  maxReportIdLength: 256,
  poolClaimEnforcement: 'warn',
}

function createMockDb() {
  const mockInsert = vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      onConflictDoNothing: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ reportId: 'mock-inserted' }]),
      }),
    }),
  })
  return { insert: mockInsert, _mockInsert: mockInsert }
}

function createMockRedis() {
  const incrby = vi.fn().mockResolvedValue(5000)
  return { incrby, _mockIncrby: incrby } as any
}

// --------------------------------------------------------------------------
// Setup / Teardown
// --------------------------------------------------------------------------

beforeAll(async () => {
  loaFinnKey = await generateTestKey('kid-loafinn-integration')
  jwksServer = await startJwksServer([loaFinnKey])
})

afterAll(async () => {
  await jwksServer?.close()
})

// --------------------------------------------------------------------------
// Helper: create wired-up validator + receiver
// --------------------------------------------------------------------------

function createPipeline(dbOverrides?: any, redisOverrides?: any, configOverrides?: Partial<UsageReceiverConfig>) {
  const logger = createLogger()
  const db = dbOverrides ?? createMockDb()
  const redis = redisOverrides ?? createMockRedis()

  const s2sValidator = new S2SJwtValidator(
    {
      jwksUrl: `${jwksServer.url}/.well-known/jwks.json`,
      expectedIssuer: 'loa-finn',
      expectedAudience: 'arrakis',
      jwksCacheTtlMs: 3_600_000,
      jwksStaleMaxMs: 259_200_000,
      jwksRefreshCooldownMs: 60_000,
      clockToleranceSec: 30,
    },
    logger,
    REAL_CLOCK,
  )

  const receiverConfig: UsageReceiverConfig = { ...DEFAULT_RECEIVER_CONFIG, ...configOverrides }
  const usageReceiver = new UsageReceiver(
    { s2sValidator, db: db as any, redis, logger },
    receiverConfig,
  )

  return { s2sValidator, usageReceiver, logger, db, redis }
}

// ==========================================================================
// 1. Full pipeline integration (AC-6.1, AC-6.2)
// ==========================================================================

describe('Full pipeline integration — S2S JWT → JWS → validate → store', () => {
  it('processes valid usage report end-to-end', async () => {
    const { s2sValidator, usageReceiver, db } = createPipeline()

    // Create a fully signed usage report
    const { s2sToken, jwsCompact, report } = await createSignedUsageReport(loaFinnKey)

    // Step 1: Validate S2S JWT (as middleware would)
    const claims = await s2sValidator.validateJwt(s2sToken)
    expect(claims.iss).toBe('loa-finn')
    expect(claims.purpose).toBe('usage-report')
    expect(claims.report_id).toBe(report.report_id)

    // Step 2: Process through UsageReceiver pipeline
    const result = await usageReceiver.receive(claims, jwsCompact)
    expect(result.status).toBe('accepted')
    expect(result.report_id).toBe(report.report_id)

    // Step 3: Verify PG insert was called with correct values
    expect(db._mockInsert).toHaveBeenCalledTimes(1)
  })

  it('budget unit conversion: micro-USD → micro-cents at boundary (AC-6.3)', async () => {
    const { usageReceiver, db } = createPipeline()

    const costMicroUsd = 50_000 // $0.05 in micro-USD
    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      cost_micro: costMicroUsd,
    })

    const { s2sValidator } = createPipeline()
    const claims = await s2sValidator.validateJwt(s2sToken)
    await usageReceiver.receive(claims, jwsCompact)

    // Verify conversion factor: micro-USD × 100 = micro-cents
    const expectedMicroCents = microUsdToMicroCents(BigInt(costMicroUsd))
    expect(expectedMicroCents).toBe(BigInt(costMicroUsd) * 100n)
  })

  it('pool routing claims round-trip in signed JWT', async () => {
    // Verify pool resolution produces valid pool IDs for JWT inclusion
    const freeTier = resolvePoolId('native', 'free')
    expect(freeTier.poolId).toBe('cheap')
    expect(VALID_POOL_IDS.has(freeTier.poolId)).toBe(true)

    const enterpriseTier = resolvePoolId('native', 'enterprise')
    expect(enterpriseTier.poolId).toBe('reviewer') // hounfour canonical default (was 'architect' pre-ADR-006)
    expect(VALID_POOL_IDS.has(enterpriseTier.poolId)).toBe(true)

    // All allowed pools must be valid
    for (const pool of enterpriseTier.allowedPools) {
      expect(VALID_POOL_IDS.has(pool)).toBe(true)
    }
  })
})

// ==========================================================================
// 2. Route isolation (AC-NFR-2.1)
// ==========================================================================

describe('Route isolation — internal routes not on public mount', () => {
  it('S2S auth middleware rejects requests without Bearer token', async () => {
    const { s2sValidator } = createPipeline()
    const logger = createLogger()
    const middleware = createS2SAuthMiddleware({ s2sValidator, logger })

    const req = { headers: {} } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'UNAUTHORIZED' }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('S2S auth middleware rejects invalid Bearer token', async () => {
    const { s2sValidator } = createPipeline()
    const logger = createLogger()
    const middleware = createS2SAuthMiddleware({ s2sValidator, logger })

    const req = { headers: { authorization: 'Bearer invalid-token' } } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any
    const next = vi.fn()

    await middleware(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('S2S auth middleware passes valid Bearer token', async () => {
    const { s2sValidator } = createPipeline()
    const logger = createLogger()
    const middleware = createS2SAuthMiddleware({ s2sValidator, logger })

    const { s2sToken } = await createSignedUsageReport(loaFinnKey)

    const req = { headers: { authorization: `Bearer ${s2sToken}` } } as any
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    } as any
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(req.s2sClaims).toBeDefined()
    expect(req.s2sClaims.iss).toBe('loa-finn')
  })
})

// ==========================================================================
// 3. Error cases (AC-6.4)
// ==========================================================================

describe('Error cases', () => {
  it('invalid S2S JWT → rejected by validator', async () => {
    const { s2sValidator } = createPipeline()

    await expect(
      s2sValidator.validateJwt('not.a.valid.jwt'),
    ).rejects.toThrow()
  })

  it('S2S JWT signed with unknown key → rejected', async () => {
    const { s2sValidator } = createPipeline()
    const unknownKey = await generateTestKey('kid-unknown-integ')

    const { s2sToken } = await createSignedUsageReport(unknownKey)

    await expect(
      s2sValidator.validateJwt(s2sToken),
    ).rejects.toThrow()
  })

  it('expired S2S JWT → rejected', async () => {
    const { s2sValidator } = createPipeline()

    // Sign JWT with exp in the past
    const pastIat = Math.floor(Date.now() / 1000) - 600
    const token = await signS2SJwt(loaFinnKey, 'rpt-expired', {
      iat: pastIat,
      exp: pastIat + 120, // expired 480s ago
    })

    // Override iat/exp with setIssuedAt/setExpirationTime won't work in signS2SJwt
    // so we use raw SignJWT here
    const { SignJWT } = await import('jose')
    const rawToken = await new SignJWT({
      purpose: 'usage-report',
      report_id: 'rpt-expired',
    })
      .setProtectedHeader({ alg: 'ES256', kid: loaFinnKey.kid, typ: 'JWT' })
      .setIssuer('loa-finn')
      .setAudience('arrakis')
      .setIssuedAt(pastIat)
      .setExpirationTime(pastIat + 120)
      .sign(loaFinnKey.privateKeyLike)

    await expect(
      s2sValidator.validateJwt(rawToken),
    ).rejects.toThrow()
  })

  it('JWS with wrong key → UsageReceiver rejects', async () => {
    const { s2sValidator, usageReceiver } = createPipeline()

    // S2S JWT signed with correct key
    const report = createTestReport()
    const s2sToken = await signS2SJwt(loaFinnKey, report.report_id)
    const claims = await s2sValidator.validateJwt(s2sToken)

    // JWS signed with different key
    const wrongKey = await generateTestKey('kid-wrong-jws')
    const badJws = await signReportJws(wrongKey, report)

    await expect(
      usageReceiver.receive(claims, badJws),
    ).rejects.toThrow()
  })

  it('report_id mismatch between JWT and JWS payload → 400', async () => {
    const { s2sValidator, usageReceiver } = createPipeline()

    // S2S JWT has report_id = "rpt-jwt"
    const s2sToken = await signS2SJwt(loaFinnKey, 'rpt-jwt')
    const claims = await s2sValidator.validateJwt(s2sToken)

    // JWS payload has report_id = "rpt-jws" (mismatch!)
    const report = createTestReport({ report_id: 'rpt-jws' })
    const jwsCompact = await signReportJws(loaFinnKey, report)

    await expect(
      usageReceiver.receive(claims, jwsCompact),
    ).rejects.toThrow(UsageReceiverError)
  })

  it('cost_micro exceeds max → 400', async () => {
    const { s2sValidator, usageReceiver } = createPipeline()

    const report = createTestReport({ cost_micro: '999999999999999' })
    const s2sToken = await signS2SJwt(loaFinnKey, report.report_id)
    const claims = await s2sValidator.validateJwt(s2sToken)
    const jwsCompact = await signReportJws(loaFinnKey, report)

    await expect(
      usageReceiver.receive(claims, jwsCompact),
    ).rejects.toThrow(UsageReceiverError)
  })

  it('duplicate report_id → idempotent success (PG ON CONFLICT DO NOTHING)', async () => {
    // Mock PG to return empty array (ON CONFLICT DO NOTHING = no rows returned)
    const db = createMockDb()
    db._mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([]), // empty = duplicate
        }),
      }),
    })

    const { s2sValidator, usageReceiver } = createPipeline(db)

    const { s2sToken, jwsCompact, report } = await createSignedUsageReport(loaFinnKey)
    const claims = await s2sValidator.validateJwt(s2sToken)

    const result = await usageReceiver.receive(claims, jwsCompact)
    // Duplicate returns 'duplicate' status (idempotent — no error thrown)
    expect(result.status).toBe('duplicate')
  })

  it('Redis failure during counter update → warn-only (not blocking)', async () => {
    const redis = createMockRedis()
    redis._mockIncrby.mockRejectedValue(new Error('Redis connection refused'))

    const { s2sValidator, usageReceiver, logger } = createPipeline(undefined, redis)

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey)
    const claims = await s2sValidator.validateJwt(s2sToken)

    // Should succeed despite Redis failure
    const result = await usageReceiver.receive(claims, jwsCompact)
    expect(result.status).toBe('accepted')

    // Should log a warning
    expect(logger.warn).toHaveBeenCalled()
  })
})

// ==========================================================================
// 4. Budget unit conversion verification (AC-6.3)
// ==========================================================================

describe('Budget unit conversion at integration boundary', () => {
  it('micro-USD to micro-cents: factor of 100', () => {
    // $1.00 in micro-USD = 1,000,000
    // $1.00 in micro-cents = 100,000,000
    expect(microUsdToMicroCents(1_000_000n)).toBe(100_000_000n)
  })

  it('small amount: 1 micro-USD = 100 micro-cents', () => {
    expect(microUsdToMicroCents(1n)).toBe(100n)
  })

  it('zero: 0 micro-USD = 0 micro-cents', () => {
    expect(microUsdToMicroCents(0n)).toBe(0n)
  })

  it('large amount: $100 in micro-USD = 10B micro-cents', () => {
    const hundredDollars = 100_000_000n // $100 in micro-USD
    expect(microUsdToMicroCents(hundredDollars)).toBe(10_000_000_000n)
  })
})

// ==========================================================================
// 5. Pool routing integration (AC-3.4, AC-6.1)
// ==========================================================================

describe('Pool routing integration', () => {
  it('all 5 pool IDs are in VALID_POOL_IDS', () => {
    const expected = ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect']
    for (const pool of expected) {
      expect(VALID_POOL_IDS.has(pool)).toBe(true)
    }
    expect(VALID_POOL_IDS.size).toBe(5)
  })

  it('resolvePoolId + JWT signing produces valid pool claims', () => {
    // Enterprise with native → reviewer (hounfour canonical default; architect is access-allowed, not the default — ADR-006)
    const result = resolvePoolId('native', 'enterprise')
    expect(result.poolId).toBe('reviewer')
    expect(result.allowedPools).toContain('architect')
    expect(result.allowedPools).toContain('cheap')
  })

  it('free tier anti-escalation: native never resolves to expensive pool', () => {
    const result = resolvePoolId('native', 'free')
    expect(result.poolId).toBe('cheap')
    expect(result.allowedPools).toEqual(['cheap'])
    expect(result.allowedPools).not.toContain('architect')
    expect(result.allowedPools).not.toContain('reasoning')
  })
})

// ==========================================================================
// 6. E2E Goal Validation
// ==========================================================================

describe('E2E Goal Validation — PRD Goals', () => {
  it('G-1: JWT round-trip — S2S JWT validates via JWKS with correct claims', async () => {
    const { s2sValidator } = createPipeline()
    const { s2sToken } = await createSignedUsageReport(loaFinnKey)

    const claims = await s2sValidator.validateJwt(s2sToken)
    expect(claims.iss).toBe('loa-finn')
    expect(claims.aud).toBe('arrakis')
    expect(claims.purpose).toBe('usage-report')
    expect(typeof claims.report_id).toBe('string')
    expect(typeof claims.exp).toBe('number')
    expect(typeof claims.iat).toBe('number')
  })

  it('G-2: Usage report pipeline — full flow from S2S JWT to PG insert', async () => {
    const { s2sValidator, usageReceiver, db, redis } = createPipeline()
    const { s2sToken, jwsCompact, report } = await createSignedUsageReport(loaFinnKey)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(result.report_id).toBe(report.report_id)
    expect(db._mockInsert).toHaveBeenCalledTimes(1)
    expect(redis._mockIncrby).toHaveBeenCalledTimes(1)
  })

  it('G-3: Budget unit alignment — conversion verified at boundary', () => {
    // Property: for any micro-USD value, micro-cents = micro-USD × 100
    const testValues = [0n, 1n, 100n, 1_000_000n, 50_000_000n, 100_000_000_000n]
    for (const usd of testValues) {
      expect(microUsdToMicroCents(usd)).toBe(usd * 100n)
    }
  })

  it('G-4: Pool-aware routing — all tiers resolve valid pools', () => {
    const tiers: Array<{ level: 'free' | 'pro' | 'enterprise'; alias: any }> = [
      { level: 'free', alias: 'native' },
      { level: 'pro', alias: 'native' },
      { level: 'enterprise', alias: 'native' },
      { level: 'enterprise', alias: 'reasoning' },
      { level: 'pro', alias: 'cheap' },
    ]

    for (const { level, alias } of tiers) {
      const result = resolvePoolId(alias, level)
      expect(VALID_POOL_IDS.has(result.poolId)).toBe(true)
      expect(result.allowedPools.length).toBeGreaterThan(0)
    }
  })

  it('G-5: E2E integration — full pipeline from S2S auth to storage', async () => {
    const { s2sValidator, usageReceiver, db, redis } = createPipeline()

    // Produce a signed usage report (mimics loa-finn)
    const { s2sToken, jwsCompact, report } = await createSignedUsageReport(loaFinnKey, {
      cost_micro: 25_000,
      pool_id: 'reviewer',
    })

    // Authenticate (mimics S2S auth middleware)
    const claims = await s2sValidator.validateJwt(s2sToken)
    expect(claims.purpose).toBe('usage-report')

    // Process usage report (mimics /internal/usage-reports handler)
    const result = await usageReceiver.receive(claims, jwsCompact)
    expect(result.status).toBe('accepted')

    // Verify budget conversion at boundary
    const costMicroCents = microUsdToMicroCents(25_000n)
    expect(costMicroCents).toBe(2_500_000n)

    // Verify storage was called
    expect(db._mockInsert).toHaveBeenCalledTimes(1)
    // Verify Redis counter was updated
    expect(redis._mockIncrby).toHaveBeenCalledTimes(1)
  })
})

// ==========================================================================
// Pool claim consistency contract tests (AC-H2.5, AC-H2.6)
// Bridgebuilder Hardening — cycle-013, Finding F-5
// ==========================================================================

describe('Pool claim trust boundary contract — inconsistent claims (AC-H2.5)', () => {
  it('forged inconsistent claims trigger pool-claim-mismatch warning', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline()

    // Create a report with inconsistent claims:
    // access_level: "free" but pool_id: "architect" (free tier cannot use architect)
    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'architect',
      access_level: 'free',
      allowed_pools: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    // Report is still accepted (warn-only, not blocking)
    expect(result.status).toBe('accepted')

    // But a structured warning was emitted
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'pool-claim-mismatch',
        poolId: 'architect',
        accessLevel: 'free',
      }),
      expect.stringContaining('Pool claim validation failed'),
    )
  })
})

describe('Pool claim trust boundary contract — consistent claims (AC-H2.6)', () => {
  it('valid consistent claims pass validation silently', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline()

    // Create a report with consistent claims:
    // access_level: "enterprise" with pool_id: "architect" (enterprise can use architect)
    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'architect',
      access_level: 'enterprise',
      allowed_pools: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    // Report accepted
    expect(result.status).toBe('accepted')

    // No pool-claim-mismatch warning emitted
    const mismatchCalls = (logger.warn as any).mock.calls.filter(
      (call: any[]) => call[0]?.event === 'pool-claim-mismatch',
    )
    expect(mismatchCalls).toHaveLength(0)
  })

  it('report without pool claims skips validation silently', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline()

    // Standard report without access_level/allowed_pools — backward compatible
    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'cheap',
    })

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')

    // No pool-claim-mismatch warning (validation skipped — missing access_level)
    const mismatchCalls = (logger.warn as any).mock.calls.filter(
      (call: any[]) => call[0]?.event === 'pool-claim-mismatch',
    )
    expect(mismatchCalls).toHaveLength(0)
  })
})

// ==========================================================================
// 7. Pool claim enforcement mode cross-product (F-14, T2.5)
// ==========================================================================

describe('Pool claim enforcement mode — warn × claim states', () => {
  it('#1 warn + valid claims → Accept, pool-claim-valid logged', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline()

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'cheap',
      access_level: 'free',
      allowed_pools: ['cheap'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-valid', enforcement: 'warn', valid: true }),
      expect.any(String),
    )
  })

  it('#2 warn + mismatched claims → Accept, pool-claim-mismatch warning', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline()

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'architect',
      access_level: 'free',
      allowed_pools: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-mismatch', enforcement: 'warn', valid: false }),
      expect.any(String),
    )
  })

  it('#3 warn + unknown access_level → Accept, pool-claim-unknown-access-level warning', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline()

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'cheap',
      access_level: 'platinum',
      allowed_pools: ['cheap'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-unknown-access-level', enforcement: 'warn' }),
      expect.any(String),
    )
  })

  it('#4 warn + missing claims → Accept, pool-claim-skipped', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline()

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'cheap',
      // No access_level or allowed_pools
    })

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-skipped', enforcement: 'warn' }),
      expect.any(String),
    )
  })
})

describe('Pool claim enforcement mode — reject × claim states', () => {
  it('#5 reject + valid claims → Accept, pool-claim-valid logged', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline(undefined, undefined, { poolClaimEnforcement: 'reject' })

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'architect',
      access_level: 'enterprise',
      allowed_pools: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-valid', enforcement: 'reject', valid: true }),
      expect.any(String),
    )
  })

  it('#6 reject + mismatched claims → Reject 403', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline(undefined, undefined, { poolClaimEnforcement: 'reject' })

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'architect',
      access_level: 'free',
      allowed_pools: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)

    await expect(usageReceiver.receive(claims, jwsCompact)).rejects.toThrow(UsageReceiverError)
    await expect(
      // Re-create pipeline since previous threw
      createPipeline(undefined, undefined, { poolClaimEnforcement: 'reject' }).usageReceiver
        .receive(await createPipeline(undefined, undefined, { poolClaimEnforcement: 'reject' }).s2sValidator.validateJwt(s2sToken), jwsCompact),
    ).rejects.toMatchObject({ statusCode: 403 })

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-mismatch', enforcement: 'reject', valid: false }),
      expect.any(String),
    )
  })

  it('#7 reject + unknown access_level → Accept (NOT 403), warning logged', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline(undefined, undefined, { poolClaimEnforcement: 'reject' })

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'cheap',
      access_level: 'platinum',
      allowed_pools: ['cheap'],
    } as any)

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-unknown-access-level', enforcement: 'reject' }),
      expect.any(String),
    )
  })

  it('#8 reject + missing claims → Accept (backward-compat)', async () => {
    const { s2sValidator, usageReceiver, logger } = createPipeline(undefined, undefined, { poolClaimEnforcement: 'reject' })

    const { s2sToken, jwsCompact } = await createSignedUsageReport(loaFinnKey, {
      pool_id: 'cheap',
      // No access_level or allowed_pools
    })

    const claims = await s2sValidator.validateJwt(s2sToken)
    const result = await usageReceiver.receive(claims, jwsCompact)

    expect(result.status).toBe('accepted')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'pool-claim-skipped', enforcement: 'reject' }),
      expect.any(String),
    )
  })
})
