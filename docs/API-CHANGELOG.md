# API Changelog

<!-- cite: loa-freeside:docs/api/stable-endpoints.json -->

This file tracks breaking changes, deprecations, and additions to **Tier 1 Stable** endpoints.
For the full route index, see [API-REFERENCE.md](API-REFERENCE.md).

## Format

Each entry follows:

```
## [7.58.0] — 2026-07-04 — world-freeside-dashboard terraform + @freeside/cli scaffold

## Disclosure

### Added

- **shared/evals**: GV6 cert_hash vector-parity gate (echelon-core#178 Ring 0) (#435)

_Source: PR #178_


## [YYYY-MM-DD] — Summary

### Added / Changed / Deprecated / Removed
- Endpoint: description of change
- Migration: what consumers should do
- Deprecation window: N cycles (if applicable)
```

---

## [2026-02-19] — Initial Stable Surface

### Added
- `GET /api/agents/health` — Agent gateway health check
- `GET /.well-known/jwks.json` — JWKS for JWT verification
- `POST /api/agents/invoke` — Synchronous agent invocation
- `POST /api/agents/stream` — SSE streaming agent invocation
- `GET /api/agents/models` — List available model aliases
- `GET /api/agents/budget` — Budget status (admin only)
- `POST /api/verify/:sessionId` — Wallet signature verification

These 7 endpoints constitute the initial Tier 1 stable surface.
