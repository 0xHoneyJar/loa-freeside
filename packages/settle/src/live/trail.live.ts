/**
 * AppendOnlyFileTrail — OS-attested append-only decision trail. (T1.5, SKP-004)
 *
 * Each entry is one `O_APPEND | O_WRONLY | O_CREAT` write (Node `'a'` mode) of a
 * single JCS-canonical line. A single `write()` of a record below PIPE_BUF
 * (~4096 B) to an O_APPEND fd is atomic across processes on local POSIX
 * filesystems — the OS attests append-only; the hash-chain (Phase 2) attests
 * order. Rows at/over the limit are rejected rather than risk a torn write.
 *
 * For contended / cross-FS / large-record deployments, swap a `SqliteWalTrail`
 * behind the `TrailWriter` port (THREAT-MODEL.md §6); the gate never changes.
 */

import { openSync, writeSync, closeSync, readFileSync, existsSync } from "node:fs";
import type { TrailWriter, TrailEntry } from "../ports/trail.port.js";
import { jcsCanonicalize } from "../lib/jcs.js";

/** PIPE_BUF floor — a single write STRICTLY BELOW this to an O_APPEND fd is
 *  atomic on local POSIX fs. Rows are rejected at/above it (the guard uses `>=`). */
export const MAX_ROW_BYTES = 4096;

export class AppendOnlyFileTrail implements TrailWriter {
  constructor(private readonly path: string) {}

  append(entry: TrailEntry): void {
    const bytes = Buffer.from(jcsCanonicalize(entry) + "\n", "utf8");
    if (bytes.byteLength >= MAX_ROW_BYTES) {
      throw new RangeError(
        `AppendOnlyFileTrail: row ${bytes.byteLength}B exceeds atomic-append limit ${MAX_ROW_BYTES}B (SKP-004). ` +
          `Shorten the entry or swap to a SqliteWalTrail.`,
      );
    }
    const fd = openSync(this.path, "a"); // O_APPEND | O_WRONLY | O_CREAT
    try {
      writeSync(fd, bytes);
    } finally {
      closeSync(fd);
    }
  }

  readAll(): TrailEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as TrailEntry);
  }
}
