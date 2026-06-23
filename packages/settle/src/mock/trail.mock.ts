/** In-memory TrailWriter double. (T1.2) */
import type { TrailWriter, TrailEntry } from "../ports/trail.port.js";

export class MockTrail implements TrailWriter {
  private readonly entries: TrailEntry[] = [];

  append(entry: TrailEntry): void {
    this.entries.push(entry);
  }

  readAll(): TrailEntry[] {
    return [...this.entries];
  }
}
