# Sprint Plan: WYSIWYG Theme Builder

**Version**: 1.0.0
**Created**: 2026-01-21
**PRD**: `grimoires/loa/prd.md`
**SDD**: `grimoires/loa/sdd.md`
**Branch**: feature/wysiwyg-themes

---

## Overview

### MVP Goal
Enable internal team to recreate Sietch-equivalent theme via builder UI.

### Sprint Structure
- **Sprint Duration**: 1 week each
- **Total Sprints**: 8 sprints (MVP)
- **Team**: 1 full-stack developer (Claude-assisted)

### Phase Mapping
| Phase | Sprints | Focus |
|-------|---------|-------|
| Foundation | 1-2 | Database, API, Types |
| Web3 Layer | 3-4 | Chain service, Contract bindings |
| Component System | 5-6 | Core components, Preview engine |
| Builder UI | 7-8 | Visual editor, Live preview |

---

## Sprint 1: Foundation - Database Schema & Types

**Goal**: Establish database schema and TypeScript type definitions

### Tasks

#### Task 1.1: Create Theme Database Schema
**Description**: Implement SQLite schema for themes, versions, contracts, assets, and audit log as defined in SDD Section 5.

**Files**:
- `src/db/migrations/021_theme_builder.ts`
- `src/db/schema.ts` (add re-export)

**Acceptance Criteria**:
- [ ] `themes` table with all columns (id, community_id, name, status, config, version, timestamps)
- [ ] `theme_versions` table with history tracking
- [ ] `contract_bindings` table with chain_id, address, abi
- [ ] `theme_assets` table with storage path and type
- [ ] `theme_audit_log` table with action tracking
- [ ] All indexes created for performance
- [ ] Foreign key constraints enforced
- [ ] Rollback migration included

**Estimated Effort**: 4 hours

---

#### Task 1.2: Define Core TypeScript Types
**Description**: Create comprehensive TypeScript types for Theme, ThemeBranding, ThemePage, ComponentInstance, and related schemas as defined in SDD Section 4.

**Files**:
- `src/types/theme.types.ts`
- `src/types/theme-component.types.ts`
- `src/types/theme-web3.types.ts`

**Acceptance Criteria**:
- [ ] `Theme` interface with all properties
- [ ] `ThemeBranding` interface with colors, fonts, assets
- [ ] `ThemePage` interface with layout and visibility
- [ ] `ComponentInstance` interface with position and props
- [ ] `ComponentType` union type for all MVP components
- [ ] `ContractBinding` interface with ABI typing
- [ ] `ChainConfig` interface with RPC configuration
- [ ] `GateConfig` interface with multi-condition support
- [ ] All types exported from `src/types/index.ts`

**Estimated Effort**: 3 hours

---

#### Task 1.3: Create Zod Validation Schemas
**Description**: Implement runtime validation schemas matching TypeScript types for API input validation.

**Files**:
- `src/validators/theme.validators.ts`

**Acceptance Criteria**:
- [ ] `themeSchema` validates full theme config
- [ ] `themeBrandingSchema` validates colors as hex
- [ ] `componentInstanceSchema` validates position bounds
- [ ] `contractBindingSchema` validates checksummed addresses
- [ ] `gateConfigSchema` validates condition trees
- [ ] All schemas properly typed with `z.infer<>`
- [ ] Unit tests for all validation schemas

**Estimated Effort**: 3 hours

---

#### Task 1.4: Theme Query Module
**Description**: Create database query functions for theme CRUD operations following existing patterns in `src/db/queries/`.

**Files**:
- `src/db/queries/theme-queries.ts`
- `src/db/index.ts` (add exports)

**Acceptance Criteria**:
- [ ] `createTheme(communityId, name, config)` - insert new theme
- [ ] `getThemeById(id)` - fetch with config parsing
- [ ] `getThemesByCommunity(communityId, options)` - paginated list
- [ ] `updateTheme(id, updates)` - partial update with merge
- [ ] `deleteTheme(id)` - cascade delete
- [ ] `publishTheme(id, version)` - status change with version
- [ ] All functions use parameterized queries
- [ ] JSON config properly serialized/deserialized
- [ ] Unit tests with SQLite in-memory

**Estimated Effort**: 4 hours

---

### Sprint 1 Deliverables
- Theme database schema with migrations
- TypeScript type definitions
- Zod validation schemas
- Theme query module with tests

### Sprint 1 Success Criteria
- `pnpm test` passes with all new tests
- Database migrations run successfully
- Types compile without errors

---

## Sprint 2: Foundation - Theme CRUD API

**Goal**: Implement RESTful API for theme management

### Tasks

#### Task 2.1: Theme Routes Setup
**Description**: Create Express router for theme API endpoints with proper middleware chain.

**Files**:
- `src/api/routes/theme.routes.ts`
- `src/api/routes/index.ts` (add export)
- `src/api/server.ts` (mount router)

**Acceptance Criteria**:
- [ ] Router mounted at `/api/themes`
- [ ] Admin authentication middleware applied
- [ ] Request ID middleware for tracing
- [ ] Rate limiting per community
- [ ] OpenAPI documentation annotations

**Estimated Effort**: 2 hours

---

#### Task 2.2: Theme CRUD Endpoints
**Description**: Implement all theme management endpoints as defined in SDD Section 6.1.

**Endpoints**:
- `POST /api/themes` - Create theme
- `GET /api/themes` - List themes (paginated)
- `GET /api/themes/:themeId` - Get theme
- `PATCH /api/themes/:themeId` - Update theme
- `DELETE /api/themes/:themeId` - Delete theme

**Files**:
- `src/api/routes/theme.routes.ts`

**Acceptance Criteria**:
- [ ] Create returns 201 with theme ID
- [ ] List supports `status` filter and pagination
- [ ] Get returns full theme config with parsed JSON
- [ ] Update merges partial config correctly
- [ ] Delete cascades to versions and assets
- [ ] All endpoints validate input with Zod
- [ ] Proper error responses (400, 401, 404, 500)
- [ ] Audit log entries created for all mutations

**Estimated Effort**: 5 hours

---

#### Task 2.3: Theme Versioning Endpoints
**Description**: Implement version history and rollback functionality.

**Endpoints**:
- `POST /api/themes/:themeId/publish` - Publish with version bump
- `GET /api/themes/:themeId/versions` - List version history
- `POST /api/themes/:themeId/rollback` - Rollback to specific version

**Files**:
- `src/api/routes/theme.routes.ts`
- `src/db/queries/theme-version-queries.ts`

**Acceptance Criteria**:
- [ ] Publish creates version snapshot before status change
- [ ] Version list returns all versions with metadata
- [ ] Rollback restores config from version snapshot
- [ ] Version bump follows SemVer (patch default)
- [ ] Cannot rollback unpublished theme

**Estimated Effort**: 3 hours

---

#### Task 2.4: Theme API Integration Tests
**Description**: Comprehensive integration tests for all theme endpoints.

**Files**:
- `src/api/routes/__tests__/theme.routes.test.ts`

**Acceptance Criteria**:
- [ ] Create theme test with valid/invalid input
- [ ] List themes with pagination test
- [ ] Update theme merge behavior test
- [ ] Publish/rollback workflow test
- [ ] Authentication required tests
- [ ] Rate limiting test
- [ ] Error response format tests

**Estimated Effort**: 4 hours

---

### Sprint 2 Deliverables
- Theme CRUD REST API
- Version history and rollback
- Integration test suite

### Sprint 2 Success Criteria
- All API endpoints functional
- Integration tests pass
- API documented in OpenAPI

---

## Sprint 3: Web3 Layer - Chain Service

**Goal**: Implement multi-chain contract interaction service

### Tasks

#### Task 3.1: Chain Configuration
**Description**: Define supported chains with RPC endpoints and metadata.

**Files**:
- `src/config/chains.ts`
- `src/types/theme-web3.types.ts` (update)

**Acceptance Criteria**:
- [ ] `SUPPORTED_CHAINS` constant with 6 chains (ETH, Arbitrum, Optimism, Base, Polygon, Berachain)
- [ ] Each chain has: chainId, name, rpcUrl, rpcUrls (fallback), blockExplorer, nativeCurrency
- [ ] Environment variable overrides for RPC URLs
- [ ] Chain lookup by ID function
- [ ] Validation for unknown chain IDs

**Estimated Effort**: 2 hours

---

#### Task 3.2: Theme Chain Service
**Description**: Create multi-chain viem client manager for contract reads.

**Files**:
- `src/services/theme/ThemeChainService.ts`

**Acceptance Criteria**:
- [ ] Creates viem PublicClient per chain on demand
- [ ] Uses fallback transport with multiple RPCs
- [ ] RPC health tracking (similar to existing `ChainService`)
- [ ] Connection pooling and reuse
- [ ] Timeout configuration (30s default)
- [ ] Error handling with chain-specific messages

**Estimated Effort**: 4 hours

---

#### Task 3.3: Contract Read Service
**Description**: Implement contract read functionality with caching.

**Files**:
- `src/services/theme/ContractReadService.ts`

**Acceptance Criteria**:
- [ ] `readContract(chainId, address, functionName, args, abi)` - generic read
- [ ] `getBalance(chainId, wallet, tokenAddress)` - ERC20 balance
- [ ] `ownsNFT(chainId, wallet, nftAddress, tokenId?)` - NFT ownership
- [ ] Redis caching with configurable TTL
- [ ] Cache key generation per SDD Section 9.1
- [ ] Rate limiting per community/contract

**Estimated Effort**: 5 hours

---

#### Task 3.4: Contract Validation Service
**Description**: Implement contract address and ABI validation per SDD Section 8.1.

**Files**:
- `src/services/theme/ContractValidationService.ts`
- `src/data/malicious-addresses.ts`

**Acceptance Criteria**:
- [ ] Address format validation (isAddress)
- [ ] Checksum validation and normalization
- [ ] Zero address rejection
- [ ] Malicious address blocklist check
- [ ] ABI validation (view/pure functions only)
- [ ] No receive/fallback functions allowed
- [ ] Validation result with typed errors

**Estimated Effort**: 3 hours

---

### Sprint 3 Deliverables
- Multi-chain viem client manager
- Contract read service with caching
- Contract validation service

### Sprint 3 Success Criteria
- Read from all 6 supported chains
- Caching reduces RPC calls
- Invalid contracts rejected

---

## Sprint 4: Web3 Layer - Contract Binding API

**Goal**: Implement contract binding management and Web3 data API

### Tasks

#### Task 4.1: Contract Binding Query Module
**Description**: Database queries for contract bindings.

**Files**:
- `src/db/queries/contract-binding-queries.ts`

**Acceptance Criteria**:
- [ ] `createContractBinding(themeId, binding)` - insert
- [ ] `getContractBindings(themeId)` - list by theme
- [ ] `getContractBinding(id)` - get by ID
- [ ] `updateContractBinding(id, updates)` - update
- [ ] `deleteContractBinding(id)` - delete
- [ ] Unique constraint on (theme_id, chain_id, address)

**Estimated Effort**: 2 hours

---

#### Task 4.2: Contract Binding API Endpoints
**Description**: REST API for managing contract bindings per theme.

**Endpoints**:
- `POST /api/themes/:themeId/contracts` - Add binding
- `GET /api/themes/:themeId/contracts` - List bindings
- `PATCH /api/themes/:themeId/contracts/:bindingId` - Update
- `DELETE /api/themes/:themeId/contracts/:bindingId` - Delete

**Files**:
- `src/api/routes/theme-contract.routes.ts`

**Acceptance Criteria**:
- [ ] Add binding validates address and ABI
- [ ] Auto-detect standard contract types (ERC20/721/1155)
- [ ] Fetch ABI from Etherscan for verified contracts
- [ ] List returns bindings with validation status
- [ ] Delete invalidates related cache entries

**Estimated Effort**: 4 hours

---

#### Task 4.3: Web3 Data API Endpoints
**Description**: API for reading contract data and verifying ownership.

**Endpoints**:
- `POST /api/web3/read` - Generic contract read
- `GET /api/web3/token/:chainId/:address` - Token metadata
- `GET /api/web3/nft/:chainId/:address` - NFT collection metadata
- `POST /api/web3/verify-ownership` - Ownership verification

**Files**:
- `src/api/routes/web3.routes.ts`

**Acceptance Criteria**:
- [ ] Read endpoint uses cached binding if exists
- [ ] Token metadata includes name, symbol, decimals
- [ ] NFT metadata includes traits and supply
- [ ] Ownership verification returns boolean + balance
- [ ] All endpoints enforce rate limits
- [ ] Response includes cache status

**Estimated Effort**: 5 hours

---

#### Task 4.4: Web3 API Tests
**Description**: Integration tests for Web3 endpoints with mocked RPC.

**Files**:
- `src/api/routes/__tests__/web3.routes.test.ts`
- `src/services/theme/__tests__/ContractReadService.test.ts`

**Acceptance Criteria**:
- [ ] Contract binding CRUD tests
- [ ] Address validation rejection tests
- [ ] Contract read with mock RPC
- [ ] Caching behavior tests
- [ ] Rate limiting tests
- [ ] Multi-chain tests

**Estimated Effort**: 4 hours

---

### Sprint 4 Deliverables
- Contract binding management API
- Web3 data read API
- Ownership verification endpoint

### Sprint 4 Success Criteria
- Can add/remove contract bindings
- Can read on-chain data with caching
- Rate limits enforced

---

## Sprint 5: Component System - Registry & Validators

**Goal**: Implement component registry and validation system

### Tasks

#### Task 5.1: Component Registry Service
**Description**: Central registry for component definitions as defined in SDD Section 7.1.

**Files**:
- `src/services/theme/ComponentRegistry.ts`
- `src/services/theme/components/index.ts`

**Acceptance Criteria**:
- [ ] `registerComponent(registration)` - add component
- [ ] `getComponent(type)` - get by type
- [ ] `listComponents()` - all components
- [ ] `validateProps(type, props)` - validate against schema
- [ ] Component definitions include propsSchema, defaultProps
- [ ] Singleton pattern for registry

**Estimated Effort**: 3 hours

---

#### Task 5.2: MVP Component Definitions
**Description**: Define 6 core components per PRD Section 5.1.3.

**Files**:
- `src/services/theme/components/TokenGateComponent.ts`
- `src/services/theme/components/NFTGalleryComponent.ts`
- `src/services/theme/components/LeaderboardComponent.ts`
- `src/services/theme/components/ProfileCardComponent.ts`
- `src/services/theme/components/RichTextComponent.ts`
- `src/services/theme/components/LayoutContainerComponent.ts`

**Acceptance Criteria**:
- [ ] Token Gate: gateConfig, children, fallbackMessage props
- [ ] NFT Gallery: contractId, displayMode, columns, filterTraits props
- [ ] Leaderboard: rankBy, limit, showAvatar, highlightTop props
- [ ] Profile Card: showAvatar, showWallet, showBadges, layout props
- [ ] Rich Text: content, textAlign, fontSize props
- [ ] Layout Container: children, layout, gap, padding props
- [ ] Each component has JSON Schema for props
- [ ] Each component has default props

**Estimated Effort**: 5 hours

---

#### Task 5.3: Component API Endpoints
**Description**: API for component discovery and validation.

**Endpoints**:
- `GET /api/components` - List all components
- `POST /api/components/validate` - Validate component props

**Files**:
- `src/api/routes/component.routes.ts`

**Acceptance Criteria**:
- [ ] List returns all component definitions
- [ ] Includes propsSchema, defaultProps, capabilities
- [ ] Validate returns valid/invalid with errors
- [ ] Error messages include JSON path

**Estimated Effort**: 2 hours

---

#### Task 5.4: Component Validation Tests
**Description**: Unit tests for all component validators.

**Files**:
- `src/services/theme/components/__tests__/TokenGateComponent.test.ts`
- `src/services/theme/components/__tests__/NFTGalleryComponent.test.ts`
- `src/services/theme/components/__tests__/LeaderboardComponent.test.ts`
- `src/services/theme/components/__tests__/ProfileCardComponent.test.ts`
- `src/services/theme/components/__tests__/RichTextComponent.test.ts`
- `src/services/theme/components/__tests__/LayoutContainerComponent.test.ts`

**Acceptance Criteria**:
- [ ] Valid props pass validation
- [ ] Missing required props fail
- [ ] Invalid prop types fail
- [ ] Nested component validation (containers)
- [ ] Default props applied correctly

**Estimated Effort**: 4 hours

---

### Sprint 5 Deliverables
- Component registry service
- 6 MVP component definitions
- Component validation API

### Sprint 5 Success Criteria
- All components registered
- Validation works for all types
- API returns component catalog

---

## Sprint 6: Component System - Preview Engine

**Goal**: Implement server-side preview rendering

### Tasks

#### Task 6.1: Component Renderers
**Description**: Server-side HTML renderers for each component.

**Files**:
- `src/services/theme/renderers/TokenGateRenderer.ts`
- `src/services/theme/renderers/NFTGalleryRenderer.ts`
- `src/services/theme/renderers/LeaderboardRenderer.ts`
- `src/services/theme/renderers/ProfileCardRenderer.ts`
- `src/services/theme/renderers/RichTextRenderer.ts`
- `src/services/theme/renderers/LayoutContainerRenderer.ts`
- `src/services/theme/renderers/index.ts`

**Acceptance Criteria**:
- [ ] Each renderer implements `render(props, context): string`
- [ ] Each renderer implements `getStyles(props): string`
- [ ] HTML output uses semantic elements
- [ ] CSS uses theme CSS variables
- [ ] Renderers support mock data mode
- [ ] XSS prevention via sanitization

**Estimated Effort**: 6 hours

---

#### Task 6.2: Theme Preview Service
**Description**: Service for generating complete theme preview HTML.

**Files**:
- `src/services/theme/PreviewService.ts`

**Acceptance Criteria**:
- [ ] `generatePreview(themeId, pageId?, options)` - main method
- [ ] Renders all components on page
- [ ] Applies branding (colors, fonts, spacing)
- [ ] Supports viewport modes (desktop, tablet, mobile)
- [ ] Supports mock wallet data for gating preview
- [ ] Returns HTML, CSS, and script URLs
- [ ] Preview cached in Redis (30s TTL)

**Estimated Effort**: 5 hours

---

#### Task 6.3: Preview API Endpoints
**Description**: REST API for generating theme previews.

**Endpoints**:
- `POST /api/themes/:themeId/preview` - Generate preview HTML

**Files**:
- `src/api/routes/theme-preview.routes.ts`

**Acceptance Criteria**:
- [ ] Returns HTML/CSS response
- [ ] Supports `pageId` for specific page
- [ ] Supports `viewport` parameter
- [ ] Supports `mockData` for wallet simulation
- [ ] Sets proper CSP headers (per SDD 8.4)
- [ ] Response includes cache status

**Estimated Effort**: 3 hours

---

#### Task 6.4: Preview Rendering Tests
**Description**: Tests for component renderers and preview service.

**Files**:
- `src/services/theme/renderers/__tests__/*.test.ts`
- `src/services/theme/__tests__/PreviewService.test.ts`

**Acceptance Criteria**:
- [ ] Each renderer produces valid HTML
- [ ] Branding CSS variables applied
- [ ] Mock data mode works
- [ ] Gated content hidden/shown correctly
- [ ] Full theme preview generates

**Estimated Effort**: 4 hours

---

### Sprint 6 Deliverables
- Component HTML renderers
- Theme preview service
- Preview API endpoint

### Sprint 6 Success Criteria
- Can generate preview for any theme
- Preview reflects theme branding
- Gating works with mock data

---

## Sprint 7: Builder UI - Visual Editor (Part 1)

**Goal**: Implement React-based visual theme editor

### Tasks

#### Task 7.1: Builder UI Setup
**Description**: Set up React application for theme builder.

**Files**:
- `src/ui/builder/` - New React app directory
- `src/ui/builder/package.json`
- `src/ui/builder/vite.config.ts`
- `src/ui/builder/src/main.tsx`
- `src/ui/builder/src/App.tsx`

**Acceptance Criteria**:
- [ ] React 18+ with TypeScript
- [ ] Vite for build/dev
- [ ] Tailwind CSS configured
- [ ] Zustand store setup
- [ ] React Query for API calls
- [ ] Development server works

**Estimated Effort**: 3 hours

---

#### Task 7.2: Theme Editor State Management
**Description**: Zustand store for editor state.

**Files**:
- `src/ui/builder/src/stores/themeStore.ts`
- `src/ui/builder/src/stores/editorStore.ts`

**Acceptance Criteria**:
- [ ] `themeStore` holds current theme config
- [ ] `editorStore` holds UI state (selected component, mode)
- [ ] Actions for CRUD operations
- [ ] Undo/redo history
- [ ] Dirty state tracking
- [ ] Auto-save debouncing

**Estimated Effort**: 4 hours

---

#### Task 7.3: Component Palette
**Description**: Sidebar component showing available components.

**Files**:
- `src/ui/builder/src/components/ComponentPalette.tsx`
- `src/ui/builder/src/components/ComponentCard.tsx`

**Acceptance Criteria**:
- [ ] Lists all available components
- [ ] Grouped by category (web3, content, layout)
- [ ] Shows icon, name, description
- [ ] Draggable for drag-drop
- [ ] Search/filter functionality

**Estimated Effort**: 3 hours

---

#### Task 7.4: Canvas Layout Component
**Description**: Main canvas area for placing components.

**Files**:
- `src/ui/builder/src/components/Canvas.tsx`
- `src/ui/builder/src/components/CanvasComponent.tsx`
- `src/ui/builder/src/components/DropZone.tsx`

**Acceptance Criteria**:
- [ ] Grid-based layout system
- [ ] Drop zones for components
- [ ] Component selection on click
- [ ] Resize handles for components
- [ ] Drag to reorder
- [ ] Keyboard navigation

**Estimated Effort**: 6 hours

---

### Sprint 7 Deliverables
- React builder app setup
- State management with Zustand
- Component palette UI
- Canvas with drag-drop

### Sprint 7 Success Criteria
- Can drag components to canvas
- Components show on canvas
- Selection state works

---

## Sprint 8: Builder UI - Visual Editor (Part 2)

**Goal**: Complete visual editor with live preview

### Tasks

#### Task 8.1: Properties Panel
**Description**: Side panel for editing selected component props.

**Files**:
- `src/ui/builder/src/components/PropertiesPanel.tsx`
- `src/ui/builder/src/components/PropertyField.tsx`
- `src/ui/builder/src/components/fields/*.tsx` (text, number, color, select, etc.)

**Acceptance Criteria**:
- [ ] Shows props for selected component
- [ ] Field types: text, number, color, select, toggle, rich-text
- [ ] Validation errors shown inline
- [ ] Changes update canvas immediately
- [ ] Contract selector field (for Web3 components)

**Estimated Effort**: 5 hours

---

#### Task 8.2: Branding Editor
**Description**: UI for editing theme branding (colors, fonts).

**Files**:
- `src/ui/builder/src/components/BrandingEditor.tsx`
- `src/ui/builder/src/components/ColorPicker.tsx`
- `src/ui/builder/src/components/FontSelector.tsx`

**Acceptance Criteria**:
- [ ] Color palette editor with presets
- [ ] Font family selector (Google Fonts)
- [ ] Border radius selector
- [ ] Spacing selector
- [ ] Logo upload
- [ ] Real-time preview updates

**Estimated Effort**: 4 hours

---

#### Task 8.3: Live Preview Panel
**Description**: Iframe-based preview that updates in real-time.

**Files**:
- `src/ui/builder/src/components/PreviewPanel.tsx`
- `src/ui/builder/src/components/ViewportSelector.tsx`

**Acceptance Criteria**:
- [ ] iframe with proper sandbox attributes
- [ ] Viewport switching (desktop, tablet, mobile)
- [ ] Real-time updates via postMessage
- [ ] Loading state while rendering
- [ ] Open in new tab option

**Estimated Effort**: 4 hours

---

#### Task 8.4: Save & Publish Flow
**Description**: UI for saving drafts and publishing themes.

**Files**:
- `src/ui/builder/src/components/EditorToolbar.tsx`
- `src/ui/builder/src/components/PublishDialog.tsx`
- `src/ui/builder/src/components/VersionHistoryDialog.tsx`

**Acceptance Criteria**:
- [ ] Save button with auto-save indicator
- [ ] Publish button opens confirmation dialog
- [ ] Version history dialog shows versions
- [ ] Rollback option in history
- [ ] Keyboard shortcuts (Cmd+S, etc.)

**Estimated Effort**: 3 hours

---

### Sprint 8 Deliverables
- Properties panel for editing
- Branding editor
- Live preview with viewports
- Save and publish flow

### Sprint 8 Success Criteria
- Full editor workflow functional
- Can create theme from scratch
- Can publish and view theme

---

## Post-MVP Sprints

### Sprint 9-10: Polish & Testing
- E2E tests with Playwright
- Performance optimization
- Error handling improvements
- Accessibility audit

### Sprint 11-12: Discord Integration
- Discord embed templates
- Permission-aware mode detection
- Embed preview in builder

### Sprint 13-14: Wizard Mode
- Step-by-step guided flow
- Template selection
- Quick start experience

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Web3 RPC rate limits | Aggressive caching, multiple RPC fallbacks |
| Complex drag-drop bugs | Use battle-tested @dnd-kit library |
| Preview performance | SSR caching, lazy component loading |
| Scope creep | Strict MVP feature freeze |

---

## Dependencies

| Sprint | Depends On |
|--------|-----------|
| Sprint 2 | Sprint 1 (DB schema) |
| Sprint 4 | Sprint 3 (Chain service) |
| Sprint 6 | Sprint 5 (Component registry) |
| Sprint 7 | Sprint 6 (Preview API) |
| Sprint 8 | Sprint 7 (Builder setup) |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Test coverage | >80% |
| API response time (P95) | <500ms |
| Preview render time | <1s |
| Builder UI load time | <3s |
| Theme config size | <1MB |

---

*Sprint plan generated 2026-01-21*
