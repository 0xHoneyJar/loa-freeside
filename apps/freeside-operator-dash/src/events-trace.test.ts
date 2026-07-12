/**
 * events-trace — Path-ε mTLS client cert tests.
 *
 * Exercises the `runStartup` connect-options assembly path that reads
 * `NATS_TLS_CA`, `NATS_TLS_CLIENT_CERT`, `NATS_TLS_CLIENT_KEY` env vars
 * (all PEM bodies, not paths). Mocks `nats.connect` to capture the
 * options object and assert the four invariants the Path-ε runbook
 * §Step 3c demands:
 *
 *   1. Partial config (cert without key) is refused.
 *   2. Partial config (key without cert) is refused.
 *   3. Both set + CA → tls options include ca + cert + key.
 *   4. Backward-compat: no client-cert env vars → tls options
 *      include ca only (no cert/key keys).
 *
 * Sibling shape: sonar-api PR #25 `test/events-publisher.test.ts`
 * (Path-ε mTLS describe block) — same env-var contract, same mock
 * strategy, adapted for the subscriber lifecycle instead of publisher.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Dummy PEM bodies — opaque to the dash (passed straight through to
// nats.connect's tls options). Real PEM validation happens at TLS
// handshake time, which we never reach: the mock resolves connect()
// before any handshake occurs.
const FAKE_CA = "-----BEGIN CERTIFICATE-----\nMIIBdummyca\n-----END CERTIFICATE-----\n";
const FAKE_CLIENT_CERT = "-----BEGIN CERTIFICATE-----\nMIIBdummyclientcert\n-----END CERTIFICATE-----\n";
const FAKE_CLIENT_KEY = "-----BEGIN PRIVATE KEY-----\nMIIBdummyclientkey\n-----END PRIVATE KEY-----\n";

interface CapturedConnectOpts {
  servers: string;
  tls?: { ca?: string; cert?: string; key?: string };
}

function buildFakeNats() {
  // Declare the param type explicitly so `connectSpy.mock.calls[i][0]` has
  // a useful TS type (otherwise vi.fn() with an arrow that ignores args
  // infers `[]` for the call tuple — see the original tsc error).
  const connectSpy = vi.fn(async (_opts: CapturedConnectOpts) => ({
    // Minimal NatsConnection surface used by runStartup.
    closed: vi.fn(() => new Promise(() => {})), // never resolves
    close: vi.fn(),
    drain: vi.fn(),
  }));
  return { connectSpy };
}

describe("events-trace — Path-ε mTLS connect options", () => {
  const ORIG_ENV = { ...process.env };

  beforeEach(() => {
    // Baseline: NATS_URL present so lifecycle hits the connect path.
    // The dash's verifier path falls back to StaticPubkeyVerifier when
    // EVENTS_JWKS_URL is absent — fine for these tests since we never
    // verify a real envelope.
    process.env.NATS_URL = "tls://broker.example:4222";
    delete process.env.NATS_TLS_CA;
    delete process.env.NATS_TLS_CLIENT_CERT;
    delete process.env.NATS_TLS_CLIENT_KEY;
    delete process.env.EVENTS_JWKS_URL;
    delete process.env.EVENTS_TRACE_SUBJECTS;
  });

  afterEach(() => {
    process.env = { ...ORIG_ENV };
    vi.resetModules();
    vi.doUnmock("nats");
  });

  it("refuses partial config: NATS_TLS_CLIENT_CERT set without NATS_TLS_CLIENT_KEY", async () => {
    process.env.NATS_TLS_CA = FAKE_CA;
    process.env.NATS_TLS_CLIENT_CERT = FAKE_CLIENT_CERT;
    // NATS_TLS_CLIENT_KEY intentionally unset

    const { connectSpy } = buildFakeNats();
    vi.resetModules();
    vi.doMock("nats", () => ({ connect: connectSpy }));

    const mod = await import("./events-trace.js");
    await mod.startEventsTraceSubscriber();

    // The runStartup catch block converts the thrown Error into
    // `lifecycle.lastError` and returns without calling connect.
    const snap = mod.getEventsTraceSnapshot();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(snap.natsConnected).toBe(false);
    expect(snap.lastLifecycleError).toMatch(
      /NATS_TLS_CLIENT_CERT and NATS_TLS_CLIENT_KEY must both be set or both unset/,
    );
  });

  it("refuses partial config: NATS_TLS_CLIENT_KEY set without NATS_TLS_CLIENT_CERT", async () => {
    process.env.NATS_TLS_CA = FAKE_CA;
    process.env.NATS_TLS_CLIENT_KEY = FAKE_CLIENT_KEY;
    // NATS_TLS_CLIENT_CERT intentionally unset

    const { connectSpy } = buildFakeNats();
    vi.resetModules();
    vi.doMock("nats", () => ({ connect: connectSpy }));

    const mod = await import("./events-trace.js");
    await mod.startEventsTraceSubscriber();

    const snap = mod.getEventsTraceSnapshot();
    expect(connectSpy).not.toHaveBeenCalled();
    expect(snap.natsConnected).toBe(false);
    expect(snap.lastLifecycleError).toMatch(
      /NATS_TLS_CLIENT_CERT and NATS_TLS_CLIENT_KEY must both be set or both unset/,
    );
  });

  it("both client-cert env vars set + CA → tls options include ca + cert + key", async () => {
    process.env.NATS_TLS_CA = FAKE_CA;
    process.env.NATS_TLS_CLIENT_CERT = FAKE_CLIENT_CERT;
    process.env.NATS_TLS_CLIENT_KEY = FAKE_CLIENT_KEY;

    const { connectSpy } = buildFakeNats();
    vi.resetModules();
    vi.doMock("nats", () => ({ connect: connectSpy }));

    const mod = await import("./events-trace.js");
    await mod.startEventsTraceSubscriber();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const opts = connectSpy.mock.calls[0]![0];
    expect(opts.tls).toBeDefined();
    // .trim() is applied to env reads — assertion matches the documented
    // behavior (the dash defensively strips CRLF / trailing newlines that
    // Railway service-variables occasionally introduce on copy-paste).
    expect(opts.tls!.ca).toBe(FAKE_CA.trim());
    expect(opts.tls!.cert).toBe(FAKE_CLIENT_CERT.trim());
    expect(opts.tls!.key).toBe(FAKE_CLIENT_KEY.trim());
  });

  it("backward-compat: CA only, no client-cert env vars → tls options include ca, omit cert/key", async () => {
    process.env.NATS_TLS_CA = FAKE_CA;
    // NATS_TLS_CLIENT_CERT + NATS_TLS_CLIENT_KEY intentionally unset

    const { connectSpy } = buildFakeNats();
    vi.resetModules();
    vi.doMock("nats", () => ({ connect: connectSpy }));

    const mod = await import("./events-trace.js");
    await mod.startEventsTraceSubscriber();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const opts = connectSpy.mock.calls[0]![0];
    expect(opts.tls).toBeDefined();
    expect(opts.tls!.ca).toBe(FAKE_CA.trim());
    expect(opts.tls!.cert).toBeUndefined();
    expect(opts.tls!.key).toBeUndefined();
  });

  it("no TLS env vars → no tls options (anonymous, scheme-based TLS)", async () => {
    // Neither NATS_TLS_CA nor client-cert vars set — the connectOpts
    // tls field must be entirely absent (per the existing behavior of
    // letting nats.js infer TLS posture from the URL scheme alone).

    const { connectSpy } = buildFakeNats();
    vi.resetModules();
    vi.doMock("nats", () => ({ connect: connectSpy }));

    const mod = await import("./events-trace.js");
    await mod.startEventsTraceSubscriber();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    const opts = connectSpy.mock.calls[0]![0];
    expect(opts.tls).toBeUndefined();
  });
});
