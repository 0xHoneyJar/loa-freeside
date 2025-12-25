# API Routes Reality

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2)

## Router Structure

| Router | Prefix | Auth | Rate Limit |
|--------|--------|------|------------|
| publicRouter | / | None | publicRateLimiter |
| adminRouter | /admin | API Key (requireApiKey) | adminRateLimiter |
| memberRouter | /api | None (header-based ID) | memberRateLimiter |

## Public Routes

| Method | Path | Description | Sprint |
|--------|------|-------------|--------|
| GET | /eligibility | Top 69 eligible wallets | v1.0 |
| GET | /eligibility/:address | Check address eligibility | v1.0 |
| GET | /health | Service health status | v1.0 |
| GET | /metrics | Prometheus metrics | v1.0 |

## Admin Routes

| Method | Path | Description | Sprint |
|--------|------|-------------|--------|
| POST | /admin/override | Create admin override | v1.0 |
| GET | /admin/overrides | List active overrides | v1.0 |
| DELETE | /admin/override/:id | Deactivate override | v1.0 |
| GET | /admin/audit-log | Get audit log entries | v1.0 |
| GET | /admin/health | Detailed health status | v1.0 |
| POST | /admin/badges/award | Award badge to member | v2.0 (S9) |
| DELETE | /admin/badges/:memberId/:badgeId | Revoke badge | v2.0 (S9) |
| GET | /admin/alerts/stats | Alert delivery statistics | v2.1 (S13) |
| POST | /admin/alerts/test/:memberId | Send test alert | v2.1 (S13) |
| POST | /admin/alerts/reset-counters | Reset weekly counters | v2.1 (S13) |

## Member Routes

| Method | Path | Description | Sprint |
|--------|------|-------------|--------|
| GET | /api/profile | Own profile (X-Member-Nym header) | v2.0 (S9) |
| GET | /api/members/:nym | Public profile by nym | v2.0 (S9) |
| GET | /api/directory | Browse member directory | v2.0 (S9) |
| GET | /api/badges | All badge definitions | v2.0 (S9) |
| GET | /api/leaderboard | Engagement leaderboard | v2.0 (S9) |
| GET | /api/naib | Current Naib council + former | v2.1 (S11) |
| GET | /api/naib/current | Current Naib only | v2.1 (S11) |
| GET | /api/naib/former | Former Naib (honor roll) | v2.1 (S11) |
| GET | /api/naib/member/:memberId | Check Naib status | v2.1 (S11) |
| GET | /api/threshold | Entry threshold data | v2.1 (S12) |
| GET | /api/threshold/history | Threshold snapshots | v2.1 (S12) |
| GET | /api/waitlist/status/:address | Waitlist registration status | v2.1 (S12) |
| GET | /api/notifications/preferences | Get notification prefs | v2.1 (S13) |
| PUT | /api/notifications/preferences | Update notification prefs | v2.1 (S13) |
| GET | /api/notifications/history | Alert history | v2.1 (S13) |
| GET | /api/position | Own position in rankings | v2.1 (S13) |

## Authentication Patterns

### Admin Routes
```typescript
adminRouter.use(requireApiKey);
// API key passed in Authorization header
// Maps to admin name via config.api.adminApiKeys
```

### Member Routes
```typescript
// X-Member-Nym header for profile routes
const nym = req.headers['x-member-nym'];

// X-Discord-User-Id header for notification routes
const discordUserId = req.headers['x-discord-user-id'];
```

## Validation (Zod Schemas)

- adminOverrideSchema
- auditLogQuerySchema
- directoryQuerySchema
- badgeAwardSchema
- thresholdHistorySchema
- updatePreferencesSchema
- historyQuerySchema
