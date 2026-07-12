// dune-client.mjs — a thin Dune Analytics API client.
//
// Covers: submit a SQL/query execution on a chosen compute engine (small by
// default), poll to completion, read the result metadata (datapoints scanned +
// credits consumed), and run the cheap COUNT(*)/LIMIT-1 probe `estimate` uses.
//
// EXP-002 lessons baked in (the scar this whole package is the guard for):
//   • jittered exponential backoff on 429 (rate limit) and 5xx (transient) —
//     a runaway retry loop is its own budget hazard.
//   • explicit per-request timeout (AbortController) — no unbounded waits.
//   • the engine 30-minute execution cap is a DOCUMENTED HARD LIMIT; queries are
//     expected to be era-bound (a block/time range), NEVER an unbounded scan.
//     The unbounded `evt_transfer` scan is what burned EXP-002 — closed here by
//     forcing the small engine, a per-query cost cap, and bounded polling.
//   • the per-query Query Cost Cap must be set at the ACCOUNT level in the Dune
//     dashboard — the API performance tier picks the engine, but the hard credit
//     abort is the account cap. We surface a CAP_ABORTED signal when Dune reports
//     an execution failed/cancelled by the cost cap.
//
// stdlib fetch (node 18+). API key from env DUNE_API_KEY. Zero dependencies.

const DUNE_API_BASE = 'https://api.dune.com/api/v1';

/** Engine → Dune `performance` tier. small is the prototyping default. */
export const ENGINES = { small: 'small', medium: 'medium', large: 'large' };

/** Hard documented cap: a single execution may not run past 30 minutes. */
export const ENGINE_EXEC_CAP_MS = 30 * 60 * 1000;

/** Thrown when Dune reports an execution aborted by the cost cap. */
export class CostCapAbortError extends Error {
  constructor(message, execution_id) {
    super(message);
    this.name = 'CostCapAbortError';
    this.execution_id = execution_id;
  }
}

/** Thrown for caller errors (bad args, missing key) — maps to exit 2. */
export class DuneClientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DuneClientError';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Jittered exponential backoff: base·2^attempt + up to base jitter, capped. */
function backoffMs(attempt, base = 500, cap = 15_000) {
  const exp = Math.min(cap, base * 2 ** attempt);
  return exp + Math.floor(Math.random() * base);
}

/**
 * The Dune client. Inject `fetchImpl` (defaults to global fetch) and `sleepImpl`
 * so tests can run fully offline + deterministic — NO live Dune call ever runs
 * in tests or build (the whole point is cost-safety: don't spend credits to
 * build the cost guard).
 */
export class DuneClient {
  constructor({
    apiKey = process.env.DUNE_API_KEY,
    base = DUNE_API_BASE,
    fetchImpl,
    sleepImpl = sleep,
    maxRetries = 4,
    requestTimeoutMs = 30_000,
    pollIntervalMs = 2_000,
    pollTimeoutMs = ENGINE_EXEC_CAP_MS,
  } = {}) {
    this.apiKey = apiKey;
    this.base = base;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.sleep = sleepImpl;
    this.maxRetries = maxRetries;
    this.requestTimeoutMs = requestTimeoutMs;
    this.pollIntervalMs = pollIntervalMs;
    this.pollTimeoutMs = pollTimeoutMs;
  }

  _headers() {
    if (!this.apiKey) throw new DuneClientError('DUNE_API_KEY not set');
    return { 'X-Dune-Api-Key': this.apiKey, 'Content-Type': 'application/json' };
  }

  /** A single fetch with explicit timeout + jittered retry on 429/5xx. */
  async _request(path, { method = 'GET', body } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const res = await this.fetch(`${this.base}${path}`, {
          method,
          headers: this._headers(),
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`Dune ${res.status} on ${path}`);
          if (attempt < this.maxRetries) {
            await this.sleep(backoffMs(attempt));
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new DuneClientError(`Dune ${res.status} on ${path}: ${text.slice(0, 200)}`);
        }
        return await res.json();
      } catch (err) {
        clearTimeout(timer);
        lastErr = err;
        // AbortError / network error → retry with backoff (transient).
        const transient = err?.name === 'AbortError' || err?.name === 'TypeError';
        if (transient && attempt < this.maxRetries) {
          await this.sleep(backoffMs(attempt));
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? new Error(`Dune request failed: ${path}`);
  }

  /** Execute a saved query id. performance picks the engine (small default). */
  async executeQuery(queryId, { performance = ENGINES.small } = {}) {
    return this._request(`/query/${queryId}/execute`, { method: 'POST', body: { performance } });
  }

  /** Execute raw SQL via Dune's first-party raw-SQL endpoint (POST
   *  /api/v1/sql/execute → { execution_id, state }). small engine by default.
   *  NB: the inline-SQL endpoint is /sql/execute with body { sql } — NOT
   *  /query/execute (which is not a live Dune route → HTTP 405). */
  async executeSql(sql, { performance = ENGINES.small } = {}) {
    return this._request('/sql/execute', { method: 'POST', body: { sql, performance } });
  }

  /** Poll an execution's status until it terminates or the poll budget expires. */
  async pollStatus(executionId) {
    const deadline = Date.now() + this.pollTimeoutMs;
    for (;;) {
      const status = await this._request(`/execution/${executionId}/status`);
      const state = status.state ?? status.execution_state;
      if (state === 'QUERY_STATE_COMPLETED') return status;
      if (state === 'QUERY_STATE_FAILED' || state === 'QUERY_STATE_CANCELLED') {
        // A cost-cap abort surfaces as a FAILED/CANCELLED execution. Treat it as
        // the hard signal the CLI maps to exit 4.
        throw new CostCapAbortError(`execution ${executionId} terminated: ${state}`, executionId);
      }
      if (Date.now() > deadline) {
        throw new Error(`execution ${executionId} exceeded poll budget (${this.pollTimeoutMs}ms) — engine cap`);
      }
      await this.sleep(this.pollIntervalMs);
    }
  }

  /** Read result metadata: datapoints scanned + credits/resource consumed. */
  async resultMetadata(executionId) {
    const res = await this._request(`/execution/${executionId}/results?limit=0`);
    const md = res.execution_result?.metadata ?? res.result?.metadata ?? res.metadata ?? {};
    // Dune exposes datapoint_count + total credits via result metadata / the
    // billing fields. We read defensively across the documented shapes.
    const datapoints = md.datapoint_count ?? md.total_row_count ?? 0;
    const credits = res.credits_used ?? md.total_credits_used ?? md.credits_used ?? null;
    return { datapoints, credits, raw: md };
  }

  /**
   * NON-EXECUTING read of a saved query's LATEST CACHED result metadata, via the
   * results endpoint with limit=0 (zero rows fetched — metadata only, no scan, no
   * new execution). This is how `estimate <query_id>` stays honest to the design
   * doc's hard constraint ("No full execution"): we NEVER run a saved query just
   * to estimate it. Returns {rows, cols} from the cached result's metadata.
   *
   * If the query has never completed an execution there is no cached metadata to
   * read — we DO NOT execute to fill the gap; we raise a caller error (exit 2)
   * telling the caller to pass SQL (the COUNT/LIMIT-1 probe path) or to run it
   * once through `run` (cost-capped) before estimating.
   */
  async latestResultMetadata(queryId) {
    let res;
    try {
      res = await this._request(`/query/${queryId}/results?limit=0`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      throw new DuneClientError(
        `estimate: no cached result for query ${queryId} (${why}) — estimate never executes a saved query; pass the SQL, or run it once (cost-capped) then estimate`,
      );
    }
    const md = res.result?.metadata ?? res.execution_result?.metadata ?? res.metadata ?? {};
    const finished = res.is_execution_finished === true
      || res.state === 'QUERY_STATE_COMPLETED'
      || md.total_row_count != null
      || md.datapoint_count != null;
    const rows = Number.isInteger(md.total_row_count)
      ? md.total_row_count
      : (Number.isInteger(md.row_count) ? md.row_count : 0);
    const cols = Array.isArray(md.column_names) ? md.column_names.length : 0;
    if (!finished || (rows === 0 && cols === 0)) {
      throw new DuneClientError(
        `estimate: query ${queryId} has no completed cached result — estimate never executes a saved query; pass the SQL, or run it once (cost-capped) then estimate`,
      );
    }
    return { rows, cols };
  }

  /**
   * COUNT(*) probe for raw SQL: returns {rows, countCredits}.
   * Used by cmdRun's split-probe path (inter-probe budget check between count + sample).
   */
  async probeCount(sql) {
    const countSql = `SELECT count(*) AS n FROM (${stripTrailingSemicolon(sql)}) _probe`;
    const exec = await this.executeSql(countSql, { performance: ENGINES.small });
    const status = await this.pollStatus(exec.execution_id);
    const rows = status.result?.rows?.[0]?.n ?? 0;
    const countMeta = await this.resultMetadata(exec.execution_id);
    const countCredits = Number.isInteger(countMeta.credits)
      ? countMeta.credits
      : Math.ceil((countMeta.datapoints ?? 0) / 1000);
    return { rows: Number(rows), countCredits };
  }

  /**
   * LIMIT 1 probe for raw SQL: returns {cols, sampleCredits}.
   * Used by cmdRun's split-probe path after the inter-probe budget check clears.
   */
  async probeSample(sql) {
    const sampleSql = `SELECT * FROM (${stripTrailingSemicolon(sql)}) _probe LIMIT 1`;
    const sampleExec = await this.executeSql(sampleSql, { performance: ENGINES.small });
    const sampleStatus = await this.pollStatus(sampleExec.execution_id);
    const cols = sampleStatus.result?.metadata?.column_names?.length
      ?? (sampleStatus.result?.rows?.[0] ? Object.keys(sampleStatus.result.rows[0]).length : 1);
    const sampleMeta = await this.resultMetadata(sampleExec.execution_id);
    const sampleCredits = Number.isInteger(sampleMeta.credits)
      ? sampleMeta.credits
      : Math.ceil((sampleMeta.datapoints ?? 0) / 1000);
    return { cols, sampleCredits };
  }

  /**
   * The estimate PROBE → {rows, cols, probe_credits}. NEVER does a full execution.
   *   • SQL      — delegates to probeCount + probeSample (cheap COUNT(*) + LIMIT-1).
   *   • query_id — NON-EXECUTING read of the latest cached result metadata.
   * cmdEstimate calls this combined form; cmdRun calls probeCount/probeSample
   * individually so it can gate on the budget between them.
   */
  async probe(target, { isQueryId }) {
    if (isQueryId) {
      const result = await this.latestResultMetadata(target);
      return { ...result, probe_credits: 0 };
    }
    const { rows, countCredits } = await this.probeCount(target);
    const { cols, sampleCredits } = await this.probeSample(target);
    return { rows, cols, probe_credits: countCredits + sampleCredits };
  }
}

/** Strip a single trailing semicolon so SQL can be subquery-wrapped. */
export function stripTrailingSemicolon(sql) {
  return String(sql).trim().replace(/;\s*$/, '');
}

/** Cheap heuristic: a bare integer string is a query id; anything else is SQL. */
export function looksLikeQueryId(target) {
  return /^\d+$/.test(String(target).trim());
}
