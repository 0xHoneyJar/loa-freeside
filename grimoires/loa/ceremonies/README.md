# Ceremony Geometry — Post-Merge Synthesis Ritual

## What Is a Ceremony?

A ceremony is a structured post-merge synthesis that connects **what was built** to **what it means**. It exists at the boundary between engineering and identity — acknowledging that significant technical work changes not just the codebase but the project itself.

## When to Write One

A ceremony is triggered when **all** of the following are true:

1. A cycle PR is merged to main (PRs labeled `cycle-NNN`)
2. The cycle introduced significant architectural changes (not bug-fix-only cycles)
3. The Bridgebuilder review scored >= [3, *] on architectural depth

**Not every PR gets a ceremony.** Bug fixes, dependency bumps, and minor refactors are excluded.

## Who Participates

| Role | Responsibility |
|------|---------------|
| **The engineer who merged** | Writes the artifact — captures what was built and why |
| **The Bridgebuilder** | Reviewer/witness — the review that prompted the cycle feeds into the ceremony |

## Artifact Format

**Directory:** `grimoires/loa/ceremonies/`

**Filename:** `YYYY-MM-DD-cycle-NNN-{slug}.md`

**Required Sections:**

```markdown
# Ceremony: {Cycle Title}

**Cycle:** cycle-NNN
**PR:** #{number}
**Date:** YYYY-MM-DD
**Participants:** {who was involved}

## What Was Built

{Factual summary of technical changes — features, components, specifications.}

## Why It Matters

{The "so what?" — how these changes advance the project's purpose.
What architectural invariants were established or strengthened?}

## Identity Change

{How the project's identity shifted. New capabilities, new vocabulary,
new constraints that didn't exist before.}

## Remaining Questions

{Honest accounting of what's still unresolved. Open design questions,
deferred decisions, known limitations introduced by this cycle.
These feed into the next cycle's Bridgebuilder review.}
```

## How It Connects

Ceremonies create a feedback loop:

```
Bridgebuilder review → identifies gaps → cycle addresses gaps
    → ceremony captures meaning → feeds next Bridgebuilder review
```

The "Remaining Questions" section is particularly important — it provides the Bridgebuilder with grounded starting points for the next review cycle rather than requiring cold-start analysis.

## Index

| Date | Cycle | Slug | PR |
|------|-------|------|----|
| 2026-02-24 | cycle-039 | protocol-convergence | #94 |
