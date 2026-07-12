---
title: cluster-events-pillar-v1 — go-live checklist (Sprint 4 canary flip)
cycle: cluster-events-pillar-v1
cycle_type: cluster-meta (per ADR-009 §D-7)
date: 2026-05-27
status: ready-to-execute (post #106 merge)
authored_by: Sprint 4 PR cycle close (claude opus 4.7)
supersedes: nothing — first ground-truth go-live for cross-cell events
audience: operator (zksoju) flipping the canary; future-self running this drill again on v2 substrate-scope expansion
---

# Go-Live Checklist · cluster-events-pillar-v1

> **Status post-merge**: 5 PRs merged across 3 cluster repos (sonar-api#24 · freeside-characters#105 · freeside-characters#106 · loa-freeside#227 · loa-freeside#229). The substrate code is shipped; this doc is the **drill** for taking it live — wiring env vars across Railway/ECS services, validating envelopes flow in the dash, then flipping `MST_CANARY_ENABLED=1` for the first organic Discord post.

## The hard reality: NATS broker is VPC-internal

Per `infrastructure/terraform/nats.tf:152` + `ecs-finn.tf:397`, the cluster's NATS JetStream broker is deployed on AWS ECS Fargate with:

```
NATS_URL = "tls://nats.${local.name_prefix}.local:4222"
NATS_TLS_CA = aws_secretsmanager_secret.nats_tls_ca (Service Connect-local)
```

This is a **VPC-internal address** — only reachable from inside the cluster's AWS VPC via ECS Service Discovery. **Three immediate implications**:

1. **sonar-api publishes from Envio's infra** (NOT the THJ AWS VPC). To reach the broker, sonar needs ONE of:
   - The broker re-exposed via an NLB with TLS + mTLS auth (operator decides)
   - VPC peering / VPN tunnel from Envio to THJ VPC
   - A relay/proxy that takes signed envelopes over HTTPS and republishes on the VPC-internal NATS
2. **freeside-characters bot runs on Railway**. Same constraint — Railway services are outside the THJ VPC. Same three options.
3. **operator-dash runs on Railway** (per `apps/freeside-operator-dash/README.md`). Same constraint.

**Decision required from operator before any service can publish or subscribe**: how is the broker reachable from outside the VPC? (Sprint 5 / v2 scope question — flagged here so it doesn't surprise you at deploy time.)

For the rest of this doc, the env-var matrix assumes the operator has resolved the broker-reachability question and produces a **publicly-resolvable `NATS_URL`** + a CA cert that consumer services can bundle.

## Env-var matrix (3 services × required configuration)

### 1. sonar-api (Envio indexer; publishes)

| Var | Source | Value shape | Required for |
|---|---|---|---|
| `NATS_URL` | Operator | `tls://<broker-public>:4222` | Connect |
| `NATS_TLS_CA` | Operator | Path to bundled CA cert file inside the container OR direct PEM content | TLS handshake |
| `SONAR_SIGNING_SEED_HEX` | Operator (NEW) | 64-char hex = 32-byte Ed25519 seed | Publisher signing |

**Provisioning notes**:
- Sonar's Envio service injects env via its own deployment surface. Confirm reachability + add the three vars.
- `SONAR_SIGNING_SEED_HEX` is a brand-new secret. Generate ONCE: `openssl rand -hex 32 > /secure/path/sonar.seed.hex`. Store in operator's secret manager.
- The corresponding **public key** must be published in the cluster JWKS (see step 4 below — `EVENTS_JWKS_URL`). Without the public-key publication, every subscriber will fail-soft signature verification.
- Boot signal to watch: `[events-publisher] connected to <url> (TLS=with-custom-CA)`. Absence = permanent-disabled. The substrate fail-softs cleanly even if these are misconfigured — Envio writes continue.

### 2. freeside-characters bot (Railway; subscribes + announces)

| Var | Source | Value shape | Required for |
|---|---|---|---|
| `NATS_URL` | Same as sonar | `tls://<broker-public>:4222` | Subscribe |
| `NATS_TLS_CA` | Same as sonar | CA cert path / PEM | TLS handshake |
| `JWKS_URL` | Operator | `https://<cluster-jwks-host>/.well-known/jwks.json` | Verifier |
| `MST_CANARY_CHANNEL_ID` | Operator | Discord channel snowflake (TEST channel first) | Announcement target |
| `MST_CANARY_ENABLED` | Operator | `0` (default) — flip to `1` AFTER dash validation | Canary on/off |
| `IDENTITY_API_URL` | Cluster default | `https://identity.0xhoneyjar.xyz` | Nym lookup (fail-soft) |
| `MINT_EVENT_INITIAL_ANCHOR_POLICY` | Default `any` | `any` \| `genesis` \| `<hex>` | Bootstrap replay defense |

**Provisioning notes**:
- Railway dashboard → freeside-characters bot service → Variables. Add the seven vars.
- `MST_CANARY_ENABLED=0` is the safe default. The bot boots, the subscriber runs, envelopes flow, the router suppresses Discord posts. This is the "observability mode" — operator watches the dash without any Discord noise.
- `MST_CANARY_CHANNEL_ID` should point at a TEST channel until the operator approves the announcement quality. The router's defense-in-depth refuses to post when this is empty AND requires `MST_CANARY_ENABLED=1` AND the bot client is connected (the triple-gate per BB#106 F-002).
- Boot signal to watch (post-fix BB#106): `kansei-router=mst (canary=OFF, channel=set, dispatch=OFF)` — confirms wiring without posting. After the flip: `canary=ON, channel=set, dispatch=wired`.
- `JWKS_URL` MUST resolve. If JWKS_URL is set but unreachable, the bot **fails loud with process.exit(1)** per BB#105 rd-3 F-001 — this is the loud-fail invariant the operator opted into by configuring JWKS.

### 3. loa-freeside operator-dash (Railway; observes)

| Var | Source | Value shape | Required for |
|---|---|---|---|
| `NATS_URL` | Same as above | `tls://<broker-public>:4222` | Subscribe (catch-all) |
| `NATS_TLS_CA` | Same as above | CA cert path / PEM | TLS handshake |
| `EVENTS_JWKS_URL` | Operator | Same as bot's `JWKS_URL` | Envelope verification |
| `EVENTS_TRACE_SUBJECTS` | Default `nft.mint.detected.>` | comma-separated subjects | Wildcard subscriptions |
| `EVENTS_TRACE_RAW_ACCESS` | Default unset (redact) | `1` to allow `?raw=1` query | Forensics access |

**Provisioning notes**:
- The dash is the **primary success criterion** per operator framing 2026-05-26. Wire NATS_URL + NATS_TLS_CA + EVENTS_JWKS_URL **first** so the dash is observing before any other service publishes.
- `EVENTS_TRACE_RAW_ACCESS` stays unset in production. `/api/state` + `/api/events` will return metadata-only envelope summaries (per BB#229 rd-3 F-001 + the rd-1 redact-by-default). Operators who need raw forensics set it explicitly per-deploy.
- Subscriber lifecycle telemetry to watch in the panel: `subscriberEnabled · natsConnected · subscribedCount` triple. All three TRUE = healthy. `natsConnected=true · subscribedCount=0` = broker reachable but no subjects attached → JWKS init likely failed; check `lastLifecycleError`.

## Ordered operator drill — going live

The substrate is **fail-soft at every layer**: services boot cleanly when env is missing, log + skip without blocking other functions. This is the discipline that makes the drill safe to step through in real production without precommitting.

### Phase 1 — broker reachability (decision moment)

1. **Resolve the broker-reachability question** (the hard-reality §). Decide: NLB+mTLS / VPC peering / HTTPS relay. Document the choice in this file (PR back if needed) with the resulting public NATS_URL.
2. Generate the sonar signing seed. Persist the public key for the JWKS.
3. Publish the JWKS at `https://<cluster-jwks-host>/.well-known/jwks.json` with the sonar pubkey as an `OKP` `Ed25519` entry. Convention per `@0xhoneyjar/events`: `{ kty: "OKP", crv: "Ed25519", kid: "sonar-api-1", x: <base64url-pubkey> }`.

### Phase 2 — observability first (dash deploy)

4. Wire the **dash's** Railway env (NATS_URL + NATS_TLS_CA + EVENTS_JWKS_URL). Trigger redeploy.
5. After boot, visit the deployed dash. Confirm panel renders **"⚡ cluster events trace"** + subscribed subjects + `subscribedCount=1` for `nft.mint.detected.>`.
6. Touch `/api/events`. Confirm empty `envelopes: []` array (no publishers yet).
7. Touch `/healthz` and `/api/state` — both 200. `/api/state` includes `eventsTraceRedacted: true` per BB#229 rd-3.

### Phase 3 — characters subscriber (no canary yet)

8. Wire the **characters bot's** Railway env. Crucially: `MST_CANARY_ENABLED=0`. Trigger redeploy.
9. Confirm bot boot log: `kansei-router=mst (canary=OFF, channel=set, dispatch=OFF)` + `events: NATS subscriber wired`.
10. The dash should now still show `subscribedCount=1` (its own subscription; the bot's subscription is internal). No envelopes flowing yet.

### Phase 4 — sonar publisher (the substrate test)

11. Wire the **sonar's** Envio service env (NATS_URL + NATS_TLS_CA + SONAR_SIGNING_SEED_HEX). Trigger redeploy.
12. Wait for the first chain event in any Mibera-family or PuruPuru handler to fire. Mint a Mibera NFT (or wait for organic — the index already covers live contracts on Berachain).
13. **The dash MUST show the envelope within seconds**. Watch the "recent envelopes" feed. Expected outcome cells:
    - `outcome=ok` if JWKS publication is correct + sig verification passes
    - `outcome=signature-invalid` if the JWKS pubkey doesn't match sonar's signing seed (revisit Phase 1.3)
14. Cross-reference: the bot's `subscriberLogger` should also log the same envelope. Either via Railway logs or via the bot's own observability surface if any.

### Phase 5 — the canary flip (the moment)

15. **Open the operator-decided TEST Discord channel**. Confirm `MST_CANARY_CHANNEL_ID` matches its snowflake.
16. Set `MST_CANARY_ENABLED=1` in the characters bot's Railway env. Trigger redeploy.
17. Confirm boot log: `kansei-router=mst (canary=ON, channel=set, dispatch=wired)`.
18. **Wait for the next Mibera Shadows mint** OR trigger one. The expected Discord post: enriched announcement with displayName (nym OR shortAddress) + collection + tokenId + image (if inventory enrichment succeeded) + traits + tx-hash footer link.
19. **Validate the announcement against operator taste**. Iterate the renderer (`mint-announcement-render.ts`) in a follow-up PR if needed. The substrate is correct; rendering is craft.

### Phase 6 — promote (after operator approval)

20. After 24-48h of canary-channel posts (or N successful announcements — operator decides), flip `MST_CANARY_CHANNEL_ID` to the production channel id. Trigger redeploy.
21. From this moment, organic Mibera Shadows mints post to the cluster's chosen primary channel.
22. Close `cluster-events-pillar-v1` cycle. Distill (KRANZ act 5) → retrospective covering the BB-rounds discipline + the per-PM consumer patterns + the substrate-distribution reconvergence path (bead `t6b`).

## Rollback procedure

At any step, if something looks wrong:

- **Phase 4-5**: Set `MST_CANARY_ENABLED=0` → bot continues subscribing + logging but no Discord posts. Operator can investigate without rolling deploys.
- **Phase 3**: Set bot's `NATS_URL=` (empty) → events subscriber gates off entirely (per the rd-1 fail-soft check). Bot's other functions (cron, interactions) keep working.
- **Phase 2**: Same — dash's `NATS_URL=` empty disables the events-trace panel cleanly. Dashboard renders the disabled-state message.
- **Phase 1**: Don't promote sonar's signing pubkey into the JWKS until Phase 2 dash + Phase 3 bot are confirmed observing the broker correctly. Without the pubkey in JWKS, all envelopes surface as `signature-invalid` — visually obvious in the dash, harmless to downstream.

## Synthetic validation (dev / pre-deploy)

If you want to validate the substrate locally before Phase 1's reachability decision:

- `cd ~/Documents/GitHub/loa-freeside/apps/freeside-operator-dash && pnpm tsx bin/smoke-events-trace.ts` — seeds 3 synthetic envelopes into the dash's in-memory store and prints the snapshot. Proves the ring buffer + per-class rollup + render path work without needing NATS.
- Cluster substrate tests: `cd ~/Documents/GitHub/loa-freeside/packages/events && pnpm test` — 65 tests covering envelope, JCS, signer, topics, publisher, subscriber, JWKS, roundtrip. Same code that runs in production.
- Characters substrate tests: `cd ~/Documents/GitHub/freeside-characters/packages/persona-engine && bun test src/events/` — 46 tests covering subscriber + router + dispatcher + render.
- Sonar substrate tests: `cd ~/Documents/GitHub/freeside-sonar && pnpm vitest run test/events-publisher.test.ts` — 11 tests covering publish + fail-soft + TLS posture.

All three test suites green locally = substrate-clean. The remaining unknown is environmental (broker reachability, JWKS publication, secret distribution) — the things this checklist's drill walks through.

## What this cycle proves

When step 18 lights up a Discord post in the canary channel, the cluster has demonstrated:

1. **Sovereign event substrate** — `@0xhoneyjar/events` consumed via git-URL pinned to SHA, no npm registry dependency (per `cluster-no-npm-sovereignty` memory).
2. **ACVP envelope discipline** — every envelope cryptographically bound to its full content (acvp-l1-v2 schema; full-envelope sig including event_type, emitted_by, payload, hash chain).
3. **Fail-soft at every boundary** — sonar publish failure doesn't break Envio writes; characters JWKS failure doesn't break cron/digest paths; dash NATS disconnect doesn't crash the dashboard.
4. **Operator-observable substrate** — the dash is the cluster's empirical-truth surface. Cross-cell event flow is visible BEFORE any user-facing artifact (Discord post) is enabled.
5. **Canary discipline** — `MST_CANARY_ENABLED=0` default + triple-gate dispatcher + redact-by-default API surface = production-safe rollout.

That's the cycle proof. Sprint 5 is operator-decided — `cluster-events-pillar-v2` would extend substrate scope (non-Mibera collections, vault events, identity-api event class) and could close the substrate-distribution reconvergence path (extract `@0xhoneyjar/events` to its own repo, eliminating per-PM workarounds documented in `events-consumer-pm-patterns` memory).
