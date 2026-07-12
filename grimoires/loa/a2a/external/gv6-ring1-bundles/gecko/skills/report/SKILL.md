---
name: report
description: "Synthesize observations into a readable network health report. Aggregates patterns and trends from observation cycles."
allowed-tools: [Bash, Read, Grep, Glob, Write, Edit]
user-invocable: true
---

# Report — Network Health Synthesis

## Purpose

Aggregate observations from `/observe` cycles into a readable network health report. This is the "commit" in the Karpathy Loop — what survived the ratchet, presented for humans.

## Invocation

```bash
/report                     # Generate report from all observations
/report --since 7d          # Last 7 days only
/report --since 2026-03-01  # Since specific date
```

## Workflow

### Step 1: Load Observations

Read `grimoires/gecko/observations.jsonl`. Parse each line as JSON. Filter by `--since` if provided.

### Step 2: Compute Trends

From the observation series:
- **Health trajectory**: Is the score trending up, stable, or declining?
- **Recurring anomalies**: Same construct flagged across multiple observations?
- **Category evolution**: Are empty categories getting filled? Are full ones losing constructs?
- **Freshness decay**: Are more constructs going stale over time?
- **API reliability**: Any downtime patterns?

### Step 3: Load Diagnoses

Read any files in `grimoires/gecko/diagnoses/` that fall within the reporting window. Cross-reference with observations.

### Step 4: Generate Report

Write to `grimoires/gecko/reports/network-health-<date>.md`:

```markdown
# Network Health Report — <date>

## Summary
[2-3 sentences: overall network health, primary trend, key concern]

## Health Score
**Current**: 75/100 | **Trend**: +3 over 7 days | **Baseline**: 72

### Sub-Signals
| Signal | Score | Trend | Notes |
|--------|-------|-------|-------|
| API Liveness | 100 | stable | — |
| Version Freshness | 68 | -2 | webgl-particles stale |
| Category Coverage | 88 | stable | infrastructure empty |
| Identity Drift | 70 | +5 | dynamic-auth improved |
| Composition Density | 60 | stable | — |
| Verification Flow | 50 | stable | all UNVERIFIED |

## Constructs by Health
| Construct | Health | Days Since Update | Drift | Category |
|-----------|--------|-------------------|-------|----------|
| observer | HEALTHY | 3 | aligned | development |
| k-hole | HEALTHY | 5 | aligned | straylight |
| ... | ... | ... | ... | ... |

## Anomalies
[Any patterns that surfaced across multiple observation cycles]

## Diagnoses
[Summary of any deep diagnoses performed this period]

## Bazaar Observations
[Gecko-voice: what the numbers don't capture — foot traffic patterns, energy shifts, cultural signals]
```

### Step 5: Surface

Print report summary to stdout. If health is declining, highlight the top 3 contributing factors.

## Outputs

| Path | Description |
|------|-------------|
| `grimoires/gecko/reports/network-health-<date>.md` | Full network health report |

## Constraints

- Reports are synthesis, not surveillance — aggregate patterns, not individual tracking
- Always include the "Bazaar Observations" section — numbers without narrative miss the point
- Never extrapolate trends beyond the data window — if you have 3 days of data, don't predict next month
- If the network is healthy, say so briefly — don't manufacture concern
