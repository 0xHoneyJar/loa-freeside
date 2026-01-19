/**
 * ProviderRegistry - Extensible Provider Detection System
 *
 * Sprint 103: Provider Registry
 *
 * Hybrid registry that loads built-in providers from JSON files
 * and supports custom providers from database. Provides pattern-based
 * detection for incumbent token-gating bots.
 *
 * Loading Priority:
 * 1. JSON files from providers/ directory (built-in)
 * 2. Hardcoded fallback (if JSON files missing)
 * 3. Database custom providers (community-defined)
 *
 * @module packages/adapters/coexistence/ProviderRegistry
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';
import type { IncumbentCapabilities } from '../storage/schema.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Provider definition for detection
 */
export interface ProviderDefinition {
  /** Unique provider identifier (lowercase, no spaces) */
  slug: string;
  /** Human-readable display name */
  name: string;
  /** Known bot IDs for high-confidence detection */
  botIds: string[];
  /** Channel name patterns for detection */
  channelPatterns: string[];
  /** Role name patterns for detection */
  rolePatterns: string[];
  /** Bot username patterns for detection */
  usernamePatterns: string[];
  /** Provider capabilities */
  capabilities: IncumbentCapabilities;
  /** Detection weight (0.0-1.0) - higher = preferred in conflicts */
  weight: number;
  /** Whether this is a built-in provider */
  isBuiltin: boolean;
  /** Community ID (null for built-in providers) */
  communityId?: string | null;
}

/**
 * Custom provider from database
 */
export interface CustomProviderRecord {
  id: string;
  slug: string;
  name: string;
  communityId: string;
  botIds: string[];
  channelPatterns: string[];
  rolePatterns: string[];
  weight: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Provider match result
 */
export interface ProviderMatch {
  provider: ProviderDefinition;
  matchType: 'bot_id' | 'username' | 'channel' | 'role' | 'generic';
  confidence: number;
  matchedValue: string;
}

// =============================================================================
// Hardcoded Fallback Providers
// =============================================================================

/**
 * Hardcoded provider definitions used when JSON files are unavailable
 */
const FALLBACK_PROVIDERS: ProviderDefinition[] = [
  {
    slug: 'collabland',
    name: 'Collab.Land',
    botIds: ['704521096837464076'],
    channelPatterns: ['collabland-join', 'collabland-config', 'collab-land', 'verify', 'verification'],
    rolePatterns: ['holder', 'verified', 'whale', 'member', 'nft-holder', 'token-holder'],
    usernamePatterns: ['collab.land', 'collabland'],
    capabilities: {
      hasBalanceCheck: true,
      hasConvictionScoring: false,
      hasTierSystem: true,
      hasSocialLayer: false,
    },
    weight: 1.0,
    isBuiltin: true,
    communityId: null,
  },
  {
    slug: 'matrica',
    name: 'Matrica',
    botIds: [],
    channelPatterns: ['matrica-verify', 'matrica', 'matrica-join'],
    rolePatterns: ['verified', 'holder', 'matrica-verified'],
    usernamePatterns: ['matrica'],
    capabilities: {
      hasBalanceCheck: true,
      hasConvictionScoring: false,
      hasTierSystem: false,
      hasSocialLayer: false,
    },
    weight: 0.9,
    isBuiltin: true,
    communityId: null,
  },
  {
    slug: 'guild.xyz',
    name: 'Guild.xyz',
    botIds: [],
    channelPatterns: ['guild-join', 'guild-verify', 'guild'],
    rolePatterns: ['guild-member', 'verified', 'guild-verified'],
    usernamePatterns: ['guild.xyz', 'guild'],
    capabilities: {
      hasBalanceCheck: true,
      hasConvictionScoring: false,
      hasTierSystem: true,
      hasSocialLayer: false,
    },
    weight: 0.9,
    isBuiltin: true,
    communityId: null,
  },
];

// =============================================================================
// Confidence Levels
// =============================================================================

export const MATCH_CONFIDENCE = {
  BOT_ID: 0.95,
  USERNAME: 0.85,
  CHANNEL: 0.70,
  ROLE: 0.50,
  GENERIC: 0.40,
} as const;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Provider Registry for extensible incumbent detection
 */
export class ProviderRegistry {
  private readonly logger: ILogger;
  private builtinProviders: Map<string, ProviderDefinition> = new Map();
  private customProviders: Map<string, ProviderDefinition> = new Map();
  private providersDir: string;
  private initialized = false;

  constructor(
    private readonly getCustomProviders?: (communityId?: string) => Promise<CustomProviderRecord[]>,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'ProviderRegistry' });

    // Determine providers directory path
    const currentDir = typeof __dirname !== 'undefined'
      ? __dirname
      : dirname(fileURLToPath(import.meta.url));
    this.providersDir = join(currentDir, 'providers');
  }

  /**
   * Initialize the registry (load providers)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.loadBuiltinProviders();
    this.initialized = true;

    this.logger.info('ProviderRegistry initialized', {
      builtinCount: this.builtinProviders.size,
      loadedFrom: existsSync(this.providersDir) ? 'filesystem' : 'fallback',
    });
  }

  /**
   * Load built-in providers from JSON files or fallback
   */
  private loadBuiltinProviders(): void {
    if (existsSync(this.providersDir)) {
      try {
        const files = readdirSync(this.providersDir).filter(f => f.endsWith('.json'));

        for (const file of files) {
          try {
            const content = readFileSync(join(this.providersDir, file), 'utf-8');
            const provider = JSON.parse(content) as ProviderDefinition;

            // Validate required fields
            if (!this.validateProviderDefinition(provider)) {
              this.logger.warn('Invalid provider definition, skipping', { file });
              continue;
            }

            provider.isBuiltin = true;
            provider.communityId = null;
            this.builtinProviders.set(provider.slug, provider);

            this.logger.debug('Loaded provider from file', {
              slug: provider.slug,
              file,
            });
          } catch (err) {
            this.logger.warn('Failed to load provider file', { file, error: String(err) });
          }
        }

        if (this.builtinProviders.size > 0) {
          this.logger.info('Loaded providers from filesystem', {
            count: this.builtinProviders.size,
            providers: [...this.builtinProviders.keys()],
          });
          return;
        }
      } catch (err) {
        this.logger.warn('Failed to read providers directory', { error: String(err) });
      }
    }

    // Fallback to hardcoded providers
    this.logger.info('Using fallback hardcoded providers');
    for (const provider of FALLBACK_PROVIDERS) {
      this.builtinProviders.set(provider.slug, provider);
    }
  }

  /**
   * Validate a provider definition has required fields
   */
  private validateProviderDefinition(provider: unknown): provider is ProviderDefinition {
    if (!provider || typeof provider !== 'object') return false;

    const p = provider as Record<string, unknown>;

    return (
      typeof p.slug === 'string' && p.slug.length > 0 &&
      typeof p.name === 'string' && p.name.length > 0 &&
      Array.isArray(p.botIds) &&
      Array.isArray(p.channelPatterns) &&
      Array.isArray(p.rolePatterns) &&
      typeof p.capabilities === 'object' && p.capabilities !== null
    );
  }

  /**
   * Validate pattern for ReDoS safety
   */
  validatePattern(pattern: string): boolean {
    // Block patterns with known ReDoS indicators
    const redosIndicators = [
      /\(\.\*\)\{2,\}/, // Nested quantifiers on wildcards
      /\(\[^\]]+\)\+\+/, // Possessive quantifiers
      /\(\.\+\)\{2,\}/, // Nested greedy quantifiers
      /\(\.\*\)\+/, // Quantifier on wildcard group
    ];

    for (const indicator of redosIndicators) {
      if (indicator.test(pattern)) {
        return false;
      }
    }

    // Check pattern length (very long patterns are suspicious)
    if (pattern.length > 100) {
      return false;
    }

    // Try to compile with timeout protection
    try {
      new RegExp(pattern, 'i');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get all built-in providers
   */
  getBuiltinProviders(): ProviderDefinition[] {
    return [...this.builtinProviders.values()];
  }

  /**
   * Get a provider by slug (checks builtin first, then custom)
   */
  async getProvider(slug: string, communityId?: string): Promise<ProviderDefinition | null> {
    // Check builtin first
    const builtin = this.builtinProviders.get(slug);
    if (builtin) return builtin;

    // Check custom providers if getter provided
    if (this.getCustomProviders && communityId) {
      await this.loadCustomProviders(communityId);
      const custom = this.customProviders.get(`${communityId}:${slug}`);
      if (custom) return custom;
    }

    return null;
  }

  /**
   * Load custom providers from database for a community
   */
  private async loadCustomProviders(communityId: string): Promise<void> {
    if (!this.getCustomProviders) return;

    try {
      const records = await this.getCustomProviders(communityId);

      for (const record of records) {
        if (!record.isActive) continue;

        const provider: ProviderDefinition = {
          slug: record.slug,
          name: record.name,
          botIds: record.botIds,
          channelPatterns: record.channelPatterns,
          rolePatterns: record.rolePatterns,
          usernamePatterns: [], // Custom providers don't have username patterns
          capabilities: {
            hasBalanceCheck: true,
            hasConvictionScoring: false,
            hasTierSystem: false,
            hasSocialLayer: false,
          },
          weight: record.weight,
          isBuiltin: false,
          communityId: record.communityId,
        };

        this.customProviders.set(`${communityId}:${record.slug}`, provider);
      }
    } catch (err) {
      this.logger.error('Failed to load custom providers', { communityId, error: String(err) });
    }
  }

  /**
   * Match custom providers against detection evidence
   */
  async matchCustomProviders(
    communityId: string,
    evidence: {
      botIds?: string[];
      channelNames?: string[];
      roleNames?: string[];
      botUsernames?: string[];
    }
  ): Promise<ProviderMatch[]> {
    const matches: ProviderMatch[] = [];

    // Load custom providers for this community
    await this.loadCustomProviders(communityId);

    // Get all providers for this community
    const communityProviders = [...this.customProviders.values()].filter(
      p => p.communityId === communityId
    );

    for (const provider of communityProviders) {
      // Check bot IDs
      if (evidence.botIds) {
        for (const botId of evidence.botIds) {
          if (provider.botIds.includes(botId)) {
            matches.push({
              provider,
              matchType: 'bot_id',
              confidence: MATCH_CONFIDENCE.BOT_ID * provider.weight,
              matchedValue: botId,
            });
          }
        }
      }

      // Check channel patterns
      if (evidence.channelNames) {
        for (const channelName of evidence.channelNames) {
          for (const pattern of provider.channelPatterns) {
            if (this.matchesPattern(channelName, pattern)) {
              matches.push({
                provider,
                matchType: 'channel',
                confidence: MATCH_CONFIDENCE.CHANNEL * provider.weight,
                matchedValue: channelName,
              });
            }
          }
        }
      }

      // Check role patterns
      if (evidence.roleNames) {
        for (const roleName of evidence.roleNames) {
          for (const pattern of provider.rolePatterns) {
            if (this.matchesPattern(roleName, pattern)) {
              matches.push({
                provider,
                matchType: 'role',
                confidence: MATCH_CONFIDENCE.ROLE * provider.weight,
                matchedValue: roleName,
              });
            }
          }
        }
      }
    }

    // Sort by confidence (highest first)
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Match all providers (builtin + custom) against evidence
   */
  async matchAllProviders(
    communityId: string | null,
    evidence: {
      botIds?: string[];
      channelNames?: string[];
      roleNames?: string[];
      botUsernames?: string[];
    }
  ): Promise<ProviderMatch[]> {
    const matches: ProviderMatch[] = [];

    // Check builtin providers
    for (const provider of this.builtinProviders.values()) {
      // Check bot IDs
      if (evidence.botIds) {
        for (const botId of evidence.botIds) {
          if (provider.botIds.includes(botId)) {
            matches.push({
              provider,
              matchType: 'bot_id',
              confidence: MATCH_CONFIDENCE.BOT_ID * provider.weight,
              matchedValue: botId,
            });
          }
        }
      }

      // Check usernames
      if (evidence.botUsernames) {
        for (const username of evidence.botUsernames) {
          for (const pattern of provider.usernamePatterns) {
            if (this.matchesPattern(username, pattern)) {
              matches.push({
                provider,
                matchType: 'username',
                confidence: MATCH_CONFIDENCE.USERNAME * provider.weight,
                matchedValue: username,
              });
            }
          }
        }
      }

      // Check channel patterns
      if (evidence.channelNames) {
        for (const channelName of evidence.channelNames) {
          for (const pattern of provider.channelPatterns) {
            if (this.matchesPattern(channelName, pattern)) {
              matches.push({
                provider,
                matchType: 'channel',
                confidence: MATCH_CONFIDENCE.CHANNEL * provider.weight,
                matchedValue: channelName,
              });
            }
          }
        }
      }

      // Check role patterns
      if (evidence.roleNames) {
        for (const roleName of evidence.roleNames) {
          for (const pattern of provider.rolePatterns) {
            if (this.matchesPattern(roleName, pattern)) {
              matches.push({
                provider,
                matchType: 'role',
                confidence: MATCH_CONFIDENCE.ROLE * provider.weight,
                matchedValue: roleName,
              });
            }
          }
        }
      }
    }

    // Also check custom providers if community ID provided
    if (communityId) {
      const customMatches = await this.matchCustomProviders(communityId, evidence);
      matches.push(...customMatches);
    }

    // Sort by confidence (highest first) and dedupe by provider
    return this.dedupeMatches(matches);
  }

  /**
   * Check if a string matches a pattern (case-insensitive contains)
   */
  private matchesPattern(value: string, pattern: string): boolean {
    return value.toLowerCase().includes(pattern.toLowerCase());
  }

  /**
   * Deduplicate matches, keeping highest confidence per provider
   */
  private dedupeMatches(matches: ProviderMatch[]): ProviderMatch[] {
    const byProvider = new Map<string, ProviderMatch>();

    for (const match of matches) {
      const key = `${match.provider.communityId ?? 'builtin'}:${match.provider.slug}`;
      const existing = byProvider.get(key);

      if (!existing || match.confidence > existing.confidence) {
        byProvider.set(key, match);
      }
    }

    return [...byProvider.values()].sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get provider display name
   */
  getProviderDisplayName(slug: string): string {
    const provider = this.builtinProviders.get(slug);
    if (provider) return provider.name;

    // Format unknown slugs nicely
    return slug
      .split(/[-_.]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Check if registry is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

/**
 * Factory function to create ProviderRegistry
 */
export function createProviderRegistry(
  getCustomProviders?: (communityId?: string) => Promise<CustomProviderRecord[]>,
  logger?: ILogger
): ProviderRegistry {
  return new ProviderRegistry(getCustomProviders, logger);
}
