/**
 * A durable file-backed ShadowStore — the concrete adapter behind the runner's port.
 *
 * Append-only JSONL: one validated ShadowSnapshot per line, the series IS the history the dashboard
 * reads (and the operator watches converge before going live). Validated on the way in (never persist a
 * malformed snapshot) AND on the way out (never trust a hand-edited line). This is the integration seam
 * the pure runner (protocol) is written against; a cadence fires runShadow(records, makeFileStore(path)).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ShadowSnapshotSchema, type ShadowSnapshot, type ShadowStore } from '@freeside/shadow-audit-protocol';

export function makeFileStore(path: string): ShadowStore {
  const series = async (community: string): Promise<readonly ShadowSnapshot[]> => {
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => ShadowSnapshotSchema.parse(JSON.parse(l)))
      .filter((s) => s.community === community);
  };
  return {
    async append(snapshot) {
      ShadowSnapshotSchema.parse(snapshot); // refuse a malformed snapshot at the boundary
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, JSON.stringify(snapshot) + '\n');
    },
    series,
    async latest(community) {
      const all = await series(community);
      return all.length > 0 ? all[all.length - 1] : undefined;
    },
  };
}
