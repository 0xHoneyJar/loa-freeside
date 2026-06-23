/** Deterministic Classifier double. (T1.2) */
import type { Classifier } from "../ports/classifier.port.js";
import type { PostureLevel } from "../domain/posture.js";

export class MockClassifier implements Classifier {
  constructor(
    private readonly table: Readonly<Record<string, PostureLevel>> = {},
    private readonly fallback: PostureLevel = "FAIL_CLOSED",
  ) {}

  classify(domain: string): PostureLevel {
    return this.table[domain] ?? this.fallback;
  }
}
