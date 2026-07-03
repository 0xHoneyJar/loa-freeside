import { describe, expect, it } from 'vitest';
import {
  hostFp,
  hostFpFromUrl,
  parseConnectionParts,
  clusterFpSalt,
} from '../host-fp.js';

const SALT = 'test-cluster-salt';

describe('host_fp — salted data-store correlation fingerprint (S1-T2, SDD C-2)', () => {
  it('is deterministic: same host → same fp', () => {
    const url = 'postgres://u:p@db.internal:5432/shadow';
    expect(hostFpFromUrl(url, SALT)).toBe(hostFpFromUrl(url, SALT));
    expect(hostFpFromUrl(url, SALT)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('EXCLUDES credentials: changed user/password → SAME fp (NFR-1)', () => {
    const a = hostFpFromUrl('postgres://alice:secret1@db.internal:5432/shadow', SALT)!;
    const b = hostFpFromUrl('postgres://bob:secret2@db.internal:5432/shadow', SALT)!;
    expect(a).toBe(b); // creds are not in the preimage
  });

  it('a changed host or db → DIFFERENT fp (correlation works)', () => {
    const base = hostFpFromUrl('postgres://u:p@db-a.internal:5432/shadow', SALT)!;
    expect(hostFpFromUrl('postgres://u:p@db-b.internal:5432/shadow', SALT)).not.toBe(base); // host
    expect(hostFpFromUrl('postgres://u:p@db-a.internal:5432/audit', SALT)).not.toBe(base); // db
  });

  it('elides the default port + normalizes dialect: postgres == postgresql, :5432 == (none)', () => {
    const a = hostFpFromUrl('postgres://u:p@db.internal:5432/shadow', SALT)!;
    const b = hostFpFromUrl('postgresql://u:p@db.internal/shadow', SALT)!;
    expect(a).toBe(b);
  });

  it('a different (non-default) port → different fp', () => {
    const a = hostFpFromUrl('postgres://u:p@db.internal:5432/shadow', SALT)!;
    const b = hostFpFromUrl('postgres://u:p@db.internal:6543/shadow', SALT)!;
    expect(a).not.toBe(b);
  });

  it('the salt matters: same URL, different salt → different fp', () => {
    const url = 'postgres://u:p@db.internal/shadow';
    expect(hostFpFromUrl(url, 'salt-a')).not.toBe(hostFpFromUrl(url, 'salt-b'));
  });

  it('an empty / unparseable URL → null (no fabricated fingerprint)', () => {
    expect(hostFpFromUrl('', SALT)).toBeNull();
    expect(hostFpFromUrl('not-a-url', SALT)).toBeNull();
    expect(parseConnectionParts('')).toBeNull();
  });

  it('clusterFpSalt: returns the env salt; FAILS CLOSED in a deployed context without it', () => {
    expect(clusterFpSalt({ CLUSTER_FP_SALT: 'abc' } as NodeJS.ProcessEnv)).toBe('abc');
    expect(() => clusterFpSalt({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/CLUSTER_FP_SALT/);
    expect(() => clusterFpSalt({ RAILWAY_ENVIRONMENT: 'production' } as NodeJS.ProcessEnv)).toThrow();
    // local/dev falls back (fps not comparable to prod, by design)
    expect(clusterFpSalt({} as NodeJS.ProcessEnv)).toBe('dev-unsalted-fp');
  });

  it('hostFp is stable for a fixed preimage (regression pin)', () => {
    const parts = { engine: 'postgres', host: 'db.internal', port: '', db: 'shadow' };
    expect(hostFp(parts, SALT)).toBe(hostFp(parts, SALT));
  });
});
