/**
 * AppendGrant — the store-boundary append capability (SDD sandwich-line §6b-3).
 *
 * Unforgeable by construction: the constructor + registry are module-private,
 * and minting requires a module-private symbol NO external consumer can obtain.
 * Even a package that imports `AppendGrant` (for `instanceof`/type) cannot
 * produce a registered grant — there is no reachable mint. Minters live in this
 * module: `mintGrant` (used by the in-package policies), `operatorMigrationGrant`
 * (migration/replay, loudly labeled), `testGrant` (test-runner gated).
 */

const REGISTRY = new WeakSet<AppendGrant>();
/** Module-private mint token — unexported, so `mintGrant` is the only door. */
const MINT = Symbol('shadow-mode.append-grant.mint');

export class AppendGrant {
  /** Constructor is guarded by the module-private symbol — not callable outside. */
  constructor(
    token: symbol,
    public readonly producerId: string,
    public readonly sources: readonly string[],
    public readonly eventNames: readonly string[],
    /** Communities this grant may write to. Empty = unrestricted (test/migration). */
    public readonly communities: readonly string[] = [],
  ) {
    if (token !== MINT) {
      throw new GrantError('AppendGrant is not constructable outside its module');
    }
  }

  allows(source: string, eventName: string): boolean {
    const srcOk = this.sources.includes('*') || this.sources.includes(source);
    const evtOk = this.eventNames.includes('*') || this.eventNames.includes(eventName);
    return srcOk && evtOk;
  }

  allowsCommunity(communityId: string): boolean {
    return this.communities.length === 0 || this.communities.includes(communityId);
  }
}

export class GrantError extends Error {}

/** In-module mint (NOT exported from the package index). */
export function mintGrant(
  producerId: string,
  sources: string[],
  eventNames: string[],
  communities: string[] = [],
): AppendGrant {
  const grant = new AppendGrant(MINT, producerId, [...sources], [...eventNames], [...communities]);
  REGISTRY.add(grant);
  return grant;
}

/** Store-boundary check: identity (unforgeable) + scope. */
export function assertGrant(grant: AppendGrant, source: string, eventName: string, communityId?: string): void {
  if (!(grant instanceof AppendGrant) || !REGISTRY.has(grant)) {
    throw new GrantError('append refused: grant is not a minted AppendGrant');
  }
  if (!grant.allows(source, eventName)) {
    throw new GrantError(`append refused: producer ${grant.producerId} not scoped for ${source}/${eventName}`);
  }
  if (communityId !== undefined && !grant.allowsCommunity(communityId)) {
    throw new GrantError(`append refused: producer ${grant.producerId} not scoped for community ${communityId}`);
  }
}

/** Migration/replay principal — every use is loudly attributable in logs. */
export function operatorMigrationGrant(sources: string[], eventNames: string[]): AppendGrant {
  return mintGrant('operator-migration', sources, eventNames);
}

/** Test seam — refuses outside a test runner (SDD: test-marker gated). */
export function testGrant(sources: string[] = ['*'], eventNames: string[] = ['*']): AppendGrant {
  if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
    throw new GrantError('testGrant is only mintable under a test runner');
  }
  return mintGrant('test', sources, eventNames);
}
