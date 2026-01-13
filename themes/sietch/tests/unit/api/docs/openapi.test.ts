/**
 * OpenAPI Specification Tests
 *
 * Sprint 52: Medium Priority Hardening (P2)
 *
 * Validates that the OpenAPI specification is correctly generated
 * and all schemas are valid.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  generateOpenAPIDocument,
  ErrorResponseSchema,
  PaginationSchema,
  EligibilityResponseSchema,
  WalletEligibilitySchema,
  MemberProfileSchema,
  HealthResponseSchema,
  BadgeSchema,
} from '../../../../src/api/docs/openapi.js';
import type { OpenAPIObject } from 'openapi3-ts/oas30';
import { z } from 'zod';

describe('OpenAPI Specification', () => {
  let openAPIDoc: OpenAPIObject;

  beforeAll(() => {
    openAPIDoc = generateOpenAPIDocument() as OpenAPIObject;
  });

  describe('Document Structure', () => {
    it('should generate valid OpenAPI 3.0 document', () => {
      expect(openAPIDoc.openapi).toBe('3.0.0');
    });

    it('should have correct API info', () => {
      expect(openAPIDoc.info.title).toBe('Arrakis API');
      expect(openAPIDoc.info.version).toBe('5.1.0');
      expect(openAPIDoc.info.description).toContain('multi-tenant');
    });

    it('should define servers', () => {
      expect(openAPIDoc.servers).toBeDefined();
      expect(openAPIDoc.servers!.length).toBeGreaterThan(0);
      expect(openAPIDoc.servers![0].url).toContain('arrakis');
    });

    it('should define tags', () => {
      expect(openAPIDoc.tags).toBeDefined();
      expect(openAPIDoc.tags!.length).toBeGreaterThan(0);

      const tagNames = openAPIDoc.tags!.map(t => t.name);
      expect(tagNames).toContain('System');
      expect(tagNames).toContain('Eligibility');
      expect(tagNames).toContain('Members');
    });
  });

  describe('Paths', () => {
    it('should define health endpoint', () => {
      expect(openAPIDoc.paths['/health']).toBeDefined();
      expect(openAPIDoc.paths['/health'].get).toBeDefined();
    });

    it('should define eligibility endpoints', () => {
      expect(openAPIDoc.paths['/eligibility']).toBeDefined();
      expect(openAPIDoc.paths['/eligibility/{address}']).toBeDefined();
    });

    it('should define member endpoints', () => {
      expect(openAPIDoc.paths['/members/profile/{discordId}']).toBeDefined();
      expect(openAPIDoc.paths['/members/directory']).toBeDefined();
    });

    it('should define threshold endpoint', () => {
      expect(openAPIDoc.paths['/threshold']).toBeDefined();
    });

    it('should define metrics endpoint', () => {
      expect(openAPIDoc.paths['/metrics']).toBeDefined();
    });

    it('should have proper response schemas for each endpoint', () => {
      const eligibilityPath = openAPIDoc.paths['/eligibility'];
      expect(eligibilityPath.get?.responses['200']).toBeDefined();
    });
  });

  describe('Security Schemes', () => {
    it('should define apiKey security scheme', () => {
      expect(openAPIDoc.components?.securitySchemes?.apiKey).toBeDefined();
      const apiKey = openAPIDoc.components!.securitySchemes!.apiKey as any;
      expect(apiKey.type).toBe('apiKey');
      expect(apiKey.in).toBe('header');
      expect(apiKey.name).toBe('X-API-Key');
    });

    it('should require auth on member endpoints', () => {
      const profilePath = openAPIDoc.paths['/members/profile/{discordId}'];
      expect(profilePath.get?.security).toBeDefined();
      expect(profilePath.get?.security).toContainEqual({ apiKey: [] });
    });
  });

  describe('Components/Schemas', () => {
    it('should define ErrorResponse schema', () => {
      expect(openAPIDoc.components?.schemas?.ErrorResponse).toBeDefined();
    });

    it('should define EligibilityResponse schema', () => {
      expect(openAPIDoc.components?.schemas?.EligibilityResponse).toBeDefined();
    });

    it('should define MemberProfile schema', () => {
      expect(openAPIDoc.components?.schemas?.MemberProfile).toBeDefined();
    });

    it('should define HealthResponse schema', () => {
      expect(openAPIDoc.components?.schemas?.HealthResponse).toBeDefined();
    });
  });
});

describe('Zod Schema Validation', () => {
  describe('ErrorResponseSchema', () => {
    it('should validate valid error response', () => {
      const validError = {
        error: 'Something went wrong',
        code: 'ERR_VALIDATION',
        details: { field: 'email' },
      };
      expect(() => ErrorResponseSchema.parse(validError)).not.toThrow();
    });

    it('should validate minimal error response', () => {
      const minimalError = { error: 'Error message' };
      expect(() => ErrorResponseSchema.parse(minimalError)).not.toThrow();
    });

    it('should reject invalid error response', () => {
      const invalid = { message: 'wrong field name' };
      expect(() => ErrorResponseSchema.parse(invalid)).toThrow();
    });
  });

  describe('PaginationSchema', () => {
    it('should validate valid pagination', () => {
      const valid = {
        page: 1,
        limit: 20,
        total: 100,
        hasMore: true,
      };
      expect(() => PaginationSchema.parse(valid)).not.toThrow();
    });

    it('should enforce page minimum', () => {
      const invalid = { page: 0, limit: 20, total: 100, hasMore: false };
      expect(() => PaginationSchema.parse(invalid)).toThrow();
    });

    it('should enforce limit maximum', () => {
      const invalid = { page: 1, limit: 200, total: 100, hasMore: false };
      expect(() => PaginationSchema.parse(invalid)).toThrow();
    });
  });

  describe('EligibilityResponseSchema', () => {
    it('should validate valid eligibility response', () => {
      const valid = {
        updated_at: '2025-01-01T00:00:00.000Z',
        grace_period: false,
        top_69: [
          { rank: 1, address: '0x1234567890123456789012345678901234567890', bgt_held: 100.5 },
        ],
        top_7: ['0x1234567890123456789012345678901234567890'],
      };
      expect(() => EligibilityResponseSchema.parse(valid)).not.toThrow();
    });

    it('should reject invalid address format', () => {
      const invalid = {
        updated_at: '2025-01-01T00:00:00.000Z',
        grace_period: false,
        top_69: [
          { rank: 1, address: 'invalid-address', bgt_held: 100.5 },
        ],
        top_7: [],
      };
      expect(() => EligibilityResponseSchema.parse(invalid)).toThrow();
    });
  });

  describe('WalletEligibilitySchema', () => {
    it('should validate eligible wallet', () => {
      const valid = {
        address: '0x1234567890123456789012345678901234567890',
        eligible: true,
        rank: 5,
        role: 'fedaykin' as const,
        bgt_held: 50.25,
        last_check: '2025-01-01T00:00:00.000Z',
      };
      expect(() => WalletEligibilitySchema.parse(valid)).not.toThrow();
    });

    it('should validate ineligible wallet', () => {
      const valid = {
        address: '0x1234567890123456789012345678901234567890',
        eligible: false,
        rank: null,
        role: null,
        bgt_held: 0.1,
        last_check: '2025-01-01T00:00:00.000Z',
      };
      expect(() => WalletEligibilitySchema.parse(valid)).not.toThrow();
    });
  });

  describe('BadgeSchema', () => {
    it('should validate valid badge', () => {
      const valid = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'early_adopter',
        name: 'Early Adopter',
        description: 'Joined in the first week',
        awardedAt: '2025-01-01T00:00:00.000Z',
        awardedBy: null,
      };
      expect(() => BadgeSchema.parse(valid)).not.toThrow();
    });

    it('should validate water sharer badge', () => {
      const valid = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'water_sharer',
        name: 'Water Sharer',
        description: 'Granted by another member',
        awardedAt: '2025-01-01T00:00:00.000Z',
        awardedBy: '123456789012345678',
      };
      expect(() => BadgeSchema.parse(valid)).not.toThrow();
    });
  });

  describe('MemberProfileSchema', () => {
    it('should validate complete member profile', () => {
      const valid = {
        discordId: '123456789012345678',
        walletAddress: '0x1234567890123456789012345678901234567890',
        displayName: 'TestUser',
        rank: 10,
        role: 'fedaykin' as const,
        tier: 'Fedaykin',
        badges: [],
        joinedAt: '2025-01-01T00:00:00.000Z',
        lastActive: '2025-01-01T00:00:00.000Z',
      };
      expect(() => MemberProfileSchema.parse(valid)).not.toThrow();
    });

    it('should validate unlinked member profile', () => {
      const valid = {
        discordId: '123456789012345678',
        walletAddress: null,
        displayName: null,
        rank: null,
        role: null,
        tier: null,
        badges: [],
        joinedAt: '2025-01-01T00:00:00.000Z',
        lastActive: null,
      };
      expect(() => MemberProfileSchema.parse(valid)).not.toThrow();
    });
  });

  describe('HealthResponseSchema', () => {
    it('should validate healthy status', () => {
      const valid = {
        status: 'healthy' as const,
        version: '5.1.0',
        uptime: 3600,
        checks: {
          database: 'ok' as const,
          redis: 'ok' as const,
          scoreService: 'ok' as const,
        },
        lastSuccessfulQuery: '2025-01-01T00:00:00.000Z',
        inGracePeriod: false,
      };
      expect(() => HealthResponseSchema.parse(valid)).not.toThrow();
    });

    it('should validate degraded status', () => {
      const valid = {
        status: 'degraded' as const,
        version: '5.1.0',
        uptime: 3600,
        checks: {
          database: 'ok' as const,
          redis: 'ok' as const,
          scoreService: 'degraded' as const,
        },
        lastSuccessfulQuery: null,
        inGracePeriod: true,
      };
      expect(() => HealthResponseSchema.parse(valid)).not.toThrow();
    });
  });
});
