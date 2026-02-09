-- Budget Finalization Script (Idempotent)
-- Sprint S3-T2 + S8-T3: Move cost from reserved→committed with idempotency marker
--
-- Handles three cases:
-- 1. Normal finalize: reservation exists, we claim it → move reserved→committed
-- 2. Late finalize: reservation already claimed by reaper → add directly to committed
-- 3. Already finalized: finalization marker exists → return ALREADY_FINALIZED
--
-- Race condition fix (S8-T3): Uses DEL return value as atomic claim signal.
-- Within this EVALSHA, HGET+DEL is atomic. Between EVALSHA calls (finalize vs reaper),
-- only one DEL can return 1 for a given key — that script "wins" the right to DECRBY.
--
-- @see SDD §8.3 Budget Finalization Script

-- KEYS[1] = agent:budget:committed:{community_id}:{month}
-- KEYS[2] = agent:budget:reserved:{community_id}:{month}
-- KEYS[3] = agent:budget:reservation:{community_id}:{user_id}:{idempotency_key}
-- KEYS[4] = agent:budget:expiry:{community_id}:{month}
-- KEYS[5] = agent:budget:finalized:{community_id}:{user_id}:{idempotency_key}
-- ARGV[1] = actualCost (cents, integer — clamped to >= 0)
-- ARGV[2] = userId:idempotencyKey (for ZREM from expiry set)

local actualCost = tonumber(ARGV[1])
local expiryMember = ARGV[2]

-- Validate inputs
if not expiryMember then
  return {'INVALID_INPUT', '0'}
end
if not actualCost then
  actualCost = 0
else
  if actualCost < 0 then actualCost = 0 end
  actualCost = math.floor(actualCost)
end

-- 1. Idempotency: check finalized marker first (SKP-002)
local alreadyFinalized = redis.call('EXISTS', KEYS[5])
if alreadyFinalized == 1 then
  return {'ALREADY_FINALIZED', '0'}
end

local monthlyTtlMs = 35 * 24 * 60 * 60 * 1000

-- 2. Claim the reservation atomically: read estimated_cost, then DEL to claim
-- HGET + DEL within a single EVALSHA is atomic (no other script can interleave).
-- DEL returns 1 if we deleted the key (we won the claim), 0 if already gone.
local estimatedCostRaw = redis.call('HGET', KEYS[3], 'estimated_cost')
local claimed = redis.call('DEL', KEYS[3])

if claimed == 1 then
  -- Normal finalize: we claimed the reservation → DECRBY reserved, INCRBY committed
  local estimatedCost = tonumber(estimatedCostRaw) or 0
  if estimatedCost < 0 then estimatedCost = 0 end
  estimatedCost = math.floor(estimatedCost)

  -- Decrement reserved by estimated cost (only we can do this — we won the claim)
  redis.call('DECRBY', KEYS[2], estimatedCost)
  -- Safety clamp: reserved should never go negative with claim-via-DEL,
  -- but clamp as defense-in-depth and log if it happens
  local reserved = tonumber(redis.call('GET', KEYS[2]) or '0') or 0
  if reserved < 0 then
    redis.log(redis.LOG_WARNING, 'ACCOUNTING_DRIFT finalize community=' .. ARGV[2] .. ' drift_cents=' .. tostring(math.abs(reserved)) .. ' operation=finalize')
    redis.call('SET', KEYS[2], '0')
    redis.call('PEXPIRE', KEYS[2], monthlyTtlMs)
  end

  -- Increment committed by actual cost
  redis.call('INCRBY', KEYS[1], actualCost)
  redis.call('PEXPIRE', KEYS[1], monthlyTtlMs)
  redis.call('PEXPIRE', KEYS[2], monthlyTtlMs)

  -- Clean up expiry member
  redis.call('ZREM', KEYS[4], expiryMember)

  -- Set finalized marker (24h TTL)
  redis.call('SET', KEYS[5], actualCost, 'PX', 24 * 60 * 60 * 1000)

  return {'FINALIZED', tostring(actualCost)}
else
  -- Late finalize: reservation already claimed by reaper (or never existed).
  -- Reaper already decremented reserved, so we only add actual cost to committed.
  redis.call('INCRBY', KEYS[1], actualCost)
  redis.call('PEXPIRE', KEYS[1], monthlyTtlMs)

  -- Clean up expiry member (might still be there if reaper hasn't run yet)
  redis.call('ZREM', KEYS[4], expiryMember)

  -- Set finalized marker (24h TTL)
  redis.call('SET', KEYS[5], actualCost, 'PX', 24 * 60 * 60 * 1000)

  return {'LATE_FINALIZE', tostring(actualCost)}
end
