/**
 * The gated facade — the ONLY public path to a must-settle action. (SKP-001b)
 *
 * This is the sole sanctioned importer of the raw capability. It calls the
 * synchronous gate first and invokes the raw capability iff the gate returns
 * `proceed: true`. There is no other export through which a consumer can reach the
 * raw capability, and the import-boundary test enforces that there never will be —
 * which is what makes the gate unbypassable.
 */

import type { Gate, GateAction } from "../ports/gate.port.js";
import { executeMustSettleAction } from "./_internal/must-settle-capability.js";

export interface GatedOutcome<T> {
  readonly proceeded: boolean;
  readonly reason: string;
  /** Present iff `proceeded` is true. */
  readonly result?: T;
}

/**
 * Run a must-settle `capability` behind the gate.
 * @param gate       the synchronous gate
 * @param action     domain + claim id presented at the call-site
 * @param capability the high-blast-radius action; executed only if the gate proceeds
 */
export function performGatedAction<T>(
  gate: Gate,
  action: GateAction,
  capability: () => T,
): GatedOutcome<T> {
  const decision = gate.checkSync(action);
  if (!decision.proceed) {
    return { proceeded: false, reason: decision.reason };
  }
  return {
    proceeded: true,
    reason: decision.reason,
    result: executeMustSettleAction(capability),
  };
}
