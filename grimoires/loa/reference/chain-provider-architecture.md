# Chain Provider Architecture (Sprint 14-16)

> Demand-loaded reference (demoted from CLAUDE.md 2026-06-04 to cut always-loaded prefix). Read when working on `packages/adapters/chain`.

The chain provider system supports multiple modes for blockchain data queries:

## Provider Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `rpc` | Direct RPC calls via viem | Default, no API key needed |
| `dune_sim` | Dune Sim API exclusively | Best performance, requires API key |
| `hybrid` | Dune Sim with RPC fallback | Production recommended |

## Environment Variables

```bash
# Required for dune_sim/hybrid modes
DUNE_SIM_API_KEY=your_api_key

# Provider mode selection
CHAIN_PROVIDER=hybrid  # Options: rpc, dune_sim, hybrid

# Enable fallback to RPC (hybrid mode only)
CHAIN_PROVIDER_FALLBACK_ENABLED=true

# Chains that should always use RPC
CHAIN_PROVIDER_RPC_ONLY_CHAINS=80094  # If Dune Sim doesn't support Berachain
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/adapters/chain/dune-sim-client.ts` | Dune Sim API client |
| `packages/adapters/chain/hybrid-provider.ts` | Hybrid provider with fallback |
| `packages/adapters/chain/provider-factory.ts` | Factory for provider creation |
| `packages/adapters/chain/config.ts` | Configuration loader |
| `packages/core/ports/chain-provider.ts` | IChainProvider interface |

## Usage

```typescript
import { createChainProvider } from '@freeside/adapters/chain';

const { provider, mode } = createChainProvider(logger);

// Standard IChainProvider methods
const balance = await provider.getBalance(chainId, address, token);
const owns = await provider.ownsNFT(chainId, address, collection);

// Dune Sim exclusive methods (optional)
if (provider.getBalanceWithUSD) {
  const { balance, priceUsd, valueUsd } = await provider.getBalanceWithUSD(chainId, address, token);
}
if (provider.getActivity) {
  const { activities } = await provider.getActivity(address, { limit: 10 });
}
```

## Migration Runbook

See `grimoires/loa/deployment/dune-sim-runbook.md` for:
- Pre-migration checklist
- Rollout procedure (staging -> production)
- Verification steps
- Rollback procedure
- Troubleshooting guide
