# Migration runbook + T3.0 decision (cycle-112 S3)

This file records the S3 design decision (T3.0) and the migration PATTERN that
the pilot (S4) demonstrates by hand and that a future codemod would automate.

## PRD reconciliation (read first)

The sprint plan's S3 said "migrate the 8 plain sites." **PRD NG-4 overrides it:**
"Only the pilot seam is migrated + verified end-to-end this cycle. The other ~10
raw NATS emits are allowlisted and tracked, not migrated." So S3 delivers the
**tools** (generator ✓; codemod deferred — see below) and the **pattern**; the
**pilot** is the one migration this cycle (S4). Bulk migration of the remaining
sites is tracked follow-up, not cycle-112 scope.

## T3.0 — kill-switch decision (RESOLVED)

`internal.killswitch` (`packages/adapters/security/kill-switch.ts:150,193`) **gets
a real schema and SHOULD migrate onto `emit()`** — a kill-switch is exactly the
control signal you want ACVP-signed: a forged `internal.killswitch` is a DoS
vector, so signing is a feature, not overhead. The schema (`KillSwitchSignal`:
`reason`, `scope`, `activated_at`, `by`) is authored when the migration happens.

Per NG-4, the kill-switch *migration* is **deferred with the other non-pilot
sites** (tracked follow-up). The decision is recorded here so it is unambiguous
when the migration lands; the allowlist keeps both kill-switch entries until then.

## The migration pattern (what the codemod would do; the S4 pilot does it by hand)

For a static-subject raw emit `this.nats.publish('a.b.c', obj)`:

1. `node packages/events/scripts/new-schema.mjs a-b-c --aggregate a --noun b --verb c`
   → scaffolds `ABCSchema` + `ABCId` + topic helper + registry entry + index export.
2. Fill in the `S.Struct` fields to match `obj`'s real shape (validation-only; no
   `S.transform` unless `transform:true` + REVIEWED_TRANSFORMS — SKP-004).
3. In the cell's composition root, replace the `INatsPublisher` dependency with an
   `Emitter` from `makeEmitter({ cell, transport: createNatsTransport(natsClient),
   signer, prevHashStore })`.
4. Replace the call: `const r = await this.emit(ABCId, obj); if (Either.isLeft(r))
   { this.log.error(...); this.metrics.eventEmitFailed.inc(...); }` (observable
   Left — never silent; §3.4).
5. Delete that site's id from `packages/events/raw-nats-allowlist.yaml::entries`.
6. Update the cell's tests: mock the `Emitter` (a stub returning `Either.right(...)`)
   instead of `createMockNats()`.

For a computed-subject emit (`this.jetstream.publish(targetSubject, data)` —
event-router ×2, NatsClient ×1): use `emitRaw(SchemaId, targetSubject, payload)`
(same validation, caller supplies the subject; the subject must share the
SchemaId's family). Move the id from `entries` to `emitRaw_allowlist` (same id —
the shrink-gate treats this as a no-op, not churn).

## Why no ts-morph codemod this cycle (T3.1/T3.2 deferred)

`ts-morph` / `jscodeshift` / `recast` are not in any package.json, and adding a
dependency autonomously is out of bounds (package mutation needs operator
confirmation). With bulk migration already deferred per NG-4, the marginal value
of a one-shot codemod tool is low — the pilot (S4) demonstrates the pattern by
hand, and the remaining sites migrate incrementally using this runbook. The
ts-morph codemod is a tracked follow-up if/when bulk migration is scheduled.

## Expected allowlist trajectory (corrected for NG-4)

- After S4 (pilot): `entries` shrinks by ONE (`parallel.mode.enabled` removed).
  The other 10 stay tracked (NG-4).
- Bulk migration (follow-up cycles): `entries` → 0, `emitRaw_allowlist` → 3, as
  each site migrates via the runbook above.
- The shrink-gate enforces the monotonic direction throughout (S5 flips it to
  fail-block).
