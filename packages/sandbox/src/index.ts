/**
 * Sandbox Package - Discord Server Sandboxes
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 * Sprint 86: Discord Server Sandboxes - Event Routing
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 *
 * Provides isolated testing environments for Arrakis Discord functionality.
 * Each sandbox gets its own PostgreSQL schema, Redis key prefix, and NATS subjects.
 *
 * @see SDD §5.0 Detailed Design
 * @module @arrakis/sandbox
 */

// =============================================================================
// Type Exports
// =============================================================================

export type {
  SandboxStatus,
  SandboxMetadata,
  CreateSandboxOptions,
  Sandbox,
  SandboxHealthCheck,
  HealthLevel,
  SandboxHealthStatus,
  SandboxConnectionDetails,
  SandboxFilter,
  AuditEventType,
  AuditLogEntry,
  SchemaStats,
} from './types.js';

export { VALID_STATUS_TRANSITIONS, SandboxErrorCode, SandboxError } from './types.js';

// =============================================================================
// Schema Exports
// =============================================================================

export {
  sandboxStatusEnum,
  sandboxes,
  sandboxGuildMapping,
  sandboxAuditLog,
  sandboxesRelations,
  sandboxGuildMappingRelations,
  sandboxAuditLogRelations,
} from './schema.js';

export type {
  DrizzleSandbox,
  DrizzleNewSandbox,
  DrizzleGuildMapping,
  DrizzleNewGuildMapping,
  DrizzleAuditLog,
  DrizzleNewAuditLog,
} from './schema.js';

// =============================================================================
// Service Exports
// =============================================================================

export {
  SchemaProvisioner,
  SandboxManager,
  RouteProvider,
  EventRouter,
  SANDBOX_STREAM_CONFIG,
  CleanupProvider,
} from './services/index.js';

export type {
  SchemaProvisionerConfig,
  SchemaCreateResult,
  SchemaDropResult,
  SandboxManagerConfig,
  SandboxCreateResult,
  RouteProviderConfig,
  RouteLookupResult,
  RouteMapping,
  EventRouterConfig,
  DiscordEvent,
  RoutingStats,
  RoutingResult,
  CleanupProviderConfig,
  CleanupResult,
  CleanupStep,
  OrphanedResources,
  CleanupStats,
} from './services/index.js';

// =============================================================================
// Metrics Exports (Sprint 87)
// =============================================================================

export {
  sandboxRegistry,
  sandboxesCreated,
  sandboxesDestroyed,
  sandboxesActive,
  sandboxCreationDuration,
  cleanupJobRuns,
  cleanupSandboxes,
  cleanupDuration,
  orphanedResourcesFound,
  schemasCreated,
  schemasDropped,
  schemaOperationDuration,
  routeLookups,
  routeLookupDuration,
  guildMappings,
  eventsRouted,
  eventRoutingDuration,
  eventRoutingErrors,
  sandboxHealthStatus,
  recordSandboxCreated,
  recordSandboxDestroyed,
  recordCleanupRun,
  recordRouteLookup,
  recordEventRouted,
  updateSandboxHealth,
  updateActiveSandboxCount,
  updateGuildMappingCount,
  updateOrphanedResources,
  collectSandboxMetrics,
} from './metrics.js';
