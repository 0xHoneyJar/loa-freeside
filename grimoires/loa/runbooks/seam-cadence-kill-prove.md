# Seam Cadence Kill/Prove Runbook

**Cycle**: cycle/coherence-foundation
**Date**: 2026-06-03
**SDD Reference**: §8 Kill/Prove Protocol
**PRD Requirements**: R-3

---

## 1. Purpose

This runbook documents the kill/prove procedure for the `SeamNftMintDetectedSilent` alert.

The test proves two simultaneous facts:

1. `absent_over_time()` **fires** when a publisher is dead (the series disappears entirely)
2. `== 0` threshold rules (`GatewayShardDown`, `GatewayNATSPublishFailures`) **do NOT fire** for the same root cause (a stopped publisher that was previously healthy)

This is the INV-3 correctness distinction: a publisher that has stopped emitting produces
**no series**, not a zero-valued series. Threshold rules evaluate against the last-known
value; `absent_over_time()` detects the absence of data points within the evaluation window.

---

## 2. Test Subject Declaration

**Kill/prove uses**: `commands.interaction`

**Rationale**: The gateway publishes `commands.interaction` on every Discord slash command
interaction. The counter `gateway_events_published_total{subject="commands.interaction"}`
is emitted by `apps/gateway/src/nats/publisher.rs` via the T-1/T-2 instrumentation.

**Not used**: `nft.mint.detected.v1`. The gateway does NOT publish this subject — it is
owned by `freeside-sonar` (external repo). See §7 (P1 Gap Note) for the production
implication.

---

## 3. Pre-conditions

Before executing the kill/prove procedure, verify:

- [ ] Gateway is deployed with T-1/T-2 counter instrumentation (`gateway_events_published_total` visible in `/metrics`)
- [ ] T-3 alert YAML (`arrakis-seam-cadence` group) is loaded by Prometheus (`promtool check rules` exits 0)
- [ ] Discord interactions are flowing, OR test publishes are being injected via `nats pub` to generate `commands.interaction` traffic
- [ ] Prometheus scrape interval is ≤15s (standard) so absence is detected within 1–2 evaluation cycles
- [ ] Access to Prometheus HTTP API (`GET /api/v1/query`) is available

---

## 4. Temporary Kill/Prove Alert Variant

For faster iteration (5-minute window instead of 30-minute production window), apply this
temporary alert expression locally before the full kill/prove test:

```yaml
# Temporary kill/prove variant — DO NOT ship to production
- alert: SeamNftMintDetectedSilent
  expr: absent_over_time(gateway_events_published_total{subject="commands.interaction"}[5m])
  for: 0m
  labels:
    severity: warning
    component: seam
    seam: nft.mint.detected.v1
```

After acceptance testing, revert `alerts.yml` to:
- `subject="nft.mint.detected.v1"` (production target)
- `[30m]` window
- `for: 5m` (production requirement — see §8)

---

## 5. Step-by-Step Procedure

### Step 1 — Baseline (series present, alert inactive)

Verify the counter is present and the alert is NOT firing:

```bash
# Confirm counter is emitting for commands.interaction
curl -s 'http://<prometheus>/api/v1/query?query=gateway_events_published_total{subject="commands.interaction"}' | jq '.data.result'

# Confirm SeamNftMintDetectedSilent is NOT firing
curl -s 'http://<prometheus>/api/v1/query?query=ALERTS{alertname="SeamNftMintDetectedSilent",alertstate="firing"}' | jq '.data.result'
# Expected: []
```

Record the baseline timestamp.

### Step 2 — Kill (stop the publisher)

Stop the gateway pod or block its JetStream connection:

```bash
# Option A: Kill the gateway pod
kubectl delete pod -l app=arrakis-gateway -n arrakis

# Option B: Block JetStream connection (if live restart is undesirable)
# Apply a network policy blocking NATS egress from the gateway pod
```

### Step 3 — Wait (≥5 minutes for kill/prove window)

Wait at least 5 minutes for Prometheus to evaluate the kill/prove alert expression
(`absent_over_time(...[5m])`). With `for: 0m`, the alert fires on the first absent
evaluation after the window elapses.

```bash
# Monitor alert state (poll every 30s)
watch -n 30 'curl -s "http://<prometheus>/api/v1/query?query=ALERTS{alertname=\"SeamNftMintDetectedSilent\"}" | jq ".data.result"'
```

### Step 4 — Verify fires: SeamNftMintDetectedSilent is FIRING

```bash
curl -s 'http://<prometheus>/api/v1/query?query=ALERTS{alertname="SeamNftMintDetectedSilent",alertstate="firing"}' | jq '.data.result'
# Expected: non-empty array with alertstate="firing"
```

Record: timestamp, full query response.

### Step 5 — Verify silent: GatewayShardDown and GatewayNATSPublishFailures NOT firing

```bash
# GatewayShardDown — threshold rule (gateway_shards_ready == 0)
curl -s 'http://<prometheus>/api/v1/query?query=ALERTS{alertname="GatewayShardDown",alertstate="firing"}' | jq '.data.result'
# Expected: [] (not firing — shards_ready series may show last-known non-zero value)

# GatewayNATSPublishFailures — rate rule
curl -s 'http://<prometheus>/api/v1/query?query=ALERTS{alertname="GatewayNATSPublishFailures",alertstate="firing"}' | jq '.data.result'
# Expected: [] (not firing — no failed publishes observed, publisher simply stopped)
```

Record both query responses simultaneously with the Step 4 timestamp.

**This simultaneous state proves INV-3**: the publisher is dead, `absent_over_time` fires,
but threshold/rate rules that require an active (potentially zero-valued) series remain
silent.

### Step 6 — Restore (restart gateway; verify counter resumes; verify alert resolves)

```bash
# Restart the gateway pod
kubectl rollout restart deployment/arrakis-gateway -n arrakis

# Wait for pod to be ready
kubectl wait --for=condition=Ready pod -l app=arrakis-gateway -n arrakis --timeout=120s

# Verify counter is emitting again
curl -s 'http://<prometheus>/api/v1/query?query=gateway_events_published_total{subject="commands.interaction"}' | jq '.data.result'

# Verify alert resolves (may take up to 1 scrape + eval cycle)
curl -s 'http://<prometheus>/api/v1/query?query=ALERTS{alertname="SeamNftMintDetectedSilent",alertstate="firing"}' | jq '.data.result'
# Expected: [] (resolved)
```

---

## 6. Execution Record

> **Status**: PENDING EXECUTION
>
> This runbook has been written and procedure documented. Execution requires a live
> Prometheus + gateway environment. A BLOCKER bead must be filed if execution cannot
> be completed before sprint close.

When executed, record the following:

| Field | Value |
|-------|-------|
| Execution date | — |
| Executor | — |
| Baseline timestamp | — |
| Kill timestamp | — |
| Alert fired timestamp | — |
| SeamNftMintDetectedSilent firing query output | — |
| GatewayShardDown NOT firing query output | — |
| GatewayNATSPublishFailures NOT firing query output | — |
| Restore timestamp | — |
| Alert resolved timestamp | — |
| Environment (cluster / namespace) | — |

Paste raw `jq` output below when available:

```
# Step 4 — SeamNftMintDetectedSilent FIRING
<paste here>

# Step 5a — GatewayShardDown NOT FIRING
<paste here>

# Step 5b — GatewayNATSPublishFailures NOT FIRING
<paste here>
```

---

## 7. P1 Gap Note — nft.mint.detected.v1 Alert Continuously Firing in Production

**Expected behavior** (not a defect): In production, `SeamNftMintDetectedSilent` will
fire **continuously** because `gateway_events_published_total{subject="nft.mint.detected.v1"}`
is never emitted by the gateway.

**Root cause**: The gateway does not publish `nft.mint.detected.v1`. That subject is owned
by `freeside-sonar` (external repo). Until sonar adopts the `gateway_events_published_total`
counter, the series will always be absent, and the alert will always fire.

**Resolution path**: P1 work — `freeside-sonar` must instrument its JetStream publish path
with `gateway_events_published_total{subject="nft.mint.detected.v1"}`. This is out of
scope for `cycle/coherence-foundation` per PRD constraint A-1.

**Operator action**: Suppress or silence `SeamNftMintDetectedSilent` in Alertmanager until
the sonar P1 instrumentation lands. Do NOT treat the continuous firing as a kill/prove
failure.

---

## 8. Production Deployment Note — for:0m → for:5m

The current `alerts.yml` ships with `for: 0m` for kill/prove testing. This means the alert
fires immediately on the first absent evaluation, which is correct for testing but
**incorrect for production**.

**Before deploying to production**, the alert MUST be changed to:

```yaml
for: 5m
```

This 5-minute grace period suppresses transient absent windows caused by rolling pod
restarts, where the series temporarily disappears while the new pod is initializing and
before it has emitted its first metric.

**Without `for: 5m`**, every gateway pod restart will trigger a false-positive alert.

This change MUST be made at deploy time. The sprint plan explicitly records this obligation:
see `grimoires/loa/sprint.md` constraint A-5.
