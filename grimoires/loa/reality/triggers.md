# Triggers & Scheduled Tasks

> Generated: 2026-02-13 | Git SHA: 39be5b7

## Trigger.dev Scheduled Tasks (themes/sietch/src/trigger/)

| Task | Schedule | Description |
|------|----------|-------------|
| sync-eligibility | `0 */6 * * *` (every 6h) | Syncs BGT eligibility from chain via RLS proxy |
| activity-decay | `30 */6 * * *` (every 6h) | Applies 10% demurrage decay to activity balances |
| weekly-digest | `0 0 * * 1` (Monday 00:00) | Posts weekly community digest to Discord |
| boost-expiry | `5 0 * * *` (daily 00:05) | Deactivates expired boosts |
| badge-check | `0 0 * * *` (daily 00:00) | Awards automatic badges (tenure, activity) |
| weekly-reset | `0 0 * * 1` (Monday 00:00) | Resets weekly notification counters |
| telegram-session-cleanup | `15 * * * *` (hourly) | Cleans expired Telegram verification sessions |

## Discord Events (themes/sietch/src/services/discord/handlers/)

| Event | Handler | Action |
|-------|---------|--------|
| ready | EventHandler | Fetches guild, registers slash commands |
| interactionCreate | InteractionHandler | Routes slash commands and button clicks |
| guildMemberUpdate | EventHandler | Auto-onboarding on role assignment |
| messageCreate | ActivityTracker | Records activity points |
| messageReactionAdd | ActivityTracker | Records reaction points |

## Webhook Receivers

| Endpoint | Source | Verification |
|----------|--------|-------------|
| POST /api/billing/webhook | Paddle | Paddle signature |
| POST /api/billing/crypto/webhook | NOWPayments | HMAC-SHA512 |
| POST /telegram/webhook | Telegram | Secret token header |
| POST /internal/eligibility/sync | Trigger.dev | Internal API key |

## BullMQ Jobs (packages/adapters/agent/)

| Job | Description |
|-----|-------------|
| BudgetReaperJob | Reclaims expired agent budget reservations |
| StreamReconciliationWorker | Finalizes dropped SSE streams |
| ShadowSyncJob | Periodically syncs member state to shadow ledger |
