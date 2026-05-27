---
title: Next session — execute the canary flip (Synadia decision + 5-step drill)
cycle: cluster-events-pillar-v1
parent: go-live-checklist.md + go-live-path-d-railway.md
date: 2026-05-27
status: ready-for-fresh-session (context-end handoff)
authored_at: session close on 2026-05-27 with context window ending
operator: zksoju
---

# Session N+1 — Execute the canary flip

> The cycle's CODE is shipped (5 PRs merged on cluster-events-pillar-v1 across 3 repos). The cycle's RUNBOOKS are written (go-live-checklist.md + go-live-path-d-railway.md, both merged on main). What's left is operator-driven infrastructure ops: pick a NATS broker, host JWKS, deploy dash + bot to Railway, wire sonar, flip the canary. This session does that.

## Context (the one-shot orient)

5 PRs merged today:
- `loa-freeside#227` — `@0xhoneyjar/events` library (acvp-l1-v2 envelope · Effect.Schema · full-envelope sig)
- `sonar-api#24` — Mibera-family + PuruPuru publish layer (retry on transient · TLS enforced · audit-log dropped publishes · closed-conn reset)
- `freeside-characters#105` — NATS subscriber at bot boot (drain-on-JWKS-fail · process.exit on JWKS misconfig)
- `loa-freeside#229` — operator-dash event-trace panel (nc.closed watcher · subscribedCount health · redact-by-default both /api/events AND /api/state)
- `freeside-characters#106` — MST canary announcement (triple-gate · V2 content-omit · MST router always wired)
- `loa-freeside#239` — go-live checklist (general drill)
- `loa-freeside#240` — go-live Path-D-Railway (this session's deploy artifacts; **may still be open** at session end)

Plus cryptographic prep:
- Sonar Ed25519 signing seed at `~/.loa-secrets/cluster-events-pillar-v1/sonar-api-1.seed.hex` (mode 0600)
- JWKS document at `~/.loa-secrets/cluster-events-pillar-v1/jwks.json` — hostable as-is
- Sonar pubkey hex: `be08b4356c548c34178f484b0026741609450add42e53c13dedffa81137479e0`

Operator framing 2026-05-27 (this session): **Path D on Railway, managed NATS preferred for portability, AWS infra change deferred until scale proves it.** The substrate library is already bus-portable (`NatsLike` interface in `packages/events/src/publisher.ts` + `subscriber.ts`); future migration to Kafka/Redpanda/etc. is per-consumer connection-init swap (~30 lines), not a library rewrite.

## Run via — operator-driven drill (no composition fits)

This is the honest answer: no agent composition fits the work. The next session is **operator-in-the-driver-seat infrastructure ops** with the runbook (`go-live-path-d-railway.md`) as the checklist. Agent's job is to be the operator's pair — surface env values, generate copy-paste config, validate after each step, debug when something goes wrong. The agent is the operator's hands; not the driver.

If a composition were authored for this it'd look like: `operator-drives-infra-deploy` — but that's a `the-weaver` task for a future cycle. For now: the runbook IS the loop.

## Load order (read in this sequence)

1. **`grimoires/loa/specs/cluster-events-pillar-v1/go-live-path-d-railway.md`** — the actionable runbook. Lives on main (merged via #240 once that lands). Pre-filled env values; 7-step operator drill.
2. **`grimoires/loa/specs/cluster-events-pillar-v1/go-live-checklist.md`** — the general drill (broker-agnostic). Sibling to the above.
3. **Memory `cluster-no-npm-sovereignty`** + **`events-consumer-pm-patterns`** + **`sovereign-code-distribution`** — the substrate doctrine that shaped this cycle. Don't deviate without re-reading.
4. **`grimoires/loa/specs/enhance-events-pillar-v1-nft-mints.md`** — the original build doc (operator decisions baked 2026-05-26). Useful if scope-creep ambiguity hits.

## The IMMEDIATE decision moment

**Should we sign up for Synadia?** Operator framed this as the open question. Three concrete sub-decisions inside it:

### (a) Synadia Cloud · free tier · managed
- **Pros**: zero infra to manage; mTLS / JWT auth handled; ~5min signup; broker is reachable from Envio + Railway out of the box. Free tier covers MST-event volume easily (chain mints are low-frequency).
- **Cons**: third-party dependency; Synadia controls the broker; outage = our cluster's event substrate is down. Adds an account/billing surface.
- **Adapter cost**: requires `NATS_CREDS_FILE_CONTENT` env support added to substrate library (Option AD-1, ~30 min library work; broadens portability to any creds-auth broker for the future).

### (b) Self-host nats-server on Fly.io / Hetzner / Railway
- **Pros**: cluster owns the broker; no third-party billing surface. Existing substrate code (NATS_TLS_CA) works as-is.
- **Cons**: provision the VM, generate a CA, generate per-service certs, monitor for outage. ~30-60 min setup; ongoing ops surface.

### (c) Stay on AWS-internal NATS + expose via NLB+mTLS
- **Pros**: cluster's existing broker reused (no new account/billing).
- **Cons**: AWS terraform change + apply (operator-credentialed); contradicts the operator's "Railway-first, AWS-conflict-okay-to-skip" directive from this session.

**Operator's stated preference 2026-05-27**: Path D-Railway flavor → leans (a) or (b). The cycle delivered scaffolding for (a). (c) is deferred until real-world pressure proves the broker needs to be AWS-load-bearing.

## What to build / do (in order)

This is operator action, not code. Each item is a concrete next-session step:

### 1. Decide Synadia vs. self-host (option a vs b above)
Pick one. If a: skip to step 2. If b: provision a Fly.io machine running `nats-server` with mTLS, save the CA + per-service certs to `~/.loa-secrets/cluster-events-pillar-v1/`, skip step 3 entirely (existing substrate code works).

### 2. (If Synadia) Sign up + grab creds + URL
Follow `go-live-path-d-railway.md` Step 1. Output: `NATS_URL` + `account-creds.creds` file contents.

### 3. (If Synadia) Land the substrate AD-1 adapter
Library evolution: add `NATS_CREDS_FILE_CONTENT` env support to consumer wires (sonar `events-publisher.ts`, characters bot boot, dash `events-trace.ts`). Write to temp file at boot, pass `authenticator: credsAuthenticator(creds)` to `nats.connect`. ~20 lines per consumer × 3 consumers = ~60 lines + tests.

This is the only NEW code work in this next session. Everything else is config/deploy. **Suggested PRs**: one per consumer for clean blast-radius.

### 4. Host JWKS publicly
Follow `go-live-path-d-railway.md` Step 2. Pick Vercel or gist. Output: `EVENTS_JWKS_URL` value.

### 5. Deploy dash to Railway
Follow Step 3 of the runbook. PR #240's `Dockerfile + railway.toml` are ready (already merged or about to). Set env vars. Confirm dash boots, panel renders, subscriber wires.

### 6. Wire sonar Envio + characters Railway envs
Follow Steps 4 + 5. Sonar publishes; characters subscribes; both default-canary-OFF.

### 7. Observe before flip
Step 6 of the runbook. Watch real Mibera-family mints flow through the dash. Validate envelope shape. **Substrate validation moment.**

### 8. Canary flip → first organic Discord post
Step 7. Set `MST_CANARY_ENABLED=1`. Watch for the first organic Mibera Shadow mint → Discord canary channel.

### 9. Promote
Step 8. After 24-48h of clean canary posts (or N successful posts per operator taste), flip `MST_CANARY_CHANNEL_ID` to production.

### 10. Distill (KRANZ act 5)
Cycle close. Retrospective covering: BB-rounds discipline, per-PM consumer patterns, substrate-distribution reconvergence path, what scaling decisions (if any) the live-data revealed.

## What NOT to build (scope discipline)

- **DO NOT** extend substrate to non-Mibera collections (`HoneyJar mints`, `vault deposits`, `score updates`). That's `cluster-events-pillar-v2` — separate cycle. v1 substrate is intentionally narrow.
- **DO NOT** extract `@0xhoneyjar/events` to its own repo this session. Bead `t6b` tracks this for v2. Operator already evaluated and chose to stay in-monorepo for now.
- **DO NOT** change the ACVP envelope schema (`acvp-l1-v2`). Already locked. Schema evolution requires a new versioned subject + ≥30d coexistence per `enhance-events-pillar-v1-nft-mints.md` design rules.
- **DO NOT** rewire identity-api to add a JWKS route. Static JWKS file (step 4) is simpler + decoupled.
- **DO NOT** migrate to AWS NLB unless Synadia + self-host both fail. Defer per operator's directive.

## Verify

The cycle's CODE is correct + tested at every layer. The unknown that this session resolves is the OPERATIONAL substrate (broker reachability + JWKS publication + service deployments).

**Verification at each step**:
- Step 5 (dash deployed): hit deployed dash URL → `⚡ cluster events trace` panel shows `subscriberEnabled: true · natsConnected: true · subscribedCount: 1 · totalObserved: 0`
- Step 6 (sonar publishing): dash's `/api/events` populates with envelopes; `outcome: ok` (if JWKS correct) or `signature-invalid` (revisit step 4 if so)
- Step 8 (canary flip): first organic Mibera Shadow mint → enriched Discord post in test channel within ~30s

**End-state**: first organic Discord post in the production channel after step 9 closes the cycle.

## Tracker beads (cycle context — useful if questions arise)

In `~/bonfire/cluster-events-pillar-coordinator/`:
- `qns` — F-006: nats@2.x → @nats-io/transport-node migration
- `wdd` — F-009: deterministic test signal in roundtrip.test.ts
- `wd6` — EVT-008: FakeNats `*` single-segment wildcard
- `r9q` — @effect/schema deprecation (merged into main effect package)
- `1jh` — sonar grep→ck in rebuild script
- `hal` — characters tests bypass startMintEventSubscriber
- `t6b` — sonar F-003: --ignore-scripts edge; extract-events-to-own-repo path
- `bk7` — characters BB#106 F-003: inventoryApiBaseUrl unused option

None block the canary flip. All are v2-cycle candidates.

## Key references

| Topic | Path |
|---|---|
| Library source (substrate primitives) | `loa-freeside/packages/events/` |
| Build doc (operator decisions baked) | `grimoires/loa/specs/enhance-events-pillar-v1-nft-mints.md` |
| General go-live drill | `grimoires/loa/specs/cluster-events-pillar-v1/go-live-checklist.md` |
| Path D Railway actionable | `grimoires/loa/specs/cluster-events-pillar-v1/go-live-path-d-railway.md` |
| TEND audit baseline (cycle context) | `grimoires/freeside-network/cluster-2026-05-26-mint-announcement-tend/audit.md` |
| Coord cycle (cockpit) | `~/bonfire/cluster-events-pillar-coordinator/` (3/3 beads closed + 8 follow-ups) |
| Sonar pubkey for JWKS reference | `be08b4356c548c34178f484b0026741609450add42e53c13dedffa81137479e0` |

## What was learned this session that's NOT in the merged docs

1. **Ground-check linter caught a confabulation in real-time** — when I (the agent) wrote a guessed Synadia URL in the Path-D doc, `~/.claude/scripts/straylight-estate/ground-check.sh` flagged it before commit. The fix was simple but the SIGNAL is substrate-meaningful: the cluster has scaffolding to catch agent confabulation, and it works. Future sessions should trust this layer + correct when it fires.
2. **dash boots locally on `:3030` cleanly** — verified end-to-end. `pnpm dev` in `apps/freeside-operator-dash/` is the fastest substrate-validation path; no NATS needed (panel renders disabled-state correctly).
3. **5 PRs through 3 BB review rounds each** demonstrated a consistent multi-round refinement pattern that's now reusable for future cluster-meta cycles. KRANZ acts + BB rounds is the cluster-cycle template.

## Persona

KRANZ (construct-freeside) for cross-repo operator pairing during deploy steps. The operator drives; KRANZ surfaces concrete env values, validates after each step, catches operator-confused state.
