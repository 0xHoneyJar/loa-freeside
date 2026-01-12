# Reference Implementations

These components demonstrate correct physics for each effect type.

## Financial Mutation — `ClaimButton.tsx`

**Physics**: Pessimistic, 800ms, Confirmation Required

The most conservative physics. Use for:
- Token claims, deposits, withdrawals
- Payments, purchases
- Any value transfer

Key patterns:
- Two-phase flow (click → confirm)
- No optimistic updates
- Deliberate 800ms animations
- Cancel always available
- Explicit amounts shown

## Standard Mutation — `LikeButton.tsx`

**Physics**: Optimistic, 200ms, No Confirmation

Snappy and confident. Use for:
- Likes, follows, bookmarks
- Saves, updates
- Toggle preferences

Key patterns:
- Optimistic update in `onMutate`
- Rollback in `onError`
- Snappy spring animation
- No loading state (optimistic makes it instant)

## Soft Delete — `DeleteButton.tsx`

**Physics**: Optimistic (because undo), 200ms, Toast with Undo

The middle ground. Use for:
- Reversible deletions
- Archive operations
- "Trash" functionality

Key patterns:
- Optimistic update (item disappears)
- Undo action in toast
- 5-second undo window
- Feels confident, not scary

## Local State — `ThemeToggle.tsx`

**Physics**: Immediate, 100ms, No Confirmation

Pure client state. Use for:
- Toggles, tabs, accordions
- UI preferences
- Any non-persisted state

Key patterns:
- No server calls
- Instant spring animation
- No loading states
- No error handling needed

---

## The Pattern

Every component follows the same structure:

1. **Identify the effect** — What does this code DO?
2. **Look up physics** — What sync, timing, confirmation?
3. **Implement correctly** — Match the physics rules
4. **Validate** — Check the physics checklist

The physics determine everything. The effect determines the physics.
