# S1-T4 async port inventory (BEFORE the refactor — SDD 6b-1 review artifact)

Generated 2026-07-03 from grep of packages/services/shadow-mode (excl. tests/adapters).

## ILedgerStore methods (ports/ledger-store.ts) — sync → async

| Method | Before | After |
|---|---|---|
| appendObservationIfAbsent | `(o): boolean` | `(o): Promise<boolean>` |
| withTransaction | `<T>(fn: () => T): T` | `<T>(fn: () => Promise<T> \| T): Promise<T>` |
| getSubject / findSubjectByAlias | `→ ShadowSubject \| undefined` | `→ Promise<ShadowSubject \| undefined>` |
| upsertSubject / deleteSubject / upsertAlias | `→ void` | `→ Promise<void>` |
| hasEdge | `→ boolean` | `→ Promise<boolean>` |
| upsertEdge / reassignEdges | `→ void` | `→ Promise<void>` |
| upsertDivergence / deleteDivergence / upsertReport | `→ void` | `→ Promise<void>` |
| subjects / edges / divergences | `→ T[]` | `→ Promise<T[]>` |
| getChainHead | `→ ChainLink \| undefined` | `→ Promise<ChainLink \| undefined>` |
| verifyChain | `→ ChainVerdict` | `→ Promise<ChainVerdict>` |
| isChainFrozen | `→ boolean` | `→ Promise<boolean>` |
| clearChainFreeze | `→ void` | `→ Promise<void>` |

## Call-sites

- `shadow-ledger.ts` — 33 `this.store.*` sites, all inside `ingest()` (one withTransaction
  closure) + the 4 read methods (`getMemberGraph`, `getUnresolved`, `getDivergences`,
  `getConfig`). ALL become awaited; public surface: `ingest`, `getMemberGraph`,
  `getUnresolved`, `getDivergences` → async (getConfig reads static config — stays sync if it
  doesn't touch the store; verified at edit time).
- `http/shadow-router.ts` — 1 site (`ledger.ingest(event)` :43) + any read routes → awaited.
- `adapters/in-memory-store.ts` — implements the async port (async methods, same bodies).
- Tests: `__tests__/ledger.test.ts` + `chain.test.ts` + router tests — mechanical `await` adds.

## Invariant preserved
In-memory atomicity note: appendObservationIfAbsent stays a single synchronous check-and-set
INSIDE its async wrapper (no await between read and write) — the atomicity argument is unchanged.
Behavior-identical: same assertions, awaited.
