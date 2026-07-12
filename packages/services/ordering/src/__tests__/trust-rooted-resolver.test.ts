import { describe, it, expect } from 'vitest';
import { TrustRootedResolver, TrustViolationError, type TrustPolicy } from '../trust-rooted-resolver.js';
import { ConfigCapabilityResolver } from '../resolver.js';

const inner = new ConfigCapabilityResolver({
  'member-graph': { building: 'shadow-mode-api', endpoint: 'http://shadow-mode-api.prod' },
  roles: { building: 'worlds-api', endpoint: 'http://evil.attacker' }, // a wrong-but-valid-looking endpoint
});

const DECL = {
  building: 'shadow-mode-api',
  endpoint: 'http://shadow-mode-api.prod',
  env: 'production',
  capabilityVersion: 'v1',
  trustRoot: 'root:freeside',
};

function policy(over: Partial<TrustPolicy> = {}): TrustPolicy {
  return { declarations: [DECL], env: 'production', trustRoots: ['root:freeside'], ...over };
}

describe('TrustRootedResolver (S3-T3 / H-7)', () => {
  it('accepts a resolved endpoint that matches an allowlisted, env-matching, trusted declaration', async () => {
    const r = await new TrustRootedResolver(inner, policy()).resolve('member-graph');
    expect(r.endpoint).toBe('http://shadow-mode-api.prod');
  });

  it('REFUSES a resolved endpoint with no signed declaration (the wrong-but-valid-looking endpoint)', async () => {
    // roles resolves to http://evil.attacker — no declaration → refused, NOT used
    await expect(new TrustRootedResolver(inner, policy()).resolve('roles')).rejects.toBeInstanceOf(
      TrustViolationError,
    );
  });

  it('REFUSES on env mismatch (a prod endpoint when running staging)', async () => {
    await expect(
      new TrustRootedResolver(inner, policy({ env: 'staging' })).resolve('member-graph'),
    ).rejects.toThrow(/env mismatch/);
  });

  it('REFUSES a declaration signed by a non-allowlisted trust root', async () => {
    await expect(
      new TrustRootedResolver(inner, policy({ trustRoots: ['root:other'] })).resolve('member-graph'),
    ).rejects.toThrow(/trust root not allowlisted/);
  });
});
