# Sprint Plan: The Litany — Documentation Overhaul

**Cycle:** 022
**PRD:** grimoires/loa/prd-docs-overhaul.md v1.1.0
**SDD:** grimoires/loa/sdd-docs-overhaul.md v1.1.0
**Team:** 1 AI agent (autonomous)
**Sprint Duration:** Single session each
**Total Sprints:** 4

---

## Sprint 1: Reality Extraction + Ground Truth + AGENTREADME

**Goal:** Build the documentation foundation. Extract codebase reality, generate grounded truth, create machine-readable AGENTREADME.

**Depends on:** Nothing (first sprint)
**Outputs:** `grimoires/loa/reality/*`, `grimoires/loa/ground-truth/*`, `AGENTREADME.md`

### Task 1.1: Fresh Reality Extraction via /ride

**Description:** Run `/ride --fresh` against current main HEAD to extract reality files into `grimoires/loa/reality/`.

**Acceptance Criteria:**
- [ ] `/ride` completes successfully on current main HEAD
- [ ] `.reality-meta.json` records the git SHA used (`git rev-parse HEAD` at runtime) and generation timestamp
- [ ] All 6 required surfaces exist and are non-empty: `structure.md`, `api.md`, `services.md`, `database.md`, `commands.md`, `environment.md`
- [ ] Optional surfaces included where discoverable: `triggers.md`, `hygiene.md`, `consistency.md`
- [ ] `.reality-meta.json` exists with per-file token counts
- [ ] The recorded git SHA is verified to be on the main branch (`git branch --contains <sha>` includes main)

**Effort:** Medium
**Dependencies:** None

### Task 1.2: Ground Truth Generation (Scaffolding + Content)

**Description:** Run `ground-truth-gen.sh --mode scaffold` to create the ground truth directory structure, then manually write each spoke file from reality sources.

**Acceptance Criteria:**
- [ ] `grimoires/loa/ground-truth/index.md` exists (<500 tokens) — hub with stats and links
- [ ] `grimoires/loa/ground-truth/api-surface.md` exists (<2000 tokens) — from reality/api.md + reality/commands.md
- [ ] `grimoires/loa/ground-truth/architecture.md` exists (<2000 tokens) — from reality/structure.md + reality/services.md
- [ ] `grimoires/loa/ground-truth/contracts.md` exists (<2000 tokens) — from reality/database.md + reality types
- [ ] `grimoires/loa/ground-truth/behaviors.md` exists (<2000 tokens) — from reality/triggers.md + reality/environment.md
- [ ] Every spoke file uses `(src: path/to/file.ts:L42)` citation format
- [ ] Sharding applied for any spoke exceeding 2000-token budget (spoke becomes index + per-service detail files)

**Effort:** Medium
**Dependencies:** Task 1.1

### Task 1.3: Ground Truth Checksums

**Description:** Run `ground-truth-gen.sh --mode checksums` to generate SHA-256 hashes of all source files referenced in ground truth spokes.

**Acceptance Criteria:**
- [ ] `grimoires/loa/ground-truth/checksums.json` exists with valid SHA-256 hashes
- [ ] Every `(src: ...)` citation in spoke files has a corresponding checksum entry
- [ ] Checksums match current file contents on disk

**Effort:** Light
**Dependencies:** Task 1.2

### Task 1.4: Ground Truth Validation

**Description:** Run `ground-truth-gen.sh --mode validate` to verify grounding ratio and token budgets.

**Acceptance Criteria:**
- [ ] Grounding ratio >= 0.95 for all spoke files (C-DOC-003)
- [ ] Each spoke <= 2000 tokens; index <= 500 tokens (C-DOC-002) — token counts as computed by `ground-truth-gen.sh --mode validate` (the single authority for token measurement)
- [ ] Total agent-loadable surface <= 12500 tokens (hub + all spokes) — per validation script output
- [ ] Validation script exits with code 0 and emits per-file + total token counts in its output

**Effort:** Light
**Dependencies:** Task 1.3

### Task 1.5: AGENTREADME.md Creation

**Description:** Create `AGENTREADME.md` at project root as a two-tier navigation hub derived from ground truth spokes. Hub only — detail lives in ground-truth spokes.

**Acceptance Criteria:**
- [ ] `AGENTREADME.md` exists at project root
- [ ] Contains sections: Project Overview, Architecture (Summary), API Surface (Index), Types & Contracts (Index), Configuration, Navigation table
- [ ] Links to `grimoires/loa/ground-truth/*.md` for deep dives
- [ ] AGENTREADME.md <= 4500 tokens (C-DOC-001 tier-1 budget)
- [ ] Every factual claim cites `(src: file:line)` (C-DOC-003)
- [ ] Grounding ratio >= 0.95
- [ ] No images, no HTML, code blocks for signatures
- [ ] Contains git SHA and generation timestamp in Checksums section

**Effort:** Medium
**Dependencies:** Task 1.4

---

## Sprint 2: README.md + INSTALLATION.md

**Goal:** Create human-focused documentation. README for community + developers, INSTALLATION for setup.

**Depends on:** Sprint 1 (reality files needed for accurate content)
**Outputs:** `README.md`, `INSTALLATION.md`

### Task 2.1: README.md — Community Section

**Description:** Write the top portion of README.md targeting community members: what Arrakis does, features, tier system, badge system, conviction scoring.

**Acceptance Criteria:**
- [ ] Title with version badge reflecting current state
- [ ] "What is Arrakis?" section (2-3 paragraphs for community)
- [ ] Features list: Conviction Scoring, 9-Tier Progression (Dune-themed), Badge System, Agent Gateway (Hounfour), QA Sandbox, Gaib CLI
- [ ] No `file:line` citations — human-readable prose (C-DOC-004)
- [ ] Content informed by reality files but not directly cited

**Effort:** Medium
**Dependencies:** Sprint 1 complete (reality files available)

### Task 2.2: README.md — Developer Section

**Description:** Write the developer-focused portion of README.md: architecture, quick start, configuration, development, contributing.

**Acceptance Criteria:**
- [ ] Architecture section with ASCII diagram (simplified from reality/structure.md)
- [ ] Quick Start section with copy-pasteable commands (clone, install, configure, run)
- [ ] Configuration section with key environment variables table
- [ ] Development section (build, test, lint commands)
- [ ] Contributing section (brief guide)
- [ ] Documentation section with links to AGENTREADME.md, INSTALLATION.md, CHANGELOG.md
- [ ] License section
- [ ] Points to INSTALLATION.md for detailed setup
- [ ] No `file:line` citations (C-DOC-004)

**Effort:** Medium
**Dependencies:** Task 2.1

### Task 2.3: INSTALLATION.md — Conditional Setup Guide

**Description:** Replace the current INSTALLATION.md (Loa framework guide) with actual Arrakis setup instructions. Every section is conditional on what exists in the codebase. Before writing content, derive condition flags from reality extraction outputs.

**Step 1 — Conditional Discovery:** Scan reality files (`reality/structure.md`, `reality/environment.md`, `reality/services.md`) and repo root to produce an applicability checklist:
- Docker: yes/no (evidence: Dockerfile path)
- Docker Compose: yes/no (evidence: docker-compose*.yml path)
- Database migrations: yes/no (evidence: drizzle/ or migrations/ path)
- Redis: yes/no (evidence: env var or config reference path)
- Discord bot: yes/no (evidence: Discord client setup file path)
- Telegram bridge: yes/no (evidence: Telegram adapter file path)
- Deployment config: yes/no (evidence: fly.toml, Dockerfile, etc.)

**Step 2 — Write Conditional Sections:** Only include sections for detected infrastructure.

**Acceptance Criteria:**
- [ ] Applicability checklist included at top of INSTALLATION.md (or as HTML comment) listing detected conditionals with file-path evidence
- [ ] Prerequisites section: Node.js version from package.json engines, plus only detected infrastructure (PostgreSQL, Redis, Docker)
- [ ] Clone & Install section with standard commands
- [ ] Environment Setup section from reality/environment.md (variable names only, never values)
- [ ] Database Setup section: ONLY if migrations detected
- [ ] Running Services section: Only detected services (Discord bot, Telegram bridge, web server)
- [ ] Docker Development section: ONLY if docker-compose*.yml detected
- [ ] Deployment section: Document detected config. If none detected, state "Deployment configuration not yet present" with checked paths
- [ ] Troubleshooting section
- [ ] All commands copy-pasteable
- [ ] No aspirational content — only document what exists (C-DOC-006)

**Effort:** Medium
**Dependencies:** Sprint 1 complete (reality files available)

---

## Sprint 3: CHANGELOG.md Full Rewrite

**Goal:** Replace existing CHANGELOG.md with comprehensive version covering all tagged versions and development cycles.

**Depends on:** Sprint 1 (reality for codebase context), ledger.json for cycle data
**Outputs:** `CHANGELOG.md`

### Task 3.1: Extract and Preserve Tagged Sections

**Description:** Parse existing CHANGELOG.md and extract each `## [x.y.z]` section verbatim. Store section checksums for validation.

**Acceptance Criteria:**
- [ ] Each tagged version section present in existing CHANGELOG.md extracted as exact byte-level copy
- [ ] Section checksums stored in `grimoires/loa/a2a/changelog-sections.json`
- [ ] No formatting changes to preserved content (C-DOC-005)
- [ ] List of git tags (`git tag --list 'v*'`) compared against extracted sections; any tags without existing CHANGELOG sections are recorded as "missing — to be generated" in `changelog-sections.json`
- [ ] Missing-tag sections will be generated fresh in Task 3.4 (clearly marked as generated, not preserved)

**Effort:** Light
**Dependencies:** None

### Task 3.2: Derive Cycle Commit Boundaries (One-Time Migration)

**Description:** Populate `start_sha` and `end_sha` for all existing cycles in ledger.json using heuristic migration. This is the one-time Phase A from SDD §2.6.

**Acceptance Criteria:**
- [ ] Every cycle entry in ledger.json has `base_sha` (exclusive start) and `head_sha` (inclusive end) fields
- [ ] Both fields are full 40-char git SHAs that exist in `git rev-parse`
- [ ] Contiguity: cycle N `head_sha` == cycle N+1 `base_sha` (i.e., `git log base..head` for each cycle produces non-overlapping, contiguous ranges)
- [ ] No commit appears in two cycles (verified by: union of all `git log base..head` ranges has no duplicate SHAs)
- [ ] Heuristics used: PR merge commit SHAs from `git log --grep`, archive timestamps, created/archived timestamps
- [ ] Gaps between cycles are acceptable (not all time periods have cycles) — contiguity only enforced between consecutive cycles that share a boundary

**Effort:** Heavy
**Dependencies:** None

### Task 3.3: Generate Untagged Cycle Entries

**Description:** For each post-v7.0.0 cycle (010–021), use `start_sha..end_sha` from ledger to extract commit messages. Group by conventional commit prefix.

**Acceptance Criteria:**
- [ ] Each cycle has an entry under `[Unreleased]` with cycle label as sub-heading
- [ ] Commits grouped by: Added, Changed, Fixed, Security, Removed
- [ ] PR references included where available (from `(#NNN)` pattern in commits)
- [ ] Dependency bumps and Loa framework updates aggregated as single line items
- [ ] Generator uses deterministic `git log start_sha..end_sha` (Phase B from SDD)

**Effort:** Heavy
**Dependencies:** Task 3.2

### Task 3.4: Assemble Final CHANGELOG.md

**Description:** Combine preserved tagged sections + generated untagged cycle entries + header/footer into final CHANGELOG.md.

**Acceptance Criteria:**
- [ ] Keep a Changelog v1.1.0 format compliant
- [ ] Header with format/versioning links
- [ ] `[Unreleased]` section with cycle sub-headings (newest first)
- [ ] All tagged version sections preserved verbatim
- [ ] Post-generation diff confirms no tagged section content changed (C-DOC-005)
- [ ] Every git tag has a CHANGELOG section
- [ ] Every ledger cycle has an entry

**Effort:** Medium
**Dependencies:** Task 3.1, Task 3.3

---

## Sprint 4: RTFM Validation + Fixes

**Goal:** Validate all documentation with zero-context cold-start tests. Fix any gaps found.

**Depends on:** Sprints 1–3 (all docs must exist)
**Outputs:** RTFM reports in `grimoires/loa/a2a/rtfm/`, potentially fixed docs

### Task 4.1: RTFM Run 1 — README.md (quickstart)

**Description:** Run RTFM with `quickstart` template against README.md. Hermetic harness: only README.md bundled, no repo access.

**Acceptance Criteria:**
- [ ] RTFM completes with zero BLOCKING gaps (G-2)
- [ ] Report saved to `grimoires/loa/a2a/rtfm/report-readme.md`
- [ ] Agent can identify prerequisites and describe how to start the project
- [ ] If BLOCKING gaps found: fix README.md, re-run (max 2 retries)

**Effort:** Light
**Dependencies:** Sprint 2 (README.md exists)

### Task 4.2: RTFM Run 2 — INSTALLATION.md (install)

**Description:** Run RTFM with `install` template against INSTALLATION.md. Hermetic harness: only INSTALLATION.md bundled.

**Acceptance Criteria:**
- [ ] RTFM completes with zero BLOCKING gaps (G-4)
- [ ] Report saved to `grimoires/loa/a2a/rtfm/report-installation.md`
- [ ] Agent can list all install steps in correct order and identify all prerequisites
- [ ] If BLOCKING gaps found: fix INSTALLATION.md, re-run (max 2 retries)

**Effort:** Light
**Dependencies:** Sprint 2 (INSTALLATION.md exists)

### Task 4.3: RTFM Run 3 — AGENTREADME.md (custom task)

**Description:** Run RTFM with custom task against AGENTREADME.md + linked ground-truth files. The task is derived from ground truth content at runtime: select a concept that exists in `ground-truth/api-surface.md` or `ground-truth/behaviors.md` (e.g., "tier progression", "conviction scoring", "capability negotiation") and ask the agent to find the interface for it.

**Task template:** "Using only AGENTREADME.md and any files it links to in grimoires/loa/ground-truth/, find how to [CONCEPT]. Report: (1) the interface used (HTTP endpoint, CLI command, Discord command, or internal function) with invocation details, (2) the relevant type/entity names, (3) the source file citations."

**Acceptance Criteria:**
- [ ] Task concept is selected from a term that actually appears in ground-truth spokes (verified before RTFM run)
- [ ] RTFM completes with zero BLOCKING gaps
- [ ] Report saved to `grimoires/loa/a2a/rtfm/report-agentreadme.md`
- [ ] Agent can name the exact interface (endpoint path, command name, or function), invocation details, and referenced type identifiers as written in the docs
- [ ] If BLOCKING gaps found: fix AGENTREADME.md or ground-truth spokes, re-run (max 2 retries)

**Effort:** Light
**Dependencies:** Sprint 1 (AGENTREADME.md + ground-truth exists)

### Task 4.4: CHANGELOG Validation

**Description:** Manual verification of CHANGELOG.md completeness and format compliance.

**Acceptance Criteria:**
- [ ] Every `git tag --list 'v*'` tag has a CHANGELOG section
- [ ] Every cycle in `ledger.json` has an entry
- [ ] Keep a Changelog format: sections use Added/Changed/Fixed/Security/Removed
- [ ] Tagged sections match original checksums (from Task 3.1)
- [ ] No secrets, API keys, or credentials in any documentation (security constraint)

**Effort:** Light
**Dependencies:** Sprint 3 (CHANGELOG.md exists)

### Task 4.5: Final Documentation Audit

**Description:** Cross-check all 4 documentation files for consistency, broken links, and constraint compliance.

**Acceptance Criteria:**
- [ ] AGENTREADME.md links to ground-truth spokes that exist
- [ ] README.md links to AGENTREADME.md, INSTALLATION.md, CHANGELOG.md — all exist
- [ ] No absolute paths in any documentation (security constraint)
- [ ] No secrets or credential values in any file
- [ ] Environment variable docs list names only, never values
- [ ] Version badge in README.md reflects current version

**Effort:** Light
**Dependencies:** Tasks 4.1–4.4

---

## Risk Assessment

| Risk | Sprint | Mitigation |
|------|--------|------------|
| `/ride` produces stale or incomplete reality | 1 | Validate required surfaces exist; re-run if incomplete |
| Token budgets exceeded in ground truth | 1 | Apply sharding (spoke becomes index + detail files) |
| CHANGELOG cycle boundaries can't be derived | 3 | Use timestamp-based heuristics for one-time migration, then enforce deterministic SHAs |
| RTFM fails repeatedly | 4 | Max 2 retries per doc; focus on BLOCKING gaps only |
| Ground truth grounding ratio < 0.95 | 1 | Iteratively add citations until threshold met |

## Success Criteria (from PRD)

| Goal | Metric | Sprint |
|------|--------|--------|
| G-1 | AGENTREADME grounding ratio >= 0.95 | Sprint 1 |
| G-2 | README passes RTFM quickstart | Sprint 4 |
| G-3 | CHANGELOG covers all tags + cycles | Sprint 3 |
| G-4 | INSTALLATION passes RTFM install | Sprint 4 |
| G-5 | Fresh /ride reality within 24h | Sprint 1 |

---

*"The litany is not a prayer. It is a protocol."*
