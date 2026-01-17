# Arrakis Gateway (Rust)

A lightweight Discord Gateway using [Twilight](https://twilight.rs/) for the Arrakis Scaling Initiative.

## Overview

This gateway:
- Connects to Discord via WebSocket
- Receives events with minimal memory footprint (~40MB per 1k guilds)
- Routes events to NATS JetStream (production) or logs them (development)

## Prerequisites

### Install Rust Toolchain

```bash
# Install rustup (Rust toolchain manager)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Reload shell
source $HOME/.cargo/env

# Verify installation
rustc --version  # Should show 1.75+
cargo --version
```

### Development Tools (Optional)

```bash
# Auto-rebuild on changes
cargo install cargo-watch

# Faster linking (for development)
# macOS
brew install michaeleisel/zld/zld

# Linux
# Uses default linker, no action needed
```

## Quick Start

```bash
# Navigate to gateway directory
cd apps/gateway

# Copy environment file
cp .env.example .env

# Edit .env and add your Discord bot token
# DISCORD_TOKEN=your_token_here

# Build and run
cargo run

# Or with auto-reload during development
cargo watch -x run
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | - | Discord bot token |
| `SHARD_ID` | No | 0 | This shard's ID |
| `TOTAL_SHARDS` | No | 1 | Total shard count |
| `NATS_URL` | No | - | NATS server URL |
| `METRICS_PORT` | No | 9090 | Prometheus metrics port |
| `RUST_LOG` | No | info | Log level |

### Intents

The gateway uses minimal intents for token-gating:
- `GUILDS` - Guild create/delete events
- `GUILD_MEMBERS` - Member join/leave/update events

## Docker

```bash
# Build
docker build -t arrakis-gateway .

# Run
docker run -e DISCORD_TOKEN=your_token arrakis-gateway
```

## Project Structure

```
apps/gateway/
├── Cargo.toml           # Dependencies
├── Dockerfile           # Multi-stage build
├── src/
│   ├── main.rs          # Entry point
│   ├── config.rs        # Configuration
│   └── events/
│       ├── mod.rs       # Module exports
│       └── serialize.rs # Event → JSON
├── config/
│   └── gateway.yaml     # Default config
└── README.md
```

## Memory Efficiency

Twilight vs discord.js at scale:

| Guilds | discord.js | Twilight |
|--------|------------|----------|
| 1,000 | ~200MB | ~40MB |
| 5,000 | ~500MB | ~100MB |
| 10,000 | ~1GB | ~200MB |

## Next Steps (Sprint S-4+)

1. NATS integration for event publishing
2. Shard pool management (25 shards per pod)
3. Prometheus metrics
4. Graceful shutdown handling
