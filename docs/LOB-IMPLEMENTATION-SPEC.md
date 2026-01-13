# Losers of Berachain - Implementation Specification

> **Version:** V4 Final
> **Scope:** Experience layer (frontend + games logic)
> **API:** Consumed externally

---

## 1. Claude CLI Prompt

```
You are implementing "Losers of Berachain" (LOB) - a viral campaign that transforms Berachain wallet losses into social currency.

## Project Context
- Next.js 14 app router
- Tailwind CSS + Framer Motion
- wagmi/viem for wallet
- External API for credits/game state (we consume, not manage)
- Discord Social SDK (embedded, server-cached)

## Core User Flow
1. Landing → Wall of Pain preview, 1 BERA fee disclosed
2. Connect → Wallet + optional Discord OAuth
3. Reveal → API calculates losses, dramatic ceremony with skip option
4. Mint → 1 BERA NFT via Crayons ERC721Base contract
5. Community → Friends list, daily game, async challenges

## Games Layer (Critical Requirements)
- Daily "Bigger Loser": Per-user randomized seed (NOT global daily seed)
  - Seed = hash(user_id + date + server_salt)
  - Progressive reveal: card amounts shown AFTER pick submitted
  - Prevents community "answer key" sharing
- Async Ghost Challenges: Both play same seed, compare later
  - 3/week cap per unique friend pair (anti-collusion)
  - 48h timeout then expires
- Notifications: 3/day max (Discord SDK rate limit safe)

## Anti-Exploit Mitigations
- Per-user seeds (no community solving)
- Progressive reveal (no scraping)
- Pairing caps (no credit laundering)
- Notification throttle (no spam)

## API Endpoints We Consume
- GET /api/loser/calculate?address={wallet}
- POST /api/loser/claim
- GET /api/loser/credits?address={wallet}
- GET /api/game/daily-seed?user_id={id}
- POST /api/game/submit-results
- POST /api/game/challenge/create
- GET /api/game/challenge/{id}
- GET /api/game/challenge-limits?user_id={id}

## File Structure
app/
├── losers/
│   ├── page.tsx              # Landing + Wall of Pain
│   ├── reveal/page.tsx       # Ceremony flow
│   ├── claim/page.tsx        # Mint + brag
│   └── community/page.tsx    # Friends + games
├── components/
│   ├── LoserCard.tsx         # Card display (exists)
│   ├── RevealCeremony.tsx    # Animated reveal
│   ├── BiggerLoser.tsx       # A/B game
│   ├── ChallengeGame.tsx     # Async challenges
│   └── FriendsSheet.tsx      # Mobile bottom sheet
├── hooks/
│   ├── useLoserData.ts       # API: calculate/claim
│   ├── useDailyGame.ts       # API: per-user seed
│   └── useChallenges.ts      # API: async challenges
└── lib/
    └── api.ts                # API client

## UX Requirements
- Skip button on reveal ceremony
- prefers-reduced-motion support
- 44px minimum tap targets (mobile)
- Empty states: 0 friends, API timeout, already played
- Fee disclosed on landing (not hidden until mint)

## Tech Constraints
- No real-time WebSockets (killed - mobile fragile)
- Server-cache Discord friends (not per-page-load)
- Async everything (ghost system for challenges)

Implement Phase 1: Core Flow (landing, reveal, mint, credits display).
```

---

## 2. Architectural Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js)                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PAGES                                                                       │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  /losers   │  │  /reveal   │  │  /claim    │  │ /community │            │
│  │            │  │            │  │            │  │            │            │
│  │ • Hero     │  │ • Timeline │  │ • Mint TX  │  │ • Friends  │            │
│  │ • Stats    │  │ • Loss $   │  │ • Brag btn │  │ • Games    │            │
│  │ • Wall     │  │ • Tier     │  │ • Credits  │  │ • Leaders  │            │
│  │ • CTA      │  │ • Skip     │  │            │  │            │            │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘            │
│        │              │               │               │                     │
│        └──────────────┴───────────────┴───────────────┘                     │
│                              │                                               │
│  SHARED COMPONENTS          │                                               │
│  ┌──────────────────────────┴──────────────────────────┐                   │
│  │                                                      │                   │
│  │  LoserCard    RevealCeremony    BiggerLoser         │                   │
│  │  FriendsSheet ChallengeGame     WalletButton        │                   │
│  │                                                      │                   │
│  └──────────────────────────────────────────────────────┘                   │
│                              │                                               │
│  HOOKS (React Query)        │                                               │
│  ┌──────────────────────────┴──────────────────────────┐                   │
│  │                                                      │                   │
│  │  useLoserData()  useDailyGame()  useChallenges()    │                   │
│  │  useCredits()    useFriends()    useLeaderboard()   │                   │
│  │                                                      │                   │
│  └──────────────────────────────────────────────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL API                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  LOSER ENDPOINTS                    GAME ENDPOINTS                          │
│  ┌─────────────────────────┐       ┌─────────────────────────┐             │
│  │ GET  /calculate         │       │ GET  /daily-seed        │             │
│  │ POST /claim             │       │ POST /submit-results    │             │
│  │ GET  /credits           │       │ POST /challenge/create  │             │
│  │ GET  /leaderboard       │       │ GET  /challenge/{id}    │             │
│  │ GET  /friends           │       │ GET  /challenge-limits  │             │
│  └─────────────────────────┘       └─────────────────────────┘             │
│                                                                              │
│  GAME LOGIC (Server-Side)                                                   │
│  ┌──────────────────────────────────────────────────────────────┐          │
│  │ • Per-user seed: hash(user_id + date + salt)                 │          │
│  │ • Progressive reveal: answers after pick                      │          │
│  │ • Pairing caps: 3/week per friend pair                        │          │
│  │ • Challenge timeout: 48h expiry                               │          │
│  └──────────────────────────────────────────────────────────────┘          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BLOCKCHAIN                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Crayons ERC721Base                 ControllerV1                            │
│  ┌─────────────────────────┐       ┌─────────────────────────┐             │
│  │ mint() — 1 BERA         │  ──▶  │ distribute()            │             │
│  │ maxSupply: 0 (open)     │       │ 4.2% platform fee       │             │
│  │ tokenURI: dynamic       │       │ 95.8% to treasury       │             │
│  └─────────────────────────┘       └─────────────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
USER ACTION                 FRONTEND                    API
───────────────────────────────────────────────────────────────────────────

1. LANDING
   Visit /losers      →    Fetch stats           →    GET /leaderboard
                      ←    Render Wall of Pain   ←    { losers, total }

2. CONNECT
   Click "Check"      →    Wallet connect        →    (local)
                      →    Fetch losses          →    GET /calculate?addr
                      ←    Store in state        ←    { loss_usd, tier }

3. REVEAL
   View ceremony      →    Animate timeline      →    (local state)
   Click "Skip"       →    Jump to results       →    (local)

4. MINT
   Click "Mint"       →    Send TX               →    ERC721Base.mint()
                      ←    Wait confirmation     ←    tx_hash
                      →    Record claim          →    POST /claim
                      ←    Get credits           ←    { credits, rank }

5. DAILY GAME
   Open game          →    Fetch seed            →    GET /daily-seed?uid
                      ←    Render round 1        ←    { cardA, cardB } (no $)
   Pick A             →    Submit pick           →    (local state)
                      ←    Reveal amounts        ←    (local calculation)
   Complete 5 rounds  →    Submit all            →    POST /submit-results
                      ←    Get credits           ←    { score, credits }

6. CHALLENGE
   Click friend       →    Check limits          →    GET /challenge-limits
                      ←    Show "Challenge"      ←    { remaining: 2 }
   Start challenge    →    Create                →    POST /challenge/create
                      ←    Get seed              ←    { challenge_id, seed }
   Play 5 rounds      →    Submit                →    POST /submit-results
   Friend plays       →    (async)               →    (same seed)
   View results       →    Fetch                 →    GET /challenge/{id}
                      ←    Show winner           ←    { winner, credits }
```

### State Management

```typescript
// Global state (React Context or Zustand)
interface LoserState {
  // User data
  wallet: Address | null;
  discordId: string | null;

  // Claim data (from API)
  lossUsd: number | null;
  tier: TierInfo | null;
  credits: number;
  rank: number | null;

  // Claim flow
  claimStatus: 'idle' | 'calculating' | 'revealed' | 'minting' | 'claimed';
  nftTxHash: string | null;

  // Game state (local until submit)
  dailyGame: {
    seed: string | null;
    rounds: Round[];
    currentRound: number;
    picks: ('A' | 'B')[];
    completed: boolean;
  };

  // Challenge state
  activeChallenge: {
    id: string;
    opponentId: string;
    seed: string;
    myPicks: ('A' | 'B')[];
    status: 'playing' | 'waiting' | 'complete';
  } | null;
}
```

---

## 3. Reference Implementation

### API Client (`lib/api.ts`)

```typescript
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export interface LoserData {
  loss_usd: number;
  tier: number;
  tier_name: string;
  timeline: TimelineEvent[];
}

export interface DailySeed {
  seed_hash: string;
  rounds: Array<{
    cardA: { id: string; tier: string };  // no loss_usd until revealed
    cardB: { id: string; tier: string };
  }>;
}

export interface GameResult {
  score: number;
  credits_earned: number;
  answers: ('A' | 'B')[];  // correct answers for reveal
  amounts: Array<{ a: number; b: number }>;  // loss amounts
}

export interface Challenge {
  id: string;
  challenger_id: string;
  challenged_id: string;
  seed_hash: string;
  status: 'pending' | 'active' | 'complete' | 'expired';
  challenger_score?: number;
  challenged_score?: number;
  winner_id?: string;
  expires_at: string;
}

export const api = {
  // Loser endpoints
  async calculate(address: string): Promise<LoserData> {
    const res = await fetch(`${API_BASE}/loser/calculate?address=${address}`);
    if (!res.ok) throw new Error('Failed to calculate losses');
    return res.json();
  },

  async claim(address: string, nftTxHash: string, discordId?: string): Promise<{ credits: number; rank: number }> {
    const res = await fetch(`${API_BASE}/loser/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, nft_tx_hash: nftTxHash, discord_id: discordId }),
    });
    if (!res.ok) throw new Error('Failed to claim');
    return res.json();
  },

  async getCredits(address: string): Promise<{ credits: number }> {
    const res = await fetch(`${API_BASE}/loser/credits?address=${address}`);
    if (!res.ok) throw new Error('Failed to fetch credits');
    return res.json();
  },

  // Game endpoints
  async getDailySeed(userId: string): Promise<DailySeed> {
    const res = await fetch(`${API_BASE}/game/daily-seed?user_id=${userId}`);
    if (!res.ok) throw new Error('Failed to fetch daily seed');
    return res.json();
  },

  async submitDailyResults(userId: string, seedHash: string, picks: ('A' | 'B')[]): Promise<GameResult> {
    const res = await fetch(`${API_BASE}/game/submit-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, seed_hash: seedHash, picks }),
    });
    if (!res.ok) throw new Error('Failed to submit results');
    return res.json();
  },

  // Challenge endpoints
  async getChallengeLimits(userId: string, friendId: string): Promise<{ remaining: number; resets_at: string }> {
    const res = await fetch(`${API_BASE}/game/challenge-limits?user_id=${userId}&friend_id=${friendId}`);
    if (!res.ok) throw new Error('Failed to fetch limits');
    return res.json();
  },

  async createChallenge(challengerId: string, challengedId: string): Promise<{ challenge_id: string; seed: DailySeed }> {
    const res = await fetch(`${API_BASE}/game/challenge/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenger_id: challengerId, challenged_id: challengedId }),
    });
    if (!res.ok) throw new Error('Failed to create challenge');
    return res.json();
  },

  async getChallenge(challengeId: string): Promise<Challenge> {
    const res = await fetch(`${API_BASE}/game/challenge/${challengeId}`);
    if (!res.ok) throw new Error('Failed to fetch challenge');
    return res.json();
  },

  async submitChallengeResults(challengeId: string, userId: string, picks: ('A' | 'B')[]): Promise<GameResult> {
    const res = await fetch(`${API_BASE}/game/challenge/${challengeId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, picks }),
    });
    if (!res.ok) throw new Error('Failed to submit challenge results');
    return res.json();
  },
};
```

### Daily Game Hook (`hooks/useDailyGame.ts`)

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, DailySeed, GameResult } from '@/lib/api';

interface UseDailyGameOptions {
  userId: string;
}

export function useDailyGame({ userId }: UseDailyGameOptions) {
  const [currentRound, setCurrentRound] = useState(0);
  const [picks, setPicks] = useState<('A' | 'B')[]>([]);
  const [revealedAmounts, setRevealedAmounts] = useState<Array<{ a: number; b: number }>>([]);
  const [gameResult, setGameResult] = useState<GameResult | null>(null);

  // Fetch per-user seed
  const { data: seed, isLoading: seedLoading, error: seedError } = useQuery({
    queryKey: ['daily-seed', userId],
    queryFn: () => api.getDailySeed(userId),
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  // Submit results mutation
  const submitMutation = useMutation({
    mutationFn: (finalPicks: ('A' | 'B')[]) =>
      api.submitDailyResults(userId, seed!.seed_hash, finalPicks),
    onSuccess: (result) => {
      setGameResult(result);
      setRevealedAmounts(result.amounts);
    },
  });

  // Pick a card for current round
  const pick = useCallback((choice: 'A' | 'B') => {
    if (!seed || currentRound >= 5) return;

    const newPicks = [...picks, choice];
    setPicks(newPicks);

    if (currentRound < 4) {
      // More rounds to go
      setCurrentRound(currentRound + 1);
    } else {
      // Final round - submit all picks
      submitMutation.mutate(newPicks);
    }
  }, [seed, currentRound, picks, submitMutation]);

  // Reset game (for testing or new day)
  const reset = useCallback(() => {
    setCurrentRound(0);
    setPicks([]);
    setRevealedAmounts([]);
    setGameResult(null);
  }, []);

  return {
    // State
    seed,
    currentRound,
    picks,
    revealedAmounts,
    gameResult,

    // Computed
    isLoading: seedLoading,
    error: seedError,
    isComplete: gameResult !== null,
    currentCards: seed?.rounds[currentRound] ?? null,

    // Actions
    pick,
    reset,
    isSubmitting: submitMutation.isPending,
  };
}
```

### Bigger Loser Component (`components/BiggerLoser.tsx`)

```typescript
'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useDailyGame } from '@/hooks/useDailyGame';

interface BiggerLoserProps {
  userId: string;
}

export function BiggerLoser({ userId }: BiggerLoserProps) {
  const {
    currentRound,
    picks,
    revealedAmounts,
    gameResult,
    isLoading,
    isComplete,
    currentCards,
    pick,
    isSubmitting,
  } = useDailyGame({ userId });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#6b6245]">Loading today's game...</div>
      </div>
    );
  }

  if (isComplete && gameResult) {
    return (
      <div className="text-center p-8">
        <h2 className="text-2xl font-[family-name:var(--font-adhesion)] text-[#e8ddb5] mb-4">
          Game Complete!
        </h2>
        <div className="text-4xl text-[#f4a460] mb-2">
          {gameResult.score}/5
        </div>
        <div className="text-[#6b6245]">
          +{gameResult.credits_earned} credits
        </div>

        {/* Show all rounds with results */}
        <div className="mt-8 space-y-2">
          {gameResult.answers.map((answer, i) => (
            <div key={i} className="flex items-center justify-center gap-4 text-sm">
              <span className={picks[i] === answer ? 'text-green-500' : 'text-red-500'}>
                Round {i + 1}: You picked {picks[i]}, correct was {answer}
              </span>
              <span className="text-[#6b6245]">
                (${revealedAmounts[i]?.a.toLocaleString()} vs ${revealedAmounts[i]?.b.toLocaleString()})
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-xl font-[family-name:var(--font-adhesion)] text-[#e8ddb5]">
          BIGGER LOSER
        </h2>
        <p className="text-[#6b6245] text-sm">
          Round {currentRound + 1} of 5 — Who lost more?
        </p>
      </div>

      {/* Cards */}
      {currentCards && (
        <div className="flex justify-center gap-8">
          <CardOption
            label="A"
            tier={currentCards.cardA.tier}
            onClick={() => pick('A')}
            disabled={isSubmitting}
          />
          <div className="flex items-center text-[#6b6245] text-2xl">VS</div>
          <CardOption
            label="B"
            tier={currentCards.cardB.tier}
            onClick={() => pick('B')}
            disabled={isSubmitting}
          />
        </div>
      )}

      {/* Streak indicator */}
      <div className="text-center mt-8">
        <div className="text-[#6b6245] text-sm">
          Picks: {picks.map((p, i) => (
            <span key={i} className="mx-1">{p}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface CardOptionProps {
  label: string;
  tier: string;
  onClick: () => void;
  disabled: boolean;
}

function CardOption({ label, tier, onClick, disabled }: CardOptionProps) {
  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      disabled={disabled}
      className={`
        w-32 h-44 rounded-lg border-2 border-[#6b6245]/30
        bg-gradient-to-br from-[#1a1510] to-[#0a0a0a]
        flex flex-col items-center justify-center
        transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#f4a460]/50 cursor-pointer'}
      `}
    >
      <div className="text-4xl font-[family-name:var(--font-adhesion)] text-[#e8ddb5]">
        {label}
      </div>
      <div className="text-[#6b6245] text-xs mt-2">
        {tier}
      </div>
      <div className="text-[#f4a460] text-lg mt-4">
        ???
      </div>
    </motion.button>
  );
}
```

### Challenge Hook (`hooks/useChallenges.ts`)

```typescript
'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, Challenge, GameResult } from '@/lib/api';

interface UseChallengesOptions {
  userId: string;
}

export function useChallenges({ userId }: UseChallengesOptions) {
  const queryClient = useQueryClient();
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [picks, setPicks] = useState<('A' | 'B')[]>([]);
  const [currentRound, setCurrentRound] = useState(0);

  // Check limits for a specific friend
  const checkLimits = useCallback(async (friendId: string) => {
    return api.getChallengeLimits(userId, friendId);
  }, [userId]);

  // Create challenge mutation
  const createMutation = useMutation({
    mutationFn: (challengedId: string) => api.createChallenge(userId, challengedId),
    onSuccess: (data) => {
      // Start playing immediately
      setActiveChallenge({
        id: data.challenge_id,
        challenger_id: userId,
        challenged_id: '',
        seed_hash: '',
        status: 'active',
        expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });
      setPicks([]);
      setCurrentRound(0);
    },
  });

  // Submit challenge results
  const submitMutation = useMutation({
    mutationFn: (finalPicks: ('A' | 'B')[]) =>
      api.submitChallengeResults(activeChallenge!.id, userId, finalPicks),
    onSuccess: () => {
      // Invalidate challenge query to refresh status
      queryClient.invalidateQueries({ queryKey: ['challenge', activeChallenge?.id] });
    },
  });

  // Pick for challenge round
  const pick = useCallback((choice: 'A' | 'B') => {
    if (!activeChallenge || currentRound >= 5) return;

    const newPicks = [...picks, choice];
    setPicks(newPicks);

    if (currentRound < 4) {
      setCurrentRound(currentRound + 1);
    } else {
      submitMutation.mutate(newPicks);
    }
  }, [activeChallenge, currentRound, picks, submitMutation]);

  // Fetch challenge status
  const fetchChallenge = useCallback(async (challengeId: string) => {
    const challenge = await api.getChallenge(challengeId);
    setActiveChallenge(challenge);
    return challenge;
  }, []);

  return {
    // State
    activeChallenge,
    currentRound,
    picks,

    // Actions
    checkLimits,
    createChallenge: createMutation.mutate,
    pick,
    fetchChallenge,

    // Loading states
    isCreating: createMutation.isPending,
    isSubmitting: submitMutation.isPending,
  };
}
```

### Reveal Ceremony (`components/RevealCeremony.tsx`)

```typescript
'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { LoserData } from '@/lib/api';
import type { TierInfo } from '@/types/spice';
import { getTierInfo } from '@/lib/tiers';

interface RevealCeremonyProps {
  data: LoserData;
  onComplete: () => void;
  onSkip: () => void;
}

type Stage = 'timeline' | 'loss' | 'tier' | 'complete';

export function RevealCeremony({ data, onComplete, onSkip }: RevealCeremonyProps) {
  const [stage, setStage] = useState<Stage>('timeline');
  const [displayedLoss, setDisplayedLoss] = useState(0);
  const shouldReduceMotion = useReducedMotion();

  const tierInfo = getTierInfo(data.loss_usd);

  // Auto-advance stages (unless reduced motion)
  useEffect(() => {
    if (shouldReduceMotion) {
      setStage('complete');
      setDisplayedLoss(data.loss_usd);
      return;
    }

    const timers: NodeJS.Timeout[] = [];

    if (stage === 'timeline') {
      timers.push(setTimeout(() => setStage('loss'), 3000));
    } else if (stage === 'loss') {
      // Animate counter
      const duration = 2000;
      const steps = 60;
      const increment = data.loss_usd / steps;
      let current = 0;

      const interval = setInterval(() => {
        current += increment;
        if (current >= data.loss_usd) {
          setDisplayedLoss(data.loss_usd);
          clearInterval(interval);
          setTimeout(() => setStage('tier'), 500);
        } else {
          setDisplayedLoss(Math.floor(current));
        }
      }, duration / steps);

      timers.push(interval as unknown as NodeJS.Timeout);
    } else if (stage === 'tier') {
      timers.push(setTimeout(() => {
        setStage('complete');
        onComplete();
      }, 2000));
    }

    return () => timers.forEach(t => clearTimeout(t));
  }, [stage, data.loss_usd, shouldReduceMotion, onComplete]);

  return (
    <div className="relative min-h-[400px] flex flex-col items-center justify-center">
      {/* Skip button - always visible */}
      <button
        onClick={() => {
          setStage('complete');
          setDisplayedLoss(data.loss_usd);
          onSkip();
        }}
        className="absolute top-4 right-4 text-[#6b6245] hover:text-[#e8ddb5] text-sm"
      >
        Skip →
      </button>

      <AnimatePresence mode="wait">
        {stage === 'timeline' && (
          <TimelineStage key="timeline" events={data.timeline} />
        )}

        {stage === 'loss' && (
          <LossStage key="loss" amount={displayedLoss} />
        )}

        {stage === 'tier' && (
          <TierStage key="tier" tier={tierInfo} lossUsd={data.loss_usd} />
        )}

        {stage === 'complete' && (
          <CompleteStage key="complete" tier={tierInfo} lossUsd={data.loss_usd} />
        )}
      </AnimatePresence>
    </div>
  );
}

function TimelineStage({ events }: { events: LoserData['timeline'] }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="text-center"
    >
      <h2 className="text-[#6b6245] text-sm uppercase tracking-wider mb-8">
        Your Berachain Journey
      </h2>
      <div className="space-y-4">
        {events.slice(0, 3).map((event, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.5 }}
            className="text-[#e8ddb5]"
          >
            <span className="text-[#6b6245]">{event.date}</span> — {event.description}
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}

function LossStage({ amount }: { amount: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0 }}
      className="text-center"
    >
      <div className="text-[#6b6245] text-lg mb-4">YOU HAVE LOST</div>
      <div className="text-5xl font-[family-name:var(--font-adhesion)] text-[#e8ddb5]">
        ${amount.toLocaleString()}
      </div>
      <div className="text-[#6b6245] text-lg mt-4">ON BERACHAIN</div>
    </motion.div>
  );
}

function TierStage({ tier, lossUsd }: { tier: TierInfo; lossUsd: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="text-center"
    >
      <div className="text-[#6b6245] text-sm mb-4">${lossUsd.toLocaleString()} LOST</div>
      <motion.div
        initial={{ scale: 0, rotate: -10 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', damping: 10 }}
        className="w-24 h-24 mx-auto flex items-center justify-center text-4xl font-[family-name:var(--font-adhesion)] text-black"
        style={{ backgroundColor: tier.color }}
      >
        {tier.name[0]}
      </motion.div>
      <div className="text-2xl font-[family-name:var(--font-adhesion)] text-[#e8ddb5] mt-4">
        {tier.name}
      </div>
      <div className="text-[#6b6245] italic">"{tier.title}"</div>
    </motion.div>
  );
}

function CompleteStage({ tier, lossUsd }: { tier: TierInfo; lossUsd: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="text-center"
    >
      <div
        className="w-20 h-20 mx-auto flex items-center justify-center text-3xl font-[family-name:var(--font-adhesion)] text-black mb-4"
        style={{ backgroundColor: tier.color }}
      >
        {tier.name[0]}
      </div>
      <div className="text-xl font-[family-name:var(--font-adhesion)] text-[#e8ddb5]">
        {tier.name}
      </div>
      <div className="text-[#6b6245] italic mb-4">"{tier.title}"</div>
      <div className="text-[#f4a460]">
        ◆ {lossUsd.toLocaleString()} SPICE awaits
      </div>
    </motion.div>
  );
}
```

### Friends Bottom Sheet (`components/FriendsSheet.tsx`)

```typescript
'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useChallenges } from '@/hooks/useChallenges';

interface Friend {
  discord_id: string;
  discord_username: string;
  discord_avatar?: string;
  claimed: boolean;
  loss_usd?: number;
  tier_name?: string;
}

interface FriendsSheetProps {
  userId: string;
  friends: Friend[];
  onInvite: (discordId: string) => void;
}

export function FriendsSheet({ userId, friends, onInvite }: FriendsSheetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedFriend, setSelectedFriend] = useState<Friend | null>(null);
  const { checkLimits, createChallenge, isCreating } = useChallenges({ userId });

  const claimedFriends = friends.filter(f => f.claimed);
  const unclaimedFriends = friends.filter(f => !f.claimed);

  const handleChallenge = async (friend: Friend) => {
    const limits = await checkLimits(friend.discord_id);
    if (limits.remaining > 0) {
      createChallenge(friend.discord_id);
    } else {
      alert(`Challenge limit reached. Resets ${new Date(limits.resets_at).toLocaleDateString()}`);
    }
  };

  return (
    <>
      {/* Toggle button (mobile) */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 md:hidden w-14 h-14 rounded-full bg-[#1a1510] border border-[#6b6245]/30 flex items-center justify-center text-[#e8ddb5] shadow-lg"
      >
        👥
      </button>

      {/* Sheet */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/50 z-40 md:hidden"
            />

            {/* Bottom sheet */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25 }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0a] border-t border-[#6b6245]/30 rounded-t-2xl max-h-[70vh] overflow-y-auto md:hidden"
            >
              {/* Handle */}
              <div className="flex justify-center py-3">
                <div className="w-10 h-1 bg-[#6b6245]/50 rounded-full" />
              </div>

              <div className="px-4 pb-8">
                <h3 className="text-[#e8ddb5] font-[family-name:var(--font-adhesion)] text-lg mb-4">
                  Friends
                </h3>

                {/* Claimed friends */}
                {claimedFriends.length > 0 && (
                  <div className="mb-6">
                    <div className="text-[#6b6245] text-xs uppercase mb-2">Claimed</div>
                    <div className="space-y-2">
                      {claimedFriends.map(friend => (
                        <FriendRow
                          key={friend.discord_id}
                          friend={friend}
                          onChallenge={() => handleChallenge(friend)}
                          isLoading={isCreating}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Unclaimed friends */}
                {unclaimedFriends.length > 0 && (
                  <div>
                    <div className="text-[#6b6245] text-xs uppercase mb-2">Invite</div>
                    <div className="space-y-2">
                      {unclaimedFriends.map(friend => (
                        <FriendRow
                          key={friend.discord_id}
                          friend={friend}
                          onInvite={() => onInvite(friend.discord_id)}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {friends.length === 0 && (
                  <div className="text-center text-[#6b6245] py-8">
                    No Discord friends found.<br />
                    Connect Discord to see friends.
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Desktop sidebar (always visible) */}
      <div className="hidden md:block fixed right-0 top-0 h-full w-64 bg-[#0a0a0a] border-l border-[#6b6245]/30 p-4 overflow-y-auto">
        <h3 className="text-[#e8ddb5] font-[family-name:var(--font-adhesion)] text-lg mb-4">
          Friends
        </h3>
        {/* Same content as mobile sheet */}
      </div>
    </>
  );
}

interface FriendRowProps {
  friend: Friend;
  onChallenge?: () => void;
  onInvite?: () => void;
  isLoading?: boolean;
}

function FriendRow({ friend, onChallenge, onInvite, isLoading }: FriendRowProps) {
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-[#1a1510]/50">
      {/* Avatar */}
      <div className="w-10 h-10 rounded-full bg-[#6b6245]/30 flex items-center justify-center text-sm">
        {friend.discord_avatar ? (
          <img src={friend.discord_avatar} alt="" className="w-full h-full rounded-full" />
        ) : (
          friend.discord_username[0].toUpperCase()
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[#e8ddb5] text-sm truncate">{friend.discord_username}</div>
        {friend.claimed ? (
          <div className="text-[#6b6245] text-xs">
            {friend.tier_name} • ${friend.loss_usd?.toLocaleString()}
          </div>
        ) : (
          <div className="text-[#6b6245] text-xs">Not claimed yet</div>
        )}
      </div>

      {/* Action */}
      {friend.claimed && onChallenge && (
        <button
          onClick={onChallenge}
          disabled={isLoading}
          className="px-3 py-1 text-xs bg-[#f4a460]/20 text-[#f4a460] rounded hover:bg-[#f4a460]/30 disabled:opacity-50 min-w-[70px]"
        >
          {isLoading ? '...' : 'Challenge'}
        </button>
      )}
      {!friend.claimed && onInvite && (
        <button
          onClick={onInvite}
          className="px-3 py-1 text-xs bg-[#6b6245]/20 text-[#6b6245] rounded hover:bg-[#6b6245]/30 min-w-[70px]"
        >
          Invite
        </button>
      )}
    </div>
  );
}
```

---

## Type Definitions (`types/game.ts`)

```typescript
export interface TimelineEvent {
  date: string;
  description: string;
  type: 'purchase' | 'lp' | 'drawdown' | 'governance' | 'other';
  amount_usd?: number;
}

export interface TierInfo {
  name: string;
  title: string;
  color: string;
  minLoss: number;
}

export interface Round {
  cardA: { id: string; tier: string; loss_usd?: number };
  cardB: { id: string; tier: string; loss_usd?: number };
}

export interface DailyGameState {
  seed_hash: string;
  rounds: Round[];
  current_round: number;
  picks: ('A' | 'B')[];
  completed: boolean;
  result?: {
    score: number;
    credits_earned: number;
  };
}

export interface ChallengeState {
  id: string;
  opponent_id: string;
  opponent_name: string;
  seed_hash: string;
  my_picks: ('A' | 'B')[];
  my_score?: number;
  opponent_score?: number;
  status: 'playing' | 'waiting' | 'won' | 'lost' | 'expired';
  expires_at: string;
}
```
