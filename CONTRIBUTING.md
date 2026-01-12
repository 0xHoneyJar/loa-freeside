# Contributing to Sietch

Thank you for your interest in contributing to Sietch! This document provides guidelines and information for contributors.

## Table of Contents

- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Versioning](#versioning)
- [Release Process](#release-process)
- [Getting Help](#getting-help)

## Getting Started

### Prerequisites

- Node.js 20+
- npm
- Git
- A Discord bot token (for testing)
- Access to a Berachain RPC endpoint

### Development Setup

1. **Fork the repository**
   ```bash
   git clone https://github.com/YOUR-USERNAME/arrakis.git
   cd arrakis
   ```

2. **Install dependencies**
   ```bash
   cd sietch-service
   npm install
   ```

3. **Set up environment**
   ```bash
   cp .env.example .env.local
   # Edit .env.local with your credentials
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Run tests**
   ```bash
   npm test
   ```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feature/add-new-badge` - New features
- `fix/tier-calculation-bug` - Bug fixes
- `docs/update-readme` - Documentation
- `refactor/cleanup-services` - Code improvements
- `test/add-integration-tests` - Test additions

### Code Style

- TypeScript strict mode is enforced
- ESLint and Prettier are configured
- Run `npm run lint` before committing
- Run `npm run typecheck` to verify types

### Testing

- Write unit tests for new services
- Write integration tests for API endpoints
- Maintain test coverage for critical paths
- Run `npm test` to execute the test suite

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `chore` | Maintenance tasks |
| `ci` | CI/CD changes |
| `security` | Security improvements |

### Scopes

| Scope | Description |
|-------|-------------|
| `api` | REST API changes |
| `discord` | Discord bot changes |
| `db` | Database schema/queries |
| `services` | Service layer changes |
| `trigger` | Scheduled task changes |
| `deps` | Dependency updates |

### Examples

```
feat(discord): add /stats command for personal statistics

Add a new slash command that displays member's personal stats including
tier progress, BGT history, and badge count.

Closes #123
```

```
fix(services): correct ISO 8601 week calculation

The previous implementation incorrectly calculated week numbers for
dates near year boundaries. Now uses the Thursday rule per ISO 8601.
```

## Pull Request Process

1. **Create a feature branch** from `main`
2. **Make your changes** with appropriate tests
3. **Run the full test suite** - `npm run test:run`
4. **Run linting** - `npm run lint`
5. **Run type checking** - `npm run typecheck`
6. **Update documentation** if needed
7. **Create a pull request** with:
   - Clear title following commit conventions
   - Description of changes
   - Link to related issues
   - Screenshots for UI changes

### PR Template

```markdown
## Summary
Brief description of changes

## Changes
- List of specific changes

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] Manual testing performed

## Checklist
- [ ] Code follows project style
- [ ] Tests pass locally
- [ ] Documentation updated
- [ ] CHANGELOG.md updated (for features/fixes)
```

## Versioning

This project follows [Semantic Versioning](https://semver.org/):

- **MAJOR** (X.0.0): Breaking changes
- **MINOR** (0.X.0): New features, backward compatible
- **PATCH** (0.0.X): Bug fixes, backward compatible

### Version Bump Guidelines

| Change Type | Version Bump |
|-------------|--------------|
| Breaking API change | MAJOR |
| Breaking Discord command change | MAJOR |
| Database schema change (migration required) | MINOR |
| New feature | MINOR |
| New Discord command | MINOR |
| Bug fix | PATCH |
| Performance improvement | PATCH |
| Documentation | No bump |

## Release Process

1. **Update CHANGELOG.md**
   - Move items from `[Unreleased]` to new version section
   - Add release date
   - Update comparison links

2. **Update version**
   ```bash
   npm version <major|minor|patch>
   ```

3. **Create release PR**
   - Title: `chore(release): v3.1.0`
   - Include CHANGELOG excerpt

4. **After merge, create GitHub release**
   - Tag: `v3.1.0`
   - Title: Version number and codename
   - Body: CHANGELOG section for this version

### Changelog Format

Follow [Keep a Changelog](https://keepachangelog.com/):

```markdown
## [3.1.0] - 2025-01-15

### Added
- New feature description

### Changed
- Change description

### Fixed
- Bug fix description

### Removed
- Removed feature description

### Security
- Security fix description
```

## Project Structure

```
sietch-service/
├── src/
│   ├── api/          # REST API routes
│   ├── db/           # Database schema and queries
│   ├── discord/      # Discord bot commands and embeds
│   ├── services/     # Business logic services
│   ├── trigger/      # Scheduled tasks
│   └── types/        # TypeScript type definitions
├── tests/
│   ├── unit/         # Unit tests
│   └── integration/  # Integration tests
├── scripts/          # Utility scripts
└── grimoires/loa/    # Product documentation (PRD, SDD, sprints)
```

## Getting Help

- **Issues**: Open a GitHub issue for bugs or feature requests
- **Discussions**: Use GitHub Discussions for questions
- **Discord**: Join the Sietch Discord for community support

## Recognition

Contributors are recognized in:
- Git commit history
- GitHub contributors list
- Release notes (for significant contributions)

Thank you for contributing to Sietch!
