'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Wallet, DiscordLogo, ArrowRight, SpinnerGap } from '@phosphor-icons/react';
import { LoserCard } from '@/components/LoserCard';
import { useWallet } from '@/hooks/useWallet';
import { useCampaignStats, useClaimLoserSpice, useUserSpice } from '@/hooks/useSpice';
import { getTierByLoss } from '@/types/spice';
import { formatSpice } from '@/lib/spice/service';

type FlowState = 'connect' | 'loading' | 'preview' | 'claimed';

export default function LosersPage() {
  const { address, truncatedAddress, isConnected, connect } = useWallet();
  const [flowState, setFlowState] = useState<FlowState>('connect');
  const [lossAmount, setLossAmount] = useState<number>(0);

  // Fetch existing user data if connected
  const { data: userSpice, isLoading: isLoadingUser } = useUserSpice(address);

  // Fetch campaign stats
  const { data: stats } = useCampaignStats();

  // Claim mutation
  const claimMutation = useClaimLoserSpice();

  // Handle wallet connection state changes
  useEffect(() => {
    if (isConnected && address) {
      if (userSpice && userSpice.total_loss_usd > 0) {
        // User already claimed
        setLossAmount(userSpice.total_loss_usd);
        setFlowState('claimed');
      } else if (!isLoadingUser) {
        // Connected but hasn't claimed - show loading then preview
        setFlowState('loading');
        // TODO: Call Dune API to calculate actual losses
        // For now, simulate with mock data
        setTimeout(() => {
          const mockLoss = Math.floor(Math.random() * 75000) + 500;
          setLossAmount(mockLoss);
          setFlowState('preview');
        }, 1500);
      }
    } else {
      setFlowState('connect');
    }
  }, [isConnected, address, userSpice, isLoadingUser]);

  // Handle connect button
  const handleConnect = () => {
    connect();
  };

  // Handle claim (would normally go through Discord, but can simulate here)
  const handleClaim = async () => {
    if (!address || lossAmount <= 0) return;

    try {
      await claimMutation.mutateAsync({
        address,
        lossUsd: lossAmount,
        metadata: {
          source: 'web_app',
          claimed_at: new Date().toISOString(),
        },
      });
      setFlowState('claimed');
    } catch (error) {
      console.error('Claim failed:', error);
    }
  };

  const tier = getTierByLoss(lossAmount);

  // Discord invite with wallet context
  const discordInviteUrl = 'https://discord.gg/thehoneyjar';

  // Format stats for display
  const displayStats = {
    totalLosers: stats?.total_losers ?? 0,
    totalLossUsd: stats?.total_loss_usd ?? 0,
    totalSpiceClaimed: stats?.total_spice_claimed ?? 0,
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Main Content - centered in viewport */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        {/* Connect State */}
        {flowState === 'connect' && (
          <div className="flex flex-col items-center">
            <div className="text-center mb-10 max-w-2xl">
              <h1 className="font-[family-name:var(--font-adhesion)] text-4xl lg:text-5xl text-[#e8ddb5] mb-3">
                Losers of Berachain
              </h1>
              <p className="text-[#c2b280] text-base">
                Convert your losses into social currency.
              </p>
            </div>

            <div className="flex flex-col items-center gap-5">
              <button
                onClick={handleConnect}
                className="flex items-center gap-3 px-8 py-4 bg-[#f4a460] text-black font-mono text-sm uppercase tracking-wider transition-all duration-200 hover:scale-[1.02]"
              >
                <Wallet weight="bold" className="w-5 h-5" />
                Connect Wallet
              </button>
              <p className="text-[#6b6245] text-xs max-w-xs text-center">
                We&apos;ll calculate your total USD losses on Berachain
              </p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {flowState === 'loading' && (
          <div className="flex flex-col items-center gap-6">
            <SpinnerGap className="w-12 h-12 text-[#f4a460] animate-spin" />
            <div className="text-center">
              <p className="text-[#e8ddb5] font-mono text-sm mb-1">Calculating your losses...</p>
              <p className="text-[#6b6245] text-xs">{truncatedAddress}</p>
            </div>
          </div>
        )}

        {/* Preview State - shows loss amount and blurred card */}
        {flowState === 'preview' && (
          <div className="flex flex-col items-center gap-8">
            {/* Loss amount reveal */}
            <div className="text-center">
              <p className="text-[#6b6245] text-sm mb-2">You&apos;ve lost</p>
              <div className="font-[family-name:var(--font-adhesion)] text-5xl lg:text-6xl text-[#e8ddb5] mb-1">
                ${lossAmount.toLocaleString()}
              </div>
              <p className="text-[#6b6245] text-sm">on Berachain</p>
            </div>

            {/* Blurred Card Preview */}
            <LoserCard
              address={truncatedAddress ?? ''}
              spice={lossAmount}
              tier={tier}
              blurred={true}
            />

            {/* CTA to Discord */}
            <div className="flex flex-col items-center gap-4 mt-2">
              <div className="text-center max-w-sm">
                <p className="text-[#c2b280] text-sm mb-1">
                  Claim <span className="text-[#f4a460] font-semibold">{formatSpice(lossAmount)} SPICE</span> in Discord
                </p>
                <p className="text-[#6b6245] text-xs">
                  Use <span className="font-mono text-[#c2b280]">/claim-loser</span> to unlock your full card
                </p>
              </div>

              <Link
                href={discordInviteUrl}
                target="_blank"
                className="flex items-center gap-3 px-8 py-4 bg-[#5865F2] text-white font-mono text-sm uppercase tracking-wider transition-all duration-200 hover:scale-[1.02]"
              >
                <DiscordLogo weight="fill" className="w-5 h-5" />
                Join Discord
                <ArrowRight weight="bold" className="w-4 h-4" />
              </Link>

              {/* Dev-only: Direct claim button */}
              {process.env.NODE_ENV === 'development' && (
                <button
                  onClick={handleClaim}
                  disabled={claimMutation.isPending}
                  className="text-[#6b6245] text-xs underline hover:text-[#c2b280] disabled:opacity-50"
                >
                  {claimMutation.isPending ? 'Claiming...' : '[Dev] Claim directly'}
                </button>
              )}

              <p className="text-[#6b6245]/60 text-[10px] text-center max-w-xs">
                Your wallet is linked. Run /claim-loser in Discord to mint your card and claim SPICE.
              </p>
            </div>
          </div>
        )}

        {/* Claimed State - shows full card */}
        {flowState === 'claimed' && userSpice && (
          <div className="flex flex-col items-center gap-8">
            <div className="text-center">
              <p className="text-[#6b6245] text-sm mb-2">Welcome back, loser</p>
              <div className="font-[family-name:var(--font-adhesion)] text-3xl text-[#e8ddb5]">
                {tier.name}
              </div>
            </div>

            {/* Full Card */}
            <LoserCard
              address={truncatedAddress ?? ''}
              spice={userSpice.balance}
              tier={tier}
              blurred={false}
            />

            {/* Balance Info */}
            <div className="text-center">
              <p className="text-[#f4a460] font-mono text-2xl mb-1">
                {formatSpice(userSpice.balance)}
              </p>
              <p className="text-[#6b6245] text-xs">
                Total lost: ${userSpice.total_loss_usd.toLocaleString()}
              </p>
            </div>

            {/* Share CTA */}
            <Link
              href={discordInviteUrl}
              target="_blank"
              className="flex items-center gap-2 text-[#c2b280] hover:text-[#f4a460] transition-colors text-sm"
            >
              Share in Discord
              <ArrowRight weight="bold" className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>

      {/* Stats Bar - fixed at bottom */}
      <div className="py-6">
        <div className="flex items-center justify-center gap-8 text-center">
          <div>
            <div className="text-[#e8ddb5] font-[family-name:var(--font-adhesion)] text-xl">
              {displayStats.totalLosers.toLocaleString()}
            </div>
            <div className="text-[#6b6245] text-[10px] uppercase tracking-wider">Losers</div>
          </div>
          <div className="w-px h-6 bg-[#6b6245]/20" />
          <div>
            <div className="text-[#e8ddb5] font-[family-name:var(--font-adhesion)] text-xl">
              ${(displayStats.totalLossUsd / 1_000_000).toFixed(1)}M
            </div>
            <div className="text-[#6b6245] text-[10px] uppercase tracking-wider">Total Lost</div>
          </div>
          <div className="w-px h-6 bg-[#6b6245]/20" />
          <div>
            <div className="text-[#f4a460] font-[family-name:var(--font-adhesion)] text-xl">
              ◆ {(displayStats.totalSpiceClaimed / 1_000_000).toFixed(1)}M
            </div>
            <div className="text-[#6b6245] text-[10px] uppercase tracking-wider">SPICE Claimed</div>
          </div>
        </div>
      </div>
    </div>
  );
}
