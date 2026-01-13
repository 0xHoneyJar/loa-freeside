'use client';

import { AsciiNoise } from './AsciiNoise';

interface AsciiAccentProps {
  className?: string;
  height?: number;
  variant?: 'default' | 'subtle' | 'bright';
}

// Pre-configured accent strips for use throughout the site
export function AsciiAccent({
  className = '',
  height = 3,
  variant = 'default',
}: AsciiAccentProps) {
  const variantClasses = {
    default: 'text-spice/40',
    subtle: 'text-sand-dim/30',
    bright: 'text-spice/60',
  };

  return (
    <div className={`overflow-hidden ${className}`}>
      <div className="relative" style={{ height: `${height * 14}px` }}>
        <AsciiNoise
          width={120}
          height={height}
          speed={0.0004}
          scale={0.06}
          className={`text-[10px] ${variantClasses[variant]}`}
        />
        {/* Gradient fade on edges */}
        <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black to-transparent" />
        <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black to-transparent" />
      </div>
    </div>
  );
}

// Horizontal divider with animated noise
export function AsciiDivider({ className = '' }: { className?: string }) {
  return (
    <div className={`my-8 ${className}`}>
      <AsciiAccent height={2} variant="subtle" />
    </div>
  );
}

// Section background accent
export function AsciiSectionBg({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      <div className="absolute top-0 left-0 right-0 opacity-20">
        <AsciiNoise
          width={100}
          height={4}
          speed={0.0003}
          scale={0.08}
          className="text-[9px] text-spice/30"
        />
      </div>
      <div className="absolute bottom-0 left-0 right-0 opacity-20">
        <AsciiNoise
          width={100}
          height={4}
          speed={0.0003}
          scale={0.08}
          className="text-[9px] text-sand-dim/30"
        />
      </div>
    </div>
  );
}
