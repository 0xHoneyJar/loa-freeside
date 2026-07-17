import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Option } from "effect";
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
): Error => {
  const exit = Effect.runSyncExit(effect);
  if (!Exit.isFailure(exit)) {
    assert.fail("expected Effect failure");
  }
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    assert.fail(`expected typed Effect failure, received ${String(exit.cause)}`);
  }
  return failure.value;
};

export const candidateFixtureNames: ReadonlyArray<string> = Object.freeze([
  "evm-candidate.valid.json",
  "solana-candidate.valid.json",
  "multiple-deployments-unknown-standard.valid.json",
]);
