# The Wedge Build Game — shadow-audit migration delta (ICEBREAKER forge)

> /goal 2026-06-29 (AFK, 4:20h): "design a game, forge the tree, crack it" on the VALIDATED wedge.
> Grounds in: the operator-endorsed market brief (attested) — *ship Bet One (shadow-mode access-risk audit) +
> a minimum slice of Bet Two (event ledger + diff webhooks + evidence export), together; the migration delta
> is the buying event; the viral loop is "share the audit with the server owner."* And [[project_cm-access-doctrine-and-propagation]].

## The finding that names the keystone (consumption-gradient)

`diffShadow(records) → DiscrepancyReport` ALREADY EXISTS in `packages/protocol/shadow-audit/src/discrepancy.ts` —
the **Comparison View + Discrepancy Report**: every `AccessDecisionRecord.band` mapped to **promotion** (missing →
should-grant), **demotion** (stale → should-remove), or **no_change**, plus the aggregate + band distribution.
Read-only by construction (never mutates a role — the whole point of Shadow Mode).

**It is built-but-UNCONSUMED** (the cluster's signature failure, [[project_deployed-but-unconsumed-pattern]]):
called only by its own test, NOT exported from the protocol index, absent from the audit output and the
`GET /v1/audit` route. The brief's #1 must-have ("the migration delta that creates a buying event") is one
consumption away. So the keystone is **not to build the delta — it's to CONSUME the delta that exists.**

## The goal-sink (the shippable wedge)

**A shadow-mode access-risk audit that surfaces the migration delta (the Comparison View) and exports it as a
shareable, provenance-bearing artifact** — the report a community runs alongside Collab.Land to see exactly who
would be promoted/demoted at cutover, then shares with the server owner.

## The tree (keystone-first, intra-domain `platform`, raw→consumed belt)

| # | bead | designed gate (the game — gradient-shaped, corroborated not self-graded) |
|---|------|------|
| **K** (keystone) | export `diffShadow` from the protocol index + wire the Comparison View into the authed `AuditOutput` (records → diffShadow → `comparison`). | **CORROBORATE**: fed REAL audit records, `comparison.aggregate.demotions` == the `stale_access` cohort count and `promotions` == `newly_eligible` — two independent computations must agree; mutation-proven (flip a record's band → the comparison moves). |
| T1 | one-click **evidence export** — serialize the Comparison View to CSV + JSON (the viral artifact). | **CUSTODY**: the export round-trips (parse(serialize(x)) == x) and carries the `run_id` + `inputs_hash` provenance so a shared artifact is verifiable, not a screenshot. |
| T2 | the `GET /v1/audit` route returns the `comparison` for authed+community-bound callers (anon gets the k-anon aggregate only). | **CORROBORATE**: authed response includes `comparison.members`; anon response NEVER leaks a wallet (k-anon holds) — a blind check on both. |
| T3 (Bet Two slice) | emit a signed **access-decision event** per decision (the auditable ledger entry — provenance + history). | **CUSTODY**: each event carries the ed25519 signature + `run_id`; re-running the audit is idempotent on the event identity (at-least-once → idempotent, the keystone law). |

**Discipline (why this isn't another pit):** keystone-first (K is the missing consumption; T1–T3 plug in). The gate
refuses shelf-ware — a STANDS-but-BEARS-NO-LOAD wire does not close (K only closes once the Comparison View is read
by a real consumer + corroborated). The generator never settles its own verdict — `/fagan` before any merge; merge +
deploy + bead-close stay operator-gated. erc1155 stays fail-closed off the spine (prior fix).

## Why this is the right cut (the brief, mapped)

K+T1 = **Bet One** shipped (the migration delta + the shareable export = the buying event + the viral loop). T3 =
the **minimum Bet Two slice** (the event ledger). T2 wires the API consumer. Role-by-role exposure + multi-wallet
identity + agent-scopes are designed-for (the records already carry `community`, `provenance`) but deferred — the
brief says ship the wedge first, not the platform.
