# Software Design Document: WYSIWYG Theme Builder

**Version**: 1.0.0
**Status**: Draft
**Created**: 2026-01-21
**Branch**: feature/wysiwyg-themes
**PRD Reference**: `grimoires/loa/prd.md`

---

## 1. Executive Summary

This SDD defines the technical architecture for a WYSIWYG theme builder that enables non-technical users to create Web3-integrated community experiences. The system follows MEE6's simplicity model while adding blockchain data integration capabilities.

**Key Architectural Decisions**:
- Component-based theme engine with JSON serialization
- Multi-chain EVM support via viem abstraction layer
- Server-side rendering for theme previews
- SQLite + Redis storage (PostgreSQL-ready for scale)
- Progressive disclosure UI (wizard → visual canvas → code)

---

## 2. System Architecture Overview

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           WYSIWYG Theme Builder                         │
├─────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │
│  │   Builder UI    │  │  Preview Engine │  │   Theme Runtime          │  │
│  │                 │  │                 │  │                          │  │
│  │ - Wizard Mode   │  │ - SSR Renderer  │  │ - Web Dashboard         │  │
│  │ - Visual Canvas │  │ - Live Updates  │  │ - Public Pages          │  │
│  │ - Code Editor   │  │ - Mock Data     │  │ - Discord Embeds        │  │
│  └────────┬────────┘  └────────┬────────┘  └────────────┬────────────┘  │
│           │                    │                        │               │
│           └────────────────────┼────────────────────────┘               │
│                                │                                        │
├────────────────────────────────┼────────────────────────────────────────┤
│                                ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                        Theme API Layer                            │  │
│  │                                                                   │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐│  │
│  │  │ Theme CRUD   │  │ Component    │  │ Web3 Data Service        ││  │
│  │  │ Service      │  │ Registry     │  │                          ││  │
│  │  │              │  │              │  │ - Contract Bindings      ││  │
│  │  │ - Create     │  │ - Built-in   │  │ - Chain Adapters         ││  │
│  │  │ - Read       │  │ - Custom     │  │ - Caching Layer          ││  │
│  │  │ - Update     │  │ - Validate   │  │                          ││  │
│  │  │ - Publish    │  │              │  │                          ││  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘│  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
├────────────────────────────────┼────────────────────────────────────────┤
│                                ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      Storage Layer                                │  │
│  │                                                                   │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐   │  │
│  │  │  SQLite/    │  │   Redis     │  │   Asset Storage         │   │  │
│  │  │  PostgreSQL │  │             │  │   (Local FS / S3)       │   │  │
│  │  │             │  │ - Cache     │  │                         │   │  │
│  │  │ - Themes    │  │ - Sessions  │  │ - Logos                 │   │  │
│  │  │ - Versions  │  │ - Web3 Data │  │ - Images                │   │  │
│  │  │ - Metadata  │  │             │  │ - Custom Fonts          │   │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Component Interaction Flow

```
User Action                 Builder UI              API Layer              Storage
     │                          │                       │                     │
     ├── Edit Component ────────►│                       │                     │
     │                          ├── Validate ───────────►│                     │
     │                          │◄── Valid ─────────────┤                     │
     │                          ├── Save Draft ─────────►│                     │
     │                          │                       ├── Store ────────────►│
     │                          │                       │◄── OK ──────────────┤
     │                          │◄── Saved ─────────────┤                     │
     │◄── Preview Updated ──────┤                       │                     │
     │                          │                       │                     │
```

---

## 3. Technology Stack

### 3.1 Backend Stack (Existing Sietch Infrastructure)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | Node.js 20+ | Matches existing Sietch |
| Framework | Express.js | Existing patterns, middleware reuse |
| Database | SQLite → PostgreSQL | SQLite for MVP, PostgreSQL for scale |
| Cache | Redis | Existing infrastructure |
| Web3 | viem | Type-safe, multi-chain support |
| Validation | Zod | Matches existing config patterns |

### 3.2 Frontend Stack (New)

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | React 18+ | Component-based, large ecosystem |
| State | Zustand | Lightweight, TypeScript-first |
| Styling | Tailwind CSS + CSS Variables | Theme-able, utility-first |
| Drag & Drop | @dnd-kit/core | Modern, accessible |
| Code Editor | Monaco Editor | VS Code experience |
| Preview | iframe + postMessage | Isolated, secure |

### 3.3 Shared

| Concern | Technology |
|---------|-----------|
| API | REST + JSON |
| Serialization | JSON Schema |
| Types | TypeScript (strict) |
| Testing | Vitest |

---

## 4. Data Models

### 4.1 Theme Schema

```typescript
/**
 * Theme - Root configuration object
 */
interface Theme {
  // Identity
  id: string;                    // UUID v4
  communityId: string;           // Owner community
  version: string;               // SemVer (e.g., "1.0.0")

  // Metadata
  name: string;                  // Display name (max 100 chars)
  description: string;           // Description (max 500 chars)

  // Visual Configuration
  branding: ThemeBranding;

  // Structure
  pages: ThemePage[];            // Page definitions

  // Web3 Configuration
  contracts: ContractBinding[];   // Contract bindings
  chains: ChainConfig[];          // Enabled chains

  // Platform-Specific
  discord?: DiscordThemeConfig;

  // State
  status: 'draft' | 'published';
  publishedAt?: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * ThemeBranding - Visual identity configuration
 */
interface ThemeBranding {
  // Colors
  colors: {
    primary: string;              // Hex color
    secondary: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
    accent: string;
    error: string;
    success: string;
    warning: string;
  };

  // Typography
  fonts: {
    heading: FontConfig;
    body: FontConfig;
    mono: FontConfig;
  };

  // Assets
  logo?: {
    url: string;
    width?: number;
    height?: number;
    alt: string;
  };

  favicon?: string;               // URL to favicon

  // Layout
  borderRadius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  spacing: 'compact' | 'comfortable' | 'spacious';
}

/**
 * FontConfig - Font definition
 */
interface FontConfig {
  family: string;                 // Font family name
  source: 'system' | 'google' | 'custom';
  url?: string;                   // For custom fonts
  weights: number[];              // Available weights
}

/**
 * ThemePage - Page definition
 */
interface ThemePage {
  id: string;                     // UUID v4
  slug: string;                   // URL slug (unique per theme)
  name: string;                   // Display name
  layout: 'full' | 'sidebar' | 'dashboard';
  components: ComponentInstance[];
  meta?: {
    title?: string;
    description?: string;
  };
  visibility: 'public' | 'members' | 'gated';
  gateConfig?: GateConfig;        // If visibility is 'gated'
}

/**
 * ComponentInstance - Placed component with configuration
 */
interface ComponentInstance {
  id: string;                     // Instance UUID
  type: ComponentType;            // Component type identifier
  props: Record<string, unknown>; // Component-specific props
  position: {
    x: number;                    // Grid column
    y: number;                    // Grid row
    width: number;                // Column span
    height: number;               // Row span (or 'auto')
  };
  visibility?: {
    condition?: VisibilityCondition;
  };
}

/**
 * Component Types (MVP)
 */
type ComponentType =
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
```

### 4.2 Contract Binding Schema

```typescript
/**
 * ContractBinding - Web3 contract configuration
 */
interface ContractBinding {
  id: string;                     // UUID v4
  name: string;                   // Human-readable name
  chainId: number;                // EVM chain ID
  address: Address;               // Contract address (checksummed)
  abi: AbiFragment[];             // Contract ABI (read functions only)

  // Metadata
  type: 'erc20' | 'erc721' | 'erc1155' | 'custom';
  verified?: boolean;             // Etherscan verified

  // Caching
  cacheTtl: number;               // Cache TTL in seconds (min: 60)

  // Rate limiting
  rateLimit?: {
    maxCalls: number;             // Max calls per window
    windowSeconds: number;        // Rate limit window
  };
}

/**
 * ChainConfig - Supported chain configuration
 */
interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;                 // Primary RPC
  rpcUrls?: string[];             // Fallback RPCs
  blockExplorer?: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

/**
 * Pre-configured chains (MVP)
 */
const SUPPORTED_CHAINS: ChainConfig[] = [
  { chainId: 1, name: 'Ethereum', ... },
  { chainId: 42161, name: 'Arbitrum One', ... },
  { chainId: 10, name: 'Optimism', ... },
  { chainId: 8453, name: 'Base', ... },
  { chainId: 137, name: 'Polygon', ... },
  { chainId: 80094, name: 'Berachain', ... },
];
```

### 4.3 Gate Configuration Schema

```typescript
/**
 * GateConfig - Token/NFT gating configuration
 */
interface GateConfig {
  type: 'token' | 'nft' | 'multi';

  // For single token/NFT gates
  contractId?: string;            // Reference to ContractBinding.id
  minBalance?: string;            // Minimum balance (bigint as string)

  // For NFT trait gates
  traits?: {
    traitType: string;
    values: string[];
  }[];

  // For multi-condition gates
  conditions?: GateCondition[];
  operator?: 'and' | 'or';

  // Fallback behavior
  fallback?: {
    redirect?: string;            // Redirect URL
    message?: string;             // Custom message
  };
}

/**
 * GateCondition - Individual gate condition
 */
interface GateCondition {
  contractId: string;
  type: 'balance' | 'ownership' | 'trait';
  minBalance?: string;
  tokenId?: string;
  traits?: { traitType: string; values: string[] }[];
}

/**
 * VisibilityCondition - Component visibility rules
 */
interface VisibilityCondition {
  type: 'gate' | 'role' | 'custom';
  gateId?: string;                // Reference to GateConfig
  roleIds?: string[];             // Discord role IDs
  expression?: string;            // Custom visibility expression
}
```

### 4.4 Discord Theme Configuration

```typescript
/**
 * DiscordThemeConfig - Discord embed customization
 */
interface DiscordThemeConfig {
  // Permission mode
  mode: 'greenfield' | 'restricted';

  // Embed templates
  embedTemplates: {
    welcome?: DiscordEmbedTemplate;
    leaderboard?: DiscordEmbedTemplate;
    alert?: DiscordEmbedTemplate;
    custom?: Record<string, DiscordEmbedTemplate>;
  };

  // Colors (must match Discord's color palette)
  colors: {
    primary: number;              // Integer color value
    success: number;
    warning: number;
    error: number;
  };
}

/**
 * DiscordEmbedTemplate - Embed structure template
 */
interface DiscordEmbedTemplate {
  title?: string;                 // Supports {{variables}}
  description?: string;
  color?: number;
  thumbnail?: boolean;
  footer?: {
    text: string;
    iconUrl?: string;
  };
  fields?: {
    name: string;
    value: string;
    inline?: boolean;
  }[];
}
```

---

## 5. Database Schema

### 5.1 SQLite Schema (MVP)

```sql
-- Enable WAL mode for better concurrent read performance
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =============================================================================
-- Themes Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,                    -- UUID v4
  community_id TEXT NOT NULL,             -- Owner community
  name TEXT NOT NULL,                     -- Display name
  description TEXT DEFAULT '',            -- Description
  status TEXT NOT NULL DEFAULT 'draft'    -- draft | published
    CHECK (status IN ('draft', 'published')),

  -- JSON data (full theme config)
  config TEXT NOT NULL,                   -- JSON: ThemeConfig

  -- Current version
  version TEXT NOT NULL DEFAULT '1.0.0',  -- SemVer

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  published_at TEXT                       -- When last published
);

CREATE INDEX IF NOT EXISTS idx_themes_community
  ON themes(community_id);

CREATE INDEX IF NOT EXISTS idx_themes_status
  ON themes(status);

-- =============================================================================
-- Theme Versions Table (History)
-- =============================================================================
CREATE TABLE IF NOT EXISTS theme_versions (
  id TEXT PRIMARY KEY,                    -- UUID v4
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  version TEXT NOT NULL,                  -- SemVer
  config TEXT NOT NULL,                   -- JSON: Full theme snapshot

  -- Change metadata
  change_summary TEXT,                    -- Description of changes
  changed_by TEXT NOT NULL,               -- User who made the change

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,

  UNIQUE(theme_id, version)
);

CREATE INDEX IF NOT EXISTS idx_theme_versions_theme
  ON theme_versions(theme_id);

-- =============================================================================
-- Contract Bindings Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS contract_bindings (
  id TEXT PRIMARY KEY,                    -- UUID v4
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,

  -- Contract identity
  name TEXT NOT NULL,                     -- Human-readable name
  chain_id INTEGER NOT NULL,              -- EVM chain ID
  address TEXT NOT NULL,                  -- Checksummed address

  -- Contract metadata
  type TEXT NOT NULL DEFAULT 'custom'     -- erc20 | erc721 | erc1155 | custom
    CHECK (type IN ('erc20', 'erc721', 'erc1155', 'custom')),
  abi TEXT NOT NULL,                      -- JSON: ABI array
  verified INTEGER DEFAULT 0,             -- Etherscan verified flag

  -- Caching config
  cache_ttl INTEGER NOT NULL DEFAULT 300, -- TTL in seconds

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')) NOT NULL,

  UNIQUE(theme_id, chain_id, address)
);

CREATE INDEX IF NOT EXISTS idx_contract_bindings_theme
  ON contract_bindings(theme_id);

CREATE INDEX IF NOT EXISTS idx_contract_bindings_chain
  ON contract_bindings(chain_id);

-- =============================================================================
-- Theme Assets Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS theme_assets (
  id TEXT PRIMARY KEY,                    -- UUID v4
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,

  -- Asset metadata
  name TEXT NOT NULL,                     -- Original filename
  type TEXT NOT NULL                      -- logo | image | font | favicon
    CHECK (type IN ('logo', 'image', 'font', 'favicon')),
  mime_type TEXT NOT NULL,                -- MIME type
  size INTEGER NOT NULL,                  -- Size in bytes

  -- Storage
  storage_path TEXT NOT NULL,             -- Path in storage
  storage_type TEXT NOT NULL DEFAULT 'local' -- local | s3
    CHECK (storage_type IN ('local', 's3')),

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_theme_assets_theme
  ON theme_assets(theme_id);

-- =============================================================================
-- Theme Audit Log
-- =============================================================================
CREATE TABLE IF NOT EXISTS theme_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  theme_id TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,

  -- Audit data
  action TEXT NOT NULL,                   -- create | update | publish | unpublish | delete
  actor_id TEXT NOT NULL,                 -- User who performed action
  actor_type TEXT NOT NULL DEFAULT 'user' -- user | system | api
    CHECK (actor_type IN ('user', 'system', 'api')),

  -- Details
  details TEXT,                           -- JSON: Action-specific details

  -- Timestamps
  created_at TEXT DEFAULT (datetime('now')) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_theme_audit_theme
  ON theme_audit_log(theme_id);

CREATE INDEX IF NOT EXISTS idx_theme_audit_created
  ON theme_audit_log(created_at);
```

### 5.2 PostgreSQL Migration Path

For 10k+ communities scale, the schema migrates to PostgreSQL with:

1. **Row-Level Security (RLS)** for multi-tenant isolation
2. **JSONB** columns for indexed JSON queries
3. **Materialized views** for dashboard analytics
4. **Partitioning** by community_id for large tables

```sql
-- PostgreSQL RLS example
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;

CREATE POLICY themes_community_isolation ON themes
  USING (community_id = current_setting('app.community_id')::text);
```

---

## 6. API Design

### 6.1 Theme CRUD Endpoints

```typescript
// =============================================================================
// Theme Management API
// =============================================================================

/**
 * Create a new theme
 * POST /api/themes
 */
interface CreateThemeRequest {
  name: string;
  description?: string;
  template?: string;              // Template ID to clone from
}

interface CreateThemeResponse {
  id: string;
  name: string;
  status: 'draft';
  version: '1.0.0';
  createdAt: string;
}

/**
 * Get theme by ID
 * GET /api/themes/:themeId
 */
interface GetThemeResponse {
  id: string;
  communityId: string;
  name: string;
  description: string;
  status: 'draft' | 'published';
  version: string;
  config: Theme;                  // Full theme configuration
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

/**
 * Update theme configuration
 * PATCH /api/themes/:themeId
 */
interface UpdateThemeRequest {
  name?: string;
  description?: string;
  config?: Partial<Theme>;        // Partial update merged with existing
}

/**
 * Publish theme
 * POST /api/themes/:themeId/publish
 */
interface PublishThemeRequest {
  version?: string;               // Optional version bump (defaults to patch)
  changeSummary?: string;
}

interface PublishThemeResponse {
  id: string;
  version: string;
  publishedAt: string;
}

/**
 * List themes for community
 * GET /api/themes
 */
interface ListThemesQuery {
  status?: 'draft' | 'published' | 'all';
  page?: number;
  limit?: number;
}

interface ListThemesResponse {
  themes: ThemeSummary[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
}

/**
 * Get theme version history
 * GET /api/themes/:themeId/versions
 */
interface GetVersionsResponse {
  versions: {
    version: string;
    changeSummary?: string;
    changedBy: string;
    createdAt: string;
  }[];
}

/**
 * Rollback to specific version
 * POST /api/themes/:themeId/rollback
 */
interface RollbackRequest {
  version: string;
}
```

### 6.2 Component Registry API

```typescript
// =============================================================================
// Component Registry API
// =============================================================================

/**
 * List available components
 * GET /api/components
 */
interface ListComponentsResponse {
  components: ComponentDefinition[];
}

interface ComponentDefinition {
  type: ComponentType;
  name: string;
  description: string;
  category: 'web3' | 'content' | 'layout' | 'media';
  icon: string;                   // Icon name or URL

  // Schema
  propsSchema: JSONSchema;        // JSON Schema for props validation
  defaultProps: Record<string, unknown>;

  // Sizing
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;

  // Capabilities
  capabilities: {
    web3Required?: boolean;
    supportsGating?: boolean;
    supportsAnimation?: boolean;
  };
}

/**
 * Validate component configuration
 * POST /api/components/validate
 */
interface ValidateComponentRequest {
  type: ComponentType;
  props: Record<string, unknown>;
}

interface ValidateComponentResponse {
  valid: boolean;
  errors?: {
    path: string;
    message: string;
  }[];
}
```

### 6.3 Web3 Data API

```typescript
// =============================================================================
// Web3 Data API
// =============================================================================

/**
 * Add contract binding
 * POST /api/themes/:themeId/contracts
 */
interface AddContractRequest {
  name: string;
  chainId: number;
  address: string;                // Will be checksummed
  type?: 'erc20' | 'erc721' | 'erc1155' | 'custom';
  abi?: AbiFragment[];            // Required for custom, auto-fetched for standard
  cacheTtl?: number;
}

/**
 * Fetch contract data (for preview)
 * POST /api/web3/read
 */
interface ReadContractRequest {
  chainId: number;
  address: string;
  functionName: string;
  args?: unknown[];
  abi?: AbiFragment[];            // Optional, uses cached binding if exists
}

interface ReadContractResponse {
  result: unknown;
  cached: boolean;
  cachedAt?: string;
}

/**
 * Get NFT collection metadata
 * GET /api/web3/nft/:chainId/:address
 */
interface GetNFTCollectionResponse {
  name: string;
  symbol: string;
  totalSupply?: string;
  traits?: {
    traitType: string;
    values: string[];
    counts: Record<string, number>;
  }[];
  floorPrice?: {
    value: string;
    currency: string;
    source: string;
  };
}

/**
 * Get token metadata
 * GET /api/web3/token/:chainId/:address
 */
interface GetTokenResponse {
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: string;
  price?: {
    usd: number;
    source: string;
  };
}

/**
 * Verify wallet ownership for preview
 * POST /api/web3/verify-ownership
 */
interface VerifyOwnershipRequest {
  walletAddress: string;
  chainId: number;
  contractAddress: string;
  tokenId?: string;               // For NFTs
  minBalance?: string;            // For tokens
}

interface VerifyOwnershipResponse {
  hasAccess: boolean;
  balance?: string;
  tokenIds?: string[];            // For NFTs
}
```

### 6.4 Preview API

```typescript
// =============================================================================
// Preview API
// =============================================================================

/**
 * Generate preview HTML
 * POST /api/themes/:themeId/preview
 */
interface GeneratePreviewRequest {
  pageId?: string;                // Specific page, defaults to home
  viewport?: 'desktop' | 'tablet' | 'mobile';
  mockData?: {
    wallet?: string;              // Mock wallet for gating preview
    balances?: Record<string, string>;  // Mock balances
  };
}

interface GeneratePreviewResponse {
  html: string;
  css: string;
  scripts?: string[];             // External scripts to load
}

/**
 * Preview update websocket
 * WS /api/themes/:themeId/preview/ws
 */
interface PreviewUpdateMessage {
  type: 'config_change' | 'component_update' | 'branding_update';
  path: string[];                 // JSON path that changed
  value: unknown;
}

interface PreviewRefreshMessage {
  type: 'refresh';
  reason: 'full_reload' | 'hot_reload';
}
```

### 6.5 Asset Management API

```typescript
// =============================================================================
// Asset Management API
// =============================================================================

/**
 * Upload asset
 * POST /api/themes/:themeId/assets
 * Content-Type: multipart/form-data
 */
interface UploadAssetRequest {
  file: File;
  type: 'logo' | 'image' | 'font' | 'favicon';
  name?: string;                  // Optional custom name
}

interface UploadAssetResponse {
  id: string;
  url: string;
  name: string;
  type: string;
  mimeType: string;
  size: number;
}

/**
 * List theme assets
 * GET /api/themes/:themeId/assets
 */
interface ListAssetsResponse {
  assets: {
    id: string;
    url: string;
    name: string;
    type: string;
    mimeType: string;
    size: number;
    createdAt: string;
  }[];
}

/**
 * Delete asset
 * DELETE /api/themes/:themeId/assets/:assetId
 */
```

---

## 7. Component System

### 7.1 Component Registry Architecture

```typescript
// =============================================================================
// Component Registry
// =============================================================================

/**
 * Component registration interface
 */
interface ComponentRegistration {
  type: ComponentType;
  definition: ComponentDefinition;
  renderer: ComponentRenderer;
  editor: ComponentEditor;
}

/**
 * Server-side renderer
 */
interface ComponentRenderer {
  render(props: Record<string, unknown>, context: RenderContext): string;
  getStyles(props: Record<string, unknown>): string;
}

/**
 * Client-side editor configuration
 */
interface ComponentEditor {
  fields: EditorField[];
  preview?: PreviewConfig;
}

interface EditorField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'color' | 'select' | 'toggle' | 'contract' | 'rich-text';
  required?: boolean;
  default?: unknown;
  options?: { value: string; label: string }[];  // For select
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

/**
 * Render context provided to components
 */
interface RenderContext {
  theme: Theme;
  page: ThemePage;
  user?: {
    wallet?: string;
    roles?: string[];
  };
  web3: {
    readContract: (binding: string, fn: string, args?: unknown[]) => Promise<unknown>;
    getBalance: (wallet: string, binding: string) => Promise<string>;
    getNFTs: (wallet: string, binding: string) => Promise<NFTData[]>;
  };
}
```

### 7.2 MVP Component Definitions

#### 7.2.1 Token Gate Component

```typescript
const TokenGateComponent: ComponentRegistration = {
  type: 'token-gate',
  definition: {
    name: 'Token Gate',
    description: 'Show content only to token/NFT holders',
    category: 'web3',
    icon: 'lock',
    propsSchema: {
      type: 'object',
      required: ['gateConfig', 'children'],
      properties: {
        gateConfig: { $ref: '#/definitions/GateConfig' },
        children: { type: 'array', items: { $ref: '#/definitions/ComponentInstance' } },
        fallbackMessage: { type: 'string', default: 'You need to hold the required tokens to view this content.' },
        showRequirements: { type: 'boolean', default: true },
      },
    },
    defaultProps: {
      fallbackMessage: 'You need to hold the required tokens to view this content.',
      showRequirements: true,
    },
    minWidth: 2,
    minHeight: 2,
    capabilities: { web3Required: true, supportsGating: false },
  },
  // ... renderer and editor
};
```

#### 7.2.2 NFT Gallery Component

```typescript
const NFTGalleryComponent: ComponentRegistration = {
  type: 'nft-gallery',
  definition: {
    name: 'NFT Gallery',
    description: 'Display NFTs from a collection',
    category: 'web3',
    icon: 'grid',
    propsSchema: {
      type: 'object',
      required: ['contractId'],
      properties: {
        contractId: { type: 'string' },
        displayMode: { enum: ['grid', 'carousel', 'list'], default: 'grid' },
        columns: { type: 'number', minimum: 1, maximum: 6, default: 4 },
        showOwned: { type: 'boolean', default: false },
        filterTraits: { type: 'array', items: { type: 'string' } },
        sortBy: { enum: ['recent', 'rarity', 'price'], default: 'recent' },
        maxItems: { type: 'number', minimum: 1, maximum: 100, default: 20 },
      },
    },
    defaultProps: {
      displayMode: 'grid',
      columns: 4,
      showOwned: false,
      sortBy: 'recent',
      maxItems: 20,
    },
    minWidth: 3,
    minHeight: 3,
    capabilities: { web3Required: true, supportsGating: true },
  },
};
```

#### 7.2.3 Leaderboard Component

```typescript
const LeaderboardComponent: ComponentRegistration = {
  type: 'leaderboard',
  definition: {
    name: 'Leaderboard',
    description: 'Rank members by holdings, activity, or custom scores',
    category: 'web3',
    icon: 'trophy',
    propsSchema: {
      type: 'object',
      required: ['rankBy'],
      properties: {
        rankBy: { enum: ['holdings', 'activity', 'custom'], default: 'holdings' },
        contractId: { type: 'string' },  // For holdings
        customScoreField: { type: 'string' },  // For custom
        limit: { type: 'number', minimum: 5, maximum: 100, default: 10 },
        showRank: { type: 'boolean', default: true },
        showAvatar: { type: 'boolean', default: true },
        showValue: { type: 'boolean', default: true },
        highlightTop: { type: 'number', minimum: 0, maximum: 10, default: 3 },
        anonymizeNonMembers: { type: 'boolean', default: true },
      },
    },
    defaultProps: {
      rankBy: 'holdings',
      limit: 10,
      showRank: true,
      showAvatar: true,
      showValue: true,
      highlightTop: 3,
      anonymizeNonMembers: true,
    },
    minWidth: 2,
    minHeight: 4,
    capabilities: { web3Required: true, supportsGating: true },
  },
};
```

#### 7.2.4 Profile Card Component

```typescript
const ProfileCardComponent: ComponentRegistration = {
  type: 'profile-card',
  definition: {
    name: 'Profile Card',
    description: 'Display member profile with Web3 data',
    category: 'web3',
    icon: 'user',
    propsSchema: {
      type: 'object',
      properties: {
        showAvatar: { type: 'boolean', default: true },
        showNym: { type: 'boolean', default: true },
        showWallet: { type: 'boolean', default: true },
        showBadges: { type: 'boolean', default: true },
        showHoldings: { type: 'boolean', default: true },
        holdingsContracts: { type: 'array', items: { type: 'string' } },
        showActivity: { type: 'boolean', default: false },
        layout: { enum: ['horizontal', 'vertical', 'compact'], default: 'vertical' },
      },
    },
    defaultProps: {
      showAvatar: true,
      showNym: true,
      showWallet: true,
      showBadges: true,
      showHoldings: true,
      showActivity: false,
      layout: 'vertical',
    },
    minWidth: 2,
    minHeight: 2,
    capabilities: { web3Required: false, supportsGating: true },
  },
};
```

#### 7.2.5 Rich Text Component

```typescript
const RichTextComponent: ComponentRegistration = {
  type: 'rich-text',
  definition: {
    name: 'Rich Text',
    description: 'Formatted text content with markdown support',
    category: 'content',
    icon: 'text',
    propsSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string' },  // Markdown content
        textAlign: { enum: ['left', 'center', 'right'], default: 'left' },
        fontSize: { enum: ['sm', 'base', 'lg', 'xl'], default: 'base' },
      },
    },
    defaultProps: {
      content: 'Enter your content here...',
      textAlign: 'left',
      fontSize: 'base',
    },
    minWidth: 1,
    minHeight: 1,
    capabilities: { supportsGating: true },
  },
};
```

#### 7.2.6 Layout Container Component

```typescript
const LayoutContainerComponent: ComponentRegistration = {
  type: 'layout-container',
  definition: {
    name: 'Container',
    description: 'Group and arrange components',
    category: 'layout',
    icon: 'layout',
    propsSchema: {
      type: 'object',
      required: ['children'],
      properties: {
        children: { type: 'array', items: { $ref: '#/definitions/ComponentInstance' } },
        layout: { enum: ['row', 'column', 'grid'], default: 'column' },
        gap: { enum: ['none', 'sm', 'md', 'lg'], default: 'md' },
        padding: { enum: ['none', 'sm', 'md', 'lg'], default: 'md' },
        background: { type: 'string' },  // Color or 'transparent'
        borderRadius: { enum: ['none', 'sm', 'md', 'lg'], default: 'none' },
        columns: { type: 'number', minimum: 1, maximum: 12, default: 1 },  // For grid
      },
    },
    defaultProps: {
      layout: 'column',
      gap: 'md',
      padding: 'md',
      borderRadius: 'none',
      columns: 1,
    },
    minWidth: 1,
    minHeight: 1,
    capabilities: { supportsGating: true },
  },
};
```

---

## 8. Security Architecture

### 8.1 Contract Interaction Security

```typescript
// =============================================================================
// Contract Security Layer
// =============================================================================

/**
 * Contract address validation
 */
function validateContractAddress(address: string, chainId: number): ValidationResult {
  // 1. Format validation
  if (!isAddress(address)) {
    return { valid: false, error: 'Invalid address format' };
  }

  // 2. Checksum validation
  const checksummed = getAddress(address);

  // 3. Known malicious address check
  if (KNOWN_MALICIOUS_ADDRESSES.has(checksummed.toLowerCase())) {
    return { valid: false, error: 'Address is on malicious address blocklist' };
  }

  // 4. Zero address check
  if (checksummed === '0x0000000000000000000000000000000000000000') {
    return { valid: false, error: 'Zero address not allowed' };
  }

  return { valid: true, checksummed };
}

/**
 * ABI validation - only allow read functions
 */
function validateAbi(abi: AbiFragment[]): ValidationResult {
  for (const fragment of abi) {
    // Only allow view/pure functions
    if (fragment.type === 'function') {
      if (fragment.stateMutability !== 'view' && fragment.stateMutability !== 'pure') {
        return {
          valid: false,
          error: `Function ${fragment.name} is not read-only (${fragment.stateMutability})`,
        };
      }
    }

    // Disallow receive/fallback
    if (fragment.type === 'receive' || fragment.type === 'fallback') {
      return { valid: false, error: 'Receive/fallback functions not allowed' };
    }
  }

  return { valid: true };
}

/**
 * Rate limiting for contract reads
 */
const contractRateLimiter = new RateLimiter({
  // Per-community limits
  communityLimits: {
    maxCallsPerMinute: 100,
    maxCallsPerHour: 1000,
  },
  // Per-contract limits (prevent abuse of single expensive contract)
  contractLimits: {
    maxCallsPerMinute: 30,
    maxCallsPerHour: 300,
  },
  // Global limits
  globalLimits: {
    maxCallsPerMinute: 10000,
  },
});
```

### 8.2 Input Sanitization

```typescript
// =============================================================================
// Input Sanitization
// =============================================================================

/**
 * Theme content sanitization
 */
function sanitizeThemeContent(content: string): string {
  // Use DOMPurify for HTML content
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ['target="_blank"', 'rel="noopener noreferrer"'],
  });
}

/**
 * Theme name/description validation
 */
const themeMetadataSchema = z.object({
  name: z.string()
    .min(1, 'Name required')
    .max(100, 'Name too long')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Name contains invalid characters'),
  description: z.string()
    .max(500, 'Description too long')
    .optional(),
});

/**
 * Color validation
 */
const colorSchema = z.string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Invalid hex color');
```

### 8.3 Asset Upload Security

```typescript
// =============================================================================
// Asset Upload Security
// =============================================================================

/**
 * Allowed MIME types
 */
const ALLOWED_MIME_TYPES = {
  logo: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
  favicon: ['image/x-icon', 'image/png'],
  font: ['font/woff', 'font/woff2', 'font/ttf', 'font/otf'],
};

/**
 * Max file sizes (in bytes)
 */
const MAX_FILE_SIZES = {
  logo: 2 * 1024 * 1024,      // 2MB
  image: 5 * 1024 * 1024,     // 5MB
  favicon: 100 * 1024,         // 100KB
  font: 1 * 1024 * 1024,      // 1MB
};

/**
 * Asset upload validation
 */
async function validateAssetUpload(
  file: Buffer,
  type: 'logo' | 'image' | 'font' | 'favicon',
  mimeType: string
): Promise<ValidationResult> {
  // 1. MIME type check
  if (!ALLOWED_MIME_TYPES[type].includes(mimeType)) {
    return { valid: false, error: `Invalid file type for ${type}` };
  }

  // 2. File size check
  if (file.length > MAX_FILE_SIZES[type]) {
    return { valid: false, error: `File too large (max ${MAX_FILE_SIZES[type] / 1024}KB)` };
  }

  // 3. Magic bytes validation (prevent MIME spoofing)
  const fileType = await fileTypeFromBuffer(file);
  if (!fileType || !ALLOWED_MIME_TYPES[type].includes(fileType.mime)) {
    return { valid: false, error: 'File content does not match declared type' };
  }

  // 4. SVG specific: scan for malicious content
  if (mimeType === 'image/svg+xml') {
    const svgContent = file.toString('utf-8');
    if (containsMaliciousSvgContent(svgContent)) {
      return { valid: false, error: 'SVG contains potentially malicious content' };
    }
  }

  return { valid: true };
}

/**
 * SVG malicious content detection
 */
function containsMaliciousSvgContent(svg: string): boolean {
  const maliciousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,           // onclick, onerror, etc.
    /<foreignObject/i,
    /xlink:href\s*=\s*["']data:/i,
  ];

  return maliciousPatterns.some(pattern => pattern.test(svg));
}
```

### 8.4 Preview Isolation

```typescript
// =============================================================================
// Preview Security
// =============================================================================

/**
 * Preview iframe sandbox configuration
 */
const PREVIEW_SANDBOX_ATTRS = [
  'allow-scripts',              // Needed for interactivity
  'allow-same-origin',          // Needed for CSS
  // Explicitly NOT included:
  // - allow-forms
  // - allow-popups
  // - allow-top-navigation
].join(' ');

/**
 * Content Security Policy for preview
 */
const PREVIEW_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",  // Inline for hot reload
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.discordapp.com https://*.ipfs.io",
  "font-src 'self' https://fonts.gstatic.com",
  "connect-src 'self'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
].join('; ');
```

---

## 9. Caching Strategy

### 9.1 Multi-Layer Cache

```typescript
// =============================================================================
// Caching Architecture
// =============================================================================

/**
 * Cache layers
 */
enum CacheLayer {
  MEMORY = 'memory',    // In-process, sub-second TTL
  REDIS = 'redis',      // Shared, seconds-minutes TTL
  DATABASE = 'database' // Persistent, hours-days TTL
}

/**
 * Cache key patterns
 */
const CACHE_KEYS = {
  // Theme cache
  theme: (id: string) => `theme:${id}`,
  themePublished: (id: string) => `theme:published:${id}`,

  // Web3 data cache
  contractRead: (chainId: number, address: string, fn: string, args: string) =>
    `web3:read:${chainId}:${address}:${fn}:${args}`,
  tokenMetadata: (chainId: number, address: string) =>
    `web3:token:${chainId}:${address}`,
  nftCollection: (chainId: number, address: string) =>
    `web3:nft:${chainId}:${address}`,
  walletBalance: (chainId: number, wallet: string, contract: string) =>
    `web3:balance:${chainId}:${wallet}:${contract}`,

  // Preview cache
  previewHtml: (themeId: string, pageId: string, viewport: string) =>
    `preview:${themeId}:${pageId}:${viewport}`,
};

/**
 * Cache TTL configuration (in seconds)
 */
const CACHE_TTL = {
  // Theme config (invalidated on update)
  theme: {
    memory: 60,           // 1 minute
    redis: 300,           // 5 minutes
  },

  // Web3 data (balance freshness varies)
  web3: {
    tokenMetadata: 3600,  // 1 hour (rarely changes)
    nftCollection: 1800,  // 30 minutes
    balance: 60,          // 1 minute (needs freshness)
    contractRead: 300,    // 5 minutes (configurable per binding)
  },

  // Preview
  preview: {
    html: 30,             // 30 seconds
  },
};
```

### 9.2 Cache Invalidation

```typescript
// =============================================================================
// Cache Invalidation
// =============================================================================

/**
 * Cache invalidation patterns
 */
class CacheInvalidator {
  /**
   * Invalidate theme cache on update
   */
  async invalidateTheme(themeId: string): Promise<void> {
    await Promise.all([
      this.redis.del(CACHE_KEYS.theme(themeId)),
      this.redis.del(CACHE_KEYS.themePublished(themeId)),
      // Invalidate all preview variants
      this.redis.del(`preview:${themeId}:*`),
    ]);

    // Notify connected preview clients
    this.previewWs.broadcast(themeId, { type: 'refresh', reason: 'full_reload' });
  }

  /**
   * Invalidate Web3 cache on contract update
   */
  async invalidateContract(chainId: number, address: string): Promise<void> {
    const pattern = `web3:*:${chainId}:${address}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  /**
   * Scheduled cache warming for popular themes
   */
  async warmPopularThemes(): Promise<void> {
    const popularThemes = await this.getPopularThemes(100);

    for (const theme of popularThemes) {
      // Pre-render default page for each viewport
      for (const viewport of ['desktop', 'tablet', 'mobile']) {
        await this.previewService.generateAndCache(theme.id, 'home', viewport);
      }
    }
  }
}
```

---

## 10. Performance Targets

### 10.1 Response Time Targets

| Operation | Target | P95 Target |
|-----------|--------|------------|
| Theme load (cached) | <100ms | <200ms |
| Theme load (uncached) | <500ms | <1s |
| Preview render | <500ms | <1s |
| Component validation | <50ms | <100ms |
| Contract read (cached) | <50ms | <100ms |
| Contract read (uncached) | <2s | <5s |
| Asset upload | <3s | <5s |

### 10.2 Scale Targets

| Metric | MVP Target | Scale Target |
|--------|-----------|--------------|
| Themes per community | Unlimited | Unlimited |
| Components per page | 50 | 100 |
| Pages per theme | 10 | 50 |
| Contract bindings per theme | 10 | 25 |
| Concurrent preview sessions | 100 | 1000 |
| Total communities | 1000 | 10000+ |

### 10.3 Asset Limits

| Asset Type | Size Limit | Per Theme |
|------------|-----------|-----------|
| Logo | 2MB | 1 |
| Images | 5MB each | 50 |
| Fonts | 1MB each | 5 |
| Favicon | 100KB | 1 |
| Total theme config | 1MB | - |

---

## 11. Deployment Architecture

### 11.1 Service Topology

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │   (nginx/fly)   │
                    └────────┬────────┘
                             │
           ┌─────────────────┼─────────────────┐
           │                 │                 │
           ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
    │  Theme API  │   │  Theme API  │   │  Theme API  │
    │  Instance 1 │   │  Instance 2 │   │  Instance N │
    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
           │                 │                 │
           └─────────────────┼─────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
       ┌───────────┐  ┌───────────┐  ┌───────────┐
       │   Redis   │  │  SQLite/  │  │   Asset   │
       │   Cache   │  │ PostgreSQL│  │  Storage  │
       └───────────┘  └───────────┘  └───────────┘
```

### 11.2 Environment Configuration

```typescript
// =============================================================================
// Theme Builder Configuration Schema
// =============================================================================

const themeBuilderConfigSchema = z.object({
  // Database
  database: z.object({
    url: z.string().url().optional(),        // PostgreSQL (production)
    path: z.string().optional(),              // SQLite (development)
  }),

  // Redis
  redis: z.object({
    url: z.string().url().optional(),
    ttl: z.object({
      theme: z.number().default(300),
      web3: z.number().default(60),
    }),
  }),

  // Asset storage
  assets: z.object({
    storageType: z.enum(['local', 's3']).default('local'),
    localPath: z.string().default('./assets'),
    s3: z.object({
      bucket: z.string().optional(),
      region: z.string().optional(),
      endpoint: z.string().optional(),
    }).optional(),
  }),

  // Web3
  web3: z.object({
    defaultRpcUrls: z.record(z.string(), z.array(z.string())),  // chainId -> rpcs
    rateLimits: z.object({
      perCommunity: z.number().default(100),
      perContract: z.number().default(30),
      global: z.number().default(10000),
    }),
  }),

  // Preview
  preview: z.object({
    maxConcurrent: z.number().default(100),
    renderTimeout: z.number().default(5000),
  }),

  // Feature flags
  features: z.object({
    themeBuilderEnabled: z.boolean().default(false),
    marketplaceEnabled: z.boolean().default(false),  // Future
  }),
});
```

---

## 12. Testing Strategy

### 12.1 Test Pyramid

```
                    ┌───────────┐
                    │   E2E     │  5%
                    │  Tests    │
                    └───────────┘
               ┌─────────────────────┐
               │   Integration       │  25%
               │   Tests             │
               └─────────────────────┘
          ┌───────────────────────────────┐
          │        Unit Tests             │  70%
          │                               │
          └───────────────────────────────┘
```

### 12.2 Test Categories

| Category | Focus | Tools |
|----------|-------|-------|
| Unit | Component logic, validators, transformers | Vitest |
| Integration | API endpoints, database queries, caching | Vitest + supertest |
| E2E | Builder workflows, preview rendering | Playwright |
| Contract | Web3 interaction mocking | Vitest + anvil |

### 12.3 Critical Test Scenarios

1. **Theme CRUD**: Create, update, publish, rollback
2. **Component validation**: All component types with valid/invalid props
3. **Contract binding**: Add, validate, cache, rate limit
4. **Token gating**: Balance checks, NFT ownership, trait filtering
5. **Preview rendering**: All viewports, with/without mock data
6. **Asset upload**: Valid files, invalid files, size limits
7. **Security**: XSS prevention, SVG sanitization, sandbox escape

---

## 13. Migration Plan

### 13.1 Phase 1: Foundation (MVP)

1. **Database schema** - SQLite tables for themes, versions, contracts
2. **Theme CRUD API** - Basic create/read/update/delete
3. **Component registry** - 6 core components
4. **Preview engine** - SSR with mock data

### 13.2 Phase 2: Web3 Integration

1. **Chain service** - Multi-chain viem abstraction
2. **Contract binding** - Add, validate, cache
3. **Token gating** - Balance and ownership checks
4. **Live Web3 preview** - Real chain data in preview

### 13.3 Phase 3: Builder UI

1. **Visual canvas** - Drag-drop component placement
2. **Live preview** - Side-by-side editing
3. **Wizard mode** - Guided theme creation
4. **Code editor** - JSON editing for power users

### 13.4 Phase 4: Polish & Scale

1. **PostgreSQL migration** - RLS, JSONB optimization
2. **Performance tuning** - Caching, preloading
3. **Discord integration** - Embed templates
4. **Asset management** - S3 storage, CDN

---

## 14. Open Questions & Decisions

### 14.1 Resolved Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage format | JSON in SQLite | Flexible, portable, simple queries |
| Preview rendering | SSR + iframe | Secure isolation, consistent output |
| Multi-chain | Day 1 support | PRD requirement, minimal added complexity |
| Component system | Registry pattern | Extensible, type-safe, testable |

### 14.2 Open Questions

1. **Theme templates**: Should we ship starter templates, or let users start from blank?
2. **Custom components**: How to allow power users to define custom components?
3. **Migration timeline**: When to migrate Sietch to theme engine?
4. **Marketplace data model**: What additional fields needed for future marketplace?

---

## 15. Appendix

### A. Component Props JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "definitions": {
    "GateConfig": {
      "type": "object",
      "properties": {
        "type": { "enum": ["token", "nft", "multi"] },
        "contractId": { "type": "string" },
        "minBalance": { "type": "string" },
        "traits": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "traitType": { "type": "string" },
              "values": { "type": "array", "items": { "type": "string" } }
            }
          }
        }
      }
    },
    "ComponentInstance": {
      "type": "object",
      "required": ["id", "type", "props", "position"],
      "properties": {
        "id": { "type": "string", "format": "uuid" },
        "type": { "type": "string" },
        "props": { "type": "object" },
        "position": {
          "type": "object",
          "properties": {
            "x": { "type": "number" },
            "y": { "type": "number" },
            "width": { "type": "number" },
            "height": { "type": "number" }
          }
        }
      }
    }
  }
}
```

### B. Supported EVM Chains (MVP)

| Chain ID | Name | Status |
|----------|------|--------|
| 1 | Ethereum Mainnet | Supported |
| 42161 | Arbitrum One | Supported |
| 10 | Optimism | Supported |
| 8453 | Base | Supported |
| 137 | Polygon | Supported |
| 80094 | Berachain | Supported |

### C. Reference Implementation Files

| Concept | Reference in Sietch |
|---------|---------------------|
| Chain service | `src/services/chain.ts` |
| Database schema | `src/db/schema.ts` |
| Config validation | `src/config.ts` |
| API routes | `src/api/routes.ts` |
| Billing services | `src/services/billing/` |

---

*Document generated from SDD architecture session 2026-01-21*
