# Consumption-Truth cycle — E2E runbook + observed contracts

> Cycle `consumption-truth` (simstim-20260702-323be229). Evidence file for FR-4 (G-1 settle gate)
> and the S1-T1 contract observations. Every claim below is tagged observed (code/probe read
> 2026-07-02) or decided.

## S1-T1 — shadow-audit contract observations (observed)

**HTTP contract** (`packages/services/shadow-audit/src/http/audit-router.ts`):
- `GET /v1/audit` — query REQUIRES `chain`, `contract`, `snapshot_date`, `community`,
  `owner_wallet` (+ optional `threshold`, `gating`; only `nft-balance` gating supported —
  `OrderQuerySchema`, router:93-101). 200 returns protocol `AuditOutput` verbatim; failures
  return `{error: Refusal}` with refusal-specific status; rate-limit returns a Refusal too.
- **Auth**: `X-API-Key` (optional server-side — when `SHADOW_AUDIT_API_KEY` unset, the k-anon
  aggregate is OPEN). NOT `Authorization: Bearer` (DEPLOY.md + router docstring). Any future
  probe adapter must default its auth header to `x-api-key`.

**Deployment truth (observed 2026-07-02)**:
- NO deployed shadow-audit service found: no `registry.yaml` entry, no URL in DEPLOY.md (which is
  instructions, not a record), nothing probeable. Railway ground truth is operator-verifiable in
  S2-L1.
- In-process path is explicitly UNWIRED: ordering `composition.ts:61` wires `NoopAudit` (throws);
  `DeclaredLocalAuditAdapter` exists but "wiring concrete clients is the audit-deploy step (SDD
  §13 M-10)" (declared-local-audit-adapter.ts:13-16).
- Run history cannot back a probe either: `EventStore` has only `getRun(runId)`; `RunEvent` is
  strict and deliberately carries NO chain/contract identity; only an in-memory impl exists.

**Consequence (decided, S1 reshape)**: #401's zero-operator shadow probe is blocked on a MISSING
PRODUCER, not a missing probe. Three producer preconditions, all absent: (a) a live audit surface
(HTTP or wired in-process), (b) a probe-satisfiable read contract (needs `owner_wallet` the
preset doesn't carry, OR a contract-keyed runs-read), (c) durable run history. Building the HTTP
probe leg now would be plumbing to a producer whose contract is undecided — deferred with a bead
to the producer-decision lane. What S1 ships instead: an EXPLICIT availability policy —
`SHADOW_PREVIEW_UNAVAILABLE_POLICY=pending|optional` (default `pending`, conservative). Flipping
it to `optional` is S2-L1's deliberate operator act, and makes fulfillment honestly proceed
without a preview ("capability not deployed") — `canFulfillCommunityOnboarding` already accepts
`complete|optional` (community-onboarding-orchestrator.ts:52). Rollback = unset the var.

## S2-L1 — Railway env truth (operator lane; to fill)

- [ ] `ENABLE_REPROBE` observed value → set `true`
- [ ] `KITCHEN_PROBE_HTTP_ENABLED` observed value → set `true` (requires SERVICE_TOKEN +
      SONAR_API_URL + SCORE_API_URL + WORLDS_API_URL — fromEnv hard-requires all four)
- [ ] Confirm `SONAR_API_URL` host serves `/v1/collections/:chain/:contract/status`
- [ ] Decide `SHADOW_PREVIEW_UNAVAILABLE_POLICY` (=optional to enable zero-operator fulfill
      without a shadow producer; =pending to keep operator advance)
- [ ] Shadow-audit deployment ground truth: does a Railway service exist? (If yes: record URL +
      whether `SHADOW_AUDIT_API_KEY` is set; feeds the probe-leg bead.)

## S2-L3 — G-1 E2E evidence (to fill during the run)

Protocol: PRD Live-Order Safety (zero-spend; abort on ambiguous/non-2xx/CAS-mismatch; operator
confirms (1) first touch of the real order, (2) the fulfill flip). Dry-run first on a fresh
OP-chain order, including ONE deliberate replayed advance to quote the CAS rejection.

| Step | Verb | Exit code | Evidence (probe_meta / event trail) |
|------|------|-----------|--------------------------------------|
| _to fill_ | | | |

## S3-L1 — inventory Privacy Gate (to fill; operator wallet only, field shapes not raw dumps)
