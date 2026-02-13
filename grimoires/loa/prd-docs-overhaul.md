# PRD: The Litany — Documentation Overhaul

**Version:** 1.1.0
**Date:** 2026-02-13
**Cycle:** 022
**Status:** Draft

---

## 1. Problem Statement

Arrakis has undergone 21 development cycles and 215 global sprints since its inception, but its public-facing documentation has not kept pace. The README shows v6.0.0 (current is v7.0.0+), the CHANGELOG stops at v7.0.0 despite 12 additional cycles of major work (Hounfour integration, capability mesh, E2E infrastructure, cross-system bridge), and INSTALLATION.md contains the Loa framework guide rather than Arrakis setup instructions.

There is no machine-readable documentation for AI agents, which is increasingly important as arrakis serves as the distribution layer for loa-finn agents (RFC #31).

> Sources: README.md (151 lines, v6.0.0 badge), CHANGELOG.md (654 lines, stops at v7.0.0), INSTALLATION.md (839 lines, Loa framework content)

## 2. Vision

Two parallel documentation surfaces grounded in the same code reality:

1. **AGENTREADME.md** — Machine-readable, token-efficient documentation for AI agents. Generated from the Ground Truth hub-and-spoke process. Every claim cites `file:line`. Optimized for LLM context windows.

2. **README.md** — Human-focused documentation with dual audience sections: community members (what Arrakis does, features, tier system) and developers (setup, architecture, contributing).

Both surfaces are grounded in a fresh `/ride` reality extraction, ensuring accuracy against the current codebase.

## 3. Goals & Success Metrics

| ID | Goal | Metric |
|----|------|--------|
| G-1 | AGENTREADME passes ground truth validation | Grounding ratio >= 0.95 (see §5.A Grounding Ratio Definition) |
| G-2 | README passes RTFM cold-start test | Zero BLOCKING gaps for `quickstart` template (see §6.B RTFM Definitions) |
| G-3 | CHANGELOG covers all tagged versions and all development cycles | All git tags represented; all cycles have an entry; PR references included where label/tag exists (see §5.E Cycle-Version Map) |
| G-4 | INSTALLATION.md enables Arrakis setup | Zero BLOCKING gaps for `install` template (see §6.B RTFM Definitions) |
| G-5 | Documentation reflects current codebase | Fresh /ride reality within 24 hours of generation |

## 4. Users & Stakeholders

### Primary Persona: AI Agent Consumer
- **Who:** LLM agents (loa-finn daemons, Claude Code sessions, external tools) that need to understand arrakis APIs, types, and behaviors
- **Needs:** Token-efficient, structured, code-grounded documentation with precise file:line references
- **Pain point:** Current README is prose-heavy and lacks machine-parseable structure
- **Artifact:** AGENTREADME.md

### Secondary Persona: Human Developer
- **Who:** Contributors, operators, community members evaluating arrakis
- **Needs:** Clear setup instructions, feature overview, architecture understanding
- **Pain point:** README outdated, INSTALLATION.md is wrong project, CHANGELOG incomplete
- **Artifacts:** README.md, INSTALLATION.md, CHANGELOG.md

### Tertiary Persona: Community Member
- **Who:** Discord/Telegram community members who interact with arrakis bots
- **Needs:** Understanding of features (tiers, badges, conviction scoring), how to interact
- **Pain point:** No user-facing documentation section
- **Artifact:** Top section of README.md

## 5. Functional Requirements

### FR-1: Fresh Reality Extraction (/ride)
- Run `/ride` on current codebase to extract reality files
- Output: `grimoires/loa/reality/` with reality files per the `/ride` skill contract
- **Required surfaces** (must exist in output): `structure.md`, `api.md`, `services.md`, `database.md`, `commands.md`, `environment.md`
- **Optional surfaces** (included if discoverable): `triggers.md`, `hygiene.md`, `consistency.md`, `documentation.md`, `drift-analysis.md`
- **Validation**: After /ride completes, verify all required surfaces exist and are non-empty. If a required surface is missing (e.g., no API routes found), the file must still exist with an explicit "Not present in codebase" statement citing the search paths checked
- Must reflect all work through cycle-021 (E2E infrastructure hardening)

### FR-2: Ground Truth Generation
- Generate hub-and-spoke Ground Truth files from reality
- Hub: `grimoires/loa/ground-truth/index.md` (~500 tokens)
- Spokes: `api-surface.md`, `architecture.md`, `contracts.md`, `behaviors.md` (~2000 tokens each)
- Checksums: `checksums.json` with SHA-256 hashes of all referenced files
- Validate: grounding ratio >= 0.95, token budgets met

### FR-3: AGENTREADME.md
- Machine-readable documentation derived from Ground Truth
- Follows llms.txt / AGENTREADME conventions
- Sections: Project Overview, Architecture, API Surface, Types & Contracts, Configuration, Behaviors & State Machines
- Every factual claim cites `file:line`
- Token budget: ~8000 tokens total (fits in a single context load)
- Location: project root (`AGENTREADME.md`)

### FR-4: README.md (Human-Focused, Dual Audience)
- **Community section** (top): What arrakis does, features overview, tier system, badge system, conviction scoring, how to interact
- **Developer section** (bottom): Architecture overview, prerequisites, quick start, environment setup, testing, deployment, contributing
- Must pass RTFM `quickstart` template with zero BLOCKING gaps
- Version badge reflects current state
- Location: project root (`README.md`) — replaces existing

### FR-5: CHANGELOG.md (Full Rewrite)
- Keep a Changelog v1.1.0 format
- **Primary grouping**: git tags (v1.0.0 through v7.0.0). Preserve existing detail for these entries.
- **Secondary grouping**: Post-v7.0.0 work grouped under `[Unreleased]` with sub-headings by cycle label
- **Canonical inputs**: `git tag --list 'v*'` for version boundaries; `grimoires/loa/ledger.json` cycles array for cycle labels and sprint ranges; `git log --oneline` between tag/cycle boundaries for commit details
- **Mapping rules**: PRs referenced when available in commit messages (e.g., `(#57)`); dependency bumps and Loa framework updates aggregated as single line items; squash-merged PRs use the PR title
- Include: Added, Changed, Fixed, Security, Removed per entry
- Location: project root (`CHANGELOG.md`) — replaces existing

### FR-6: INSTALLATION.md (Arrakis Setup Guide)
- Replace current content (Loa framework guide) with actual arrakis setup
- **Content is conditional on repo reality**: Only document infrastructure that exists in the codebase. For each section below, check reality files first:
  - Prerequisites: Document Node.js version from `package.json` engines, PostgreSQL if migrations exist, Redis if referenced in config/code, Docker if Dockerfile exists
  - Environment configuration: Extract from reality `environment.md` — only document variables that exist
  - Database initialization: Only if `drizzle/` or migration files exist
  - Running the Discord bot: Only if Discord client setup exists in source
  - Telegram bridge: Only if Telegram adapter exists in source
  - Docker Compose: Only if `docker-compose*.yml` exists
  - Deployment: Document whatever deployment config exists (Fly.io `fly.toml`, Dockerfile, etc.). If no deployment config found, state "Deployment configuration not yet present" with citation to checked paths
- Must pass RTFM `install` template with zero BLOCKING gaps
- Location: project root (`INSTALLATION.md`) — replaces existing

## 6. Technical Requirements

### TR-1: Ground Truth Pipeline
```
/ride (fresh) → grimoires/loa/reality/ → ground-truth-gen.sh → grimoires/loa/ground-truth/ → AGENTREADME.md
```

### TR-2: RTFM Validation
- README.md tested with `quickstart` template
- INSTALLATION.md tested with `install` template
- AGENTREADME.md tested with custom task: "Find the API endpoint for checking pool eligibility and explain the request/response types"
- All must achieve SUCCESS verdict (zero BLOCKING gaps)

### TR-3: File Format Constraints
- AGENTREADME.md: Markdown with code blocks, no images, no HTML
- README.md: GitHub-flavored Markdown, badges, architecture diagram (ASCII art)
- CHANGELOG.md: Keep a Changelog v1.1.0 with semver
- INSTALLATION.md: Step-by-step with code blocks, copy-pasteable commands

## 7. Scope

### In Scope
- Fresh `/ride` reality extraction
- Ground Truth generation (hub-and-spoke)
- AGENTREADME.md creation
- README.md complete rewrite
- CHANGELOG.md full rewrite
- INSTALLATION.md replacement with Arrakis guide
- RTFM validation of all docs

### Out of Scope
- API documentation (Swagger/OpenAPI) — separate effort
- sites/web content — separate repo concern
- Loa framework documentation — INSTALLATION.md for Loa stays in the Loa repo
- Architecture Decision Records (ADRs) — not in this cycle

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Stale reality leads to inaccurate AGENTREADME | HIGH | Fresh /ride is Sprint 1 prerequisite |
| CHANGELOG rewrite loses existing detail | MEDIUM | Preserve v1.0.0-v7.0.0 content, only restructure and extend |
| RTFM fails repeatedly | LOW | Fix gaps iteratively, max 2 retries per doc |
| Token budget exceeded in AGENTREADME | LOW | Use ground-truth-gen.sh validation mode |

## 9. Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| `/ride` skill | Available | Needs fresh run |
| `ground-truth-gen.sh` script | Available | Modes: scaffold, checksums, validate, all |
| RTFM skill | Available | Templates: install, quickstart, custom |
| Current codebase on main | Ready | PR #57 merged, all recent work landed |

## 10. Sprint Estimation

| Sprint | Focus | Estimated Effort |
|--------|-------|-----------------|
| Sprint 1 | /ride + Ground Truth + AGENTREADME.md | Medium |
| Sprint 2 | README.md + INSTALLATION.md | Medium |
| Sprint 3 | CHANGELOG.md full rewrite | Medium |
| Sprint 4 | RTFM validation + fixes | Light |

## Appendix A: Grounding Ratio Definition

A **claim** is any declarative sentence outside of code blocks, headings, and table headers that asserts a fact about the codebase (e.g., "The API exposes 12 endpoints" or "Redis is used for session caching").

**What counts as a claim:**
- Sentences asserting code structure, behavior, configuration, or architecture
- Sentences in bullet points that state facts about files, functions, or data flow

**What does NOT count:**
- Headings and sub-headings
- Code blocks (fenced with ``` or indented)
- Table headers
- Sentences that are purely instructional ("Run `npm install`")
- Sentences immediately following a cited sentence that elaborate on the same fact (continuation rule)

**Citation format:** `(path/to/file.ts:line)` or `(path/to/file.ts:line-line)` at end of sentence or in parenthetical inline.

**Grounding ratio** = (cited claims) / (total claims). Measured by `ground-truth-gen.sh --mode validate`.

**Threshold:** >= 0.95 (i.e., at most 1 in 20 claims may lack a citation).

## Appendix B: RTFM Definitions

**Templates** are defined in the RTFM skill (`.claude/skills/rtfm-testing/SKILL.md`):

| Template | Task Given to Zero-Context Agent | Docs Tested |
|----------|----------------------------------|-------------|
| `quickstart` | "Follow the quick start guide to run this project" | README.md |
| `install` | "Install this tool on a fresh machine" | INSTALLATION.md |
| custom | User-defined task string | User-specified files |

**Gap severities** (from RTFM skill):

| Severity | Definition | Effect on Verdict |
|----------|-----------|-------------------|
| BLOCKING | Agent cannot proceed at all; missing prerequisite, step, or context | Causes FAILURE or PARTIAL verdict |
| DEGRADED | Agent can proceed but with confusion or wrong assumptions | Does not block SUCCESS but noted |
| MINOR | Cosmetic or nice-to-have improvement | Does not affect verdict |

**SUCCESS** = zero BLOCKING gaps. This is the acceptance criterion for G-2 and G-4.

## Appendix C: Cycle-Version Map

Canonical mapping of development cycles to git tags and PR boundaries. Source: `grimoires/loa/ledger.json` + `git tag --list 'v*'`.

| Cycles | Git Tag | PR(s) | Label | Notes |
|--------|---------|-------|-------|-------|
| 001 | v1.0.0–v3.0.0 | Pre-ledger | Arrakis Genesis | Initial build |
| 002–003 | v4.0.0–v5.1.1 | Pre-ledger | Sandworm + Crysknife | Billing, QA |
| 004–006 | v6.0.0 | Pre-ledger | Monorepo + Spice Melange | Restructure |
| 007 | v7.0.0 | PR #47 (Spice Gate) | Gaib Discord IaC | CLI overhaul |
| 008 | — | — | (gap) | — |
| 009 | untagged | — | Water Discipline | Docs sprint (never started) |
| 010 | untagged | arrakis #40, #47 | Spice Gate Phase 4 | Distribution layer |
| 011 | untagged | arrakis #47 | Spice Gate v2.0 Delta | Hardening |
| 012 | untagged | arrakis #51 | Hounfour Integration | Cross-system bridge |
| 013 | untagged | arrakis #51 | BB Hardening (BB1) | Review findings |
| 014 | untagged | arrakis #51 | BB Round 2 (BB2) | Protocol versioning |
| 015 | untagged | arrakis #52 | Hounfour Endgame | BYOK, ensemble, monitoring |
| 016 | untagged | arrakis #52 | BB Round 3 (BB3) | Review findings |
| 017 | untagged | arrakis #53 (closed) | Water of Life | E2E + deployment |
| 018 | untagged | arrakis #53 (closed) | BB Round 4 (BB4) | Review findings |
| 019 | untagged | arrakis #55 | Capability Mesh (BB6) | Per-model accounting |
| 020 | untagged | arrakis #55 | BB Round 7 (BB7) | Protocol refinement |
| 021 | untagged | arrakis #57 | E2E Hardening (BB9) | Supply chain, atomic writes |
| 022 | — | (this cycle) | The Litany | Documentation overhaul |

**Rule:** Tagged versions get their own CHANGELOG section. Untagged cycles are grouped under `[Unreleased]` with sub-headings by cycle label. When a new version tag is created, the relevant unreleased entries move under that tag.

---

*"I must not fear. Fear is the mind-killer. Fear is the little-death that brings total obliteration. I will face my fear. I will permit it to pass over me and through me."*

*The Litany Against Fear teaches completeness. So too must documentation be complete — grounded in code reality, tested by zero-context agents, serving both machines and humans.*
