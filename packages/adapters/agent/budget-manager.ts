/**
 * Budget Manager
 * Sprint S3-T4: TypeScript wrapper for budget Lua scripts
 *
 * Two-counter model (committed + reserved) with:
 * - reserve(): Atomic check-and-reserve via Lua
 * - finalize(): Idempotent move reserved→committed
 * - cancelReservation(): Immediate finalize-as-failed (actualCost=0)
 * - estimateCost(): Pricing table lookup with 2x tool-call multiplier
 * - getCurrentMonth(): "YYYY-MM" UTC format
 *
 * Fail-closed on Redis error for reserve(); fail-open (async) for finalize().
 *
 * @see SDD §4.3 Budget Manager
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { ModelAlias, UsageInfo } from '@arrakis/core/ports';
import { RESERVATION_TTL_MS } from './config.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export type BudgetResult =
  | { status: 'RESERVED'; remaining: number; limit: number; warning: boolean }
  | { status: 'ALREADY_RESERVED'; remaining: number; limit: number; warning: boolean }
  | { status: 'BUDGET_EXCEEDED'; remaining: number; limit: number; warning: boolean }
  | { status: 'INVALID_INPUT'; remaining: number; limit: number; warning: boolean };

export type FinalizeResult =
  | { status: 'FINALIZED'; actualCost: number }
  | { status: 'LATE_FINALIZE'; actualCost: number }
  | { status: 'ALREADY_FINALIZED'; actualCost: number }
  | { status: 'INVALID_INPUT'; actualCost: number };

export type ReaperResult = {
  status: 'REAPED';
  count: number;
  totalReclaimed: number;
};

/**
 * Default pricing table: cost per 1K tokens in cents (S1-T5 / S1-T7).
 * Sourced from Anthropic API pricing (2026-01): Claude 3.5 Haiku (cheap),
 * Claude 3.5 Sonnet (fast-code/reviewer), Claude 3 Opus (reasoning/native).
 * Retained as fallback when runtime pricing config is unavailable.
 * Runtime overrides: BudgetConfigProvider.getModelPricing() → Redis cache.
 */
export const DEFAULT_MODEL_PRICING: Record<ModelAlias, { inputPer1k: number; outputPer1k: number }> = {
  cheap: { inputPer1k: 0.015, outputPer1k: 0.06 },
  'fast-code': { inputPer1k: 0.08, outputPer1k: 0.24 },
  reviewer: { inputPer1k: 0.15, outputPer1k: 0.60 },
  reasoning: { inputPer1k: 1.5, outputPer1k: 6.0 },
  native: { inputPer1k: 0.3, outputPer1k: 1.2 },
};

/** Audit log entry for BullMQ queue */
export interface AuditLogEntry {
  communityId: string;
  userWallet: string;
  modelAlias: string;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  estimatedCostCents: number;
  idempotencyKey: string;
  traceId: string;
  source: 'finalize' | 'reconciliation' | 'late_finalize';
}

// --------------------------------------------------------------------------
// Lua Script Loading
// --------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESERVE_LUA = readFileSync(join(__dirname, 'lua', 'budget-reserve.lua'), 'utf-8');
const FINALIZE_LUA = readFileSync(join(__dirname, 'lua', 'budget-finalize.lua'), 'utf-8');
const REAPER_LUA = readFileSync(join(__dirname, 'lua', 'budget-reaper.lua'), 'utf-8');

// --------------------------------------------------------------------------
// Budget Manager
// --------------------------------------------------------------------------

export class BudgetManager {
  private reserveSha: string | null = null;
  private finalizeSha: string | null = null;
  private reaperSha: string | null = null;

  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly enqueueAuditLog?: (entry: AuditLogEntry) => void,
  ) {}

  // --------------------------------------------------------------------------
  // reserve() — fail-closed on Redis error
  // --------------------------------------------------------------------------

  async reserve(params: {
    communityId: string;
    userId: string;
    idempotencyKey: string;
    modelAlias: ModelAlias;
    estimatedCost: number;
  }): Promise<BudgetResult> {
    const month = getCurrentMonth();
    const nowMs = Date.now();

    const keys = [
      `agent:budget:committed:${params.communityId}:${month}`,
      `agent:budget:reserved:${params.communityId}:${month}`,
      `agent:budget:limit:${params.communityId}`,
      `agent:budget:reservation:${params.communityId}:${params.userId}:${params.idempotencyKey}`,
      `agent:budget:expiry:${params.communityId}:${month}`,
    ];
    const argv = [
      String(normalizeCostCents(params.estimatedCost)),
      params.userId,
      params.idempotencyKey,
      params.communityId,
      params.modelAlias,
      String(nowMs),
      String(RESERVATION_TTL_MS),
    ];

    try {
      const sha = await this.ensureScript('reserve');
      const result = await this.evalWithRetry(sha, 'reserve', 5, keys, argv);
      return parseBudgetResult(result as string[]);
    } catch (error) {
      // Fail-closed: deny request on Redis error (FR-3.7 / §4.4.1)
      this.logger.error({ err: error }, 'BudgetManager.reserve Redis error — fail-closed');
      return { status: 'BUDGET_EXCEEDED', remaining: 0, limit: 0, warning: false };
    }
  }

  // --------------------------------------------------------------------------
  // finalize() — fail-open (async) on Redis error
  // --------------------------------------------------------------------------

  async finalize(params: {
    communityId: string;
    userId: string;
    idempotencyKey: string;
    actualCost: number;
    usage?: UsageInfo;
    modelAlias?: string;
    traceId?: string;
  }): Promise<FinalizeResult> {
    const month = getCurrentMonth();
    const expiryMember = `${params.userId}:${params.idempotencyKey}`;

    const keys = [
      `agent:budget:committed:${params.communityId}:${month}`,
      `agent:budget:reserved:${params.communityId}:${month}`,
      `agent:budget:reservation:${params.communityId}:${params.userId}:${params.idempotencyKey}`,
      `agent:budget:expiry:${params.communityId}:${month}`,
      `agent:budget:finalized:${params.communityId}:${params.userId}:${params.idempotencyKey}`,
    ];
    const argv = [
      String(normalizeCostCents(params.actualCost)),
      expiryMember,
    ];

    try {
      const sha = await this.ensureScript('finalize');
      const result = await this.evalWithRetry(sha, 'finalize', 5, keys, argv);
      const parsed = parseFinalizeResult(result as string[]);

      // Enqueue audit log asynchronously (non-blocking)
      if (
        this.enqueueAuditLog &&
        params.usage &&
        params.modelAlias &&
        params.traceId &&
        (parsed.status === 'FINALIZED' || parsed.status === 'LATE_FINALIZE')
      ) {
        try {
          this.enqueueAuditLog({
            communityId: params.communityId,
            userWallet: params.userId,
            modelAlias: params.modelAlias,
            promptTokens: params.usage.promptTokens,
            completionTokens: params.usage.completionTokens,
            costCents: normalizeCostCents(params.actualCost),
            estimatedCostCents: 0, // filled by caller if available
            idempotencyKey: params.idempotencyKey,
            traceId: params.traceId,
            source: parsed.status === 'LATE_FINALIZE' ? 'late_finalize' : 'finalize',
          });
        } catch (auditErr) {
          this.logger.warn({ err: auditErr }, 'Failed to enqueue audit log — non-blocking');
        }
      }

      return parsed;
    } catch (error) {
      // Fail-open: log error but don't block (§4.4.1)
      this.logger.error({ err: error }, 'BudgetManager.finalize Redis error — fail-open');
      return { status: 'FINALIZED', actualCost: normalizeCostCents(params.actualCost) };
    }
  }

  // --------------------------------------------------------------------------
  // cancelReservation() — immediate finalize-as-failed (Flatline IMP-001)
  // --------------------------------------------------------------------------

  async cancelReservation(params: {
    communityId: string;
    userId: string;
    idempotencyKey: string;
  }): Promise<FinalizeResult> {
    return this.finalize({
      communityId: params.communityId,
      userId: params.userId,
      idempotencyKey: params.idempotencyKey,
      actualCost: 0,
    });
  }

  // --------------------------------------------------------------------------
  // reap() — clean expired reservations
  // --------------------------------------------------------------------------

  async reap(communityId: string): Promise<ReaperResult> {
    const month = getCurrentMonth();
    const nowMs = Date.now();
    const prefix = `agent:budget:reservation:${communityId}:`;

    const keys = [
      `agent:budget:reserved:${communityId}:${month}`,
      `agent:budget:expiry:${communityId}:${month}`,
    ];
    const argv = [String(nowMs), prefix];

    try {
      const sha = await this.ensureScript('reaper');
      const result = await this.evalWithRetry(sha, 'reaper', 2, keys, argv);
      return parseReaperResult(result as string[]);
    } catch (error) {
      this.logger.error({ err: error }, 'BudgetManager.reap Redis error');
      return { status: 'REAPED', count: 0, totalReclaimed: 0 };
    }
  }

  // --------------------------------------------------------------------------
  // estimateCost() — pricing table lookup with 2x tool multiplier (FR-7.12)
  // --------------------------------------------------------------------------

  estimateCost(params: {
    modelAlias: ModelAlias;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    hasTools: boolean;
  }): number {
    const pricing = DEFAULT_MODEL_PRICING[params.modelAlias] ?? DEFAULT_MODEL_PRICING.cheap;
    const inputTokens = Math.max(0, params.estimatedInputTokens);
    const outputTokens = Math.max(0, params.estimatedOutputTokens);
    const inputCost = (inputTokens / 1000) * pricing.inputPer1k;
    const outputCost = (outputTokens / 1000) * pricing.outputPer1k;
    const base = inputCost + outputCost;
    const multiplier = params.hasTools ? 2 : 1;
    // Return cost in cents, rounded up (pricing table is already in cents)
    return Math.ceil(base * multiplier);
  }

  // --------------------------------------------------------------------------
  // Script Management
  // --------------------------------------------------------------------------

  private async ensureScript(name: 'reserve' | 'finalize' | 'reaper'): Promise<string> {
    const shaMap = { reserve: this.reserveSha, finalize: this.finalizeSha, reaper: this.reaperSha };
    const luaMap = { reserve: RESERVE_LUA, finalize: FINALIZE_LUA, reaper: REAPER_LUA };

    if (shaMap[name]) return shaMap[name]!;

    const sha = (await this.redis.script('LOAD', luaMap[name])) as string;
    if (name === 'reserve') this.reserveSha = sha;
    else if (name === 'finalize') this.finalizeSha = sha;
    else this.reaperSha = sha;
    return sha;
  }

  private async evalWithRetry(
    sha: string,
    name: 'reserve' | 'finalize' | 'reaper',
    numKeys: number,
    keys: string[],
    argv: string[],
  ): Promise<unknown> {
    try {
      return await this.redis.evalsha(sha, numKeys, ...keys, ...argv);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('NOSCRIPT')) {
        // Script evicted — reload and retry once
        if (name === 'reserve') this.reserveSha = null;
        else if (name === 'finalize') this.finalizeSha = null;
        else this.reaperSha = null;
        const newSha = await this.ensureScript(name);
        return await this.redis.evalsha(newSha, numKeys, ...keys, ...argv);
      }
      throw err;
    }
  }
}

// --------------------------------------------------------------------------
// Result Parsers
// --------------------------------------------------------------------------

export function parseBudgetResult(raw: string[]): BudgetResult {
  const status = raw?.[0] as BudgetResult['status'] ?? 'INVALID_INPUT';
  const remaining = safeInt(raw?.[1]);
  const limit = safeInt(raw?.[2]);
  const warning = raw?.[3] === '1';
  return { status, remaining, limit, warning };
}

export function parseFinalizeResult(raw: string[]): FinalizeResult {
  const status = raw?.[0] as FinalizeResult['status'] ?? 'INVALID_INPUT';
  const actualCost = safeInt(raw?.[1]);
  return { status, actualCost };
}

export function parseReaperResult(raw: string[]): ReaperResult {
  return {
    status: 'REAPED',
    count: safeInt(raw?.[1]),
    totalReclaimed: safeInt(raw?.[2]),
  };
}

/** Returns "YYYY-MM" in UTC (Flatline IMP-004) */
export function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function safeInt(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : def;
}

/** Normalize a cost value to a non-negative integer (cents). Rejects NaN/Infinity, rounds up. */
function normalizeCostCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.ceil(n));
}
