import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Exit } from "effect";
import { assert } from "vitest";
const fixturesDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
export const readFixture = (name) => {
    const parsed = JSON.parse(readFileSync(join(fixturesDirectory, name), "utf8"));
    return parsed;
};
export const expectEffectSuccess = (effect) => {
    const exit = Effect.runSyncExit(effect);
    if (Exit.isFailure(exit)) {
        assert.fail(`expected Effect success, received ${String(exit.cause)}`);
    }
    return exit.value;
};
export const expectEffectFailure = (effect) => {
    const exit = Effect.runSyncExit(effect);
    assert.isTrue(Exit.isFailure(exit), "expected Effect failure");
};
export const validFixtureNames = Object.freeze([
    "create-command.valid.json",
    "confirm-command.valid.json",
    "confirm-equivalence-subset.valid.json",
    "refresh-command.valid.json",
    "candidate-snapshot.valid.json",
    "equivalence-candidate-snapshot.valid.json",
    "confirmed-resolution.valid.json",
    "order-binding.valid.json",
    "authorization-scope.valid.json",
]);
