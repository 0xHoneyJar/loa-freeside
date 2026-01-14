import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, resetConfig } from '../src/config.js';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset modules and environment
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load valid configuration', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-token-123';
    process.env.RABBITMQ_URL = 'amqps://user:pass@localhost:5671';
    process.env.NODE_ENV = 'production';

    const config = loadConfig();

    expect(config.discordToken).toBe('test-token-123');
    expect(config.rabbitmqUrl).toBe('amqps://user:pass@localhost:5671');
    expect(config.nodeEnv).toBe('production');
  });

  it('should throw on missing Discord token', () => {
    process.env.RABBITMQ_URL = 'amqps://localhost:5671';
    process.env.NODE_ENV = 'development';

    expect(() => loadConfig()).toThrow('discordToken: Required');
  });

  it('should throw on missing RabbitMQ URL', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.NODE_ENV = 'development';

    expect(() => loadConfig()).toThrow('rabbitmqUrl: Required');
  });

  it('should use default values', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.RABBITMQ_URL = 'amqps://localhost:5671';

    const config = loadConfig();

    expect(config.shardId).toBe(0);
    expect(config.shardCount).toBe(1);
    expect(config.exchangeName).toBe('arrakis.events');
    expect(config.healthPort).toBe(8080);
    expect(config.memoryThresholdMb).toBe(75);
    expect(config.logLevel).toBe('info');
  });

  it('should parse numeric environment variables', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.RABBITMQ_URL = 'amqps://localhost:5671';
    process.env.SHARD_ID = '5';
    process.env.SHARD_COUNT = '10';
    process.env.PORT = '9000';
    process.env.MEMORY_THRESHOLD_MB = '100';

    const config = loadConfig();

    expect(config.shardId).toBe(5);
    expect(config.shardCount).toBe(10);
    expect(config.healthPort).toBe(9000);
    expect(config.memoryThresholdMb).toBe(100);
  });

  it('should validate log level', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.RABBITMQ_URL = 'amqps://localhost:5671';
    process.env.LOG_LEVEL = 'invalid';

    expect(() => loadConfig()).toThrow();
  });

  it('should validate environment', () => {
    process.env.DISCORD_BOT_TOKEN = 'test-token';
    process.env.RABBITMQ_URL = 'amqps://localhost:5671';
    process.env.NODE_ENV = 'invalid';

    expect(() => loadConfig()).toThrow();
  });
});
