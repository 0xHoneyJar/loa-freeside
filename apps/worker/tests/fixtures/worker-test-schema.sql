-- Test schema for EventNatsConsumer integration tests.
-- Creates the tables consumed by apps/worker/src/data/database.ts.
-- Matches the Drizzle schema in apps/worker/src/data/schema.ts.
-- Run against a fresh Postgres instance before executing the worker test suite.

-- communities -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS communities (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text        NOT NULL,
  theme_id          text        NOT NULL DEFAULT 'basic',
  subscription_tier text        NOT NULL DEFAULT 'free',
  discord_guild_id  text        UNIQUE,
  telegram_chat_id  text        UNIQUE,
  is_active         boolean     NOT NULL DEFAULT true,
  settings          jsonb       DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_communities_theme
  ON communities(theme_id);
CREATE INDEX IF NOT EXISTS idx_communities_discord_guild
  ON communities(discord_guild_id);
CREATE INDEX IF NOT EXISTS idx_communities_subscription
  ON communities(subscription_tier);

-- profiles --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id     uuid        NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  discord_id       text,
  telegram_id      text,
  wallet_address   text,
  tier             text,
  current_rank     integer,
  activity_score   integer     NOT NULL DEFAULT 0,
  conviction_score integer     NOT NULL DEFAULT 0,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  first_claim_at   timestamptz,
  metadata         jsonb       DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_profiles_discord  UNIQUE(community_id, discord_id),
  CONSTRAINT uq_profiles_telegram UNIQUE(community_id, telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_profiles_community
  ON profiles(community_id);
CREATE INDEX IF NOT EXISTS idx_profiles_wallet
  ON profiles(wallet_address);
CREATE INDEX IF NOT EXISTS idx_profiles_tier
  ON profiles(community_id, tier);
CREATE INDEX IF NOT EXISTS idx_profiles_rank
  ON profiles(community_id, current_rank);
