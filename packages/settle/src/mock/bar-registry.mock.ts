/** In-memory BarRegistrar double — no producer/sha checks (test convenience). (T2.2) */
import type { Bar } from "../domain/claim.js";
import type { BarRegistrar, BarRegistration } from "../ports/bar-registry.port.js";

export class MockBarRegistrar implements BarRegistrar {
  private readonly regs = new Map<string, BarRegistration>();

  register(bar: Bar, registeredBy: string, at: number, ttl: number): BarRegistration {
    const reg: BarRegistration = { bar, registered_by: registeredBy, registered_at: at, ttl };
    this.regs.set(bar.id, reg);
    return reg;
  }

  isValid(barId: string, now: number): boolean {
    const reg = this.regs.get(barId);
    return reg ? now <= reg.registered_at + reg.ttl : false;
  }

  get(barId: string): BarRegistration | null {
    return this.regs.get(barId) ?? null;
  }
}
