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

---

## E2E EVIDENCE — executed 2026-07-03 (lanes 1→2→3, operator-authorized "Full E2E")

### Lane 1 — Railway env truth (S2-L1) ✅
Observed BEFORE: `ENABLE_REPROBE=true`, `KITCHEN_PROBE_HTTP_ENABLED=true`, trio URLs + SERVICE_TOKEN
already set; `SHADOW_PREVIEW_UNAVAILABLE_POLICY` ABSENT; deployment predated #424.
Actions: set `SHADOW_PREVIEW_UNAVAILABLE_POLICY=optional`; deployed #424 code (`railway up`,
deployment `cc3138cd` SUCCESS). Deployed log line OBSERVED:
`[ordering-service] shadow_preview producer-less — policy=optional (fulfillment proceeds without preview…)`
+ `write_routes=token` (fail-closed). `SONAR_API_URL` contract confirmed: kitchen-api
`/v1/collections/:chain/:contract/status` → 401 (exists, auth-gated as the Bearer probe expects).

### Lane 2 — order E2E (S2-L3, fixture rule fired) ⚙️ partial-by-ground-truth
Pinned fixture `6ddc06f5` → **404 on the deployed store** (pre-ordering-service artifact). Per the
fulfillment plan's fixture rule, placed a FRESH demo order (real subject, Azuki chain-1):
**`65e94061-5d41-4b91-a1d8-e7277f79ae38`** — placed via
`freeside-cli order place --preset community-onboarding` (zero curl).

Observed within 1s of placement (interval probe, `order status`):
- `worlds_manifest: complete` + **`world_slug: "azuki"` auto-resolved** (config-service knew it)
- `score: in_progress` + http_enqueue job `score:register:1:0xed5a…` fired (real building work)
- `sonar: blocked` — kitchen-api truth for chain-1 Azuki (the #120 boundary, exactly as predicted)
- **`shadow_preview: optional` with `probe_meta.shadow_preview.reason = "policy_optional_no_producer"`**
  — the cycle's shipped surface, live in a production order's durable trail.
- `kitchen probe` (reprobe endpoint): fresh per-ingredient outcomes, source=reprobe ✓.
- Same-value advance (worlds complete→complete): idempotent accept, audit entry carries
  SERVER-derived evidence + token_label ✓ (#420 contract).
- **FINDING (bead arrakis-6hhs)**: operator-token advance CAN DOWNGRADE complete→pending (accepted,
  audit-trailed with contradicting evidence). Recovery PROVEN: next real probe restored
  `worlds_manifest: complete` from ground truth (abort-is-normal, SDD §4).
- Not claimed: reprobe-cooldown 429 (second call was 16s later — outside the 10s window).

Fulfillment gate now blocked ONLY by: `sonar` (=#120 spike lane S2-L2) and `score` (registration
in_progress at score-api). Shadow + worlds + world_slug are green/optional. When those two flip,
`fulfill watch` completes G-1 with zero further code.

### Lane 3 — inventory read plane (S3) ✅ re-pointed, honestly degraded
DISCOVERY: the 401 wall is on a DIFFERENT (older) deployment. The LIVE open read API existed all
along: `inventory-api-production-3f25.up.railway.app` (`/health` 200, `/holdings` + `/profile` open).
- **Privacy Gate: PASS** — observed field shapes are all chain-derived
  (holdings[], completeness{as_of_block,holder_count,source,complete}, profile{address,contract,imageUrl});
  no identity/session fields. Caveat: holdings item-shape unobserved (empty arrays, below).
- Registry fixed: PR **#425 MERGED** (deployment_url → 3f25 host; walled mcp host demoted in notes).
- Dashboard: `INVENTORY_API_URL` set in Vercel production + redeployed
  (aliased freeside.0xhoneyjar.xyz) — the hardcoded dead default is now overridden.
- **FINDING (bead arrakis-rxax)**: live host returns `holdings: []` even for active holders, with
  self-declared `completeness.complete: "degraded"` + fixture-looking `as_of_block: 9123456`
  (inventory-api#23 fixture fallback; env points at belt-hasura-production, a 3rd read host).
  Read PLANE healthy; DATA pending real ingest (STOR-1/#19). S3-L4's fail-loud client should
  render this degraded state instead of empty.
- Deferred: DNS `inventory.0xhoneyjar.xyz` → Railway custom domain (consumers now use the canonical
  Railway host directly); beacon serving = inventory-api#18 lane.
