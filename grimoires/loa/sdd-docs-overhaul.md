# SDD: The Litany — Documentation Overhaul

**Version:** 1.1.0
**Date:** 2026-02-13
**Cycle:** 022
**PRD:** grimoires/loa/prd-docs-overhaul.md v1.1.0
**Status:** Draft

---

## 1. System Overview

This cycle produces 4 documentation artifacts through a linear pipeline:

```
/ride (fresh)
    │
    ▼
grimoires/loa/reality/          ← Token-optimized codebase facts
    │                              (index.md + 6 spoke files)
    │
    ├──► ground-truth-gen.sh    ← Scaffold + checksums + validate
    │        │
    │        ▼
    │    grimoires/loa/ground-truth/
    │        │
    │        ▼
    ├──► AGENTREADME.md         ← Derived from ground truth spokes
    │
    ├──► README.md              ← Human prose, informed by reality
    │
    ├──► INSTALLATION.md        ← Setup guide, conditional on reality
    │
    └──► CHANGELOG.md           ← Ledger + git tags + git log
              │
              ▼
         /rtfm validation       ← Zero-context cold-start test
```

No application code is written in this cycle. All outputs are Markdown files at the project root.

## 2. Component Design

### 2.1 Reality Extraction (Sprint 1, Phase A)

**Tool:** `/ride --fresh`
**Input:** Current codebase on main (commit `815319c`)
**Output:** `grimoires/loa/reality/` with required + optional surfaces

| File | Required | Token Budget | Content |
|------|----------|-------------|---------|
| `index.md` | Yes | <500 | Hub with stats and links |
| `api-surface.md` | Yes | <2000 | Endpoints, function signatures |
| `structure.md` | Yes | <1000 | Annotated directory tree |
| `database.md` | Yes | <2000 | Schema, migrations, queries |
| `services.md` | Yes | <2000 | Business logic services (index + top-level descriptions) |
| `commands.md` | Yes | <2000 | Discord/CLI commands |
| `environment.md` | Yes | <2000 | Env vars and config |
| `types.md` | Optional | <2000 | Type/interface definitions |
| `triggers.md` | Optional | <1000 | Scheduled tasks, events |
| `hygiene.md` | Optional | <1000 | Code quality findings |
| `consistency.md` | Optional | <1000 | Naming/pattern consistency |
| `.reality-meta.json` | Yes | — | Token counts, staleness |

**Sharding for monorepo scale:** With 19+ services, some required surfaces may exceed 2000 tokens. When a spoke exceeds its budget:
1. The spoke becomes an **index file** listing services/endpoints with one-line summaries
2. Per-service detail files are created under `reality/<surface>/<service>.md` (e.g., `reality/api/discord-commands.md`, `reality/api/agent-gateway.md`)
3. The index file links to detail files and stays within budget
4. `.reality-meta.json` tracks the full token count (index + detail files)

This sharding is optional — only triggered when a spoke exceeds budget during generation. Small surfaces remain single files.

**Validation:** All required files exist and are non-empty after /ride completes. `.reality-meta.json` confirms total tokens and per-file counts.

### 2.2 Ground Truth Generation (Sprint 1, Phase B)

**Tool:** `.claude/scripts/ground-truth-gen.sh --mode all`
**Input:** `grimoires/loa/reality/`
**Output:** `grimoires/loa/ground-truth/`

| File | Token Budget | Content Source |
|------|-------------|----------------|
| `index.md` | <500 | Synthesized from all reality spokes |
| `api-surface.md` | <2000 | reality/api-surface.md + reality/commands.md |
| `architecture.md` | <2000 | reality/structure.md + reality/services.md |
| `contracts.md` | <2000 | reality/database.md + reality/types.md |
| `behaviors.md` | <2000 | reality/triggers.md + reality/environment.md |
| `checksums.json` | — | SHA-256 of all referenced source files |

**Content generation** is manual (agent writes each spoke). The script handles scaffolding, checksums, and token validation.

**Grounding ratio enforcement:**

A **claim block** is any Markdown paragraph, list item, or table data cell that is not:
- A heading (any level)
- A fenced code block
- A block explicitly marked `<!-- ungrounded: rationale -->`
- Purely procedural text (e.g., "See the table below")

Each claim block must end with at least one citation in the format `(src: path/to/file.ts:L42)` or `(src: path/to/file.ts:L42-L60)`. Multiple citations are comma-separated within the parentheses.

**Validation algorithm:**
1. Parse Markdown into blocks (paragraphs, list items, table rows)
2. Exclude exempt blocks (headings, code fences, `<!-- ungrounded -->` markers)
3. For each remaining block, check for `(src: ...)` pattern
4. Ratio = cited_blocks / total_non_exempt_blocks
5. Threshold: >= 0.95

`ground-truth-gen.sh --mode validate` implements this check. Exit code 0 = pass, 1 = fail with report of uncited blocks.

### 2.3 AGENTREADME.md (Sprint 1, Phase C)

**Derived from:** Ground truth spokes
**Format:** Markdown, no images/HTML, code blocks for signatures
**Location:** Project root

**Two-tier agent entry:**

The monorepo has 19+ services. A single 8000-token file cannot cover all endpoints and types at useful detail. Instead:

- **Tier 1: `AGENTREADME.md`** (~4000 tokens) — Navigation hub with project overview, top-level architecture, key invariants, and pointers to Tier 2 files. Contains only summary-level facts with citations. Does NOT inline full endpoint lists.
- **Tier 2: `grimoires/loa/ground-truth/*.md`** (~2000 tokens each) — Deep-dive spokes for api-surface, architecture, contracts, behaviors. Agents load specific spokes on demand.

**AGENTREADME.md structure:**

```markdown
# AGENTREADME — Arrakis

> Machine-readable project documentation. Every claim cites (src: file:line).
> For human documentation, see [README.md](README.md).
> For deep dives, see grimoires/loa/ground-truth/.

## Project Overview
[From ground-truth/index.md — stats, tech stack, entry points]

## Architecture (Summary)
[Top-level component diagram + data flow. Full details: ground-truth/architecture.md]

## API Surface (Index)
[Endpoint count, key routes grouped by domain. Full list: ground-truth/api-surface.md]

## Types & Contracts (Index)
[Key interfaces, DB entity count. Full definitions: ground-truth/contracts.md]

## Configuration
[Top 10 required env vars. Full list: ground-truth/behaviors.md]

## Navigation
| Topic | File | Tokens |
|-------|------|--------|
| API endpoints | ground-truth/api-surface.md | ~2000 |
| Architecture | ground-truth/architecture.md | ~2000 |
| Types/contracts | ground-truth/contracts.md | ~2000 |
| Behaviors | ground-truth/behaviors.md | ~2000 |

## Checksums
Generated: {timestamp}
Git SHA: {commit}
See: grimoires/loa/ground-truth/checksums.json
```

**Token budget enforcement:** AGENTREADME.md <= 4500 tokens. Each spoke <= 2000 tokens. Total agent-loadable surface <= 12500 tokens (hub + all spokes).

### 2.4 README.md (Sprint 2)

**Informed by:** Reality files (not directly cited — human-friendly prose)
**Format:** GitHub-flavored Markdown with badges and ASCII diagrams
**Location:** Project root (replaces existing)

**Structure:**

```markdown
# Arrakis

[badges: version, license, tests, Discord]

> One-line description from reality/index.md

## What is Arrakis?
[2-3 paragraph overview for community members]

## Features
[Feature list with brief descriptions]
- Conviction Scoring
- 9-Tier Progression (Dune-themed)
- Badge System
- Agent Gateway (Hounfour)
- QA Sandbox
- Gaib CLI (Infrastructure-as-Code)

## Architecture
[ASCII diagram from reality/structure.md, simplified for humans]

## Quick Start
[Prerequisites, clone, install, configure, run — copy-pasteable commands]
[Points to INSTALLATION.md for detailed setup]

## Configuration
[Key environment variables table]

## Development
[Building, testing, linting commands]

## Contributing
[Brief contribution guide]

## Documentation
[Links to AGENTREADME.md, INSTALLATION.md, CHANGELOG.md]

## License
[License info]
```

### 2.5 INSTALLATION.md (Sprint 2)

**Informed by:** reality/environment.md, reality/structure.md
**Conditional content:** Each section checks for presence in codebase
**Format:** Step-by-step with copy-pasteable commands
**Location:** Project root (replaces existing)

**Structure:**

```markdown
# Installation Guide

## Prerequisites
[Conditional: only list what package.json/Dockerfile requires]

## Clone & Install
[Standard git clone + package install]

## Environment Setup
[From reality/environment.md — required vs optional vars]

## Database Setup
[Conditional: only if drizzle/ or migrations exist]

## Running Services
[Conditional: Discord bot, Telegram bridge, web server — only what exists]

## Docker Development
[Conditional: only if docker-compose*.yml exists]

## Deployment
[Conditional: document whatever deployment config exists]

## Troubleshooting
[Common issues from reality/hygiene.md]
```

### 2.6 CHANGELOG.md (Sprint 3)

**Sources:** `git tag --list 'v*'`, `grimoires/loa/ledger.json`, `git log`
**Format:** Keep a Changelog v1.1.0
**Location:** Project root (replaces existing)

**Structure:**

```markdown
# Changelog

All notable changes to Arrakis are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

## [Unreleased]

### Cycle 021: E2E Infrastructure Hardening (BB9)
[From ledger + git log between cycle boundaries]

### Cycle 020: Bridgebuilder Round 7 (BB7)
...

### Cycle 010: Spice Gate Phase 4
...

## [7.0.0] - 2026-01-20
[Preserved from existing CHANGELOG]

## [6.0.0] - 2026-01-15
[Preserved from existing CHANGELOG]

...back to [1.0.0]
```

**Mapping algorithm:**

1. **Extract tagged sections verbatim:** Parse existing CHANGELOG.md. For each `## [x.y.z]` section, extract the exact content (byte-level copy) into a staging area. These sections are **immutable** — they are inserted into the new file without reformatting.

2. **Validate preservation:** After generation, diff each tagged section against the original. If any tagged section content differs (ignoring trailing whitespace), the build fails. Store section checksums in `grimoires/loa/a2a/changelog-sections.json` for audit.

3. **Derive cycle commit boundaries (two-phase):**

   **Phase A — One-time migration (this sprint only):** Populate `start_sha` and `end_sha` for all existing cycles in `ledger.json` using heuristics:
   - If cycle references a PR: use the PR merge commit SHA from `git log --grep="(#N)" --format=%H`
   - If cycle has `archive_path`: use the archive timestamp to find nearest merge commit
   - Fallback: use `created`/`archived` timestamps as `git log` range boundaries
   - After migration, every cycle entry in `ledger.json` MUST have `start_sha` and `end_sha` fields

   **Invariants enforced after migration:**
   - `end_sha` of cycle N == `start_sha` of cycle N+1 (contiguous)
   - No overlapping commit ranges
   - Both fields are full 40-char git SHAs that exist in `git rev-parse`

   **Phase B — Steady-state generator:** The CHANGELOG generator reads `start_sha..end_sha` from each cycle entry. If either field is missing, the generator **refuses to run** for that cycle (exit code 2 with message identifying the gap). This ensures deterministic, reproducible output.

   **Future cycles:** The `/archive-cycle` command will be responsible for setting `end_sha` to the current HEAD when archiving. The `/plan-and-analyze` command sets `start_sha` to current HEAD when creating a new cycle. This makes boundaries automatic going forward.

4. **Generate untagged cycle entries:** For each untagged cycle, use the derived commit range to extract commit messages. Group by conventional commit prefix (feat/fix/chore/security). PRs extracted from `(#NNN)` pattern in commit messages.

5. **Assemble:** Tagged sections (immutable) + `[Unreleased]` section (generated from untagged cycles) + header/footer.

## 3. Validation Strategy

### 3.1 Ground Truth Validation

```bash
.claude/scripts/ground-truth-gen.sh \
  --reality-dir grimoires/loa/reality/ \
  --output-dir grimoires/loa/ground-truth/ \
  --mode validate
```

**Pass criteria:** All spoke files within token budget. Exit code 0.

### 3.2 RTFM Validation (Sprint 4)

Three validation runs, each with a hermetic harness:

**Harness contract:** The RTFM tester agent receives ONLY the doc file(s) listed in the "Docs" column. No repo access, no network, no tools beyond the tester capabilities manifest (terminal basics, git basics, package manager awareness). The agent cannot search the codebase or read files not bundled.

| Run | Docs Bundled | Template/Task | Success Criteria |
|-----|-------------|--------------|-----------------|
| 1 | README.md | `quickstart` | Zero BLOCKING gaps. Agent can identify prerequisites and describe how to start the project. |
| 2 | INSTALLATION.md | `install` | Zero BLOCKING gaps. Agent can list all install steps in correct order and identify all prerequisites. |
| 3 | AGENTREADME.md | Custom (see below) | Zero BLOCKING gaps. Agent can name the exact endpoint path, HTTP method, and referenced type identifiers as written in the doc. |

**Custom task for Run 3:** "Using only AGENTREADME.md and any files it links to in grimoires/loa/ground-truth/, find how to check a user's tier eligibility. Report: (1) the endpoint path and HTTP method, (2) the request/response type names, (3) the source file citations."

**Note:** If the term "eligibility" does not appear in the generated AGENTREADME or ground truth spokes, the task is updated to reference a term that does exist (e.g., "conviction score calculation" or "tier progression check"). The task must reference a concept present in the docs.

**Fix loop:** If BLOCKING gaps found → fix docs → re-run RTFM (max 2 retries per doc).

### 3.3 Changelog Validation

Manual verification:
- `git tag --list 'v*'` — every tag has a CHANGELOG section
- `jq '.cycles[] | .id' grimoires/loa/ledger.json` — every cycle has an entry
- Keep a Changelog format compliance (sections: Added/Changed/Fixed/Security/Removed)

## 4. File Map

| Artifact | Path | Sprint | New/Replace |
|----------|------|--------|-------------|
| Reality files | `grimoires/loa/reality/*` | 1 | Replace (stale) |
| Ground truth hub | `grimoires/loa/ground-truth/index.md` | 1 | New |
| Ground truth spokes | `grimoires/loa/ground-truth/*.md` | 1 | New |
| Ground truth checksums | `grimoires/loa/ground-truth/checksums.json` | 1 | New |
| AGENTREADME.md | `AGENTREADME.md` | 1 | New |
| README.md | `README.md` | 2 | Replace |
| INSTALLATION.md | `INSTALLATION.md` | 2 | Replace |
| CHANGELOG.md | `CHANGELOG.md` | 3 | Replace |
| RTFM reports | `grimoires/loa/a2a/rtfm/report-*.md` | 4 | New |

## 5. Constraints

- C-DOC-001: AGENTREADME.md total token budget <= 8500 tokens
- C-DOC-002: Each ground truth spoke <= 2000 tokens; index <= 500 tokens
- C-DOC-003: Grounding ratio >= 0.95 for AGENTREADME.md and ground truth files
- C-DOC-004: README.md and INSTALLATION.md contain zero `file:line` citations (human-readable)
- C-DOC-005: CHANGELOG.md preserves all existing tagged version content verbatim
- C-DOC-006: INSTALLATION.md sections conditional on codebase reality (no aspirational content)

## 6. Security Considerations

- No secrets, API keys, or credentials in any documentation file
- Environment variable documentation lists variable names only, never values
- AGENTREADME.md citations reference relative paths, never absolute
- CHANGELOG.md does not include security vulnerability details beyond what's already public

---

*"The litany is not a prayer. It is a protocol. You recite it not because you believe, but because it works."*
