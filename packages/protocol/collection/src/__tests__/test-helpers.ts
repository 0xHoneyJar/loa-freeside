import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit } from "effect";
import { assert } from "vitest";

const fixturesDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures",
);

export const readFixture = (name: string): unknown => {
  const parsed: unknown = JSON.parse(
    readFileSync(join(fixturesDirectory, name), "utf8"),
  );
  return parsed;
};

export const expectEffectSuccess = <Value, Error>(
  effect: Effect.Effect<Value, Error>,
): Value => {
  const exit = Effect.runSyncExit(effect);
  if (Exit.isFailure(exit)) {
    assert.fail(`expected Effect success, received ${String(exit.cause)}`);
  }
  return exit.value;
};

export const expectEffectFailure = <Value, Error>(
  effect: Effect.Effect<Value, Error>,
): void => {
  const exit = Effect.runSyncExit(effect);
  assert.isTrue(Exit.isFailure(exit), "expected Effect failure");
};

export const candidateFixtureNames: ReadonlyArray<string> = Object.freeze([
  "evm-candidate.valid.json",
  "solana-candidate.valid.json",
  "multiple-deployments-unknown-standard.valid.json",
]);
