---
brief: tenant-housekeeping
date: 2026-05-28
persona: KRANZ × GECKO
status: DRAFT · operator-decision input · not a runbook (no Mirror act yet)
scope: cluster-wide · 10 user-data surfaces per world-atlas v0.2
trigger: GECKO Patrol D surfaced 5 declarative-stub tenants + 1 archive-only tenant + double-sync drift risk · operator may not have known they were paying for these
---

# Tenant Housekeeping Brief (2026-05-28)

> KRANZ + GECKO finding: the cluster has more Railway-provisioned tenant infrastructure than the unified-spine roadmap actively uses. Some is paid-for-but-unused, some is alive-but-drifting. This brief surfaces decisions for the operator to make before more cycles add to the surface. Not a runbook — there's no Mirror act here yet. Decisions first; runbooks per chosen path second.

## The territory

Per `freeside-auth/packages/engine/src/tenants.yaml` + Patrol D Railway inventory:

| Tenant | Status | Substrate state | Recommendation candidate |
|---|---|---|---|
| `mibera` | 🔥 ACTIVE | midi_profiles writes live; spine partial (3/192) | Keep — Move 1 substrate-prep landing |
| `cubquest` | 🔥 ACTIVE | profiles writes live; not in spine yet | Keep — Move 2 substrate-prep next |
| `score-mibera` | 🔥 ACTIVE | dynamic_users sync; dashboard surface | Keep — sovereign score work |
| `apdao` | 🌑 DECLARATIVE-STUB | No user data; config tenant | **Audit** — is there an apdao frontend? what does this serve? |
| `honeyjar` | 🌑 DECLARATIVE-STUB | No user data; telemetry per `tenants.yaml` | **Audit** — telemetry into what? are we ingesting? |
| `interpol` | 🌑 DECLARATIVE-STUB | sf_users table exists, adapter returns null | **Audit** — abandoned migration target? what's "sf"? |
| `validator` | 🌑 DECLARATIVE-STUB | No user data | **Audit** — validator dashboard? |
| `henlo` | 🌑 DECLARATIVE-STUB | henlo_profiles table exists, adapter returns null | **Audit** — henlo project state? |
| `henlo-old` | ⚰️ ARCHIVE-ONLY | crew_members frozen snapshot; `archive_only=true` | **Cancel-or-cold-storage** — Railway billing on a dead snapshot |
| `thj` | 🌑 ROW EXISTS, ZERO CLAIMS | seeded but unused | Keep row; revisit if THJ surface revives |

## The drift risk (score-api ↔ score-mibera double-sync)

Both repos run `sync-dynamic.ts` against the same Dynamic environment. Two `dynamic_users` tables in two different databases (score-api Supabase + score-mibera Railway). They WILL drift — the Dynamic API is the source-of-truth but the syncs are independent.

**Decision needed:** which is canonical?
- score-api Supabase has the older migration (`20260129_001_CREATE_dynamic_users.sql`, Jan 29 2026)
- score-mibera Railway is part of the sovereign-migration arc (post-2026-05-04)

**Recommendation candidate:** score-mibera Railway is canonical going forward; score-api Supabase sync deprecates after one full cycle of overlap-period reconciliation.

## Decision framework (KRANZ-style)

For each declarative-stub tenant, the operator's call:

1. **Active surface check** — does a frontend exist / is there a deployed app / is anyone touching this?
2. **Billing surface check** — is the Railway project costing money? (`railway status` per project; or operator-level cost report)
3. **Cycle alignment check** — is this on the roadmap (this quarter? next quarter? never)?
4. **Choice:**
   - **WIRE** — bring it into the unified-spine plan with a Move-N runbook
   - **PARK** — keep Railway project provisioned, mark as "intent retained" in `tenants.yaml`, no spine work
   - **CANCEL** — tear down Railway project, mark as `archive_only` or remove from `tenants.yaml`

## Recommendation candidates (operator-input required)

### Immediate (billing waste, high-confidence)

- **`henlo-old`** — already `archive_only=true`. Either downgrade Railway plan to free-tier, OR snapshot to S3 + decommission Railway project. Estimated billing recovery: $20-50/mo (typical small Railway PG).

### Audit-required (medium-confidence)

- **`apdao`** + **`honeyjar`** + **`validator`** — config-only tenants per `tenants.yaml`. If no active surface uses them, downgrade to free-tier or cancel.
- **`interpol`** + **`henlo`** — declarative-stub adapters; `sf_users` and `henlo_profiles` tables exist but adapters return null. Were these started as migration targets? Are the user-tables populated? If yes, they're legitimate cold data we need to preserve; if no, they're empty Railway PG instances we can downgrade.

### Drift fix (urgency: medium)

- **score-api ↔ score-mibera double-sync** — pick canonical, document overlap period, schedule deprecation. The risk grows with each day of independent sync.

## Composition with the unified-auth migration

Tenant housekeeping is OPERATOR-LATITUDE work, not pre-Move-1-gate work. It can run in parallel with Phase 0-1 (current spine substrate-prep). The benefit: cleaner ground for future Moves. The risk if deferred: when Move 7 / Move 8 arrives and operator asks "what's the apdao migration target?", we re-derive context that this brief captured.

## How to extend

When operator's housekeeping decisions land:
1. Update `freeside-auth/packages/engine/src/tenants.yaml` per chosen path
2. Update `world-atlas-vN.md` to reflect decisions
3. If decision is WIRE, author a Move-N runbook in `cultivations/`
4. If decision is CANCEL, document the Railway project teardown procedure (snapshot, env-var save, cancellation timestamp)

## Open question for operator

When you said "we have other databases with users as well + Dynamic database which we downloaded" — Patrol D found the LIVE Dynamic pipeline (`sync-dynamic.ts` polling Dynamic's API into `dynamic_users` tables in score-api + score-mibera). Was your "downloaded" reference to that pipeline (i.e., already-ingested), or did you mean a separate one-shot bulk export bundle that this brief should help locate?
