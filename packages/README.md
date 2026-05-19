# Packages

Workspace packages for the loa-freeside monorepo. Domain assignment per [ADR-007 §D-1](../decisions/007-loa-freeside-absorption.md) and the layered identity in [ADR-008](../decisions/008-freeside-as-layered-station.md). CI enforces the platform/network firewall on cross-domain commits.

## Platform domain (vertical-SaaS substrate)

| Package | Description |
|---------|-------------|
| `@freeside/cli` (`cli/`) | gaib IaC orchestrator — `gaib login\|sandbox\|server` |
| `@freeside/core` (`core/`) | Port interfaces + domain types (IChainProvider, IStorageProvider, IAgentGateway) |
| `@freeside/adapters` (`adapters/`) | 8 adapter modules — agent, chain, storage, synthesis, wizard, themes, security, coexistence |
| `@freeside/sandbox` (`sandbox/`) | Schema provisioning, event routing |
| `@freeside/nats-schemas` (`shared/nats-schemas/`) | Cross-language wire format (Zod + JSON) |
| `routes/` | Express route handlers (consumed by `themes/sietch/`) |
| `services/` | Service-layer business logic |
| `contracts/` | Smart contract bindings + ABI exports |
| `governance/` | Tier resolution, conviction scoring helpers |
| `ports/` | Domain port re-exports |
| `sdk-emergence/` | Emergence SDK |
| `security/` | Vault, kill-switch, MFA primitives |
| `synthesis/` | Synthesis worker queue plumbing |
| `telemetry/` | Tracing + metrics helpers |
| `types/` | Shared TypeScript types |
| `ui/` | Shared React UI components |
| `wizard/` | 8-step onboarding orchestrator |
| `worker/` | Background-worker domain logic |

## Network domain (ecosystem-parent surface)

| Package | Description |
|---------|-------------|
| `@freeside/beacon-schema` (`beacon-schema/`) | Sealed Effect Schema for V2 + V3 beacon contract (per [ADR-007 Appendix A](../decisions/007-loa-freeside-absorption.md)) |
| `@freeside/freeside-registry` (`freeside-registry/`) | L1 module registry + compact federation manifest builder |
| `@freeside/freeside-cli` (`freeside-cli/`) | Ecosystem CLI — `freeside-cli list\|inspect\|doctor` |

> **Companion app**: `apps/mcp-gateway/` (network) — TS MCP federation router that consumes the registry + beacon-schema packages.

## Mental model

- **Platform packages** = the substrate; hosts both first-party features (Score, ledger, conviction, billing) and deployed `freeside-*` modules
- **Network packages** = the protocol; makes deployed modules discoverable + composable via BeaconV3 + federation manifest

See [ADR-008 §D-3](../decisions/008-freeside-as-layered-station.md) for the full platform-vs-network framing.

## Package guidelines

1. **Domain assignment is mandatory.** Every new package MUST be classified as platform, network, or shared. Cross-domain commits are blocked by CI.
2. **Extract only when shared.** Don't create packages preemptively. If code is used in one consumer, leave it there.
3. **Clear boundaries.** Each package has a single responsibility.
4. **Proper versioning.** Use semantic versioning for breaking changes; platform and network packages version independently.
5. **Documentation.** Each package has its own README.
