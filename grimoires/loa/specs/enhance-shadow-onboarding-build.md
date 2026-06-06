---
title: "Build Handoff — shadow-onboarding-substrate (next session)"
trust_tier: ai-derived
read_state: unread
use_label: use_as_background_only
confidence: 0.50
decay_class: working
last_confirmed: 2026-06-01
---

# Build Handoff — shadow-onboarding-substrate (next session)

> The planning trilogy is done + flatline-hardened + committed. This is the orienting
> layer over it — NOT a duplicate. The sprint plan, SDD, and PRD are the source of truth.

## Context

Build the **medium-agnostic shadow-mode onboarding substrate** + the before/after comparison.
Shadow = a **universal preview/diff primitive** (current→proposed for any consume-or-mockable
feature). **worlds-api owns + distributes** a pure Effect git-source package
`@freeside-worlds/shadow-substrate`; **characters/dashboard are voiceless I/O actors**. The "after"
surfaces **latent qualified-but-not-joined members = leads** (mocked for MVP). MVP = role
assign+create+scaffold, shadow-first, on **Purupuru**; web-DOM render. All three planning artifacts
are flatline-hardened (PRD: 8HC+9B+2D · SDD v1.2: 8HC+15B · sprint v1.1: 5HC+10B+5D).

## Run via — `code-implement-and-review`, orchestrated cross-repo by `/coord` (REQUIRED)

The build is **cross-repo** (worlds-api → characters → dashboard). It runs through:

- **`/coord`** (cross-repo orchestration): `~/bonfire/construct-compositions/compositions/discovery/`
  is the kickoff; the BUILD coordinator is bootstrapped via `/coord` — dispatch each sprint to its
  `[repo:]` tag (headless agents into the target repos). Cockpit: `~/bonfire/<coordinator>/cockpit.sh`.
- **Per sprint/task: `code-implement-and-review`**
  (`~/bonfire/construct-compositions/compositions/delivery/code-implement-and-review.yaml`) — the loop:
  **implement → adversarial review → fix → converge (≤3 iter)**. Reviewer substrate = **`/fagan`**
  (codex-review is deprecated; the composition names the loop *shape*). **Operator directs at the
  review seam** + the sprint boundaries — that's where rich feedback enters.

So: `/coord` fans S0→S4 across repos; each runs the implement→/fagan→converge loop; the operator
curates at the review seam. (Flatline already owns the PRD/SDD/sprint review — done.)

## Load Order (next session reads, in order)

1. `~/bonfire/construct-compositions/compositions/delivery/code-implement-and-review.yaml` — the loop
2. `grimoires/loa/cycles/shadow-onboarding-substrate/sprint.md` (v1.1) — the 5 sprints + tasks + disposition
3. `grimoires/loa/cycles/shadow-onboarding-substrate/sdd.md` (v1.2) — the design (state machine, gate, ports)
4. `grimoires/loa/cycles/shadow-onboarding-substrate/prd.md` — the why (goals, FRs, the leads reveal)
5. memory `project_shadow-onboarding-cycle` — the resume context (design calls, tunables, branch state)

## Persona

ARCH (the-arcade / OSTROM) for the substrate structure + **protocol/noether** lens for the contract
surfaces; **EffectTS** throughout. The bot side is voiceless (governor/speaker — worlds-api governs).

## What to Build (keystone-first; detail in sprint.md)

- **S0 (401, worlds-api)** — pure core: `computeProposed`/`diff`/`roleMapVersionHash`(rules-only)/
  `transition` + error ADT + ports + the `Discrepancy` render-model + git-source distribution. **Ship
  the visualizable contract first** so the dashboard builds on mock immediately.
- **S1 (402, worlds-api)** — the provable gate: `GateCheckedRoleWriter` (invocation-time mode read +
  batch mode-lock), `WriteCapability` (compile-time accident-prevention, NOT runtime security),
  async `WriteIntentBatch` (idempotency, 429 backoff, `roles_created` ledger, per-world advisory lock),
  `resolveAuthz` preflight, ACVP events, write-after-audit, **§8.4 property test = the G-3 gate**.
- **S2 (403, worlds-api)** — config surfaces (role-map · apply-mode · onboarding-lifecycle keyed
  `world×surface×cm_identity`); **FR-10 authz floor** (`admin_principals` on the world manifest +
  `resolveReader` + TTL≤10s + go_live fresh re-check) — closes the any-bearer R-3 hole.
- **S3 (404, dashboard)** — the animated before/after on **mocked** latent data (`source:"MOCK"`);
  resumable cross-medium stepper; go-live/rollback + job polling; comparison **distinguishes
  Freeside-managed vs pre-existing roles**; Vercel build cred for the private git-tarball.
- **S4 (405, characters)** — live/mock Discord Layers (the mock↔live switch), cross-repo import-boundary
  enforcement, FR-9 coexistence (namespaced roles) + non-destructive rollback (GC unassigned), 250-role
  check, `purupuru.yaml`, `CONFIG_SERVICE_URL` cutover, **E2E (validates 6 goals)**.

## Design Rules (the SDD invariants — non-negotiable)

- Side-effect (role write/create) authorized **IFF `apply_mode == LIVE` AND CM authorized** — enforced
  **substrate-side** in `GateCheckedRoleWriter`, audited (write-after-audit). Provable: shadow ⇒ zero writes.
- `roleMapVersionHash` = **rules only** (role_rules + scaffolding + world_config); roster freshness is a
  **separate** go_live re-eval (`ROSTER_DRIFT_THRESHOLD=0`, tunable).
- **Pure / effectful split**: `computeProposed`/`diff`/`hash` are pure data-in/data-out;
  `loadRoster`/`loadLatent`/`emitAudit`/`resolveAuthz` are Effect programs (authz = preflight, NOT in transition).
- **Mock-as-shadow-input**: shadow/visualize on mock first; live cutover is for *applying*.
- Motion = perceived improvement (the comparison is FEEL/KANSEI; web-DOM, `motion ^12` — verify lockfile).

## What NOT to Build

Announcements (next feature instance). Real latent-member data (mocked; **score-api is Zerker's** —
flagged #164/#221). Full identity-api `managed-worlds` route (the floor is enough for MVP). Discord
CV2 render (second target, after web).

## Verify

S1's **§8.4 property test** (`@effect/vitest` + `fast-check`) proves "SHADOW ⇒ zero writes" *before* a
live writer exists. S4 cross-repo lint proves a raw `discord.js` write fails CI. S4 **E2E** validates all
6 goals. Each sprint converges through `/fagan` (≤3 iter).

## Key References

| Topic | Path |
|---|---|
| The loop | `~/bonfire/construct-compositions/compositions/delivery/code-implement-and-review.yaml` (review = /fagan) |
| Sprints | `grimoires/loa/cycles/shadow-onboarding-substrate/sprint.md` |
| Design | `…/sdd.md` (v1.2) |
| Why | `…/prd.md` |
| Resume | memory `project_shadow-onboarding-cycle` |
| Branch | `cycle/shadow-onboarding-substrate` (2 commits, **not pushed**) |
| score-api flag | `0xHoneyJar/score-api#164` (+ #221) — not ours |

## Meta-notes (not in the trilogy)

- **2 design calls to review** before/early in the build: WriteCapability = compile-time (not runtime
  security); authz TTL ≤10s + go_live re-check. Operator-tunable: `ROSTER_DRIFT_THRESHOLD`, the S5/406
  E2E-split (not yet ledger-registered).
- **beads is `DEGRADED`** — run `br doctor` clean before creating sprint beads at build time.
- The build dispatches cross-repo; the cycle + coordinator live in loa-freeside.
