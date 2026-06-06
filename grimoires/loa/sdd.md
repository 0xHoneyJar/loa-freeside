# SDD: Cluster-Coherence Foundation — P0 Seam Cadence Counter + Absent-Series Alert

> **Status**: DRAFT
> **Cycle**: cycle/coherence-foundation
> **Date**: 2026-06-03
> **PRD**: `grimoires/loa/prd.md`
> **Scope**: P0 only — additive, reversible, single-repo `loa-freeside`

---

## 1. Problem Recap

Prometheus alert rules in `infrastructure/observability/prometheus/alerts.yml` use threshold
comparisons (`== 0`, `rate(...) > N`). Kubernetes pod-based target discovery via
`kubernetes_sd_configs role:pod` removes series entirely when a pod is deleted or stops
scraping — the series goes **absent**, it does not emit `0`. A `== 0` expression cannot fire
on an absent series. Only `absent_over_time()` can.

Consequence: a dead publisher is observationally indistinguishable from a healthy-but-quiet
publisher. This is INV-3 (free-energy / absence correctness defect) per
`grimoires/loa/context/2026-06-03-building-membrane-baseline.md`.

This SDD specifies the two P0 changes that close INV-3 for the `nft.mint.detected.v1` seam:
(1) a per-subject published-cadence counter at the NATS publish motor edge, and (2) an
`absent_over_time()` alert on that counter.

---

## 2. System Context

```
┌─────────────────────────────────────────────────────────────────────┐
│  loa-freeside (this repo)                                            │
│                                                                      │
│  ┌──────────────────────────┐              ┌────────────────────┐   │
│  │  apps/gateway (Rust)     │──JetStream──▶│  NATS JetStream    │   │
│  │  - Discord event router  │              │  COMMANDS / EVENTS │   │
│  │  - metrics/mod.rs        │              └────────────────────┘   │
│  │  - nats/publisher.rs     │                                        │
│  └───────────┬──────────────┘                                        │
│              │ GET /metrics                                           │
│  ┌───────────▼──────────────┐  scrape   ┌────────────────────────┐  │
│  │  Prometheus              │──────────▶│  alerts.yml             │  │
│  │                          │           │  + arrakis-seam-cadence │  │
│  └───────────────────────────┘           └───────────┬────────────┘  │
└──────────────────────────────────────────────────────┼──────────────┘
                                                       │ HTTP API
                                                       │ /api/v1/alerts
┌──────────────────────────────────────────────────────▼──────────────┐
│  freeside-coherence (external repo — NOT in loa-freeside)           │
│  Queries Prometheus alert state; must not read fixtures for R-4     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  freeside-sonar (external repo)                                      │
│  Actual publisher of nft.mint.detected.v1 via JetStream             │
│  P1: must adopt gateway_events_published_total counter here         │
└─────────────────────────────────────────────────────────────────────┘
```

**Boundary note — A-1 resolution**: The `apps/gateway` Rust publisher routes Discord-sourced
events only: `commands.*`, `events.guild.*`, `events.member.*` (see `publisher.rs:159–176`).
It does NOT publish `nft.mint.detected.v1`. That subject is owned by `freeside-sonar`
(external). The counter added here covers the gateway's own subjects. The
`nft.mint.detected.v1` alert will fire continuously (series permanently absent) until sonar
adopts the same counter pattern — a P1 prerequisite, tracked separately. The kill/prove test
in §8 uses `commands.interaction`, which the gateway does publish.

---

## 3. Component Design

### 3.1 Counter Addition — `apps/gateway/src/metrics/mod.rs`

**New `describe_counter!` call** — added inside `register_metrics()` after the existing
block ending at line 54:

```rust
describe_counter!(
    "gateway_events_published_total",
    Unit::Count,
    "Total events published to JetStream by NATS subject"
);
```

**New method on `GatewayMetrics`**:

```rust
/// Record a successful JetStream publish, labeled by NATS subject.
pub fn record_publish_success(&self, subject: &str) {
    counter!(
        "gateway_events_published_total",
        "subject" => subject.to_string()
    )
    .increment(1);
}
```

This is the single increment surface. It fires after a confirmed JetStream ACK.

The existing `record_route_success(&self, shard_id: u64, duration: Duration)` at
`metrics/mod.rs:106` is NOT modified. It carries a `shard_id` dimension and operates at
shard granularity; it is a distinct instrument at a different conceptual boundary. The
PRD requirement (R-1) is explicit: `record_route_success` "MUST NOT be repurposed."

**Cardinality bound — A-2**: The `subject` label has fixed cardinality driven by the
`route_event` match arms in `publisher.rs:159–176`. Current subjects the gateway produces:
`commands.interaction`, `events.guild.join`, `events.guild.leave`, `events.guild.update`,
`events.member.join`, `events.member.leave`, `events.member.update`, and a catch-all
`events.<type>` for unrecognized event types. Upper bound ≈ 15 distinct values.
`metrics_exporter_prometheus` has no cardinality cap by default; no `PrometheusBuilder`
configuration change is required. A-2 risk is not realized.

### 3.2 Publisher Integration — `apps/gateway/src/nats/publisher.rs`

The `metrics` crate uses a **process-global recorder** installed by
`PrometheusBuilder::new().install_recorder()` at gateway startup (`metrics/mod.rs:20–22`).
The `counter!()` macro resolves against this global recorder at call time. No struct field
or dependency injection is needed on `NatsPublisher`.

**Increment site**: Inside `publish_event`, at the JetStream ACK success path
(currently lines 127–135), immediately after
`self.messages_published.fetch_add(1, Ordering::Relaxed)`:

```rust
// Existing — preserved unchanged per PRD R-1:
self.messages_published.fetch_add(1, Ordering::Relaxed);

// New — Prometheus counter at motor edge, subject-labeled:
counter!(
    "gateway_events_published_total",
    "subject" => subject.clone()
)
.increment(1);
```

The `subject` variable is already in scope at this site — it is computed by
`route_event(event)` at line 108 and bound as `let subject = self.route_event(event)`.
No new parameter threading is required.

The `metrics` import (`use metrics::{counter, ...}`) must be confirmed present or added
to `publisher.rs`. The module already uses the crate indirectly via `GatewayMetrics`; a
direct `use metrics::counter;` import in `publisher.rs` may be needed.

**Failure paths** (lines 137–154): The counter is NOT incremented on publish failure.
It is a success counter. Failures are already tracked by `self.publish_failures` and
surface via `gateway_route_failures_total`.

### 3.3 Alert Addition — `infrastructure/observability/prometheus/alerts.yml`

A new group is **appended** to the existing file. Zero existing groups or rules are touched.

```yaml
# =============================================================================
# Seam Cadence Alerts — INV-3 closure (absent_over_time pattern)
# cycle/coherence-foundation · 2026-06-03
# =============================================================================
- name: arrakis-seam-cadence
  rules:
    - alert: SeamNftMintDetectedSilent
      # absent_over_time fires when the series has no data points in the window.
      # kill/prove: for:0m fires immediately on first absent evaluation.
      # PRODUCTION: change to for:5m before deploying — filters transient pod restarts.
      expr: absent_over_time(gateway_events_published_total{subject="nft.mint.detected.v1"}[30m])
      for: 0m
      labels:
        severity: warning
        component: seam
        seam: nft.mint.detected.v1
      annotations:
        summary: "nft.mint.detected.v1 seam has produced no events for 30 minutes"
        description: >
          The nft.mint.detected.v1 cadence seam has been silent for ≥30m. Either
          freeside-sonar stopped indexing, the gateway series is absent (pod
          deleted/crashed), or sonar has not yet adopted the gateway_events_published_total
          counter (P1 prerequisite — see cycle/coherence-foundation PRD A-1).
          absent_over_time fires; == 0 rules cannot. This is the INV-3 correctness
          distinction.
        runbook_url: "https://wiki.internal/runbooks/seam-silence"
```

**Window rationale — A-3**: 30 minutes is conservative relative to Berachain NFT mint
activity on active networks. During genuine low-volume periods (new-collection dry spells,
off-chain windows), this window may produce false positives. Monitor the signal-to-noise
ratio over the first two weeks in production; adjust to `[60m]` if false-positive rate
degrades operator trust.

**Production `for` value — A-5 resolution**: The YAML above carries `for: 0m` for the
kill/prove test configuration. Before production deployment, this MUST be changed to
`for: 5m`. The 5-minute pending window suppresses transient absent windows during rolling
pod restarts (typical gateway pod restart + readiness probe cycle < 2 minutes). Leaving
`for: 0m` in production fires an alert on every deploy. The comment in the YAML makes this
obligation visible to the implementer.

**`seam:` label**: A new label dimension not present on any existing alert. Its value is the
canonical NATS subject string. The coherence explorer filters on this label to surface
seam-specific alert state.

**Validation gate**: `promtool check rules alerts.yml` must exit 0 before the sprint closes.

### 3.4 Coherence Surface Wire — R-4

`freeside-coherence` is an external Next.js application absent from `loa-freeside`. Its
current state: live, but reads fixtures
(`grimoires/loa/context/2026-06-03-building-membrane-baseline.md:39`).

**R-4 minimum bar**: `SeamNftMintDetectedSilent`'s firing state must be readable from the
explorer without the operator navigating to Prometheus.

**Design — Prometheus HTTP API query**:

```
GET /api/v1/alerts
```

Returns all currently-firing alerts with labels and annotations. The explorer filters for
entries where `labels.seam == "nft.mint.detected.v1"` to surface the cadence seam state.

Alternatively, a single-alert query:

```
GET /api/v1/query?query=ALERTS{alertname="SeamNftMintDetectedSilent",alertstate="firing"}
```

Returns a non-empty vector when firing, empty vector when inactive. The explorer converts
this to a binary signal: green (inactive) or red (firing).

**Implementation boundary**: The API call lives in a Next.js server component or API route
inside `freeside-coherence`. `PROMETHEUS_URL` is a build-time env var. No changes to
`loa-freeside` are required for the wire. The change owner is the `freeside-coherence`
maintainer.

**BLOCKER gate — A-4 resolution**: If `freeside-coherence` does not have a live Prometheus
data path wired before the P0 sprint is ready to close, a BLOCKER bead must be filed
against the coherence explorer with a named owner. The sprint cannot be marked done while a
firing alert is only discoverable via Prometheus directly. If the wire is blocked by a
prerequisite out of P0 scope, the prerequisite must be named explicitly in the BLOCKER.

---

## 4. Data Model

### 4.1 Metric Schema

| Field | Value |
|-------|-------|
| Name | `gateway_events_published_total` |
| Type | Counter (monotonically increasing; resets on process restart) |
| Label key | `subject` |
| Label value example | `commands.interaction`, `events.guild.join` |
| Increment condition | After `ack_future.await` returns `Ok(ack)` — JetStream ACK confirmed |
| Cardinality upper bound | ≈ 15 distinct values (bounded by `route_event` match arms) |
| Exposed at | `GET /metrics` via `GatewayMetrics::render()` (`metrics/mod.rs:178`) |

### 4.2 Alert Schema

| Field | Kill/Prove Value | Production Value |
|-------|----------------|-----------------|
| Alert name | `SeamNftMintDetectedSilent` | same |
| Expression | `absent_over_time(gateway_events_published_total{subject="nft.mint.detected.v1"}[30m])` | same |
| `for` | `0m` | `5m` |
| Severity | `warning` | `warning` |
| Labels added | `component: seam`, `seam: nft.mint.detected.v1` | same |

### 4.3 Subject Key Resolution — A-6

`nftMintDetectedTopic()` in `packages/events/src/topics.ts:75` produces:
- Base form (no collection specifier): `nft.mint.detected.v1`
- Collection-specific: `nft.mint.detected.<slug>.v1` (e.g., `nft.mint.detected.mibera-shadow.v1`)

A Prometheus selector `subject="nft.mint.detected.v1"` does NOT match
`nft.mint.detected.mibera-shadow.v1` — these are distinct label values.

**Decision**: The P0 alert uses the base form. If sonar publishes only collection-specific
subjects and never the base form, this alert fires permanently (base form never populated).
Verification of which form sonar publishes is a P1 concern at sonar instrumentation time.
If sonar publishes only collection-specific subjects, the production alert expression must
use the aggregation form:

```promql
absent_over_time(sum(gateway_events_published_total{subject=~"nft\\.mint\\.detected\\..*"})[30m])
```

This is a P1 amendment. The P0 alert is additive and does not break anything.

---

## 5. Security Design

### 5.1 Label Injection

The `subject` label value is computed by `route_event` from `event.event_type`, which is
derived from a Twilight `Event` enum match (structured internal data). It is not
user-supplied input. No injection surface exists.

### 5.2 Metrics Endpoint Exposure

`GET /metrics` is already served by the gateway. No new attack surface is introduced.
Access must remain restricted to the internal Prometheus scrape subnet (existing policy,
unchanged).

### 5.3 Alert Expression Safety

`absent_over_time()` is a read-only PromQL function. Alert rules execute in the Prometheus
evaluation engine in the infrastructure subnet. No state mutation is possible.

### 5.4 Coherence Surface API Access

The Prometheus HTTP API query from `freeside-coherence` requires only read access to
`/api/v1/alerts`. If Prometheus is configured with authentication, the `PROMETHEUS_URL`
token must be read-only. This is a `freeside-coherence`-side responsibility, noted here for
the R-4 integration owner.

---

## 6. Error Handling

### 6.1 Counter Registration Failure

`install_recorder()` panics on failure (existing behavior, `metrics/mod.rs:22`). The new
`describe_counter!` call follows existing convention. No additional error handling needed.

### 6.2 Counter Increment on Absent Recorder

`counter!()` silently no-ops if no recorder is installed. In practice, the recorder is
installed during gateway startup before any publish path executes — this case is unreachable
in normal operation.

### 6.3 Alert Fires Permanently on Absent Series

If `gateway_events_published_total{subject="nft.mint.detected.v1"}` is never populated
(because sonar is the publisher and has not adopted the counter), `absent_over_time`
evaluates to `1` continuously. This is correct behavior — the series is genuinely absent.
The alert description annotation explains the sonar P1 prerequisite. Operators must not
treat a continuously-firing alert as a P0 defect; it signals a documented open gap.

### 6.4 `promtool` Validation Failure

`promtool check rules alerts.yml` must pass before merge. A non-zero exit blocks the sprint.

### 6.5 Coherence Explorer Data Path Failure

If the Prometheus API call returns an error or non-200, the explorer must render an
explicit "data unavailable" state — not silently show "no alerts firing" (that state is
indistinguishable from a true green). This is a `freeside-coherence`-side requirement for
the R-4 integration owner.

---

## 7. Assumptions Closed

| # | Assumption | Resolution |
|---|------------|-----------|
| A-1 | Gateway does not publish `nft.mint.detected.v1` | Confirmed. Kill/prove uses `commands.interaction`. `nft.mint.detected.v1` alert requires sonar instrumentation (P1). §2, §8. |
| A-2 | `subject` label fits within cardinality limits | Cardinality ≈ 15, no exporter cap configured. Risk not realized. §3.1. |
| A-3 | 30-minute window conservative for cadence | Appropriate. Monitor and adjust to 60m if false-positive rate increases. §3.3. |
| A-4 | Coherence explorer can consume Prometheus API | Design uses `/api/v1/alerts`. BLOCKER bead required if not wired before sprint closes. §3.4. |
| A-5 | `for: 0m` for kill/prove; `for: 5m` for production | Both values specified in §3.3 alert table. Comment in YAML makes the production obligation visible. |
| A-6 | Base form vs collection-specific subject | Alert uses base form. Wildcard amendment deferred to P1 sonar instrumentation. §4.3. |

---

## 8. Kill/Prove Protocol

The kill/prove is a required acceptance gate per PRD §R-3 — not optional.

### 8.1 Test Subject

Because the gateway does not publish `nft.mint.detected.v1`, the kill/prove test uses
`commands.interaction` — a subject the gateway publishes on every Discord slash command
interaction.

For the kill/prove run, temporarily adjust the alert expression:

```yaml
expr: absent_over_time(gateway_events_published_total{subject="commands.interaction"}[5m])
for: 0m
```

A 5-minute window reduces iteration time. After acceptance, the production alert reverts to
`nft.mint.detected.v1`, window `[30m]`, `for: 5m`.

### 8.2 Prove Procedure

1. **Baseline confirmation**: Verify Discord interactions are flowing (or inject test
   publishes via `nats pub`). Confirm `gateway_events_published_total{subject="commands.interaction"}`
   is present in `/metrics`. Confirm `SeamNftMintDetectedSilent` is NOT firing.

2. **Kill**: Stop the gateway pod or block its JetStream connection.
   `gateway_events_published_total{subject="commands.interaction"}` ceases to be updated.

3. **Wait**: After the `absent_over_time` window (5m for kill/prove),
   `SeamNftMintDetectedSilent` fires. Verify:
   ```
   GET /api/v1/query?query=ALERTS{alertname="SeamNftMintDetectedSilent",alertstate="firing"}
   ```
   Returns a non-empty result.

4. **Verify threshold rules silent**: During the same window, confirm ALL of the following
   do NOT fire:
   - `GatewayShardDown` (`gateway_shards_ready == 0`): series goes absent on pod stop —
     `== 0` cannot fire on an absent series.
   - `GatewayNATSPublishFailures` (`rate(gateway_nats_publish_failures_total[5m]) > 0.01`):
     rate over an absent series is undefined — rule does not fire.
   - This simultaneous state — `absent_over_time` fires, threshold rules silent — is the
     INV-3 correctness proof.

5. **Document**: Record the kill/prove result (timestamps, screenshots, or Prometheus query
   output) in the sprint notes or a beads task before closing the sprint.

### 8.3 `nft.mint.detected.v1` Operational Note

The kill/prove confirms the mechanism on a gateway-native subject. The `nft.mint.detected.v1`
alert in production fires continuously until sonar emits the counter. This is an open P1 gap
documented in the alert's description annotation. It is not a P0 defect. Sprint notes must
record this so the observer does not confuse a continuously-firing alert with a kill/prove
failure.

---

## 9. Reversibility

All changes are additive:

| File | Change | Revert |
|------|--------|--------|
| `apps/gateway/src/metrics/mod.rs` | +1 `describe_counter!` call, +1 method | Remove both |
| `apps/gateway/src/nats/publisher.rs` | +1 `counter!()` increment call in ACK success path | Remove the call |
| `infrastructure/observability/prometheus/alerts.yml` | +1 new group appended at end | Remove the group |

Zero existing metrics, alerts, routing logic, or tests are modified. A single `git revert`
of the P0 commit(s) restores full prior state.

---

## 10. Deferred to P1

- `gateway_events_published_total` counter in `freeside-sonar` — prerequisite for
  `nft.mint.detected.v1` alert to be operationally meaningful
- BeaconV3 `membrane` field schema addition (`packages/beacon-schema/src/beacon-v3.ts`)
- `ts-morph` AST membrane extractor
- `freeside-cli graph dump` and `doctor.ts checkMembrane` sub-check
- Cross-field race fixture for sealed-schema / `cluster.eventsPin` invariant
- Fan-out to `parallel.mode.enabled.v1` and future seams
- Fail-block teeth (severity escalation, automated circuit-break)
- Alert Manager channel routing

---

## 11. Flatline Pre-Check

No Flatline findings exist prior to this SDD (first write). The following design decisions
carry the highest risk for findings on first Flatline pass:

| Risk surface | Design response |
|-------------|----------------|
| `nft.mint.detected.v1` alert permanently fires (A-1 gap) | Documented in alert annotation; kill/prove scoped to gateway subject. Alert is informational, not a circuit-breaker. |
| `for: 0m` in production | Comment in YAML specifies `for: 5m` production value. Must be changed before deploy. |
| Coherence surface BLOCKER | BLOCKER gate explicit in §3.4. Sprint cannot close without live data path or named owner. |
| Base-form vs collection-specific alert expression (A-6) | Defer wildcard to P1; base form alert is additive and does not break existing state. |

When Flatline produces findings, each finding must be addressed before the sprint plan is
approved. This SDD will be updated with a findings table at that point.

---

## References

| Source | Path | Use |
|--------|------|-----|
| Gateway metrics module | `apps/gateway/src/metrics/mod.rs` | Counter declaration site |
| Gateway NATS publisher | `apps/gateway/src/nats/publisher.rs:107–155` | ACK success increment site |
| Event topics | `packages/events/src/topics.ts:75–85` | Canonical subject form |
| Prometheus alerts | `infrastructure/observability/prometheus/alerts.yml` | Alert addition target |
| PRD | `grimoires/loa/prd.md` | Requirements this SDD implements |
| Building membrane baseline | `grimoires/loa/context/2026-06-03-building-membrane-baseline.md` | INV-3 classification, coherence surface state |
