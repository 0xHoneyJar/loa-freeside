/**
 * effect-pattern.ts — the house dialect for L3+ CLIs (reference, not wired into the demo).
 *
 * Why Effect here: the requirements channel (the third type parameter) makes the
 * determinism claim MACHINE-CHECKABLE. A CLI whose program type is
 * Effect<Output, Error, never> provably depends on no ambient capability —
 * `determinism.declared_by: "effect_type"` in the veve. One that requires
 * HttpClient or Clock is visibly an oracle and MUST declare class: "attestable"
 * with its ambient list. The veve generator reads the type; the finn sandbox
 * enforces the claim at runtime. Types claim, the jail verifies.
 */
import { Command } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"

// ── the pure core: Effect<Stats, InputError, never> — requirements `never` = re_executable ──
interface Stats { readonly words: number; readonly unique: number }
class InputError { readonly _tag = "InputError"; constructor(readonly message: string) {} }

const count = (text: string): Effect.Effect<Stats, InputError, never> =>
  typeof text !== "string"
    ? Effect.fail(new InputError("missing field 'text'"))
    : Effect.succeed((() => {
        const ws = text.trim() === "" ? [] : text.trim().split(/\s+/)
        return { words: ws.length, unique: new Set(ws.map(w => w.toLowerCase())).size }
      })())

// ── the shell: argv parsing + stdout. @effect/cli generates --help (the live ABI) for free ──
const wordcount = Command.make("wordcount", {}, () =>
  Effect.gen(function* () {
    const raw = yield* readStdin                       // platform requirement, satisfied at the edge
    const input = yield* Effect.try({ try: () => JSON.parse(raw), catch: () => new InputError("stdin must be JSON") })
    const stats = yield* count(input.text)             // ← the pure, replayable interior
    yield* Console.log(JSON.stringify(stats))
  })
)

const readStdin = Effect.async<string>((resume) => {
  let raw = ""
  process.stdin.on("data", c => (raw += c))
  process.stdin.on("end", () => resume(Effect.succeed(raw)))
})

// Pattern: ALL ambient requirements (NodeContext) are provided in one place, at the very
// edge. Everything inward of this line is the deterministic skeleton. If a future edit
// makes the interior require Clock or HttpClient, the type signature changes, the veve
// generator flags it, and graduation re-review triggers. Drift is a compile error.
Command.run(wordcount, { name: "wordcount", version: "1.0.0" })(process.argv)
  .pipe(Effect.provide(NodeContext.layer), NodeRuntime.runMain)

/* exit-code discipline: @effect/cli maps unhandled failures to exit 1; map InputError to
   exit 2 explicitly (caller error ≠ tool failure) — exit codes are the smallest gate. */
