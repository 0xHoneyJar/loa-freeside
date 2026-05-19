# Packages

Shared libraries and utilities for the Freeside monorepo.

## Structure

| Package | Description | Status |
|---------|-------------|--------|
| `core/` | Shared types, utils, and validation | Placeholder |

## Intent

When code needs to be shared between multiple themes or sites, it should be extracted into a package here rather than duplicated.

## Future Packages

Potential packages to be created as needed:
- `@freeside/core` - Shared types and utilities
- `@freeside/discord` - Discord.js abstractions
- `@freeside/chain` - Blockchain interaction utilities
- `@freeside/ui` - Shared React components (for sites)

## Package Guidelines

1. **Extract only when needed** - Don't create packages preemptively
2. **Clear boundaries** - Each package has a single responsibility
3. **Proper versioning** - Use semantic versioning for breaking changes
4. **Documentation** - Each package has its own README
