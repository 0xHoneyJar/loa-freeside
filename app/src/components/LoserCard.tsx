'use client';

import { motion } from 'framer-motion';
import type { TierInfo } from '@/types/spice';

interface LoserCardProps {
  address: string;
  spice: number;
  tier: TierInfo;
  blurred?: boolean;
}

// Tier letter for badge
const TIER_LETTERS: Record<string, string> = {
  'Tourist': 'T',
  'Outsider': 'O',
  'Fremen': 'F',
  'Fedaykin': 'D',
  'Naib': 'N',
  'Kwisatz Haderach': 'K',
};

// Background patterns for each tier
const TIER_BACKGROUNDS: Record<string, string> = {
  'Tourist': 'bg-gradient-to-br from-[#0a0a0a] to-[#151515]',
  'Outsider': 'bg-gradient-to-br from-[#0a0a0a] via-[#1a1812] to-[#0a0a0a]',
  'Fremen': 'bg-gradient-to-br from-[#1a1510] via-[#2a1f15] to-[#1a1510]',
  'Fedaykin': 'bg-gradient-to-br from-[#1a1210] via-[#2a1815] to-[#1a1210]',
  'Naib': 'bg-gradient-to-br from-[#101518] via-[#152025] to-[#101518]',
  'Kwisatz Haderach': 'bg-gradient-to-br from-[#1a1810] via-[#2a2515] to-[#1a1810]',
};

export function LoserCard({ address, spice, tier, blurred = false }: LoserCardProps) {
  const tierLetter = TIER_LETTERS[tier.name] || 'T';
  const bgClass = TIER_BACKGROUNDS[tier.name] || TIER_BACKGROUNDS['Tourist'];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`relative w-[360px] h-[200px] ${bgClass} border border-[#6b6245]/30 overflow-hidden`}
    >
      {/* Tier-specific decorations */}
      {tier.name === 'Fremen' && (
        <div className="absolute inset-0 opacity-20">
          <div className="absolute top-0 left-0 w-full h-full" style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M0 50 Q 25 30, 50 50 T 100 50\' stroke=\'%23f4a460\' fill=\'none\' stroke-width=\'0.5\'/%3E%3C/svg%3E")',
            backgroundSize: '100px 100px',
          }} />
        </div>
      )}

      {tier.name === 'Fedaykin' && (
        <div className="absolute inset-0">
          <div
            className="absolute inset-0 opacity-10"
            style={{
              background: `radial-gradient(circle at 50% 50%, ${tier.color}40 0%, transparent 70%)`,
            }}
          />
        </div>
      )}

      {tier.name === 'Naib' && (
        <div className="absolute inset-0 opacity-10">
          {/* Sandworm silhouette */}
          <svg className="absolute bottom-0 left-0 w-full h-24" viewBox="0 0 360 100" preserveAspectRatio="none">
            <path
              d="M0 100 Q 60 60, 120 80 T 240 70 T 360 100 L360 100 L0 100 Z"
              fill={tier.color}
              opacity="0.3"
            />
          </svg>
        </div>
      )}

      {tier.name === 'Kwisatz Haderach' && (
        <div className="absolute inset-0">
          {/* Spice explosion effect */}
          <div
            className="absolute inset-0 animate-pulse"
            style={{
              background: `radial-gradient(circle at 50% 100%, ${tier.color}30 0%, transparent 50%)`,
            }}
          />
          {/* Worm emergence */}
          <svg className="absolute bottom-0 left-1/2 -translate-x-1/2 w-48 h-32 opacity-20" viewBox="0 0 200 150">
            <ellipse cx="100" cy="150" rx="80" ry="30" fill={tier.color} />
            <path
              d="M60 150 Q 80 100, 100 80 Q 120 100, 140 150"
              stroke={tier.color}
              fill="none"
              strokeWidth="3"
            />
          </svg>
        </div>
      )}

      {/* Content */}
      <div className={`relative z-10 h-full p-5 flex flex-col ${blurred ? 'blur-sm' : ''}`}>
        {/* Header: Address + Tier Badge */}
        <div className="flex items-start justify-between mb-auto">
          <div>
            <div className="font-mono text-[#6b6245] text-xs mb-1">WALLET</div>
            <div className="font-mono text-[#e8ddb5] text-sm">{address}</div>
          </div>
          <div
            className="w-10 h-10 flex items-center justify-center font-[family-name:var(--font-adhesion)] text-lg text-black"
            style={{ backgroundColor: tier.color }}
          >
            {tierLetter}
          </div>
        </div>

        {/* SPICE Amount */}
        <div className="mb-4">
          <div className="flex items-baseline gap-2">
            <span className="text-[#f4a460] text-2xl">◆</span>
            <span className="font-[family-name:var(--font-adhesion)] text-3xl text-[#e8ddb5]">
              {spice.toLocaleString()}
            </span>
            <span className="text-[#6b6245] text-sm">SPICE</span>
          </div>
        </div>

        {/* Tier Title */}
        <div className="text-[#6b6245] text-xs font-mono italic">
          &ldquo;{tier.title}&rdquo;
        </div>

        {/* Footer */}
        <div className="mt-auto pt-3 border-t border-[#6b6245]/20 flex items-center justify-between">
          <div className="text-[#6b6245] text-[10px] font-mono uppercase tracking-wider">
            LOSERS OF BERACHAIN
          </div>
          <div className="text-[#6b6245] text-[10px] font-mono">
            arrakis.community
          </div>
        </div>
      </div>

      {/* Blur overlay when locked */}
      {blurred && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className="text-center">
            <div className="text-[#6b6245] text-xs font-mono uppercase tracking-wider mb-1">
              Preview
            </div>
            <div className="text-[#c2b280] text-sm">
              Connect Discord to unlock
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
