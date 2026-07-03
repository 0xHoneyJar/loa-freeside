/**
 * PostgresLedgerStore — the durable ILedgerStore (SDD sandwich-line §6b-2).
 *
 * Append = ONE transaction: advisory xact lock on the chain → freeze check →
 * insert observation ON CONFLICT DO NOTHING → seq = MAX(seq)+1 (inside the
 * lock — never pre-allocated, no gaps) → compute hash → insert chain row.
 * READ COMMITTED is sufficient: the xact-scoped advisory lock serializes
 * writers per chain; a failed transaction releases the lock automatically.
 *
 * Boot integrity (FAGAN i2 carry): `assertChainsVerified()` runs a FULL
 * verification of every chain before the store serves appends — older
 * tampering cannot be extended past boot. Periodic re-verification cadence
 * is the deployment's job (see package README).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  foldCollectionEntity,
  COLLECTION_OBSERVED_NAME,
  COLLECTION_RATIFIED_NAME,
  type ShadowObservation,
  type ShadowSubject,
  type ShadowEdge,
  type ShadowDivergence,
  type ShadowReport,
  type CollectionEntity,
  type ObservationAtSeq,
} from '@freeside/shadow-mode-protocol';
import type { ILedgerStore } from '../ports/ledger-store.js';
import { assertGrant, type AppendGrant } from '../auth/append-grant.js';
import {
  ChainFrozenError,
  GENESIS_PREV_HASH,
  computeLinkHash,
  genesisObservation,
  verifyChain as verifyLinks,
  type ChainLink,
  type ChainVerdict,
} from '../chain.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Canonicalize timestamps to the exact form `rowToObservation` reads back
 * (`Date.toISOString()`, millisecond UTC) BEFORE we hash + store (CSOT-002).
 * Postgres `timestamptz` round-trips a producer string like `...00:00Z` or a
 * microsecond value to a DIFFERENT string, so hashing the producer form and
 * verifying against the read-back form falsely freezes a healthy chain. Hashing
 * the canonical form makes append-hash == verify-hash. Validated ISO upstream
 * (`z.string().datetime()`), so `new Date` never yields NaN here.
 */
function canonicalizeObsTimestamps(o: ShadowObservation): ShadowObservation {
  return {
    ...o,
    observed_at: new Date(o.observed_at).toISOString(),
    emitted_at: new Date(o.emitted_at).toISOString(),
    ingested_at: new Date(o.ingested_at).toISOString(),
  };
}

function rowToObservation(row: pg.QueryResultRow): ShadowObservation {
  return {
    event_id: row.event_id,
    community_id: row.community_id,
    name: row.event_name,
    source: row.source,
    truth_status: row.truth_status,
    observed_at: row.observed_at.toISOString(),
    emitted_at: row.emitted_at.toISOString(),
    evidence_ref: row.evidence_ref ?? undefined,
    payload: row.payload,
    ingested_at: row.ingested_at.toISOString(),
  };
}

function rowToLink(row: pg.QueryResultRow): ChainLink {
  return {
    chain_id: row.chain_id,
    seq: Number(row.seq),
    event_id: row.event_id,
    prev_hash: row.prev_hash,
    hash: row.hash,
    chain_version: row.chain_version,
  };
}

function rowToSubject(row: pg.QueryResultRow): ShadowSubject {
  return {
    subject_id: row.subject_id,
    community_id: row.community_id,
    kind: row.subject_kind,
    identity_user_id: row.identity_user_id ?? undefined,
    discord_user_id: row.discord_user_id ?? undefined,
    display_name: row.display_name ?? undefined,
    wallets: row.wallets ?? [],
    aliases: row.aliases ?? [],
    current_roles: row.current_roles ?? [],
    incumbent_roles: row.incumbent_roles ?? [],
    freeside_roles: row.freeside_roles ?? [],
    attribution_quality: row.attribution_quality,
    merge_provenance: row.merge_provenance ?? [],
    pending_resplit: row.pending_resplit ?? false,
    last_seen_at: row.last_seen_at.toISOString(),
  } as ShadowSubject;
}

export class PostgresLedgerStore implements ILedgerStore {
  private booted = false;

  constructor(private readonly pool: pg.Pool) {}

  /** Apply sql/0001 + sql/0002 (idempotent) — the repo-standard bootstrap seam. */
  async migrate(): Promise<void> {
    for (const file of ['0001_shadow_mode.sql', '0002_shadow_chain.sql']) {
      const sql = readFileSync(join(__dirname, '..', '..', 'sql', file), 'utf8');
      await this.pool.query(sql);
    }
    // A fresh/migrated DB is verified before it serves appends (FAGAN S2 boot gate).
    await this.assertChainsVerified();
  }

  /**
   * FULL chain verification for every chain (boot gate — FAGAN i2 carry).
   * Any failure freezes that chain and throws; the deploy fails loud.
   */
  async assertChainsVerified(): Promise<void> {
    const { rows } = await this.pool.query('select distinct chain_id from shadow_chain');
    for (const row of rows) {
      const verdict = await this.verifyChain(row.chain_id);
      if (!verdict.ok) {
        throw new Error(
          `boot integrity: chain ${row.chain_id} fails verification at seq ${verdict.first_bad_seq} (${verdict.reason})`,
        );
      }
    }
    this.booted = true;
  }

  async appendObservationIfAbsent(observation: ShadowObservation, grant: AppendGrant): Promise<boolean> {
    if (!this.booted) {
      throw new Error('PostgresLedgerStore.appendObservationIfAbsent called before assertChainsVerified()/migrate() — boot integrity gate');
    }
    assertGrant(grant, observation.source, observation.name, observation.community_id);
    if (observation.event_id.startsWith('genesis:')) {
      throw new Error(`event_id namespace 'genesis:' is reserved (got ${observation.event_id})`);
    }
    // CSOT-002: hash + store the canonical timestamp form the DB reads back.
    observation = canonicalizeObsTimestamps(observation);
    const chainId = observation.community_id;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock(hashtext($1))', [chainId]);

      const frozen = await client.query(
        `select first_bad_seq from shadow_chain_state
         where chain_id = $1 and cleared_at is null
         order by id desc limit 1`,
        [chainId],
      );
      if (frozen.rows[0]) {
        await client.query('rollback');
        throw new ChainFrozenError(chainId, Number(frozen.rows[0].first_bad_seq));
      }

      // HEAD-integrity check runs BEFORE inserting the new observation, so a
      // tampered head can never leave an orphan observation committed (FAGAN S2).
      const head = await client.query(
        `select * from shadow_chain where chain_id = $1 order by seq desc limit 1`,
        [chainId],
      );
      let prev: ChainLink | null = head.rows[0] ? rowToLink(head.rows[0]) : null;
      if (prev) {
        const headObs = await client.query('select * from shadow_observations where event_id = $1', [prev.event_id]);
        const ok =
          headObs.rows[0] &&
          prev.hash ===
            computeLinkHash(prev.chain_id, prev.seq, prev.prev_hash, rowToObservation(headObs.rows[0]), prev.chain_version);
        if (!ok) {
          // Freeze INSIDE the advisory-locked transaction (the new observation
          // has NOT been inserted yet, so there is no orphan to roll back). This
          // serializes freeze-writes per chain — no duplicate freeze rows race.
          await client.query(
            `insert into shadow_chain_state (chain_id, frozen_reason, first_bad_seq) values ($1,'hash_mismatch',$2)`,
            [chainId, prev.seq],
          );
          await client.query('commit');
          throw new ChainFrozenError(chainId, prev.seq);
        }
      }

      const inserted = await client.query(
        `insert into shadow_observations
           (event_id, community_id, schema_version, event_name, source, truth_status,
            observed_at, emitted_at, evidence_ref, payload, ingested_at)
         values ($1,$2,'shadow.event.v1',$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (event_id) do nothing`,
        [
          observation.event_id,
          observation.community_id,
          observation.name,
          observation.source,
          observation.truth_status,
          observation.observed_at,
          observation.emitted_at,
          observation.evidence_ref ?? null,
          JSON.stringify(observation.payload),
          observation.ingested_at,
        ],
      );
      if (inserted.rowCount === 0) {
        await client.query('rollback');
        return false;
      }

      if (!prev) {
        // Lazy genesis inside the same transaction (seq 0 sentinel).
        const genesis = genesisObservation(chainId, observation.ingested_at);
        await client.query(
          `insert into shadow_observations
             (event_id, community_id, schema_version, event_name, source, truth_status,
              observed_at, emitted_at, evidence_ref, payload, ingested_at)
           values ($1,$2,'shadow.event.v1',$3,$4,$5,$6,$7,null,$8,$9)
           on conflict (event_id) do nothing`,
          [
            genesis.event_id,
            genesis.community_id,
            genesis.name,
            genesis.source,
            genesis.truth_status,
            genesis.observed_at,
            genesis.emitted_at,
            JSON.stringify(genesis.payload),
            genesis.ingested_at,
          ],
        );
        const gHash = computeLinkHash(chainId, 0, GENESIS_PREV_HASH, genesis);
        await client.query(
          `insert into shadow_chain (chain_id, seq, event_id, prev_hash, hash, chain_version)
           values ($1, 0, $2, $3, $4, 'shadow.chain.v1')`,
          [chainId, genesis.event_id, GENESIS_PREV_HASH, gHash],
        );
        prev = { chain_id: chainId, seq: 0, event_id: genesis.event_id, prev_hash: GENESIS_PREV_HASH, hash: gHash, chain_version: 'shadow.chain.v1' };
      }

      const seq = prev.seq + 1;
      const hash = computeLinkHash(chainId, seq, prev.hash, observation);
      await client.query(
        `insert into shadow_chain (chain_id, seq, event_id, prev_hash, hash, chain_version)
         values ($1,$2,$3,$4,$5,'shadow.chain.v1')`,
        [chainId, seq, observation.event_id, prev.hash, hash],
      );
      await client.query('commit');
      return true;
    } catch (err) {
      try {
        await client.query('rollback');
      } catch {
        /* already ended */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async getChainHead(chainId: string): Promise<ChainLink | undefined> {
    const { rows } = await this.pool.query(
      'select * from shadow_chain where chain_id = $1 order by seq desc limit 1',
      [chainId],
    );
    return rows[0] ? rowToLink(rows[0]) : undefined;
  }

  async verifyChain(chainId: string): Promise<ChainVerdict> {
    const links = (
      await this.pool.query('select * from shadow_chain where chain_id = $1 order by seq asc', [chainId])
    ).rows.map(rowToLink);
    const ids = links.map((l) => l.event_id);
    const obsRows = ids.length
      ? (await this.pool.query('select * from shadow_observations where event_id = any($1)', [ids])).rows
      : [];
    const byId = new Map(obsRows.map((r) => [r.event_id as string, rowToObservation(r)]));
    const verdict = verifyLinks(links, (id) => byId.get(id));
    if (!verdict.ok) {
      // Idempotent freeze: insert only if there is no active (uncleared) freeze
      // — concurrent verifyChain calls cannot pile up duplicate rows (FAGAN S2).
      await this.pool.query(
        `insert into shadow_chain_state (chain_id, frozen_reason, first_bad_seq)
         select $1, $2, $3
         where not exists (
           select 1 from shadow_chain_state where chain_id = $1 and cleared_at is null
         )`,
        [chainId, verdict.reason, verdict.first_bad_seq],
      );
    }
    return verdict;
  }

  async isChainFrozen(chainId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `select 1 from shadow_chain_state where chain_id = $1 and cleared_at is null order by id desc limit 1`,
      [chainId],
    );
    return rows.length > 0;
  }

  async clearChainFreeze(chainId: string, clearedBy: string, rationale: string): Promise<void> {
    if (!(await this.isChainFrozen(chainId))) {
      throw new Error(`clear refused: chain ${chainId} has no active freeze`);
    }
    // Clear only if the chain verifies green post-repair (never a silent reopen).
    const links = (
      await this.pool.query('select * from shadow_chain where chain_id = $1 order by seq asc', [chainId])
    ).rows.map(rowToLink);
    const ids = links.map((l) => l.event_id);
    const obsRows = ids.length
      ? (await this.pool.query('select * from shadow_observations where event_id = any($1)', [ids])).rows
      : [];
    const byId = new Map(obsRows.map((r) => [r.event_id as string, rowToObservation(r)]));
    const verdict = verifyLinks(links, (id) => byId.get(id));
    if (!verdict.ok) {
      throw new Error(
        `clear refused: chain ${chainId} still fails verification at seq ${verdict.first_bad_seq} (${verdict.reason}) — repair or fork-ack`,
      );
    }
    const res = await this.pool.query(
      `update shadow_chain_state set cleared_at = now(), cleared_by = $2, clear_rationale = $3
       where id = (select id from shadow_chain_state where chain_id = $1 and cleared_at is null order by id desc limit 1)`,
      [chainId, clearedBy, rationale],
    );
    if (res.rowCount !== 1) throw new Error(`clear failed: no uncleared freeze row for chain ${chainId}`);
  }

  async withTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
    // Chain appends carry their OWN advisory-locked transaction. The reducer's
    // projection writes currently ride the pool per-statement.
    // loa:shortcut: this is NOT one atomic transaction across append + projection.
    // Known failure: if the append commits but a projection upsert then fails,
    // the next redelivery short-circuits at the duplicate-event_id check and the
    // projection is NEVER re-applied — chain ahead of projection. This is why the
    // Postgres store MUST NOT back a LIVE producer this cycle (FR-6 scope: the
    // only durable path is the flag-gated, read-only differential; no NATS
    // consumer). Upgrade trigger (REQUIRED before any live producer / NATS
    // cutover): thread a client-scoped transaction through ShadowLedger.ingest so
    // append + all projection writes commit or roll back together.
    return await fn();
  }

  // --- projections -----------------------------------------------------------

  async getSubject(subjectId: string): Promise<ShadowSubject | undefined> {
    const { rows } = await this.pool.query('select s.*, coalesce(a.aliases, \'[]\'::jsonb) as aliases from shadow_subjects s left join (select subject_id, jsonb_agg(alias_value) as aliases from shadow_subject_aliases group by subject_id) a using (subject_id) where s.subject_id = $1', [subjectId]);
    return rows[0] ? rowToSubject(rows[0]) : undefined;
  }

  async findSubjectByAlias(communityId: string, alias: string): Promise<ShadowSubject | undefined> {
    const { rows } = await this.pool.query(
      `select subject_id from shadow_subject_aliases where community_id = $1 and alias_kind = 'flat' and alias_value = $2`,
      [communityId, alias],
    );
    return rows[0] ? this.getSubject(rows[0].subject_id) : undefined;
  }

  async upsertSubject(subject: ShadowSubject): Promise<void> {
    await this.pool.query(
      `insert into shadow_subjects
         (subject_id, community_id, subject_kind, identity_user_id, discord_user_id, display_name,
          wallets, current_roles, incumbent_roles, freeside_roles, attribution_quality,
          merge_provenance, pending_resplit, last_seen_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
       on conflict (subject_id) do update set
         subject_kind = excluded.subject_kind,
         identity_user_id = excluded.identity_user_id,
         discord_user_id = excluded.discord_user_id,
         display_name = excluded.display_name,
         wallets = excluded.wallets,
         current_roles = excluded.current_roles,
         incumbent_roles = excluded.incumbent_roles,
         freeside_roles = excluded.freeside_roles,
         attribution_quality = excluded.attribution_quality,
         merge_provenance = excluded.merge_provenance,
         pending_resplit = excluded.pending_resplit,
         last_seen_at = excluded.last_seen_at,
         updated_at = now()`,
      [
        subject.subject_id,
        subject.community_id,
        subject.kind,
        subject.identity_user_id ?? null,
        subject.discord_user_id ?? null,
        subject.display_name ?? null,
        JSON.stringify(subject.wallets ?? []),
        JSON.stringify(subject.current_roles ?? []),
        JSON.stringify(subject.incumbent_roles ?? []),
        JSON.stringify(subject.freeside_roles ?? []),
        subject.attribution_quality,
        JSON.stringify(subject.merge_provenance ?? []),
        subject.pending_resplit ?? false,
        subject.last_seen_at,
      ],
    );
  }

  async deleteSubject(subjectId: string): Promise<void> {
    await this.pool.query('delete from shadow_subject_aliases where subject_id = $1', [subjectId]);
    await this.pool.query('delete from shadow_subjects where subject_id = $1', [subjectId]);
  }

  async upsertAlias(communityId: string, alias: string, subjectId: string): Promise<void> {
    await this.pool.query(
      `insert into shadow_subject_aliases (community_id, alias_kind, alias_value, subject_id)
       values ($1,'flat',$2,$3)
       on conflict (community_id, alias_kind, alias_value) do update set subject_id = excluded.subject_id`,
      [communityId, alias, subjectId],
    );
  }

  async hasEdge(edgeId: string): Promise<boolean> {
    const { rows } = await this.pool.query('select 1 from shadow_edges where edge_id = $1', [edgeId]);
    return rows.length > 0;
  }

  async upsertEdge(edge: ShadowEdge): Promise<void> {
    await this.pool.query(
      `insert into shadow_edges (edge_id, community_id, subject_id, source, edge_kind, truth_status, observed_at, evidence_ref, data)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (edge_id) do nothing`,
      [
        edge.edge_id,
        edge.community_id,
        edge.subject_id,
        edge.source,
        edge.edge_kind,
        edge.truth_status,
        edge.observed_at,
        edge.evidence_ref ?? null,
        JSON.stringify(edge.data ?? {}),
      ],
    );
  }

  async reassignEdges(fromSubjectId: string, toSubjectId: string): Promise<void> {
    await this.pool.query('update shadow_edges set subject_id = $2 where subject_id = $1', [
      fromSubjectId,
      toSubjectId,
    ]);
  }

  async upsertDivergence(divergence: ShadowDivergence): Promise<void> {
    await this.pool.query(
      `insert into shadow_divergences (divergence_id, community_id, subject_id, divergence_kind, incumbent_roles, freeside_roles, reason, observed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (divergence_id) do update set
         divergence_kind = excluded.divergence_kind,
         incumbent_roles = excluded.incumbent_roles,
         freeside_roles = excluded.freeside_roles,
         reason = excluded.reason,
         observed_at = excluded.observed_at`,
      [
        divergence.divergence_id,
        divergence.community_id,
        divergence.subject_id,
        divergence.kind,
        JSON.stringify(divergence.incumbent_roles),
        JSON.stringify(divergence.freeside_roles),
        divergence.reason,
        divergence.observed_at,
      ],
    );
  }

  async deleteDivergence(divergenceId: string): Promise<void> {
    await this.pool.query('delete from shadow_divergences where divergence_id = $1', [divergenceId]);
  }

  async upsertReport(report: ShadowReport): Promise<void> {
    await this.pool.query(
      `insert into shadow_reports (report_id, community_id, report_kind, generated_at, summary, caveats)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (report_id) do update set summary = excluded.summary, caveats = excluded.caveats`,
      [
        report.report_id,
        report.community_id,
        (report as { report_kind?: string }).report_kind ?? 'access_audit',
        (report as { generated_at?: string }).generated_at ?? new Date().toISOString(),
        JSON.stringify((report as { summary?: unknown }).summary ?? {}),
        JSON.stringify((report as { caveats?: unknown }).caveats ?? []),
      ],
    );
  }

  async subjects(communityId: string): Promise<ShadowSubject[]> {
    const { rows } = await this.pool.query(
      `select s.*, coalesce(a.aliases, '[]'::jsonb) as aliases
       from shadow_subjects s
       left join (select subject_id, jsonb_agg(alias_value) as aliases from shadow_subject_aliases group by subject_id) a using (subject_id)
       where s.community_id = $1`,
      [communityId],
    );
    return rows.map(rowToSubject);
  }

  async edges(communityId: string): Promise<ShadowEdge[]> {
    const { rows } = await this.pool.query('select * from shadow_edges where community_id = $1', [communityId]);
    return rows.map((r) => ({
      edge_id: r.edge_id,
      community_id: r.community_id,
      subject_id: r.subject_id,
      source: r.source,
      edge_kind: r.edge_kind,
      truth_status: r.truth_status,
      observed_at: r.observed_at.toISOString(),
      evidence_ref: r.evidence_ref ?? undefined,
      data: r.data ?? {},
    })) as ShadowEdge[];
  }

  async divergences(communityId: string): Promise<ShadowDivergence[]> {
    const { rows } = await this.pool.query('select * from shadow_divergences where community_id = $1', [communityId]);
    return rows.map((r) => ({
      divergence_id: r.divergence_id,
      community_id: r.community_id,
      subject_id: r.subject_id,
      kind: r.divergence_kind,
      incumbent_roles: r.incumbent_roles ?? [],
      freeside_roles: r.freeside_roles ?? [],
      reason: r.reason,
      observed_at: r.observed_at.toISOString(),
    })) as ShadowDivergence[];
  }

  // --- collection labelled-entities: FOLD the entity's worldline (SDD §2) ---
  // Collection observations already live in shadow_observations (community_id =
  // entity_id, written by appendObservationIfAbsent) — no separate table. Fold
  // reads them in chain-seq order.

  private async observationsAtSeq(chainId: string): Promise<ObservationAtSeq[]> {
    const { rows } = await this.pool.query(
      `select o.*, c.seq
         from shadow_chain c
         join shadow_observations o on o.event_id = c.event_id
        where c.chain_id = $1 and c.seq > 0
        order by c.seq asc`,
      [chainId],
    );
    return rows.map((r) => ({ observation: rowToObservation(r), seq: Number(r.seq) }));
  }

  async getCollectionEntity(entityId: string): Promise<CollectionEntity | undefined> {
    // Verify-on-read (FAGAN MEDIUM-2): refuse to serve a tampered projection.
    const verdict = await this.verifyChain(entityId);
    if (!verdict.ok) {
      throw new ChainFrozenError(entityId, verdict.first_bad_seq);
    }
    return foldCollectionEntity(await this.observationsAtSeq(entityId)) ?? undefined;
  }

  async listCollectionEntities(): Promise<CollectionEntity[]> {
    const { rows } = await this.pool.query(
      `select distinct community_id from shadow_observations where event_name = any($1)`,
      [[COLLECTION_OBSERVED_NAME, COLLECTION_RATIFIED_NAME]],
    );
    const out: CollectionEntity[] = [];
    for (const r of rows) {
      // Fail-closed: skip any chain that fails verification (never serve forged).
      if (!(await this.verifyChain(r.community_id)).ok) continue;
      const entity = foldCollectionEntity(await this.observationsAtSeq(r.community_id));
      if (entity) out.push(entity);
    }
    return out;
  }
}
