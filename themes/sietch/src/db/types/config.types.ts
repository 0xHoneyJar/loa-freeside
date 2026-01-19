/**
 * Configuration Types for Dashboard
 *
 * Sprint 117: Database Schema (Task 117.7)
 *
 * TypeScript interfaces matching the database schema for type-safe
 * configuration management. All types include schema_version for
 * forward compatibility.
 *
 * @see grimoires/loa/sdd.md §5.2 TypeScript Interfaces
 */

// =============================================================================
// Action & Type Enums
// =============================================================================

export type ConfigAction = 'CREATE' | 'UPDATE' | 'DELETE' | 'RESTORE';

export type RecordableType =
  | 'ThresholdChange'
  | 'FeatureGateChange'
  | 'RoleMapChange'
  | 'ThemeChange'
  | 'CheckpointSnapshot';

export type ThresholdField = 'bgt' | 'engagement' | 'tenure' | 'activity';

export type ThemeChangeType = 'activate' | 'deactivate' | 'modify' | 'create' | 'delete';

export type RoleMappingStatus = 'active' | 'deleted' | 'unknown';

// =============================================================================
// Config Record (History Entry)
// =============================================================================

export interface ConfigRecord {
  id: string;
  serverId: string;
  userId: string;
  action: ConfigAction;
  recordableType: RecordableType;
  recordableId: string;
  schemaVersion: number;
  metadata?: ConfigRecordMetadata;
  createdAt: Date;
}

export interface ConfigRecordMetadata {
  restoredFrom?: string;
  cliCommand?: string;
  sessionId?: string;
  clientVersion?: string;
  reason?: string;
}

/**
 * Config record with its delegated payload loaded
 */
export interface ConfigRecordWithPayload extends ConfigRecord {
  payload: ThresholdChange | FeatureGateChange | RoleMapChange | ThemeChange | CheckpointSnapshot;
}

// =============================================================================
// Delegated Payload Types
// =============================================================================

export interface ThresholdChange {
  id: string;
  schemaVersion: number;
  tierId: string;
  field: ThresholdField;
  oldValue: number | null;
  newValue: number;
}

export interface FeatureGateChange {
  id: string;
  schemaVersion: number;
  featureId: string;
  tierId: string;
  oldAccess: boolean | null;
  newAccess: boolean;
  condition?: string;
}

export interface RoleMapChange {
  id: string;
  schemaVersion: number;
  roleId: string;
  roleName: string;
  oldTierId: string | null;
  newTierId: string | null;
  priority: number;
}

export interface ThemeChange {
  id: string;
  schemaVersion: number;
  themeName: string;
  changeType: ThemeChangeType;
  configSnapshot: Record<string, unknown>;
}

export interface CheckpointSnapshot {
  id: string;
  serverId: string;
  schemaVersion: number;
  triggerCommand: string;
  fullStateJson: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}

// =============================================================================
// Current Configuration (Head Pointer)
// =============================================================================

export interface CurrentConfiguration {
  serverId: string;
  thresholds: Record<string, TierThresholds>;
  featureGates: Record<string, FeatureGate>;
  roleMappings: Record<string, RoleMapping>;
  activeThemeId: string | null;
  lastRecordId: string | null;
  version: number;
  schemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TierThresholds {
  bgt?: number;
  engagement?: number;
  tenure?: number;
  activity?: number;
}

export interface FeatureGate {
  tierId: string;
  condition?: string;
}

export interface RoleMapping {
  roleId: string;
  roleName: string;
  tierId: string;
  priority: number;
  status: RoleMappingStatus;
}

// =============================================================================
// Input Types (for API operations)
// =============================================================================

export interface ThresholdChangeInput {
  tierId: string;
  field: ThresholdField;
  newValue: number;
}

export interface FeatureGateChangeInput {
  featureId: string;
  tierId: string;
  newAccess: boolean;
  condition?: string;
}

export interface RoleMapChangeInput {
  roleId: string;
  roleName: string;
  newTierId: string | null;
  priority?: number;
}

// =============================================================================
// Query Types
// =============================================================================

export interface ConfigHistoryQuery {
  serverId: string;
  recordableType?: RecordableType;
  userId?: string;
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

export interface ConfigHistoryResult {
  records: ConfigRecordWithPayload[];
  total: number;
  hasMore: boolean;
}

// =============================================================================
// Database Row Types (raw SQLite data)
// =============================================================================

export interface CurrentConfigurationRow {
  server_id: string;
  thresholds: string;       // JSON string
  feature_gates: string;    // JSON string
  role_mappings: string;    // JSON string
  active_theme_id: string | null;
  last_record_id: string | null;
  version: number;
  schema_version: number;
  created_at: string;       // ISO datetime string
  updated_at: string;       // ISO datetime string
}

export interface ConfigRecordRow {
  id: string;
  server_id: string;
  user_id: string;
  action: ConfigAction;
  recordable_type: RecordableType;
  recordable_id: string;
  metadata: string;         // JSON string
  schema_version: number;
  created_at: string;       // ISO datetime string
}

export interface ThresholdChangeRow {
  id: string;
  schema_version: number;
  tier_id: string;
  field: ThresholdField;
  old_value: number | null;
  new_value: number;
}

export interface FeatureGateChangeRow {
  id: string;
  schema_version: number;
  feature_id: string;
  tier_id: string;
  old_access: number | null;  // 0/1 for boolean
  new_access: number;
  condition: string | null;
}

export interface RoleMapChangeRow {
  id: string;
  schema_version: number;
  role_id: string;
  role_name: string;
  old_tier_id: string | null;
  new_tier_id: string | null;
  priority: number;
}

export interface ThemeChangeRow {
  id: string;
  schema_version: number;
  theme_name: string;
  change_type: ThemeChangeType;
  config_snapshot: string;   // JSON string
}

export interface CheckpointSnapshotRow {
  id: string;
  server_id: string;
  schema_version: number;
  trigger_command: string;
  full_state_json: string;   // JSON string
  created_at: string;        // ISO datetime string
  expires_at: string;        // ISO datetime string
}
