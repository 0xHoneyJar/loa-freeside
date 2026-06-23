/**
 * BarRegistry — the Bar Registration Authority. (T2.2, SKP-002a/005a)
 *
 * Rejects producer-pinned bars (self-grading) and content-binds each bar
 * (sha = sha256 of the criterion), so a producer can neither pin its own success
 * criterion nor edit it after the fact. Carries a TTL validity window.
 */

import type { Bar } from "../domain/claim.js";
import type { BarRegistrar, BarRegistration } from "../ports/bar-registry.port.js";
import { sha256Hex } from "../lib/jcs.js";

export class BarRegistry implements BarRegistrar {
  private readonly registrations = new Map<string, BarRegistration>();

  /** @param producers identities that produce claims (and so may NOT pin bars). */
  constructor(private readonly producers: ReadonlySet<string>) {}

  register(bar: Bar, registeredBy: string, at: number, ttl: number): BarRegistration {
    if (this.producers.has(registeredBy)) {
      throw new Error(
        `producer-pinned bar rejected (SKP-002a): "${registeredBy}" produces claims and cannot pin its own bar`,
      );
    }
    const expectedSha = sha256Hex(bar.criterion);
    if (bar.sha !== expectedSha) {
      throw new Error(
        `bar sha mismatch: criterion hash ${expectedSha} != declared ${bar.sha} (no post-hoc criterion edits)`,
      );
    }
    const reg: BarRegistration = { bar, registered_by: registeredBy, registered_at: at, ttl };
    this.registrations.set(bar.id, reg);
    return reg;
  }

  isValid(barId: string, now: number): boolean {
    const reg = this.registrations.get(barId);
    if (!reg) return false;
    return now <= reg.registered_at + reg.ttl; // SKP-005a
  }

  get(barId: string): BarRegistration | null {
    return this.registrations.get(barId) ?? null;
  }
}
