@.claude/loa/CLAUDE.loa.md

# Project-Specific Instructions

> This file contains project-specific customizations that take precedence over the framework instructions.
> The framework instructions are loaded via the `@` import above.

<!-- straylight-governance (tools/governance-doctor.sh)
use_label: usable
read_state: validated
source_type: operator-authored
as_of: 2026-06-19
live_state_sot: >-
  Cell list + deployment_url + runtime_state are LIVE in
  packages/freeside-registry/registry.yaml (probe: `freeside-cli doctor --registry
  packages/freeside-registry/registry.yaml` — the bare command reads a stale bundled
  copy, see contract-and-sot-topology.md HAZARD-1). The topology prose below is
  ORIENTATION and drifts — for "is X deployed / extracted?" read the registry, never this file.
-->

## Repo Topology (READ FIRST)

`loa-freeside` is a **factory**. Two authority levels — do not conflate them:

- **BINDING (CI-enforced today)** — [ADR-007](decisions/007-loa-freeside-absorption.md), Status: **Accepted**. The platform/network firewall, commit scopes, beads domain labels. The "Hard rules" below are these. An agent MUST comply; CI blocks violations.
- **ORIENTATION (intent-bearing, not yet ratified)** — [ADR-008](decisions/008-freeside-as-factory.md), Status: **Proposed**. The factory model, building/belt vocabulary, marketplace framing, composition-direction DAG. An agent SHOULD apply this as the mental model, but it is not a CI-enforced constraint and may change before ratification (a follow-up operator-clarity session sequences building extractions).

The factory model below is ORIENTATION. The "Hard rules (enforced by CI)" subsection is BINDING.

### The factory model

Each capability is a **building**. **One building = one repository** — schema + runtime + docs live together (no separate "schema repo" / "runtime repo" split). Buildings compose into **products**. Customers order from a **marketplace**. The factory runs on the **platform substrate**.

| Part | What | Lives in |
|------|------|----------|
| **Platform** (the substrate) | ECS/AWS substrate + HTTP/DB/queues. Hosts building runtimes multi-tenant. Contains NO feature logic. | `apps/{gateway,worker,ingestor}/`, `infrastructure/terraform/`, `packages/{core,adapters,sandbox}/`, `themes/sietch/` (NOT yet substrate-only — still holds Discord/Telegram/world building logic; `worlds-api` extraction pending) |
| **Buildings** (capabilities — `freeside-X` repos) | Each is one repo: schema + runtime + docs. Has belts (consumes/publishes). **External repos**: `freeside-{sonar,storage,mint,activities,inventory,score,mediums}`. **Still in-monolith**: `billing` (no repo yet), `worlds` (`themes/sietch`). NOTE: `ledger-api` IS extracted (repo exists, scaffolded 2026-06-03, not yet deployed) — live state is in the registry. | External `*-api` repos OR currently in `themes/sietch/src/{discord,telegram,services}/`, `packages/services/` until extracted |
| **Network** (discovery + deploy layer) | BeaconV3 declaration contract, registry, MCP federation gateway, deployment CLI. | `apps/mcp-gateway/`, `packages/{beacon-schema,freeside-registry,freeside-cli}/`, `grimoires/freeside-network/` |

> **Honest current state** (live cell/deploy truth = `packages/freeside-registry/registry.yaml`, not this prose): `loa-freeside` is a thick monolith. The `*-api` cells exist as external repos but some logic still lives in the monolith — extraction is real pending work. **`ledger-api` is extracted** (scaffolded 2026-06-03, not yet deployed). **`billing` is genuinely not extracted** (logic in `themes/sietch/src/services/billing` + `packages/{core,adapters}/billing`); **`worlds-api` not extracted** (`themes/sietch`). The building model is the **direction**. See [ADR-008 §Current State vs Intended State](decisions/008-freeside-as-factory.md).

### Composition direction (the DAG)

Buildings connect via **belts** running ONE direction — determined by data semantic depth (raw → derived → integrated → presented), not by choice. `freeside-inventory` consumes `freeside-sonar` + `freeside-storage`; the reverse is impossible. When unsure which way an arrow points: closer-to-raw publishes, closer-to-meaning consumes. Bottleneck debugging = walk upstream on the belts. See [ADR-008 §D-3](decisions/008-freeside-as-factory.md).

### Marketplace vs factory

A **product** is a building (or building-group) presented for sale. Single-building products (`score API`), compound products (`community-management` = mediums + score + inventory). Customers order products; the platform resolves the building DAG. See [ADR-008 §D-5](decisions/008-freeside-as-factory.md).

### Plane ≠ Domain (orthogonal)

Per [ADR-008 §D-8](decisions/008-freeside-as-factory.md), the platform/network split (organizational firewall, CI-enforced) and the Contract/Construct/Execution planes (cognitive diagnostic, operator-applied) are **orthogonal axes**. A building spans all three planes inside its one repo. A change is classified along both axes — don't map plane→domain or plane→building, you'll get stuck.

### Hard rules (enforced by CI)

1. **No cross-domain PRs.** A single PR/commit MUST NOT modify both platform and network paths. `.github/workflows/path-domain-check.yml` blocks them.
2. **Commit scopes** use `platform/<x>`, `network/<x>`, or `shared/<x>`. Phase 1 enforcement is warn-only on missing scope, fail on cross-domain mismatch.
3. **Beads issues** must carry a `domain:platform`, `domain:network`, or `domain:shared` label.
4. **Cycle ledger entries** must include a `domain` field.
5. **No cross-domain `blocked-by` dependencies** in beads. Refactor through `shared/` scope or remove the dependency.
6. **Bootstrap bypass** (`adr-007-bootstrap` label) is SINGLE-USE for the original workspace-creation PR. Any subsequent use requires an ADR amendment + `decisions/EXCEPTIONS.md` entry.

### Local pre-commit hook

```bash
ln -s ../../tools/check-beacon-domain.sh .git/hooks/pre-commit
```

Mirrors the CI check; catches violations before push.

### Three orthogonal planes (mental model)

When working on a change, identify which **plane** it belongs to. A building spans all three inside its one repo:

- **Contract** — schemas, BeaconV3, NATS protocols, port interfaces (a building talks to a schema, never to another building directly)
- **Construct** — pure logic, state machines, intent generators (brains in vats; no I/O concerns)
- **Execution** — runtime, gateways, HTTP, RPC, infrastructure (the cyberdeck that catches Intents and fires real-world calls)

Bug source classification by plane is the daily diagnostic. See [ADR-008 §D-1](decisions/008-freeside-as-factory.md) for the full framing.

### Prefix-as-type-signature

| Prefix | Means |
|--------|-------|
| `loa-X` | Stack member (e.g., `loa-freeside` IS the L4 platform) |
| `freeside-X` | A **building** — a capability that deploys onto the freeside platform |
| `construct-X` | Agent-expertise pack (lives in Plane 2) |
| `world-X` | A community-specific deployed factory (a Workspace's building set) |

Products do not get a prefix — a product is a marketplace presentation of one or more `freeside-X` buildings. The namespace already encodes the layering. No new prefixes.

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

### 4. Ecosystem Navigation: Use `loa` (NOT raw grep / registry.yaml reads)

```bash
# CORRECT - reach for loa first when you need to know what is live or reachable
loa doctor              # live · health + discovery probe across registered buildings
loa caps                # live · capabilities reachable under the current grant (discovery == permission)
loa where <dest>        # live · cheapest invocation to reach a destination (the `cd` of the ecosystem)
loa census --graph      # live · the living building graph — set LOA_WORKSPACE=<cluster-root> first

# WRONG - do not hand-probe what loa already covers
grep -r "deployment_url" packages/freeside-registry/registry.yaml  # stale hand-authored field
gh api repos/.../contents/registry.yaml                            # reconstructing the map by hand
```

`loa` is the ecosystem launcher (npm-linked globally → `loa-cli/bin/loa.mjs`): grant-gated,
metacharacter-safe (Finn-sandbox safe), proof-of-run. Reach for it FIRST when navigating
building liveness, reachable capabilities, or the belt-DAG — instead of grepping packages or
hand-reading `registry.yaml`. This is the consumption-gradient floor ADR-011 §D-5 mandates:
the verified path must be the path of least resistance.

> All four are live today (`census --graph` since loa-cli#6 merged). `census --graph` needs
> `LOA_WORKSPACE=<cluster-root>` set first — `loa` reads only approved veve roots, never an
> arbitrary cwd: `LOA_WORKSPACE=~/Documents/GitHub loa census --graph` (reads 4 registries →
> buildings + constructs + worlds + zones). `ADR-011 §D-5` is the cited floor.

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
import { computeEnsembleAccounting } from '@freeside/adapters/agent';

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

## Construct Support

When `.run/construct-index.yaml` exists, constructs are installed and available:
- When a user mentions a construct name, check the index to resolve it
- Load the construct's persona file if available
- Scope to the construct's skill set and grimoire paths
- Use `construct-resolve.sh resolve <name>` for programmatic resolution
- Use `construct-resolve.sh compose <source> <target>` to check composition paths
