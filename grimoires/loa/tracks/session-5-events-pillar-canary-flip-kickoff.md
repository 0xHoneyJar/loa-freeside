---
session: 5
date: 2026-05-27
type: kickoff
status: planned
parent_session: cycle close session 2026-05-27 (5 PRs merged + 2 runbooks + crypto prep)
---

# Session 5 — cluster-events-pillar-v1 canary flip (kickoff)

## Scope

- Execute the operator-driven go-live drill (Path D Railway · managed NATS preferred)
- Resolve the open Synadia-vs-self-host decision
- Land the substrate AD-1 adapter (NATS_CREDS_FILE_CONTENT support) if Synadia chosen — 1 small PR per consumer
- Wire env + deploy dash to Railway · sonar to Envio · characters bot to Railway
- Observe before flip · canary on · promote
- Distill (KRANZ act 5) — cycle close retrospective

## Artifacts (this kickoff)

- Build doc: `grimoires/loa/specs/cluster-events-pillar-v1/next-session-canary-flip.md`
- Parent runbook: `grimoires/loa/specs/cluster-events-pillar-v1/go-live-path-d-railway.md` (PR #240 — may be open at session start)
- General drill: `grimoires/loa/specs/cluster-events-pillar-v1/go-live-checklist.md` (merged #239)

## Prior session shipped

- 5 cluster PRs merged: loa-freeside#227 #229 · sonar-api#24 · freeside-characters#105 #106
- 2 cycle docs: #239 (general drill) · #240 (Path D Railway — may still be open)
- Cryptographic prep: sonar Ed25519 seed (mode 0600) + JWKS doc (hostable)
- Dash verified booting locally on :3030

## Decisions made this session

- Operator chose Railway-first deploy posture (AWS NLB deferred until pressure proves needed)
- Substrate portability is operator-stated invariant: `NatsLike` interface is the bus-swap point
- Path D actuation > Path A; managed NATS preferred over self-host (operator-leaning)
- Ground-check linter caught + fixed a confabulated Synadia URL in the runbook — substrate-validation layer is real

## Open decisions for next session

1. **Synadia (a) vs self-host nats-server (b)** — pick before step 2 of the runbook
2. **AD-1 substrate adapter** — if (a), commit to ~60 lines of library evolution before step 5
3. **JWKS host** — Vercel vs gist vs Cloudflare Pages (any works; pick by least operator-friction)
4. **Discord test channel** — operator picks the canary target; Copy ID before step 5

## Risks

- Synadia free tier limits (unlikely to bite on MST volume; flag if it does)
- JWKS publication mismatch with sonar pubkey → every envelope shows `signature-invalid` in dash (loud, fixable by re-publishing JWKS)
- Bot's Railway URL may not exist yet (probed earlier · 404) — may need new Railway project rather than env-update existing

## Cycle status when this session opens

- Coord at `~/bonfire/cluster-events-pillar-coordinator/`: 3/3 beads closed · 8 follow-up beads queued
- All 5 PRs merged on respective mains
- Tests at every layer green (events lib 65/0 · sonar 11/0 · characters events 46/0 · dash smoke 3/3)
- Operational substrate: NOT yet wired (this is what session 5 resolves)
