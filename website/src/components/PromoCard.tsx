'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, ArrowRight } from '@phosphor-icons/react';

export function PromoCard() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-6 left-6 z-50 hidden md:block">
      <div className="relative w-72 border-l-2 border-l-spice border border-sand-dim bg-black p-4">
        {/* Close button */}
        <button
          onClick={() => setIsVisible(false)}
          className="absolute top-3 right-3 text-sand-dim hover:text-sand-bright transition-colors duration-150"
        >
          <X weight="bold" className="w-3.5 h-3.5" />
        </button>

        {/* Header with badge */}
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 flex items-center justify-center bg-spice">
            <span className="font-display text-sm text-black">50</span>
          </div>
          <div>
            <h3 className="text-sand-bright font-mono text-xs uppercase tracking-wider">
              Founding Fremen
            </h3>
          </div>
        </div>

        {/* Content */}
        <p className="text-sand text-xs leading-relaxed mb-3">
          50% off for life. Know your diamond hands before the next drop.
        </p>

        {/* CTA */}
        <Link
          href="https://discord.gg/thehoneyjar"
          className="group inline-flex items-center gap-1.5 text-spice hover:text-spice-bright text-xs font-mono uppercase tracking-wider transition-colors duration-150"
        >
          Join the 50
          <ArrowRight weight="bold" className="w-3 h-3 group-hover:translate-x-0.5 transition-transform duration-150" />
        </Link>
      </div>
    </div>
  );
}
