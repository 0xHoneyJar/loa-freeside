/**
 * Vitest Setup File — Unit Tests
 *
 * Runs BEFORE all unit tests. Provides:
 * 1. Global ioredis mock (prevents ECONNREFUSED hangs)
 * 2. Environment variables for config.ts Zod validation
 *
 * @see vitest.workspace.ts — unit project setupFiles
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// 1. Global ioredis Mock
// ---------------------------------------------------------------------------
// Many modules import ioredis at the top level. Without a running Redis server,
// ioredis retries connections indefinitely, causing test hangs. This mock
// provides a safe no-op Redis class for all unit tests.

vi.mock('ioredis', () => {
  const RedisMock = class Redis {
    status = 'ready';

    // Connection
    connect() { return Promise.resolve(); }
    disconnect() { return Promise.resolve(); }
    quit() { return Promise.resolve('OK'); }

    // String commands
    get() { return Promise.resolve(null); }
    set() { return Promise.resolve('OK'); }
    del() { return Promise.resolve(1); }
    mget() { return Promise.resolve([]); }
    mset() { return Promise.resolve('OK'); }
    incr() { return Promise.resolve(1); }
    incrby() { return Promise.resolve(1); }
    decr() { return Promise.resolve(0); }
    decrby() { return Promise.resolve(0); }

    // Key commands
    exists() { return Promise.resolve(0); }
    expire() { return Promise.resolve(1); }
    ttl() { return Promise.resolve(-2); }
    pttl() { return Promise.resolve(-2); }
    keys() { return Promise.resolve([]); }
    scan() { return Promise.resolve(['0', []]); }
    type() { return Promise.resolve('none'); }
    rename() { return Promise.resolve('OK'); }
    unlink() { return Promise.resolve(1); }

    // Hash commands
    hget() { return Promise.resolve(null); }
    hset() { return Promise.resolve(1); }
    hdel() { return Promise.resolve(1); }
    hgetall() { return Promise.resolve({}); }
    hmset() { return Promise.resolve('OK'); }
    hmget() { return Promise.resolve([]); }
    hincrby() { return Promise.resolve(1); }
    hexists() { return Promise.resolve(0); }
    hkeys() { return Promise.resolve([]); }
    hvals() { return Promise.resolve([]); }
    hlen() { return Promise.resolve(0); }

    // List commands
    lpush() { return Promise.resolve(1); }
    rpush() { return Promise.resolve(1); }
    lpop() { return Promise.resolve(null); }
    rpop() { return Promise.resolve(null); }
    lrange() { return Promise.resolve([]); }
    llen() { return Promise.resolve(0); }

    // Set commands
    sadd() { return Promise.resolve(1); }
    srem() { return Promise.resolve(1); }
    smembers() { return Promise.resolve([]); }
    sismember() { return Promise.resolve(0); }
    scard() { return Promise.resolve(0); }

    // Sorted set commands
    zadd() { return Promise.resolve(1); }
    zrem() { return Promise.resolve(1); }
    zrange() { return Promise.resolve([]); }
    zrangebyscore() { return Promise.resolve([]); }
    zscore() { return Promise.resolve(null); }
    zcard() { return Promise.resolve(0); }
    zcount() { return Promise.resolve(0); }

    // Pub/sub
    publish() { return Promise.resolve(0); }
    subscribe() { return Promise.resolve(); }
    unsubscribe() { return Promise.resolve(); }
    on() { return this; }
    once() { return this; }
    off() { return this; }
    removeListener() { return this; }
    removeAllListeners() { return this; }
    emit() { return false; }
    addListener() { return this; }
    listeners() { return []; }

    // Transaction/pipeline
    pipeline() {
      const cmds: unknown[] = [];
      const pipe: Record<string, unknown> = {
        exec: () => Promise.resolve(cmds.map(() => [null, 'OK'])),
      };
      // Make every method on pipeline chainable
      const handler: ProxyHandler<Record<string, unknown>> = {
        get: (target, prop) => {
          if (prop === 'exec') return target.exec;
          return (..._args: unknown[]) => {
            cmds.push([prop, _args]);
            return new Proxy(target, handler);
          };
        },
      };
      return new Proxy(pipe, handler);
    }

    multi() {
      return this.pipeline();
    }

    // Script/eval
    eval() { return Promise.resolve(null); }
    evalsha() { return Promise.resolve(null); }
    defineCommand() { return undefined; }

    // Misc
    ping() { return Promise.resolve('PONG'); }
    info() { return Promise.resolve(''); }
    config() { return Promise.resolve('OK'); }
    select() { return Promise.resolve('OK'); }
    flushdb() { return Promise.resolve('OK'); }
    flushall() { return Promise.resolve('OK'); }
    dbsize() { return Promise.resolve(0); }
    time() { return Promise.resolve(['0', '0']); }
    setnx() { return Promise.resolve(1); }
    setex() { return Promise.resolve('OK'); }
    psetex() { return Promise.resolve('OK'); }
    getset() { return Promise.resolve(null); }
    append() { return Promise.resolve(0); }
    getdel() { return Promise.resolve(null); }
    xadd() { return Promise.resolve('0-0'); }
    xlen() { return Promise.resolve(0); }
    xrange() { return Promise.resolve([]); }
    xread() { return Promise.resolve(null); }
    xgroup() { return Promise.resolve('OK'); }
    xreadgroup() { return Promise.resolve(null); }
    xack() { return Promise.resolve(0); }

    // Duplicate for subscriber connections
    duplicate() { return new Redis(); }
  };

  return {
    default: RedisMock,
    Redis: RedisMock,
  };
});


// ---------------------------------------------------------------------------
// 2. Environment Variables for config.ts Zod Validation
// ---------------------------------------------------------------------------
// Config.ts validates ALL env vars at import time via Zod. Without these
// values, any test that transitively imports config.ts will fatal.

// Required fields (no defaults in Zod schema)
process.env.BERACHAIN_RPC_URLS = 'https://rpc.test.example.com';
process.env.BGT_ADDRESS = '0x0000000000000000000000000000000000000001';
process.env.TRIGGER_PROJECT_ID = 'test-project-id';
process.env.TRIGGER_SECRET_KEY = 'test-secret-key';
process.env.DISCORD_BOT_TOKEN = 'test-bot-token';
process.env.DISCORD_GUILD_ID = 'test-guild-id';
process.env.DISCORD_CHANNEL_THE_DOOR = 'test-channel-the-door';
process.env.DISCORD_CHANNEL_CENSUS = 'test-channel-census';
process.env.DISCORD_ROLE_NAIB = 'test-role-naib';
process.env.DISCORD_ROLE_FEDAYKIN = 'test-role-fedaykin';

// Optional but commonly used defaults
process.env.ADMIN_API_KEYS = 'test-key:test-admin';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Suppress log noise in tests

// Security env vars (ApiKeyManager rejects the default 'CHANGE_ME_IN_PRODUCTION')
process.env.API_KEY_PEPPER = 'test-pepper-value-for-unit-tests-32chars!';
process.env.RATE_LIMIT_SALT = 'test-rate-limit-salt-value';

// Note: DUO_* env vars intentionally NOT set here.
// DuoMfaVerifier tests manage their own env vars and test isDuoConfigured()
// against the parsed config object, which is immutable after module load.
