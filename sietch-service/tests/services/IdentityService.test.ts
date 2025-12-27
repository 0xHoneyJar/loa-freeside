/**
 * Identity Service Tests (v4.1 - Sprint 30)
 *
 * Test suite for IdentityService covering:
 * - Platform lookups (Discord, Telegram)
 * - Wallet lookups
 * - Telegram linking/unlinking
 * - Verification session management
 * - Rate limiting
 * - Edge cases and error handling
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock the database before importing the service
vi.mock('../../src/db/queries.js', () => ({
  getDatabase: vi.fn(() => mockDb),
}));

// Create mock database with transaction support
const mockDb = {
  prepare: vi.fn(),
  // Mock transaction function - it wraps a callback and executes it
  transaction: vi.fn((fn: () => any) => {
    // Return a function that executes the transaction body when called
    return () => fn();
  }),
};

// Import after mock is set up
import { identityService } from '../../src/services/IdentityService.js';
import {
  VERIFICATION_SESSION_EXPIRY_MS,
  MAX_VERIFICATION_ATTEMPTS_PER_HOUR,
} from '../../src/db/migrations/012_telegram_identity.js';

describe('IdentityService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMemberByPlatformId', () => {
    it('should return member identity for Discord user', async () => {
      const mockMember = {
        id: 'member-123',
        wallet_address: '0x1234567890abcdef',
        discord_user_id: 'discord-456',
        telegram_user_id: null,
        discord_linked_at: Date.now(),
        telegram_linked_at: null,
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockMember),
      });

      const result = await identityService.getMemberByPlatformId('discord', 'discord-456');

      expect(result).not.toBeNull();
      expect(result!.memberId).toBe('member-123');
      expect(result!.walletAddress).toBe('0x1234567890abcdef');
      expect(result!.platforms).toHaveLength(1);
      expect(result!.platforms[0].platform).toBe('discord');
    });

    it('should return member identity for Telegram user', async () => {
      const mockMember = {
        id: 'member-123',
        wallet_address: '0x1234567890abcdef',
        discord_user_id: null,
        telegram_user_id: 'telegram-789',
        discord_linked_at: null,
        telegram_linked_at: Math.floor(Date.now() / 1000),
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockMember),
      });

      const result = await identityService.getMemberByPlatformId('telegram', 'telegram-789');

      expect(result).not.toBeNull();
      expect(result!.memberId).toBe('member-123');
      expect(result!.platforms).toHaveLength(1);
      expect(result!.platforms[0].platform).toBe('telegram');
    });

    it('should return member with both platforms linked', async () => {
      const mockMember = {
        id: 'member-123',
        wallet_address: '0x1234567890abcdef',
        discord_user_id: 'discord-456',
        telegram_user_id: 'telegram-789',
        discord_linked_at: Date.now(),
        telegram_linked_at: Math.floor(Date.now() / 1000),
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockMember),
      });

      const result = await identityService.getMemberByPlatformId('discord', 'discord-456');

      expect(result).not.toBeNull();
      expect(result!.platforms).toHaveLength(2);
      expect(result!.platforms.map(p => p.platform)).toContain('discord');
      expect(result!.platforms.map(p => p.platform)).toContain('telegram');
    });

    it('should return null for non-existent user', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = await identityService.getMemberByPlatformId('discord', 'nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getMemberByWallet', () => {
    it('should return member identity by wallet address', async () => {
      const mockMember = {
        id: 'member-123',
        wallet_address: '0x1234567890abcdef',
        discord_user_id: 'discord-456',
        telegram_user_id: null,
        discord_linked_at: Date.now(),
        telegram_linked_at: null,
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockMember),
      });

      const result = await identityService.getMemberByWallet('0x1234567890abcdef');

      expect(result).not.toBeNull();
      expect(result!.memberId).toBe('member-123');
      expect(result!.walletAddress).toBe('0x1234567890abcdef');
    });

    it('should handle case-insensitive wallet lookup', async () => {
      const mockMember = {
        id: 'member-123',
        wallet_address: '0x1234567890abcdef',
        discord_user_id: null,
        telegram_user_id: null,
        discord_linked_at: null,
        telegram_linked_at: null,
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockMember),
      });

      const result = await identityService.getMemberByWallet('0x1234567890ABCDEF');

      expect(result).not.toBeNull();
    });

    it('should return null for non-existent wallet', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = await identityService.getMemberByWallet('0xnonexistent');

      expect(result).toBeNull();
    });
  });

  describe('linkTelegram', () => {
    it('should link Telegram account to member', async () => {
      // Mock check for existing Telegram link
      const getExisting = vi.fn().mockReturnValue(undefined);
      // Mock update
      const runUpdate = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValueOnce({ get: getExisting });
      mockDb.prepare.mockReturnValueOnce({ run: runUpdate });

      await expect(
        identityService.linkTelegram('member-123', 'telegram-456')
      ).resolves.not.toThrow();

      expect(runUpdate).toHaveBeenCalledWith('telegram-456', expect.any(Number), 'member-123');
    });

    it('should throw error if Telegram already linked to another member', async () => {
      const getExisting = vi.fn().mockReturnValue({ id: 'other-member' });

      mockDb.prepare.mockReturnValue({ get: getExisting });

      await expect(
        identityService.linkTelegram('member-123', 'telegram-456')
      ).rejects.toThrow('Telegram account already linked to another wallet');
    });

    it('should allow re-linking same Telegram to same member', async () => {
      const getExisting = vi.fn().mockReturnValue({ id: 'member-123' });
      const runUpdate = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValueOnce({ get: getExisting });
      mockDb.prepare.mockReturnValueOnce({ run: runUpdate });

      await expect(
        identityService.linkTelegram('member-123', 'telegram-456')
      ).resolves.not.toThrow();
    });

    it('should throw error if member not found', async () => {
      const getExisting = vi.fn().mockReturnValue(undefined);
      const runUpdate = vi.fn().mockReturnValue({ changes: 0 });

      mockDb.prepare.mockReturnValueOnce({ get: getExisting });
      mockDb.prepare.mockReturnValueOnce({ run: runUpdate });

      await expect(
        identityService.linkTelegram('nonexistent', 'telegram-456')
      ).rejects.toThrow('Member not found');
    });
  });

  describe('unlinkTelegram', () => {
    it('should unlink Telegram account from member', async () => {
      const runUpdate = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValue({ run: runUpdate });

      await expect(
        identityService.unlinkTelegram('member-123')
      ).resolves.not.toThrow();

      expect(runUpdate).toHaveBeenCalledWith('member-123');
    });

    it('should throw error if member not found', async () => {
      const runUpdate = vi.fn().mockReturnValue({ changes: 0 });

      mockDb.prepare.mockReturnValue({ run: runUpdate });

      await expect(
        identityService.unlinkTelegram('nonexistent')
      ).rejects.toThrow('Member not found');
    });
  });

  describe('createVerificationSession', () => {
    it('should create new verification session', async () => {
      // Mock rate limit check
      const getRateLimit = vi.fn().mockReturnValue({ count: 0 });
      // Mock expire pending sessions
      const runExpire = vi.fn().mockReturnValue({ changes: 0 });
      // Mock insert session
      const runInsert = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValueOnce({ get: getRateLimit });
      mockDb.prepare.mockReturnValueOnce({ run: runExpire });
      mockDb.prepare.mockReturnValueOnce({ run: runInsert });

      const result = await identityService.createVerificationSession('telegram-123', 'username');

      expect(result.sessionId).toBeDefined();
      expect(result.verifyUrl).toContain('session=');
      expect(result.verifyUrl).toContain('platform=telegram');
    });

    it('should expire pending sessions before creating new one', async () => {
      const getRateLimit = vi.fn().mockReturnValue({ count: 0 });
      const runExpire = vi.fn().mockReturnValue({ changes: 1 });
      const runInsert = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValueOnce({ get: getRateLimit });
      mockDb.prepare.mockReturnValueOnce({ run: runExpire });
      mockDb.prepare.mockReturnValueOnce({ run: runInsert });

      await identityService.createVerificationSession('telegram-123');

      expect(runExpire).toHaveBeenCalledWith('telegram-123');
    });

    it('should throw error when rate limited', async () => {
      const getRateLimit = vi.fn().mockReturnValue({
        count: MAX_VERIFICATION_ATTEMPTS_PER_HOUR,
      });

      mockDb.prepare.mockReturnValue({ get: getRateLimit });

      await expect(
        identityService.createVerificationSession('telegram-123')
      ).rejects.toThrow('Too many verification attempts');
    });

    it('should work without username', async () => {
      const getRateLimit = vi.fn().mockReturnValue({ count: 0 });
      const runExpire = vi.fn().mockReturnValue({ changes: 0 });
      const runInsert = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValueOnce({ get: getRateLimit });
      mockDb.prepare.mockReturnValueOnce({ run: runExpire });
      mockDb.prepare.mockReturnValueOnce({ run: runInsert });

      const result = await identityService.createVerificationSession('telegram-123');

      expect(result.sessionId).toBeDefined();
    });
  });

  describe('getVerificationSession', () => {
    it('should return verification session by ID', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockSession = {
        id: 'session-123',
        telegram_user_id: 'telegram-456',
        telegram_username: 'testuser',
        collabland_session_id: null,
        status: 'pending',
        wallet_address: null,
        created_at: now - 300,
        expires_at: now + 600,
        completed_at: null,
        error_message: null,
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockSession),
      });

      const result = await identityService.getVerificationSession('session-123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('session-123');
      expect(result!.telegramUserId).toBe('telegram-456');
      expect(result!.status).toBe('pending');
    });

    it('should return null for non-existent session', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = await identityService.getVerificationSession('nonexistent');

      expect(result).toBeNull();
    });

    it('should handle completed session with wallet', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockSession = {
        id: 'session-123',
        telegram_user_id: 'telegram-456',
        telegram_username: null,
        collabland_session_id: 'collab-789',
        status: 'completed',
        wallet_address: '0x1234',
        created_at: now - 600,
        expires_at: now + 300,
        completed_at: now - 300,
        error_message: null,
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockSession),
      });

      const result = await identityService.getVerificationSession('session-123');

      expect(result!.status).toBe('completed');
      expect(result!.walletAddress).toBe('0x1234');
      expect(result!.completedAt).toBeDefined();
    });
  });

  describe('completeVerification', () => {
    it('should complete verification and link wallet', async () => {
      const now = Math.floor(Date.now() / 1000);

      // Session lookup (outside transaction)
      const getSession = vi.fn().mockReturnValue({
        telegram_user_id: 'telegram-456',
        status: 'pending',
        expires_at: now + 600,
      });

      // Inside transaction: find existing member
      const getMember = vi.fn().mockReturnValue({ id: 'member-123' });

      // Inside transaction: check existing telegram link
      const getExisting = vi.fn().mockReturnValue(undefined);

      // Inside transaction: link telegram
      const runLink = vi.fn().mockReturnValue({ changes: 1 });

      // Inside transaction: update session
      const runComplete = vi.fn().mockReturnValue({ changes: 1 });

      // First call is session lookup (outside transaction)
      mockDb.prepare.mockReturnValueOnce({ get: getSession });
      // Transaction calls: getMember, getExisting, runLink, runComplete
      mockDb.prepare.mockReturnValueOnce({ get: getMember });
      mockDb.prepare.mockReturnValueOnce({ get: getExisting });
      mockDb.prepare.mockReturnValueOnce({ run: runLink });
      mockDb.prepare.mockReturnValueOnce({ run: runComplete });

      const result = await identityService.completeVerification('session-123', '0x1234');

      expect(result.telegramUserId).toBe('telegram-456');
      expect(result.memberId).toBe('member-123');
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should create new member if wallet not found', async () => {
      const now = Math.floor(Date.now() / 1000);

      // Session lookup (outside transaction)
      const getSession = vi.fn().mockReturnValue({
        telegram_user_id: 'telegram-456',
        status: 'pending',
        expires_at: now + 600,
      });

      // Inside transaction: member not found
      const getMember = vi.fn().mockReturnValue(undefined);

      // Inside transaction: create member
      const runCreate = vi.fn().mockReturnValue({ changes: 1 });

      // Inside transaction: check existing telegram link
      const getExisting = vi.fn().mockReturnValue(undefined);

      // Inside transaction: link telegram
      const runLink = vi.fn().mockReturnValue({ changes: 1 });

      // Inside transaction: update session
      const runComplete = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValueOnce({ get: getSession });
      mockDb.prepare.mockReturnValueOnce({ get: getMember });
      mockDb.prepare.mockReturnValueOnce({ run: runCreate });
      mockDb.prepare.mockReturnValueOnce({ get: getExisting });
      mockDb.prepare.mockReturnValueOnce({ run: runLink });
      mockDb.prepare.mockReturnValueOnce({ run: runComplete });

      const result = await identityService.completeVerification('session-123', '0x1234');

      expect(result.telegramUserId).toBe('telegram-456');
      expect(result.memberId).toBeDefined();
      expect(runCreate).toHaveBeenCalled();
      expect(mockDb.transaction).toHaveBeenCalled();
    });

    it('should throw error if session not found', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      await expect(
        identityService.completeVerification('nonexistent', '0x1234')
      ).rejects.toThrow('Session not found');
    });

    it('should throw error if session already processed', async () => {
      const getSession = vi.fn().mockReturnValue({
        telegram_user_id: 'telegram-456',
        status: 'completed',
        expires_at: Math.floor(Date.now() / 1000) + 600,
      });

      mockDb.prepare.mockReturnValue({ get: getSession });

      await expect(
        identityService.completeVerification('session-123', '0x1234')
      ).rejects.toThrow('Session already processed');
    });

    it('should throw error and mark expired if session expired', async () => {
      const now = Math.floor(Date.now() / 1000);

      const getSession = vi.fn().mockReturnValue({
        telegram_user_id: 'telegram-456',
        status: 'pending',
        expires_at: now - 100, // Expired
      });

      const runExpire = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValueOnce({ get: getSession });
      mockDb.prepare.mockReturnValueOnce({ run: runExpire });

      await expect(
        identityService.completeVerification('session-123', '0x1234')
      ).rejects.toThrow('Session expired');

      expect(runExpire).toHaveBeenCalled();
    });
  });

  describe('failVerification', () => {
    it('should mark session as failed with error message', async () => {
      const runFail = vi.fn().mockReturnValue({ changes: 1 });

      mockDb.prepare.mockReturnValue({ run: runFail });

      await identityService.failVerification('session-123', 'User cancelled');

      expect(runFail).toHaveBeenCalledWith('User cancelled', 'session-123');
    });
  });

  describe('getPlatformStatus', () => {
    it('should return platform status for member', async () => {
      const mockMember = {
        wallet_address: '0x1234',
        discord_user_id: 'discord-456',
        telegram_user_id: 'telegram-789',
        discord_linked_at: Date.now(),
        telegram_linked_at: Math.floor(Date.now() / 1000),
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockMember),
      });

      const result = await identityService.getPlatformStatus('member-123');

      expect(result.wallet).toBe('0x1234');
      expect(result.discord.linked).toBe(true);
      expect(result.discord.userId).toBe('discord-456');
      expect(result.telegram.linked).toBe(true);
      expect(result.telegram.userId).toBe('telegram-789');
    });

    it('should handle member with no platforms linked', async () => {
      const mockMember = {
        wallet_address: '0x1234',
        discord_user_id: null,
        telegram_user_id: null,
        discord_linked_at: null,
        telegram_linked_at: null,
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockMember),
      });

      const result = await identityService.getPlatformStatus('member-123');

      expect(result.wallet).toBe('0x1234');
      expect(result.discord.linked).toBe(false);
      expect(result.discord.userId).toBeUndefined();
      expect(result.telegram.linked).toBe(false);
    });

    it('should throw error if member not found', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      await expect(
        identityService.getPlatformStatus('nonexistent')
      ).rejects.toThrow('Member not found');
    });
  });

  describe('getPendingSession', () => {
    it('should return pending session for Telegram user', async () => {
      const now = Math.floor(Date.now() / 1000);
      const mockSession = {
        id: 'session-123',
        telegram_user_id: 'telegram-456',
        telegram_username: 'testuser',
        collabland_session_id: null,
        status: 'pending',
        wallet_address: null,
        created_at: now - 60,
        expires_at: now + 840,
        completed_at: null,
        error_message: null,
      };

      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(mockSession),
      });

      const result = await identityService.getPendingSession('telegram-456');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('session-123');
      expect(result!.status).toBe('pending');
    });

    it('should return null if no pending session', async () => {
      mockDb.prepare.mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      });

      const result = await identityService.getPendingSession('telegram-456');

      expect(result).toBeNull();
    });
  });

  describe('cleanupExpiredSessions', () => {
    it('should cleanup expired sessions', async () => {
      const runCleanup = vi.fn().mockReturnValue({ changes: 5 });

      mockDb.prepare.mockReturnValue({ run: runCleanup });

      const count = await identityService.cleanupExpiredSessions();

      expect(count).toBe(5);
    });

    it('should return 0 if no sessions expired', async () => {
      const runCleanup = vi.fn().mockReturnValue({ changes: 0 });

      mockDb.prepare.mockReturnValue({ run: runCleanup });

      const count = await identityService.cleanupExpiredSessions();

      expect(count).toBe(0);
    });
  });
});
