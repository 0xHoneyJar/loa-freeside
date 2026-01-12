---
timeout_minutes: 20

reads:
  - path: "src/components/"
    purpose: "Find the problematic component"
  - path: "src/**/*.tsx"
    purpose: "Analyze component implementation"

outputs:
  - path: "stdout"
    description: "Diagnosis with confidence % and solution code"

never_ask:
  - "Can you check the console?"
  - "What browser are you using?"
  - "Can you share more details?"
  - "What did you expect to happen?"
  - "Can you reproduce the error?"

pattern_categories:
  - hydration
  - dialog
  - performance
  - layout-shift
  - server-component
  - react-19
  - state
  - async
  - animation
---

# Debugging UI

> "Never ask 'check the console'. Just diagnose."

<objective>
Debug UI issues by matching symptoms to known patterns. Provide solutions ranked by confidence without asking clarifying questions. Categories: hydration, dialog, performance, CLS, RSC, React 19, state, async, animation.
</objective>

---

## Pattern Categories

### 1. Hydration Issues

**Keywords**: hydration, mismatch, server, client, SSR, useEffect, useState

**Common Causes:**
- `useMediaQuery` returns different values on server vs client
- `Date` or `Math.random()` in render
- Browser-only APIs (window, localStorage) in SSR

**Solution Pattern:**
```tsx
// Problem: useMediaQuery mismatch
const isDesktop = useMediaQuery("(min-width: 768px)");
return isDesktop ? <Dialog /> : <Drawer />;

// Solution 1: Wait for mount
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return <Skeleton />;

// Solution 2: CSS-only responsive
<div className="hidden md:block"><Dialog /></div>
<div className="md:hidden"><Drawer /></div>
```

---

### 2. Dialog/Modal Issues

**Keywords**: dialog, modal, drawer, popup, overlay, z-index, scroll, position

**Common Causes:**
- ResponsiveDialog hydration (switches between Dialog/Drawer)
- Scroll lock not releasing
- Z-index conflicts
- Portal mounting issues

**Solution Pattern:**
```tsx
// Problem: Dialog flickers on mobile
// Cause: useMediaQuery hydration

// Solution: Consistent component with CSS responsive
<Dialog>
  <DialogContent className="sm:max-w-md">
    {/* Content adapts via CSS, not component swap */}
  </DialogContent>
</Dialog>
```

---

### 3. Performance Issues

**Keywords**: slow, lag, freeze, re-render, memo, callback, useMemo

**Common Causes:**
- Unnecessary re-renders (missing memo/useMemo)
- Large lists without virtualization
- Layout thrashing (measuring DOM in loops)
- Expensive calculations in render

**Solution Pattern:**
```tsx
// Problem: List re-renders on every parent update

// Solution: Memoize list items
const MemoizedItem = memo(function Item({ data }) {
  return <div>{data.name}</div>;
});

// Solution: Virtualize long lists
<VirtualList
  height={400}
  itemCount={items.length}
  itemSize={50}
>
  {({ index, style }) => (
    <div style={style}>{items[index].name}</div>
  )}
</VirtualList>
```

---

### 4. Layout Shift (CLS)

**Keywords**: shift, jump, CLS, flash, image, dimension, height, width

**Common Causes:**
- Images without dimensions
- Dynamic content above fold
- Web fonts loading
- Ads/embeds without reserved space

**Solution Pattern:**
```tsx
// Problem: Image causes layout shift

// Solution: Always specify dimensions
<Image
  src="/photo.jpg"
  width={800}
  height={600}
  alt="Photo"
  placeholder="blur"
/>

// Or use aspect-ratio
<div className="aspect-video">
  <Image src="/video-thumb.jpg" fill alt="Video" />
</div>
```

---

### 5. Server Component Issues

**Keywords**: 'use client', RSC, server component, hooks, onClick, useState

**Common Causes:**
- Using hooks in Server Components
- Event handlers without 'use client'
- Importing client components incorrectly

**Solution Pattern:**
```tsx
// Problem: useState in Server Component

// Solution: Add 'use client' directive
'use client';

import { useState } from 'react';

export function InteractiveComponent() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

---

### 6. React 19 Deprecations

**Keywords**: forwardRef, defaultProps, deprecated, React 19

**Common Causes:**
- Using forwardRef (now unnecessary)
- Using defaultProps (use default parameters)
- Using legacy context

**Solution Pattern:**
```tsx
// Problem: forwardRef deprecated in React 19

// Before (React 18)
const Button = forwardRef((props, ref) => (
  <button ref={ref} {...props} />
));

// After (React 19)
function Button({ ref, ...props }) {
  return <button ref={ref} {...props} />;
}
```

---

### 7. State Issues

**Keywords**: stale, closure, infinite, loop, object, reference, dependency

**Common Causes:**
- Stale closure in useEffect
- Object/array in dependency array
- Infinite update loops
- Missing dependencies

**Solution Pattern:**
```tsx
// Problem: Stale closure
useEffect(() => {
  const interval = setInterval(() => {
    setCount(count + 1); // count is stale!
  }, 1000);
  return () => clearInterval(interval);
}, []); // count not in deps

// Solution: Use functional update
useEffect(() => {
  const interval = setInterval(() => {
    setCount(c => c + 1); // Always current
  }, 1000);
  return () => clearInterval(interval);
}, []);
```

---

### 8. Async Issues

**Keywords**: race, abort, unmounted, cancelled, pending, loading

**Common Causes:**
- Race conditions (multiple fetches)
- Updates after unmount
- Missing cleanup

**Solution Pattern:**
```tsx
// Problem: Race condition / update after unmount

// Solution: AbortController
useEffect(() => {
  const controller = new AbortController();

  async function fetchData() {
    try {
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      setData(data);
    } catch (e) {
      if (e.name !== 'AbortError') throw e;
    }
  }

  fetchData();
  return () => controller.abort();
}, [url]);
```

---

### 9. Animation Issues

**Keywords**: AnimatePresence, exit, flicker, animation, transition, motion

**Common Causes:**
- Missing AnimatePresence for exit animations
- Key prop issues
- Animation conflicts

**Solution Pattern:**
```tsx
// Problem: Exit animation not playing

// Solution: Wrap with AnimatePresence
<AnimatePresence mode="wait">
  {isVisible && (
    <motion.div
      key="modal"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      Content
    </motion.div>
  )}
</AnimatePresence>
```

---

## Workflow

### 1. Symptom Extraction

Parse user description for:
- Keywords (from categories above)
- Component mentioned
- Context (mobile, desktop, SSR)

### 2. Pattern Matching

Match against 9 categories:
- Score by keyword overlap
- Consider severity

### 3. Investigation

If needed, search codebase:
```bash
# Find the component
grep -r "ComponentName" src/ -l

# Check for common issues
grep -r "useMediaQuery\|useState.*useEffect" src/components/
```

### 4. Diagnosis

Return:
- Most likely cause with confidence %
- Solution code
- Alternative possibilities

---

## Example Session

**User**: "my dialog flickers on mobile"

**Diagnostician** (internal):
1. Keywords: "dialog", "flickers", "mobile"
2. Match: Dialog/Modal Issues + Hydration Issues
3. Likely cause: ResponsiveDialog with useMediaQuery

**Output**:

**Diagnosis: Dialog Hydration Mismatch** (85% confidence)

**Category:** Dialog + Hydration | **Severity:** High

**Cause:** ResponsiveDialog using `useMediaQuery` returns different values on server vs client, causing a flash when the component switches.

**Problem code:**
```tsx
const isDesktop = useMediaQuery("(min-width: 768px)");
return isDesktop ? <Dialog open={open} /> : <Drawer open={open} />;
```

**Solution:**
```tsx
// Option 1: Loading state until mounted
const [mounted, setMounted] = useState(false);
useEffect(() => setMounted(true), []);
if (!mounted) return <DialogSkeleton />;

// Option 2: CSS-only responsive (recommended)
<Dialog>
  <DialogContent className="
    fixed inset-x-0 bottom-0 rounded-t-lg
    sm:inset-auto sm:rounded-lg sm:max-w-md
  ">
    {children}
  </DialogContent>
</Dialog>
```

**Other possibilities:**
- AnimatePresence missing (45% confidence)
- Z-index conflict (30% confidence)

---

## Skill Orchestration

debugging-ui can invoke other Sigil skills:

```
[crafting-components skill] "fix and regenerate component"
→ Generate fixed version with correct patterns

[monitoring-patterns skill] "is there a Gold pattern for this?"
→ Find canonical implementation to reference
```

---

*Sigil v11.1.0 "Pure Craft"*
