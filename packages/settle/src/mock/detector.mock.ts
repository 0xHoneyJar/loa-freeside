/** Detector double — returns a fixed tile. (T2.3) */
import type { Detector, MismatchTile } from "../ports/detector.port.js";
import type { TrailEntry } from "../ports/trail.port.js";

export class MockDetector implements Detector {
  constructor(private readonly result: MismatchTile) {}

  scan(_entries: readonly TrailEntry[], _fromCursor: number): MismatchTile {
    return this.result;
  }
}
