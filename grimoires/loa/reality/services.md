# Services

> Generated: 2026-02-13 | Git SHA: 39be5b7

## Agent Services (packages/adapters/agent/)

| Service | Description |
|---------|-------------|
| AgentGateway | Orchestrates agent request lifecycle (RECEIVED→RESERVED→EXECUTING→FINALIZED) |
| BudgetManager | Two-counter budget system (committed+reserved) with Lua atomicity |
| BudgetConfigProvider | Per-community and runtime pricing overrides via Redis |
| BudgetDriftMonitor | Discrepancy detection between estimated and actual costs |
| BudgetReaperJob | BullMQ job reclaiming expired reservations |
| AgentRateLimiter | Multi-dimensional rate limiting (community, user, channel, burst) |
| TierAccessMapper | Maps subscription tiers to access levels and model aliases |
| EnsembleMapper | Routes ensemble strategies (best_of_n, consensus, fallback) |
| LoaFinnClient | Client for loa-finn AI inference with JWT auth + streaming |
| JWTService | Signs/validates JWTs for S2S and user requests |
| BYOKManager | Bring-Your-Own-Key model deployments with daily quotas |
| BYOKProxyHandler | Proxies BYOK requests with auth and quota enforcement |
| StreamReconciliationWorker | BullMQ worker finalizing dropped SSE streams |
| Idempotency | Idempotency key management with deterministic hashing |

## Chain Services (packages/adapters/chain/)

| Service | Description |
|---------|-------------|
| NativeBlockchainReader | Direct RPC via viem (balance, NFT ownership) |
| DuneSimClient | Dune Sim API for token/NFT data with USD pricing |
| HybridChainProvider | Dune Sim with RPC fallback |
| ScoreServiceClient | Internal gRPC for ranked holders, rank lookups |
| ProviderFactory | Creates providers based on CHAIN_PROVIDER env mode |

## Coexistence Services (packages/adapters/coexistence/)

| Service | Description |
|---------|-------------|
| ShadowLedger | Divergence tracking between incumbent and Arrakis eligibility |
| IncumbentDetector | Detects Collab.Land/Matrica/Guild.xyz via heuristics |
| FeatureGate | Feature flags by verification tier |
| ParallelModeOrchestrator | Parallel incumbent + Arrakis eligibility checks |
| GlimpseManager | Read-only Arrakis preview during shadow mode |
| MigrationManager | Safe switchover with rollback support |

## Storage (packages/adapters/storage/)

| Service | Description |
|---------|-------------|
| DrizzleStorageAdapter | IStorageProvider via Drizzle ORM + PostgreSQL |
| TenantContext | Multi-tenancy RLS context management |

## Security (packages/adapters/security/)

| Service | Description |
|---------|-------------|
| VaultClient | HashiCorp Vault for OAuth token encryption/key rotation |
| MFAVerifier | TOTP + backup code verification |
| WalletVerification | EIP-191 signature verification |
| KillSwitch | Emergency circuit breaker |

## Other Adapters

| Service | Package | Description |
|---------|---------|-------------|
| SynthesisEngine | synthesis/ | Executes community manifests against Discord API |
| ThemeRegistry | themes/ | Theme registration, tier filtering, hot-reload |
| WizardEngine | wizard/ | 8-step community onboarding orchestration |
