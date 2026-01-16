/**
 * Core Ports
 * Sprint S-15: Native Blockchain Reader & Interface
 * Sprint S-16: Score Service & Two-Tier Orchestration
 * Sprint S-17: Theme Interface & BasicTheme
 * Sprint S-19: Enhanced RLS & Drizzle Adapter
 * Sprint S-20: Wizard Session Store & State Model
 * Sprint S-21: Synthesis Engine & Rate Limiting
 * Sprint S-22: Vault Integration & Kill Switch
 * Sprint S-24: Shadow Ledger & Incumbent Detection
 *
 * Exports all port interfaces (contracts) for the application.
 * Ports define the boundaries between the core domain and external adapters.
 */

// Chain Provider Interface
export * from './chain-provider.js';

// Score Service Protocol Types
export * from './score-service.js';

// Theme Provider Interface
export * from './theme-provider.js';

// Storage Provider Interface (excluding types already exported by theme-provider)
export {
  type Community,
  type CommunitySettings,
  type NewCommunity,
  type Badge,
  type BadgeMetadata,
  type NewBadge,
  type BadgeLineageNode,
  type IStorageProvider,
  type StorageProviderOptions,
  type StorageProviderFactory,
  type StorageValidationResult,
  isValidCommunityId,
  isValidSubscriptionTier,
} from './storage-provider.js';

// Wizard Session Store Interface
export * from './wizard-session-store.js';

// Wizard Engine Interface (Sprint S-23)
export * from './wizard-engine.js';

// Synthesis Engine Interface
export * from './synthesis-engine.js';

// Vault Client Interface
export * from './vault-client.js';

// Shadow Ledger Interface (Sprint S-24)
export * from './shadow-ledger.js';
