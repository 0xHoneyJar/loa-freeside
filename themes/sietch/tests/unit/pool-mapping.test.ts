/**
 * Pool Mapping Unit Tests
 * Sprint 3, Task 3.6: Hounfour Phase 4 — Spice Gate
 *
 * Tests resolvePoolId() for all 5 model aliases × 3 access levels (15 combinations)
 * plus edge cases for native anti-escalation and unauthorized pool fallback.
 *
 * @see AC-3.2, AC-3.4
 */

import { describe, it, expect } from 'vitest'
import {
  resolvePoolId,
  validatePoolClaims,
  isAccessLevel,
  ACCESS_LEVEL_POOLS,
  POOL_IDS,
  VALID_POOL_IDS,
  ALIAS_TO_POOL,
  type PoolId,
} from '../../../../packages/adapters/agent/pool-mapping'
import type { AccessLevel, ModelAlias } from '../../../../packages/core/ports/agent-gateway'

// --------------------------------------------------------------------------
// Constants validation
// --------------------------------------------------------------------------

describe('Pool mapping constants', () => {
  it('POOL_IDS matches loa-finn vocabulary exactly (AC-3.2)', () => {
    expect(POOL_IDS).toEqual(['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'])
  })

  it('VALID_POOL_IDS is a Set of all pool IDs', () => {
    expect(VALID_POOL_IDS.size).toBe(5)
    for (const id of POOL_IDS) {
      expect(VALID_POOL_IDS.has(id)).toBe(true)
    }
  })

  it('ACCESS_LEVEL_POOLS defines all 3 access levels', () => {
    expect(Object.keys(ACCESS_LEVEL_POOLS)).toEqual(['free', 'pro', 'enterprise'])
  })

  it('free tier: default=cheap, allowed=[cheap]', () => {
    expect(ACCESS_LEVEL_POOLS.free).toEqual({ default: 'cheap', allowed: ['cheap'] })
  })

  it('pro tier: default=fast-code, allowed=[cheap, fast-code, reviewer]', () => {
    expect(ACCESS_LEVEL_POOLS.pro).toEqual({
      default: 'fast-code',
      allowed: ['cheap', 'fast-code', 'reviewer'],
    })
  })

  it('enterprise tier: default=reviewer, allowed=all 5 pools', () => {
    expect(ACCESS_LEVEL_POOLS.enterprise).toEqual({
      default: 'reviewer',
      allowed: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
    })
  })

  it('ALIAS_TO_POOL maps 4 direct aliases (excludes native)', () => {
    expect(ALIAS_TO_POOL).toEqual({
      cheap: 'cheap',
      'fast-code': 'fast-code',
      reviewer: 'reviewer',
      reasoning: 'reasoning',
    })
  })
})

// --------------------------------------------------------------------------
// resolvePoolId — no alias (tier default)
// --------------------------------------------------------------------------

describe('resolvePoolId — no alias (tier default)', () => {
  it('free: defaults to cheap', () => {
    const result = resolvePoolId(undefined, 'free')
    expect(result.poolId).toBe('cheap')
    expect(result.allowedPools).toEqual(['cheap'])
  })

  it('pro: defaults to fast-code', () => {
    const result = resolvePoolId(undefined, 'pro')
    expect(result.poolId).toBe('fast-code')
    expect(result.allowedPools).toEqual(['cheap', 'fast-code', 'reviewer'])
  })

  it('enterprise: defaults to reviewer', () => {
    const result = resolvePoolId(undefined, 'enterprise')
    expect(result.poolId).toBe('reviewer')
    expect(result.allowedPools).toEqual(['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'])
  })
})

// --------------------------------------------------------------------------
// resolvePoolId — native alias (tier-aware)
// --------------------------------------------------------------------------

describe('resolvePoolId — native alias (tier-aware)', () => {
  it('native on free → cheap (anti-escalation, AC-3.4)', () => {
    const result = resolvePoolId('native', 'free')
    expect(result.poolId).toBe('cheap')
  })

  it('native on pro → fast-code', () => {
    const result = resolvePoolId('native', 'pro')
    expect(result.poolId).toBe('fast-code')
  })

  it('native on enterprise → reviewer (hounfour canonical default)', () => {
    const result = resolvePoolId('native', 'enterprise')
    expect(result.poolId).toBe('reviewer')
  })

  it('native always returns correct allowedPools for tier', () => {
    expect(resolvePoolId('native', 'free').allowedPools).toEqual(['cheap'])
    expect(resolvePoolId('native', 'pro').allowedPools).toEqual(['cheap', 'fast-code', 'reviewer'])
    expect(resolvePoolId('native', 'enterprise').allowedPools).toEqual(
      ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
    )
  })
})

// --------------------------------------------------------------------------
// resolvePoolId — direct aliases
// --------------------------------------------------------------------------

describe('resolvePoolId — direct aliases', () => {
  it('cheap on free → cheap', () => {
    expect(resolvePoolId('cheap', 'free').poolId).toBe('cheap')
  })

  it('cheap on pro → cheap', () => {
    expect(resolvePoolId('cheap', 'pro').poolId).toBe('cheap')
  })

  it('cheap on enterprise → cheap', () => {
    expect(resolvePoolId('cheap', 'enterprise').poolId).toBe('cheap')
  })

  it('fast-code on pro → fast-code', () => {
    expect(resolvePoolId('fast-code', 'pro').poolId).toBe('fast-code')
  })

  it('reviewer on pro → reviewer', () => {
    expect(resolvePoolId('reviewer', 'pro').poolId).toBe('reviewer')
  })

  it('reasoning on enterprise → reasoning', () => {
    expect(resolvePoolId('reasoning', 'enterprise').poolId).toBe('reasoning')
  })
})

// --------------------------------------------------------------------------
// resolvePoolId — unauthorized pool fallback (AC-3.4)
// --------------------------------------------------------------------------

describe('resolvePoolId — unauthorized pool fallback', () => {
  it('fast-code on free → falls back to cheap (not authorized)', () => {
    const result = resolvePoolId('fast-code', 'free')
    expect(result.poolId).toBe('cheap')
  })

  it('reviewer on free → falls back to cheap', () => {
    const result = resolvePoolId('reviewer', 'free')
    expect(result.poolId).toBe('cheap')
  })

  it('reasoning on free → falls back to cheap', () => {
    const result = resolvePoolId('reasoning', 'free')
    expect(result.poolId).toBe('cheap')
  })

  it('reasoning on pro → falls back to fast-code (not authorized)', () => {
    const result = resolvePoolId('reasoning', 'pro')
    expect(result.poolId).toBe('fast-code')
  })

  it('fallback preserves correct allowedPools', () => {
    const result = resolvePoolId('reasoning', 'free')
    expect(result.allowedPools).toEqual(['cheap'])
  })
})

// --------------------------------------------------------------------------
// resolvePoolId — full matrix (5 aliases × 3 tiers)
// --------------------------------------------------------------------------

describe('resolvePoolId — full matrix', () => {
  const aliases: (ModelAlias | undefined)[] = ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native', undefined]
  const levels: AccessLevel[] = ['free', 'pro', 'enterprise']

  for (const alias of aliases) {
    for (const level of levels) {
      it(`${alias ?? 'undefined'} on ${level} → valid pool`, () => {
        const result = resolvePoolId(alias, level)
        expect(VALID_POOL_IDS.has(result.poolId)).toBe(true)
        expect(result.allowedPools.length).toBeGreaterThan(0)
        for (const pool of result.allowedPools) {
          expect(VALID_POOL_IDS.has(pool)).toBe(true)
        }
      })
    }
  }
})

// --------------------------------------------------------------------------
// validatePoolClaims — confused deputy prevention (F-5)
// --------------------------------------------------------------------------

describe('validatePoolClaims — valid claims', () => {
  it('free tier: cheap in [cheap] → valid', () => {
    const result = validatePoolClaims('cheap', ['cheap'], 'free')
    expect(result).toEqual({ valid: true })
  })

  it('pro tier: fast-code in [cheap, fast-code, reviewer] → valid', () => {
    const result = validatePoolClaims('fast-code', ['cheap', 'fast-code', 'reviewer'], 'pro')
    expect(result).toEqual({ valid: true })
  })

  it('enterprise tier: architect in all 5 pools → valid', () => {
    const result = validatePoolClaims(
      'architect',
      ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
      'enterprise',
    )
    expect(result).toEqual({ valid: true })
  })

  it('order-independent: reversed allowedPools still valid', () => {
    const result = validatePoolClaims(
      'architect',
      ['architect', 'reasoning', 'reviewer', 'fast-code', 'cheap'],
      'enterprise',
    )
    expect(result).toEqual({ valid: true })
  })

  it('duplicate-tolerant: duplicated allowedPools still valid', () => {
    const result = validatePoolClaims(
      'cheap',
      ['cheap', 'cheap'],
      'free',
    )
    expect(result).toEqual({ valid: true })
  })
})

describe('validatePoolClaims — invalid claims (AC-H1.4)', () => {
  it('unknown pool_id', () => {
    const result = validatePoolClaims('nonexistent', ['cheap'], 'free')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("unknown pool_id 'nonexistent'")
  })

  it('pool_id not in allowedPools', () => {
    const result = validatePoolClaims('architect', ['cheap'], 'free')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("pool_id 'architect' not in allowed_pools")
  })

  it('architect on free tier: pool_id valid but allowedPools mismatch', () => {
    const result = validatePoolClaims(
      'architect',
      ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
      'free',
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("allowed_pools mismatch for tier 'free'")
  })

  it('cheap on enterprise with wrong allowedPools', () => {
    const result = validatePoolClaims('cheap', ['cheap'], 'enterprise')
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("allowed_pools mismatch for tier 'enterprise'")
  })

  it('pro tier with enterprise allowedPools', () => {
    const result = validatePoolClaims(
      'fast-code',
      ['cheap', 'fast-code', 'reviewer', 'reasoning', 'architect'],
      'pro',
    )
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("allowed_pools mismatch for tier 'pro'")
  })
})

describe('validatePoolClaims — all 5 pools × 3 tiers (AC-H1.3)', () => {
  const tiers: AccessLevel[] = ['free', 'pro', 'enterprise']

  for (const tier of tiers) {
    const { allowed } = ACCESS_LEVEL_POOLS[tier]

    for (const poolId of POOL_IDS) {
      const isAllowed = allowed.includes(poolId)
      it(`${poolId} on ${tier}: ${isAllowed ? 'valid' : 'pool_id not in allowed set'}`, () => {
        const result = validatePoolClaims(poolId, allowed, tier)
        if (isAllowed) {
          expect(result).toEqual({ valid: true })
        } else {
          expect(result.valid).toBe(false)
          expect(result.reason).toContain('not in allowed_pools')
        }
      })
    }
  }
})

// --------------------------------------------------------------------------
// isAccessLevel type guard (F-16: eliminate `as any` cast)
// --------------------------------------------------------------------------

describe('isAccessLevel — type guard (F-16)', () => {
  it('isAccessLevel returns true for valid levels', () => {
    expect(isAccessLevel('free')).toBe(true)
    expect(isAccessLevel('pro')).toBe(true)
    expect(isAccessLevel('enterprise')).toBe(true)
  })

  it('isAccessLevel returns false for unknown strings', () => {
    expect(isAccessLevel('unknown')).toBe(false)
    expect(isAccessLevel('')).toBe(false)
    expect(isAccessLevel('premium')).toBe(false)
    expect(isAccessLevel('FREE')).toBe(false) // case-sensitive
  })
})
