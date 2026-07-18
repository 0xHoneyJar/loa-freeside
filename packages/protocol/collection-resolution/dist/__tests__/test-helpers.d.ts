import { Effect } from "effect";
export declare const readFixture: (name: string) => unknown;
export declare const expectEffectSuccess: <Value, Error>(effect: Effect.Effect<Value, Error>) => Value;
export declare const expectEffectFailure: <Value, Error>(effect: Effect.Effect<Value, Error>) => void;
export declare const validFixtureNames: ReadonlyArray<string>;
//# sourceMappingURL=test-helpers.d.ts.map