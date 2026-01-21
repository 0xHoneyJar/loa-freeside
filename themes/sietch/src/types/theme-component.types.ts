/**
 * Theme Builder Component Types
 *
 * Types for the component system (registry, instances, definitions).
 * Sprint 1: Foundation - Database Schema & Types
 *
 * @see grimoires/loa/sdd.md §4.1 Theme Schema - ComponentInstance
 * @see grimoires/loa/sdd.md §7. Component System
 */

import type { GateConfig, VisibilityCondition } from './theme-web3.types.js';

// =============================================================================
// Component Type Definitions
// =============================================================================

/**
 * Component Types (MVP)
 * These are the built-in component types available in the theme builder.
 */
export type ComponentType =
  | 'token-gate'
  | 'nft-gallery'
  | 'leaderboard'
  | 'profile-card'
  | 'rich-text'
  | 'layout-container'
  | 'image'
  | 'button'
  | 'divider'
  | 'spacer';

/**
 * Component category for UI organization
 */
export type ComponentCategory =
  | 'web3'
  | 'content'
  | 'layout'
  | 'interactive';

// =============================================================================
// Component Instance (Placed Component)
// =============================================================================

/**
 * ComponentInstance - A placed component with configuration
 * This is what gets stored in a ThemePage's components array.
 */
export interface ComponentInstance {
  id: string;                     // Instance UUID
  type: ComponentType;            // Component type identifier
  props: ComponentProps;          // Component-specific props
  position: ComponentPosition;
  visibility?: ComponentVisibility;
  label?: string;                 // Optional user label for the instance
}

/**
 * ComponentProps - Type-safe props union
 * Each component type has its own props interface.
 */
export type ComponentProps =
  | TokenGateProps
  | NFTGalleryProps
  | LeaderboardProps
  | ProfileCardProps
  | RichTextProps
  | LayoutContainerProps
  | ImageProps
  | ButtonProps
  | DividerProps
  | SpacerProps;

/**
 * ComponentPosition - Grid-based positioning
 */
export interface ComponentPosition {
  x: number;                      // Grid column (0-based)
  y: number;                      // Grid row (0-based)
  width: number;                  // Column span (1-12)
  height: number | 'auto';        // Row span or auto-height
}

/**
 * ComponentVisibility - Conditional visibility rules
 */
export interface ComponentVisibility {
  condition?: VisibilityCondition;
}

// =============================================================================
// Component Definition (Registry Entry)
// =============================================================================

/**
 * ComponentDefinition - Describes a component type in the registry
 */
export interface ComponentDefinition {
  type: ComponentType;
  name: string;                   // Display name
  description: string;
  category: ComponentCategory;
  icon: string;                   // Icon identifier (e.g., 'shield', 'grid')
  defaultProps: ComponentProps;
  propsSchema: PropSchema;        // JSON Schema for validation
  minWidth: number;               // Minimum column span
  minHeight: number | 'auto';     // Minimum row span
  maxInstances?: number;          // Max instances per page (undefined = unlimited)
  requiresWeb3?: boolean;         // Requires wallet connection
  requiresContract?: boolean;     // Requires contract binding
}

/**
 * PropSchema - JSON Schema subset for component props
 */
export interface PropSchema {
  type: 'object';
  properties: Record<string, PropSchemaProperty>;
  required?: string[];
}

/**
 * PropSchemaProperty - Individual prop definition
 */
export interface PropSchemaProperty {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  items?: PropSchemaProperty;
  properties?: Record<string, PropSchemaProperty>;
}

// =============================================================================
// Web3 Component Props
// =============================================================================

/**
 * TokenGateProps - Token/NFT gating component
 */
export interface TokenGateProps {
  type: 'token-gate';
  gateConfig: GateConfig;
  showBalance?: boolean;
  lockedContent?: string;         // Markdown content when locked
  unlockedContent?: string;       // Markdown content when unlocked
  showRequirements?: boolean;     // Show gate requirements
}

/**
 * NFTGalleryProps - NFT display gallery
 */
export interface NFTGalleryProps {
  type: 'nft-gallery';
  contractId: string;             // Reference to ContractBinding.id
  layout: 'grid' | 'carousel' | 'masonry';
  columns: 2 | 3 | 4 | 6;
  showMetadata?: boolean;
  showOwner?: boolean;
  maxItems?: number;
  filterByTrait?: {
    traitType: string;
    values: string[];
  };
}

/**
 * LeaderboardProps - Community leaderboard
 */
export interface LeaderboardProps {
  type: 'leaderboard';
  title?: string;
  dataSource: LeaderboardDataSource;
  maxEntries: number;
  showRank?: boolean;
  showAvatar?: boolean;
  showChange?: boolean;           // Show rank change indicator
  refreshInterval?: number;       // Seconds (min: 60)
}

/**
 * LeaderboardDataSource - Data source for leaderboard
 */
export interface LeaderboardDataSource {
  type: 'points' | 'tokens' | 'nfts' | 'custom';
  contractId?: string;            // For token/NFT based
  customEndpoint?: string;        // For custom API
  sortOrder: 'asc' | 'desc';
}

/**
 * ProfileCardProps - User profile card
 */
export interface ProfileCardProps {
  type: 'profile-card';
  showAvatar?: boolean;
  showWallet?: boolean;           // Show connected wallet
  showBalance?: boolean;          // Show token balance
  contractId?: string;            // Token contract for balance
  showRoles?: boolean;            // Show Discord roles
  showStats?: boolean;            // Show community stats
  customFields?: ProfileCustomField[];
}

/**
 * ProfileCustomField - Custom field in profile card
 */
export interface ProfileCustomField {
  label: string;
  source: 'contract' | 'api' | 'static';
  contractId?: string;
  method?: string;                // Contract method to call
  apiEndpoint?: string;
  staticValue?: string;
}

// =============================================================================
// Content Component Props
// =============================================================================

/**
 * RichTextProps - Markdown/rich text content
 */
export interface RichTextProps {
  type: 'rich-text';
  content: string;                // Markdown content
  textAlign?: 'left' | 'center' | 'right';
  maxWidth?: 'sm' | 'md' | 'lg' | 'full';
}

/**
 * ImageProps - Image display
 */
export interface ImageProps {
  type: 'image';
  src: string;                    // Image URL or asset ID
  alt: string;
  objectFit?: 'cover' | 'contain' | 'fill';
  borderRadius?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  link?: string;                  // Optional click-through URL
}

/**
 * ButtonProps - Clickable button
 */
export interface ButtonProps {
  type: 'button';
  label: string;
  variant: 'primary' | 'secondary' | 'outline' | 'ghost';
  size: 'sm' | 'md' | 'lg';
  action: ButtonAction;
  fullWidth?: boolean;
  icon?: string;
  iconPosition?: 'left' | 'right';
}

/**
 * ButtonAction - Button click action
 */
export interface ButtonAction {
  type: 'link' | 'scroll' | 'modal' | 'connect-wallet' | 'custom';
  url?: string;                   // For 'link' type
  targetId?: string;              // For 'scroll' type
  modalContent?: string;          // For 'modal' type
  customHandler?: string;         // For 'custom' type (event name)
}

// =============================================================================
// Layout Component Props
// =============================================================================

/**
 * LayoutContainerProps - Container for grouping components
 */
export interface LayoutContainerProps {
  type: 'layout-container';
  direction: 'horizontal' | 'vertical';
  gap: 'none' | 'sm' | 'md' | 'lg';
  padding: 'none' | 'sm' | 'md' | 'lg';
  background?: 'transparent' | 'surface' | 'primary' | 'custom';
  customBackground?: string;      // Hex color if background is 'custom'
  borderRadius?: 'none' | 'sm' | 'md' | 'lg';
  children: ComponentInstance[];  // Nested components
}

/**
 * DividerProps - Visual separator
 */
export interface DividerProps {
  type: 'divider';
  variant: 'solid' | 'dashed' | 'dotted';
  thickness: 'thin' | 'medium' | 'thick';
  color?: 'default' | 'muted' | 'accent' | 'custom';
  customColor?: string;           // Hex color if color is 'custom'
  margin: 'none' | 'sm' | 'md' | 'lg';
}

/**
 * SpacerProps - Empty space
 */
export interface SpacerProps {
  type: 'spacer';
  height: 'sm' | 'md' | 'lg' | 'xl' | 'custom';
  customHeight?: number;          // Pixels if height is 'custom'
}

// =============================================================================
// Component Registry Types
// =============================================================================

/**
 * ComponentRegistry - Collection of available components
 */
export interface ComponentRegistry {
  components: Map<ComponentType, ComponentDefinition>;
  categories: Map<ComponentCategory, ComponentType[]>;
}

/**
 * ComponentRegistryEntry - Serialized registry entry
 */
export interface ComponentRegistryEntry {
  type: ComponentType;
  definition: ComponentDefinition;
}

// =============================================================================
// Component Validation Types
// =============================================================================

/**
 * ComponentValidationResult - Result of validating a component instance
 */
export interface ComponentValidationResult {
  valid: boolean;
  errors: ComponentValidationError[];
  warnings: ComponentValidationWarning[];
}

/**
 * ComponentValidationError - Validation error details
 */
export interface ComponentValidationError {
  path: string;                   // JSON path to invalid prop
  message: string;
  code: string;
}

/**
 * ComponentValidationWarning - Validation warning details
 */
export interface ComponentValidationWarning {
  path: string;
  message: string;
  code: string;
}
