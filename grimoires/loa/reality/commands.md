# Commands

> Generated: 2026-02-13 | Git SHA: 39be5b7

## Discord Slash Commands (themes/sietch/src/discord/commands/)

**User Commands:**
- `/profile view [nym]` — View member profile
- `/profile edit` — Edit profile via DM wizard
- `/badges` — View score badges
- `/stats` / `/score` — Personal statistics / conviction score
- `/alerts` — Manage notification preferences
- `/position` — Leaderboard position
- `/directory` — Browse member directory
- `/leaderboard` — Conviction score leaderboard
- `/naib` — Naib council info
- `/water-share` — Water sharing utility
- `/status` — Linked platforms/wallets
- `/onboard` — Start onboarding wizard
- `/verify` — Link wallet (EIP-191)
- `/register-waitlist` — Eligibility waitlist

**Admin Commands:**
- `/admin-badge` — Award badges (admin)
- `/admin-stats` — Analytics dashboard (admin)
- `/admin-takeover` — Account takeover (admin)
- `/admin-migrate` — Data migration (admin)
- `/simulation` — QA sandbox commands

**Interactions:** Button handlers for alerts, directory nav, leaderboard pagination, profile edit modals.

## Telegram Commands (themes/sietch/src/telegram/commands/)

- `/start` — Welcome and introduction
- `/verify` — Wallet link via Collab.Land
- `/score` — Conviction score
- `/status` — Linked platforms
- `/leaderboard` — Community rankings
- `/help` — Available commands
- `/refresh` — Refresh score data
- `/unlink` — Disconnect wallet
- `/alerts` — Notification settings

## Gaib CLI (packages/cli/src/commands/)

**Auth:** `gaib auth login|logout|whoami`

**User Management:** `gaib user create|ls|show|set|on|off|rm|passwd|access|grant|revoke`

**Sandbox:** `gaib sandbox new|ls|status|rm|env|link|unlink`

**Server IaC:**
- `gaib server init|plan|diff|apply|destroy|teardown`
- `gaib server workspace ls|new|use|show|rm`
- `gaib server state ls|show|rm|mv|pull`
- `gaib server locks|unlock`
- `gaib server theme ls|info`
