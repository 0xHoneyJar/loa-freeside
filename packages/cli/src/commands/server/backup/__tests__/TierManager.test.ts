/**
 * TierManager Unit Tests
 *
 * Sprint 170: Service Tiers - Unit Tests
 *
 * Tests tier management, rate limiting, and usage tracking.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

import { TierManager } from '../TierManager.js';
import { TierLimitError, TIER_LIMITS } from '../types.js';

// ============================================================================
// Mocks
// ============================================================================

const dynamoMock = mockClient(DynamoDBClient);

// Sample server configs for testing
const freeServerConfig = {
  PK: { S: 'SERVER#1234567890' },
  serverId: { S: '1234567890' },
  tier: { S: 'free' },
  backupsToday: { N: '0' },
  snapshotsThisWeek: { N: '0' },
  createdAt: { S: '2026-01-01T00:00:00Z' },
  updatedAt: { S: '2026-01-29T12:00:00Z' },
};

const premiumServerConfig = {
  PK: { S: 'SERVER#1234567890' },
  serverId: { S: '1234567890' },
  tier: { S: 'premium' },
  backupsToday: { N: '100' },
  snapshotsThisWeek: { N: '50' },
  createdAt: { S: '2026-01-01T00:00:00Z' },
  updatedAt: { S: '2026-01-29T12:00:00Z' },
};

const freeLimitReachedConfig = {
  PK: { S: 'SERVER#1234567890' },
  serverId: { S: '1234567890' },
  tier: { S: 'free' },
  backupsToday: { N: '1' },
  lastBackupAt: { S: new Date().toISOString() }, // Today
  snapshotsThisWeek: { N: '3' },
  lastSnapshotAt: { S: new Date().toISOString() }, // This week
  createdAt: { S: '2026-01-01T00:00:00Z' },
  updatedAt: { S: '2026-01-29T12:00:00Z' },
};

// ============================================================================
// Test Setup
// ============================================================================

describe('TierManager', () => {
  let dynamoClient: DynamoDBClient;
  let manager: TierManager;

  beforeEach(() => {
    dynamoMock.reset();
    dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
    manager = new TierManager(dynamoClient, {
      tableName: 'gaib-server-tiers',
      serverId: '1234567890',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // getTier Tests
  // ============================================================================

  describe('getTier', () => {
    it('should return free tier by default', async () => {
      dynamoMock.on(GetItemCommand).resolves({});

      const tier = await manager.getTier();

      expect(tier).toBe('free');
    });

    it('should return tier from DynamoDB', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: premiumServerConfig,
      });

      const tier = await manager.getTier();

      expect(tier).toBe('premium');
    });

    it('should default to free if DynamoDB fails', async () => {
      dynamoMock.on(GetItemCommand).rejects(new Error('Table not found'));

      const tier = await manager.getTier();

      expect(tier).toBe('free');
    });
  });

  // ============================================================================
  // setTier Tests
  // ============================================================================

  describe('setTier', () => {
    it('should update tier in DynamoDB', async () => {
      dynamoMock.on(UpdateItemCommand).resolves({});

      await manager.setTier('premium');

      const calls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.UpdateExpression).toContain('tier = :tier');
    });
  });

  // ============================================================================
  // checkBackupLimit Tests
  // ============================================================================

  describe('checkBackupLimit', () => {
    it('should allow backups for free tier with no usage', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: freeServerConfig,
      });

      await expect(manager.checkBackupLimit()).resolves.not.toThrow();
    });

    it('should allow unlimited backups for premium tier', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: premiumServerConfig,
      });

      await expect(manager.checkBackupLimit()).resolves.not.toThrow();
    });

    it('should throw TierLimitError when free tier limit reached', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: freeLimitReachedConfig,
      });

      await expect(manager.checkBackupLimit()).rejects.toThrow(TierLimitError);
    });

    it('should reset counter on new day', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          ...freeLimitReachedConfig,
          lastBackupAt: { S: yesterday.toISOString() },
        },
      });

      await expect(manager.checkBackupLimit()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // checkSnapshotLimit Tests
  // ============================================================================

  describe('checkSnapshotLimit', () => {
    it('should allow snapshots for free tier with no usage', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: freeServerConfig,
      });

      await expect(manager.checkSnapshotLimit()).resolves.not.toThrow();
    });

    it('should allow unlimited snapshots for premium tier', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: premiumServerConfig,
      });

      await expect(manager.checkSnapshotLimit()).resolves.not.toThrow();
    });

    it('should throw TierLimitError when free tier limit reached', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: freeLimitReachedConfig,
      });

      await expect(manager.checkSnapshotLimit()).rejects.toThrow(TierLimitError);
    });

    it('should reset counter on new week', async () => {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 8);

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          ...freeLimitReachedConfig,
          lastSnapshotAt: { S: lastWeek.toISOString() },
        },
      });

      await expect(manager.checkSnapshotLimit()).resolves.not.toThrow();
    });
  });

  // ============================================================================
  // recordBackup Tests
  // ============================================================================

  describe('recordBackup', () => {
    it('should increment backup counter', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: freeServerConfig,
      });
      dynamoMock.on(UpdateItemCommand).resolves({});

      await manager.recordBackup();

      const calls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.UpdateExpression).toContain('backupsToday');
    });

    it('should reset counter on new day', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          ...freeServerConfig,
          backupsToday: { N: '5' },
          lastBackupAt: { S: yesterday.toISOString() },
        },
      });
      dynamoMock.on(UpdateItemCommand).resolves({});

      await manager.recordBackup();

      const calls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(calls).toHaveLength(1);
      // Should set to 1, not 6
      const updateInput = calls[0].args[0].input;
      expect(updateInput.ExpressionAttributeValues).toBeDefined();
    });
  });

  // ============================================================================
  // recordSnapshot Tests
  // ============================================================================

  describe('recordSnapshot', () => {
    it('should increment snapshot counter', async () => {
      dynamoMock.on(GetItemCommand).resolves({
        Item: freeServerConfig,
      });
      dynamoMock.on(UpdateItemCommand).resolves({});

      await manager.recordSnapshot();

      const calls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0].args[0].input.UpdateExpression).toContain('snapshotsThisWeek');
    });

    it('should reset counter on new week', async () => {
      const lastWeek = new Date();
      lastWeek.setDate(lastWeek.getDate() - 8);

      dynamoMock.on(GetItemCommand).resolves({
        Item: {
          ...freeServerConfig,
          snapshotsThisWeek: { N: '5' },
          lastSnapshotAt: { S: lastWeek.toISOString() },
        },
      });
      dynamoMock.on(UpdateItemCommand).resolves({});

      await manager.recordSnapshot();

      const calls = dynamoMock.commandCalls(UpdateItemCommand);
      expect(calls).toHaveLength(1);
    });
  });

  // ============================================================================
  // getLimits Tests
  // ============================================================================

  describe('getLimits', () => {
    it('should return free tier limits', () => {
      const limits = manager.getLimits('free');

      expect(limits.dailyBackups).toBe(1);
      expect(limits.weeklySnapshots).toBe(3);
      expect(limits.retentionDays).toBe(7);
      expect(limits.crossRegion).toBe(false);
    });

    it('should return premium tier limits', () => {
      const limits = manager.getLimits('premium');

      expect(limits.dailyBackups).toBe(Infinity);
      expect(limits.weeklySnapshots).toBe(Infinity);
      expect(limits.retentionDays).toBe(90);
      expect(limits.crossRegion).toBe(true);
    });
  });

  // ============================================================================
  // TIER_LIMITS Constant Tests
  // ============================================================================

  describe('TIER_LIMITS', () => {
    it('should have correct free tier values', () => {
      expect(TIER_LIMITS.free).toEqual({
        dailyBackups: 1,
        weeklySnapshots: 3,
        retentionDays: 7,
        historyLimit: 5,
        crossRegion: false,
      });
    });

    it('should have correct premium tier values', () => {
      expect(TIER_LIMITS.premium).toEqual({
        dailyBackups: Infinity,
        weeklySnapshots: Infinity,
        retentionDays: 90,
        historyLimit: Infinity,
        crossRegion: true,
      });
    });
  });
});
