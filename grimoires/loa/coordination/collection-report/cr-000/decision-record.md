# CR-000 Decision Record — Discord restricted-tier viability

| Field | Value |
|-------|-------|
| Task ID | `CR-000` |
| Title | Discord restricted-tier viability go/no-go |
| Primary repository (sprint) | `loa-freeside/packages/services/shadow-audit` |
| Coordination branch | `coord/collection-report-coordinator-f09.10` |
| Audit tip (origin/main equivalent in this worktree) | `3782fd47e8a20cdaf6325621962bd0443e6781b8` |
| Decision state | **`pending`** |
| Restricted T2 status | **disabled** (fail-closed while pending) |
| T0 / T1 status | **intact** (continue regardless of CR-000) |
| Fabricated outcome | none — no Go, No-go, owner identity, approval, or signature |

---

## 1. Current decision state

**`pending`**

Meaning under sprint CR-000 / G-1:

- Public Discord documentation has been collected into a grounded source packet.
- Repository non-secret evidence about Discord integration and Shadow Audit
  RoleSnapshot / Gateway boundaries has been audited.
- Private Developer Portal evidence, owner identities, and dual signatures are
  **absent**.
- Therefore the decision is neither Go nor No-go.
- Restricted-tier (T2) Gate Leak remains disabled.
- Unknown/pending becomes No-go **only** at the ratified deadline below, not
  earlier.

---

## 2. Issue-start time and 10-business-day deadline

### 2.1 Issue start

| Field | Value |
|-------|-------|
| `issue_start_at` | `2026-07-16T08:49:00Z` |
| `issue_start_date_utc` | `2026-07-16` (Thursday) |
| Basis | KRANZ autonomous dispatch CR-000 room open on this branch |

### 2.2 Deterministic deadline semantics

These rules are fixed for this record and must not be reinterpreted ad hoc:

1. **Calendar:** UTC dates only.
2. **Business day:** Monday–Friday. No holiday calendar is ratified in this
   room; weekends are excluded and no holidays are skipped unless a later
   signed amendment records an explicit holiday set.
3. **Counting:** Count **10 weekdays strictly after** `issue_start_date_utc`.
   The issue-start calendar day itself is not counted as one of the ten.
4. **Deadline instant:** End of the 10th counted business day in UTC:
   `YYYY-MM-DDT23:59:59Z`.
5. **Late state rule:** If, at the deadline instant, the dual sign-offs are
   missing, incomplete, or the decision remains `pending` / unknown, the
   decision **automatically becomes `no-go` for T2**. This conversion happens
   only at the deadline, never early.
6. **Early No-go:** Allowed only if an authorized Discord application owner and
   privacy/security owner **explicitly sign a No-go** before the deadline.
7. **Early Go:** Allowed only if all required private evidence is attached and
   both owners sign Go before the deadline. Public-policy notes alone are
   insufficient.

### 2.3 Computed deadline for this issue

Counted business days after `2026-07-16`:

1. `2026-07-17` (Fri)
2. `2026-07-20` (Mon)
3. `2026-07-21` (Tue)
4. `2026-07-22` (Wed)
5. `2026-07-23` (Thu)
6. `2026-07-24` (Fri)
7. `2026-07-27` (Mon)
8. `2026-07-28` (Tue)
9. `2026-07-29` (Wed)
10. `2026-07-30` (Thu)

| Field | Value |
|-------|-------|
| `decision_deadline_at` | `2026-07-30T23:59:59Z` |
| Auto-consequence if still pending | `no-go` for T2; T0/T1 remain intact |

---

## 3. Current public-policy findings

Source of truth for public Discord policy in this room:

`grimoires/loa/research/collection-report-cr000-source-packet.md`
(accessed `2026-07-16`; Exa route unavailable — `EXA_API_KEY` absent)

Findings recorded from that packet (not from private portal state):

| Topic | Public finding | Status |
|-------|----------------|--------|
| Privileged intent | `GUILD_MEMBERS` is privileged; Developer Portal enablement required; apps subject to review need approval; unauthorized use can close Gateway with `4014` | documented |
| Member list / REST | Complete member list / guild member listing requires `GUILD_MEMBERS`; pages/chunks at most 1,000; request limited to one guild ID | documented |
| Scale threshold (2026-06-11 guidance) | Apps under 10,000 guild-installed users may enable privileged intents without review; at 10,000, review is required with owner notice and 90 days to apply | documented (threshold only; **Freeside count = pending**) |
| Developer Policy | API data only as necessary for stated functionality; no profiling of users/identities/relationships; respect opt-out; no mining/scraping | documented |
| Developer Terms | Public current privacy policy required; update/delete API data when unnecessary or requested; encryption at rest + safeguards; material changes may need renewed App Review | documented |
| Proposed Gate Leak purpose | Member-data joined to wallet identity for stale-access audit | **not established as authorized** by public docs alone |

Safe interim interpretation (from packet; retained here):

> Public documentation establishes technical dependence on `GUILD_MEMBERS`, but
> does **not** establish that the current Freeside Discord application is
> authorized for the proposed member-data-plus-wallet purpose.

Link probe notes: see [`link-validation.md`](./link-validation.md).

---

## 4. Repository non-secret evidence (summary)

Full citations: [`repository-evidence.md`](./repository-evidence.md).

Proven from `origin/main` tip `3782fd47…` without reading secrets:

| Area | What code/docs prove | What they do **not** prove |
|------|----------------------|----------------------------|
| Discord application integration | Sietch Discord service, worker, and `apps/ingestor` construct `discord.js` clients and login via `DISCORD_BOT_TOKEN`; slash-command registration takes a `clientId` argument | Live Application ID, team ownership, verification/review state |
| Configured intents (code) | Multiple clients request `GatewayIntentBits.GuildMembers` (and other intents including `MessageContent` / `GuildPresences` in some entrypoints) | That privileged intents are enabled or approved in the Developer Portal |
| Setup docs | `themes/sietch/docs/discord-setup.md` instructs operators to turn **Server Members Intent** ON in the portal | That production followed that checklist |
| Guild / member scale | No production guild-installed user count in-repo; sandbox IaC lists a named sandbox server id only | Whether the app is under/over Discord’s 10,000-user review threshold |
| Privacy policy | No verified live public privacy-policy URL describing Gate Leak member+wallet use; `https://0xhoneyjar.xyz/privacy` probed → final `404` | Existence/currency of the required public privacy policy |
| Shadow Audit RoleSnapshot | `RoleSnapshot` schema + file-backed `ROLE_SNAPSHOT_PATH` loader; dogfood-full refuses without snapshot; k-anonymity via `AUDIT_K` | Live Gateway-bound `discord_role_snapshot.v1` producer authorization |
| Planned Gateway boundary (SDD) | SDD requires privileged `GUILD_MEMBERS`, Gateway epoch/sequence completeness, and external gating before restricted producer use | That those permissions exist today |

**Boundary rule:** environment-variable *names* (`DISCORD_BOT_TOKEN`,
`DISCORD_GUILD_ID`, `ROLE_SNAPSHOT_PATH`, etc.) are configuration seams only.
They are not evidence of portal toggles, review approval, or ownership.

---

## 5. Private evidence gaps (must stay `pending`)

All of the following are **pending** human/private evidence:

1. Discord Application ID for the production/relevant bot.
2. Team / application owner identity (role filled by a named human).
3. Bot verification / App Review state.
4. Whether `GUILD_MEMBERS` is enabled in the Developer Portal.
5. Whether privileged-intent review applies and, if so, approval/conditions.
6. Exact submitted use case for member data + wallet join (Gate Leak).
7. Current guild-installed user count vs Discord’s 10,000 threshold.
8. Current public privacy-policy URL and whether it covers the proposed use,
   retention, deletion, and safeguards.
9. Discord application owner Go/No-go signature.
10. Privacy/security owner determination and Go/No-go signature.
11. Evidence digests for attached private artifacts (portal screenshots /
    exports) — slots exist in the authority template, values empty.

---

## 6. Owners required (roles — identities pending)

| Role | Responsibility | Named person | Status |
|------|----------------|--------------|--------|
| Discord application owner | Prove portal verification/intents/limits; sign Go/No-go; own renewal | `pending` | required |
| Privacy / security owner | Determine Developer Terms/Policy fit for member+wallet purpose; sign Go/No-go | `pending` | required |
| Shadow Audit maintainer (coordination) | Keep restricted producer fail-closed until Go authority version exists | role per sprint | not a substitute for the two signatures |

No individual names are asserted by this room.

---

## 7. Explicit T0 / T1 / T2 consequences

| Tier | Meaning (sprint) | CR-000 `pending` | CR-000 Go | CR-000 No-go (signed early or auto at deadline) |
|------|------------------|------------------|-----------|--------------------------------------------------|
| **T0 Recognition** | Collection question, candidates, support demand; no report order | **continues** | continues | **continues** |
| **T1 Public preparation** | Controlled public-chain fixtures; no production Gate Leak artifact / identity data | **continues** | continues | **continues** |
| **T2 Gate Leak release** | Production report orders, restricted evidence, artifact, Reports/attention | **disabled** | may proceed only with other G1B/G3/G4 gates | **stopped**; Gate Leak visibly unavailable with honest external-dependency reason; **no** aggregate-only fallback; **do not** alter existing bot production permissions |

Checkpoint C0: T0/T1 continue regardless; T2 stops on No-go. While pending, treat
T2 the same as not-yet-authorized: disabled.

---

## 8. Renewal and revocation behavior (authority lifecycle)

When a Go authority record is later ratified (not now), sprint CR-000 requires:

| Event | Behavior |
|-------|----------|
| Authority shape | Versioned Discord-policy authority record: owner, evidence digest, approved purposes/data classes, effective time, 90-day expiry or earlier review date, emergency revocation; version enters restricted work keys / projections |
| Standing renewal | Discord application owner checks at day 60 and every 60 days while restricted program is active |
| No-change renewal before expiry | New authority version; does **not** quarantine in-flight work |
| Changed evidence on renewal | Requires fresh privacy/security approval |
| Missed renewal | Same as expiry |
| Expiry, ownership/terms/intent change, or revocation | Stop new restricted work; quarantine in-flight work; start disposal review until a new Go is ratified |
| Denial / No-go | Leave T0/T1 intact; do not invent aggregate-only Gate Leak; do not touch existing bot production permissions |

Until Go exists, the pending authority template holds empty digest/signature
slots and `decision: pending`.

---

## 9. Machine-readable pending authority

See [`pending-authority-record.yaml`](./pending-authority-record.yaml)
Schema: [`pending-authority-record.schema.json`](./pending-authority-record.schema.json)

Current authority version in that file: `cr000-pending-0`.
It is **not** a Go record and must not enter restricted work keys as approval.

---

## 10. Sign-off blocks (exact — leave blank until humans sign)

### 10.1 Discord application owner

```
Role: Discord application owner
Name: ______________________________
Contact: ___________________________
Application ID attested: ___________
Guild-installed user count band attested (under / at-or-over 10,000): ___________
GUILD_MEMBERS portal state attested (enabled / not enabled / review-approved / review-pending / N/A): ___________
Decision: [ ] Go   [ ] No-go
Evidence attachments / digests referenced: ___________
Signature: __________________________
Signed at (UTC): ____________________
```

### 10.2 Privacy / security owner

```
Role: Privacy / security owner
Name: ______________________________
Contact: ___________________________
Privacy policy URL attested current: ___________
Member-data + wallet join purpose determination: [ ] permitted as proposed   [ ] not permitted   [ ] permitted only with conditions:
Conditions (if any): ________________
Retention / deletion / encryption determination recorded: [ ] yes   [ ] no
Decision: [ ] Go   [ ] No-go
Evidence attachments / digests referenced: ___________
Signature: __________________________
Signed at (UTC): ____________________
```

### 10.3 Joint ratification gate

A Go is valid only when:

1. Both blocks above are marked Go with non-empty names and UTC timestamps;
2. Evidence checklist critical items are complete (see
   [`evidence-checklist.md`](./evidence-checklist.md));
3. `pending-authority-record.yaml` is upgraded to a non-pending version with
   filled digests, purposes, effective/expiry times, renewal owner, and
   revocation contacts;
4. Restricted work keys may then reference that authority version.

A No-go is valid when either owner signs No-go, or when the deadline auto-rule
in §2 fires.

---

## 11. Record history

| UTC | Event |
|-----|-------|
| `2026-07-16T08:49:00Z` | Issue start — CR-000 evidence room opened; decision = `pending`; T2 disabled |
| `2026-07-16` | Public-policy packet grounded; repository audit written; authority template + checklist published |

No Go/No-go ratification has occurred.
