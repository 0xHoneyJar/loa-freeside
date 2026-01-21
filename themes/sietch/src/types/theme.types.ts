/**
 * Theme Builder Core Types
 *
 * Root types for the WYSIWYG theme builder.
 * Sprint 1: Foundation - Database Schema & Types
 *
 * @see grimoires/loa/sdd.md §4. Data Models
 */

import type { Address } from 'viem';
import type {
  ComponentType,
  ComponentInstance,
} from './theme-component.types.js';
import type {
  ContractBinding,
  ChainConfig,
  GateConfig,
} from './theme-web3.types.js';

// =============================================================================
// Theme Root Types
// =============================================================================

/**
 * Theme status enum
 */
export type ThemeStatus = 'draft' | 'published';

/**
 * Theme - Root configuration object
 * Stored in the `themes` table with JSON config field
 */
export interface Theme {
  // Identity
  id: string;                     // UUID v4
  communityId: string;            // Owner community

  // Metadata
  name: string;                   // Display name (max 100 chars)
  description: string;            // Description (max 500 chars)

  // Visual Configuration
  branding: ThemeBranding;

  // Structure
  pages: ThemePage[];             // Page definitions

  // Web3 Configuration
  contracts: ContractBinding[];   // Contract bindings
  chains: ChainConfig[];          // Enabled chains

  // Platform-Specific
  discord?: DiscordThemeConfig;

  // State
  status: ThemeStatus;
  version: string;                // SemVer (e.g., "1.0.0")
  publishedAt?: string;           // ISO 8601 timestamp

  // Timestamps
  createdAt: string;              // ISO 8601 timestamp
  updatedAt: string;              // ISO 8601 timestamp
}

/**
 * ThemeConfig - JSON-serialized config stored in database
 * Contains all theme data except identity and status fields
 */
export interface ThemeConfig {
  branding: ThemeBranding;
  pages: ThemePage[];
  contracts: ContractBinding[];
  chains: ChainConfig[];
  discord?: DiscordThemeConfig;
}

/**
 * Theme database row (raw SQLite result)
 */
export interface ThemeRow {
  id: string;
  community_id: string;
  name: string;
  description: string;
  status: ThemeStatus;
  config: string;                 // JSON string
  version: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

// =============================================================================
// Branding Types
// =============================================================================

/**
 * Border radius preset options
 */
export type BorderRadiusPreset = 'none' | 'sm' | 'md' | 'lg' | 'full';

/**
 * Spacing preset options
 */
export type SpacingPreset = 'compact' | 'comfortable' | 'spacious';

/**
 * Font source types
 */
export type FontSource = 'system' | 'google' | 'custom';

/**
 * ThemeBranding - Visual identity configuration
 */
export interface ThemeBranding {
  // Colors
  colors: ThemeColors;

  // Typography
  fonts: ThemeFonts;

  // Assets
  logo?: ThemeLogo;
  favicon?: string;               // URL to favicon

  // Layout
  borderRadius: BorderRadiusPreset;
  spacing: SpacingPreset;
}

/**
 * ThemeColors - Color palette configuration
 */
export interface ThemeColors {
  primary: string;                // Hex color
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  error: string;
  success: string;
  warning: string;
}

/**
 * ThemeFonts - Typography configuration
 */
export interface ThemeFonts {
  heading: FontConfig;
  body: FontConfig;
  mono: FontConfig;
}

/**
 * FontConfig - Individual font definition
 */
export interface FontConfig {
  family: string;                 // Font family name
  source: FontSource;
  url?: string;                   // For custom fonts
  weights: number[];              // Available weights (e.g., [400, 500, 700])
}

/**
 * ThemeLogo - Logo asset configuration
 */
export interface ThemeLogo {
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

// =============================================================================
// Page Types
// =============================================================================

/**
 * Page layout options
 */
export type PageLayout = 'full' | 'sidebar' | 'dashboard';

/**
 * Page visibility options
 */
export type PageVisibility = 'public' | 'members' | 'gated';

/**
 * ThemePage - Page definition
 */
export interface ThemePage {
  id: string;                     // UUID v4
  slug: string;                   // URL slug (unique per theme)
  name: string;                   // Display name
  layout: PageLayout;
  components: ComponentInstance[];
  meta?: PageMeta;
  visibility: PageVisibility;
  gateConfig?: GateConfig;        // If visibility is 'gated'
}

/**
 * PageMeta - SEO and metadata
 */
export interface PageMeta {
  title?: string;
  description?: string;
}

// =============================================================================
// Discord Theme Types
// =============================================================================

/**
 * Discord permission mode
 */
export type DiscordPermissionMode = 'greenfield' | 'restricted';

/**
 * DiscordThemeConfig - Discord embed customization
 */
export interface DiscordThemeConfig {
  // Permission mode
  mode: DiscordPermissionMode;

  // Embed templates
  embedTemplates: DiscordEmbedTemplates;

  // Colors (integer color values for Discord API)
  colors: DiscordColors;
}

/**
 * DiscordEmbedTemplates - Collection of embed templates
 */
export interface DiscordEmbedTemplates {
  welcome?: DiscordEmbedTemplate;
  leaderboard?: DiscordEmbedTemplate;
  alert?: DiscordEmbedTemplate;
  custom?: Record<string, DiscordEmbedTemplate>;
}

/**
 * DiscordColors - Discord color palette (integer values)
 */
export interface DiscordColors {
  primary: number;
  success: number;
  warning: number;
  error: number;
}

/**
 * DiscordEmbedTemplate - Embed structure template
 */
export interface DiscordEmbedTemplate {
  title?: string;                 // Supports {{variables}}
  description?: string;
  color?: number;
  thumbnail?: boolean;
  footer?: DiscordEmbedFooter;
  fields?: DiscordEmbedField[];
}

/**
 * DiscordEmbedFooter - Embed footer configuration
 */
export interface DiscordEmbedFooter {
  text: string;
  iconUrl?: string;
}

/**
 * DiscordEmbedField - Embed field configuration
 */
export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

// =============================================================================
// Theme Version Types
// =============================================================================

/**
 * ThemeVersion - Version history entry
 */
export interface ThemeVersion {
  id: string;                     // UUID v4
  themeId: string;
  version: string;                // SemVer
  config: ThemeConfig;            // Full theme snapshot
  changeSummary?: string;
  changedBy: string;              // User ID
  createdAt: string;              // ISO 8601 timestamp
}

/**
 * ThemeVersion database row
 */
export interface ThemeVersionRow {
  id: string;
  theme_id: string;
  version: string;
  config: string;                 // JSON string
  change_summary: string | null;
  changed_by: string;
  created_at: string;
}

// =============================================================================
// Theme Asset Types
// =============================================================================

/**
 * Asset type enum
 */
export type ThemeAssetType = 'logo' | 'image' | 'font' | 'favicon';

/**
 * Asset storage type
 */
export type AssetStorageType = 'local' | 's3';

/**
 * ThemeAsset - Uploaded asset metadata
 */
export interface ThemeAsset {
  id: string;                     // UUID v4
  themeId: string;
  name: string;                   // Original filename
  type: ThemeAssetType;
  mimeType: string;
  size: number;                   // Size in bytes
  storagePath: string;
  storageType: AssetStorageType;
  createdAt: string;              // ISO 8601 timestamp
}

/**
 * ThemeAsset database row
 */
export interface ThemeAssetRow {
  id: string;
  theme_id: string;
  name: string;
  type: ThemeAssetType;
  mime_type: string;
  size: number;
  storage_path: string;
  storage_type: AssetStorageType;
  created_at: string;
}

// =============================================================================
// Audit Log Types
// =============================================================================

/**
 * Audit action types
 */
export type AuditAction = 'create' | 'update' | 'publish' | 'unpublish' | 'delete';

/**
 * Audit actor types
 */
export type AuditActorType = 'user' | 'system' | 'api';

/**
 * ThemeAuditLog - Audit trail entry
 */
export interface ThemeAuditLog {
  id: number;
  themeId: string;
  action: AuditAction;
  actorId: string;
  actorType: AuditActorType;
  details?: Record<string, unknown>;
  createdAt: string;              // ISO 8601 timestamp
}

/**
 * ThemeAuditLog database row
 */
export interface ThemeAuditLogRow {
  id: number;
  theme_id: string;
  action: AuditAction;
  actor_id: string;
  actor_type: AuditActorType;
  details: string | null;         // JSON string
  created_at: string;
}

// =============================================================================
// API Types
// =============================================================================

/**
 * CreateThemeInput - Input for creating a new theme
 */
export interface CreateThemeInput {
  communityId: string;
  name: string;
  description?: string;
  branding?: Partial<ThemeBranding>;
}

/**
 * UpdateThemeInput - Input for updating theme metadata
 */
export interface UpdateThemeInput {
  name?: string;
  description?: string;
}

/**
 * UpdateThemeConfigInput - Input for updating theme config
 */
export interface UpdateThemeConfigInput {
  branding?: Partial<ThemeBranding>;
  pages?: ThemePage[];
  contracts?: ContractBinding[];
  chains?: ChainConfig[];
  discord?: DiscordThemeConfig;
  changeSummary?: string;
}

/**
 * ThemeListOptions - Options for listing themes
 */
export interface ThemeListOptions {
  communityId?: string;
  status?: ThemeStatus;
  limit?: number;
  offset?: number;
  orderBy?: 'created_at' | 'updated_at' | 'name';
  orderDir?: 'asc' | 'desc';
}

/**
 * PaginatedThemeList - Paginated theme list response
 */
export interface PaginatedThemeList {
  themes: Theme[];
  total: number;
  limit: number;
  offset: number;
}
