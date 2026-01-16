/**
 * Step Handler Tests
 *
 * Sprint S-23: WizardEngine Implementation
 *
 * Tests for individual wizard step handlers:
 * - INIT, CHAIN_SELECT, ASSET_CONFIG, ELIGIBILITY_RULES
 * - ROLE_MAPPING, CHANNEL_STRUCTURE, REVIEW, DEPLOY
 */

import { describe, it, expect } from 'vitest';
import {
  createInitStepHandler,
  createChainSelectStepHandler,
  createAssetConfigStepHandler,
  createEligibilityRulesStepHandler,
  createRoleMappingStepHandler,
  createChannelStructureStepHandler,
  createReviewStepHandler,
  createDeployStepHandler,
} from '../steps/index.js';
import { WizardState, type WizardSession } from '@arrakis/core/domain';
import type { StepContext, StepInput } from '@arrakis/core/ports';
import pino from 'pino';

// =============================================================================
// Test Setup
// =============================================================================

const logger = pino({ level: 'silent' });

function createMockSession(overrides: Partial<WizardSession> = {}): WizardSession {
  return {
    id: 'test-session-123',
    communityId: 'community-456',
    guildId: 'guild-789',
    userId: 'user-abc',
    state: WizardState.INIT,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    ...overrides,
  };
}

function createMockContext(session: WizardSession): StepContext {
  return {
    sessionId: session.id,
    session,
    guildId: session.guildId,
    userId: session.userId,
  };
}

// =============================================================================
// INIT Step Tests
// =============================================================================

describe('InitStepHandler', () => {
  const handler = createInitStepHandler(logger);

  describe('validate', () => {
    it('should accept valid community name', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { communityName: 'My Community' } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty community name', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { communityName: '' } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Community name is required');
    });

    it('should reject too short community name', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { communityName: 'AB' } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('at least 3'))).toBe(true);
    });

    it('should reject too long community name', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { communityName: 'A'.repeat(101) } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('100 characters'))).toBe(true);
    });
  });

  describe('execute', () => {
    it('should execute with valid input', async () => {
      const session = createMockSession();
      const context = createMockContext(session);
      const input: StepInput = { data: { communityName: 'Test Community' } };

      const result = await handler.execute(context, input);

      expect(result.success).toBe(true);
    });

    it('should fail with invalid input', async () => {
      const session = createMockSession();
      const context = createMockContext(session);
      const input: StepInput = { data: { communityName: '' } };

      const result = await handler.execute(context, input);

      expect(result.success).toBe(false);
    });
  });

  describe('getDisplay', () => {
    it('should return embeds and components', async () => {
      const session = createMockSession();

      const display = await handler.getDisplay(session);

      expect(display.embeds).toBeDefined();
      expect(display.embeds.length).toBeGreaterThan(0);
      expect(display.components).toBeDefined();
    });
  });
});

// =============================================================================
// CHAIN_SELECT Step Tests
// =============================================================================

describe('ChainSelectStepHandler', () => {
  const handler = createChainSelectStepHandler(logger);

  describe('validate', () => {
    it('should accept valid chain selection', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { chains: ['ethereum', 'polygon'] } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
    });

    it('should reject empty chain selection', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { chains: [] } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
    });

    it('should reject invalid chain IDs', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { chains: ['invalid-chain'] } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid'))).toBe(true);
    });
  });
});

// =============================================================================
// ASSET_CONFIG Step Tests
// =============================================================================

describe('AssetConfigStepHandler', () => {
  const handler = createAssetConfigStepHandler(logger);

  describe('validate', () => {
    it('should accept valid asset configuration', async () => {
      const session = createMockSession({
        data: {
          chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
        },
      });
      const input: StepInput = {
        data: {
          assets: [
            {
              id: 'asset-1',
              type: 'erc721',
              contractAddress: '0x1234567890123456789012345678901234567890',
              chainId: 'ethereum',
              name: 'Test NFT',
              symbol: 'TNFT',
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid contract address', async () => {
      const session = createMockSession({
        data: {
          chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
        },
      });
      const input: StepInput = {
        data: {
          assets: [
            {
              id: 'asset-1',
              type: 'erc721',
              contractAddress: 'invalid',
              chainId: 'ethereum',
              name: 'Test NFT',
              symbol: 'TNFT',
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid contract'))).toBe(true);
    });

    it('should reject asset on unselected chain', async () => {
      const session = createMockSession({
        data: {
          chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
        },
      });
      const input: StepInput = {
        data: {
          assets: [
            {
              id: 'asset-1',
              type: 'erc721',
              contractAddress: '0x1234567890123456789012345678901234567890',
              chainId: 'polygon', // Not selected
              name: 'Test NFT',
              symbol: 'TNFT',
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// ELIGIBILITY_RULES Step Tests
// =============================================================================

describe('EligibilityRulesStepHandler', () => {
  const handler = createEligibilityRulesStepHandler(logger);

  describe('validate', () => {
    it('should accept valid rules', async () => {
      const session = createMockSession({
        data: {
          assets: [
            {
              id: 'asset-1',
              type: 'erc721',
              contractAddress: '0x1234567890123456789012345678901234567890',
              chainId: 'ethereum',
              name: 'Test',
              symbol: 'T',
            },
          ],
        },
      });
      const input: StepInput = {
        data: {
          rules: [
            {
              id: 'rule-1',
              type: 'nft_ownership',
              assetId: 'asset-1',
              parameters: { minCount: 1 },
              description: 'Own 1 NFT',
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
    });

    it('should reject rules referencing unknown assets', async () => {
      const session = createMockSession({ data: { assets: [] } });
      const input: StepInput = {
        data: {
          rules: [
            {
              id: 'rule-1',
              type: 'nft_ownership',
              assetId: 'non-existent',
              parameters: {},
              description: 'Test',
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// ROLE_MAPPING Step Tests
// =============================================================================

describe('RoleMappingStepHandler', () => {
  const handler = createRoleMappingStepHandler(logger);

  describe('validate', () => {
    it('should accept valid role mappings', async () => {
      const session = createMockSession();
      const input: StepInput = {
        data: {
          tierRoles: [
            {
              tierId: 'fedaykin',
              roleName: 'Fedaykin',
              roleColor: 0xcd7f32,
              mentionable: false,
              hoist: true,
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
    });

    it('should reject duplicate tier IDs', async () => {
      const session = createMockSession();
      const input: StepInput = {
        data: {
          tierRoles: [
            {
              tierId: 'fedaykin',
              roleName: 'Role 1',
              roleColor: 0xcd7f32,
              mentionable: false,
              hoist: true,
            },
            {
              tierId: 'fedaykin', // Duplicate
              roleName: 'Role 2',
              roleColor: 0xc0c0c0,
              mentionable: false,
              hoist: true,
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('already mapped'))).toBe(true);
    });

    it('should reject duplicate role names', async () => {
      const session = createMockSession();
      const input: StepInput = {
        data: {
          tierRoles: [
            {
              tierId: 'fedaykin',
              roleName: 'Same Name',
              roleColor: 0xcd7f32,
              mentionable: false,
              hoist: true,
            },
            {
              tierId: 'sietch',
              roleName: 'Same Name', // Duplicate
              roleColor: 0xc0c0c0,
              mentionable: false,
              hoist: true,
            },
          ],
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('already used'))).toBe(true);
    });
  });
});

// =============================================================================
// CHANNEL_STRUCTURE Step Tests
// =============================================================================

describe('ChannelStructureStepHandler', () => {
  const handler = createChannelStructureStepHandler(logger);

  describe('validate', () => {
    it('should accept valid channel template', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { channelTemplate: 'additive_only' } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
    });

    it('should reject invalid template', async () => {
      const session = createMockSession();
      const input: StepInput = { data: { channelTemplate: 'invalid' } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
    });

    it('should require custom channels for custom template', async () => {
      const session = createMockSession();
      const input: StepInput = {
        data: {
          channelTemplate: 'custom',
          customChannels: [], // Empty
        },
      };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// REVIEW Step Tests
// =============================================================================

describe('ReviewStepHandler', () => {
  const handler = createReviewStepHandler(logger);

  describe('validate', () => {
    it('should validate complete session data', async () => {
      const session = createMockSession({
        data: {
          communityName: 'Test',
          chains: [{ chainId: 'ethereum', name: 'Ethereum', enabled: true }],
          assets: [
            {
              id: 'a1',
              type: 'erc721',
              contractAddress: '0x123',
              chainId: 'ethereum',
              name: 'Test',
              symbol: 'T',
            },
          ],
          rules: [
            {
              id: 'r1',
              type: 'nft_ownership',
              assetId: 'a1',
              parameters: {},
              description: 'Test',
            },
          ],
          tierRoles: [
            {
              tierId: 't1',
              roleName: 'Test',
              roleColor: 0,
              mentionable: false,
              hoist: false,
            },
          ],
          channelTemplate: 'none',
        },
      });
      const input: StepInput = { data: { validated: true } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
    });

    it('should detect missing required data', async () => {
      const session = createMockSession({ data: {} });
      const input: StepInput = { data: { validated: true } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

// =============================================================================
// DEPLOY Step Tests
// =============================================================================

describe('DeployStepHandler', () => {
  const handler = createDeployStepHandler(logger);

  describe('validate', () => {
    it('should accept deployment for validated manifest', async () => {
      const session = createMockSession({
        data: {
          manifest: { version: '1.0.0', name: 'Test' },
          validated: true,
        },
      });
      const input: StepInput = { data: { confirmed: true } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(true);
    });

    it('should reject deployment without validation', async () => {
      const session = createMockSession({
        data: {
          manifest: { version: '1.0.0', name: 'Test' },
          validated: false,
        },
      });
      const input: StepInput = { data: { confirmed: true } };

      const result = await handler.validate(input, session);

      expect(result.valid).toBe(false);
    });
  });
});
