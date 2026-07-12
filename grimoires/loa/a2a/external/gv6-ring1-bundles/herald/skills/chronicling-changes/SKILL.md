---
name: chronicling-changes
description: Research git history to produce structured change timelines
user-invocable: true
aliases:
  - chronicle
allowed-tools: Read, Glob, Grep, Bash, Task
---

# Chronicling Changes

Research git history, PRs, and releases to produce a structured chronicle of what actually shipped, when, and what it did. This is the research phase that feeds into grounding-announcements.

## Trigger

```
/chronicle [feature or scope]
```

## Overview

Chronicles are structured artifacts that capture code reality. They are the evidence layer that announcements are built on. Every date, description, and claim in a chronicle must be traceable to a git commit, file, or PR.

## Workflow

### Phase 1: Scope Discovery

Identify what to chronicle based on user input:

```bash
# If a specific feature: search commits
git log --all --oneline --grep="<feature>" --reverse

# If a branch or PR: diff against base
git log --oneline main..HEAD
git diff --stat main..HEAD

# If a time range: filter by date
git log --oneline --since="<date>" --until="<date>"

# If a category (e.g., "arcade", "earn"): search broader
git log --all --oneline --grep="<category>" --reverse
```

### Phase 2: Feature Mapping

For each feature or change discovered:

1. **Find the first commit** — `git log --all --oneline --grep="<feature>" --reverse | head -1`
2. **Extract the date** — `git log --format="%ai" <hash> | head -1`
3. **Read the implementation** — Find and read the main component, page, or route file
4. **Identify integrations** — Check constants/contracts, hooks, API routes for external dependencies
5. **Check current status** — Look for sunset banners, locked states, deprecation markers
6. **Find key milestones** — Migrations, major refactors, bug fixes that tell the story

### Phase 3: Description Extraction

For each feature, produce a one-line description based on what the code does:

**Method:** Read the main component file. Look at:
- What the UI renders (forms, feeds, stats)
- What contracts it interacts with
- What the user flow is (deposit → stake → earn)
- What data it displays

**Rules:**
- Describe in past tense if the feature is being removed
- Describe in present tense if the feature still exists
- Use the vocabulary from `contexts/voice/voice.md` if it exists
- Never describe what the feature was supposed to do — only what the code shows it does

### Phase 4: Chronicle Output

Write to `grimoires/herald/chronicles/{scope}-chronicle.md`:

```markdown
# Chronicle: {Scope}

Generated: {date}
Evidence: {number} commits across {date range}

## Timeline

| Date | Feature | Event | Evidence |
|------|---------|-------|----------|
| 2025-09-22 | vault | First shipped | commit e3da302 |
| 2025-11-25 | vault | Migrated to Envio | commit fbf118a |
| 2026-02-19 | vault | Sunset banner added | commit ddbf350 |

## Feature Descriptions

### vault
**Shipped:** 2025-09-22
**Status:** Sunset (wind-down)
**What it did:** Yield-bearing DeFi vault. Users deposited BERA/WBERA into AquaBera LP, earned BGT rewards automatically.
**Integrations:** AquaBera LP (0x04fD...), Berachain Reward Vault (0x16e8...)
**Key files:** components/vault-new.tsx, hooks/vault/
**Evidence:** {commit hashes}

### {next feature}
...

## External Factors

| Factor | Impact | Source |
|--------|--------|--------|
| Berachain POL update | Removed reward vault flows for vault/lock | {link or reference} |

## Unshipped Items

| Feature | Status | Evidence |
|---------|--------|----------|
| incineraffle | Placeholder only (isLocked: true, no component) | apps.ts:L{N} |
| casting | Asset only (no route, no page, no hooks) | apps.ts:L{N}, casting.png |
```

### Phase 5: Validate

Before saving:
- [ ] Every date comes from `git log`, not inference
- [ ] Every description comes from reading code, not commit messages alone
- [ ] Unshipped items are identified with evidence of absence
- [ ] External factors are named concretely
- [ ] No forward-looking language in descriptions

## Quick Reference

```
RESEARCH:
  git log --grep      <- find commits
  git log --format    <- extract dates
  read components     <- describe what code does
  check contracts     <- identify integrations
  look for sunset     <- current status markers

OUTPUT:
  timeline table      <- date, feature, event, evidence
  feature blocks      <- shipped, status, description, integrations, files
  external factors    <- what changed outside the codebase
  unshipped items     <- what never made it, with evidence
```
