/**
 * RAW MUST-SETTLE CAPABILITY — package-private. (SKP-001b)
 *
 * This is the bare ability to perform a high-blast-radius ("must-settle") action.
 * It is deliberately NOT exported from `src/index.ts`, and the ONLY module
 * permitted to import it is the sibling `../gated-facade.ts`.
 *
 * `src/__tests__/import-boundary.test.ts` scans the whole source tree and fails
 * (CI + local `vitest run`) if ANY other file — including a test trying to bypass
 * the gate — imports this module. That failing test IS the unbypassable proof:
 * the only path to a must-settle action is through the gate (G-2).
 */

/** Execute the wrapped capability. Caller MUST be the gated facade, which only
 *  reaches here after `gate.checkSync(...).proceed === true`. */
export function executeMustSettleAction<T>(capability: () => T): T {
  return capability();
}
