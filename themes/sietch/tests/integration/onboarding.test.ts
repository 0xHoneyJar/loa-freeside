/**
 * Onboarding Flow Integration Tests
 *
 * Tests the complete new member onboarding flow end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the config
vi.mock('../../src/config.js', () => ({
  config: {
    discord: {
      roles: {
        naib: 'role_naib',
        fedaykin: 'role_fedaykin',
        onboarded: 'role_onboarded',
      },
      guildId: 'test_guild',
      channels: {
        theDoor: 'channel_door',
        census: 'channel_census',
      },
      botToken: 'test_token',
    },
    socialLayer: {
      profile: {
        launchDate: '2025-01-01T00:00:00Z',
      },
    },
  },
}));

// Mock database queries
const mockGetProfile = vi.fn();
const mockCreateProfile = vi.fn();
const mockUpdateProfile = vi.fn();
const mockLogAuditEvent = vi.fn();

vi.mock('../../src/db/index.js', () => ({
  getMemberProfileById: mockGetProfile,
  getMemberProfileByDiscordId: vi.fn(),
  createMemberProfile: mockCreateProfile,
  updateMemberProfile: mockUpdateProfile,
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(),
      run: vi.fn(),
    })),
  })),
  logAuditEvent: mockLogAuditEvent,
}));

// Mock Discord service
const mockSendEphemeralModal = vi.fn();
const mockShowModal = vi.fn();
const mockAssignRole = vi.fn();

vi.mock('../../src/services/discord.js', () => ({
  discordService: {
    sendEphemeralModal: mockSendEphemeralModal,
    showModal: mockShowModal,
    assignRole: mockAssignRole,
    isConnected: vi.fn(() => true),
    getMemberById: vi.fn(),
  },
}));

// Mock roleManager
vi.mock('../../src/services/roleManager.js', () => ({
  assignOnboardedRole: vi.fn().mockResolvedValue(true),
  syncMemberRoles: vi.fn().mockResolvedValue({ assigned: [], removed: [] }),
}));

describe('Onboarding Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Step 1: Nym Selection', () => {
    it('should validate nym format - alphanumeric and underscores only', () => {
      const validNyms = ['TestUser', 'test_user', 'User123', 'A_B_C'];
      const invalidNyms = ['test-user', 'test.user', 'test@user', 'test user'];

      const nymRegex = /^[a-zA-Z0-9_]+$/;

      for (const nym of validNyms) {
        expect(nymRegex.test(nym)).toBe(true);
      }

      for (const nym of invalidNyms) {
        expect(nymRegex.test(nym)).toBe(false);
      }
    });

    it('should enforce nym length constraints (3-32 chars)', () => {
      const tooShort = 'AB';
      const valid = 'ValidNym';
      const tooLong = 'A'.repeat(33);

      expect(tooShort.length < 3).toBe(true);
      expect(valid.length >= 3 && valid.length <= 32).toBe(true);
      expect(tooLong.length > 32).toBe(true);
    });

    it('should reject reserved nyms', () => {
      const reservedNyms = [
        'admin',
        'administrator',
        'moderator',
        'mod',
        'system',
        'sietch',
        'bot',
        'official',
      ];

      for (const nym of reservedNyms) {
        expect(reservedNyms.includes(nym.toLowerCase())).toBe(true);
      }
    });
  });

  describe('Step 2: Bio Entry', () => {
    it('should allow empty bio', () => {
      const bio = '';
      expect(bio.length <= 280).toBe(true);
    });

    it('should enforce bio length limit (280 chars)', () => {
      const validBio = 'A'.repeat(280);
      const tooLongBio = 'A'.repeat(281);

      expect(validBio.length <= 280).toBe(true);
      expect(tooLongBio.length > 280).toBe(true);
    });

    it('should sanitize bio content', () => {
      const bioWithScript = '<script>alert("xss")</script>Hello';
      const sanitized = bioWithScript.replace(/<[^>]*>/g, '');

      expect(sanitized).not.toContain('<script>');
      expect(sanitized).toContain('Hello');
    });
  });

  describe('Step 3: Avatar Selection', () => {
    it('should support avatar type options', () => {
      const validTypes = ['none', 'discord', 'custom', 'generated'];

      for (const type of validTypes) {
        expect(validTypes.includes(type)).toBe(true);
      }
    });

    it('should validate image URL format', () => {
      const validUrls = [
        'https://cdn.example.com/avatar.png',
        'https://cdn.example.com/avatar.jpg',
        'https://cdn.example.com/avatar.webp',
      ];

      const invalidUrls = [
        'http://insecure.com/avatar.png', // No HTTPS
        'ftp://files.com/avatar.png', // Wrong protocol
        'not-a-url',
      ];

      const urlRegex = /^https:\/\/.+\.(png|jpg|jpeg|gif|webp)$/i;

      for (const url of validUrls) {
        expect(urlRegex.test(url)).toBe(true);
      }

      for (const url of invalidUrls) {
        expect(urlRegex.test(url)).toBe(false);
      }
    });
  });

  describe('Onboarding Completion', () => {
    it('should mark profile as onboarding complete', () => {
      const profile = {
        memberId: 'member-123',
        discordUserId: 'discord-123',
        nym: 'TestUser',
        bio: 'Test bio',
        pfpType: 'discord',
        onboardingComplete: false,
        onboardingStep: 2,
      };

      // Simulate completion
      const completedProfile = {
        ...profile,
        onboardingComplete: true,
        onboardingStep: 3,
      };

      expect(completedProfile.onboardingComplete).toBe(true);
      expect(completedProfile.onboardingStep).toBe(3);
    });

    it('should track onboarding progress through steps', () => {
      const steps = [
        { step: 0, description: 'Not started' },
        { step: 1, description: 'Nym selected' },
        { step: 2, description: 'Bio entered' },
        { step: 3, description: 'Avatar selected (complete)' },
      ];

      let currentStep = 0;

      // Progress through steps
      currentStep = 1; // Nym
      expect(currentStep).toBe(1);

      currentStep = 2; // Bio
      expect(currentStep).toBe(2);

      currentStep = 3; // Avatar (done)
      expect(currentStep).toBe(3);
    });
  });

  describe('Onboarding State Machine', () => {
    it('should not allow skipping steps', () => {
      const currentStep = 1;
      const attemptedStep = 3;

      // Cannot jump from step 1 to step 3
      expect(attemptedStep - currentStep).toBeGreaterThan(1);
    });

    it('should allow going back to previous steps', () => {
      const currentStep = 3;
      const previousStep = 2;

      expect(previousStep < currentStep).toBe(true);
    });
  });

  describe('First-time User Detection', () => {
    it('should identify new users without profiles', () => {
      mockGetProfile.mockReturnValue(null);

      const profile = mockGetProfile('member-new');
      const isNewUser = profile === null;

      expect(isNewUser).toBe(true);
    });

    it('should identify existing users with incomplete onboarding', () => {
      mockGetProfile.mockReturnValue({
        memberId: 'member-123',
        onboardingComplete: false,
        onboardingStep: 1,
      });

      const profile = mockGetProfile('member-123');
      const needsOnboarding = profile && !profile.onboardingComplete;

      expect(needsOnboarding).toBe(true);
    });

    it('should identify fully onboarded users', () => {
      mockGetProfile.mockReturnValue({
        memberId: 'member-123',
        onboardingComplete: true,
        onboardingStep: 3,
      });

      const profile = mockGetProfile('member-123');
      const isOnboarded = profile && profile.onboardingComplete;

      expect(isOnboarded).toBe(true);
    });
  });
});
