/**
 * Eligibility Tracing Instrumentation
 * Sprint S-13: Distributed Tracing
 *
 * Instruments eligibility check handlers with distributed tracing spans.
 * Provides visibility into RPC calls, rule evaluation, and role updates.
 */

import type { Logger } from 'pino';
import type { EligibilityCheckPayload, EligibilityResult, EligibilityHandler } from '../../consumers/EligibilityNatsConsumer.js';
import { createEligibilitySpan, createRpcSpan, createDbSpan } from './NatsInstrumentation.js';
import { getTracer } from './Tracer.js';
import { SpanNames, AttributeKeys, SpanKind } from './types.js';
import { Span } from './Span.js';

/**
 * Wrap an eligibility handler with tracing
 */
export function instrumentEligibilityHandler(
  handlerName: string,
  handler: EligibilityHandler
): EligibilityHandler {
  return async (
    payload: EligibilityCheckPayload,
    log: Logger
  ): Promise<EligibilityResult | EligibilityResult[]> => {
    const tracer = getTracer();
    const userId = payload.user_id ?? 'batch';

    // Create root span for eligibility check
    const span = tracer.startSpan(SpanNames.ELIGIBILITY_CHECK, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [AttributeKeys.DISCORD_GUILD_ID]: payload.guild_id,
        [AttributeKeys.DISCORD_USER_ID]: userId,
        'eligibility.event_id': payload.event_id,
        'eligibility.event_type': payload.event_type,
        'eligibility.check_type': payload.check_type,
        'eligibility.community_id': payload.community_id,
        'eligibility.handler': handlerName,
      },
    });

    return span.runAsync(async () => {
      try {
        // Add wallet attribute if available
        if (payload.wallet_address) {
          span.setAttribute('eligibility.has_wallet', true);
          // Don't log full wallet for privacy
          span.setAttribute(
            'eligibility.wallet_prefix',
            payload.wallet_address.slice(0, 10)
          );
        }

        // Execute the actual handler
        const result = await handler(payload, log);

        // Record result metrics
        if (Array.isArray(result)) {
          span.setAttribute('eligibility.result_count', result.length);
          const eligibleCount = result.filter((r) => r.eligible).length;
          span.setAttribute('eligibility.eligible_count', eligibleCount);
        } else {
          span.setAttribute('eligibility.eligible', result.eligible);
          span.setAttribute('eligibility.tier', result.tier ?? 'none');
          span.setAttribute('eligibility.rules_passed', result.rules_passed.length);
          span.setAttribute('eligibility.rules_failed', result.rules_failed.length);
        }

        span.setOk();
        return result;
      } catch (error) {
        if (error instanceof Error) {
          span.recordException(error);
        } else {
          span.setError(String(error));
        }
        throw error;
      } finally {
        span.end();
      }
    });
  };
}

/**
 * Create a child span for RPC balance check
 */
export function createBalanceCheckSpan(
  walletAddress: string,
  chainId: string | number
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.ELIGIBILITY_RPC, {
    kind: SpanKind.CLIENT,
    attributes: {
      [AttributeKeys.RPC_METHOD]: 'eth_getBalance',
      [AttributeKeys.RPC_SERVICE]: 'ethereum',
      'rpc.chain_id': String(chainId),
      'rpc.wallet_prefix': walletAddress.slice(0, 10),
    },
  });
}

/**
 * Create a child span for token balance check
 */
export function createTokenBalanceCheckSpan(
  tokenAddress: string,
  walletAddress: string,
  chainId: string | number
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.ELIGIBILITY_RPC, {
    kind: SpanKind.CLIENT,
    attributes: {
      [AttributeKeys.RPC_METHOD]: 'balanceOf',
      [AttributeKeys.RPC_SERVICE]: 'erc20',
      'rpc.chain_id': String(chainId),
      'rpc.token_address': tokenAddress,
      'rpc.wallet_prefix': walletAddress.slice(0, 10),
    },
  });
}

/**
 * Create a span for eligibility rule evaluation
 */
export function createRuleEvaluationSpan(
  ruleId: string,
  ruleType: string
): Span {
  const tracer = getTracer();

  return tracer.startSpan('eligibility.rule.evaluate', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'eligibility.rule.id': ruleId,
      'eligibility.rule.type': ruleType,
    },
  });
}

/**
 * Create a span for eligibility cache lookup
 */
export function createEligibilityCacheSpan(
  operation: 'get' | 'set' | 'invalidate',
  userId: string,
  guildId: string
): Span {
  const tracer = getTracer();

  return tracer.startSpan(SpanNames.ELIGIBILITY_CACHE, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'cache.operation': operation,
      [AttributeKeys.DISCORD_USER_ID]: userId,
      [AttributeKeys.DISCORD_GUILD_ID]: guildId,
    },
  });
}

/**
 * Create a span for eligibility database operations
 */
export function createEligibilityDbSpan(
  operation: 'read' | 'write' | 'query',
  table: string
): Span {
  return createDbSpan(operation, 'scylladb', `eligibility.${table}`);
}

/**
 * Record RPC latency on a span
 */
export function recordRpcLatency(
  span: Span,
  startTime: number,
  success: boolean
): void {
  const latency = Date.now() - startTime;
  span.setAttribute('rpc.latency_ms', latency);
  span.setAttribute('rpc.success', success);

  if (success) {
    span.setOk();
  } else {
    span.setError('RPC call failed');
  }

  span.end();
}

/**
 * Instrument all eligibility handlers in a map
 */
export function instrumentEligibilityHandlers(
  handlers: Map<string, EligibilityHandler>
): Map<string, EligibilityHandler> {
  const instrumented = new Map<string, EligibilityHandler>();

  for (const [name, handler] of handlers) {
    instrumented.set(name, instrumentEligibilityHandler(name, handler));
  }

  return instrumented;
}
