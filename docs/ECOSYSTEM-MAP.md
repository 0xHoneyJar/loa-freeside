# Arrakis Ecosystem Map

> Generated: 2026-02-04
> Purpose: Document how all Arrakis repositories work together

## Overview

The Arrakis platform is being split into multiple repositories to enable parallel development. This document maps the relationships between all components.

---

## Repository Status

| Repository | Status | Location in Monorepo | Purpose |
|------------|--------|---------------------|---------|
| [arrakis](https://github.com/0xHoneyJar/arrakis) | **Active** | Root | Core platform monorepo |
| [arrakis-types](https://github.com/0xHoneyJar/arrakis-types) | **Empty** | `packages/core` | Shared TypeScript types |
| [arrakis-dashboard](https://github.com/0xHoneyJar/arrakis-dashboard) | **Empty** | `themes/sietch/dashboard` | Admin dashboard |
| [arrakis-builder](https://github.com/0xHoneyJar/arrakis-builder) | **Empty** | `themes/sietch/src/ui/builder` | WYSIWYG theme builder |
| [arrakis-web](https://github.com/0xHoneyJar/arrakis-web) | **Empty** | `sites/web` | Marketing website |

**Note**: The extracted repos were created but never had code pushed to them. All code currently lives in the monorepo.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           ARRAKIS ECOSYSTEM                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐     │
│  │  arrakis-web    │    │ arrakis-builder │    │arrakis-dashboard│     │
│  │  (Marketing)    │    │ (Theme Editor)  │    │ (Admin Panel)   │     │
│  │  Next.js        │    │ React + Vite    │    │ React + Vite    │     │
│  │  sites/web      │    │ ui/builder      │    │ dashboard       │     │
│  └────────┬────────┘    └────────┬────────┘    └────────┬────────┘     │
│           │                      │                      │               │
│           └──────────────────────┼──────────────────────┘               │
│                                  │                                       │
│                                  ▼                                       │
│                    ┌─────────────────────────┐                          │
│                    │     arrakis-types       │                          │
│                    │   (Shared Types/DTOs)   │                          │
│                    │     packages/core       │                          │
│                    └─────────────┬───────────┘                          │
│                                  │                                       │
│                                  ▼                                       │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        ARRAKIS (Monorepo)                          │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │  │
│  │  │themes/sietch│  │apps/gateway │  │ apps/worker │                │  │
│  │  │ (Discord Bot│  │ (API GW)    │  │ (Jobs)      │                │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                │  │
│  │                                                                    │  │
│  │  ┌─────────────────────────────────────────────────────────────┐  │  │
│  │  │                    packages/adapters                         │  │  │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │  │  │
│  │  │  │  chain   │  │ security │  │  themes  │  │ storage  │    │  │  │
│  │  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │  │  │
│  │  └─────────────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. arrakis (Monorepo) - Active

**Purpose**: Core platform containing all backend services and the Discord bot.

| Directory | Purpose | Extract Target |
|-----------|---------|----------------|
| `packages/core` | Domain models, ports, interfaces | `arrakis-types` |
| `packages/adapters` | Chain providers, security, themes | Stays in monorepo |
| `themes/sietch` | Discord bot application | Stays in monorepo |
| `themes/sietch/dashboard` | Admin dashboard UI | `arrakis-dashboard` |
| `themes/sietch/src/ui/builder` | Theme builder UI | `arrakis-builder` |
| `apps/gateway` | API gateway | Stays in monorepo |
| `apps/worker` | Background jobs | Stays in monorepo |
| `sites/web` | Marketing website | `arrakis-web` |
| `sites/docs` | Documentation site | Stays in monorepo |

### 2. arrakis-types - To Be Extracted

**Source**: `packages/core`
**Package Name**: `@arrakis/core`

**Contents**:
- Domain models (`domain/*.ts`)
- Port interfaces (`ports/*.ts`)
- Type definitions

**Dependents**:
- arrakis-dashboard
- arrakis-builder
- arrakis (adapters, themes)

### 3. arrakis-dashboard - To Be Extracted

**Source**: `themes/sietch/dashboard`
**Package Name**: `@stilgar/dashboard`
**Tech Stack**: React 18, Vite, Radix UI, TanStack Query, Zustand

**Features**:
- Admin authentication (`api/auth.ts`, `hooks/useAuth.ts`)
- Server selection (`pages/ServerSelect.tsx`)
- Configuration management:
  - Tier hierarchy (`components/config/TierHierarchy.tsx`)
  - Threshold editor (`components/config/ThresholdEditor.tsx`)
  - Feature gate matrix (`components/config/FeatureGateMatrix.tsx`)
  - Role mapping (`components/config/RoleMappingTable.tsx`)
- Sandbox testing (`pages/Sandbox.tsx`)
  - Decision trace viewer (`components/sandbox/DecisionTrace.tsx`)
  - Permission result viewer (`components/sandbox/PermissionResult.tsx`)
  - State editor (`components/sandbox/StateEditor.tsx`)
- Configuration history:
  - Timeline view (`components/history/Timeline.tsx`)
  - Diff viewer (`components/history/DiffViewer.tsx`)
  - Restore modal (`components/history/RestoreModal.tsx`)

**Dependencies**:
- `arrakis-types` (for DTOs)
- Arrakis API (backend)

### 4. arrakis-builder - To Be Extracted

**Source**: `themes/sietch/src/ui/builder`
**Package Name**: `@sietch/theme-builder`
**Tech Stack**: React 18, Vite, dnd-kit, TanStack Query, Zustand

**Features**:
- Drag-and-drop canvas (`components/canvas/Canvas.tsx`)
- Component palette (`components/palette/ComponentPalette.tsx`)
- Properties panel (`components/properties/PropertiesPanel.tsx`)
- Branding editor (`components/branding/BrandingEditor.tsx`)
  - Color picker
  - Font selector
- Preview panel (`components/preview/PreviewPanel.tsx`)
- Toolbar (`components/toolbar/EditorToolbar.tsx`)
  - Publish dialog
  - Version history

**State Management**:
- `stores/themeStore.ts` - Theme configuration
- `stores/editorStore.ts` - Editor state
- `stores/componentStore.ts` - Component instances

**Dependencies**:
- `arrakis-types` (for theme schemas)
- Arrakis API (for saving/loading themes)

### 5. arrakis-web - To Be Extracted

**Source**: `sites/web`
**Package Name**: `arrakis-website`
**Tech Stack**: Next.js 14, React 18, Tailwind CSS

**Purpose**: Marketing website for Arrakis platform.

**Dependencies**: None (standalone marketing site)

---

## Extraction Plan

### Phase 1: Extract Shared Types (`arrakis-types`)

```bash
# 1. Initialize the repo
git clone git@github.com:0xHoneyJar/arrakis-types.git
cd arrakis-types

# 2. Copy core package
cp -r ../arrakis/packages/core/* .

# 3. Update package.json
# - Change name to @arrakis/types
# - Add npm publish config
# - Remove internal dependencies

# 4. Publish to npm (or GitHub Packages)
npm publish
```

### Phase 2: Extract Dashboard (`arrakis-dashboard`)

```bash
# 1. Copy dashboard
cp -r ../arrakis/themes/sietch/dashboard/* .

# 2. Add arrakis-types dependency
npm install @arrakis/types

# 3. Update imports to use @arrakis/types

# 4. Configure API base URL via environment
```

### Phase 3: Extract Builder (`arrakis-builder`)

```bash
# 1. Copy builder
cp -r ../arrakis/themes/sietch/src/ui/builder/* .

# 2. Add arrakis-types dependency
npm install @arrakis/types

# 3. Update imports to use @arrakis/types
```

### Phase 4: Extract Marketing Site (`arrakis-web`)

```bash
# 1. Copy web site
cp -r ../arrakis/sites/web/* .

# 2. No type dependencies needed (standalone)
```

---

## Integration Points

### API Contracts

The extracted frontends will communicate with the Arrakis backend via REST API:

| Endpoint Group | Consumer | Description |
|----------------|----------|-------------|
| `/api/auth/*` | Dashboard | OAuth flow, session management |
| `/api/config/*` | Dashboard | Tier/threshold configuration |
| `/api/sandbox/*` | Dashboard | Permission testing |
| `/api/themes/*` | Builder | Theme CRUD operations |
| `/api/components/*` | Builder | Component library |

### Shared Types

After extraction, types should be consumed like:

```typescript
// In arrakis-dashboard
import { TierConfig, ThresholdRule } from '@arrakis/types';

// In arrakis-builder
import { ThemeSchema, ComponentDefinition } from '@arrakis/types';
```

### Environment Configuration

Each extracted repo needs:

```bash
# arrakis-dashboard/.env
VITE_API_URL=https://api.arrakis.example.com
VITE_DISCORD_CLIENT_ID=...

# arrakis-builder/.env
VITE_API_URL=https://api.arrakis.example.com

# arrakis-web/.env
NEXT_PUBLIC_APP_URL=https://app.arrakis.example.com
```

---

## Development Workflow

### Before Extraction (Current)

```
arrakis/
├── packages/core/          # Types
├── themes/sietch/
│   ├── dashboard/          # Admin UI
│   └── src/ui/builder/     # Theme builder
└── sites/web/              # Marketing
```

All in one repo, changes require coordinating in single PR.

### After Extraction (Target)

```
arrakis/                    # Backend + bot (main devs)
arrakis-types/              # Shared types (semver, npm)
arrakis-dashboard/          # Admin UI (frontend team)
arrakis-builder/            # Theme builder (design team)
arrakis-web/                # Marketing (marketing team)
```

Teams can work independently, coordinate via:
1. Type updates → bump `@arrakis/types` version
2. API changes → versioned API or feature flags
3. Deployment → independent CI/CD pipelines

---

## Next Steps

1. **Decide extraction priority** - Which repo to extract first?
2. **Set up npm publishing** - For `@arrakis/types` package
3. **Create CI/CD templates** - For extracted repos
4. **Document API contracts** - OpenAPI spec for frontend/backend coordination
5. **Plan migration** - Gradual cutover vs big bang

---

## Related Documentation

- [CODEBASE-ANALYSIS.md](CODEBASE-ANALYSIS.md) - Full codebase reference
- [STILLSUIT.md](STILLSUIT.md) - Development workflow
- [grimoires/loa/prd.md](../grimoires/loa/prd.md) - Product requirements
