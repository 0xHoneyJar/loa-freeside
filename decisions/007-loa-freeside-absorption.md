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
| Cross-domain commits prohibited | A single PR/commit MUST NOT modify both `grimoires/freeside-platform/` and `grimoires/freeside-network/`. Same for cross-domain `packages/`. **Enforcement lands in the same PR that creates the new workspace dirs (PR-workspace, step 3 of sequencing)** — CODEOWNERS rules + a CI path-domain check + commit-scope validation MUST exist before any code lands under the new structure. See Implementation Sequencing step 3 for the concrete deliverables. |
| Hard validation of ledger separation | The "domain tag" approach in beads/ledger is enforced, not advisory: CI rejects any beads issue without a `domain:` label, rejects any cross-domain dependency (`blocked-by` crossing platform↔network), and rejects any cycle-ledger entry missing the `domain` field. This makes tag discipline equivalent to ledger separation without forcing two beads databases (addresses flatline SKP-002). |

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

### D-8. Federation manifest authorization + visibility (addresses flatline SKP-005)

`/federation.json` is intentionally agent-readable but MUST NOT leak internal modules, tenant names, infrastructure topology, or non-public pricing. The visibility model:

| `beacon.visibility` | Appears in `/federation.json` (public, unauthenticated) | Appears in authenticated `/federation/{tenant}.json` | Appears in `freeside.inspectModule(<slug>)` MCP tool |
|---------------------|---|---|---|
| `public` | YES | YES | YES |
| `unlisted` | NO | YES (if tenant has access) | YES (if tenant has access) |
| `internal` | NO | NO | YES (if caller has tenant scope claim) |

**Authentication model**:

- Public `/federation.json`: no auth. Returns ONLY `visibility: public` modules. Compact shape (`slug + one_liner + is_not`). Cache-friendly, CDN-eligible.
- Authenticated `/federation/{tenant}.json`: requires bearer token with `freeside:federation:read` scope AND tenant claim matching `{tenant}`. Returns `public + unlisted` modules.
- MCP tool `freeside.inspectModule(<slug>)`: requires bearer token with `freeside:beacon:inspect` scope. Tenant scope claim gates `internal` modules. Returns full beacon detail (NOT just compact).

**Redaction rules** (applied per-call, before serialization):

- `owner.email`, `owner.slack` → redacted in `/federation.json`, preserved in authenticated paths
- `pricing.contact_for_quote` URLs → redacted in `/federation.json`
- `upstream` URLs containing internal hostnames (e.g., `*.internal.thj`) → never appear in `/federation.json`; replaced with `null` in `unlisted` authenticated responses
- `acvp_invariants` with `private: true` → omitted from compact responses, preserved in `inspectModule`

**Cache partitioning**:

- Public manifest: shared cache, 5-minute TTL
- Authenticated manifests: per-tenant cache key, 5-minute TTL, NEVER shared
- The cache layer MUST refuse to serve an authenticated response from the public cache, even if the response content would happen to match

**Threat model**:

- A misconfigured `beacon.visibility: public` on an internal module leaks scope + anti-scope to anyone. Mitigation: `loa freeside doctor` warns on any beacon transitioning from `internal` → `public` in a single commit.
- A compromised bearer token leaks all `unlisted + internal` modules for a tenant. Mitigation: tokens scope-bounded, short-lived (1 hour default), audit log per `inspectModule` call.
- Aggregation attacks (calling `inspectModule` repeatedly to discover modules without authorization): rate-limited per token + per tenant.

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
3. **PR-workspace + firewall enforcement** (the boundary-protection PR): Create `apps/mcp-gateway/`, `packages/{freeside-cli,freeside-registry,beacon-schema}/`, `grimoires/freeside-{platform,network}/`. Each new dir gets a `README.md` describing its concern. **In the SAME PR**, land the workspace-firewall enforcement (addresses flatline SKP-001 CRITICAL):
   - `CODEOWNERS` rules mapping each new path to its concern's owner set (no cross-concern review approval allowed)
   - `.github/workflows/path-domain-check.yml` — CI job that fails PRs touching both `grimoires/freeside-platform/` AND `grimoires/freeside-network/`, OR touching cross-concern `packages/` (platform-only ↔ network-only) in a single commit
   - `.github/workflows/commit-scope-check.yml` — CI job that fails commits without scope `platform/<x>`, `network/<x>`, or `shared/<x>` in the conventional-commit message
   - `.github/workflows/ledger-domain-check.yml` — CI job that fails PRs introducing cycle-ledger entries without a `domain` field OR beads issues without a `domain:` label (addresses flatline SKP-002 enforcement gap)
   - `tools/check-beacon-domain.sh` (or similar) — pre-commit hook stub for local validation
   - No application code lands in this PR; only the structural dirs + enforcement scaffolding. This guarantees the highest-risk phase (workspace creation) cannot itself establish the cross-domain coupling the absorption is designed to prevent.
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

## Appendix A: BeaconV3 Normative Schema (addresses flatline SKP-003, SKP-004, IMP-011)

The flatline review correctly identified that D-4 makes a type-checkability CLAIM without supplying the schema rigor needed to substantiate it. This appendix is the normative spec.

### A.1 Field semantics

**`is`** (required object)
```yaml
is:
  one_liner: string             # ≤120 chars, single sentence
  scope:                        # 2-7 bullet points
    - string                    # each ≤100 chars
```

**`is_not`** (required array, min 2 entries)
```yaml
is_not:
  - string                      # each MUST start with "Does NOT", "Will NOT", or "Refuses to"
```
Validator rejects: empty array, single entry, entries that describe what the module DOES (negation of `is.scope` is the discipline-forcing test).

**`produces`** (optional array, defaults to empty — ADR-008 §D-3)
```yaml
produces:
  - belt: string                # lowercase-kebab belt name (e.g., wallet-scores)
    schema: string              # ≤500 chars; relative path (from building root) to the belt's JSON-schema
    description: string         # ≤200 chars; what the belt carries
```
The output belts a building emits. Capability-addressable discovery keys off these (e.g., "who produces `wallet-scores`?").

**`consumes`** (optional array, defaults to empty — ADR-008 §D-3)
```yaml
consumes:
  - from: string                # lowercase-kebab sibling building slug
    belt: string                # lowercase-kebab belt name read from that sibling
    tag: string                 # MUST be a fully-qualified Tag reference (see A.2)
    why: string                 # ≤200 chars; why this building reads the belt
```
The input belts a building reads from a sibling. Each `consumes` edge is directed (ADR-008 §D-3 — raw publishes, meaning consumes) and `tag`-locked to the sibling's port ABI. `produces`/`consumes` hard-replace the former undirected `composes_with` record.

**`acvp_invariants`** (required array, may be empty for layer-0 modules)
```yaml
acvp_invariants:
  - id: string                  # MUST match a known ACVP invariant ID (hash_chain, event_completeness, schema_enforcement, state_machine_totality, idempotency, monotonicity, audit_replay)
    scope: string               # what part of the module this invariant binds
    proof_artifact: string      # path (relative to module root) to test/proof binding the invariant
    private: boolean            # default false; if true, invariant omitted from public federation manifest
```

**`sealed_schemas`** (required array, may be empty)
```yaml
sealed_schemas:
  - path: string                # relative path to schema file in module's packages/protocol/
    hash: string                # sha256 of canonical-JSON of the schema; recomputed by validator on every install
    consumers:                  # which other modules/clients depend on this schema's stability
      - string
```

**`cycle_state`** (required object)
```yaml
cycle_state:
  status: enum                  # one of: candidate, active, mature, sunset, legacy
  since: ISO-8601 date          # when status entered current value
  next_review: ISO-8601 date    # when this status MUST be re-confirmed (max +180 days from `since`)
```

### A.2 Tag references (the Honeycomb-as-port-ABI lock made concrete)

Flatline SKP-004 correctly noted that name-equality is insufficient. V3 requires:

```
<TagName>@<version>+<schema_hash>
```

- `TagName`: the canonical Tag name from `construct-honeycomb-substrate/lib/ports/<TagName>.ts`
- `version`: semver of the Tag definition at the time of the `consumes` declaration
- `schema_hash`: sha256 of the Tag's port-interface signature (encoded as canonical TypeScript AST hash)

**Example**:
```yaml
consumes:
  - from: freeside-sonar
    belt: chain-events
    tag: SonarPort@2.1.0+a3f2c891d4
    why: "raw transfer/holding events the aggregator reads"
```

`loa freeside doctor` validates by:
1. Fetching the referenced module's beacon
2. Confirming the referenced module declares `SonarPort@2.1.0+a3f2c891d4` as a capability
3. Recomputing the schema_hash from the current `construct-honeycomb-substrate` Tag definition
4. **Failing if any of (name, version, schema_hash) mismatches**, including the case where the Tag exists with a different schema_hash (signals upstream Tag evolution that requires migration)

This eliminates the false-positive composition flagged by SKP-004.

### A.3 Validation lifecycle

| Trigger | Action | Failure mode |
|---------|--------|--------------|
| `loa freeside doctor` | Full schema + Tag resolution + composition check across all registered modules | Exit code 1; emits per-module finding list |
| PR-time CI in any `freeside-*` module repo | Validate the module's own `/.well-known/beacon.json` against the BeaconV3 JSON Schema | PR blocked until valid |
| `freeside-registry` boot | Reject module registration if beacon fails schema validation | Module not added to registry; alert |
| Module upgrade (any `consumes` reference changes) | Schema_hash recomputed for affected Tags; mismatch escalates to maintainer | Doctor lists `composition_drift` finding |

### A.4 Backward compatibility (V2 → V3 migration window)

Per D-4, the 2 known V2 broadcasters (`score-mibera`, `construct-mibera-codex`) ship V3-compliant beacons in their NEXT regular cycle. During the migration window:

- V3 validator accepts V2 broadcasts ONLY if `cycle_state.status: legacy` is implicit (registry auto-injects)
- V2 broadcasts surface a warning in `loa freeside doctor`: `<slug>: BeaconV2 detected, migrate to V3 by <next_review>`
- Once a module ships V3, downgrading to V2 is forbidden (cycle_state.status field is one-way after upgrade)

### A.5 Full JSON Schema reference

The canonical JSON Schema lands in `packages/beacon-schema/schema/beacon-v3.json` per Implementation Sequencing step 6 (PR-beacon-v3). The schema in this appendix is the human-readable spec; the JSON Schema file is the machine-enforceable artifact. Both MUST stay in sync; CI in `packages/beacon-schema/` validates the spec ↔ schema correspondence.
