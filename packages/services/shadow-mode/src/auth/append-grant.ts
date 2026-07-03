/**
 * AppendGrant — the store-boundary append capability (SDD sandwich-line §6b-3).
 *
 * The durable append path takes a grant mintable ONLY here (WeakSet identity —
 * the estate's forgeable-reflectable-symbol cure): a forged plain object fails
 * the registry check even if structurally identical. Enumerated minters:
 * JwtProducerPolicy.authorize (verified producers), operatorMigrationGrant
 * (migration/replay, loudly labeled), testGrant (test-marker gated).
 */

const REGISTRY = new WeakSet<AppendGrant>();

export class AppendGrant {
  private constructor(
    public readonly producerId: string,
    /** Allowed observation sources (e.g. 'discord', 'sonar'). Empty = none. */
    public readonly sources: readonly string[],
    /** Allowed event names. Empty = none. */
    public readonly eventNames: readonly string[],
  ) {}

  /** Internal mint — module-private via the minters below. */
  static _mint(producerId: string, sources: string[], eventNames: string[]): AppendGrant {
    const grant = new AppendGrant(producerId, [...sources], [...eventNames]);
    REGISTRY.add(grant);
    return grant;
  }

  allows(source: string, eventName: string): boolean {
    const srcOk = this.sources.includes('*') || this.sources.includes(source);
    const evtOk = this.eventNames.includes('*') || this.eventNames.includes(eventName);
    return srcOk && evtOk;
  }
}

export class GrantError extends Error {}

/** Store-boundary check: identity (unforgeable) + scope. */
export function assertGrant(grant: AppendGrant, source: string, eventName: string): void {
  if (!(grant instanceof AppendGrant) || !REGISTRY.has(grant)) {
    throw new GrantError('append refused: grant is not a minted AppendGrant');
  }
  if (!grant.allows(source, eventName)) {
    throw new GrantError(
      `append refused: producer ${grant.producerId} not scoped for ${source}/${eventName}`,
    );
  }
}

/** Migration/replay principal — every use is loudly attributable in logs. */
export function operatorMigrationGrant(sources: string[], eventNames: string[]): AppendGrant {
  return AppendGrant._mint('operator-migration', sources, eventNames);
}

/** Test seam — refuses outside a test runner (SDD: test-marker gated). */
export function testGrant(sources: string[] = ['*'], eventNames: string[] = ['*']): AppendGrant {
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    throw new GrantError('testGrant is only mintable under a test runner');
  }
  return AppendGrant._mint('test', sources, eventNames);
}
