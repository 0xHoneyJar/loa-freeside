# @arrakis/core

Shared core library for Arrakis themes and services.

## Intent

This package will contain shared functionality used across multiple themes:

- **Types**: Common TypeScript interfaces and types
- **Utils**: Shared utility functions
- **Constants**: Common constants and configuration schemas
- **Validation**: Shared validation schemas (Zod)

## Structure (Planned)

```
packages/core/
├── src/
│   ├── types/           # Shared TypeScript types
│   ├── utils/           # Common utility functions
│   ├── constants/       # Shared constants
│   └── validation/      # Zod schemas
├── package.json
├── tsconfig.json
└── README.md
```

## Usage

When this package is implemented, themes can import shared code:

```typescript
import { CommunityConfig, validateManifest } from '@arrakis/core';
```

## Status

**Placeholder** - This package will be implemented when shared code is needed between themes.

Currently, only one theme exists (`themes/sietch`), so all code remains there. When a second theme is added, common code should be extracted here to avoid duplication.
