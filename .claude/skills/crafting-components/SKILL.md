---
timeout_minutes: 30

reads:
  - path: ".claude/rules/sigil-physics.md"
    purpose: "Effect → physics mapping, core physics table"
  - path: "grimoires/sigil/constitution.yaml"
    purpose: "Effect definitions, physics presets, protected capabilities"
  - path: "examples/components/"
    purpose: "Reference implementations (ClaimButton, LikeButton, etc.)"
  - path: "src/components/"
    purpose: "Existing codebase patterns to match"

outputs:
  - path: "src/components/**/*.tsx"
    description: "Generated component with correct physics"

no_questions:
  - "What physics do you prefer?"
  - "Should I use framer-motion or CSS?"
  - "What animation timing?"
  - "Do you want confirmation?"
---

# Crafting Components

> "The codebase is the dataset. Usage is the authority."

<objective>
Generate UI components with correct design physics. Infer effect type from keywords (financial, destructive, standard, local) and apply appropriate sync strategy, timing, and confirmation patterns. Never ask implementation questions—infer from codebase.
</objective>

---

## Physics Decision Tree

When generating a component, follow this decision tree:

```
┌─ Is this a MUTATION? (POST, PUT, DELETE, useMutation)
│
├─ YES ──┬─ Is it FINANCIAL/SENSITIVE?
│        │  Keywords: claim, deposit, withdraw, transfer, swap,
│        │            stake, unstake, burn, pay, purchase
│        │
│        ├─ YES → FINANCIAL MUTATION
│        │        • sync: pessimistic
│        │        • timing: 800ms
│        │        • confirmation: REQUIRED
│        │        • Include: two-phase flow, cancel button
│        │
│        ├─ Is it DESTRUCTIVE (no undo)?
│        │  Keywords: delete, remove, destroy, revoke
│        │
│        ├─ YES → DESTRUCTIVE MUTATION
│        │        • sync: pessimistic
│        │        • timing: 600ms
│        │        • confirmation: REQUIRED
│        │
│        └─ NO → STANDARD MUTATION
│                • sync: optimistic
│                • timing: 200ms
│                • Include: optimistic update, rollback on error
│
└─ NO ───┬─ Is it a QUERY? (GET, fetch, useQuery)
         │
         ├─ YES → QUERY
         │        • sync: optimistic
         │        • timing: 150ms
         │        • Include: loading skeleton, error state
         │
         └─ NO → LOCAL STATE (useState, toggle, expand)
                 • sync: immediate
                 • timing: 100ms
                 • No server round-trip
```

---

## No Questions Policy

Mason NEVER asks:
- "What physics do you prefer?"
- "Should I use framer-motion or CSS?"
- "What animation timing?"
- "Do you want confirmation?"

Instead, Mason infers:
- Physics from effect type (mutation → pessimistic/optimistic)
- Library from existing codebase usage
- Timing from constitution.yaml
- Confirmation from sensitivity level

---

## Workflow

### 1. Parse Intent

Extract what they're building from natural language.

```
Input: "trustworthy claim button"
Parse:
  - Component: Button
  - Action: claim (→ financial mutation)
  - Quality: trustworthy (→ deliberate physics, confirmation)
```

### 2. Determine Physics

Look up effect in constitution.yaml or use defaults:

| Effect | Sync | Timing | Confirmation |
|--------|------|--------|--------------|
| Financial mutation | Pessimistic | 800ms | Required |
| Destructive mutation | Pessimistic | 600ms | Required |
| Standard mutation | Optimistic | 200ms | None |
| Query | Optimistic | 150ms | None |
| Local state | Immediate | 100ms | None |

### 3. Find Canonical Patterns

Search codebase for similar implementations:

```bash
# Find components with similar intent
grep -r "claim\|Claim" src/components/ -l

# Check import count (authority indicator)
grep -r "from.*ClaimButton" src/ | wc -l
```

**Authority heuristic**:
- 10+ imports = Gold (canonical, prefer as template)
- 5+ imports = Silver (established)
- <5 imports = Draft (don't learn from)

### 4. Generate

Create code that embodies the physics:

**For pessimistic sync:**
- Pending state (loading indicator)
- Disabled during mutation
- Success/error handling
- NO optimistic UI updates

**For financial operations:**
- Two-phase confirmation (click → confirm)
- Clear escape hatch (cancel button)
- Explicit amounts shown
- Simulation/preview when possible

**For optimistic sync:**
- Immediate UI update in onMutate
- Rollback in onError
- Snappy spring animations

### 5. Validate

Before outputting, verify:

```
□ Timing matches physics (financial ≥ 500ms)
□ Sync strategy correct (no optimistic on financial)
□ Confirmation present if required
□ Escape hatch exists for mutations
□ Loading states defined
□ Error handling present
```

---

## Example Session

**User**: "/craft claim button for the rewards pool"

**Mason** (internal):
1. Keywords: "claim", "rewards" → financial mutation
2. Physics: pessimistic, 800ms, confirmation required
3. Search: look for existing claim/financial patterns
4. Generate with two-phase flow, cancel button

**Output**:
```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { motion } from 'framer-motion'

export function ClaimButton({ poolId, amount, onSuccess }) {
  const [showConfirm, setShowConfirm] = useState(false)

  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: () => claimRewards(poolId, amount),
    // NO onMutate — pessimistic means no optimistic updates
    onSuccess: () => {
      setShowConfirm(false)
      onSuccess?.()
    },
  })

  if (!showConfirm) {
    return (
      <motion.button
        onClick={() => setShowConfirm(true)}
        whileTap={{ scale: 0.98 }}
      >
        Claim {formatAmount(amount)}
      </motion.button>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <p>Claim {formatAmount(amount)} from pool?</p>
      <button onClick={() => setShowConfirm(false)}>Cancel</button>
      <motion.button
        onClick={() => mutate()}
        disabled={isPending}
        transition={{ duration: 0.8 }}
      >
        {isPending ? 'Claiming...' : 'Confirm Claim'}
      </motion.button>
      {isError && <p className="error">{error.message}</p>}
    </motion.div>
  )
}
```

**Why this is correct:**
- Two-phase confirmation ✓
- Cancel escape hatch ✓
- Pessimistic sync (no onMutate) ✓
- 800ms deliberate animation ✓
- Disabled during pending ✓
- Error display ✓

---

## Skill Orchestration

For complex tasks, crafting-components can invoke other Sigil skills:

```
[debugging-ui skill] "dialog flickers on mobile"
→ Debug UI issues with pattern matching

[monitoring-patterns skill]
→ Check component authority, run governance
```

---

## Protected Capabilities

Some operations must ALWAYS work:

| Capability | Constraint |
|------------|------------|
| Withdraw | Always reachable |
| Cancel | Always visible |
| Balance | Always current |
| Error recovery | Always possible |

When generating, verify protected capabilities are not blocked.

---

*Sigil v11.1.0 "Pure Craft"*
