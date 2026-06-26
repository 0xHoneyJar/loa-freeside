-- shadow-mode-api Postgres schema (SDD §9). Ownership-scoped to this building —
-- a DISTINCT store from the legacy coexistence ScyllaDB keyspace (which also has
-- a `shadow_divergences` table of a different shape). MVP runs on the in-memory
-- adapter; this is the migration seam, not wired to a live DB this cycle.
-- Production should use the repo-standard migration tool.

create table if not exists shadow_observations (
  event_id text primary key,                       -- idempotency key (INSERT ON CONFLICT DO NOTHING)
  community_id text not null,
  schema_version text not null,
  event_name text not null,
  source text not null,
  truth_status text not null default 'observed',
  observed_at timestamptz not null,
  emitted_at timestamptz not null,
  evidence_ref text,
  payload jsonb not null,
  ingested_at timestamptz not null default now()
);

create index if not exists shadow_observations_community_time_idx
  on shadow_observations (community_id, observed_at desc);

create table if not exists shadow_subjects (
  subject_id text primary key,
  community_id text not null,
  subject_kind text not null,
  identity_user_id text,
  discord_user_id text,
  display_name text,
  wallets jsonb not null default '[]'::jsonb,
  current_roles jsonb not null default '[]'::jsonb,
  incumbent_roles jsonb not null default '[]'::jsonb,
  freeside_roles jsonb not null default '[]'::jsonb,
  attribution_quality text not null,
  merge_provenance jsonb not null default '[]'::jsonb,
  pending_resplit boolean not null default false,
  last_seen_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists shadow_subjects_community_kind_idx
  on shadow_subjects (community_id, subject_kind);

create table if not exists shadow_subject_aliases (
  community_id text not null,
  alias_kind text not null,
  alias_value text not null,
  subject_id text not null references shadow_subjects(subject_id),
  created_at timestamptz not null default now(),
  primary key (community_id, alias_kind, alias_value)
);

create table if not exists shadow_edges (
  edge_id text primary key,
  community_id text not null,
  subject_id text not null references shadow_subjects(subject_id),
  source text not null,
  edge_kind text not null,
  truth_status text not null,
  observed_at timestamptz not null,
  evidence_ref text,
  data jsonb not null default '{}'::jsonb
);

create index if not exists shadow_edges_subject_time_idx
  on shadow_edges (subject_id, observed_at desc);

create table if not exists shadow_divergences (
  divergence_id text primary key,
  community_id text not null,
  subject_id text not null references shadow_subjects(subject_id),
  divergence_kind text not null,
  incumbent_roles jsonb not null,
  freeside_roles jsonb not null,
  reason text not null,
  observed_at timestamptz not null,
  resolved_at timestamptz
);

create table if not exists shadow_snapshots (
  snapshot_id text primary key,
  community_id text not null,
  snapshot_at timestamptz not null,
  summary jsonb not null
);

create table if not exists shadow_reports (
  report_id text primary key,
  community_id text not null,
  report_kind text not null,
  generated_at timestamptz not null,
  summary jsonb not null,
  caveats jsonb not null default '[]'::jsonb
);
