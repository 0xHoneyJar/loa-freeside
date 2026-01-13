'use client';

import { useEffect, useState } from 'react';

// Dune-themed ASCII characters
const DUNE_CHARS = ['⌂', '◊', '○', '◦', '·', '∴', '∵', '⋮', '⋯', '≋', '∿', '⌇', '⫶', '჻', '᎓', '᎒'];
const SPICE_CHARS = ['✧', '✦', '⬡', '⬢', '◈', '◇', '▵', '△', '▿', '▽'];

interface AsciiChar {
  id: number;
  char: string;
  x: number;
  y: number;
  opacity: number;
  size: 'xs' | 'sm' | 'base';
}

interface RandomAsciiCharsProps {
  count?: number;
  className?: string;
  variant?: 'dune' | 'spice' | 'mixed';
  minOpacity?: number;
  maxOpacity?: number;
}

export function RandomAsciiChars({
  count = 15,
  className = '',
  variant = 'mixed',
  minOpacity = 0.1,
  maxOpacity = 0.4,
}: RandomAsciiCharsProps) {
  const [chars, setChars] = useState<AsciiChar[]>([]);

  useEffect(() => {
    const charSet = variant === 'dune'
      ? DUNE_CHARS
      : variant === 'spice'
        ? SPICE_CHARS
        : [...DUNE_CHARS, ...SPICE_CHARS];

    const sizes: ('xs' | 'sm' | 'base')[] = ['xs', 'sm', 'base'];

    const newChars: AsciiChar[] = [];
    for (let i = 0; i < count; i++) {
      newChars.push({
        id: i,
        char: charSet[Math.floor(Math.random() * charSet.length)],
        x: Math.random() * 100,
        y: Math.random() * 100,
        opacity: minOpacity + Math.random() * (maxOpacity - minOpacity),
        size: sizes[Math.floor(Math.random() * sizes.length)],
      });
    }
    setChars(newChars);
  }, [count, variant, minOpacity, maxOpacity]);

  const sizeClasses = {
    xs: 'text-xs',
    sm: 'text-sm',
    base: 'text-base',
  };

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {chars.map((char) => (
        <span
          key={char.id}
          className={`absolute font-mono ${sizeClasses[char.size]}`}
          style={{
            left: `${char.x}%`,
            top: `${char.y}%`,
            opacity: char.opacity,
            transform: 'translate(-50%, -50%)',
          }}
        >
          {char.char}
        </span>
      ))}
    </div>
  );
}
