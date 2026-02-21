/**
 * NATS Usage Finalization Consumer (Sprint 4, Task 4.4)
 *
 * Subscribes to `inference.usage.finalized` on the USAGE stream.
 * Finalizes budget reservations on receipt, acks after DB commit.
 *
 * At-least-once delivery; finalization is idempotent via UNIQUE constraint
 * on budget_reservation_id (= idempotency_key).
 *
 * Fallback: if NATS is unavailable, X-Token-Count header and the
 * reconciliation job (Task 3.4) handle finalization.
 *
 * @see SDD §4.4 Durable Usage Reporting
 */

import type { JsMsg } from 'nats';
import type { Logger } from 'pino';
import { BaseNatsConsumer, type BaseConsumerConfig, type ProcessResult } from './BaseNatsConsumer.js';
import { UsageFinalizedSchema, NATS_ROUTING, type UsageFinalizedEvent } from '@arrakis/nats-schemas';
import type { BudgetManager } from '../../../../packages/adapters/agent/budget-manager.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface UsageConsumerDeps {
  budgetManager: BudgetManager;
}

// --------------------------------------------------------------------------
// Consumer
// --------------------------------------------------------------------------

export class UsageNatsConsumer extends BaseNatsConsumer<unknown> {
  private readonly budgetManager: BudgetManager;

  constructor(deps: UsageConsumerDeps, logger: Logger) {
    const config: BaseConsumerConfig = {
      streamName: NATS_ROUTING.streams.USAGE.name,
      consumerName: 'freeside-usage-finalizer',
      filterSubjects: [NATS_ROUTING.subjects.usage.finalized],
      maxAckPending: 50,
      ackWait: 30_000,
      maxDeliver: 5,
      batchSize: 10,
    };

    super(config, logger);
    this.budgetManager = deps.budgetManager;
  }

  /**
   * Process a single usage finalization event.
   *
   * Validates the payload, then calls BudgetManager.finalize() which is
   * idempotent (UNIQUE constraint on finalization_id). Ack only after
   * successful DB commit.
   */
  async processMessage(rawPayload: unknown, msg: JsMsg): Promise<ProcessResult> {
    // 1. Validate payload schema
    const parsed = UsageFinalizedSchema.safeParse(rawPayload);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      this.log.error(
        { subject: msg.subject, issues },
        'Usage finalized event failed schema validation — terminal (will not retry)',
      );
      return { success: false, retryable: false, error: new Error(`Schema validation: ${issues}`) };
    }

    const event: UsageFinalizedEvent = parsed.data;

    this.log.info(
      {
        reservationId: event.budget_reservation_id,
        communityId: event.community_id,
        tokensUsed: event.tokens_used,
        model: event.model,
        poolUsed: event.pool_used,
      },
      'Processing usage finalization event',
    );

    // 2. Parse and convert cost with validation (non-retryable on malformed values)
    let costCents: number;
    let costUsd: number;
    try {
      const costMicro = parseMicroUsd(event.cost_micro_usd);
      costCents = microUsdToCents(costMicro);
      costUsd = microUsdToUsd(costMicro);
    } catch (err) {
      this.log.error(
        { reservationId: event.budget_reservation_id, costRaw: event.cost_micro_usd, err },
        'Invalid cost_micro_usd — terminal (will not retry)',
      );
      return { success: false, retryable: false, error: err instanceof Error ? err : new Error(String(err)) };
    }

    // 3. Finalize budget reservation
    try {
      const result = await this.budgetManager.finalize({
        communityId: event.community_id,
        userId: event.user_wallet,
        idempotencyKey: event.budget_reservation_id,
        actualCost: costCents,
        usage: {
          promptTokens: event.input_tokens,
          completionTokens: event.output_tokens,
          costUsd,
        },
        modelAlias: event.pool_used,
        traceId: event.budget_reservation_id,
      });

      this.log.info(
        {
          reservationId: event.budget_reservation_id,
          status: result.status,
        },
        'Usage finalization complete',
      );

      return { success: true };
    } catch (err) {
      // DB errors are retryable; validation errors are not
      const retryable = !(err instanceof Error && err.message.includes('validation'));
      this.log.error(
        {
          err,
          reservationId: event.budget_reservation_id,
          retryable,
        },
        'Usage finalization failed',
      );
      return { success: false, retryable, error: err instanceof Error ? err : new Error(String(err)) };
    }
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Parse micro-USD string to BigInt with validation */
function parseMicroUsd(microUsd: string): bigint {
  try {
    const value = BigInt(microUsd);
    if (value < 0n) {
      throw new Error('validation: cost_micro_usd must be non-negative');
    }
    // Safety cap: $1B in micro-USD = 1_000_000_000_000_000
    if (value > 1_000_000_000_000_000n) {
      throw new Error('validation: cost_micro_usd exceeds safety cap');
    }
    return value;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('validation:')) throw err;
    throw new Error('validation: cost_micro_usd must be a valid integer string');
  }
}

/** Convert micro-USD BigInt to cents (number) — rounds up fractional cents */
function microUsdToCents(micro: bigint): number {
  // 1 USD = 1,000,000 micro-USD = 100 cents → 1 cent = 10,000 micro-USD
  // Ceiling division: round up fractional cents (charge platform, not user)
  const remainder = micro % 10_000n;
  const cents = micro / 10_000n + (remainder > 0n ? 1n : 0n);
  return Number(cents);
}

/** Convert micro-USD BigInt to USD (number) — bounded */
function microUsdToUsd(micro: bigint): number {
  // Convert via integer division to avoid precision loss
  // Result: whole dollars + fractional from remainder
  const wholeDollars = Number(micro / 1_000_000n);
  const remainderMicro = Number(micro % 1_000_000n);
  return wholeDollars + remainderMicro / 1_000_000;
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

export function createUsageNatsConsumer(
  deps: UsageConsumerDeps,
  logger: Logger,
): UsageNatsConsumer {
  return new UsageNatsConsumer(deps, logger);
}
