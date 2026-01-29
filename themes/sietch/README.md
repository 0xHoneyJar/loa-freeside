# Sietch Theme v3.0

A Dune-inspired Discord server theme for BGT token-gated communities with 9-tier Fremen hierarchy.

## Overview

The Sietch v3.0 theme implements "The Great Expansion" - a full 9-tier BGT-based community structure modeled after a Fremen sietch from Frank Herbert's Dune universe. Features include:

- **9-tier BGT hierarchy** - Progressive access based on BGT holdings (6.9 to 1111+ BGT)
- **Rank-based leadership** - Top 7 holders become Naib, Top 8-69 become Fedaykin
- **Special achievement roles** - Former Naib, Taqwa (waitlist), badge holders
- **Tiered channel access** - Higher tiers can see all lower tier channels (additive model)
- **Badge-gated channels** - Exclusive spaces for achievement holders

## Tier System

### BGT-Based Tiers (Holdings)

| Tier | Role | BGT Required | Meaning |
|------|------|--------------|---------|
| 9 | **Naib** | Top 7 by rank | Tribal leaders |
| 8 | **Fedaykin** | Top 8-69 by rank | Elite death commandos |
| 7 | **Usul** | 1111+ BGT | "The strength at the base" - Paul's sietch name |
| 6 | **Sayyadina** | 888+ BGT | Spiritual guides, near-leaders |
| 5 | **Mushtamal** | 690+ BGT | Inner garden of the sietch |
| 4 | **Sihaya** | 420+ BGT | "Desert spring" - Chani's secret name |
| 3 | **Qanat** | 222+ BGT | Underground water channels |
| 2 | **Ichwan** | 69+ BGT | Brotherhood (from Ichwan Bedwine) |
| 1 | **Hajra** | 6.9+ BGT | Journey of seeking |

### Special Roles

| Role | Purpose | Position |
|------|---------|----------|
| **Shai-Hulud** | Bot role (sandworm deity) | 99 |
| **Former Naib** | Previously held Naib seat | 55 |
| **Taqwa** | Waitlist registration | 50 |
| **Water Sharer** | Badge: can share with one member | 45 |
| **Engaged** | Badge: 5+ badges earned | 40 |
| **Veteran** | Badge: 90+ days tenure | 35 |

## Channel Structure

### Categories & Access

| Category | Access | Purpose |
|----------|--------|---------|
| **STILLSUIT** | Everyone (read-only) | Public info, announcements |
| **CAVE ENTRANCE** | Tier 1+ (Hajra read / Ichwan+ write) | Entry-level discussion |
| **THE DEPTHS** | Tier 3+ (Qanat read / Sihaya+ write) | Deeper discussions |
| **INNER SANCTUM** | Tier 6+ (Sayyadina+) | Elite member space |
| **FEDAYKIN COMMONS** | Top 69 only | Leadership discussion |
| **NAIB COUNCIL** | Top 7 only | Private Naib discussion |
| **NAIB ARCHIVES** | Naib + Former Naib | Historical discussions |
| **BADGE CHANNELS** | Badge holders | Achievement-gated spaces |
| **SUPPORT** | Fedaykin+ | Help and bot commands |

### Channel Details

#### STILLSUIT (Public)
- `#water-discipline` - Welcome message (Naib can post)
- `#announcements` - Important news from tribal council

#### CAVE ENTRANCE (Tier 1+)
- `#cave-entrance` - Entry-level discussion
- `cave-voices` - Voice channel (Ichwan+)

#### THE DEPTHS (Tier 3+)
- `#the-depths` - Deeper discussions
- `depth-voices` - Voice channel (Mushtamal+)

#### INNER SANCTUM (Tier 6+)
- `#inner-sanctum` - Elite discussions
- `sanctum-voices` - Voice channel (Usul+)

#### FEDAYKIN COMMONS (Top 69)
- `#general` - Main discussion
- `#spice` - Market insights and alpha
- `#water-shares` - Ideas and proposals
- `#introductions` - Introduce yourself (5min slowmode)
- `#census` - Live leaderboard (bot-only)
- `#the-door` - Join/leave notices (bot-only)
- `fedaykin-voices` - Voice channel

#### NAIB COUNCIL (Top 7)
- `#council-rock` - Private Naib discussion
- `council-chamber` - Voice channel (max 7 users)

#### NAIB ARCHIVES
- `#naib-archives` - Historical discussions

#### BADGE CHANNELS
- `#the-oasis` - Water Sharer exclusive
- `#deep-desert` - Engaged badge holders
- `#stillsuit-lounge` - Veteran members

#### SUPPORT
- `#support` - Get help
- `#bot-commands` - Interact with Shai-Hulud

## Variables

Customize the theme in your `gaib.yaml`:

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `community_name` | string | "Sietch" | Your community name |
| `color_naib` | color | #FFD700 | Gold - Top 7 leaders |
| `color_fedaykin` | color | #4169E1 | Blue - Elite warriors |
| `color_usul` | color | #9B59B6 | Purple - 1111+ BGT |
| `color_sayyadina` | color | #6610F2 | Indigo - 888+ BGT |
| `color_mushtamal` | color | #20C997 | Teal - 690+ BGT |
| `color_sihaya` | color | #28A745 | Green - 420+ BGT |
| `color_qanat` | color | #17A2B8 | Cyan - 222+ BGT |
| `color_ichwan` | color | #FD7E14 | Orange - 69+ BGT |
| `color_hajra` | color | #C2B280 | Sand - 6.9+ BGT |
| `color_former_naib` | color | #C0C0C0 | Silver |
| `color_taqwa` | color | #C2B280 | Sand |
| `color_water_sharer` | color | #00D4FF | Aqua |
| `color_engaged` | color | #28A745 | Green |
| `color_veteran` | color | #9B59B6 | Purple |
| `enable_voice` | boolean | true | Include voice channels |
| `enable_badge_channels` | boolean | true | Include badge-gated channels |

## Usage

```yaml
# gaib.yaml
version: "1"
name: my-sietch

theme:
  name: sietch
  variables:
    community_name: "The Honey Jar"
    color_naib: "#FFD700"
    color_fedaykin: "#4169E1"

# Optional: Override specific elements
channels:
  - name: trading-spice
    type: text
    category: "FEDAYKIN COMMONS"
    topic: "Trade your melange"
```

## Permission Model

The theme uses an **additive access model**:
- Higher tiers automatically see all lower tier channels
- Read-only tiers can view but not write to the tier above them
- Badge channels are separate from the tier system

### Voice Channel Access

| Channel | Can Connect | Can Speak |
|---------|-------------|-----------|
| `cave-voices` | Ichwan+ | Ichwan+ |
| `depth-voices` | Mushtamal+ | Mushtamal+ |
| `sanctum-voices` | Sayyadina+ (view), Usul+ (connect) | Usul+ |
| `fedaykin-voices` | Fedaykin+ | Fedaykin+ |
| `council-chamber` | Naib only | Naib only |

## Wallet Verification Setup

The Sietch theme uses an in-house EIP-191 wallet verification system for token gating. This replaces external services like Collab.Land with a native solution.

### Prerequisites

1. **PostgreSQL Database** - Required for verification session storage
2. **Public API URL** - Where users will be redirected for wallet signing

### Configuration

Add these to your `.env.local`:

```bash
# PostgreSQL connection (required)
DATABASE_URL=postgresql://user:password@localhost:5432/sietch

# Public URL for verification pages (required)
VERIFY_BASE_URL=https://api.your-domain.com
```

### How It Works

1. User runs `/verify start` in Discord (or `/verify` in Telegram)
2. Bot creates a verification session with unique nonce
3. User is sent a link to `{VERIFY_BASE_URL}/verify/{sessionId}`
4. User connects wallet and signs the nonce message (EIP-191)
5. Signature is verified server-side using viem
6. Wallet address is linked to user's profile
7. User can now be assigned tier roles based on BGT holdings

### Discord Commands

| Command | Description |
|---------|-------------|
| `/verify start` | Start wallet verification |
| `/verify status` | Check verification status |
| `/verify reset` | Reset and start over |

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/verify` | Start wallet verification |
| `/status` | Check verification status |

### Testing Checklist

- [ ] PostgreSQL running and accessible via `DATABASE_URL`
- [ ] `VERIFY_BASE_URL` points to accessible API server
- [ ] Verification page loads at `{VERIFY_BASE_URL}/verify/{sessionId}`
- [ ] MetaMask/WalletConnect can connect on verification page
- [ ] Signature verification succeeds
- [ ] Wallet appears in `/verify status` after completion

## File Structure

```
themes/sietch/
├── theme.yaml      # Theme manifest and variables
├── roles.yaml      # 15 role definitions
├── channels.yaml   # 9 categories, 22 channels
└── README.md       # This file
```

## References

- **PRD**: `grimoires/loa/prd.md` (Sietch v3.0 requirements)
- **Setup Guide**: `grimoires/pub/docs/DISCORD-SETUP-GUIDE.md`

## License

AGPL-3.0
