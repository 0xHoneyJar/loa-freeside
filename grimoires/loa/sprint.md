# Sprint Plan — Consumption Truth

> Cycle: consumption-truth (simstim-20260702-323be229). Implements `sdd.md` (flatline-integrated
> `e5075870`). Previous plan archived: sprint.prev-2026-07-01-fulfillment-surface.md.
> Sprint 1 = the ONLY `/run sprint-plan`-executable sprint (in-repo, `platform/ordering` +
> `shared/planning`). Sprints 2–3 are coordination/operator lanes per the PRD's Cross-Repo
> Execution Contract — run-mode MUST NOT attempt them; they carry [OPERATOR-BOUNDED] or
> [CROSS-REPO] markers and are tracked as beads that detach, never block.
> Sequencing (NOT beads blocked-by, ADR-007 rule 5): S1 → S2 (flags+E2E) → S3 (read plane, parallel-ok).

## Sprint 1: shadow probe leg + fence (in-repo, PR-A `platform/ordering`)

**Goal**: the probe mesh's missing `shadow` leg exists, fail-closed, fully mapped; the sibling
fence has teeth. (FR-2, G-6; enables G-1/G-2)

### S1-T0 — Sibling fence with teeth [G-6]
`tools/check-sibling-fence.sh` per SDD §8: fence list derived from `gh pr view 422 --json files`
(record derivation date + head SHA in script header); `git diff --name-only origin/main...HEAD`
vs fence → exit 1 on hit. **AC**: script exits 0 on current branch; exits 1 when a fence path is
touched in a test scenario; exit code never piped.

### S1-T1 — Shadow-audit deployed auth contract, observed [SDD §2 gate — no probe code before this]
Read `packages/services/shadow-audit/src/http/audit-router.ts` auth middleware + one live request
against the deployed shadow-audit URL; record header name, success/401 shapes, and the deployed
URL in `grimoires/loa/runbooks/consumption-truth-e2e.md` (create scaffold).
**Credentials rule (blocker cure)**: credentials come ONLY from operator-held env
(existing Railway service config / operator-provided env var at execution time) — the agent never
mints, requests, or copies keys elsewhere. If no credential is available to this session, the live
half moves to S2-L1 (operator lane) and this task closes on the code-read half alone.
**Runbook redaction rule**: quote status codes + body FIELD SHAPES only — never auth headers,
tokens, or full raw bodies.
**AC**: runbook quotes an OBSERVED response (status + redacted shape); the auth header name is a
config decision, written down. Unreachable/no-creds → task closes as "contract unresolved, shadow
stays stub" and S1-T2/T3 proceed with fail-closed default config (feature dark until S2 resolves it).

### S1-T2 — `probeShadow` + total status map [FR-2]
`http-building-probes.ts`: optional `shadowAuditApiUrl` + `shadowAuditAuthHeader` config;
`probeShadow()` in the `probeScore` shape; `mapShadowStatus` implementing the SDD §2 table
(200+result→complete · 200-partial→pending+warn · 404→pending · 401/403→blocked auth_misconfig ·
429→pending · 5xx/network→blocked · timeout 10s→blocked · redirects→final status).
Env naming pinned (one convention, blocker-adjacent IMP-004): `SHADOW_AUDIT_API_URL`,
`SHADOW_AUDIT_AUTH_HEADER` (optional, default `authorization`) — no aliases.
**AC**: one test per table row (8 rows), fromEnv with/without `SHADOW_AUDIT_API_URL`; absence of
the shadow URL leaves the sonar/score/worlds trio fully enabled; **feature-dark proof (blocker
cure)**: an explicit test asserting unset-URL → shadow stays on stub (`blocked`), PLUS one startup
log line `shadow probe: DARK (stub)` when HTTP probes are enabled without the shadow URL — the
darkness is observable in deployed logs, not assumed.

### S1-T3 — Triage-port delegation [FR-2]
`kitchen-triage-ports.ts:37-39`: `shadow.probe` delegates to `http.probeShadow` iff configured,
else stub fallback (behavior-preserving when unset). **AC**: delegation test + fallback test;
existing suite stays green (`pnpm test` in `packages/services/ordering`).

### S1-T4 — Cycle PR
PR-A from this worktree branch: S1-T0..T3 + grimoire artifacts. Draft, `platform/ordering` scope,
fence script green in the PR body evidence. **AC**: PR open, unit tests green locally, fence 0.

## S2 lanes — flags, spike, settle gate (NOT run-mode executable; no `Sprint N:` header by design)

- **S2-L1 [OPERATOR-BOUNDED]** — Railway env truth (FR-3): verify/flip `ENABLE_REPROBE`,
  `KITCHEN_PROBE_HTTP_ENABLED`, trio URLs + `SERVICE_TOKEN`, add `SHADOW_AUDIT_API_URL` (post
  S1-T1 contract). Confirm `SONAR_API_URL` (kitchen-api host) serves
  `/v1/collections/:chain/:contract/status`. **Evidence**: `freeside kitchen probe` +
  `order status` show fresh `probe_meta`; Railway log shows worker cadence.
- **S2-L2 [CROSS-REPO sonar-api, timebox 1 day]** — #120 spike per SDD §7. Exit: fix PR or
  diagnosis doc + /coord lane; decides G-1 subject (real Azuki vs OP-chain pivot).
- **S2-L3 [AGENT + operator gates]** — E2E per SDD §4 under the PRD's Live-Order Safety Protocol,
  concretized (blocker cure): *zero-spend* (community-onboarding ingredient advancement performs no
  payment interaction; if ANY payment-bearing hop appears, halt — out of protocol); *abort
  conditions* = ambiguous probe state, any non-2xx on advance, evidence/CAS mismatch, or fence/
  check failure → halt in place (partially-advanced is a valid persistent state per SDD §4) and
  surface to operator; *operator confirmation points* = (1) before the first touch of the REAL
  order, (2) before the fulfill flip that sets `world_slug`. Dry-run fresh OP-chain order first
  (incl. CAS replay-rejection evidence). **Evidence**: runbook quotes every verb call, exit codes,
  `probe_meta` trail. THIS CLOSES G-1.

## S3 lanes — read plane + orientation (parallel, detachable; NOT run-mode executable)

- **S3-L1 [AGENT→operator]** — Privacy Gate evidence per SDD §5, with repo-artifact hygiene
  (blocker cure): probe using an OPERATOR-OWNED wallet address only (never an arbitrary user's);
  the runbook records field NAMES + types + one operator-wallet example — full raw dumps of other
  wallets never enter repo artifacts. Apply ALLOWED/FORBIDDEN criteria, operator sign-off line.
  FORBIDDEN hit → posture falls back, lane ends honestly.
- **S3-L2 [CROSS-REPO inventory-api]** — merge #18 beacon serving; fix registry `beacon_url`
  (in loa-freeside, small follow-up commit on this branch); `app.ts` docstring drift.
- **S3-L3 [OPERATOR-BOUNDED]** — un-wall + DNS per gate outcome; rate-limit stays.
- **S3-L4 [CROSS-REPO dashboard]** — fail-loud inventory client (typed result, surfaced error
  state, structured log) + `buildings.ts` (~3 sites). One PR, Cursor reviews.
- **S3-L5 [CROSS-REPO dashboard+characters]** — AGENTS.md orientation stubs per SDD §6 content
  contract + characters `AGENTS.md:1` repair + characters `buildings.ts` (~10 sites). One PR per
  repo, additive files only.

## Lane detachment (durable, IMP-002)
A lane that detaches files a bead (`br create`) carrying: the lane id, unresolved state, evidence
gathered so far (runbook pointer), follow-up owner, and the `domain:` label — detachment without a
bead is not detachment, it's dropping.

## PR readiness rule (IMP-006)
PR-A opens DRAFT; flips ready when S1 ACs are green + fence exit 0 + local `pnpm test` green in
`packages/services/ordering`. Merge is the operator's (cross-repo contract). S2 contract
resolution does NOT block PR-A merge — shadow ships fail-closed dark by design.

## Fence git semantics (IMP-003)
`tools/check-sibling-fence.sh` fetches `origin main` before diffing (`git fetch origin main`) and
diffs `origin/main...HEAD` (three-dot, merge-base) so a stale local main can't blind the fence.

## Acceptance for the cycle
G-1 evidence in the runbook (S2-L3) + S1 PR merged + at least S3-L1 gate decided. Everything else
detaches to beads without blocking cycle close.
