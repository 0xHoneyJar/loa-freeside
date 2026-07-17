/**
 * CR-201A Postgres shared preparation adapter (expand-only migration 007).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import pg from "pg";
import {
  deploymentSetDigest,
  digestPublicWorkKey,
  finalityPolicyVersion,
} from "./shared-preparation-work-key.js";
import {
  isActivePublicWorkState,
  type PreparationWorkItemRecord,
  type ReadinessEvidenceEnvelope,
  type ReportWorkLinkRecord,
  type SharedPreparationWorkRecord,
} from "./shared-preparation-types.js";
import {
  SharedPreparationFencingError,
  SharedPreparationStateError,
  type JoinPublicWorkInput,
  type JoinPublicWorkResult,
  type SharedPreparationStore,
} from "./shared-preparation-store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function isUniqueActiveKeyViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const pgErr = err as Error & { code?: string; constraint?: string };
  return (
    pgErr.code === "23505" ||
    err.message.includes("shared_preparation_work_key_active_idx")
  );
}

function rowToWork(row: pg.QueryResultRow): SharedPreparationWorkRecord {
  return {
    work_id: row.work_id,
    work_key_digest: row.work_key_digest,
    deployment_set_digest: row.deployment_set_digest,
    capability: row.capability,
    capability_version: row.capability_version,
    scope_class: "deployment",
    scope_digest: row.scope_digest,
    privacy_class: "public_chain",
    source_identity: row.source_identity,
    readiness_policy_version: row.readiness_policy_version,
    evidence_boundary_kind: row.evidence_boundary_kind,
    ...(row.evidence_boundary_digest != null
      ? { evidence_boundary_digest: row.evidence_boundary_digest }
      : {}),
    adapter_version: row.adapter_version,
    finality_policy_version: row.finality_policy_version,
    state: row.state,
    generation: Number(row.generation),
    ...(row.readiness_evidence != null
      ? { readiness_evidence: row.readiness_evidence as ReadinessEvidenceEnvelope }
      : {}),
    attempt: Number(row.attempt),
    ...(row.next_attempt_at != null
      ? { next_attempt_at_unix_ms: Date.parse(row.next_attempt_at as string) }
      : {}),
    ...(row.retry_deadline != null
      ? { retry_deadline_unix_ms: Date.parse(row.retry_deadline as string) }
      : {}),
    ...(row.lease_until != null
      ? { lease_until_unix_ms: Date.parse(row.lease_until as string) }
      : {}),
    lease_epoch: Number(row.lease_epoch),
    ...(row.failure_reason != null
      ? { failure_reason: row.failure_reason as { code: string; reason: string } }
      : {}),
    sharing_scope_kind: "public",
    created_at_unix_ms: Date.parse(row.created_at as string),
    updated_at_unix_ms: Date.parse(row.updated_at as string),
  };
}

function rowToItem(row: pg.QueryResultRow): PreparationWorkItemRecord {
  return {
    work_item_id: row.work_item_id,
    work_id: row.work_id,
    deployment_id: row.deployment_id,
    capability: row.capability,
    adapter_version: row.adapter_version,
    ...(row.external_job_ref != null ? { external_job_ref: row.external_job_ref } : {}),
    state: row.state,
    attempt: Number(row.attempt),
    lease_epoch: Number(row.lease_epoch),
    ...(row.evidence_envelope != null
      ? { evidence_envelope: row.evidence_envelope as ReadinessEvidenceEnvelope }
      : {}),
    ...(row.failure_reason != null
      ? { failure_reason: row.failure_reason as { code: string; reason: string } }
      : {}),
    created_at_unix_ms: Date.parse(row.created_at as string),
    updated_at_unix_ms: Date.parse(row.updated_at as string),
  };
}

function rowToLink(row: pg.QueryResultRow): ReportWorkLinkRecord {
  return {
    order_id: row.order_id,
    work_id: row.work_id,
    joined_at_unix_ms: Date.parse(row.joined_at as string),
    ...(row.detached_at != null
      ? { detached_at_unix_ms: Date.parse(row.detached_at as string) }
      : {}),
    generation: Number(row.generation),
    order_tenant_scope_digest: row.order_tenant_scope_digest,
    sharing_scope_kind: "public",
  };
}

function msToIso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface PostgresSharedPreparationStoreOptions {
  readonly pool: pg.Pool;
}

export class PostgresSharedPreparationStore implements SharedPreparationStore {
  private readonly pool: pg.Pool;

  constructor(opts: PostgresSharedPreparationStoreOptions) {
    this.pool = opts.pool;
  }

  static async connect(
    connectionString: string,
    opts: { migrate?: boolean; pool?: pg.Pool } = {},
  ): Promise<PostgresSharedPreparationStore> {
    const pool = opts.pool ?? new pg.Pool({ connectionString, max: 10 });
    const store = new PostgresSharedPreparationStore({ pool });
    if (opts.migrate ?? process.env.RUN_MIGRATIONS === "true") {
      await store.runMigrations();
    }
    return store;
  }

  async runMigrations(): Promise<void> {
    // Orders FK target for report_work_links.
    for (const file of [
      "001_orders.sql",
      "007_shared_preparation_work.sql",
    ]) {
      const sql = readFileSync(join(__dirname, "../migrations", file), "utf8");
      await this.pool.query(sql);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Exposed for race harnesses that need a bare pool. */
  getPool(): pg.Pool {
    return this.pool;
  }

  private async advisoryLock(client: pg.PoolClient, workKeyDigest: string): Promise<void> {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [workKeyDigest]);
  }

  private async classifyZeroRowWorkUpdate(
    workId: string,
    expectedLeaseEpoch: number,
    context: string,
  ): Promise<never> {
    const current = await this.getWork(workId);
    if (!current) throw new SharedPreparationStateError("work not found");
    if (current.lease_epoch !== expectedLeaseEpoch) {
      throw new SharedPreparationFencingError(`stale lease epoch for ${context}`);
    }
    throw new SharedPreparationStateError(`cannot ${context} from ${current.state}`);
  }

  async joinPublicWork(input: JoinPublicWorkInput): Promise<JoinPublicWorkResult> {
    const workKeyDigest = digestPublicWorkKey(input.work_key);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.advisoryLock(client, workKeyDigest);

      const readyResult = await client.query(
        `SELECT * FROM shared_preparation_work
         WHERE work_key_digest = $1
           AND state = 'ready'
           AND readiness_policy_version = $2
           AND readiness_evidence IS NOT NULL
           AND (readiness_evidence->'freshness'->>'qualified')::boolean = true
         ORDER BY generation DESC
         LIMIT 1`,
        [workKeyDigest, input.work_key.readiness_policy_version],
      );
      if (readyResult.rows.length > 0) {
        const work = rowToWork(readyResult.rows[0]);
        await this.insertLink(client, input, work.work_id, work.generation);
        const links = await this.fetchActiveLinks(client, work.work_id);
        await client.query("COMMIT");
        return {
          kind: "joined",
          work,
          links,
          created: false,
          reused_ready: true,
        };
      }

      const activeResult = await client.query(
        `SELECT * FROM shared_preparation_work
         WHERE work_key_digest = $1 AND state IN ('queued', 'preparing', 'retry_wait')
         LIMIT 1`,
        [workKeyDigest],
      );
      if (activeResult.rows.length > 0) {
        const work = rowToWork(activeResult.rows[0]);
        await this.insertLink(client, input, work.work_id, work.generation);
        const links = await this.fetchActiveLinks(client, work.work_id);
        await client.query("COMMIT");
        return {
          kind: "joined",
          work,
          links,
          created: false,
          reused_ready: false,
        };
      }

      const maxGen = await client.query(
        "SELECT COALESCE(MAX(generation), 0) AS max_generation FROM shared_preparation_work WHERE work_key_digest = $1",
        [workKeyDigest],
      );
      const generation = Number(maxGen.rows[0].max_generation) + 1;
      const workId = `spw_${randomUUID()}`;
      const nowIso = msToIso(input.now_ms);
      await client.query(
        `INSERT INTO shared_preparation_work (
          work_id, work_key_digest, deployment_set_digest, capability, capability_version,
          scope_digest, source_identity, readiness_policy_version, evidence_boundary_kind,
          evidence_boundary_digest, adapter_version, finality_policy_version, state, generation,
          attempt, lease_epoch, created_at, updated_at
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued',$13,0,0,$14,$14
        )`,
        [
          workId,
          workKeyDigest,
          deploymentSetDigest(input.work_key.deployment_ids),
          input.work_key.capability,
          input.work_key.capability_version,
          input.work_key.scope_digest,
          JSON.stringify(input.work_key.source_identity),
          input.work_key.readiness_policy_version,
          input.work_key.evidence_boundary_kind,
          input.work_key.evidence_boundary_digest ?? null,
          input.work_key.adapter_version,
          finalityPolicyVersion(input.work_key.finality_policies),
          generation,
          nowIso,
        ],
      );
      for (const deploymentId of input.work_key.deployment_ids) {
        await client.query(
          `INSERT INTO preparation_work_items (
            work_item_id, work_id, deployment_id, capability, adapter_version, state, attempt, lease_epoch, created_at, updated_at
          ) VALUES ($1,$2,$3,$4,$5,'queued',0,0,$6,$6)`,
          [
            `pwi_${randomUUID()}`,
            workId,
            JSON.stringify(deploymentId),
            input.work_key.capability,
            input.work_key.adapter_version,
            nowIso,
          ],
        );
      }
      await this.insertLink(client, input, workId, generation);
      const workRow = await client.query(
        "SELECT * FROM shared_preparation_work WHERE work_id = $1",
        [workId],
      );
      const links = await this.fetchActiveLinks(client, workId);
      await client.query("COMMIT");
      return {
        kind: "joined",
        work: rowToWork(workRow.rows[0]),
        links,
        created: true,
        reused_ready: false,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      if (isUniqueActiveKeyViolation(err)) {
        return { kind: "serialization_retry" };
      }
      throw err;
    } finally {
      client.release();
    }
  }

  private async insertLink(
    client: pg.PoolClient,
    input: JoinPublicWorkInput,
    workId: string,
    generation: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO report_work_links (
        order_id, work_id, joined_at, generation, order_tenant_scope_digest
      ) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (order_id, work_id) DO UPDATE SET
        detached_at = NULL,
        generation = EXCLUDED.generation,
        joined_at = EXCLUDED.joined_at`,
      [input.order_id, workId, msToIso(input.now_ms), generation, input.order_tenant_scope_digest],
    );
  }

  private async fetchActiveLinks(
    clientOrWorkId: pg.PoolClient | string,
    workId?: string,
  ): Promise<readonly ReportWorkLinkRecord[]> {
    if (typeof clientOrWorkId === "string") {
      const result = await this.pool.query(
        "SELECT * FROM report_work_links WHERE work_id = $1 AND detached_at IS NULL",
        [clientOrWorkId],
      );
      return result.rows.map(rowToLink);
    }
    const result = await clientOrWorkId.query(
      "SELECT * FROM report_work_links WHERE work_id = $1 AND detached_at IS NULL",
      [workId],
    );
    return result.rows.map(rowToLink);
  }

  async getWork(workId: string): Promise<SharedPreparationWorkRecord | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM shared_preparation_work WHERE work_id = $1",
      [workId],
    );
    return result.rows.length > 0 ? rowToWork(result.rows[0]) : undefined;
  }

  async listActiveLinks(workId: string): Promise<readonly ReportWorkLinkRecord[]> {
    return this.fetchActiveLinks(workId);
  }

  async listWorkItems(workId: string): Promise<readonly PreparationWorkItemRecord[]> {
    const result = await this.pool.query(
      "SELECT * FROM preparation_work_items WHERE work_id = $1 ORDER BY created_at",
      [workId],
    );
    return result.rows.map(rowToItem);
  }

  async acquireLease(input: {
    work_id: string;
    worker_id: string;
    lease_duration_ms: number;
    now_ms: number;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT * FROM shared_preparation_work WHERE work_id = $1 FOR UPDATE",
        [input.work_id],
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return { kind: "not_active" as const };
      }
      const work = rowToWork(result.rows[0]);
      if (!isActivePublicWorkState(work.state)) {
        await client.query("ROLLBACK");
        return { kind: "not_active" as const };
      }
      const leaseExpired =
        work.lease_until_unix_ms === undefined || input.now_ms >= work.lease_until_unix_ms;
      if (!leaseExpired) {
        await client.query("ROLLBACK");
        return { kind: "busy" as const };
      }
      const reclaimed = work.lease_until_unix_ms !== undefined;
      const nextEpoch = work.lease_epoch + 1;
      const leaseUntil = msToIso(input.now_ms + input.lease_duration_ms);
      const nowIso = msToIso(input.now_ms);
      const updated = await client.query(
        `UPDATE shared_preparation_work
         SET lease_epoch = $2, lease_until = $3, updated_at = $4
         WHERE work_id = $1
         RETURNING *`,
        [input.work_id, nextEpoch, leaseUntil, nowIso],
      );
      await client.query(
        "UPDATE preparation_work_items SET lease_epoch = $2, updated_at = $3 WHERE work_id = $1",
        [input.work_id, nextEpoch, nowIso],
      );
      await client.query("COMMIT");
      return {
        kind: reclaimed ? ("reclaimed" as const) : ("acquired" as const),
        work: rowToWork(updated.rows[0]),
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async transitionToPreparing(input: {
    work_id: string;
    expected_lease_epoch: number;
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // retry_wait → preparing only via wakeRetryWait → queued first.
      const result = await client.query(
        `UPDATE shared_preparation_work
         SET state = 'preparing', updated_at = $3
         WHERE work_id = $1 AND lease_epoch = $2 AND state = 'queued'
         RETURNING *`,
        [input.work_id, input.expected_lease_epoch, msToIso(input.now_ms)],
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return this.classifyZeroRowWorkUpdate(
          input.work_id,
          input.expected_lease_epoch,
          "preparing transition",
        );
      }
      await client.query(
        `UPDATE preparation_work_items
         SET state = 'preparing', updated_at = $2
         WHERE work_id = $1 AND state = 'queued'`,
        [input.work_id, msToIso(input.now_ms)],
      );
      await client.query("COMMIT");
      return rowToWork(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async recordRetryableFailure(input: {
    work_id: string;
    expected_lease_epoch: number;
    next_attempt_at_unix_ms: number;
    retry_deadline_unix_ms: number;
    failure: { code: string; reason: string };
    now_ms: number;
  }): Promise<SharedPreparationWorkRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE shared_preparation_work
         SET state = 'retry_wait',
             attempt = attempt + 1,
             next_attempt_at = $3,
             retry_deadline = $4,
             lease_until = NULL,
             failure_reason = $5,
             updated_at = $6
         WHERE work_id = $1 AND lease_epoch = $2 AND state = 'preparing'
         RETURNING *`,
        [
          input.work_id,
          input.expected_lease_epoch,
          msToIso(input.next_attempt_at_unix_ms),
          msToIso(input.retry_deadline_unix_ms),
          JSON.stringify(input.failure),
          msToIso(input.now_ms),
        ],
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return this.classifyZeroRowWorkUpdate(
          input.work_id,
          input.expected_lease_epoch,
          "retryable failure",
        );
      }
      // Invalidate child progress so finalize cannot reuse pre-retry evidence.
      await client.query(
        `UPDATE preparation_work_items
         SET state = 'queued',
             evidence_envelope = NULL,
             failure_reason = NULL,
             updated_at = $2
         WHERE work_id = $1
           AND state IN ('ready', 'preparing', 'failed', 'retry_wait')`,
        [input.work_id, msToIso(input.now_ms)],
      );
      await client.query("COMMIT");
      return rowToWork(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async wakeRetryWait(input: {
    work_id: string;
    expected_attempt: number;
    now_ms: number;
  }) {
    // CAS on attempt (monotonic token), deadline as inequality — not timestamptz equality.
    const result = await this.pool.query(
      `UPDATE shared_preparation_work
       SET state = 'queued', updated_at = $3
       WHERE work_id = $1
         AND state = 'retry_wait'
         AND attempt = $2
         AND next_attempt_at IS NOT NULL
         AND next_attempt_at <= $4
       RETURNING *`,
      [
        input.work_id,
        input.expected_attempt,
        msToIso(input.now_ms),
        msToIso(input.now_ms),
      ],
    );
    if (result.rows.length === 0) return { kind: "stale_wake" as const };
    return { kind: "woke" as const, work: rowToWork(result.rows[0]) };
  }

  async publishChildEvidence(input: {
    work_item_id: string;
    expected_lease_epoch: number;
    evidence: ReadinessEvidenceEnvelope;
    now_ms: number;
  }): Promise<PreparationWorkItemRecord> {
    const result = await this.pool.query(
      `UPDATE preparation_work_items
       SET state = 'ready', evidence_envelope = $3, updated_at = $4
       WHERE work_item_id = $1
         AND lease_epoch = $2
         AND state = 'preparing'
       RETURNING *`,
      [
        input.work_item_id,
        input.expected_lease_epoch,
        JSON.stringify(input.evidence),
        msToIso(input.now_ms),
      ],
    );
    if (result.rows.length === 0) {
      const current = await this.pool.query(
        "SELECT * FROM preparation_work_items WHERE work_item_id = $1",
        [input.work_item_id],
      );
      if (current.rows.length === 0) {
        throw new SharedPreparationStateError("work item not found");
      }
      const item = rowToItem(current.rows[0]);
      if (item.lease_epoch !== input.expected_lease_epoch) {
        throw new SharedPreparationFencingError("stale lease epoch for child evidence");
      }
      throw new SharedPreparationStateError(
        `child evidence requires preparing, got ${item.state}`,
      );
    }
    return rowToItem(result.rows[0]);
  }

  async finalizeReadyIfQualified(input: {
    work_id: string;
    expected_lease_epoch: number;
    readiness_evidence: ReadinessEvidenceEnvelope;
    now_ms: number;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query(
        `SELECT * FROM shared_preparation_work WHERE work_id = $1 FOR UPDATE`,
        [input.work_id],
      );
      if (locked.rows.length === 0) {
        await client.query("ROLLBACK");
        throw new SharedPreparationStateError("work not found");
      }
      const work = rowToWork(locked.rows[0]);
      if (work.lease_epoch !== input.expected_lease_epoch) {
        await client.query("ROLLBACK");
        throw new SharedPreparationFencingError("stale lease epoch for parent ready");
      }
      if (work.state !== "preparing") {
        await client.query("ROLLBACK");
        throw new SharedPreparationStateError(
          `finalize ready requires preparing, got ${work.state}`,
        );
      }

      const pending = await client.query(
        "SELECT COUNT(*)::int AS pending FROM preparation_work_items WHERE work_id = $1 AND state <> 'ready'",
        [input.work_id],
      );
      if (Number(pending.rows[0].pending) > 0) {
        await client.query("COMMIT");
        return { kind: "pending_children" as const, work };
      }

      const result = await client.query(
        `UPDATE shared_preparation_work
         SET state = 'ready',
             readiness_evidence = $3,
             lease_until = NULL,
             updated_at = $4
         WHERE work_id = $1
           AND lease_epoch = $2
           AND state = 'preparing'
           AND NOT EXISTS (
             SELECT 1 FROM preparation_work_items
             WHERE work_id = $1 AND state <> 'ready'
           )
         RETURNING *`,
        [
          input.work_id,
          input.expected_lease_epoch,
          JSON.stringify(input.readiness_evidence),
          msToIso(input.now_ms),
        ],
      );
      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return this.classifyZeroRowWorkUpdate(
          input.work_id,
          input.expected_lease_epoch,
          "parent ready",
        );
      }
      await client.query("COMMIT");
      return { kind: "ready" as const, work: rowToWork(result.rows[0]) };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // already rolled back / committed
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async detachSubscriber(input: { order_id: string; work_id: string; now_ms: number }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const workRow = await client.query(
        "SELECT work_key_digest FROM shared_preparation_work WHERE work_id = $1 FOR UPDATE",
        [input.work_id],
      );
      if (workRow.rows.length === 0) {
        await client.query("ROLLBACK");
        return { kind: "not_linked" as const };
      }
      await this.advisoryLock(client, workRow.rows[0].work_key_digest as string);

      const linkResult = await client.query(
        `UPDATE report_work_links
         SET detached_at = $3
         WHERE order_id = $1 AND work_id = $2 AND detached_at IS NULL
         RETURNING *`,
        [input.order_id, input.work_id, msToIso(input.now_ms)],
      );
      if (linkResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return { kind: "not_linked" as const };
      }

      // Re-check zero active links in the same statement that abandons.
      const abandoned = await client.query(
        `UPDATE shared_preparation_work AS w
         SET state = 'abandoned', lease_until = NULL, updated_at = $2
         WHERE w.work_id = $1
           AND w.state IN ('queued', 'preparing', 'retry_wait')
           AND NOT EXISTS (
             SELECT 1 FROM report_work_links l
             WHERE l.work_id = w.work_id AND l.detached_at IS NULL
           )
         RETURNING *`,
        [input.work_id, msToIso(input.now_ms)],
      );
      await client.query("COMMIT");
      if (abandoned.rows.length > 0) {
        return { kind: "detached" as const, work: rowToWork(abandoned.rows[0]) };
      }
      return { kind: "detached" as const };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async supersedeActiveGeneration(input: { work_key_digest: string; now_ms: number }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.advisoryLock(client, input.work_key_digest);
      const result = await client.query(
        `UPDATE shared_preparation_work
         SET state = 'superseded', lease_until = NULL, updated_at = $2
         WHERE work_key_digest = $1 AND state IN ('queued', 'preparing', 'retry_wait')
         RETURNING *`,
        [input.work_key_digest, msToIso(input.now_ms)],
      );
      await client.query("COMMIT");
      return result.rows.length > 0 ? rowToWork(result.rows[0]) : undefined;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
