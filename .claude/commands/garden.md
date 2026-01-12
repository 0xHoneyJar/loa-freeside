---
name: "garden"
version: "11.1.0"
description: |
  Health report on pattern authority and component usage.
  Reports Gold/Silver/Draft tiers based on import counts and stability.

arguments: []

agent: "monitoring-patterns"
agent_path: "skills/monitoring-patterns/"

context_files:
  - path: "src/components/"
    required: false
    purpose: "Components to analyze"

mode:
  default: "foreground"
---

# /garden

Get a health report on your design system's pattern authority.

## Invocation

```
/garden
```

## Agent

Launches `monitoring-patterns` from `skills/monitoring-patterns/`.

See: `skills/monitoring-patterns/SKILL.md` for full workflow details.

## Authority Tiers

| Tier | Min Imports | Min Stability | Description |
|------|-------------|---------------|-------------|
| **Gold** | 10+ | 14+ days | Canonical patterns |
| **Silver** | 5+ | 7+ days | Established patterns |
| **Draft** | <5 | any | Experimental |

## Outputs

Authority report including:
- Component distribution by tier
- Gold tier canonical patterns
- Components approaching Gold
- Orphan components (0 imports)
- Health indicators and recommendations

## Example Output

```
## Sigil Garden Report

### Authority Distribution
- Gold: 8 components (17%)
- Silver: 12 components (26%)
- Draft: 27 components (57%)

### Gold Tier (Canonical)
| Component | Imports | Stable |
|-----------|---------|--------|
| Button | 34 | 62 days |
| Card | 28 | 45 days |

### Recommendations
1. DataTable approaching Gold - encourage usage
2. 2 orphan components could be removed
```

<user-request>
$ARGUMENTS
</user-request>
