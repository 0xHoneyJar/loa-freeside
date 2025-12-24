# Directory Structure

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2)

```
arrakis/
├── .beads/                    # Beads issue tracking
├── .claude/                   # Loa framework (System Zone)
│   ├── agents/
│   ├── commands/
│   ├── protocols/
│   ├── scripts/
│   └── skills/
├── app/                       # (Empty/stub)
├── docs/                      # Project documentation
│   ├── audits/
│   ├── data/
│   ├── deployment/
│   └── research/
├── loa-grimoire/              # Loa State Zone
│   ├── a2a/
│   │   └── trajectory/
│   ├── analytics/
│   ├── context/
│   └── reality/
└── sietch-service/            # Main Application
    ├── deploy/                # Deployment configs
    │   ├── configs/
    │   ├── monitoring/
    │   └── scripts/
    ├── docs/                  # Service-specific docs
    │   ├── a2a/               # Sprint feedback
    │   ├── community/
    │   ├── deployment/
    │   ├── handover/
    │   └── operations/
    ├── src/                   # Source code
    │   ├── api/               # REST API
    │   │   └── handlers/
    │   ├── db/                # Database layer
    │   │   └── migrations/    # 6 migrations (001-006)
    │   ├── discord/           # Discord bot
    │   │   ├── commands/      # 14 commands
    │   │   ├── embeds/        # 7 embed builders
    │   │   └── interactions/  # 3 interaction handlers
    │   ├── services/          # Business logic (19 services)
    │   ├── trigger/           # Scheduled tasks (5 tasks)
    │   ├── types/             # TypeScript definitions
    │   └── utils/             # Utilities
    ├── tests/                 # Test suites
    │   ├── integration/
    │   └── unit/
    └── trigger/               # trigger.dev config
```

## Key Counts

| Component | Count |
|-----------|-------|
| Services | 19 |
| Discord Commands | 14 |
| Database Migrations | 6 |
| Trigger Tasks | 5 |
| Discord Embeds | 7 |
| Discord Interactions | 3 |
