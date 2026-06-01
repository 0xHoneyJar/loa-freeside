import { Either } from "effect";
import { Schema as S } from "@effect/schema";
import { publishEnvelope, type PrevHashStore } from "./publisher.js";
import { lookupSchema, type SchemaId, type PayloadOf } from "./registry.js";
import { Mutex, TimeoutError } from "./mutex.js";
import { internalPublish, type NatsTransport } from "./transport.js";
import type { Signer } from "./signer.js";

/**
 * `emit()` — the sanctioned, ergonomic NATS emission path (cycle-112 S1).
 *
 * `makeEmitter({ cell, transport, signer, prevHashStore })` closes over
 * everything that is constant for a cell, so the call site collapses to
 * `emit(SchemaId, payload)` — no per-call signer / store / transport threading,
 * and FEWER tokens than the raw `nats.publish('subject', obj)` it replaces
 * (NFR-Ergo-1, FR-ADOPT-1).
 *
 * Soundness (FR-3, SKP-004): the payload is validated against its
 * registry-resolved schema BEFORE signing and BEFORE the prev-hash chain
 * advances, and the ORIGINAL payload (not a transformed copy) is signed — so the
 * signed bytes are exactly what the caller submitted. A schema mismatch returns
 * a typed `Either.Left` (FR-3a) — never a throw, never a silent drop, and the
 * bad payload never reaches the bus and never forks the chain.
 *
 * Compile-time binding (SKP-005/IMP-001): `SchemaId<P>` carries its payload type
 * as a phantom, so `emit(id, wrongShape)` is a COMPILE error, not just a runtime
 * `Left`.
 */

// --- typed failures (FR-3a; all values the caller must handle, never thrown) --

export class SchemaEmitError extends Error {
  readonly _tag = "SchemaEmitError";
  constructor(
    readonly schemaId: string,
    readonly parseError: unknown,
  ) {
    super(`[events] payload failed schema "${schemaId}" — refused to emit`);
    this.name = "SchemaEmitError";
  }
}

/** A SchemaId typo at a call site — a Left, NOT a throw escaping the Either (SKP-001). */
export class UnknownSchemaIdError extends Error {
  readonly _tag = "UnknownSchemaIdError";
  constructor(readonly schemaId: string) {
    super(`[events] unknown SchemaId "${schemaId}" — not in registry`);
    this.name = "UnknownSchemaIdError";
  }
}

/** A transport-layer failure (NATS reject/outage) — distinct from a validation
 *  failure so the caller can retry transient infra without retrying a bad
 *  payload (Flatline SPRINT review; cycle-112 T4.5). */
export class TransportEmitError extends Error {
  readonly _tag = "TransportEmitError";
  constructor(
    readonly subject: string,
    readonly cause: unknown,
  ) {
    super(`[events] transport failed publishing "${subject}"`);
    this.name = "TransportEmitError";
  }
}

/** `emitRaw` only: the caller-supplied subject does not belong to the SchemaId's
 *  family (SKP-008). */
export class SubjectFamilyError extends Error {
  readonly _tag = "SubjectFamilyError";
  constructor(
    readonly schemaId: string,
    readonly subject: string,
  ) {
    super(`[events] subject "${subject}" is not in the family of SchemaId "${schemaId}"`);
    this.name = "SubjectFamilyError";
  }
}

/** Raised by `makeEmitter` at construction when no usable signer is provided
 *  (T1.10). The cell's composition root catches this and exits 78 / routes to
 *  `audit-keys-bootstrap.md` — never emits unsigned. */
export class MissingSignerError extends Error {
  readonly _tag = "MissingSignerError";
  constructor(readonly cell: string) {
    super(
      `[events] makeEmitter("${cell}") requires a signing key; none provided. ` +
        `Bootstrap a key (see grimoires/loa/runbooks/audit-keys-bootstrap.md) ` +
        `or fail the process (exit 78 / EX_CONFIG) — emitting unsigned is forbidden.`,
    );
    this.name = "MissingSignerError";
  }
}

export type EmitError =
  | SchemaEmitError
  | UnknownSchemaIdError
  | TransportEmitError
  | TimeoutError;

/** Producer-visible acceptance receipt (FR-ADOPT-7): the producer sees its own
 *  event was payload-validated, signed, and chain-linked without subscribing. */
export interface EmitReceipt {
  readonly event_id: string;
  /** sha256 of the signed envelope — the next emit's prev_hash. */
  readonly envelopeHash: string;
  readonly subject: string;
}

export interface EmitterDeps {
  /** Cell slug that emits — populates `emitted_by`. e.g. "freeside-coexistence". */
  readonly cell: string;
  /** Opaque transport token (createNatsTransport). Cells cannot reach `.publish`. */
  readonly transport: NatsTransport;
  /** Ed25519 signer. Absence is a hard error at construction (T1.10). */
  readonly signer: Signer;
  /** Per-cell hash-chain store (reused from publisher.ts). */
  readonly prevHashStore: PrevHashStore;
  /** Override the chain key. Defaults to publisher.ts's `${cell}:${signer.keyId}`. */
  readonly publisherKey?: string;
  /** Max time a single publish may hold the chain lock before it is abandoned
   *  with a TimeoutError (mutex). Default 5000ms. */
  readonly publishTimeoutMs?: number;
  /** Scoped recovery for TRANSPORT failures (cycle-112 T4.5). Off by default
   *  (S1 behaviour preserved). Validation failures NEVER use this — a bad
   *  payload is deterministic, so retrying it is futile; it drops immediately.
   *  This is NOT the transactional outbox (durable state<->event atomicity stays
   *  cycle-2 / C2-0); it is the minimum so a transient NATS blip does not become
   *  a silent drop the moment the lint fail-blocks emit() as the only path. */
  readonly recovery?: RecoveryConfig;
}

export interface DeadLetterInfo {
  readonly subject: string;
  readonly error: TransportEmitError | TimeoutError;
  readonly attempts: number;
}

export interface RecoveryConfig {
  /** Retries for a TRANSPORT failure (TransportEmitError / TimeoutError).
   *  Default 0 (no retry). Validation failures are never retried. */
  readonly maxRetries?: number;
  /** Base backoff between retries (exponential: base * 2^attempt). Default 100ms. */
  readonly backoffMs?: number;
  /** Called once when retries are exhausted — the event could not be delivered.
   *  The caller persists this (a dead-letter row / log) for later reconciliation
   *  (cycle-2). Observable, never silent. */
  readonly deadLetter?: (info: DeadLetterInfo) => void;
  /** Called alongside deadLetter — fire an alert (named owner / threshold). */
  readonly onAlert?: (info: DeadLetterInfo) => void;
  /** Test seam: override the inter-retry delay (so tests do not wait real ms). */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** `nft.mint.detected.v1` -> `nft.mint.detected` (family stem, sans version). */
function familyStem(id: string): string {
  return id.replace(/\.v\d+$/, "");
}

const VERSION_SUFFIX = /\.v\d+$/;

export interface Emitter {
  emit<K extends SchemaId<any>>(
    id: K,
    payload: PayloadOf<K>,
    specifier?: string,
  ): Promise<Either.Either<EmitReceipt, EmitError>>;
  emitRaw<K extends SchemaId<any>>(
    id: K,
    subject: string,
    payload: PayloadOf<K>,
  ): Promise<Either.Either<EmitReceipt, EmitError | SubjectFamilyError>>;
}

export function makeEmitter(deps: EmitterDeps): Emitter {
  // T1.10: no usable signer -> fail loud at construction, never emit unsigned.
  if (
    deps.signer === undefined ||
    deps.signer === null ||
    typeof deps.signer.sign !== "function" ||
    !deps.signer.keyId
  ) {
    throw new MissingSignerError(deps.cell);
  }

  // SKP-001 (race): one mutex per emitter serializes THIS cell's chain advances.
  const chainLock = new Mutex();

  const maxRetries = deps.recovery?.maxRetries ?? 0;
  const backoffMs = deps.recovery?.backoffMs ?? 100;
  const sleep = deps.recovery?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const attemptOnce = async (
    subject: string,
    payload: unknown,
  ): Promise<Either.Either<EmitReceipt, TransportEmitError | TimeoutError>> => {
    try {
      const result = await chainLock.withLock(
        () =>
          publishEnvelope({
            nats: internalPublish(deps.transport), // package-private capability
            subject,
            payload, // SKP-004: the ORIGINAL submitted payload, not a transformed copy
            emittedBy: deps.cell,
            signer: deps.signer,
            prevHashStore: deps.prevHashStore,
            publisherKey: deps.publisherKey,
          }),
        { timeoutMs: deps.publishTimeoutMs },
      );
      return Either.right({
        event_id: result.envelope.event_id,
        envelopeHash: result.envelopeHash,
        subject: result.subject,
      });
    } catch (cause) {
      if (cause instanceof TimeoutError) return Either.left(cause);
      return Either.left(new TransportEmitError(subject, cause));
    }
  };

  // T4.5: bounded transient-retry for TRANSPORT failures, then dead-letter +
  // alert (observable, never silent). Validation never reaches here.
  const doPublish = async (
    subject: string,
    payload: unknown,
  ): Promise<Either.Either<EmitReceipt, TransportEmitError | TimeoutError>> => {
    let last: TransportEmitError | TimeoutError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const r = await attemptOnce(subject, payload);
      if (Either.isRight(r)) return r;
      last = r.left;
      if (attempt < maxRetries) await sleep(backoffMs * 2 ** attempt);
    }
    const info: DeadLetterInfo = { subject, error: last!, attempts: maxRetries + 1 };
    deps.recovery?.deadLetter?.(info);
    deps.recovery?.onAlert?.(info);
    return Either.left(last!);
  };

  return {
    async emit(id, payload, specifier) {
      const entry = lookupSchema(id);
      if (entry === undefined) return Either.left(new UnknownSchemaIdError(id as string));

      // FR-3: validate-only (no transform) BEFORE sign + chain-advance.
      const valid = S.validateEither(entry.schema)(payload);
      if (Either.isLeft(valid)) {
        return Either.left(new SchemaEmitError(id as string, valid.left));
      }

      return doPublish(entry.buildSubject(specifier), payload);
    },

    async emitRaw(id, subject, payload) {
      const entry = lookupSchema(id);
      if (entry === undefined) return Either.left(new UnknownSchemaIdError(id as string));

      // SKP-008: the caller-supplied subject MUST belong to the SchemaId's family
      // and obey the topic grammar (`...family....vN`). Soundness is otherwise
      // identical to emit(): the payload is still schema-validated.
      const stem = familyStem(id as string);
      const inFamily =
        (subject === id || subject.startsWith(`${stem}.`)) && VERSION_SUFFIX.test(subject);
      if (!inFamily) return Either.left(new SubjectFamilyError(id as string, subject));

      const valid = S.validateEither(entry.schema)(payload);
      if (Either.isLeft(valid)) {
        return Either.left(new SchemaEmitError(id as string, valid.left));
      }

      return doPublish(subject, payload);
    },
  };
}
