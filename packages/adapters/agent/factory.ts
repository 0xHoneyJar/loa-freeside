/**
 * Agent Gateway Factory
 * Sprint S4-T2: Wires all adapters together, mirrors createChainProvider() pattern
 *
 * @see SDD §4.8 Agent Gateway Factory
 */

import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Queue } from 'bullmq';
import type { AgentGatewayResult } from './types.js';
import type { StreamReconciliationJob } from './stream-reconciliation-worker.js';
import { JwtService, type KeyLoader } from './jwt-service.js';
import { TierAccessMapper } from './tier-access-mapper.js';
import { AgentRateLimiter } from './agent-rate-limiter.js';
import { BudgetManager } from './budget-manager.js';
import { LoaFinnClient } from './loa-finn-client.js';
import { AgentGateway } from './agent-gateway.js';
import { loadAgentGatewayConfig } from './config.js';
import type { TierOverrideProvider } from './tier-access-mapper.js';

// --------------------------------------------------------------------------
// Factory Options
// --------------------------------------------------------------------------

export interface CreateAgentGatewayOptions {
  redis: Redis;
  logger: Logger;
  reconciliationQueue?: Queue<StreamReconciliationJob>;
  overrideProvider?: TierOverrideProvider;
  enqueueAuditLog?: (entry: import('./budget-manager.js').AuditLogEntry) => void;
  configOverrides?: Partial<import('./config.js').AgentGatewayConfig>;
}

// --------------------------------------------------------------------------
// Factory Function
// --------------------------------------------------------------------------

/**
 * Create and initialize all agent gateway components.
 * Mirrors the createChainProvider() pattern from chain adapters.
 *
 * @returns { gateway, health, jwks } matching AgentGatewayResult interface
 */
export async function createAgentGateway(
  options: CreateAgentGatewayOptions,
): Promise<AgentGatewayResult> {
  const { redis, logger, reconciliationQueue, overrideProvider, enqueueAuditLog, configOverrides } = options;
  const config = loadAgentGatewayConfig(configOverrides);

  // 1. JWT Service — load signing key via KeyLoader
  // KeyLoader abstracts key source: env var for local dev, AWS Secrets Manager for production.
  // The factory resolves the secret ID from config and creates the appropriate loader.
  const keyLoader: KeyLoader = createKeyLoader(config.jwtSecretId, logger);

  const jwtService = new JwtService(
    {
      keyId: config.jwt.keyId,
      expirySec: config.jwt.expirySec,
    },
    keyLoader,
  );
  await jwtService.initialize();

  // 2. Tier→Access Mapper (with optional DB overrides)
  const tierMapper = new TierAccessMapper(undefined, {
    redis,
    overrideProvider,
    logger,
  });

  // 3. Rate Limiter
  const rateLimiter = new AgentRateLimiter(redis, logger);

  // 4. Budget Manager
  const budgetManager = new BudgetManager(redis, logger, enqueueAuditLog);

  // 5. loa-finn Client
  const loaFinnClient = new LoaFinnClient({
    // rawBody: the exact HTTP body bytes forwarded to loa-finn, used for req_hash binding.
    // Both Arrakis and loa-finn compute SHA-256 over these same bytes for JWT verification.
    mintJwt: async (request, rawBody) => jwtService.sign(request.context, rawBody),
    logger,
    config: {
      baseUrl: config.loaFinn.baseUrl,
      timeoutMs: config.loaFinn.timeoutMs,
      circuitBreakerThreshold: config.loaFinn.circuitBreakerThreshold,
      circuitBreakerResetMs: config.loaFinn.circuitBreakerResetMs,
    },
  });

  // 6. Gateway Facade
  const gateway = new AgentGateway({
    budgetManager,
    rateLimiter,
    loaFinnClient,
    tierMapper,
    redis,
    logger,
    reconciliationQueue,
  });

  return {
    gateway,
    health: () => gateway.getHealth(),
    jwks: () => jwtService.getJwks(),
  };
}

// --------------------------------------------------------------------------
// Key Loader Factory
// --------------------------------------------------------------------------

/**
 * Create a KeyLoader that loads the ES256 private key from the appropriate source.
 *
 * Resolution order:
 * 1. AGENT_JWT_PRIVATE_KEY env var (direct PEM — local dev, testing)
 * 2. AWS Secrets Manager via secretId (production)
 *
 * @param secretId - AWS Secrets Manager secret ID
 * @param logger - Logger for diagnostics
 */
function createKeyLoader(secretId: string | undefined, logger: Logger): KeyLoader {
  return {
    async load(): Promise<string> {
      // 1. Direct env var (local dev / CI)
      const envKey = process.env.AGENT_JWT_PRIVATE_KEY;
      if (envKey) {
        logger.info('KeyLoader: using AGENT_JWT_PRIVATE_KEY env var');
        return envKey;
      }

      // 2. AWS Secrets Manager (production)
      if (!secretId) {
        throw new Error('KeyLoader: no AGENT_JWT_PRIVATE_KEY env var and no secretId configured');
      }

      logger.info({ secretId }, 'KeyLoader: loading from AWS Secrets Manager');
      const { SecretsManagerClient, GetSecretValueCommand } = await import('@aws-sdk/client-secrets-manager');
      const client = new SecretsManagerClient({});
      const result = await client.send(new GetSecretValueCommand({ SecretId: secretId }));

      if (!result.SecretString) {
        throw new Error(`KeyLoader: secret ${secretId} has no SecretString`);
      }

      return result.SecretString;
    },
  };
}
