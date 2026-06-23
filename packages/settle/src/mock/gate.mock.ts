/** Deterministic Gate double — synchronous, decision is whatever the fn returns. (T1.2) */
import type { Gate, GateAction, GateDecision } from "../ports/gate.port.js";

export class MockGate implements Gate {
  constructor(private readonly fn: (action: GateAction) => GateDecision) {}

  checkSync(action: GateAction): GateDecision {
    return this.fn(action);
  }
}
