/**
 * NATS Health Check Server
 * Sprint S-6: Worker Migration to NATS
 *
 * HTTP health endpoints for Kubernetes liveness and readiness probes.
 * Monitors NATS consumer health and dependencies.
 */

import http from 'node:http';
import type { Logger } from 'pino';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface NatsConsumerStats {
  processed: number;
  errored: number;
  running: boolean;
}

export interface NatsHealthChecker {
  getNatsStatus: () => { connected: boolean; gatewayDegraded?: boolean };
  getCommandConsumerStats: () => NatsConsumerStats;
  getEventConsumerStats: () => NatsConsumerStats;
  getEligibilityConsumerStats: () => NatsConsumerStats;
  getUsageConsumerStats: () => NatsConsumerStats;
  getRedisStatus: () => boolean;
  getRedisLatency: () => Promise<number | null>;
  getStartTime: () => number;
}

export interface NatsWorkerHealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: number;
  mode: 'nats';
  checks: {
    nats: {
      connected: boolean;
    };
    consumers: {
      command: NatsConsumerStats;
      event: NatsConsumerStats;
      eligibility: NatsConsumerStats;
      usage: NatsConsumerStats;
    };
    redis: {
      connected: boolean;
      latencyMs: number | null;
    };
    memory: {
      heapUsed: number;
      heapTotal: number;
      rss: number;
      belowThreshold: boolean;
    };
  };
  stats: {
    totalMessagesProcessed: number;
    totalMessagesErrored: number;
    uptime: number;
  };
}

// --------------------------------------------------------------------------
// Health Server
// --------------------------------------------------------------------------

/**
 * Create HTTP server for health checks (NATS mode)
 */
export function createNatsHealthServer(
  port: number,
  memoryThresholdMb: number,
  checker: NatsHealthChecker,
  logger: Logger
): http.Server {
  const log = logger.child({ component: 'NatsHealthServer' });

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';

    // Liveness probe - basic process health
    if (url === '/healthz' || url === '/health') {
      const health = await getHealthStatus(checker, memoryThresholdMb);
      const statusCode = health.status === 'healthy' ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(health));
      return;
    }

    // Readiness probe - ready to accept traffic
    if (url === '/ready' || url === '/readyz') {
      const ready = await checkReadiness(checker);
      const statusCode = ready ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ready,
        timestamp: Date.now(),
      }));
      return;
    }

    // Prometheus metrics endpoint
    if (url === '/metrics') {
      // Placeholder for Prometheus metrics
      // Full implementation in S-3 observability
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('# NATS worker metrics\n');
      return;
    }

    // Unknown endpoint
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port, () => {
    log.info({ port }, 'Health server listening');
  });

  server.on('error', (error) => {
    log.error({ error }, 'Health server error');
  });

  return server;
}

/**
 * Get comprehensive health status
 */
async function getHealthStatus(
  checker: NatsHealthChecker,
  memoryThresholdMb: number
): Promise<NatsWorkerHealthStatus> {
  const natsStatus = checker.getNatsStatus();
  const commandStats = checker.getCommandConsumerStats();
  const eventStats = checker.getEventConsumerStats();
  const eligibilityStats = checker.getEligibilityConsumerStats();
  const usageStats = checker.getUsageConsumerStats();
  const redisConnected = checker.getRedisStatus();
  const redisLatency = await checker.getRedisLatency();
  const startTime = checker.getStartTime();

  const memUsage = process.memoryUsage();
  const heapUsedMb = memUsage.heapUsed / 1024 / 1024;
  const belowThreshold = heapUsedMb < memoryThresholdMb;

  // Calculate totals
  const totalProcessed = commandStats.processed + eventStats.processed + eligibilityStats.processed + usageStats.processed;
  const totalErrored = commandStats.errored + eventStats.errored + eligibilityStats.errored + usageStats.errored;

  // Health criteria:
  // 1. NATS connected
  // 2. At least one consumer running
  // 3. Redis connected
  // 4. Memory below threshold
  const consumersRunning = commandStats.running || eventStats.running || eligibilityStats.running || usageStats.running;
  const isHealthy = natsStatus.connected && consumersRunning && redisConnected && belowThreshold;

  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: Date.now(),
    mode: 'nats',
    checks: {
      nats: natsStatus,
      consumers: {
        command: commandStats,
        event: eventStats,
        eligibility: eligibilityStats,
        usage: usageStats,
      },
      redis: {
        connected: redisConnected,
        latencyMs: redisLatency,
      },
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        belowThreshold,
      },
    },
    stats: {
      totalMessagesProcessed: totalProcessed,
      totalMessagesErrored: totalErrored,
      uptime: Date.now() - startTime,
    },
  };
}

/**
 * Check if worker is ready to accept traffic
 * Sprint 321 (high-5): Returns false when agent gateway is degraded
 */
async function checkReadiness(checker: NatsHealthChecker): Promise<boolean> {
  const natsStatus = checker.getNatsStatus();
  const redisConnected = checker.getRedisStatus();
  const commandStats = checker.getCommandConsumerStats();
  const eventStats = checker.getEventConsumerStats();

  // Ready when:
  // 1. NATS connected
  // 2. At least command or event consumer running
  // 3. Redis connected
  // 4. Agent gateway not degraded (Sprint 321, high-5)
  const baseReady = natsStatus.connected && (commandStats.running || eventStats.running) && redisConnected;
  return baseReady && !natsStatus.gatewayDegraded;
}
