---
name: observe
description: "Single-pass network health observation. Checks API liveness, namespace freshness, drift, computes Network Health Score."
allowed-tools: [Bash, Read, Grep, Glob, Write, Edit]
user-invocable: true
---

# Observe — Single-Pass Network Health Check

## Purpose

Run a single observation pass across the entire constructs network. Produce structured JSONL observations and compute the Network Health Score. This is the atomic unit — `/patrol` calls this repeatedly, `/report` synthesizes its output.

## Invocation

```bash
/observe                    # Full network pass
/observe --quick            # API-only (skip GitHub checks)
```

## Workflow

### Step 1: Load Baseline

Read the last observation from `grimoires/gecko/observations.jsonl` (if exists). Extract the previous `health_score` for ratchet comparison.

### Step 2: Check API Liveness

```bash
# Health endpoints
curl -s https://api.constructs.network/v1/health | jq .
curl -s https://api.constructs.network/v1/health/ready | jq .

# Registry state
curl -s https://api.constructs.network/v1/constructs | jq '.data | length'
```

Record: `api_status` (healthy/degraded/down), `registered_count`, `response_time_ms`.

### Step 3: Check Namespace Freshness

```bash
# List all construct-* repos under 0xHoneyJar
gh api orgs/0xHoneyJar/repos --paginate -q '.[] | select(.name | startswith("construct-")) | {name, pushed_at, archived}'
```

For each repo, record:
- `slug`: repo name minus `construct-` prefix
- `last_push`: ISO timestamp
- `days_stale`: days since last push
- `archived`: boolean

Flag constructs with `days_stale > 30` as `STALE`. Flag `days_stale > 90` as `ABANDONED`.

### Step 4: Check Category Distribution

Query the API or parse construct.yaml files for `domain[0]` to determine category assignments. Count constructs per category across the 8 canonical categories:
- development, security, design, documentation, operations, infrastructure, research, straylight

Flag categories with 0 constructs as `EMPTY_CATEGORY`.

### Step 5: Check Identity-Reality Drift (if not --quick)

For each construct in the namespace:
1. Read `identity/persona.yaml` — extract `cognitiveFrame.archetype` and `voice.personality_markers`
2. Read `skills/*/SKILL.md` — extract actual methodology steps
3. Compare: does the skill methodology reflect the persona's claimed expertise?
4. Score drift: `ALIGNED` (0), `MINOR_DRIFT` (1-2 mismatches), `SIGNIFICANT_DRIFT` (3+)

This step requires cloning or reading repos via `gh api`. For speed, use:
```bash
gh api repos/0xHoneyJar/construct-{slug}/contents/identity/persona.yaml -q .content | base64 -d
gh api repos/0xHoneyJar/construct-{slug}/contents/construct.yaml -q .content | base64 -d
```

### Step 6: Compute Network Health Score

Weighted composite (0-100):

| Sub-Signal | Weight | Scoring |
|---|---|---|
| API Liveness | 0.20 | healthy=100, degraded=50, down=0 |
| Version Freshness | 0.25 | avg(100 - min(days_stale, 100)) across all constructs |
| Category Coverage | 0.15 | (filled_categories / 8) * 100 |
| Identity-Reality Drift | 0.20 | avg(aligned=100, minor=70, significant=30) across all |
| Composition Density | 0.10 | (constructs_with_compose_with / total) * 100 |
| Verification Flow | 0.10 | (non_unverified / total) * 100 |

### Step 7: Emit Observation

Append to `grimoires/gecko/observations.jsonl`:

```json
{
  "timestamp": "2026-03-12T00:00:00Z",
  "health_score": 72,
  "health_delta": -3,
  "api_status": "healthy",
  "registered_count": 15,
  "namespace_count": 16,
  "stale_constructs": ["webgl-particles"],
  "empty_categories": ["infrastructure"],
  "drift_detected": [{"slug": "dynamic-auth", "level": "MINOR_DRIFT"}],
  "anomalies": []
}
```

### Step 8: Surface Findings

If `health_delta < 0` (health degraded), surface the contributing sub-signals as findings. If `health_delta >= 0`, report quietly — the ratchet held.

Output format (to stdout):
```
gecko | health: 72 (-3) | api: healthy | stale: 1 | drift: 1 | categories: 7/8
```

If anomalies exist, list them. Otherwise, one line is enough.

## Outputs

| Path | Description |
|------|-------------|
| `grimoires/gecko/observations.jsonl` | Append-only observation log |

## Constraints

- Never modify construct source files
- Never extrapolate — if you can't measure it, don't score it
- API failures are `degraded`, not `anomaly` — the network survives without the registry
- Identity-reality drift is a signal, not a judgment — flag it, don't prescribe fixes
