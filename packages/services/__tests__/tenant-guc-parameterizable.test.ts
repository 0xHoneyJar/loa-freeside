/**
 * The tenant GUC must be set with a parameterizable statement.
 *
 * PostgreSQL's `SET` is utility syntax, not a query: it does not accept bind
 * parameters. `client.query('SET LOCAL app.community_id = $1', [id])` therefore
 * fails at PARSE, before the statement runs — node-postgres surfaces a syntax
 * error and the surrounding transaction rolls back. The parameterizable
 * equivalent is `SELECT set_config('app.community_id', $1, true)`.
 *
 * This has now shipped twice on the same money path — nowpayments-handler.ts
 * (review thread T57) and budget-finalize-pg.ts (comment C32) — and no test
 * caught either. Every tenant-isolation test in the suite mocks the client, and
 * a mock happily "executes" a string PostgreSQL would reject, so the defect is
 * invisible until it hits a real server. A static check over the source is the
 * only cheap instrument that actually fires here.
 *
 * Origin: PR #428.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const SERVICES_DIR = join(__dirname, '..');

/** Executable sources only — __tests__ fixtures may quote the bad form. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(full);
    }
    return extname(name) === '.ts' ? [full] : [];
  });
}

/**
 * `SET [LOCAL|SESSION] <name> = $n` — the unparameterizable shape.
 *
 * Anchored to a string-literal opener so it matches the SET *utility statement*
 * and not the SET *clause* of an UPDATE, which binds parameters just fine.
 */
const SET_WITH_BIND_PARAM = /(['"`])\s*SET\s+(?:LOCAL\s+|SESSION\s+)?[\w.]+\s*=\s*\$\d/i;

describe('tenant GUC is set with a bindable statement', () => {
  it('no source in packages/services binds a parameter into SET', () => {
    const offenders = sourceFiles(SERVICES_DIR)
      .map((file) => ({ file, text: readFileSync(file, 'utf8') }))
      .flatMap(({ file, text }) =>
        text
          .split('\n')
          .map((line, i) => ({ line, n: i + 1 }))
          // Skip comment lines: the correct call sites explain the trap above them.
          .filter(({ line }) => !/^\s*(?:\/\/|\*|\/\*)/.test(line))
          .filter(({ line }) => SET_WITH_BIND_PARAM.test(line))
          .map(({ n, line }) => `${file.replace(SERVICES_DIR, 'packages/services')}:${n}: ${line.trim()}`),
      );

    expect(
      offenders,
      'PostgreSQL SET does not accept bind parameters — this fails at parse. ' +
        "Use SELECT set_config('<name>', $1, true) instead.\n" +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('the regex matches the bad shape and nothing else', () => {
    // A guard that cannot fire is worse than no guard; one that fires on valid
    // SQL gets deleted by the next person it annoys. Both halves are pinned.
    const src = (s: string) => `await client.query(${s}, [id]);`;

    expect(SET_WITH_BIND_PARAM.test(src(`'SET LOCAL app.community_id = $1'`))).toBe(true);
    expect(SET_WITH_BIND_PARAM.test(src(`"SET app.community_id=$1"`))).toBe(true);
    expect(SET_WITH_BIND_PARAM.test(src('`SET SESSION app.community_id = $1`'))).toBe(true);

    expect(SET_WITH_BIND_PARAM.test(src(`\`SELECT set_config('app.community_id', $1, true)\``))).toBe(false);
    expect(SET_WITH_BIND_PARAM.test(src(`"SET LOCAL app.test_var = 'literal'"`))).toBe(false);
    // The SET *clause* of an UPDATE is parameterizable — must not be flagged.
    expect(SET_WITH_BIND_PARAM.test(src(`'UPDATE fences SET last_fence_token = $1 WHERE id = $2'`))).toBe(false);
  });
});
