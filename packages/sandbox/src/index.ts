/**
 * Sandbox Package - Discord Server Sandboxes
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 * Sprint 86: Discord Server Sandboxes - Event Routing
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
} from './services/index.js';
