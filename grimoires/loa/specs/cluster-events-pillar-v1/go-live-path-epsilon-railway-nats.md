---
title: cluster-events-pillar-v1 — go-live (Path ε · self-hosted nats-server on Railway, mTLS)
cycle: cluster-events-pillar-v1
date: 2026-05-26
status: ready-to-execute
operator: zksoju
parent_doc: go-live-checklist.md + go-live-path-d-railway.md (this supersedes Path D's Synadia choice)
estimated_operator_time: 60-90 minutes (excluding async waits)
sovereignty_grade: cluster-owned (broker + auth substrate)
---

# Go-Live Path ε · Railway-hosted nats-server with mTLS

> **The cluster-sovereign path.** Self-host `nats-server` on Railway as a TCP-proxied service with mTLS auth via a fresh self-signed CA. Single ops surface (Railway dashboard for broker + dash + bot). No third-party-vendor dependency. Substrate library evolves to support `tls: { ca, cert?, key? }` — backward-compatible with internal CA-only consumers, forward-compatible to future broker swaps. Decision context: see §"Why Path ε" below.

## Why Path ε (vs Path D's Synadia recommendation)

The Path-D runbook (Synadia managed) was authored before two things were known:

1. **AWS arrakis stack is dormant** — `arrakis-production-nats` and the entire Hounfour stack (`gateway`, `finn`, `dixie`, `gp-worker`, `worker`) are all at `desired_count=0` as of 2026-05-26. Memory note `project_nats-deployed-but-unconsumed` reflects this state. There is no live AWS NATS to reuse — only to revive, which contradicts the operator's Railway-first directive.
2. **Synadia attempted to relicense nats-server to BSL in 2024-2025** — [The Register, 2025-04-28](https://www.theregister.com/software/2025/04/28/cncf-tells-nats-contributor-synadia-its-free-to-fork-off/1042739). CNCF resisted, settlement preserved Apache 2.0 — but the attempt revealed Synadia's commercial pressure on the protocol. Single-implementation monoculture (no Redpanda-equivalent for NATS) means our self-host story would always be "we run Synadia's binary."

Path ε answers both: **own the broker, single ops surface, accept NATS's monoculture risk mitigated by the substrate's `NatsLike` portability interface**.

## Pre-filled artifacts

| Artifact | Location |
|---|---|
| Sonar Ed25519 signing seed | `~/.loa-secrets/cluster-events-pillar-v1/sonar-api-1.seed.hex` (mode 0600 — already exists) |
| Sonar pubkey hex (JWKS source) | `be08b4356c548c34178f484b0026741609450add42e53c13dedffa81137479e0` |
| JWKS document | `~/.loa-secrets/cluster-events-pillar-v1/jwks.json` — already exists, hostable as-is |
| Dash Dockerfile + railway.toml | `apps/freeside-operator-dash/{Dockerfile,railway.toml}` — already on the cluster-events-pillar/sprint-4-go-live-railway branch (PR #240) |

## Step-by-step (operator action)

### Step 0 — Refresh Railway token (~3min, blocks all subsequent steps)

1. Go to https://railway.com/account/tokens → "Create New Token"
2. Name: `claude-code-global` · scope: **Account / Personal**
3. Replace value of `RAILWAY_API_TOKEN` in `~/.claude/settings.json` `env` block
4. Verify: `RAILWAY_API_TOKEN=<new> railway whoami --json` returns identity

### Step 1 — Generate cluster-events-pillar CA + certs (~10min, one-time)

Run from `~/.loa-secrets/cluster-events-pillar-v1/`. This generates 1 CA + 1 server cert + 3 client certs (sonar, characters, dash), all signed by the new CA. **Distinct from the dormant AWS NATS CA** — fresh blast radius for the Railway-hosted broker.

```bash
SECRETS=~/.loa-secrets/cluster-events-pillar-v1
mkdir -p "$SECRETS/nats-tls" && cd "$SECRETS/nats-tls"

# Use the script at: scripts/generate-cluster-nats-certs.sh (provided below)
# OR manually with openssl:

# --- CA ---
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/O=0xHoneyJar/CN=Cluster Events Pillar CA"

# --- Server cert (CN matches Railway custom domain or proxy hostname) ---
# Replace NATS_HOSTNAME below with either:
#   - "nats.0xhoneyjar.xyz" (if using custom domain — recommended)
#   - "<your-slug>.proxy.rlwy.net" (if using Railway's default — pin AFTER provisioning)
NATS_HOSTNAME="nats.0xhoneyjar.xyz"
openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -out server.csr -subj "/O=0xHoneyJar/CN=$NATS_HOSTNAME"
cat > server.ext <<EOF
subjectAltName = DNS:$NATS_HOSTNAME, DNS:localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 365 -extensions v3_req -extfile server.ext

# --- Client certs (CN becomes NATS user identity under verify_and_map) ---
for client in sonar-api characters-bot operator-dash; do
  openssl ecparam -name prime256v1 -genkey -noout -out "$client.key"
  openssl req -new -key "$client.key" -out "$client.csr" -subj "/O=0xHoneyJar/CN=$client"
  cat > "$client.ext" <<EOF
extendedKeyUsage = clientAuth
EOF
  openssl x509 -req -in "$client.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$client.crt" -days 365 -extensions v3_req -extfile "$client.ext"
done

# Verify
openssl verify -CAfile ca.crt server.crt sonar-api.crt characters-bot.crt operator-dash.crt
# Expected: all 4 lines say "OK"

chmod 600 *.key
ls -la
```

**Output**: 1 CA (cert + key), 1 server cert (cert + key), 3 client certs (cert + key each). All in `~/.loa-secrets/cluster-events-pillar-v1/nats-tls/`.

### Step 2 — Provision nats-server on Railway (~20min)

#### 2a. Create Railway service

1. Railway dashboard → existing cluster project (or new project `cluster-events-pillar`) → "Add Service" → "Deploy Image"
2. Image: `nats:2.10-alpine`
3. Service name: `cluster-nats`

#### 2b. Mount persistent volume (for JetStream)

1. Service settings → Volumes → "Add Volume"
2. Mount path: `/data`
3. Name: `cluster-nats-jetstream`

#### 2c. Set env vars (cert bodies + config)

Paste these into Railway's service Variables panel. Use `cat <file> | pbcopy` then paste:

| Var | Source |
|---|---|
| `NATS_SERVER_CERT` | `cat ~/.loa-secrets/cluster-events-pillar-v1/nats-tls/server.crt` |
| `NATS_SERVER_KEY` | `cat ~/.loa-secrets/cluster-events-pillar-v1/nats-tls/server.key` |
| `NATS_CA_CERT` | `cat ~/.loa-secrets/cluster-events-pillar-v1/nats-tls/ca.crt` |

#### 2d. Custom Start Command

Service settings → Deploy → Start Command:

```sh
sh -c "mkdir -p /etc/nats/certs && printf '%s' \"$NATS_SERVER_CERT\" > /etc/nats/certs/server.crt && printf '%s' \"$NATS_SERVER_KEY\" > /etc/nats/certs/server.key && printf '%s' \"$NATS_CA_CERT\" > /etc/nats/certs/ca.crt && chmod 600 /etc/nats/certs/server.key && exec nats-server -js -sd /data -m 8222 --tls --tlsverify --tlscert=/etc/nats/certs/server.crt --tlskey=/etc/nats/certs/server.key --tlscacert=/etc/nats/certs/ca.crt"
```

Flag reference:
- `-js` enable JetStream (durable streams + replay)
- `-sd /data` JetStream store dir → mounted volume
- `-m 8222` monitoring endpoint (Railway can healthcheck `/healthz`)
- `--tls` enable TLS
- `--tlsverify` **require + verify client cert** (mTLS)
- `--tlscacert` CA used to verify client certs (same CA used to sign them)

#### 2e. Enable Railway TCP Proxy

Service settings → Networking → "TCP Proxy" → Internal port `4222`

Railway generates a domain like `viaduct.proxy.rlwy.net:30420`. Note the assigned port.

#### 2f. (Recommended) Custom domain

Service settings → Networking → "Add Custom Domain" → `nats.0xhoneyjar.xyz`. Railway gives you a CNAME target — add it at your DNS provider (Cloudflare grey-cloud / DNS-only). DNS propagation ~5min.

**NATS URL final form**: `tls://nats.0xhoneyjar.xyz:<railway-port>` (port from 2e).

#### 2g. Healthcheck (optional)

Service settings → Deploy → Health Check Path: `/healthz` · Port: `8222` (the monitoring port). Railway checks readiness.

#### 2h. Verify

From your local shell with the CA cert + a client cert:

```sh
cd ~/.loa-secrets/cluster-events-pillar-v1/nats-tls
nats --server tls://nats.0xhoneyjar.xyz:<port> \
  --tlsca ca.crt --tlscert sonar-api.crt --tlskey sonar-api.key \
  server check connection
# Expected: "OK Connection Check ... | conn_time_ms=..."
```

If `nats` CLI not installed: `brew install nats-io/nats-tools/nats`. Skip if you trust the substrate-side test will validate.

### Step 3 — Substrate code change (~30min — 1 small PR per consumer)

The substrate's current `tls: { ca }` connection options need to accept optional `cert` + `key`. Change shape per consumer:

#### 3a. freeside-sonar (`src/lib/events-publisher.ts`)

```diff
- const ca = natsTlsCa ? await fs.readFile(natsTlsCa, "utf-8") : undefined;
+ const ca = natsTlsCa ? await fs.readFile(natsTlsCa, "utf-8") : undefined;
+ const clientCert = process.env.NATS_TLS_CLIENT_CERT;  // PEM content, not path
+ const clientKey = process.env.NATS_TLS_CLIENT_KEY;
+ // Either both OR neither — refuse partial config
+ if (Boolean(clientCert) !== Boolean(clientKey)) {
+   return markPermanentDisabled(
+     `NATS_TLS_CLIENT_CERT and NATS_TLS_CLIENT_KEY must both be set or both unset`,
+     log
+   );
+ }

  nats = await connect({
    servers: [natsUrl],
-   ...(ca ? { tls: { ca } } : {}),
+   ...(ca || clientCert ? {
+     tls: {
+       ...(ca ? { ca } : {}),
+       ...(clientCert ? { cert: clientCert, key: clientKey } : {}),
+     }
+   } : {}),
  });
```

Test addition: assert that mismatched cert/key returns permanent-disabled state (covers the new branch).

#### 3b. freeside-characters (`packages/persona-engine/src/events/mint-event-subscriber.ts` + bot wire at `apps/bot/src/index.ts`)

Same shape. The bot wire at `apps/bot/src/index.ts` currently passes `natsTlsCa: process.env.NATS_TLS_CA?.trim() || undefined` — extend the options surface:

```diff
  mintEventSubscriber = await startMintEventSubscriber({
    natsUrl,
    natsTlsCa: process.env.NATS_TLS_CA?.trim() || undefined,
+   natsTlsClientCert: process.env.NATS_TLS_CLIENT_CERT?.trim() || undefined,
+   natsTlsClientKey: process.env.NATS_TLS_CLIENT_KEY?.trim() || undefined,
    ...
```

Then in `mint-event-subscriber.ts`'s connect site, mirror the sonar pattern.

#### 3c. operator-dash (`apps/freeside-operator-dash/src/events-trace.ts`)

Current code uses `caFile` (path). Switch to `ca` (PEM body) so Railway can inject via env var without filesystem touch:

```diff
- if (process.env.NATS_TLS_CA) {
-   connectOpts.tls = { caFile: process.env.NATS_TLS_CA };
- }
+ const caPem = process.env.NATS_TLS_CA;  // PEM body, not path
+ const clientCert = process.env.NATS_TLS_CLIENT_CERT;
+ const clientKey = process.env.NATS_TLS_CLIENT_KEY;
+ if (Boolean(clientCert) !== Boolean(clientKey)) {
+   throw new Error("NATS_TLS_CLIENT_CERT and NATS_TLS_CLIENT_KEY must both be set or both unset");
+ }
+ if (caPem || clientCert) {
+   connectOpts.tls = {
+     ...(caPem ? { ca: caPem } : {}),
+     ...(clientCert ? { cert: clientCert, key: clientKey } : {}),
+   };
+ }
```

**Naming note**: the dash currently uses `caFile` (path) while the others use `ca` (body). Path ε standardizes on PEM-body across all three for Railway compatibility (env vars hold PEM content, not paths). Document this in the substrate library README + the PRs.

**Suggested PR titles**:
- `freeside-sonar`: `feat(events-publisher): NATS mTLS client cert support (Path ε)`
- `freeside-characters`: `feat(events): NATS mTLS client cert support for bot subscriber (Path ε)`
- `loa-freeside`: `feat(operator-dash): NATS mTLS client cert + standardize on PEM-body env vars (Path ε)`

Each PR is small (~20 lines + tests). Suggest landing all three in parallel before Step 5.

### Step 4 — Host JWKS file publicly (~10min, same as Path D)

Unchanged from Path D §Step 2. Pick Vercel (recommended) or gist. Output: `EVENTS_JWKS_URL` value.

### Step 5 — Wire each consumer's env (~15min total)

For each Railway service (dash + characters bot) AND for the Envio sonar dashboard, set:

| Var | Value | Source |
|---|---|---|
| `NATS_URL` | `tls://nats.0xhoneyjar.xyz:<port>` | Step 2e/2f |
| `NATS_TLS_CA` | (PEM body of `ca.crt`) | `cat ~/.loa-secrets/cluster-events-pillar-v1/nats-tls/ca.crt` |
| `NATS_TLS_CLIENT_CERT` | (PEM body of `<service>.crt`) | sonar→`sonar-api.crt`, characters→`characters-bot.crt`, dash→`operator-dash.crt` |
| `NATS_TLS_CLIENT_KEY` | (PEM body of `<service>.key`) | matching service key |
| `EVENTS_JWKS_URL` | (from Step 4) | Same across all 3 |
| `JWKS_URL` | (same as EVENTS_JWKS_URL — characters bot uses this name) | Same |
| Plus the sonar-specific `SONAR_SIGNING_SEED_HEX` | Path D Step 4 still applies | `cat ~/.loa-secrets/cluster-events-pillar-v1/sonar-api-1.seed.hex` |
| Plus the characters-specific `MST_CANARY_*` vars | Path D Step 5 still applies | unchanged |

### Step 6-8 — Observe → flip → promote (same as Path D §Step 6-7)

Unchanged from the Path-D runbook. Watch dash → confirm envelopes flow → flip `MST_CANARY_ENABLED=1` → wait for first organic mint → promote channel.

## Cert generation helper script (commit to repo)

For repeatability + audit trail, the openssl commands above can be wrapped:

**Suggested location**: `scripts/cluster-events-pillar/generate-nats-certs.sh`

```bash
#!/bin/bash
# Generate cluster-events-pillar NATS CA + server cert + per-consumer client certs.
# Usage: ./generate-nats-certs.sh <output-dir> <nats-hostname>
set -euo pipefail

OUT="${1:-$HOME/.loa-secrets/cluster-events-pillar-v1/nats-tls}"
NATS_HOSTNAME="${2:-nats.0xhoneyjar.xyz}"
mkdir -p "$OUT" && cd "$OUT"

# CA (10yr)
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/O=0xHoneyJar/CN=Cluster Events Pillar CA"

# Server (1yr)
openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -out server.csr -subj "/O=0xHoneyJar/CN=$NATS_HOSTNAME"
cat > server.ext <<EOF
subjectAltName = DNS:$NATS_HOSTNAME, DNS:localhost, IP:127.0.0.1
extendedKeyUsage = serverAuth
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 365 -extensions v3_req -extfile server.ext

# Clients (1yr) — CN becomes NATS user identity under verify_and_map
for client in sonar-api characters-bot operator-dash; do
  openssl ecparam -name prime256v1 -genkey -noout -out "$client.key"
  openssl req -new -key "$client.key" -out "$client.csr" -subj "/O=0xHoneyJar/CN=$client"
  cat > "$client.ext" <<EOF
extendedKeyUsage = clientAuth
EOF
  openssl x509 -req -in "$client.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out "$client.crt" -days 365 -extensions v3_req -extfile "$client.ext"
done

openssl verify -CAfile ca.crt server.crt sonar-api.crt characters-bot.crt operator-dash.crt
chmod 600 *.key *.csr *.ext *.srl 2>/dev/null || true
echo "Generated: $OUT (CA + server + 3 client certs)"
```

Cert renewal: every ~360 days, regenerate clients/server with same CA. CA itself rotates every ~9 years.

## Sovereignty + substrate notes

1. **NatsLike interface preserved**: substrate code change is additive (`ca` → `ca | cert+key | both`). Library remains bus-portable. Future migration to Kafka-wire (Redpanda) is still ~30 lines per consumer + adapter, NOT a library rewrite.

2. **CA blast radius**: This CA is independent of the dormant AWS arrakis NATS CA. If the cluster ever revives AWS NATS, that's a separate CA infrastructure. Compromise of one doesn't compromise the other.

3. **JetStream durability + replay**: enabled (`-js`) but not strictly required for v1's ~1/hour mint rate. Becomes load-bearing at airdrop spikes (~100/sec). Worth configuring a stream definition at v2 (`grimoires/.../v2-stream-config.md` TODO).

4. **Hash-chain integrity caveat**: `@0xhoneyjar/events`'s `InMemoryPrevHashStore` means a publisher restart resets the chain. NOT a NATS issue — it's a substrate-side persistence gap. For production, back the `PrevHashStore` with Redis or Postgres so chain continuity survives sonar restarts. **This applies to ALL paths (Path D Synadia OR Path ε Railway-NATS); not specific to Path ε.** Filing as cluster-events-pillar v1.1 hardening.

5. **NATS-protocol monoculture risk**: unchanged from Path D. The May 2025 Synadia-CNCF settlement preserved Apache 2.0; if Synadia retries the BSL move in a future cycle, our `NatsLike` substrate hedge gives us a ~1-week swap window to Redpanda (Kafka-wire) without rewriting the library. Worth a beads task: **v2 broker-sovereignty audit — recheck NATS license status, evaluate Redpanda migration cost at then-current throughput**.

## What this proves at first-Discord-post

Identical to Path D's claims, plus:
- The cluster's **broker substrate is cluster-owned end-to-end** (broker + CA + identity model)
- The substrate library's **TLS portability layer is properly parametrized** (not CA-only)
- Railway's TCP proxy + nats-server interaction is validated (low-volume now; load-tested at airdrop spike later)
- The "single ops surface" hypothesis (dash + bot + broker all on Railway) is validated empirically

## Rollback (per step)

- **Step 2 (provision)**: Stop the Railway nats-server service. Cluster substrate becomes unreachable; consumer fail-soft contracts (rd-1 across all 3 PRs) mean nothing crashes.
- **Step 3 (substrate code)**: Roll back the 3 small PRs (each isolated). Substrate reverts to `tls: { ca }` only.
- **Step 5 (env)**: Unset `NATS_URL` on any consumer — that consumer disables cleanly.
- **Step 7 (canary flip)**: `MST_CANARY_ENABLED=0` → redeploy → no Discord posts.

## Tracker beads (filed during this artifact)

Will file (pending operator nod):
- `cluster-events-pillar v1.1: PrevHashStore persistence (Redis/Postgres backing)` — substrate-side hardening, blocks production-grade durability
- `arrakis prod stack at desired_count=0 — confirm intentional + update docs` — material drift between issue #200 audit + current ECS state
- `v2 broker-sovereignty audit — NATS license recheck + Redpanda migration cost` — periodic substrate-sovereignty review

## Key references

| Topic | Path |
|---|---|
| Substrate library | `loa-freeside/packages/events/` |
| Original build doc | `grimoires/loa/specs/enhance-events-pillar-v1-nft-mints.md` |
| General go-live drill | `grimoires/loa/specs/cluster-events-pillar-v1/go-live-checklist.md` |
| Path D (Synadia, superseded) | `grimoires/loa/specs/cluster-events-pillar-v1/go-live-path-d-railway.md` |
| Session 5 kickoff | `grimoires/loa/specs/cluster-events-pillar-v1/next-session-canary-flip.md` |
| AWS NATS dormancy proof | `gh issue view 200 --repo 0xHoneyJar/loa-freeside` + this session's ECS describe-services output |
| NATS CA generation script | `scripts/cluster-events-pillar/generate-nats-certs.sh` (TODO: commit) |
| Railway TCP Proxy docs | https://docs.railway.com/networking/tcp-proxy |
| Synadia 2024-25 license drama | https://www.cncf.io/blog/2025/05/01/protecting-nats-and-the-integrity-of-open-source-cncfs-commitment-to-the-community/ |

## Persona

KRANZ (construct-freeside) for cross-repo operator pairing during deploy steps. Operator drives Railway dashboard; KRANZ surfaces concrete env values, validates after each step, catches operator-confused state. Same persona as Path D — no construct change.
