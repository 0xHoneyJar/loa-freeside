-- SPICE Economy Schema
-- Adapted from CubQuests resource mutation pattern

-- =============================================================================
-- User SPICE Balance Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.user_spice (
  user_address text PRIMARY KEY,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),

  -- Lifecycle tracking
  total_earned integer NOT NULL DEFAULT 0,
  total_spent integer NOT NULL DEFAULT 0,

  -- Loss tracking (for tier calculation)
  total_loss_usd integer NOT NULL DEFAULT 0,
  tier integer NOT NULL DEFAULT 0,

  -- Timestamps
  created_at timestamptz DEFAULT timezone('utc', now()),
  updated_at timestamptz DEFAULT timezone('utc', now())
);

-- Index for leaderboard/tier queries
CREATE INDEX IF NOT EXISTS user_spice_tier_idx
  ON public.user_spice (tier DESC, total_loss_usd DESC);

CREATE INDEX IF NOT EXISTS user_spice_balance_idx
  ON public.user_spice (balance DESC);

-- =============================================================================
-- SPICE Transaction Log (Immutable Audit Trail)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.spice_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  user_address text NOT NULL,

  -- Mutation details
  amount integer NOT NULL,  -- signed: positive=grant, negative=spend
  balance_after integer NOT NULL,  -- snapshot after mutation

  -- Context
  source_type text NOT NULL,  -- e.g. 'losers_claim', 'store_purchase'
  source_id text,  -- reference to what caused it
  metadata jsonb DEFAULT '{}',

  -- Idempotency
  idempotency_key uuid,

  -- Audit
  authorizer text DEFAULT 'system',
  created_at timestamptz DEFAULT timezone('utc', now()),

  -- Foreign key (deferred for upsert pattern)
  CONSTRAINT fk_user_spice FOREIGN KEY (user_address)
    REFERENCES public.user_spice(user_address)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED
);

-- Idempotency constraint - prevents duplicate transactions
CREATE UNIQUE INDEX IF NOT EXISTS spice_transactions_idempotency_idx
  ON public.spice_transactions (user_address, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Query performance
CREATE INDEX IF NOT EXISTS spice_transactions_user_idx
  ON public.spice_transactions (user_address, created_at DESC);

CREATE INDEX IF NOT EXISTS spice_transactions_source_idx
  ON public.spice_transactions (source_type, created_at DESC);

-- =============================================================================
-- Wallet Mappings (Discord <-> Wallet)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.wallet_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  discord_user_id text UNIQUE NOT NULL,
  wallet_address text NOT NULL,
  verified_at timestamptz DEFAULT timezone('utc', now()),
  created_at timestamptz DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS wallet_mappings_address_idx
  ON public.wallet_mappings (wallet_address);

-- =============================================================================
-- Core RPC: apply_spice_mutation
-- Atomic transaction with idempotency, locking, and validation
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_spice_mutation(
  p_user_address text,
  p_amount integer,  -- positive = grant, negative = spend
  p_source_type text,
  p_source_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}',
  p_idempotency_key uuid DEFAULT NULL,
  p_authorizer text DEFAULT 'system'
)
RETURNS TABLE(
  balance integer,
  total_earned integer,
  total_spent integer,
  transaction_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := lower(p_user_address);
  v_existing record;
  v_new_balance integer;
  v_tx_id uuid;
BEGIN
  -- Idempotency check: if we've already processed this key, return cached result
  IF p_idempotency_key IS NOT NULL THEN
    SELECT st.balance_after, st.transaction_id INTO v_new_balance, v_tx_id
    FROM public.spice_transactions st
    WHERE st.user_address = v_user
      AND st.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      -- Already processed, return current state
      RETURN QUERY
        SELECT us.balance, us.total_earned, us.total_spent, v_tx_id
        FROM public.user_spice us
        WHERE us.user_address = v_user;
      RETURN;
    END IF;
  END IF;

  -- Ensure user exists (upsert pattern)
  INSERT INTO public.user_spice (user_address)
  VALUES (v_user)
  ON CONFLICT (user_address) DO NOTHING;

  -- Lock user row for update (prevents race conditions)
  SELECT * INTO v_existing
  FROM public.user_spice
  WHERE user_address = v_user
  FOR UPDATE;

  -- Calculate new balance
  v_new_balance := v_existing.balance + p_amount;

  -- Validate: no negative balances
  IF v_new_balance < 0 THEN
    RAISE EXCEPTION 'spice-insufficient-balance'
      USING HINT = format('Attempted to spend %s but only have %s', -p_amount, v_existing.balance);
  END IF;

  -- Update balance and lifecycle counters
  UPDATE public.user_spice
  SET
    balance = v_new_balance,
    total_earned = total_earned + GREATEST(p_amount, 0),
    total_spent = total_spent + GREATEST(-p_amount, 0),
    updated_at = timezone('utc', now())
  WHERE user_address = v_user;

  -- Insert transaction record (immutable audit log)
  INSERT INTO public.spice_transactions (
    user_address,
    amount,
    balance_after,
    source_type,
    source_id,
    metadata,
    idempotency_key,
    authorizer
  ) VALUES (
    v_user,
    p_amount,
    v_new_balance,
    p_source_type,
    p_source_id,
    p_metadata,
    p_idempotency_key,
    p_authorizer
  )
  RETURNING spice_transactions.transaction_id INTO v_tx_id;

  -- Return new state
  RETURN QUERY
    SELECT us.balance, us.total_earned, us.total_spent, v_tx_id
    FROM public.user_spice us
    WHERE us.user_address = v_user;
END;
$$;

-- =============================================================================
-- Specialized RPC: claim_loser_spice
-- Claims SPICE from Losers campaign with tier assignment
-- =============================================================================
CREATE OR REPLACE FUNCTION public.claim_loser_spice(
  p_user_address text,
  p_loss_usd integer,
  p_idempotency_key uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS TABLE(
  balance integer,
  tier integer,
  tier_name text,
  transaction_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user text := lower(p_user_address);
  v_tier integer;
  v_tier_name text;
  v_result record;
BEGIN
  -- Calculate tier based on loss amount
  v_tier := CASE
    WHEN p_loss_usd >= 100000 THEN 5  -- Kwisatz Haderach
    WHEN p_loss_usd >= 50000 THEN 4   -- Naib
    WHEN p_loss_usd >= 10000 THEN 3   -- Fedaykin
    WHEN p_loss_usd >= 1000 THEN 2    -- Fremen
    WHEN p_loss_usd >= 100 THEN 1     -- Outsider
    ELSE 0                             -- Tourist
  END;

  v_tier_name := CASE v_tier
    WHEN 5 THEN 'Kwisatz Haderach'
    WHEN 4 THEN 'Naib'
    WHEN 3 THEN 'Fedaykin'
    WHEN 2 THEN 'Fremen'
    WHEN 1 THEN 'Outsider'
    ELSE 'Tourist'
  END;

  -- Apply mutation (grants SPICE equal to loss USD)
  SELECT * INTO v_result
  FROM public.apply_spice_mutation(
    p_user_address := v_user,
    p_amount := p_loss_usd,
    p_source_type := 'losers_claim',
    p_source_id := NULL,
    p_metadata := p_metadata || jsonb_build_object(
      'loss_usd', p_loss_usd,
      'tier', v_tier,
      'tier_name', v_tier_name
    ),
    p_idempotency_key := p_idempotency_key,
    p_authorizer := 'losers_campaign'
  );

  -- Update tier and loss tracking (only upgrade tier, never downgrade)
  UPDATE public.user_spice
  SET
    tier = GREATEST(user_spice.tier, v_tier),
    total_loss_usd = total_loss_usd + p_loss_usd
  WHERE user_address = v_user;

  RETURN QUERY
    SELECT v_result.balance, v_tier, v_tier_name, v_result.transaction_id;
END;
$$;

-- =============================================================================
-- Helper: get_spice_leaderboard
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_spice_leaderboard(
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  rank bigint,
  user_address text,
  balance integer,
  tier integer,
  total_loss_usd integer
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY us.total_loss_usd DESC) as rank,
    us.user_address,
    us.balance,
    us.tier,
    us.total_loss_usd
  FROM public.user_spice us
  WHERE us.total_loss_usd > 0
  ORDER BY us.total_loss_usd DESC
  LIMIT p_limit;
$$;

-- =============================================================================
-- Helper: get_campaign_stats
-- =============================================================================
CREATE OR REPLACE FUNCTION public.get_campaign_stats()
RETURNS TABLE(
  total_losers bigint,
  total_loss_usd bigint,
  total_spice_claimed bigint,
  tier_distribution jsonb
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*)::bigint as total_losers,
    COALESCE(SUM(total_loss_usd), 0)::bigint as total_loss_usd,
    COALESCE(SUM(total_earned), 0)::bigint as total_spice_claimed,
    jsonb_build_object(
      'tourist', COUNT(*) FILTER (WHERE tier = 0),
      'outsider', COUNT(*) FILTER (WHERE tier = 1),
      'fremen', COUNT(*) FILTER (WHERE tier = 2),
      'fedaykin', COUNT(*) FILTER (WHERE tier = 3),
      'naib', COUNT(*) FILTER (WHERE tier = 4),
      'kwisatz_haderach', COUNT(*) FILTER (WHERE tier = 5)
    ) as tier_distribution
  FROM public.user_spice
  WHERE total_loss_usd > 0;
$$;

-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE public.user_spice ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spice_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_mappings ENABLE ROW LEVEL SECURITY;

-- Public read for leaderboards and verification
CREATE POLICY "Public read for user_spice"
  ON public.user_spice FOR SELECT
  USING (true);

CREATE POLICY "Public read for spice_transactions"
  ON public.spice_transactions FOR SELECT
  USING (true);

-- Wallet mappings readable by owner
CREATE POLICY "Users can read own wallet mappings"
  ON public.wallet_mappings FOR SELECT
  USING (true);

-- Writes only via RPC (SECURITY DEFINER functions bypass RLS)

-- =============================================================================
-- Grants
-- =============================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.user_spice TO anon, authenticated;
GRANT SELECT ON public.spice_transactions TO anon, authenticated;
GRANT SELECT ON public.wallet_mappings TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_spice_mutation TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_loser_spice TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_spice_leaderboard TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_campaign_stats TO anon, authenticated;
