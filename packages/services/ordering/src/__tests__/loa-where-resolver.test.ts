import { describe, it, expect } from 'vitest';
import { LoaWhereCapabilityResolver, type LoaWhereInvoker } from '../loa-where-resolver.js';
import { CapabilityUnresolvedError } from '../resolver.js';

const MAP = { 'member-graph': 'shadow-mode-api', roles: 'worlds-api' } as const;

describe('LoaWhereCapabilityResolver (S3-T2)', () => {
  it('resolves via loa where and labels source:loa-where', async () => {
    const invoke: LoaWhereInvoker = async (dest) => ({ found: true, endpoint: `http://${dest}.live` });
    const r = await new LoaWhereCapabilityResolver(MAP, invoke).resolve('member-graph');
    expect(r.building).toBe('shadow-mode-api');
    expect(r.endpoint).toBe('http://shadow-mode-api.live');
    expect(r.source).toBe('loa-where');
  });

  it('fails closed when loa where returns found:false (empty discovery plane — SDD §12.0)', async () => {
    const invoke: LoaWhereInvoker = async () => ({ found: false });
    await expect(new LoaWhereCapabilityResolver(MAP, invoke).resolve('roles')).rejects.toBeInstanceOf(
      CapabilityUnresolvedError,
    );
  });

  it('fails closed when found:true but no endpoint (never fabricates)', async () => {
    const invoke: LoaWhereInvoker = async () => ({ found: true });
    await expect(new LoaWhereCapabilityResolver(MAP, invoke).resolve('roles')).rejects.toBeInstanceOf(
      CapabilityUnresolvedError,
    );
  });

  it('fails closed on an unmapped capability', async () => {
    const invoke: LoaWhereInvoker = async () => ({ found: true, endpoint: 'http://x' });
    await expect(new LoaWhereCapabilityResolver(MAP, invoke).resolve('ownership')).rejects.toBeInstanceOf(
      CapabilityUnresolvedError,
    );
  });
});
