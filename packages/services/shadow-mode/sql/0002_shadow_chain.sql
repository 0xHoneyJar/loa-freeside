-- Hash chain over shadow_observations (SDD sandwich-line §6a/§6b-2).
-- Chain identity = community_id. Ordering = store-assigned monotonic seq
-- (computed INSIDE the append transaction under an advisory xact lock —
-- never pre-allocated, so a failed transaction leaves no gap).

create table if not exists shadow_chain (
  chain_id text not null,
  seq bigint not null,
  event_id text not null unique references shadow_observations(event_id),
  prev_hash text not null,
  hash text not null,
  chain_version text not null,
  created_at timestamptz not null default now(),
  primary key (chain_id, seq)
);

-- Freeze / operator-clear history. APPEND-ONLY by convention: the application
-- exposes no UPDATE except setting cleared_* on the newest row, and no DELETE.
-- (loa:shortcut: a db superuser can still mutate rows; move admin audit onto
-- the hash chain itself when the chain hosts system events.)
create table if not exists shadow_chain_state (
  id bigserial primary key,
  chain_id text not null,
  frozen_at timestamptz not null default now(),
  frozen_reason text not null,
  first_bad_seq bigint not null,
  cleared_at timestamptz,
  cleared_by text,
  clear_rationale text
);

create index if not exists shadow_chain_state_chain_idx
  on shadow_chain_state (chain_id, id desc);
