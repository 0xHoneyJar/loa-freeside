import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
import { HealthServer } from '../src/health.js';
import type { Config } from '../src/config.js';

describe('HealthServer', () => {
  const mockConfig: Config = {
    discordToken: 'test-token',
    shardId: 0,
    shardCount: 1,
    rabbitmqUrl: 'amqps://localhost:5671',
    exchangeName: 'arrakis.events',
    interactionQueue: 'arrakis.interactions',
    eventQueue: 'arrakis.events.guild',
    healthPort: 0, // Use random port for testing
    memoryThresholdMb: 100, // High threshold for tests
    nodeEnv: 'development',
    logLevel: 'info',
  };

  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger),
  } as any;

  let mockClient: any;
  let mockPublisher: any;
  let healthServer: HealthServer;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = {
      isReady: vi.fn().mockReturnValue(true),
      ws: { ping: 50 },
      shard: { ids: [0] },
    };

    mockPublisher = {
      getStatus: vi.fn().mockReturnValue({
        connected: true,
        channelOpen: true,
        publishCount: 100,
        errorCount: 0,
      }),
    };

    healthServer = new HealthServer(mockConfig, mockClient, mockPublisher, mockLogger);
  });

  afterEach(async () => {
    await healthServer.stop();
  });

  describe('getHealthStatus', () => {
    it('should return healthy status when all checks pass', () => {
      const status = healthServer.getHealthStatus();

      expect(status.status).toBe('healthy');
      expect(status.checks.discord.connected).toBe(true);
      expect(status.checks.discord.latency).toBe(50);
      expect(status.checks.rabbitmq.connected).toBe(true);
      expect(status.checks.rabbitmq.channelOpen).toBe(true);
      expect(status.checks.memory.belowThreshold).toBe(true);
    });

    it('should return unhealthy when Discord disconnected', () => {
      mockClient.isReady.mockReturnValue(false);

      const status = healthServer.getHealthStatus();

      expect(status.status).toBe('unhealthy');
      expect(status.checks.discord.connected).toBe(false);
    });

    it('should return unhealthy when RabbitMQ disconnected', () => {
      mockPublisher.getStatus.mockReturnValue({
        connected: false,
        channelOpen: false,
        publishCount: 0,
        errorCount: 0,
      });

      const status = healthServer.getHealthStatus();

      expect(status.status).toBe('unhealthy');
      expect(status.checks.rabbitmq.connected).toBe(false);
    });

    it('should include memory metrics', () => {
      const status = healthServer.getHealthStatus();

      expect(status.checks.memory).toHaveProperty('heapUsed');
      expect(status.checks.memory).toHaveProperty('heapTotal');
      expect(status.checks.memory).toHaveProperty('rss');
      expect(typeof status.checks.memory.heapUsed).toBe('number');
    });
  });

  describe('HTTP server', () => {
    it('should start on configured port', async () => {
      // Use a specific test port
      const testConfig = { ...mockConfig, healthPort: 49152 };
      const server = new HealthServer(testConfig, mockClient, mockPublisher, mockLogger);

      await server.start();

      expect(mockLogger.info).toHaveBeenCalledWith(
        { port: 49152 },
        'Health server started'
      );

      await server.stop();
    });

    it('should respond with 200 when healthy', async () => {
      const testConfig = { ...mockConfig, healthPort: 49153 };
      const server = new HealthServer(testConfig, mockClient, mockPublisher, mockLogger);

      await server.start();

      const response = await makeRequest(49153, '/health');

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe('healthy');

      await server.stop();
    });

    it('should respond with 503 when unhealthy', async () => {
      mockClient.isReady.mockReturnValue(false);

      const testConfig = { ...mockConfig, healthPort: 49154 };
      const server = new HealthServer(testConfig, mockClient, mockPublisher, mockLogger);

      await server.start();

      const response = await makeRequest(49154, '/health');

      expect(response.statusCode).toBe(503);
      expect(response.body.status).toBe('unhealthy');

      await server.stop();
    });

    it('should respond to root path', async () => {
      const testConfig = { ...mockConfig, healthPort: 49155 };
      const server = new HealthServer(testConfig, mockClient, mockPublisher, mockLogger);

      await server.start();

      const response = await makeRequest(49155, '/');

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe('healthy');

      await server.stop();
    });

    it('should respond with 404 for unknown paths', async () => {
      const testConfig = { ...mockConfig, healthPort: 49156 };
      const server = new HealthServer(testConfig, mockClient, mockPublisher, mockLogger);

      await server.start();

      const response = await makeRequest(49156, '/unknown');

      expect(response.statusCode).toBe(404);

      await server.stop();
    });
  });
});

// Helper function to make HTTP request
function makeRequest(port: number, path: string): Promise<{ statusCode: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode || 500,
            body: JSON.parse(data),
          });
        } catch {
          resolve({
            statusCode: res.statusCode || 500,
            body: data,
          });
        }
      });
    });
    req.on('error', reject);
  });
}
