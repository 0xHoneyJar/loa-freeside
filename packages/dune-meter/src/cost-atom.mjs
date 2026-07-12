// cost-atom.mjs — the dune-meter CostAtom emitter.
//
// COMPATIBLE with loa-finn src/cost/cost-atom.ts (CostAtom interface l.59,
// CallClass l.28, the 3 ledgers InferenceLedger/InfraLedger/OrchestrationLedger,
// canonical serialization + sha256 checksum, integer units, append-only JSONL).
//
// Two deliberate deltas from the finn original, both honest:
//   1. call_class adds a 'dune' class (finn has only A_relay | B_enrich). A dune
//      atom carries the inference/infra ledgers at zero and books the credit cost
//      on the orchestration ledger's gate_inputs — there is no model token spend,
//      the cost is Dune compute credits.
//   2. A hash-CHAIN. The finn envelope self-checksums each atom; dune-meter adds a
//      `prev_hash` link (the previous envelope's checksum) so the ledger is a
//      tamper-evident chain, not just a bag of self-checksummed lines. The genesis
//      atom links to GENESIS_PREV_HASH. This is the design-doc "hash-chain via
//      prev_hash linkage" requirement.
//
// Units are integers. Dune bills 1 credit = 1000 datapoints (rows × cols). We
// store credits_consumed and datapoints_scanned as plain integers (Number, all
// safe-integer at free-tier magnitudes — credits cap at thousands). No floats in
// any stored cost field.
//
// node:crypto + node:fs only — zero-dependency core, asson house style.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

/** The genesis link: the prev_hash of the first atom in any ledger. */
export const GENESIS_PREV_HASH = 'sha256:' + '0'.repeat(64);

/** Default ledger path (relative to package). The CLI passes an absolute path. */
export const DEFAULT_ATOMS_PATH = '.run/dune-cost-atoms.jsonl';

// ── canonical serialization (mirrors finn canonicalize/canonicalJson) ────────
// Sort object keys recursively so the checksum is order-insensitive. dune-meter
// stores integers, not bigints, so there is no bigint→string coercion step.

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

/** sha256 hex of the canonical JSON of an atom, prefixed `sha256:`. */
export function atomChecksum(atom) {
  return 'sha256:' + createHash('sha256').update(canonicalJson(atom)).digest('hex');
}

// ── atom construction ────────────────────────────────────────────────────────

/**
 * Build a dune CostAtom. Integer units only.
 *
 * @param {object} p
 * @param {string} p.atom_id          ULID-ish unique id (caller supplies; default time+rand)
 * @param {string} p.query_id         the Dune query id (or a hash of the SQL)
 * @param {number} p.datapoints_scanned  rows × cols actually scanned (integer)
 * @param {number} p.credits_consumed    credits the execution cost (integer)
 * @param {'small'|'medium'|'large'} p.engine  the Dune compute engine used
 * @param {number} p.wall_ms          execution wall time in ms (integer)
 * @param {number} [p.ts]             epoch ms (default Date.now())
 */
export function makeDuneAtom({
  atom_id,
  query_id,
  datapoints_scanned,
  credits_consumed,
  engine,
  wall_ms,
  ts = Date.now(),
}) {
  for (const [name, v] of [
    ['datapoints_scanned', datapoints_scanned],
    ['credits_consumed', credits_consumed],
    ['wall_ms', wall_ms],
  ]) {
    if (!Number.isInteger(v) || v < 0) {
      throw new Error(`cost-atom: ${name} must be a non-negative integer (got ${v})`);
    }
  }
  return {
    atom_id: atom_id ?? `${ts.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    correlation_id: query_id,
    ts,
    call_class: 'dune',
    // finn-shaped ledgers, zeroed where dune has no spend. The credit cost lives
    // on the dune-native fields + the orchestration ledger's gate record.
    inference: { model: null, input_tokens: 0, output_tokens: 0, cached_tokens: 0, cost_micro: 0 },
    infra: { wall_ms, allocated_ppm: 0, egress_bytes: 0, rpc_calls: 1, cost_micro: 0 },
    orchestration: {
      steps: 1,
      retries: 0,
      cheval_spawn_ms: null,
      gate_decision: 'DUNE_EXECUTED',
      gate_inputs: { engine, credits_consumed },
      cost_micro: 0,
    },
    // dune-native cost fields (the real bill, in Dune's billing unit):
    dune: {
      query_id,
      datapoints_scanned,
      credits_consumed,
      engine,
    },
    total_micro: 0,
    x402_quote_micro: 0,
  };
}

// ── envelope (finn-shaped: schema_version + atom + checksum) + prev_hash chain ─

/**
 * Wrap an atom in its chain envelope.
 * @param {object} atom
 * @param {string} prevHash  the previous envelope's checksum (GENESIS_PREV_HASH for atom 0)
 */
export function makeEnvelope(atom, prevHash) {
  const enveloped = {
    schema_version: 1,
    prev_hash: prevHash,
    atom: canonicalize(atom),
  };
  // checksum covers schema_version + prev_hash + atom — so reordering or
  // re-linking any line breaks the chain, not just the atom body.
  enveloped.checksum = 'sha256:' + createHash('sha256')
    .update(canonicalJson({ schema_version: enveloped.schema_version, prev_hash: enveloped.prev_hash, atom: enveloped.atom }))
    .digest('hex');
  return enveloped;
}

/** Serialize an envelope to a newline-terminated JSONL line. */
export function envelopeLine(envelope) {
  return JSON.stringify(envelope) + '\n';
}

/**
 * Parse one JSONL line into an envelope, verifying its self-checksum.
 * Chain linkage (prev_hash continuity) is verified separately by readAtoms.
 */
export function parseEnvelopeLine(line) {
  const parsed = JSON.parse(line);
  if (parsed.schema_version !== 1) {
    throw new Error(`unknown cost-atom schema_version: ${parsed.schema_version}`);
  }
  const recomputed = 'sha256:' + createHash('sha256')
    .update(canonicalJson({ schema_version: parsed.schema_version, prev_hash: parsed.prev_hash, atom: parsed.atom }))
    .digest('hex');
  if (recomputed !== parsed.checksum) {
    throw new Error('cost-atom checksum mismatch');
  }
  return parsed;
}

// ── append-only writer with chain continuity ─────────────────────────────────

/** Read the last envelope's checksum from a ledger file (the next prev_hash). */
export function tailHash(path) {
  if (!existsSync(path)) return GENESIS_PREV_HASH;
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return GENESIS_PREV_HASH;
  const last = parseEnvelopeLine(lines[lines.length - 1]);
  return last.checksum;
}

/**
 * Append an atom to the JSONL ledger, linking it to the current tail.
 * Synchronous (the CLI is a oneshot; one writer, no interleave). Returns the
 * written envelope.
 */
export function appendAtom(path, atom) {
  mkdirSync(dirname(path), { recursive: true });
  const prevHash = tailHash(path);
  const envelope = makeEnvelope(atom, prevHash);
  appendFileSync(path, envelopeLine(envelope), { encoding: 'utf8' });
  return envelope;
}

// ── reader: parse + verify checksums AND chain continuity ────────────────────

/**
 * Read a cost-atom ledger. Returns { atoms, envelopes, malformed, chain_ok,
 * chain_break }. Malformed lines (bad JSON / failed self-checksum) are skipped
 * with a reason. chain_ok=false with chain_break={line, expected, got} on the
 * first prev_hash discontinuity.
 */
export function readAtoms(path) {
  if (!existsSync(path)) return { atoms: [], envelopes: [], malformed: [], chain_ok: true, chain_break: null };
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n');
  const atoms = [];
  const envelopes = [];
  const malformed = [];
  let expectedPrev = GENESIS_PREV_HASH;
  let chain_ok = true;
  let chain_break = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let env;
    try {
      env = parseEnvelopeLine(line);
    } catch (err) {
      malformed.push({ line: i + 1, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (chain_ok && env.prev_hash !== expectedPrev) {
      chain_ok = false;
      chain_break = { line: i + 1, expected: expectedPrev, got: env.prev_hash };
    }
    expectedPrev = env.checksum;
    envelopes.push(env);
    atoms.push(env.atom);
  }
  return { atoms, envelopes, malformed, chain_ok, chain_break };
}
