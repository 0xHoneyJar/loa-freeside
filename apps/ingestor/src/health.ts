import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import type { Client } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { Publisher } from './publisher.js';
import type { HealthStatus } from './types.js';

/**
 * Simple HTTP health check server for ECS task health verification
 * Per SDD Section 3.2.1 - health check on port 8080
 */
export class HealthServer {
  private server: Server | null = null;
  private isShuttingDown = false;

  constructor(
    private readonly config: Config,
    private readonly client: Client,
    private readonly publisher: Publisher,
    private readonly logger: Logger
  ) {}

  /**
   * Start the health check server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        this.logger.error({ error: err.message }, 'Health server error');
        reject(err);
      });

      this.server.listen(this.config.healthPort, () => {
        this.logger.info({ port: this.config.healthPort }, 'Health server started');
        resolve();
      });
    });
  }

  /**
   * Stop the health check server
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;
    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close(() => {
        this.logger.info('Health server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    // Only handle GET /health
    if (req.method !== 'GET' || (req.url !== '/health' && req.url !== '/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const status = this.getHealthStatus();
    const httpStatus = status.status === 'healthy' ? 200 : 503;

    res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthStatus {
    const memoryUsage = process.memoryUsage();
    const heapUsedMb = memoryUsage.heapUsed / 1024 / 1024;
    const memoryBelowThreshold = heapUsedMb < this.config.memoryThresholdMb;

    const discordConnected = this.client.isReady();
    const discordLatency = this.client.ws.ping;
    const shardId = this.client.shard?.ids[0] ?? 0;

    const publisherStatus = this.publisher.getStatus();

    const isHealthy =
      !this.isShuttingDown &&
      discordConnected &&
      publisherStatus.connected &&
      publisherStatus.channelOpen &&
      memoryBelowThreshold;

    return {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: Date.now(),
      checks: {
        discord: {
          connected: discordConnected,
          latency: discordLatency,
          shardId,
        },
        rabbitmq: {
          connected: publisherStatus.connected,
          channelOpen: publisherStatus.channelOpen,
        },
        memory: {
          heapUsed: Math.round(heapUsedMb * 100) / 100,
          heapTotal: Math.round((memoryUsage.heapTotal / 1024 / 1024) * 100) / 100,
          rss: Math.round((memoryUsage.rss / 1024 / 1024) * 100) / 100,
          belowThreshold: memoryBelowThreshold,
        },
      },
    };
  }
}
