@.claude/loa/CLAUDE.loa.md

# Project-Specific Instructions

> This file contains project-specific customizations that take precedence over the framework instructions.
> The framework instructions are loaded via the `@` import above.

## Repo Topology (READ FIRST)

`loa-freeside` is a **factory**. Two authority levels — do not conflate them:

- **BINDING (CI-enforced)** — [ADR-007](decisions/007-loa-freeside-absorption.md), Status: **Accepted** (ratified 2026-06-04). The platform/network firewall (the `path-domain-check` + the cross-domain `blocked-by` check) hard-fails CI today. Commit-scopes + beads-domain-labels are **warn-only (Phase 1)**, not yet teeth (`STRICT` defaults false). The "Hard rules" below detail which is which. An agent MUST comply with the firewall.
- **ORIENTATION (intent-bearing, not yet ratified)** — [ADR-008](decisions/008-freeside-as-factory.md), Status: **Proposed**. The factory model, building/belt vocabulary, marketplace framing, composition-direction DAG. An agent SHOULD apply this as the mental model, but it is not a CI-enforced constraint and may change before ratification (a follow-up operator-clarity session sequences building extractions).

The factory model below is ORIENTATION. The "Hard rules (enforced by CI)" subsection is BINDING.

### The factory model

Each capability is a **building**. **One building = one repository** — schema + runtime + docs live together (no separate "schema repo" / "runtime repo" split). Buildings compose into **products**. Customers order from a **marketplace**. The factory runs on the **platform substrate**.

| Part | What | Lives in |
|------|------|----------|
| **Platform** (the substrate) | ECS/AWS substrate + HTTP/DB/queues. Hosts building runtimes multi-tenant. **Intended** to contain no feature logic, but TODAY still hosts building logic pending extraction (~907 TS files tracked in `themes/sietch` — 618 under `src/` — plus ~10 in `packages/services`, as of 2026-06-05). | `apps/{gateway,worker,ingestor}/`, `infrastructure/terraform/`, `packages/{core,adapters,sandbox}/`, `themes/sietch/` (still hosts building logic; extraction to `worlds-api` pending) |
| **Buildings** (capabilities — `*-api` repos) | Each is one repo: schema + runtime + docs. Has belts (consumes/publishes). **Clean current naming is `X-api`** (the older `freeside-X` building name is deprecated; `freeside-*` now means platform tooling, see prefix table). **Registered buildings** (canonical, per `packages/freeside-registry/registry.yaml` — 9 slugs): `{activities,events,identity,inventory,mediums,mint,score,sonar,storage}-api`. **Repos exist but NOT yet registered / logic still in-monolith**: `ledger-api` (logic in `packages/services`), `worlds-api` (intended `themes/sietch` target, zero code refs yet). **Archived**: `quests-api`, `thj-api`, `universal-api`. (Corrected 2026-06-04: a same-session edit over-claimed ledger/worlds as active registered buildings; the registry is the canonical truth.) **Still in-monolith, intended for extraction**: `billing` (no repo yet) · `themes/sietch` → `worlds-api`. | External `*-api` repos OR currently in `themes/sietch/src/{discord,telegram,services}/`, `packages/services/` until extracted |
| **Network** — the `*-api` ecosystem (ADR-007 concern 2; "freeside-network" retired as the ecosystem name, but `network` stays the CI **domain label**) | BeaconV3 declaration contract, registry, MCP federation gateway, deployment CLI for the `*-api` buildings. `events` lives here; `coherence` belongs to this concern. | `apps/mcp-gateway/`, `packages/{beacon-schema,freeside-registry,freeside-cli,events}/`, `grimoires/freeside-network/` |

> **Honest current state** (naming corrected 2026-06-04 to match the territory): `loa-freeside` is a thick monolith. `score-api`, `mediums-api`, and `ledger-api` exist as external repos but some logic still lives in the monolith — extraction is real pending work (the score residue here should move to `score-api`; `themes/` → `worlds-api`). `billing` is not extracted at all (no repo). A legacy `freeside-score` repo also exists and appears superseded by `score-api` (flagged for the repo census). The **world** (`themes/sietch`, ~907 tracked TS files) is the LEAST-extracted mass: it re-implements badge/boost/billing/eligibility capabilities locally and consumes ZERO extracted siblings (no import or HTTP belt to `sonar`/`activities`/`storage`/`inventory`/`score`/`mediums`/`mint`-api) — `worlds-api` is unbuilt (not in the registry). So when reading the composition DAG, do NOT assume the world composes its siblings by reference; today it copies. The building model is the **direction**. See [ADR-008 §Current State vs Intended State](decisions/008-freeside-as-factory.md).

### Composition direction (the DAG)

Buildings connect via **belts** running ONE direction — determined by data semantic depth (raw → derived → integrated → presented), not by choice. `inventory-api` consumes `sonar-api` + `storage-api`; the reverse is impossible. When unsure which way an arrow points: closer-to-raw publishes, closer-to-meaning consumes. Bottleneck debugging = walk upstream on the belts. See [ADR-008 §D-3](decisions/008-freeside-as-factory.md).

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
| `*-api` (e.g. `sonar-api`) | A **building** — a capability service that deploys onto the platform. **This is the clean current building name.** |
| `freeside-X` | **Platform tooling / surface** (`freeside-dashboard`, `freeside-coherence`, `freeside-characters`). NOTE: `freeside-X` was the OLD building name; buildings are now `*-api`. ⚠ The standalone `0xHoneyJar/freeside-cli` and `0xHoneyJar/freeside-mcp-gateway` repos are **ARCHIVED (dead)** — the live implementations are in-monolith: `packages/freeside-cli` and `apps/mcp-gateway`. Don't reach for the dead repos. |
| `*-interface` | A **frontend / surface** (e.g. `hub-interface`, `moneycomb-interface`, `honey-interface`) |
| `construct-X` | Agent-expertise pack (lives in Plane 2) |
| `world-X` | A community-specific deployed factory / world (e.g. `world-sprawl`, `world-mibera`, `world-apdao`) |

Products do not get a prefix — a product is a marketplace presentation of one or more `*-api` buildings. The namespace already encodes the layering (`loa-` stack · `*-api` building · `world-` world · `*-interface` surface · `construct-` expertise).

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

## Subsystem reference (load on demand)

Detailed subsystem references demoted from the always-loaded prefix (2026-06-04 cache-tax trim — content preserved verbatim). Read the file when working in that subsystem:

- **Chain Provider Architecture** — rpc / dune_sim / hybrid modes, env vars, key files, usage (`packages/adapters/chain`) → `grimoires/loa/reference/chain-provider-architecture.md`
- **Agent Gateway — Capability Mesh** — per-model ensemble accounting, pool→provider routing, capability audit events, key files (`packages/adapters/agent`) → `grimoires/loa/reference/agent-gateway-capability-mesh.md`

## How This Works

1. Claude Code loads `@.claude/loa/CLAUDE.loa.md` first (framework instructions)
2. Then loads this file (project-specific instructions)
3. Instructions in this file **take precedence** over imported content
4. Framework updates modify `.claude/loa/CLAUDE.loa.md`, not this file

## Related Documentation

- `.claude/loa/CLAUDE.loa.md` - Framework-managed instructions (auto-updated)
- `.loa.config.yaml` - User configuration file
- `PROCESS.md` - Detailed workflow documentation

## Spawn-from-inside + adaptable coordination (2026-06-04)

Per the ratified mounted-agent posture: **spawn agents from INSIDE the cell they
act on**, so they have situational awareness from creation. An agent born inside
a cell reads that cell's own `CLAUDE.md` / `SOUL` / context first — it inherits
the cell's self before it acts. An agent spawned from outside and pointed at a
cell is allopoietic (no cell-context) and reaches across the blanket. Default:
**write-own**; to act on another cell, dispatch an agent that lives in it.

**The path is right-sized to the task** (the consumption gradient applied to
coordination — pick the LIGHTEST path that fits; never force a steep path on a
small task):

| Path | Weight | For | Ceremony |
|------|--------|-----|----------|
| direct (write-own) | L0 | a task entirely inside one cell | none |
| spawn-in-cell (`Agent`, cwd = the cell) | L1 | a small bounded cross-cell task | situational-awareness read; no cockpit/PR |
| `/coord` | L2 | substantial cross-repo work needing review | coordinator + branch + review-gated PR |
| `/compose` | L3 | multi-construct, multi-stage work | Form C + seam protocol |

**The regenerative path must be the path of least resistance.** If the correct
(cell-respecting) path is steeper than reaching-in, agents reach in — the
consumption-gradient slip. **GECKO doctors path-friction**: a cross-cell pattern
done manually or at the wrong weight is a *desire-path forming*.
**Done-twice-becomes-a-path** — a recurring manual cross-cell act auto-proposes a
lightweight composable RAIL (floor-raise, not a bespoke per-task script). The
system paves the desire-paths agents actually walk so the operator does not pave
them by hand. Reference: consumption-gradient doctrine (paving vs tilting).

## Construct Support

When `.run/construct-index.yaml` exists, constructs are installed and available:
- When a user mentions a construct name, check the index to resolve it
- Load the construct's persona file if available
- Scope to the construct's skill set and grimoire paths
- Use `construct-resolve.sh resolve <name>` for programmatic resolution
- Use `construct-resolve.sh compose <source> <target>` to check composition paths
