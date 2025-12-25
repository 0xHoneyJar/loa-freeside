# Environment Configuration Reality

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2)

## Required Environment Variables

### Chain Configuration
| Variable | Purpose | Example |
|----------|---------|---------|
| BERACHAIN_RPC_URLS | Comma-separated RPC URLs | `https://rpc1.berachain.com,https://rpc2.berachain.com` |
| BERACHAIN_RPC_URL | Single RPC URL (fallback) | `https://rpc.berachain.com` |
| BGT_ADDRESS | BGT token contract address | `0x...` |
| REWARD_VAULT_ADDRESSES | Comma-separated vault addresses | `0x...,0x...` |

### Trigger.dev Configuration
| Variable | Purpose |
|----------|---------|
| TRIGGER_PROJECT_ID | Trigger.dev project identifier |
| TRIGGER_SECRET_KEY | Trigger.dev API secret |

### Discord Configuration
| Variable | Purpose |
|----------|---------|
| DISCORD_BOT_TOKEN | Bot authentication token |
| DISCORD_GUILD_ID | Server (guild) ID |
| DISCORD_CHANNEL_THE_DOOR | Entry announcements channel |
| DISCORD_CHANNEL_CENSUS | Census channel |
| DISCORD_CHANNEL_SIETCH_LOUNGE | (Optional) Sietch lounge channel |
| DISCORD_CHANNEL_NAIB_COUNCIL | (Optional) Naib council channel |
| DISCORD_CHANNEL_INTRODUCTIONS | (Optional) Introductions channel |
| DISCORD_CHANNEL_CAVE_ENTRANCE | (Optional) Cave entrance channel (v2.1) |
| DISCORD_ROLE_NAIB | Naib role ID |
| DISCORD_ROLE_FEDAYKIN | Fedaykin role ID |
| DISCORD_ROLE_ONBOARDED | (Optional) Onboarded role |
| DISCORD_ROLE_ENGAGED | (Optional) Engaged role |
| DISCORD_ROLE_VETERAN | (Optional) Veteran role |
| DISCORD_ROLE_TRUSTED | (Optional) Trusted role |
| DISCORD_ROLE_FORMER_NAIB | (Optional) Former Naib role (v2.1) |
| DISCORD_ROLE_TAQWA | (Optional) Taqwa/waitlist role (v2.1) |

### API Configuration
| Variable | Default | Purpose |
|----------|---------|---------|
| API_PORT | 3000 | HTTP server port |
| API_HOST | 0.0.0.0 | HTTP server host |
| ADMIN_API_KEYS | - | Format: `key:name,key:name` |

### Database Configuration
| Variable | Default | Purpose |
|----------|---------|---------|
| DATABASE_PATH | ./data/sietch.db | SQLite database path |

### Logging Configuration
| Variable | Default | Purpose |
|----------|---------|---------|
| LOG_LEVEL | info | Pino log level |

### Grace Period Configuration
| Variable | Default | Purpose |
|----------|---------|---------|
| GRACE_PERIOD_HOURS | 24 | Hours before eligibility expires |

### Social Layer Configuration (v2.0)
| Variable | Default | Purpose |
|----------|---------|---------|
| ACTIVITY_DECAY_RATE | 0.1 | Decay rate per period (0-1) |
| ACTIVITY_DECAY_PERIOD_HOURS | 6 | Decay period in hours |
| ACTIVITY_POINTS_MESSAGE | 1 | Points per message |
| ACTIVITY_POINTS_REACTION_GIVEN | 1 | Points per reaction given |
| ACTIVITY_POINTS_REACTION_RECEIVED | 2 | Points per reaction received |
| NYM_CHANGE_COOLDOWN_DAYS | 30 | Days between nym changes |
| SOCIAL_LAYER_LAUNCH_DATE | - | (Optional) Launch date for OG badge |
| MAX_BIO_LENGTH | 160 | Max bio characters |
| AVATAR_DEFAULT_SIZE | 200 | Default avatar size (px) |
| AVATAR_GRID_WIDTH | 17 | Drunken bishop grid width |
| AVATAR_GRID_HEIGHT | 9 | Drunken bishop grid height |
| PFP_SIZE | 256 | Target PFP size (px) |
| MAX_PFP_SIZE_KB | 500 | Max PFP file size (KB) |
| WEBP_QUALITY | 80 | WebP compression quality |

## Configuration Validation

All environment variables are validated at startup using Zod schemas in `config.ts`:
- Invalid configuration fails fast with detailed error messages
- Type coercion for numbers (port, sizes, rates)
- Regex validation for Ethereum addresses
- Enum validation for log levels
