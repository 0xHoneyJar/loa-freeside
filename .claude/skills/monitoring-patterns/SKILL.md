---
timeout_minutes: 15

reads:
  - path: "src/components/"
    purpose: "Components to analyze for authority"
  - path: "src/**/*.tsx"
    purpose: "Import statements to count usage"

outputs:
  - path: "stdout"
    description: "Authority report with Gold/Silver/Draft tiers"

no_dialogs:
  - "Should this be promoted?"
  - "Pattern X reached threshold"
  - "Do you want to approve?"
---

# Monitoring Patterns

> "Patterns earn status through usage, not approval dialogs."

<objective>
Monitor component authority based on real usage metrics. Report Gold (10+ imports, 14+ days), Silver (5+ imports), and Draft tiers. Authority is computed from codebase usage, never from approval dialogs or manual promotion.
</objective>

---

## Authority Computation

Authority is computed at runtime from usage metrics. **No file moves required.**

### How to Check Authority

```bash
# Count how many files import a component
grep -r "from.*Button" src/ | wc -l

# Check days since last modification
git log -1 --format="%ar" -- src/components/Button.tsx
```

### Tier Thresholds

| Tier | Min Imports | Min Stability | Description |
|------|-------------|---------------|-------------|
| **Gold** | 10+ | 14+ days | Canonical, widely used |
| **Silver** | 5+ | 7+ days | Established, gaining adoption |
| **Draft** | <5 | any | Experimental, new |

### Key Principle

**Authority is a computed property, not a stored value.**

- No directories like `gold/`, `silver/`, `draft/`
- No file moves required for promotion
- No broken imports when authority changes
- Authority changes automatically as usage changes

---

## Workflow

### 1. Pattern Scanning

Scan for component usage across codebase:

```bash
# Find all components
find src/components -name "*.tsx" -type f

# For each component, count imports
grep -r "from.*ComponentName" src/ | wc -l
```

### 2. Authority Inference

Apply thresholds:

```
imports >= 10 AND stability >= 14 days → Gold
imports >= 5 → Silver
else → Draft
```

### 3. Report Findings

Output authority report:

```
## Component Authority Report

### Gold Tier (Canonical)
- Button (23 imports, 45 days stable)
- Card (18 imports, 30 days stable)
- Input (15 imports, 60 days stable)

### Silver Tier (Established)
- DataTable (7 imports, 10 days stable)
- Modal (6 imports, 8 days stable)

### Draft Tier (Experimental)
- NewFeatureCard (2 imports, 3 days)
- BetaWidget (1 import, 1 day)

### Recommendations
- DataTable approaching Gold (needs 3 more imports, 4 more days)
- Modal approaching Gold (needs 4 more imports, 6 more days)
```

---

## When to Run

### Manual Invocation

```
/garden
```

Run to get a health check of pattern authority.

### Automatic Triggers

Gardener awareness should be part of:
- Code review (prefer Gold patterns)
- Generation (Mason uses Gold as templates)
- Refactoring decisions (don't break Gold patterns)

---

## Integration with Mason

When Mason generates components:

1. Search for Gold-tier patterns first
2. Use Gold patterns as templates
3. Fall back to Silver if no Gold exists
4. Avoid learning from Draft patterns

```
User: /craft "data table with sorting"

Mason checks:
- Any Gold-tier table components? → Use as template
- Any Silver-tier? → Consider patterns
- Only Draft? → Generate fresh, don't copy patterns
```

---

## Health Indicators

| Indicator | Healthy | Warning | Critical |
|-----------|---------|---------|----------|
| Gold patterns | 5+ | 2-4 | 0-1 |
| Orphan components | <10% | 10-20% | >20% |
| Churn rate | <5%/week | 5-15%/week | >15%/week |

### Orphan Components

Components with 0 imports (excluding index files):

```bash
# Find potentially orphaned components
for f in src/components/*.tsx; do
  imports=$(grep -r "from.*$(basename $f .tsx)" src/ | wc -l)
  if [ "$imports" -eq 0 ]; then
    echo "Orphan: $f"
  fi
done
```

---

## Skill Orchestration

monitoring-patterns can invoke other Sigil skills:

```
[crafting-components skill] "generate using Gold patterns"
→ Generate with canonical patterns

[debugging-ui skill] "why is this component not Gold?"
→ Diagnose adoption blockers
```

---

## Example Session

**User**: "/garden"

**Gardener**:

```
## Sigil Garden Report

Scanned: 47 components in src/components/

### Authority Distribution
- Gold: 8 components (17%)
- Silver: 12 components (26%)
- Draft: 27 components (57%)

### Gold Tier (Canonical)
| Component | Imports | Stable |
|-----------|---------|--------|
| Button | 34 | 62 days |
| Card | 28 | 45 days |
| Input | 22 | 58 days |
| Dialog | 18 | 30 days |
| Avatar | 15 | 25 days |
| Badge | 14 | 40 days |
| Tooltip | 12 | 35 days |
| Skeleton | 11 | 28 days |

### Approaching Gold
- DataTable: 8 imports, 12 days (needs 2 imports, 2 days)
- Tabs: 9 imports, 10 days (needs 1 import, 4 days)

### Health
✓ Good Gold coverage (17%)
✓ Low orphan rate (4%)
⚠ High Draft rate - consider consolidating patterns

### Recommendations
1. DataTable and Tabs are close to Gold - encourage usage
2. Review Draft components for consolidation opportunities
3. 2 orphan components could be removed
```

---

*Sigil v11.1.0 "Pure Craft"*
