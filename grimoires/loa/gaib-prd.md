# Product Requirements Document: Gaib CLI

**Product**: Gaib - Discord Infrastructure as Code Platform
**Version**: 1.0.0
**Date**: 2026-01-19
**Status**: DRAFT
**Relationship**: Developer Platform layer on top of Arrakis Genesis

---

## Executive Summary

Gaib is a developer platform that brings Infrastructure-as-Code (IaC) paradigms to Discord server management. Similar to how Terraform manages cloud infrastructure and Vercel simplifies web deployments, Gaib enables declarative Discord server configuration with full lifecycle management.

The platform serves two distinct personas:
1. **Developers/DevOps**: Full IaC experience with `gaib init`, `plan`, `apply`, `destroy`
2. **Community Managers**: Accessible bot-driven UI for non-technical server setup

**Vision**: "Vercel for Discord" - Make Discord server infrastructure as manageable as cloud infrastructure.

**Relationship to Arrakis Genesis**: Gaib leverages the Arrakis Genesis infrastructure (AWS, ECS, S3, RDS) and extends it with a developer-facing CLI and API layer.

---

## 1. Problem Statement

### Current Pain Points

1. **Manual Server Setup**: Creating Discord servers requires repetitive manual configuration of channels, roles, permissions, and settings
2. **No Version Control**: Server configurations cannot be tracked, diffed, or rolled back
3. **Environment Inconsistency**: Dev/staging/production Discord servers drift from each other
4. **No Reproducibility**: Recreating a server from scratch requires extensive documentation and manual work
5. **Fragmented Tooling**: Bot developers lack standardized ways to provision test environments

### Why Now

- Discord has become critical infrastructure for Web3 communities, gaming, and developer communities
- The DevOps mindset (IaC, GitOps) is now mainstream
- Arrakis has production-grade infrastructure ready to leverage (AWS, Terraform, ECS workers)
- The "Sietch" theme demonstrates the value of templated server configurations
- Market demand for token-gated community tooling

### Primary Use Case: The Sietch Theme

The initial use case is recreating the BGT/Sietch Discord server configuration:
- Complete channel structure (announcements, support, general, etc.)
- Role hierarchy (Naib, Fedaykin, Fremen, etc.)
- Permission configurations
- Welcome messages and guides
- Bot integrations and webhooks

This serves as the reference implementation and test case for the theme system.

---

## 2. Goals & Success Metrics

### Business Objectives

| Objective | Metric | Target |
|-----------|--------|--------|
| Developer Adoption | GitHub stars, npm downloads | 1,000 stars in 6 months |
| Platform Stickiness | Servers managed via Gaib | 100 active servers |
| Community Growth | Discord community members | 500 developers |
| Revenue Foundation | Premium theme/feature usage | Foundation for monetization |

### Technical Objectives

| Objective | Metric | Target |
|-----------|--------|--------|
| Reliability | Successful apply operations | 99.9% success rate |
| Performance | Time to apply simple config | <30 seconds |
| State Integrity | State corruption incidents | Zero |
| API Coverage | Discord features supported | 90% of server config |

### Success Criteria (MVP)

- [ ] User can `gaib init` a new project
- [ ] User can `gaib plan` and see diff of proposed changes
- [ ] User can `gaib apply` to create/update a Discord server
- [ ] User can `gaib destroy` to tear down a server
- [ ] User can apply the "Sietch" theme to any server
- [ ] State is stored remotely in S3 with locking
- [ ] Workspaces support dev/staging/prod environments

---

## 3. User Personas

### Primary: Platform Engineer ("Alex")

**Background**: DevOps engineer managing Discord servers for a Web3 project
**Technical Level**: High - familiar with Terraform, AWS, CI/CD
**Goals**:
- Manage multiple Discord servers (dev, staging, prod) from one codebase
- Version control server configurations in git
- Automate server provisioning in CI/CD pipelines
- Quickly spin up/tear down test environments

**Jobs to be Done**:
- "When I need a new test server, I want to run one command and have it ready"
- "When server config changes, I want to review the diff before applying"
- "When something breaks, I want to rollback to a known good state"

### Secondary: Bot Developer ("Jordan")

**Background**: Building Discord bots, needs reproducible test environments
**Technical Level**: Medium - comfortable with CLI, less familiar with IaC
**Goals**:
- Quickly create test servers with specific configurations
- Reset servers to known state between test runs
- Share server configurations with team members

**Jobs to be Done**:
- "When I start a new bot project, I want a preconfigured test server"
- "When tests fail, I want to reset the server state easily"
- "When onboarding teammates, I want them to have identical environments"

### Tertiary: Community Manager ("Sam")

**Background**: Non-technical community lead setting up Discord for their project
**Technical Level**: Low - prefers UI, but willing to use simple CLI
**Goals**:
- Set up a professional Discord server without technical knowledge
- Apply branded themes consistently
- Get help from the bot for ongoing management

**Jobs to be Done**:
- "When launching my community, I want a beautiful server in minutes"
- "When I need to change something, I want the bot to guide me"
- "When things go wrong, I want easy recovery options"

---

## 4. Functional Requirements

### 4.1 Core CLI Commands

Following clig.dev best practices and Terraform-inspired semantics:

#### Initialization & Configuration

| Command | Description | Example |
|---------|-------------|---------|
| `gaib init` | Initialize new Gaib project in current directory | `gaib init --theme sietch` |
| `gaib login` | Authenticate with Discord/Arrakis | `gaib login` |
| `gaib config` | Manage configuration | `gaib config set discord.token $TOKEN` |

#### Planning & Execution

| Command | Description | Example |
|---------|-------------|---------|
| `gaib plan` | Show execution plan (diff preview) | `gaib plan` |
| `gaib apply` | Apply configuration to Discord | `gaib apply` or `gaib apply --auto-approve` |
| `gaib destroy` | Tear down managed resources | `gaib destroy` |
| `gaib refresh` | Sync state with actual Discord server | `gaib refresh` |

#### State Management

| Command | Description | Example |
|---------|-------------|---------|
| `gaib state list` | List resources in state | `gaib state list` |
| `gaib state show` | Show specific resource | `gaib state show discord_channel.general` |
| `gaib state pull` | Download remote state | `gaib state pull` |
| `gaib state push` | Upload local state | `gaib state push` |
| `gaib import` | Import existing server into state | `gaib import --server-id 123456789` |

#### Workspaces

| Command | Description | Example |
|---------|-------------|---------|
| `gaib workspace list` | List workspaces | `gaib workspace list` |
| `gaib workspace new` | Create workspace | `gaib workspace new staging` |
| `gaib workspace select` | Switch workspace | `gaib workspace select production` |
| `gaib workspace delete` | Delete workspace | `gaib workspace delete staging` |

#### Themes & Templates

| Command | Description | Example |
|---------|-------------|---------|
| `gaib theme list` | List available themes | `gaib theme list` |
| `gaib theme info` | Show theme details | `gaib theme info sietch` |
| `gaib theme apply` | Apply theme to config | `gaib theme apply sietch` |
| `gaib theme publish` | Publish custom theme to registry | `gaib theme publish ./my-theme` |

#### Utilities

| Command | Description | Example |
|---------|-------------|---------|
| `gaib validate` | Validate configuration syntax | `gaib validate` |
| `gaib fmt` | Format configuration files | `gaib fmt` |
| `gaib graph` | Generate dependency graph | `gaib graph \| dot -Tpng > graph.png` |
| `gaib output` | Show output values | `gaib output invite_url` |

### 4.2 Configuration Language

YAML-based declarative configuration (HCL considered but YAML more accessible):

```yaml
# gaib.yaml
version: "1.0"
name: "my-community"

# Backend configuration
backend:
  type: "s3"
  bucket: "arrakis-gaib-state"
  key: "servers/${workspace}/terraform.tfstate"
  region: "us-east-1"
  dynamodb_table: "arrakis-gaib-locks"

# Discord bot configuration
discord:
  bot_token: "${DISCORD_BOT_TOKEN}"

# Server configuration
server:
  name: "My Awesome Community"
  icon: "./assets/icon.png"

  # Roles (processed in order for hierarchy)
  roles:
    - name: "Admin"
      color: "#FF0000"
      permissions:
        administrator: true
      hoist: true

    - name: "Moderator"
      color: "#00FF00"
      permissions:
        manage_messages: true
        kick_members: true
      hoist: true

    - name: "Member"
      color: "#0000FF"
      permissions: {}

  # Categories and channels
  categories:
    - name: "Welcome"
      channels:
        - name: "rules"
          type: "text"
          topic: "Community rules and guidelines"
          permissions:
            - role: "@everyone"
              deny: ["send_messages"]

        - name: "introductions"
          type: "text"
          topic: "Introduce yourself!"

    - name: "General"
      channels:
        - name: "general"
          type: "text"

        - name: "voice-chat"
          type: "voice"
          user_limit: 10

# Outputs
outputs:
  invite_url:
    value: "${server.invite_url}"
  server_id:
    value: "${server.id}"
```

### 4.3 Theme System

Themes are reusable server configuration templates:

```yaml
# themes/sietch/theme.yaml
name: "sietch"
version: "1.0.0"
description: "The Honey Jar community theme - Dune-inspired"
author: "0xHoneyJar"
license: "MIT"

# Variables with defaults
variables:
  community_name:
    description: "Name of your community"
    default: "Sietch"
  primary_color:
    description: "Primary brand color"
    default: "#D4A84B"

# Server configuration template
server:
  name: "${var.community_name}"

  roles:
    - name: "Naib"
      color: "${var.primary_color}"
      permissions:
        administrator: true

    - name: "Fedaykin"
      color: "#8B7355"
      permissions:
        manage_messages: true

    - name: "Fremen"
      color: "#C4A35A"
      permissions: {}

  categories:
    - name: "THE SIETCH"
      channels:
        - name: "water-of-life"
          type: "text"
          topic: "Announcements from the Naib"
          permissions:
            - role: "@everyone"
              deny: ["send_messages"]

        - name: "stillsuit-fitting"
          type: "text"
          topic: "New member onboarding"

    - name: "GENERAL QUARTERS"
      channels:
        - name: "common-room"
          type: "text"
          topic: "General discussion"

        - name: "spice-trade"
          type: "text"
          topic: "Trading and commerce"

    - name: "SUPPORT"
      channels:
        - name: "water-discipline"
          type: "text"
          topic: "Get help from the community"

        - name: "maker-signs"
          type: "text"
          topic: "Report issues and bugs"
```

### 4.4 Discord Resource Coverage

| Resource | Create | Read | Update | Delete | Import |
|----------|--------|------|--------|--------|--------|
| Server Settings | | Y | Y | | Y |
| Roles | Y | Y | Y | Y | Y |
| Categories | Y | Y | Y | Y | Y |
| Text Channels | Y | Y | Y | Y | Y |
| Voice Channels | Y | Y | Y | Y | Y |
| Forum Channels | Y | Y | Y | Y | Y |
| Stage Channels | Y | Y | Y | Y | Y |
| Permissions | Y | Y | Y | Y | Y |
| Emojis | Y | Y | Y | Y | Y |
| Stickers | Y | Y | Y | Y | Y |
| Webhooks | Y | Y | Y | Y | Y |
| Welcome Screen | Y | Y | Y | | Y |
| Server Icon | | Y | Y | | Y |
| Server Banner | | Y | Y | | Y |

**Out of Scope for MVP**:
- Scheduled Events
- Auto-moderation Rules
- Audit Log Configuration
- Server Discovery Settings
- Community Server Features

### 4.5 State Management

#### Remote State Backend

```
┌─────────────────────────────────────────────────────────────┐
│                     S3 Bucket                                │
│  arrakis-gaib-state/                                        │
│  ├── servers/                                                │
│  │   ├── dev/terraform.tfstate                              │
│  │   ├── staging/terraform.tfstate                          │
│  │   └── production/terraform.tfstate                       │
│  └── global/                                                 │
│      └── themes.json                                         │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  DynamoDB Table                              │
│  arrakis-gaib-locks                                         │
│  ├── LockID (PK): servers/dev                               │
│  ├── Info: {"who": "user@...", "created": "..."}            │
│  └── ...                                                     │
└─────────────────────────────────────────────────────────────┘
```

#### State File Structure

```json
{
  "version": 1,
  "serial": 42,
  "lineage": "abc123-def456",
  "workspace": "production",
  "resources": [
    {
      "type": "discord_role",
      "name": "admin",
      "provider": "discord",
      "instances": [
        {
          "schema_version": 1,
          "attributes": {
            "id": "1234567890",
            "name": "Admin",
            "color": 16711680,
            "permissions": "8",
            "position": 5
          }
        }
      ]
    }
  ],
  "outputs": {
    "invite_url": {
      "value": "https://discord.gg/abc123",
      "sensitive": false
    }
  }
}
```

### 4.6 Plan Output Format

Following clig.dev principles for clear, actionable output:

```
$ gaib plan

gaib will perform the following actions:

  # discord_role.admin will be created
  + resource "discord_role" "admin" {
      + id          = (known after apply)
      + name        = "Admin"
      + color       = "#FF0000"
      + permissions = "administrator"
      + hoist       = true
    }

  # discord_channel.general will be updated in-place
  ~ resource "discord_channel" "general" {
        id    = "987654321"
        name  = "general"
      ~ topic = "Welcome!" -> "General discussion"
    }

  # discord_channel.old-channel will be destroyed
  - resource "discord_channel" "old-channel" {
      - id   = "111222333"
      - name = "old-channel"
    }

Plan: 1 to add, 1 to change, 1 to destroy.

Do you want to perform these actions?
  Gaib will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value:
```

---

## 5. Technical Requirements

### 5.1 Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          User's Machine                              │
│  ┌─────────────────┐                                                │
│  │    gaib CLI     │                                                │
│  │  (TypeScript)   │                                                │
│  └────────┬────────┘                                                │
└───────────┼─────────────────────────────────────────────────────────┘
            │
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        Arrakis Platform (AWS)                          │
│                                                                        │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐          │
│  │   S3 Bucket  │     │  DynamoDB    │     │    RDS       │          │
│  │ (State Store)│     │  (Locking)   │     │  (Metadata)  │          │
│  └──────────────┘     └──────────────┘     └──────────────┘          │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │                    ECS Fargate Cluster                     │        │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │        │
│  │  │ Gaib Worker │  │ Gaib Worker │  │ Gaib Worker │       │        │
│  │  │  (Apply)    │  │  (Destroy)  │  │  (Import)   │       │        │
│  │  └─────────────┘  └─────────────┘  └─────────────┘       │        │
│  └──────────────────────────────────────────────────────────┘        │
│                              │                                        │
│                              ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐        │
│  │                    Discord API                             │        │
│  │                (via Arrakis Bot Token)                     │        │
│  └──────────────────────────────────────────────────────────┘        │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Technology Stack

| Component | Technology | Rationale |
|-----------|------------|-----------|
| CLI Runtime | Node.js + TypeScript | Matches Arrakis codebase |
| CLI Framework | Commander.js + Inquirer | clig.dev compliant |
| Configuration | YAML (js-yaml) | Accessible, widely known |
| State Backend | S3 + DynamoDB | Terraform-proven pattern |
| Discord API | discord.js | Already in Arrakis stack |
| Output Formatting | Chalk + cli-table3 | Terminal aesthetics |
| Progress | ora + listr2 | Progress indicators |

### 5.3 Package Structure

```
packages/
├── gaib/                    # Main CLI package
│   ├── src/
│   │   ├── cli/            # Command implementations
│   │   │   ├── init.ts
│   │   │   ├── plan.ts
│   │   │   ├── apply.ts
│   │   │   ├── destroy.ts
│   │   │   └── ...
│   │   ├── core/           # Core logic
│   │   │   ├── config.ts   # Configuration loading
│   │   │   ├── state.ts    # State management
│   │   │   ├── diff.ts     # Plan generation
│   │   │   └── executor.ts # Apply/destroy execution
│   │   ├── providers/      # Resource providers
│   │   │   └── discord/
│   │   │       ├── role.ts
│   │   │       ├── channel.ts
│   │   │       └── ...
│   │   ├── backends/       # State backends
│   │   │   ├── s3.ts
│   │   │   ├── local.ts
│   │   │   └── types.ts
│   │   └── themes/         # Theme system
│   │       ├── loader.ts
│   │       ├── registry.ts
│   │       └── builtin/
│   │           └── sietch/
│   ├── bin/
│   │   └── gaib.ts         # CLI entry point
│   └── package.json
│
└── gaib-themes/            # Community themes (separate repo?)
    ├── sietch/
    ├── gaming/
    └── developer/
```

### 5.4 Non-Functional Requirements

| Requirement | Target | Measurement |
|-------------|--------|-------------|
| CLI Startup | <500ms | Time to first prompt |
| Plan Generation | <5s | For typical server config |
| Apply Operation | <60s | For full server setup |
| State Lock Timeout | 10 minutes | Auto-release stale locks |
| Concurrent Users | Unlimited | Per workspace locking |
| Offline Support | Graceful degradation | Cache theme metadata |

### 5.5 Security Requirements

| Requirement | Implementation |
|-------------|----------------|
| Token Storage | OS keychain (keytar) or encrypted file |
| State Encryption | S3 SSE-KMS with customer-managed keys |
| Audit Logging | CloudWatch Logs for all operations |
| Access Control | IAM roles for state bucket access |
| Secret Handling | Never log tokens, mask in output |

---

## 6. Scope & Prioritization

### MVP (v1.0)

| Feature | Priority | Status |
|---------|----------|--------|
| `gaib init` | P0 | Required |
| `gaib plan` | P0 | Required |
| `gaib apply` | P0 | Required |
| `gaib destroy` | P0 | Required |
| S3 Remote State | P0 | Required |
| DynamoDB Locking | P0 | Required |
| Workspace Support | P0 | Required |
| Sietch Theme | P0 | Required |
| Role Management | P0 | Required |
| Channel Management | P0 | Required |
| Permission Management | P0 | Required |
| `gaib import` | P1 | Important |
| `gaib validate` | P1 | Important |
| `--json` Output | P1 | Important |

### v1.1

| Feature | Priority |
|---------|----------|
| Theme Registry | P1 |
| Custom Theme Creation | P1 |
| Forum Channels | P1 |
| Emoji Management | P1 |
| Webhook Management | P2 |
| CI/CD Integration Guide | P2 |

### v2.0

| Feature | Priority |
|---------|----------|
| Web Dashboard | P2 |
| Bot-driven UI for Community Managers | P2 |
| Auto-moderation Rules | P2 |
| Server Templates Marketplace | P3 |
| Multi-bot Support | P3 |

### Out of Scope (Explicit)

- Message content management (not infrastructure)
- Member management (users, bans, kicks)
- Bot deployment (separate concern)
- Server boosting features
- Nitro-specific features

---

## 7. Risks & Dependencies

### Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Discord API Rate Limits | HIGH | MEDIUM | Implement backoff, batch operations |
| Discord API Changes | MEDIUM | HIGH | Abstract provider layer, version lock |
| State Corruption | LOW | CRITICAL | Checksums, backups, recovery commands |
| Concurrent Modification | MEDIUM | MEDIUM | DynamoDB locking, force-unlock command |

### Business Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Low Adoption | MEDIUM | HIGH | Focus on DX, active community engagement |
| Discord ToS Concerns | LOW | HIGH | Review ToS, document compliance |
| Competition | MEDIUM | MEDIUM | Differentiate with IaC approach |

### Dependencies

| Dependency | Type | Owner | Status |
|------------|------|-------|--------|
| Discord Bot Token | External | THJ | Available (bgt-sietch) |
| AWS Infrastructure | Internal | DevOps | Available (Sprint 95 complete) |
| S3 Bucket for State | Internal | DevOps | Needs creation |
| DynamoDB Table | Internal | DevOps | Needs creation |
| Arrakis Worker Integration | Internal | Backend | Planned |

---

## 8. User Experience Guidelines

### CLI Best Practices (clig.dev)

1. **Human-first output**: Default to readable output, `--json` for machines
2. **Progressive disclosure**: Simple by default, powerful when needed
3. **Helpful errors**: Suggest corrections, never just "Error"
4. **Confirm destructive actions**: `destroy` requires explicit confirmation
5. **Progress feedback**: Show spinners for operations >100ms
6. **Exit codes**: 0 for success, non-zero with meaningful codes

### Example Session

```bash
$ gaib init --theme sietch
Initializing Gaib project...

? What would you like to name your community? The Honey Jar
? Discord bot token: ********
? State backend: S3 (recommended)

Created gaib.yaml
Created .gaib/

Next steps:
  1. Review gaib.yaml and customize as needed
  2. Run 'gaib plan' to see what will be created
  3. Run 'gaib apply' to create your Discord server

$ gaib plan
Refreshing state...

gaib will perform the following actions:

  + discord_role.naib
  + discord_role.fedaykin
  + discord_role.fremen
  + discord_category.the_sietch
  + discord_channel.water_of_life
  + discord_channel.stillsuit_fitting
  + discord_category.general_quarters
  + discord_channel.common_room
  + discord_channel.spice_trade
  + discord_category.support
  + discord_channel.water_discipline
  + discord_channel.maker_signs

Plan: 12 to add, 0 to change, 0 to destroy.

$ gaib apply
Do you want to perform these actions?
  Only 'yes' will be accepted to approve.

  Enter a value: yes

discord_role.naib: Creating...
discord_role.naib: Created [id=1234567890]
discord_role.fedaykin: Creating...
...

Apply complete! Resources: 12 added, 0 changed, 0 destroyed.

Outputs:

invite_url = "https://discord.gg/honeybear"
server_id = "9876543210"

$ gaib workspace new staging
Created workspace "staging"
Switched to workspace "staging"

$ gaib destroy
Do you really want to destroy all resources?
  Gaib will destroy all managed resources in workspace "staging".

  There is no undo. Type "The Honey Jar staging" to confirm.

  Enter a value: The Honey Jar staging

discord_channel.maker_signs: Destroying...
...

Destroy complete! Resources: 12 destroyed.
```

---

## 9. Appendix

### A. Competitive Analysis

| Tool | Approach | Strengths | Weaknesses |
|------|----------|-----------|------------|
| Manual Discord | UI-based | Visual, intuitive | Not reproducible |
| Discord.js Scripts | Imperative | Flexible | No state tracking |
| Gaib | Declarative IaC | Reproducible, versioned | Learning curve |

### B. Discord API Considerations

- **Rate Limits**: 50 requests/second global, lower for some endpoints
- **Permissions Required**: MANAGE_GUILD, MANAGE_CHANNELS, MANAGE_ROLES
- **Bot vs User**: Bot tokens preferred for automation, user tokens for import

### C. Similar Tools Inspiration

- **Terraform**: State management, plan/apply workflow, provider model
- **Vercel CLI**: Developer experience, init flow, deployment feedback
- **Pulumi**: TypeScript configuration, preview, up/destroy

### D. Sietch Theme Full Specification

The Sietch theme represents the complete BGT community Discord structure:

**Roles** (in hierarchy order):
1. Naib (Administrator)
2. Fedaykin Elite
3. Fedaykin
4. Fremen
5. Wanderer
6. Initiate
7. Aspirant
8. Observer
9. Outsider

**Categories & Channels**:
1. THE SIETCH (announcements, onboarding)
2. GENERAL QUARTERS (general chat, trading)
3. SUPPORT (help, bug reports)
4. VOICE (voice channels)
5. BOT COMMANDS (bot interaction channels)

**Permissions**:
- Announcements: Read-only for @everyone
- Support: Thread creation enabled
- Voice: User limits based on tier

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-01-19 | Product Manager Agent | Initial PRD |

---

**Next Step**: `/architect` to create Software Design Document
