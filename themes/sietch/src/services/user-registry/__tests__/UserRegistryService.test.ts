/**
 * User Registry Service Tests
 * Sprint 176: Global User Registry
 *
 * @module services/user-registry/__tests__/UserRegistryService.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  UserRegistryService,
  WalletAlreadyLinkedError,
  IdentityEventType,
} from '../index.js';

// Mock the logger
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock identity for tests
const mockIdentity = {
  identityId: 'test-identity-id',
  discordId: '123456789',
  discordUsername: 'testuser',
  discordDiscriminator: null,
  discordAvatarHash: null,
  primaryWallet: null,
  twitterHandle: null,
  telegramId: null,
  status: 'active',
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
};

describe('UserRegistryService', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mockDb: any;
  let service: UserRegistryService;

  beforeEach(() => {
    // Create chainable mock that returns itself
    const createChainableMock = (finalValue: unknown = []) => {
      const mock: Record<string, ReturnType<typeof vi.fn>> = {};
      const chain = {
        select: vi.fn(() => chain),
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(() => Promise.resolve(finalValue)),
        insert: vi.fn(() => chain),
        values: vi.fn(() => chain),
        returning: vi.fn(() => Promise.resolve([{ identityId: 'new-id' }])),
        update: vi.fn(() => chain),
        set: vi.fn(() => chain),
        orderBy: vi.fn(() => Promise.resolve(finalValue)),
      };
      Object.assign(mock, chain);
      return chain;
    };

    mockDb = createChainableMock();
    mockDb.transaction = vi.fn(async (callback: (tx: unknown) => Promise<string>) => {
      const tx = createChainableMock();
      return callback(tx);
    });

    service = new UserRegistryService(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createIdentity', () => {
    it('should create a new identity with Discord info', async () => {
      // Setup: no existing identity, then return created identity
      mockDb.limit = vi.fn()
        .mockResolvedValueOnce([]) // No existing identity
        .mockResolvedValueOnce([mockIdentity]) // getIdentityById returns new identity
        .mockResolvedValueOnce([]); // getWallets returns empty

      const result = await service.createIdentity({
        discordId: '123456789',
        discordUsername: 'testuser',
        source: 'discord_verification',
        actorId: '123456789',
      });

      expect(result).toBeDefined();
      expect(result.identity).toBeDefined();
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should return existing identity if Discord ID already exists', async () => {
      // Setup: existing identity found
      mockDb.limit = vi.fn()
        .mockResolvedValueOnce([{ identityId: 'existing-id' }]) // Found existing
        .mockResolvedValueOnce([mockIdentity]) // getIdentityByDiscordId
        .mockResolvedValueOnce([]); // wallets

      const result = await service.createIdentity({
        discordId: '123456789',
        discordUsername: 'testuser',
        source: 'discord_verification',
        actorId: '123456789',
      });

      expect(result).toBeDefined();
      expect(result.identity).toBeDefined();
    });
  });

  describe('getIdentityByDiscordId', () => {
    it('should return null if no identity found', async () => {
      mockDb.limit = vi.fn().mockResolvedValue([]);

      const result = await service.getIdentityByDiscordId('nonexistent');

      expect(result).toBeNull();
    });

    it('should return identity with wallets', async () => {
      mockDb.limit = vi.fn().mockResolvedValueOnce([mockIdentity]);
      mockDb.where = vi.fn().mockResolvedValueOnce([]);

      const result = await service.getIdentityByDiscordId('123456789');

      expect(result).toBeDefined();
      expect(result?.identity.discordId).toBe('123456789');
    });
  });

  describe('verifyWallet', () => {
    it('should add wallet to identity', async () => {
      // No existing wallet, no existing wallets for identity
      mockDb.limit = vi.fn().mockResolvedValueOnce([]);
      mockDb.where = vi.fn().mockResolvedValueOnce([]);

      await expect(
        service.verifyWallet({
          identityId: 'test-identity-id',
          walletAddress: '0x1234567890123456789012345678901234567890',
          signature: 'test-signature',
          message: 'test-message',
          source: 'discord_verification',
          actorId: '123456789',
        })
      ).resolves.not.toThrow();

      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should throw if wallet already linked to another identity', async () => {
      // Wallet linked to different identity
      mockDb.limit = vi.fn().mockResolvedValueOnce([
        { identityId: 'different-identity', address: '0x1234' },
      ]);

      await expect(
        service.verifyWallet({
          identityId: 'test-identity-id',
          walletAddress: '0x1234567890123456789012345678901234567890',
          signature: 'test-signature',
          message: 'test-message',
          source: 'discord_verification',
          actorId: '123456789',
        })
      ).rejects.toThrow(WalletAlreadyLinkedError);
    });

    it('should skip if wallet already linked to same identity', async () => {
      // Wallet already linked to same identity
      mockDb.limit = vi.fn().mockResolvedValueOnce([
        { identityId: 'test-identity-id', address: '0x1234' },
      ]);

      await expect(
        service.verifyWallet({
          identityId: 'test-identity-id',
          walletAddress: '0x1234567890123456789012345678901234567890',
          signature: 'test-signature',
          message: 'test-message',
          source: 'discord_verification',
          actorId: '123456789',
        })
      ).resolves.not.toThrow();

      // Should not call transaction since already linked
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });
  });

  describe('suspendIdentity', () => {
    it('should suspend an identity and record event', async () => {
      await expect(
        service.suspendIdentity({
          identityId: 'test-identity-id',
          reason: 'Test suspension reason',
          suspendedBy: 'admin-user',
          source: 'admin_api',
        })
      ).resolves.not.toThrow();

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('restoreIdentity', () => {
    it('should restore a suspended identity', async () => {
      await expect(
        service.restoreIdentity({
          identityId: 'test-identity-id',
          reason: 'Test restoration reason',
          restoredBy: 'admin-user',
          source: 'admin_api',
        })
      ).resolves.not.toThrow();

      expect(mockDb.transaction).toHaveBeenCalled();
    });
  });

  describe('getEventHistory', () => {
    it('should return event history for identity', async () => {
      const mockEvents = [
        {
          eventId: 'event-1',
          identityId: 'test-identity-id',
          eventType: IdentityEventType.IDENTITY_CREATED,
          eventData: { discord_id: '123456789' },
          occurredAt: new Date(),
          source: 'discord_verification',
          actorId: '123456789',
          requestId: null,
        },
      ];

      mockDb.orderBy = vi.fn().mockResolvedValueOnce(mockEvents);

      const events = await service.getEventHistory('test-identity-id');

      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe(IdentityEventType.IDENTITY_CREATED);
    });
  });
});
