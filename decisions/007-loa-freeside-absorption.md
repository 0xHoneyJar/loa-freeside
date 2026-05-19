# ADR-007: loa-freeside as Dual-Concern Ecosystem Parent (RFC #207 Absorption)

**Status**: Proposed
**Date**: 2026-05-18
**Context**: RFC #207, vault doctrine `loa-freeside-as-ecosystem-parent`, Loa #452 L1-L5 pattern, cycle 2026-05-18 design session

## Context

`loa-freeside` today is a thick multi-tenant SaaS — 47 archived cycles, `next_sprint_number: 396`, pnpm monorepo with `apps/` (Rust Discord gateway, ingestor, worker) + `packages/` (cli/gaib, core, adapters, routes, services, sandbox, shared) + sites/themes/infrastructure/, 80+ Express routes, 20 Terraform modules. The vertical-platform concern (Score, ledger, conviction, billing) is real and load-bearing.

Separately, the `freeside-*` module network has reached ~5 first-class modules (storage, sonar, mint, activities, cli) + several adjacent (worlds, score, ruggy, identity, mediums, characters). Cross-repo composition is no longer hypothetical. The substrate for declaring and aggregating modules exists at 80% form: `construct-beacon` doctrine pack + `@0xhoneyjar/beacon-schema` (BeaconV2) + `freeside-mcp-gateway` federation router at `mcp.0xhoneyjar.xyz/{slug}` with per-tenant rows in `src/tenants.ts`.

The friction: cross-repo agent reasoning currently has no canonical home. Modules need to be definitive about what they ARE / what they ARE NOT / how they compose, and that declaration needs to be machine-readable and agent-callable. `loa-dixie` is NOT the answer (Layer-5 Oracle product consuming Layers 1-4 per its own architecture). The natural home is a registry + beacon aggregator + ecosystem CLI co-located with the substrate.

Two options were considered:

1. **Split**: create thin `loa-freeside-meta` as ecosystem-parent analog to `loa-constructs`
2. **Absorb**: extend `loa-freeside` to be BOTH vertical platform AND ecosystem parent, workspace-firewalled

Option 2 was chosen. Rationale below.

## Decision

`loa-freeside` becomes a **dual-concern repository**:

1. **Freeside the platform** — the vertical-SaaS substrate (current scope): Discord gateway, ingestor, worker, sietch theme, Score, ledger, conviction, Stripe/x402, `infrastructure/terraform/`, gaib IaC CLI
2. **Freeside the network** — the meta-registry for the `freeside-*` module ecosystem (new scope): module registry, BeaconV3 schema, MCP federation gateway, ecosystem CLI

The two concerns share a repository but **not** a release cycle, a beads ledger, a grimoire, or a versioning surface.

This ADR locks the following sub-decisions.

### D-1. Workspace structure

New top-level directories created in this repo:

```
loa-freeside/
├── apps/
│   ├── gateway/                  # existing — Rust Discord gateway (PLATFORM)
│   ├── mcp-gateway/              # NEW — TS MCP federation router (NETWORK, absorbed from freeside-mcp-gateway)
│   ├── ingestor/                 # existing (PLATFORM)
│   └── worker/                   # existing (PLATFORM)
├── packages/
│   ├── cli/                      # existing — @freeside/cli (gaib IaC, PLATFORM)
│   ├── freeside-cli/             # NEW — @freeside/freeside-cli (ecosystem CLI, NETWORK; PR #178 slot)
│   ├── freeside-registry/        # NEW — beacon aggregator + federation manifest server (NETWORK)
│   ├── beacon-schema/            # NEW — BeaconV3 sealed schema (NETWORK, moved from freeside-mcp-gateway/packages/)
│   ├── core/                     # existing (PLATFORM)
│   ├── adapters/                 # existing (PLATFORM)
│   ├── routes/                   # existing (PLATFORM)
│   ├── services/                 # existing (PLATFORM)
│   ├── sandbox/                  # existing (PLATFORM)
│   └── shared/                   # existing (cross-domain)
├── grimoires/
│   ├── freeside-platform/        # NEW — vertical-platform cycles only
│   └── freeside-network/         # NEW — ecosystem-registry cycles only
├── infrastructure/terraform/     # existing (PLATFORM)
└── decisions/                    # existing — this ADR lands here
```

### D-2. Naming

Per cycle 2026-05-18 design decision:

- **Registry package**: `freeside-registry` (parallels `loa-constructs/registry.yaml`). NOT `freeside-network` (overloaded), NOT `freeside-ecosystem` (heavier, not in prior artifacts).
- **Ecosystem CLI package name**: `@freeside/freeside-cli` (doubled `freeside`) — disambiguates from `@freeside/cli` (existing gaib IaC). Per absorption design memory.
- **Grimoire dirs**: `freeside-platform/` and `freeside-network/` — explicit zone names matching the dual-concern split.

### D-3. Boundary rules (the workspace firewall)

The two concerns share a repo but discipline prevents conceptual leak:

| Rule | Mechanism |
|------|-----------|
| Beads ledger separation | Every issue tagged `domain: platform` OR `domain: network` from day 1. No cross-domain bead. |
| Cycle ledger separation | Cycles ledger (`grimoires/loa/ledger.json`) gains a `domain` field per cycle entry. Platform and network cycles increment independently. |
| Grimoire separation | `grimoires/freeside-platform/` and `grimoires/freeside-network/` are sibling dirs. Cycle artifacts (PRD, SDD, sprint, etc.) land under exactly one. |
| Versioning independence | Each workspace package versions independently. Platform packages (`@freeside/{cli,core,adapters,sandbox,worker,ingestor,nats-schemas}`) and network packages (`@freeside/{freeside-cli,freeside-registry,beacon-schema}`) ship without entangling release cycles. |
| Commit-message convention | Conventional-commit scope must be either `platform/<x>`, `network/<x>`, or `shared/<x>`. No bare commits crossing the boundary. |
| Cross-domain commits prohibited | A single PR/commit MUST NOT modify both `grimoires/freeside-platform/` and `grimoires/freeside-network/`. Same for cross-domain `packages/`. Enforced via CODEOWNERS + PR-check script (deliverable in a follow-up cycle). |

### D-4. BeaconV3 schema

BeaconV3 extends BeaconV2 with four NEW required fields per module's `beacon.yaml`:

```yaml
# existing V2 fields (preserved)
slug:
upstream:
auth:
authHeader:
access:        # open | allowlist | api-key | x402
visibility:    # public | internal | unlisted
capabilities:  { tools, resources, prompts }
pricing:
owner:

# NEW V3 boundary-declaration fields
is:                    # definitive scope statement
  one_liner: "..."
  scope: [...]
is_not:                # explicit anti-scope (anti-bloat boundary)
  - "Does NOT do X"
  - "Does NOT do Y"
composes_with:         # sibling references — uses construct-honeycomb-substrate Tag names as port ABI
  freeside-sonar:
    role: "..."
    tag: SonarPort     # honeycomb-substrate canonical Tag
  freeside-storage:
    role: "..."
    tag: StoragePort
acvp_invariants:       # verifiability discipline (per ACVP doctrine)
  - hash_chain: ...
  - event_completeness: ...
  - schema_enforcement: ...
sealed_schemas:        # paths into module's packages/protocol/
  - ...
cycle_state:           # honest maturity signal
  status: candidate | active | mature | sunset
```

**Honeycomb-Tag-as-port-ABI lock** (the load-bearing insight): `construct-honeycomb-substrate` ships canonical Tags. `freeside-*` modules ship Layer implementations. BeaconV3 `composes_with` references Tag names. Two modules that claim to compose either both speak the same Tag (yes — port-compatible) or they don't (no — mismatch detected by `loa freeside doctor`). Module composition becomes type-checkable at the protocol level.

**Migration window**: V3 is REQUIRED for new modules. Existing V2 broadcasters (`score-mibera`, `construct-mibera-codex`) migrate as part of their next regular cycle — not in a forced sweep. `freeside-inventory` ships as the first born-V3-compliant module.

### D-5. Federation manifest endpoint

`packages/freeside-registry/` exposes `/federation.json` at the gateway origin (`freeside.0xhoneyjar.xyz/federation.json` or successor URL). Returns compact aggregation of every registered module's `slug + one_liner + is_not` per the existing `RAW_TENANTS` registry shape. Cached + refreshed alongside the existing `beacon-resolver.ts` 5-minute cycle. Schema-validated against BeaconV3.

**Token budget**: ~50 tokens × ~12 modules ≈ 600 tokens per SessionStart fetch. Full beacon detail loads on-demand via `freeside.inspectModule(<slug>)` MCP tool — kept separate to avoid context bloat as the ecosystem grows.

This endpoint is the discrete deliverable flagged in RFC #207's comment thread as step 6.5 of the migration path.

### D-6. CLI surface (operator-facing)

`loa freeside <verb>` CLI verbs ship in `packages/freeside-cli/`:

| Verb | Purpose | Initial cycle |
|------|---------|---------------|
| `loa freeside doctor` | Audit all `freeside-*` modules against beacon schema; compliance report | Cycle of this absorption |
| `loa freeside list` | Show registered modules with one-liners | Cycle of this absorption |
| `loa freeside inspect <slug>` | Show full beacon for a module | Cycle of this absorption |
| `loa freeside new <slug>` | Scaffold new module from `freeside-base` template | **DEFERRED** — manual `freeside-base` clone-and-rename until 3+ modules built; tiny-team posture |
| `loa freeside install <slug>` | Install substrate-runtime modules locally | Future cycle |

CLI verbs feed into existing `construct-freeside` skills:

- `reading-cli-telemetry` — consumes CLI output
- `reading-registry` — knows where the registry lives
- `coordinating-cutover` — uses CLI for migrations

### D-7. L5 ambient agent presence (operator-private experiment)

Per Loa #452 L5 doctrine ("protocols ambient by default, not on mention"):

- SessionStart hook at `~/.claude/hooks/session-start/loa-freeside-ambient.sh` fetches `freeside.0xhoneyjar.xyz/federation.json`
- Every Loa session knows every `freeside-*` module's `slug + one_liner + is_not` as ambient context
- On-demand MCP tool `freeside.inspectModule(<slug>)` for full beacon detail
- The `is_not` field is load-bearing for ambient — keeps agents from misrouting requests

**Scope**: Operator-private experiment for 2-4 weeks. Promote to org-wide opt-in via repo `CLAUDE.md` flag ONLY after token-cost + boundary-clarity confirmed in real session usage. Do not promote until empirical tail captures: did context bloat? did module misrouting drop? did the `is_not` field actually prevent specific incidents?

## Rationale

### Why absorb (not split)

- **Co-ownership.** `loa-freeside` is co-owned with Jani. The absorption is half-implied by existing direction (PR #178 `packages/freeside-cli/` namespace stake, PR #185 `@arrakis → @freeside` rename precondition, #191 score-vault contracts repo, cycle-048 World Container Hosting PRD). The doctrine ratifies what the repo has been quietly demanding.
- **Hexagonal lock requires co-location.** `construct-honeycomb-substrate` Tags are the port ABI for BeaconV3 `composes_with`. The schema package and the registry both reference Honeycomb Tags. Splitting into a separate `loa-freeside-meta` would force cross-repo type-resolution at validation time. Co-location keeps the type chain inside one repo.
- **The asymmetry with loa-constructs is doctrinal, not accidental.** loa-constructs distributes injectable expertise (artifacts you load). loa-freeside distributes deployed substrate (services you run). The two parents have different shapes because they have different distribution models.

### Why workspace-firewall (not unified scope)

- **Conceptual collapse is the operator-named risk.** "Freeside the platform" and "freeside the network" being conflated in commits, docs, beads tickets, cycle plans is the structural-collapse mode this ADR is designed to prevent.
- **Release cadence differs.** Platform releases are gated by terraform applies, Discord bot deployments, sietch theme stability. Network releases are gated by beacon schema bumps and ecosystem coordination. Entangling them produces release-blocking dependencies that don't reflect real coupling.

### Why BeaconV3 (not BeaconV2 + sidecar)

- **Two sources of truth = drift.** Shipping V3 as a sibling extension to V2 produces two registries to keep in sync. Bumping the schema version forces migration discipline and surfaces stale broadcasters.
- **The `is_not` field is the discipline-forcing addition.** Modules MUST articulate what they refuse to do. This forces module authors to think about boundaries before shipping, not after.

### Why operator-private L5 experiment (not org-wide rollout)

- **Token cost is unverified at scale.** 600 tokens × 12 modules is acceptable today. At 50 modules it's 2,500 tokens — non-trivial per session. Empirical data from operator's own sessions decides the rollout posture.
- **The `is_not` discipline is unproven in practice.** The theory: agents stop misrouting when they know what modules refuse. The practice: needs to be observed in real sessions before forcing on the team.

## Consequences

### Positive

- Cross-repo agent reasoning becomes a substrate property, not a hand-curated synthesis
- Module composition becomes type-checkable at the protocol level (Honeycomb Tag lock)
- New modules are forced to declare scope + anti-scope before shipping (boundary discipline)
- `loa-freeside` becomes the canonical parent identity for the `freeside-*` network
- Future engine-family parents (e.g., hypothetical `loa-worlds` for `world-*`) inherit the pattern

### Negative

- Increased repo surface area — anyone reading `loa-freeside` must understand the dual-concern split
- CODEOWNERS + PR-check enforcement is a follow-up cycle deliverable, not shipped here
- Lockfile churn on every cross-domain `package.json` change (npm/pnpm install resolves transitive deps across both lanes)
- `loa-freeside` README + CLAUDE.md must explicitly document both concerns; new contributors must read this ADR before touching any new code path

### Migration risks

- **PR #178 forward conflict.** PR #178 (DRAFT) stakes `packages/freeside-cli/` with namespace `@freeside/cli`. The companion namespace rename PR (this absorption's step 0) moves the existing `gaib` CLI to `@freeside/cli`. Resolution: #178's package name should become `@freeside/freeside-cli` per D-2 above.
- **CHANGELOG.md historical refs.** Old `@arrakis/*` package version references in CHANGELOG.md remain unmodified to preserve release-history accuracy. New entries use `@freeside/*`.
- **Existing V2 broadcasters.** `score-mibera` and `construct-mibera-codex` ship V2 beacons today. V3 migration happens in their next regular cycle, not as a forced sweep. Compatibility window: V3 schema accepts V2 broadcasts as `cycle_state.status: legacy`.

## Alternatives Considered

### A1. Split into `loa-freeside-meta` (thin analog)

Rejected. Would require:
- Cross-repo Honeycomb Tag resolution at validation time
- Coordinating two repos for every BeaconV3 change
- Convincing Jani to fork his attention across two repos

The cost of avoiding the dual-concern is higher than the cost of disciplined firewalling within one repo.

### A2. Retrofit `loa-dixie` into the registry role

Rejected. Dixie is Layer-5 Oracle PRODUCT per its own `docs/ecosystem-architecture.md`. It consumes Layers 1-4. Treating it as substrate violates its own layer doctrine. The registry needs to live where the substrate lives.

### A3. Ship BeaconV3 as separate `beacon-extra` sibling schema

Rejected. Two sources of truth produces drift. V3 must bump the schema version and force migration of the 2 existing V2 broadcasters (within their next cycle, not forced sweep).

### A4. Build the `loa freeside new <slug>` scaffolder in this cycle

Rejected. Two-person team. Deferring tooling until 3+ modules exist prevents premature pattern-locking. Manual `freeside-base` clone-and-rename is acceptable friction at current scale.

### A5. Promote L5 ambient to org-wide on day 1

Rejected. Token cost + boundary discipline are theory until proven in operator's own session usage. Empirical 2-4 week experiment before rollout.

## Implementation Sequencing

This ADR locks the structure. The implementation lands across multiple PRs in this order:

1. **PR-rename (open)**: `@arrakis/* → @freeside/*` namespace rename across the 7 existing packages. Pure mechanical. Precondition for all subsequent work.
2. **PR-adr (this PR)**: `decisions/007-loa-freeside-absorption.md` lands. Documents the structure before any new dirs.
3. **PR-workspace**: Create `apps/mcp-gateway/`, `packages/{freeside-cli,freeside-registry,beacon-schema}/`, `grimoires/freeside-{platform,network}/`. Each new dir gets a `README.md` describing its concern. No code yet.
4. **PR-absorb-gateway**: `git mv` `freeside-mcp-gateway/src/*` → `apps/mcp-gateway/src/*`, `freeside-mcp-gateway/packages/beacon-schema/*` → `packages/beacon-schema/*`. Preserves commit history.
5. **PR-construct-freeside-paths**: Update `construct-freeside` skill paths to reference new CLI locations.
6. **PR-beacon-v3**: Bump `packages/beacon-schema/` to V3 sealed schema. Add `is`, `is_not`, `composes_with`, `acvp_invariants`, `sealed_schemas`, `cycle_state` fields. Validators added.
7. **PR-federation-endpoint**: `packages/freeside-registry/` exposes `/federation.json` endpoint. Schema-validated. Cached at gateway origin.
8. **PR-cli-verbs**: `loa freeside doctor|list|inspect` ship in `packages/freeside-cli/`.
9. **PR-ambient-hook** (operator-private): `~/.claude/hooks/session-start/loa-freeside-ambient.sh` ships locally. NOT to org-wide settings.
10. **PR-source-repo-archival**: `freeside-mcp-gateway` and (if it exists as a separate repo) `freeside-cli` source repos get archived on GitHub, with README pointing at `loa-freeside`.

Steps 3-8 can land in parallel branches once step 1-2 are merged. Step 9 is operator-local. Step 10 is the final cleanup.

## References

### RFC + design lineage

- RFC #207 — `0xHoneyJar/loa-freeside`, opened 2026-05-18 (this absorption proposal)
- Loa #452 — `0xHoneyJar/loa`, closed 2026-03-24 — "First-Class Construct Support in Loa" (the L1-L5 layered pattern applied here)
- `loa-freeside-as-ecosystem-parent` vault doctrine page (operator-private; codifies the absorption decision)
- `loa-freeside-absorption-design` cross-session memory (2026-05-18 design session)
- `cross-repo-discipline-finding` cross-session memory (2026-05-18 recon: BeaconV2 substrate already exists at 80%)
- `railroad-vs-hygiene-discipline` cross-session memory (2026-05-18 operator-set classification)

### Adjacent doctrine

- `freeside-modules-as-installables` vault doctrine — the parent doctrine; this ADR codifies how the parent operates
- `loa-as-acvp-infrastructure` vault doctrine — sibling instance for the Loa framework layer
- `freeside-as-layered-station` vault doctrine — 3-plane lens + L1-L5 stack mapping
- `construct-domain-boundaries` vault doctrine — construct-DDD discipline; analog for freeside modules
- `agentic-cryptographically-verifiable-protocol` vault doctrine — 7-component substrate; BeaconV3's `acvp_invariants` field requires its conformance
- `no-handoffs-without-observability` vault thesis — beacon manifests are the observable surface for cross-repo handoffs
- `kaironic-time` vault doctrine — operator-paced; this absorption is operator-initiated, not chronos-driven

### Source repos being absorbed

- `freeside-mcp-gateway` — TS MCP federation router (`src/{app,auth,beacon-cache,beacon-resolver,credentials-resolver,tenants}.ts` + `packages/beacon-schema/`)
- `freeside-cli` source repo (if separate) OR `sprawl-world/scripts/freeside` bash CLI (per PR #178 description)

### Analog pattern

- `loa-constructs` — registry + Hono API + CLI installer (the thin-parent analog this doctrine mirrors)
