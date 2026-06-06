---
title: "ADR-009: Freeside Hexagonal Federation — Cluster Composition + Per-Cell Harness + Operating Posture"
trust_tier: operator-authored
read_state: unread
confidence: 0.5
decay_class: reference
last_confirmed: 2026-06-03
operator_signed: self_attested
---

# ADR-009: Freeside Hexagonal Federation — Cluster Composition + Per-Cell Harness + Operating Posture

**Status**: Proposed (lands in parallel with ADR-008 ratification per operator decision 2026-05-25)
**Date**: 2026-05-25
**Context**: Post-ADR-007 absorption + ADR-008 factory model · operator-derived three-layer naming model 2026-05-25 · identity-api Phase 1 BUILT + DEPLOYED 2026-05-25 (first cell to reach runtime) provides empirical grounding · convergence on per-cell Loa harness as load-bearing operator decision

## Framing History (honesty note)

This ADR's framing crystallized in one operator session 2026-05-25 after the operator named what had been latent across cycles 003-008:

1. **Pre-naming** — [ADR-008](008-freeside-as-factory.md) (2026-05-19) shipped the factory model with composition vocabulary (buildings, products, marketplace, belts) but did not name the *cluster pattern* itself. The pieces — per-repo BUTTERFREEZONE, modules-as-installables, BeaconV3 federation, workspace-firewall — accumulated without a synthesizing name.
2. **Operator-coined 2026-05-25** — in dialogue, the operator named the synthesis: *"HIVEMIND LABORATORY is how we OPERATE. HEXAGONAL FEDERATION is architecturally correct direction. All of this exists within FREESIDE."* Three-layer naming distinguishes umbrella (FREESIDE), architecture (HEXAGONAL FEDERATION), and operating posture (HIVEMIND LABORATORY).
3. **Per-cell harness lock-in 2026-05-25** — operator: *"Agents need to be able to run beads/cycles. We mount if not already mounted."* Closed the doctrine gap on whether each cell mounts its own `.claude/` (full Loa) or shares parent.
4. **Persona realignment 2026-05-25** — operator retired the prior "Marco" persona (from `freeside-dashboard-bridge-audit.md` 2026-04). New primary persona: external Web3 community managers + brand CMs. Internal scope: the THJ team dogfooding their own infra.

The three-layer naming was the missing synthesis. The factory model (ADR-008) names the pieces; this ADR names how they compose AND how we operate inside them.

## Context

[ADR-007](007-loa-freeside-absorption.md) ratified the dual-concern absorption. [ADR-008](008-freeside-as-factory.md) named the factory model (buildings = capabilities; one repo per building; composition follows data semantic depth). ADR-009 (this doc) names **the cluster-composition pattern + the per-cell harness contract + the operating posture** that operationalize the factory model.

Operator's three-layer naming verbatim 2026-05-25:

> "HIVEMIND LABORATORY is how we OPERATE. HEXAGONAL FEDERATION is architecturally correct direction. All of this exists within FREESIDE." — operator, 2026-05-25

Operator's per-cell harness decision:

> "Agents need to be able to run beads/cycles. We mount if not already mounted." — operator, 2026-05-25

Operator's two-persona product model:

> "Persona is now Community managers for Web3 Communities and Brands who run their communities across social media platforms and aim to facilitate a thriving ecosystem through talking to users, pushing for valuable partnerships, etc. Consider that the builders and operators within the Freeside for now are just us within the internal team. We keep the scope on that side purely focused on helping us operate our own infra so that people using our products are able to get value out of it and so that we have more time to interact and operate across multiple zones (operation, talking to users, strategizing, getting feedback) which flatlines our org so that everyone becomes capable and aware of the different moving pieces allowing they themselves to do what they do best better. We are in a sense community managers ourselves and have been doing this for years so we understand what it takes." — operator, 2026-05-25

### Doctrine Activation Receipts (per Operator OS v3.5)

```
Activated doctrine: ~/vault/wiki/concepts/freeside-hexagonal-federation.md
Use: usable (this ADR is its repo-canonical lift)
Boundaries: cannot override Loa workflow gates; applies to freeside cluster only
Expiry: until superseded by future ADR

Activated doctrine: ~/vault/wiki/concepts/agentic-game-infrastructure.md
Use: background_only (NAMING-DISAMBIGUATION source — its `lib/honeycomb/` is in-cell substrate)
Boundaries: descriptive of naming; does NOT bind cluster architecture
Expiry: stable disambiguation reference

Activated doctrine: ~/vault/wiki/concepts/freeside-modules-as-installables.md
Use: usable (cells ARE the modules; this ADR extends with cluster composition)
Boundaries: cell-shape doctrine; composes with this ADR's cluster doctrine
Expiry: until superseded
```

## Decision

The freeside cluster is a **Hexagonal Federation** of cells (one cell = one freeside-X repo = one capability). Cells federate via BeaconV3 + a registry hosted in loa-freeside. Each cell mounts its own full Loa harness. The cluster operates as a **HIVEMIND LABORATORY** (per construct-laboratory-substrate@1a0a776). The Freeside Dashboard (today: score-dashboard with `(cm-shell)` layout; evolving) serves a two-persona product model. All of this exists within **FREESIDE** (the umbrella).

### D-1. Three-layer naming (the synthesizing decision)

The cluster is named at three semantic layers. Mixing them is the most common source of doctrinal confusion; this ADR pins each name to a specific layer.

| Layer | Name | Answers | Authority |
|-------|------|---------|-----------|
| Umbrella | **FREESIDE** | What is this world? | Pre-existing; the totality |
| Architecture | **HEXAGONAL FEDERATION** | How are the pieces composed? | This ADR |
| Operating posture | **HIVEMIND LABORATORY** | How do we work inside it? | `construct-laboratory-substrate@1a0a776` |

**Naming disambiguation**: the vault concept `~/vault/wiki/concepts/agentic-game-infrastructure.md` uses "honeycomb" for an *in-cell* Effect.PubSub substrate (`lib/honeycomb/` in compass). That honeycomb is NOT this hexagonal federation. Both use hexagonal metaphors; they live at different layers. See D-11 for the full disambiguation.

### D-2. Cells (extends ADR-008 D-2)

Each freeside-X repo is a **cell**. A cell is:
- One repository holding schema + runtime + docs (per [ADR-008 D-2](008-freeside-as-factory.md))
- One capability with declared inputs (consumes) + outputs (publishes)
- One BeaconV3 manifest at `.well-known/beacon.json`
- One Loa mount (see D-4)

The cluster as of 2026-05-25 has 8 cells registered in `packages/freeside-registry/registry.yaml`: `sonar-api`, `storage-api`, `mint-api`, `activities-api`, `inventory-api`, `score-api`, `identity-api`, `mediums-api`.

### D-3. Wax walls (cell contracts)

Cells communicate through **wax walls** — sealed contracts that define how cells touch without entanglement:

| Wax | What it is | Where it lives |
|-----|------------|----------------|
| BeaconV3 | Cell broadcast (name, version, consumes[], publishes[]) | `.well-known/beacon.json` per cell |
| Sealed Zod schemas | Shared types for compile-time enforcement | `packages/protocol/` per cell; consumers vendor (Pattern B per identity-api precedent) |
| Federation registry | Hive index | `loa-freeside/packages/freeside-registry/registry.yaml` |

### D-4. Per-cell harness (load-bearing operator decision)

**Every freeside-X cell mounts its own full Loa harness.** Operator decision 2026-05-25.

```
   freeside-<cell>/
   ├── .claude/             ← full Loa mount (constructs, skills, hooks, framework)
   ├── CLAUDE.md            ← cell-specific agent instructions
   ├── BUTTERFREEZONE.md    ← agent-API interface
   ├── grimoires/loa/       ← cell-specific cycles, notes, observations
   ├── .beads/              ← cell-specific task tracking
   └── .run/                ← cell-specific autonomous-execution state
```

**Mount-if-not-already-mounted**: when a cell isn't yet Loa-mounted, mounting is the first step of any work in that cell. Mechanism: `os-mounting` skill from construct-hivemind-os, or manual `loa mount` invocation.

Rationale: agents must be able to drop into ANY cell and run beads/cycles independently. A shared parent's `.claude/` would force per-cell agent actions to round-trip through loa-freeside; that breaks cell autonomy and concentrates blast radius. Empirical validation: identity-api Phase 1 (cycle 2026-05-24/25) executed entirely within its own per-cell harness + a throwaway coordinator at `~/bonfire/identity-api-coordinator/`; 12 task beads closed in one session with full Loa workflow available per cell.

#### D-4a. Mount patterns recognized (audit 2026-05-25 PM)

Two patterns coexist in the cluster, both per-cell-substantive but with different shapes:

| Pattern | Cells using | Shape | Trade-off |
|---------|-------------|-------|-----------|
| **Copy-style** | identity-api (17M), sonar-api (11M), score-api (9.2M), inventory-api (9.2M post-Tier-1) | `.claude/` fully tracked in cell repo (~9-17MB); self-contained | Self-contained; works offline; framework updates need manual sync (re-copy or `/update-loa` skill) |
| **Submodule-style** | mint-api, activities-api | `.loa` submodule pinned to release tag (e.g. `v1.157.1` at commit `ea12e23`); `.claude/` is two-layer symlink farm (framework → `../.loa/.claude/*`; skills → `../constructs/packs/*/skills/*` via global `~/.loa/constructs/packs/*` store); `.mount-lock` marker | ~12K tracked + SHA per cell; auto-sync via `git submodule update`; CI-checkable pin; superior governance |

**Recommendation for NEW cells** (operator decision 2026-05-25 PM, REVERSING the prior "submodule preferred" framing that an earlier audit-driven amendment proposed): prefer **copy-style**.

Operator framing 2026-05-25 PM verbatim:
> "I don't like submodules at all they are messy and flaky. We should consult Loa and BEAUVIOUR for FAANG principles."

The reversal aligns with FAANG-engineering precedent (Google/Meta/Netflix have all moved AWAY from git submodules toward monorepo or fully-tracked copy-style for the same operational reasons: submodule churn, hard-to-reason update mechanics, partial-clone failures, CI flakiness). Submodule-style's theoretical advantages (smaller tracked footprint; centralized version pin) are real but its operational tax (`git submodule update --init --recursive` discipline; detached-HEAD state; `-dirty` perpetuity from build artifacts) is consistently judged not worth it at scale.

**Trade-offs accepted with copy-style as canonical:**
- ~9MB tracked per cell (~54MB across 6 mounted cells; modest)
- Framework updates require per-cell re-copy (mitigated by a Loa-native `/update-loa` skill — see below)
- Per-cell `.claude/` divergence possible (mitigated by the auditing-cluster-cells gecko skill detecting drift)

**Migration direction (REVERSED):** existing submodule-style cells (mint-api, activities-api) become migration candidates TO copy-style — a separate cluster-meta cycle, not blocking. Migration recipe (Phase B):
```bash
cd ~/Documents/GitHub/<cell>
# 1. Capture current submodule HEAD framework as the copy source
git submodule status .loa  # note the pinned SHA for provenance
# 2. Strip submodule + symlink farm; replace with substantive copy
git submodule deinit .loa
git rm .loa
cp -R ~/Documents/GitHub/score-api/.claude/. .claude/  # OR the canonical template
trash .claude/cache
rm -f .claude/.mount-lock
# 3. Commit + verify runtime unchanged
git add . .gitmodules
git commit -m "chore: migrate submodule-style mount → copy-style per ADR-009 D-4a (operator decision 2026-05-25)"
```

**Loa-as-mounting-owner (operator decision 2026-05-25 PM):**
> "Loa skill comes from loa."

The mount + update mechanism is **already Loa-native** — not delegated to `construct-hivemind-os`. Cite the existing tooling:

| Tool | Purpose |
|------|---------|
| `.claude/scripts/mount-loa.sh` | Initial mount (`curl ... \| bash -s -- --tag v1.X.0` or local invocation) |
| `.claude/scripts/update-loa.sh` | Unified update — auto-detects submodule vs vendored mode; pre-flight checks (uncommitted changes, upstream remote); supply-chain checks; merge conflict guidance |
| `.claude/scripts/update-loa-bump-version.sh` | Phase 5.6 version-marker refresh (Issue #554) — keeps `.loa-version.json` + `CLAUDE.loa.md` header in sync post-merge |
| `.claude/commands/update-loa.md` | Slash command (`/update-loa`) v1.3.0 — operator-invocable wrapper |

For NEW cells (post-2026-05-25 PM), use this mount sequence:
1. **(v0.3 supply-chain hardening per flatline SKP-011 HIGH 745)** `curl -fsSL` of mount-loa.sh MUST be paired with: (a) SHA-pinned tag (not `main`); (b) checksum verification against published `loa-release-<tag>.sha256` (published in the loa release artifact); (c) signed-tag verification via `git verify-tag` once cloned. The curl|bash pattern is acceptable only with these three controls; raw `curl ... | bash -s -- --tag main` is REJECTED for production cells.
2. Example: `curl -fsSL https://raw.githubusercontent.com/0xHoneyJar/loa/v1.39.0/scripts/mount-loa.sh -o /tmp/mount-loa.sh && sha256sum -c <(curl -fsSL https://github.com/0xHoneyJar/loa/releases/download/v1.39.0/mount-loa.sh.sha256) && bash /tmp/mount-loa.sh --tag v1.39.0`
3. `mkdir -p grimoires/loa/{cycles,notes,memory} .run` + scaffolds
4. `br init` (initialize beads, prefix matches cell slug)
5. Author `CLAUDE.md` + `.loa.config.yaml` from cell context

For EXISTING cells (cluster has 6 copy-style + 2 submodule), framework updates flow through `/update-loa` — operator runs it per-cell on framework version bumps. Auto-syncs `.loa-version.json` to track pinned framework SHA per cell.

**Correction note (added 2026-05-25 PM)**: an earlier draft of this ADR (and the flatline-batch review of 2026-05-25 PM) implied a "small follow-up cycle" was needed to author the update skill. That was inaccurate — `/update-loa` exists comprehensively and has since v1.3.0. The flatline reviewers operate on doctrine prose + knowledge retrieval but don't probe the live `.claude/` tree, so the prose understatement misled them. Lesson distilled: doctrine MUST cite existing tooling paths verbatim, not use language like "or equivalent" or "small follow-up cycle."

**FAANG-principle consultation status**: operator-requested 2026-05-25 PM ("consult Loa and BEAUVIOUR"). BEAUVIOUR appears to be a vault concept (`~/vault/wiki/concepts/substrate-over-narrative.md` + connections; needs operator clarification of the canonical reference). Pending: a dedicated consultation pass to derive cluster-architecture principles from FAANG engineering practice (monorepo discipline; tooling ownership; framework-as-substrate distinction). May land as ADR-010 ("FAANG Principles for the Freeside Cluster") after consultation.

#### D-4b. Default-branch homogeneity (v0.3 — UPGRADED from "not blocking" to part of D-13 compliance predicate)

The cluster MUST use `main` as the default branch uniformly. This is a **D-13 compliance predicate item** (item 6 of 7). Cells with `master` as default fail compliance + get the 30-day remediation window.

Pre-2026-05-25 cluster state had inconsistent defaults (storage-api + activities-api on `master`; others on `main`). Post-2026-05-25 PM master→main sweep: 8/8 cells now on `main`. Going forward, NEW cells MUST be created with `main` as the initial default branch.

**v0.3 RECONCILIATION NOTE**: an earlier v0.2 draft framed default-branch as "not blocking; separate operator cycle." Flatline-batch caught the contradiction with D-13 (which treats it as a binary compliance check). v0.3 resolves: default-branch IS a compliance check; the 2026-05-25 sweep brought the cluster into compliance; future deviations are remediation-window items, not silent acceptable drift.

Cluster-meta scripts (e.g., `auditing-cluster-cells/resources/audit-cells.sh`) use `git symbolic-ref refs/remotes/origin/HEAD` to resolve dynamically rather than hardcoding `main` — this both protects against historic legacy AND surfaces drift if any cell flips back.

### D-5. Federation discovery (loa-freeside as central station)

The hive's discovery layer lives in loa-freeside:
- **Registry** at `packages/freeside-registry/registry.yaml` — indexes all cells with rename status + beacon URLs
- **MCP gateway tenants** at `apps/mcp-gateway/src/tenants.ts` — per-cell tenant configs
- **BeaconV3 schema** at `packages/beacon-schema/` — the cell-broadcast contract
- **freeside-cli** at `packages/freeside-cli/` — deployment + discovery tooling

This layer is doctrine-bound by ADR-007 (workspace-firewall): registry/tenants/schema live in the **network** scope of loa-freeside, not the platform scope. The CI-enforced firewall keeps them from contaminating each other.

### D-6. Belt direction (cites ADR-008 D-3)

Composition follows data semantic depth. Belts run one way: closer-to-raw publishes; closer-to-meaning consumes. Per [ADR-008 D-3](008-freeside-as-factory.md), when uncertain which direction an arrow points, the closer-to-raw cell publishes; the closer-to-meaning cell consumes. Bottleneck debugging = walk upstream on the belts.

### D-7. Three cycle types (the operating decomposition)

The cluster's work happens in three cycle types — the daily-readable operator runbook at `grimoires/loa/operators/where-do-i-work-from.md` is the operational manifestation:

| Cycle type | Scope | Where it runs |
|------------|-------|----------------|
| **Platform cycle** | Substrate work (gateway, sietch, terraform) | `loa-freeside/grimoires/loa/cycles/platform-*` |
| **Per-cell cycle** | One cell advances | `~/bonfire/{cell}-coordinator/` (throwaway per /coord doctrine) OR direct in cell repo |
| **Cluster-meta cycle** | Cross-cell work, federation health, multi-cell wedges, doctrine | `loa-freeside/grimoires/freeside-network/cluster-*` |

The operator's primary muscle memory: *"is this work for one cell, the platform, or the cluster?"* → picks the cycle type → picks the directory.

### D-8. Dashboard composition (marketplace UI)

The **Freeside Dashboard** is the marketplace UI for the federation. Current state (2026-05-25): score-dashboard with `(cm-shell)` layout, cycle-006 "CM Pulse S1 foundation" landed 2026-05-05, score-api integration only. Evolution path is **additive** (not rewrite): extend the existing `buildCohort()` fan-out idiom with HTTP clients for identity-api, activities-api, mint-api, inventory-api, mediums-api as those cells reach L4 maturity.

The dashboard does NOT live in loa-freeside; it lives in its own repo (score-dashboard, renaming pending TBD). It is a CONSUMER of the federation, not part of the central station. It is a *world surface* per [[freeside-modules-as-installables]] — a place where multiple cells compose into a presentation layer.

### D-9a. Per-cell capability boundaries (v0.3 — NEW; addresses flatline SKP-002 CRIT 840)

Full Loa harness per cell (D-4) gives each cell its own `.claude/` tree containing scripts, hooks, skills, and potentially secrets-handling code. Without constraints, this creates a per-cell sprawl: every cell could install custom hooks, agent permissions, scripts that touch external services. Flatline caught: this is an **unbounded supply-chain risk**.

**v0.3 doctrine**: cells MUST conform to the following capability boundaries:

| Cell-level item | Scope |
|-----------------|-------|
| `.claude/scripts/` | MAY contain cell-specific scripts; MUST NOT modify cluster-shared files (registry, ADRs, other cells' state) |
| `.claude/hooks/` | MAY register additional safety hooks; MUST NOT disable the framework-baseline hooks (`block-destructive-bash`, `mutation-logger`, etc.) |
| `.claude/skills/` | MAY add cell-specific skills (cell-domain expertise); MUST NOT shadow framework-baseline skills (e.g., custom `/implement` is forbidden) |
| Secrets in `.claude/` | FORBIDDEN — secrets live in cell's `.env` (gitignored) OR external secret manager (Doppler / 1Password CLI / etc.); never in tracked Loa harness files |
| Agent permission files (`.claude/data/agent-permissions.json` or equivalent) | MUST inherit framework baseline; MAY add cell-scoped extensions; MUST NOT remove framework-baseline restrictions |

Compliance check (D-13 extension): cluster CI gate runs **`check-capabilities.sh`** at `~/Documents/GitHub/construct-freeside/skills/auditing-cell-capabilities/resources/check-capabilities.sh` (v0.1.0, authored 2026-05-25 PM — closes the "vaporware" flatline finding SKP-001 CRIT 850). The script verifies each cell's `.claude/` tree against the 5 checks above + emits PASS/WARN/FAIL/SKIP per check + an OVERALL verdict. Violations fail compliance per D-13.

Skill: [`construct-freeside/skills/auditing-cell-capabilities/SKILL.md`](https://github.com/0xHoneyJar/construct-freeside/blob/main/skills/auditing-cell-capabilities/SKILL.md). Pair with [`auditing-cluster-cells`](https://github.com/0xHoneyJar/construct-freeside/blob/main/skills/auditing-cluster-cells/SKILL.md) (sibling: cluster-wide existence + topology checks).

### D-9. Two-persona product model

The Freeside Dashboard serves two personas with differentiated surfaces (operator framing 2026-05-25):

**Primary (the market)**: Community managers for Web3 communities and brands. They run communities across social media platforms; aim to facilitate a thriving ecosystem through talking to users, pushing for valuable partnerships, coordinating events. Surfaces they need: badge issuance UI, member roster + bulk actions, activity timeline, partnership data, raffle management, onchain reputation signals.

**Operator scope (internal dogfood)**: The THJ team. Internal-scope outcome: free up time for the team to operate across multiple zones (operation, talking to users, strategizing, getting feedback). Internal surfaces are a superset of external + infrastructure overlays (deploy status, cell health, cluster meta-cycle queue).

**Auth model (v0.3 — NEW; addresses flatline SKP-001 CRIT 880)**: Both personas read through the same auth substrate:
- **External CM persona**: authenticates via the SAME identity provider their Web3 community uses (Privy is the canonical choice for THJ-adjacent communities). Their identity-api JWT carries a `role: cm-external` claim with `community: <slug>` scope. Reads + writes are scoped to their community's data.
- **Internal operator persona**: authenticates via identity-api JWT with `role: cm-internal` claim. No community scope — sees cluster-wide infrastructure overlays.

This composes with W2 v0.2+ Auth model decision (Privy JWT for V1 reads; identity-api JWT for V2 writes). Until the V2 identity-api JWT issuance for CMs lands, dashboard write actions require operator-internal Privy JWT (small allowlist of THJ-team wallets).

**The dogfood principle**: *"We are in a sense community managers ourselves and have been doing this for years so we understand what it takes."* The dashboard's quality is constrained by our own demands as users. The org-flatlining outcome — *"everyone becomes capable and aware of the different moving pieces allowing they themselves to do what they do best better"* — is the meta-goal.

The two personas are not in conflict; the internal surface is a superset of the external.

### D-10. HIVEMIND LABORATORY operating posture

The cluster operates as a Laboratory member (CultureTech). Canon: `0xHoneyJar/construct-laboratory-substrate@1a0a776`. Contract enforcement per the SessionStart banner: constructs emit canonical `hivemind:` label blocks · surface user truth + confidence; **never recommend or decide** (the label layer has no action slot) · projects artifacts via `[CANVAS]`/`[BUG]`/`[TASK]`/`[SOLUTION]`/`[GAP]` template family.

Cluster application: every cell emits labels in its own way; the operator is always the decider; cross-cell findings route to `construct-hivemind-os/library/` as the cluster-meta archive (Phase B; not yet wired — requires a new `lib-architecting-substrate-cells` skill OR existing graduation discipline).

### D-12. Construct frames as cluster policies (operator framing 2026-05-25)

The cluster operates with **three construct-shaped policies** — each governs a phase of cell-cluster work. Operator framing 2026-05-25: *"Loa-vps + Loa coordination is the substrate that runs this deterministically through beads. Gecko (now Constructs Freeside) is the frame we can apply when walking the stalls auditing and grounding then diagnosing. Execution is KRANZ. Both should be aware of our way of operating. Our policies around Hivemind Laboratory and each agent's frame of mind and capabilities I would call policies as well (think RL)."*

| Construct | Phase it governs | What it does | Skills (primary) |
|-----------|-------------------|--------------|------------------|
| **gecko** | OBSERVATION | Walk the stalls; audit; ground findings; diagnose drift | patrol · observe · diagnose · report |
| **construct-freeside (KRANZ)** | EXECUTION | Coordinate + cutover + flip + distill; 5-act methodology | Coordinate → Mirror → Verify → Flip → Distill |
| **construct-laboratory-substrate** | POLICY LAYER | Hivemind Laboratory governance; surface user truth + confidence; **never recommend or decide** | hivemind: label emission · CANVAS/BUG/TASK/SOLUTION/GAP template projection |

The substrate underneath all three: **Loa + Loa-vps** — deterministic execution via beads + cycle gates + audit envelope. Loa is the substrate; the constructs are the FRAMES applied to substrate work. The frames are AGENT POLICIES in the RL sense — they shape what an agent does given the substrate state.

Empirical example from cycle 2026-05-25: this very ADR's cluster-harness audit ran **gecko-shaped** (observed, grounded, diagnosed 5/8 drift); the doctrine writing was **Hivemind-Lab-policy-shaped** (surfaced findings; the operator decides remediation); the remediation cycle that dispatches now is **KRANZ-shaped** (coordinate per-cell mount work; execute; cutover; distill). Three frames; one cluster; one operating chain.

**Phase B implementation**: cells should declare in their `BUTTERFREEZONE.md` which frames they're aware of (gecko-aware? KRANZ-aware? Lab-policy-aware?). This declaration is part of the cell-mount-recipe (deferred to a follow-up cycle).

### D-13. Cluster compliance predicate + CI gate (v0.2 — addresses flatline SKP-001 CRIT 880)

Flatline-batch 2026-05-25 PM surfaced: cluster has 5/8 cells out-of-compliance with D-4 per-cell harness requirement at the moment this ADR was written (audit 2026-05-25 AM found 2 unmounted + 1 partial + 2 minimal-skeleton). The ADR-as-of-2026-05-25 declares the harness mandatory but provided no enforcement deadline, no CI gate, and no definition of compliant mount state. Agents can be dispatched into non-compliant cells today and silently operate without Loa workflow gates. This is a structural gap.

D-13 closes it.

#### Compliance predicate (binary check per cell)

A registered cell is **compliant** if ALL of:
1. `.claude/` exists AND substantive (>5MB if copy-style; submodule resolves to substantive `.loa/.claude/` if submodule-style)
2. `CLAUDE.md` present at repo root
3. `grimoires/loa/NOTES.md` present (proof of Loa workflow surface)
4. `.beads/` initialized (proof of task tracking)
5. `.loa-version.json` present with `framework_version` field (proof of /update-loa awareness)
6. Default branch is `main` (cluster homogeneity — see D-4b)
7. BeaconV3 manifest at `.well-known/beacon.json` (proof of federation membership)

The `auditing-cluster-cells` skill (`construct-freeside/skills/auditing-cluster-cells/resources/audit-cells.sh`) implements the predicate today — outputs `drift: clean | <code>` per cell.

#### CI gate (v0.4 — workflow authored 2026-05-25 PM; closes flatline finding "CI gate is vaporware")

**`.github/workflows/cluster-compliance.yml`** (v1.0, authored 2026-05-25 PM) runs the compliance + capability audits against all registered cells. Triggers:
- **PR-time**: if PR touches `packages/freeside-registry/registry.yaml` (adding/removing a cell) OR the workflow file itself, CI runs the predicate against the new cell list + fails if any registered cell fails compliance
- **Nightly** (cron `0 12 * * *` UTC): runs against all registered cells; produces a cluster-status report (markdown summary + JSON artifact); opens an issue tagged `cluster-compliance,drift` if any cell drifts to non-compliant
- **Manual** (`gh workflow run cluster-compliance.yml`): operator-invoked; optional `open_issue_on_failure` input

Composition: per-cell, the workflow runs BOTH `auditing-cluster-cells` (existence + topology) AND `auditing-cell-capabilities` (per-cell boundary audit). PASS requires both to be clean.

Workflow shallow-clones each cell repo via `gh repo clone --depth=1`; cleans up after each cell to bound disk usage. Audit results published as 30-day-retained artifact `cluster-audit-report`.

#### Remediation deadlines

Cells that fail compliance get a **30-day remediation window** from when the failure is first reported. After 30 days, the cluster-meta dispatch script refuses to dispatch agents into the cell until compliance is restored (hard block — surfaced via cockpit.sh).

#### Empirical pre-D-13 state (informational; resolved by cycle 2026-05-25)

Before D-13 (and before cycle 2026-05-25 PM remediation): 3/8 substantive + 2/8 minimal + 1/8 partial + 2/8 unmounted. Post-Tier-1+Tier-2 remediation: 8/8 substantive + 8/8 default=main. D-13 codifies the predicate going forward.

### D-14. Registry concurrency model (v0.2 — addresses flatline SKP-002 HIGH 720)

Flatline-batch surfaced: the static YAML federation registry at `loa-freeside/packages/freeside-registry/registry.yaml` is a concurrency bottleneck + single point of failure for cluster discovery. Today, registry mutations happen via PR (operator-driven, low frequency); D-14 acknowledges the trade-off explicitly:

- **V1 (current)**: YAML-as-registry is acceptable because (a) registry mutations are infrequent — adding a cell happens at cell-genesis, not at runtime; (b) consumers read the registry at cluster-meta cycle boundaries, not in hot paths; (c) PR workflow provides natural concurrency control (one operator at a time).
- **V2 (future, not blocking)**: if registry-read becomes a hot path (e.g., runtime cell-discovery via the gateway), migrate to a strongly-consistent dynamic store (e.g., Redis-backed lookup with the YAML as canonical source-of-truth + cached read replica) OR add advisory file locking. Track as a separate ADR amendment when V2 conditions emerge.

This decision is **intentionally V1-bounded** — premature optimization to Redis would add operational complexity without current need.

### D-11. Disambiguation (HEXAGONAL FEDERATION ≠ honeycomb library)

| The vault's `lib/honeycomb/` (agentic-game-infrastructure.md) | This ADR's HEXAGONAL FEDERATION |
|---|---|
| In-cell substrate shape | Between-cell cluster composition |
| Effect.PubSub for high-concurrency-coordination | BeaconV3 + federation registry for cross-cell discovery |
| One cell's internal organization | The whole hive's architecture |
| Peer to `lib/purupuru/` (overworld EventEmitter substrate) | Peer to no one — names the cluster itself |

Per agentic-game-infrastructure.md: *"The protocol's unity ≠ shape unity."* Both substrates are ACVP-conformant; they specialize at different scopes. This ADR sits ABOVE that distinction.

When you read "honeycomb" in a document, check which layer it's at: the in-cell substrate (compass / agentic-game-infrastructure) or the cluster pattern (this ADR / freeside).

## Status

**Proposed** — lands in parallel with ADR-008 ratification per operator decision 2026-05-25. The same operator-clarity session that ratifies ADR-008 (factory model, extraction sequencing) will ratify ADR-009 (cluster composition + per-cell harness + operating posture). The pair forms the freeside cluster's structural doctrine.

## Consequences

**Positive**:
- Operators (us) know exactly where to work — three cycle types map to three dir patterns
- Agents can drop into any cell and have full Loa workflow available
- Naming disambiguation prevents the doctrinal confusion that was accumulating
- The two-persona product model gives the Freeside Dashboard a clear north star
- Cross-cell archive routing (D-10 Phase B) gives crystallized learnings a destination
- The empirical grounding from identity-api Phase 1 validates the per-cell harness in practice (not theoretical)

**Negative**:
- Per-cell `.claude/` mount adds **5-17MB per cell when substantive** (empirical: 37MB total across 3 substantive cells in audit 2026-05-25 — `cluster-harness-audit-2026-05-25/audit-report.md`). Earlier estimate of ~240MB total was speculative and off by ~6.5×. Framework updates require sync across mounted cells; per-update footprint is smaller than first feared.
- Mount-if-not-already-mounted is a recurring decision per cell — needs operator attention to keep all cells current. Audit 2026-05-25 found **5/8 cells out of compliance** (2 unmounted, 1 partial, 2 minimal-skeleton); first remediation cycle dispatched 2026-05-25 PM.
- Naming disambiguation footnote burden ("which honeycomb did you mean?") for ~6 months until the disambiguation becomes mental shorthand
- Cluster-meta cycle type is new; operational kinks expected on first 1-2 cycles (this audit IS the first cycle; it caught a doctrine-vs-empirical drift, which validates the cycle type itself)
- Phase-B routing (cross-cell archive → construct-hivemind-os/library) is described but not implemented; doctrine cites it as future work

**Neutral**:
- ADR-009 ratification is contingent on ADR-008 ratification (operator-clarity session sequences both); if ADR-008 changes shape, this ADR re-opens
- The operator runbook (D-7's manifestation) lives in `grimoires/loa/operators/`; this ADR doesn't bind that file but expects it as the daily-readable companion

## Related ADRs

- [ADR-007 · loa-freeside Absorption](007-loa-freeside-absorption.md) — Status: Accepted. The dual-concern foundation this ADR builds on.
- [ADR-008 · Freeside as Factory](008-freeside-as-factory.md) — Status: Proposed. The structural foundation; this ADR is its composition pattern.

## References

- Vault: `~/vault/wiki/concepts/freeside-hexagonal-federation.md` (operator-domain doctrine; this ADR is its repo-canonical lift)
- Vault: `~/vault/wiki/concepts/agentic-game-infrastructure.md` (naming-disambiguation source)
- Vault: `~/vault/wiki/concepts/freeside-modules-as-installables.md` (cell-shape doctrine)
- Vault: `~/vault/wiki/concepts/loa-freeside-as-ecosystem-parent.md` (workspace-firewall pattern)
- Construct: `0xHoneyJar/construct-laboratory-substrate@1a0a776` (HIVEMIND LABORATORY canon)
- Empirical: identity-api Phase 1 (cycle 2026-05-24/25) — first cell to reach runtime; live at `identity-api-production-317b.up.railway.app/health`; validates per-cell harness pattern in practice
- Empirical: score-dashboard cycle-006 "CM Pulse S1 foundation" (2026-05-05) — confirms `(cm-shell)` evolution toward Freeside Dashboard
- Operator framing: in-session dialogue 2026-05-25 (three-layer naming, per-cell harness, two-persona model)
- Operator runbook: `grimoires/loa/operators/where-do-i-work-from.md` (daily-readable manifestation of D-7)
