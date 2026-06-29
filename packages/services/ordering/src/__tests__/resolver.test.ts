import { describe, it, expect } from 'vitest';
import { ConfigCapabilityResolver, CapabilityUnresolvedError } from '../resolver.js';

describe('ConfigCapabilityResolver', () => {
  const resolver = new ConfigCapabilityResolver({
    'member-graph': { building: 'shadow-mode-api', endpoint: 'http://shadow-mode-api.internal' },
    roles: { building: 'worlds-api', endpoint: 'http://worlds-api.internal' },
  });

  it('resolves a configured capability to its building + endpoint', async () => {
    const r = await resolver.resolve('member-graph');
    expect(r.building).toBe('shadow-mode-api');
    expect(r.endpoint).toBe('http://shadow-mode-api.internal');
  });

  it('labels the resolution source truthfully as "config" (B-2 honesty)', async () => {
    const r = await resolver.resolve('roles');
    expect(r.source).toBe('config');
  });

  it('fails closed on an unmapped capability rather than guessing (G-6)', async () => {
    await expect(resolver.resolve('ownership')).rejects.toBeInstanceOf(CapabilityUnresolvedError);
  });
});
