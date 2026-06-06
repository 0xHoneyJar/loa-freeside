---
status: candidate
authored: 2026-06-01
origin: cubquests frozen-index incident (ci-leaderboard-frozen-envio-index-zmc)
domain: shared
tags: [sonar, graphql, contract, versioning, coherence, acvp]
---

# The Sonar consumer-contract seam

> Born from the 2026-06-01 belt-gateway cutover, which silently broke **four** CubQuests
> badge consumers, discovered one at a time. The fix worked; the *class* is still open.

## The incident, compressed

One env flip (`NEXT_PUBLIC_GRAPHQL_ENDPOINT`: frozen Envio `914708e` → live Ponder/Hasura
`belt-gateway`) broke, in sequence:

1. leaderboard count (frozen data) → 2. leaderboard icons (`badgeBalances` relation gone) →
3. profile sash (`holdings` key format changed) → 4. badge distribution cron (same).

Every break was a **query whose fields the new schema no longer satisfied, swallowed into an
empty result**. No error surfaced. Each was found only when a human looked at a surface.

## Operator frame, sharpened

> "Centralize our queries/schemas around the Sonar API so it doesn't become flaky, and if we
> upstream-change something, downstream consumers stay consistent without breaking."

Right instinct, but **centralization alone is necessary, not sufficient** — a single shared
client would have broken in one file instead of four. The two things that actually caused the
silence were orthogonal to centralization:

- **No fail-loud.** Consumers checked `response.ok` (HTTP) but never the GraphQL `errors[]`
  array. A 200-with-errors → `[]` → blank surface.
- **No contract check.** Nothing validated a consumer's shipped queries against the live schema
  before deploy.

So the seam is three things, not one:

| Layer | What | Prevents |
|-------|------|----------|
| **One fail-loud client** | a single Sonar SDK that inspects `errors[]`, asserts freshness, degrades loudly | the *silence* |
| **Pre-deploy contract check** | validate every shipped query against the live (or pinned) schema in CI | the *break* reaching prod |
| **Schema versioning** | consumers pin a Sonar schema version; migrations are opt-in, not surprise | the *coupling* to upstream timing |

Public index data → introspection is fair game (the operator's point). That's exactly what makes
the contract check cheap: **just ask the live schema whether our queries still resolve.**

## PoC shipped: `sonar-contract-check`

A working checker (`./sonar-contract-check.mjs`, this dir) walks a consumer repo, extracts every
GraphQL query it ships against a Sonar endpoint, and probes each against the live schema —
turning a silent runtime `[]` into a loud pre-deploy signal. Run against the pre-fix CubQuests
source it correctly flagged `field 'badgeBalances' not found in type 'ponder_v3_badge_holder'`
— **the saga, caught before deploy.** (Limitation: dynamically-assembled queries — e.g. the
quest verifier's variable-built `Action` query — need annotation; the checker false-positives
them as unparseable. Productionization should parse with the `graphql` lib + a query registry.)

## Estate exposure (this is the urgent part)

The hardcoded-query-against-shared-index pattern is **estate-wide**, not CubQuests-only. Survey
of local interface repos:

| Risk | Repo | Endpoint | Error handling |
|------|------|----------|----------------|
| **HIGH** | moneycomb-interface | frozen `914708e` | **swallows errors** → `uniqueHolders: 0` silently (`app/api/holders/route.ts:41`) |
| **HIGH** | community-interface | frozen `914708e` | **swallows errors** (identical pattern) |
| MED | mibera-interface | frozen `914708e` | hardened error handler, but frozen id |
| MED | henlo-interface | frozen `914708e` | graphql-request (throws), no wrapper |
| MED | dove-interface | env (no default) | Apollo, no explicit error path |
| (fixed) | cubquests-interface | → belt-gateway | fail-loud added (#253/#254/#255) |

**5 interfaces point at the frozen `914708e` index.** moneycomb + community likely show wrong
holder counts *right now* with no signal. Filed: see beads below.

## Connection to existing doctrine

This is an **ACVP "declared → proof"** failure at the GraphQL seam: the consumer *declares* a
query; the substrate must *prove* it resolves. And it's a **coherence** instance (map ≠
territory): the dashboard's declared surface diverged from the indexed reality. The contract
check is a coherence-validator probe for the consumer↔substrate seam — it could emit gaps to
the existing coherence-validator substrate.

## Recommended sequence

1. **Now (urgent):** repoint/harden moneycomb + community (silent wrong data); audit the other
   3 frozen-`914708e` consumers.
2. **Soon:** land `sonar-contract-check` (productionized) as a CI gate in each Sonar consumer.
3. **Then:** one fail-loud Sonar client SDK (consolidates `errors[]` + freshness in one place).
4. **Later (operator's "another time"):** Sonar schema versioning + a migration contract so
   upstream changes are opt-in for consumers.

Refs: `ci-leaderboard-frozen-envio-index-zmc`, `arrakis-extract-badge-leaderboard-primitive-rzo2`,
ADR-008 (factory/buildings), `project_coherence-validator-substrate`.
