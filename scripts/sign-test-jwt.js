#!/usr/bin/env node
/**
 * sign-test-jwt.js — Sign a test JWT for deployment validation.
 *
 * Usage:
 *   node scripts/sign-test-jwt.js <path-to-es256-private-key.pem>
 *
 * Outputs a signed JWT to stdout. Uses jose for ES256 signing with
 * correct raw r||s format expected by loa-finn JWKS verification.
 */

'use strict';

const { importPKCS8, SignJWT } = require('jose');
const fs = require('fs');
const crypto = require('crypto');

async function main() {
  const keyPath = process.argv[2];
  if (!keyPath) {
    process.stderr.write('Usage: sign-test-jwt.js <private-key.pem>\n');
    process.exit(2);
  }

  const key = fs.readFileSync(keyPath, 'utf8');
  const pk = await importPKCS8(key, 'ES256');

  const jwt = await new SignJWT({
    v: 1,
    tenant_id: 'test-tenant',
    access_level: 'free',
    pool_id: 'cheap',
    allowed_pools: ['cheap'],
    platform: 'test',
    channel_id: 'test-channel',
    pool_mapping_version: '1.0.0',
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'JWT' })
    .setIssuer('arrakis')
    .setAudience('arrakis')
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti(crypto.randomUUID())
    .sign(pk);

  process.stdout.write(jwt);
}

main().catch((err) => {
  process.stderr.write(`JWT signing failed: ${err.message}\n`);
  process.exit(1);
});
