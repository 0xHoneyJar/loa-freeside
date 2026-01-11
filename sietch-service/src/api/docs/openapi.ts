// @ts-nocheck
// TODO: Fix TypeScript type errors
/**
 * OpenAPI 3.0 Specification Generator
 *
 * Sprint 52: Medium Priority Hardening (P2)
 *
 * Generates OpenAPI documentation from Zod schemas using @asteasolutions/zod-to-openapi.
 * This provides type-safe API documentation that stays in sync with the codebase.
 *
 * @module api/docs/openapi
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Extend Zod with OpenAPI functionality
extendZodWithOpenApi(z);

// Create OpenAPI registry
const registry = new OpenAPIRegistry();

// =============================================================================
// Common Schemas
// =============================================================================

const ErrorResponseSchema = z
  .object({
    error: z.string().describe('Error message'),
    code: z.string().optional().describe('Error code for programmatic handling'),
    details: z.record(z.unknown()).optional().describe('Additional error details'),
  })
  .openapi('ErrorResponse');

const PaginationSchema = z
  .object({
    page: z.number().int().min(1).default(1).describe('Page number'),
    limit: z.number().int().min(1).max(100).default(20).describe('Items per page'),
    total: z.number().int().describe('Total number of items'),
    hasMore: z.boolean().describe('Whether more pages exist'),
  })
  .openapi('Pagination');

// =============================================================================
// Eligibility Schemas
// =============================================================================

const EligibleWalletSchema = z
  .object({
    rank: z.number().int().min(1).describe('Wallet rank (1-69)'),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Ethereum address'),
    bgt_held: z.number().describe('BGT tokens held (in ETH units, not wei)'),
  })
  .openapi('EligibleWallet');

const EligibilityResponseSchema = z
  .object({
    updated_at: z.string().datetime().describe('ISO 8601 timestamp of last update'),
    grace_period: z.boolean().describe('Whether system is in grace period'),
    top_69: z.array(EligibleWalletSchema).describe('Top 69 eligible wallets'),
    top_7: z.array(z.string()).describe('Naib council addresses (top 7)'),
  })
  .openapi('EligibilityResponse');

const WalletEligibilitySchema = z
  .object({
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    eligible: z.boolean().describe('Whether wallet is currently eligible'),
    rank: z.number().int().nullable().describe('Current rank (null if not ranked)'),
    role: z.enum(['naib', 'fedaykin', null]).nullable().describe('Current role'),
    bgt_held: z.number().describe('BGT tokens held'),
    last_check: z.string().datetime().describe('Last eligibility check timestamp'),
  })
  .openapi('WalletEligibility');

// =============================================================================
// Profile Schemas
// =============================================================================

const BadgeSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().describe('Badge type identifier'),
    name: z.string().describe('Display name'),
    description: z.string().describe('Badge description'),
    awardedAt: z.string().datetime(),
    awardedBy: z.string().nullable().describe('Discord ID of awarder (for Water Sharer)'),
  })
  .openapi('Badge');

const MemberProfileSchema = z
  .object({
    discordId: z.string().describe('Discord user ID'),
    walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable(),
    displayName: z.string().nullable(),
    rank: z.number().int().nullable(),
    role: z.enum(['naib', 'fedaykin', null]).nullable(),
    tier: z.string().nullable().describe('Tier name (e.g., Naib, Fedaykin, Usul)'),
    badges: z.array(BadgeSchema),
    joinedAt: z.string().datetime(),
    lastActive: z.string().datetime().nullable(),
  })
  .openapi('MemberProfile');

// =============================================================================
// Health & Metrics Schemas
// =============================================================================

const HealthResponseSchema = z
  .object({
    status: z.enum(['healthy', 'degraded', 'unhealthy']),
    version: z.string().describe('API version'),
    uptime: z.number().describe('Server uptime in seconds'),
    checks: z.object({
      database: z.enum(['ok', 'error']),
      redis: z.enum(['ok', 'error']),
      scoreService: z.enum(['ok', 'degraded', 'error']),
    }),
    lastSuccessfulQuery: z.string().datetime().nullable(),
    inGracePeriod: z.boolean(),
  })
  .openapi('HealthResponse');

// =============================================================================
// Directory Schemas
// =============================================================================

const DirectoryEntrySchema = z
  .object({
    rank: z.number().int(),
    discordId: z.string(),
    displayName: z.string().nullable(),
    walletAddress: z.string().nullable(),
    tier: z.string(),
    badges: z.array(z.string()).describe('Badge type identifiers'),
    lastActive: z.string().datetime().nullable(),
  })
  .openapi('DirectoryEntry');

const DirectoryResponseSchema = z
  .object({
    entries: z.array(DirectoryEntrySchema),
    pagination: PaginationSchema,
    filters: z.object({
      tier: z.string().nullable(),
      badge: z.string().nullable(),
      search: z.string().nullable(),
    }),
  })
  .openapi('DirectoryResponse');

// =============================================================================
// Threshold Schemas
// =============================================================================

const ThresholdDataSchema = z
  .object({
    currentThreshold: z.number().describe('Current BGT threshold for eligibility'),
    trendDirection: z.enum(['up', 'down', 'stable']),
    changePercent: z.number().describe('24h change percentage'),
    lastUpdated: z.string().datetime(),
  })
  .openapi('ThresholdData');

// =============================================================================
// Register Endpoints
// =============================================================================

// Health endpoint
registry.registerPath({
  method: 'get',
  path: '/health',
  description: 'Health check endpoint for monitoring and load balancers',
  tags: ['System'],
  responses: {
    200: {
      description: 'System health status',
      content: {
        'application/json': {
          schema: HealthResponseSchema,
        },
      },
    },
  },
});

// Eligibility endpoints
registry.registerPath({
  method: 'get',
  path: '/eligibility',
  description: 'Get current eligibility list (top 69 wallets)',
  tags: ['Eligibility'],
  responses: {
    200: {
      description: 'Current eligibility data',
      content: {
        'application/json': {
          schema: EligibilityResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/eligibility/{address}',
  description: 'Check eligibility for a specific wallet address',
  tags: ['Eligibility'],
  request: {
    params: z.object({
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe('Ethereum address'),
    }),
  },
  responses: {
    200: {
      description: 'Wallet eligibility status',
      content: {
        'application/json': {
          schema: WalletEligibilitySchema,
        },
      },
    },
    400: {
      description: 'Invalid address format',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Address not found in eligibility data',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Profile endpoints
registry.registerPath({
  method: 'get',
  path: '/members/profile/{discordId}',
  description: 'Get member profile by Discord ID',
  tags: ['Members'],
  security: [{ apiKey: [] }],
  request: {
    params: z.object({
      discordId: z.string().describe('Discord user ID'),
    }),
  },
  responses: {
    200: {
      description: 'Member profile',
      content: {
        'application/json': {
          schema: MemberProfileSchema,
        },
      },
    },
    401: {
      description: 'API key required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    404: {
      description: 'Member not found',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Directory endpoint
registry.registerPath({
  method: 'get',
  path: '/members/directory',
  description: 'Get paginated member directory with filtering',
  tags: ['Members'],
  security: [{ apiKey: [] }],
  request: {
    query: z.object({
      page: z.string().optional().describe('Page number'),
      limit: z.string().optional().describe('Items per page'),
      tier: z.string().optional().describe('Filter by tier'),
      badge: z.string().optional().describe('Filter by badge type'),
      search: z.string().optional().describe('Search by name or address'),
    }),
  },
  responses: {
    200: {
      description: 'Paginated directory listing',
      content: {
        'application/json': {
          schema: DirectoryResponseSchema,
        },
      },
    },
    401: {
      description: 'API key required',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// Threshold endpoint
registry.registerPath({
  method: 'get',
  path: '/threshold',
  description: 'Get current BGT threshold data',
  tags: ['Threshold'],
  responses: {
    200: {
      description: 'Current threshold data',
      content: {
        'application/json': {
          schema: ThresholdDataSchema,
        },
      },
    },
  },
});

// Metrics endpoint
registry.registerPath({
  method: 'get',
  path: '/metrics',
  description: 'Prometheus metrics endpoint',
  tags: ['System'],
  responses: {
    200: {
      description: 'Prometheus-formatted metrics',
      content: {
        'text/plain': {
          schema: z.string(),
        },
      },
    },
  },
});

// =============================================================================
// Security Schemes
// =============================================================================

registry.registerComponent('securitySchemes', 'apiKey', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  description: 'API key for authenticated endpoints',
});

// =============================================================================
// Generate OpenAPI Document
// =============================================================================

export function generateOpenAPIDocument() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'Arrakis API',
      version: '5.1.0',
      description: `
Arrakis is a multi-tenant, chain-agnostic SaaS platform for managing Discord community tiers based on on-chain activity.

## Authentication

Most endpoints require API key authentication. Include your API key in the \`X-API-Key\` header:

\`\`\`
X-API-Key: your-api-key-here
\`\`\`

## Rate Limiting

- Public endpoints: 100 requests/minute
- Authenticated endpoints: 1000 requests/minute
- Admin endpoints: 500 requests/minute

Rate limit headers are included in all responses:
- \`X-RateLimit-Limit\`: Maximum requests per window
- \`X-RateLimit-Remaining\`: Remaining requests in current window
- \`X-RateLimit-Reset\`: Unix timestamp when window resets

## Error Handling

All errors follow a consistent format:

\`\`\`json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": { ... }
}
\`\`\`

## Versioning

This API uses URL path versioning. The current version is v1.
      `.trim(),
      contact: {
        name: 'HoneyJar Engineering',
        url: 'https://honeyjar.xyz',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers: [
      {
        url: 'https://api.arrakis.honeyjar.xyz',
        description: 'Production server',
      },
      {
        url: 'http://localhost:3000',
        description: 'Local development server',
      },
    ],
    tags: [
      { name: 'System', description: 'Health and metrics endpoints' },
      { name: 'Eligibility', description: 'Wallet eligibility checks' },
      { name: 'Members', description: 'Member profiles and directory' },
      { name: 'Threshold', description: 'BGT threshold data' },
    ],
  });
}

// Export schemas for reuse
export {
  ErrorResponseSchema,
  PaginationSchema,
  EligibilityResponseSchema,
  WalletEligibilitySchema,
  MemberProfileSchema,
  DirectoryResponseSchema,
  HealthResponseSchema,
  ThresholdDataSchema,
  BadgeSchema,
};
