import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Cause, Effect, Exit, Option, Predicate } from "effect";
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
    assert.fail("expected Effect failure, received success");
  }
  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    assert.fail(`expected a typed failure, received ${String(exit.cause)}`);
  }
  return failure.value;
};

export const expectEffectFailureTag = <Value, Error extends { readonly _tag: string }>(
  effect: Effect.Effect<Value, Error>,
  tag: Error["_tag"] | "ParseError",
): Error => {
  const failure = expectEffectFailure(effect);
  assert.isTrue(
    Predicate.isTagged(failure, tag),
    `expected failure tagged ${tag}, received ${String(failure)}`,
  );
  return failure;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Rebuild a JSON value with reversed object-key insertion order. */
export const permuteKeyOrder = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(permuteKeyOrder);
  if (isRecord(value)) {
    const permuted: Record<string, unknown> = {};
    for (const key of Object.keys(value).toReversed()) {
      permuted[key] = permuteKeyOrder(value[key]);
    }
    return permuted;
  }
  return value;
};
