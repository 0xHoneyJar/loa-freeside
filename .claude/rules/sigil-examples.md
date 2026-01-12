# Sigil: Reference Examples

These examples demonstrate correct physics for each effect type.

---

## Example 1: Financial Button (Pessimistic, 800ms)

```
Artist: /craft "claim button that feels trustworthy"

You think:
- "claim" = financial mutation
- "trustworthy" = deliberate physics, clear confirmation
- Physics: pessimistic, 800ms, confirmation required
```

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { motion } from 'framer-motion'

export function ClaimButton({ poolId, amount, onSuccess }) {
  const [showConfirm, setShowConfirm] = useState(false)

  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: () => claimFromPool(poolId, amount),
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
        transition={{ duration: 0.8 }} // Deliberate timing
      >
        {isPending ? 'Claiming...' : 'Confirm Claim'}
      </motion.button>
      {isError && <p className="error">{error.message}</p>}
    </motion.div>
  )
}
```

**Correct because:**
- Two-phase confirmation (click → confirm)
- Cancel escape hatch
- Pessimistic sync (no optimistic update)
- 800ms deliberate animation
- Disabled during pending
- Error display

---

## Example 2: Simple Toggle (Immediate, 100ms)

```
Artist: /craft "dark mode toggle"

You think:
- "toggle" = local state change
- No server sync needed
- Physics: immediate, 100ms, no confirmation
```

```tsx
import { motion } from 'framer-motion'
import { useTheme } from '@/hooks/useTheme'

export function DarkModeToggle() {
  const { theme, setTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button onClick={() => setTheme(isDark ? 'light' : 'dark')}>
      <motion.div
        initial={false}
        animate={{ x: isDark ? 20 : 0 }}
        transition={{
          type: 'spring',
          stiffness: 500,
          damping: 30 // Snappy, immediate feel
        }}
      />
    </button>
  )
}
```

**Correct because:**
- Immediate state change (no server)
- Snappy spring animation (~100ms feel)
- No confirmation needed
- No loading state needed

---

## Example 3: Delete with Undo (Optimistic, 200ms)

```
Artist: /craft "delete button that's not scary"

You think:
- "delete" = destructive mutation
- "not scary" = soft delete with undo, optimistic
- Physics: optimistic (because undo exists), 200ms, toast confirmation
```

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export function DeleteButton({ itemId }) {
  const queryClient = useQueryClient()

  const { mutate, isPending } = useMutation({
    mutationFn: () => softDeleteItem(itemId),

    // Optimistic update (because undo exists)
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['items'] })
      const previous = queryClient.getQueryData(['items'])
      queryClient.setQueryData(['items'], (old) =>
        old.filter(item => item.id !== itemId)
      )
      return { previous }
    },

    onError: (err, _, context) => {
      queryClient.setQueryData(['items'], context?.previous)
      toast.error('Failed to delete')
    },

    onSuccess: () => {
      toast('Item deleted', {
        action: {
          label: 'Undo',
          onClick: () => restoreItem(itemId)
        },
        duration: 5000
      })
    },
  })

  return (
    <button onClick={() => mutate()} disabled={isPending}>
      {isPending ? 'Deleting...' : 'Delete'}
    </button>
  )
}
```

**Correct because:**
- Optimistic update (undo makes it safe)
- Undo action in toast
- 5 second window to undo
- Soft delete, not permanent
- Snappy feel (no deliberate delay)

---

## Diagnosing Existing Code

When asked "why does this feel wrong":

1. Read the component
2. Infer what effect it has
3. Determine what physics it SHOULD have
4. Compare to what it DOES have
5. Identify the mismatch

```
Artist: "This claim button feels off"

You read and find:
- It's a financial mutation (claim)
- But has 150ms animation (should be 800ms)
- And optimistic update (should be pessimistic)
- And no confirmation (should have one)

You explain the mismatch and provide the fix.
```

---

## Protected Capabilities

Some operations must ALWAYS work:

| Capability | Constraint |
|------------|------------|
| **Withdraw** | Always reachable |
| **Cancel** | Always visible |
| **Balance** | Always current |
| **Error recovery** | Always possible |

When generating, verify protected capabilities are not blocked.
