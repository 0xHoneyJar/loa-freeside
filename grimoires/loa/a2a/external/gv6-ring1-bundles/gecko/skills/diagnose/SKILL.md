---
name: diagnose
description: "Deep investigation of a single construct. Identity-reality drift, maintenance pattern, composition analysis."
allowed-tools: [Bash, Read, Grep, Glob, Write, Edit]
user-invocable: true
---

# Diagnose — Deep Construct Investigation

## Purpose

When `/observe` spots an anomaly, `/diagnose` goes deep on a single construct. Pulls the full shape — manifest, identity, skills, commit history, composition patterns — and produces a structured finding. This is gecko's `/dig` equivalent, but for construct health instead of research topics.

## Invocation

```bash
/diagnose <construct-slug>           # Deep investigation of one construct
/diagnose <construct-slug> --drift   # Focus on identity-reality drift only
/diagnose <construct-slug> --stale   # Focus on maintenance patterns only
```

## Workflow

### Step 1: Fetch Construct Shape

```bash
# Full manifest
gh api repos/0xHoneyJar/construct-<slug>/contents/construct.yaml -q .content | base64 -d

# Identity
gh api repos/0xHoneyJar/construct-<slug>/contents/identity/persona.yaml -q .content | base64 -d

# Skill count and structure
gh api repos/0xHoneyJar/construct-<slug>/contents/skills -q '.[].name'

# Recent activity
gh api repos/0xHoneyJar/construct-<slug>/commits --jq '.[0:10] | .[] | {sha: .sha[0:7], date: .commit.author.date, message: .commit.message}'
```

### Step 2: Identity-Reality Drift Analysis

Compare three layers:
1. **persona.yaml** — what the construct claims to be (archetype, voice, expertise)
2. **construct.yaml** — what the construct declares (skills, events, dependencies)
3. **SKILL.md files** — what the construct actually does (methodology, steps, outputs)

Drift signals:
- Persona claims expertise in domain X, but no skills reference domain X
- Skills reference tools/APIs not declared in construct.yaml
- Events declared but never emitted (check for emit calls in scripts)
- `composes_with` declared but the composed construct doesn't exist
- `pack_dependencies` that point to nonexistent constructs

### Step 3: Maintenance Pattern Analysis

From commit history:
- **Healthy**: Regular commits with meaningful changes, version bumps aligned with features
- **Thrashing**: Many commits in short period, frequent reverts or "fix" chains
- **Abandoned**: No commits in 30+ days, issues/PRs left open
- **Stale**: Commits exist but are only dependency bumps or CI fixes, no skill evolution

### Step 4: Composition Analysis

Check `composes_with` in construct.yaml against:
- Does the other construct also declare composition back?
- Are they actually installed together in consumer repos? (check loa-constructs, midi-interface, mcv-interface)
- Circular dependencies (observer↔crucible pattern)

### Step 5: Produce Finding

Write to `grimoires/gecko/diagnoses/<slug>-<date>.md`:

```markdown
# Gecko Diagnosis: <construct-name>

**Date**: 2026-03-12
**Health**: HEALTHY | DRIFTING | STALE | ABANDONED
**Score**: 72/100

## Identity-Reality Drift
[Specific findings with file:line references]

## Maintenance Pattern
[Commit pattern analysis]

## Composition
[Cross-construct relationship analysis]

## Observations
[Gecko-voice observations — what this means for the bazaar]

## Recommendations
[Specific, actionable — not vague]
```

### Step 6: Surface

Print the diagnosis summary to stdout. If `DRIFTING` or worse, suggest the construct creator review.

## Outputs

| Path | Description |
|------|-------------|
| `grimoires/gecko/diagnoses/<slug>-<date>.md` | Structured diagnosis report |

## Constraints

- Never modify the diagnosed construct
- Never file issues or PRs on behalf of the construct — surface findings, let creators act
- Never judge intent — a stale construct might be feature-complete, not abandoned
- Always cite specific files and lines, never hallucinate structure
