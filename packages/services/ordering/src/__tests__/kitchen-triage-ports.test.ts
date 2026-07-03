import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  KitchenTriagePorts,
  createKitchenTriagePorts,
  resetShadowProducerlessWarning,
  shadowUnavailablePolicyFromEnv,
} from '../kitchen-triage-ports.js';
import { StubTriagePorts } from '../triage-ports.js';

const CHAIN = '10';
const CONTRACT = '0xED5AF388653567Af2F388e6224DcC93746104133';

describe('shadowUnavailablePolicyFromEnv', () => {
  afterEach(() => {
    delete process.env.SHADOW_PREVIEW_UNAVAILABLE_POLICY;
  });

  it('defaults to blocked when unset', () => {
    expect(shadowUnavailablePolicyFromEnv()).toBe('blocked');
  });

  it('reads optional', () => {
    process.env.SHADOW_PREVIEW_UNAVAILABLE_POLICY = 'optional';
    expect(shadowUnavailablePolicyFromEnv()).toBe('optional');
  });

  it('treats unknown values as blocked (fail-conservative)', () => {
    process.env.SHADOW_PREVIEW_UNAVAILABLE_POLICY = 'complete';
    expect(shadowUnavailablePolicyFromEnv()).toBe('blocked');
  });
});

describe('KitchenTriagePorts shadow policy', () => {
  it('default policy preserves stub behavior (blocked) — feature dark', async () => {
    const ports = new KitchenTriagePorts(null);
    await expect(ports.shadow.probe(CHAIN, CONTRACT)).resolves.toBe('blocked');
  });

  it('policy=optional reports optional (fulfillment proceeds without preview)', async () => {
    const ports = new KitchenTriagePorts(null, undefined, 'optional');
    await expect(ports.shadow.probe(CHAIN, CONTRACT)).resolves.toBe('optional');
  });

  it('policy cannot mask ANY injected fallback — even a stub subclass (producer signal is injection, not type)', async () => {
    class CustomStub extends StubTriagePorts {}
    const ports = new KitchenTriagePorts(null, new CustomStub(), 'optional');
    await expect(ports.shadow.probe(CHAIN, CONTRACT)).resolves.toBe('blocked');
  });

  it('policy cannot mask a REAL shadow producer (custom fallback wins)', async () => {
    const realProducer = {
      sonar: { probe: async () => 'pending' as const },
      score: { probe: async () => 'pending' as const },
      worlds: { probe: async () => 'pending' as const },
      discord: { probe: async () => 'optional' as const },
      shadow: { probe: async () => 'complete' as const },
    };
    const ports = new KitchenTriagePorts(null, realProducer, 'optional');
    await expect(ports.shadow.probe(CHAIN, CONTRACT)).resolves.toBe('complete');
  });

  it('policy does not affect the other ingredient probes', async () => {
    const ports = new KitchenTriagePorts(null, undefined, 'optional');
    await expect(ports.sonar.probe(CHAIN, CONTRACT)).resolves.toBe('pending');
    await expect(ports.score.probe(CHAIN, CONTRACT)).resolves.toBe('pending');
    await expect(ports.worlds.probe(CHAIN, CONTRACT)).resolves.toBe('pending');
    await expect(ports.discord.probe(CHAIN, CONTRACT)).resolves.toBe('optional');
  });
});

describe('createKitchenTriagePorts darkness observability', () => {
  afterEach(() => {
    delete process.env.SHADOW_PREVIEW_UNAVAILABLE_POLICY;
    delete process.env.KITCHEN_PROBE_HTTP_ENABLED;
    vi.restoreAllMocks();
  });

  it('logs the DARK producer-less line when HTTP probes are on but shadow has no producer', async () => {
    resetShadowProducerlessWarning();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.KITCHEN_PROBE_HTTP_ENABLED = 'true';
    process.env.SERVICE_TOKEN = 'tok';
    process.env.SONAR_API_URL = 'https://sonar.test';
    process.env.SCORE_API_URL = 'https://score.test';
    process.env.WORLDS_API_URL = 'https://worlds.test';
    try {
      const ports = createKitchenTriagePorts();
      await expect(ports.shadow.probe(CHAIN, CONTRACT)).resolves.toBe('blocked');
      const logged = warn.mock.calls.flat().join('\n');
      expect(logged).toContain('shadow_preview producer-less');
      expect(logged).toContain('DARK');
    } finally {
      delete process.env.SERVICE_TOKEN;
      delete process.env.SONAR_API_URL;
      delete process.env.SCORE_API_URL;
      delete process.env.WORLDS_API_URL;
    }
  });

  it('logs the producer-less line with policy=optional (DARK not silently hidden) and reports optional', async () => {
    resetShadowProducerlessWarning();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.SHADOW_PREVIEW_UNAVAILABLE_POLICY = 'optional';
    const ports = createKitchenTriagePorts();
    await expect(ports.shadow.probe(CHAIN, CONTRACT)).resolves.toBe('optional');
    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('shadow_preview producer-less');
    expect(logged).toContain('policy=optional');
  });

  it('warns once per process, not per factory call', () => {
    resetShadowProducerlessWarning();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.SHADOW_PREVIEW_UNAVAILABLE_POLICY = 'optional';
    createKitchenTriagePorts();
    createKitchenTriagePorts();
    const producerless = warn.mock.calls.flat().filter((m) => String(m).includes('producer-less'));
    expect(producerless).toHaveLength(1);
  });
});
