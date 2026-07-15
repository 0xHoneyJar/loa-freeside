import { describe, expect, it, vi } from 'vitest';
import { projectPublicJourney } from '@freeside/shadow-audit-protocol';

import { HttpGateLeakIndexPort, HttpGateLeakPort } from '../gate-leak-ports.js';

const CONTRACT = '0x' + 'b'.repeat(40);

describe('HttpGateLeakPort', () => {
  it('treats typed 428 needs_input as a result and resumes the same run', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const resumed = url.endsWith('/resume');
      const journey = projectPublicJourney({
        run_id: 'gate_run',
        journey_token: 'journey-1',
        subject: { chain_id: '1', contract_address: CONTRACT },
        outcome: resumed ? 'delivered_e1' : 'needs_input',
      });
      return Response.json(
        resumed ? { journey, report: { run_id: 'gate_run' } } : { journey },
        { status: resumed ? 200 : 428 },
      );
    });
    const port = new HttpGateLeakPort('https://shadow.test/', fetchFn);

    const first = await port.submit({ chain: '1', contract: CONTRACT, journey_token: 'journey-1' });
    expect(first.journey.status).toEqual({ state: 'needs_input', required_input: 'access_started_at' });
    const resumed = await port.resume('gate_run', '2026-06-22');
    expect(resumed.journey.status).toEqual({ state: 'delivered_e1' });
    expect(fetchFn.mock.calls[1]?.[0]).toBe('https://shadow.test/v1/access-risk/gate_run/resume');
  });
});

describe('HttpGateLeakIndexPort', () => {
  it('maps unknown to pending and enqueues with an idempotency key', async () => {
    const fetchFn = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === 'POST' ? Response.json({ accepted: true }, { status: 202 }) : new Response(null, { status: 404 }),
    );
    const port = new HttpGateLeakIndexPort(
      { sonarApiUrl: 'https://sonar.test/', serviceToken: 'test-token' },
      fetchFn,
    );
    expect(await port.probe('1', CONTRACT)).toBe('pending');
    expect(await port.enqueue({ orderId: 'journey-1', chainId: '1', contract: CONTRACT })).toBe(true);
    const headers = new Headers(fetchFn.mock.calls[1]?.[1]?.headers);
    expect(headers.get('idempotency-key')).toBe('journey-1:gate-leak:index');
  });

  it('rejects invalid subjects before any network call', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const port = new HttpGateLeakIndexPort(
      { sonarApiUrl: 'https://sonar.test', serviceToken: 'test-token' },
      fetchFn,
    );
    expect(await port.probe('not-a-chain', 'not-an-address')).toBe('blocked');
    expect(await port.enqueue({ orderId: 'journey-1', chainId: 'not-a-chain', contract: 'bad' })).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
