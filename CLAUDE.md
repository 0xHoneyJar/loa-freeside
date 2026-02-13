@.claude/loa/CLAUDE.loa.md

# Project-Specific Instructions

> This file contains project-specific customizations that take precedence over the framework instructions.
> The framework instructions are loaded via the `@` import above.

## CRITICAL: Tool Enforcement Rules

**These rules are MANDATORY. Violations will result in incorrect behavior.**

### 1. Task Management: Use `br` (NOT `bd`)

```bash
# CORRECT - Use br (beads_rust)
br create --title "..." --type task
br ready
br update <id> --status in_progress
br close <id>
br sync

# WRONG - Never use bd
bd create ...  # DEPRECATED
bd list ...    # DEPRECATED
```

### 2. Code Search: Use `ck` (NOT `grep`)

```bash
# CORRECT - Use ck (seek) for all code search
ck "pattern" src/                    # Basic search
ck --sem "error handling" src/       # Semantic search
ck --lex "user authentication"       # Full-text search

# WRONG - Never use grep for code search
grep -r "pattern" src/  # DEPRECATED - use ck instead
rg "pattern" src/       # DEPRECATED - use ck instead
```

### 3. Goal Tracking: All PRD Goals MUST Have IDs

```markdown
## Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Enable parallel development | 2+ simultaneous PRs |
| G-2 | Reduce context window | -60% tokens |
```

Every goal in the PRD must have a `G-N` identifier for traceability.

---

## Chain Provider Architecture (Sprint 14-16)

The chain provider system supports multiple modes for blockchain data queries:

### Provider Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `rpc` | Direct RPC calls via viem | Default, no API key needed |
| `dune_sim` | Dune Sim API exclusively | Best performance, requires API key |
| `hybrid` | Dune Sim with RPC fallback | Production recommended |

### Environment Variables

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

### Key Files

| File | Purpose |
|------|---------|
| `packages/adapters/chain/dune-sim-client.ts` | Dune Sim API client |
| `packages/adapters/chain/hybrid-provider.ts` | Hybrid provider with fallback |
| `packages/adapters/chain/provider-factory.ts` | Factory for provider creation |
| `packages/adapters/chain/config.ts` | Configuration loader |
| `packages/core/ports/chain-provider.ts` | IChainProvider interface |

### Usage

```typescript
import { createChainProvider } from '@arrakis/adapters/chain';

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

### Migration Runbook

See `grimoires/loa/deployment/dune-sim-runbook.md` for:
- Pre-migration checklist
- Rollout procedure (staging -> production)
- Verification steps
- Rollback procedure
- Troubleshooting guide

## Agent Gateway — Capability Mesh (Cycle 019)

Per-model ensemble accounting, contract protocol negotiation, and fleet-wide observability.

### Per-Model Accounting

Ensemble requests produce a `model_breakdown` array with per-model cost attribution:

```typescript
import { computeEnsembleAccounting } from '@arrakis/adapters/agent';

const result = computeEnsembleAccounting(strategy, invocationResults);
// result.model_breakdown — per-model costs
// result.platform_cost_micro — platform budget only
// result.byok_cost_micro — BYOK (no budget charge)
// result.savings_micro — unused reservation capacity
```

### Provider Policy Configuration

Pool-to-provider routing is configurable via environment variable:

```bash
# Override default pool→provider mapping (JSON)
POOL_PROVIDER_HINTS='{"cheap":"openai","reasoning":"anthropic","architect":"anthropic"}'
```

### Capability Audit Events

Structured audit events emitted for every capability exercise:

| Event Type | When | Key Fields |
|-----------|------|------------|
| `pool_access` | Standard request | pool_id, access_level |
| `byok_usage` | BYOK key used | byok_provider |
| `ensemble_invocation` | Ensemble request | model_breakdown, ensemble_strategy |

### Key Files (Agent Gateway)

| File | Purpose |
|------|---------|
| `packages/adapters/agent/ensemble-accounting.ts` | Per-model cost decomposition |
| `packages/adapters/agent/request-lifecycle.ts` | State machine (RECEIVED→FINALIZED) |
| `packages/adapters/agent/redis-circuit-breaker.ts` | Fleet-wide Redis circuit breaker |
| `packages/adapters/agent/token-estimator.ts` | Calibrated token estimation |
| `packages/adapters/agent/capability-audit.ts` | Structured audit event emitter |
| `packages/adapters/agent/byok-proxy-handler.ts` | BYOK egress with key isolation |
| `packages/contracts/src/compatibility.ts` | Contract version negotiation |
| `infrastructure/terraform/agent-monitoring.tf` | CloudWatch dashboard + alarms |

## How This Works

1. Claude Code loads `@.claude/loa/CLAUDE.loa.md` first (framework instructions)
2. Then loads this file (project-specific instructions)
3. Instructions in this file **take precedence** over imported content
4. Framework updates modify `.claude/loa/CLAUDE.loa.md`, not this file

## Related Documentation

- `.claude/loa/CLAUDE.loa.md` - Framework-managed instructions (auto-updated)
- `.loa.config.yaml` - User configuration file
- `PROCESS.md` - Detailed workflow documentation
