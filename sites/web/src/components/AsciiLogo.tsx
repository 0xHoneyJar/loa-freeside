'use client';

import { useEffect, useState } from 'react';

// Simplified noise for logo animation
function simpleNoise(x: number, y: number, t: number): number {
  return Math.sin(x * 0.5 + t) * Math.cos(y * 0.5 + t * 0.7) * 0.5 + 0.5;
}

const CHARS = '@#$%&*+=;:.,';

interface AsciiLogoProps {
  className?: string;
  animated?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function AsciiLogo({ className = '', animated = true, size = 'md' }: AsciiLogoProps) {
  const [frame, setFrame] = useState(0);
  const [noiseChars, setNoiseChars] = useState<string[][]>([]);

  // Grid dimensions based on size
  const gridSize = size === 'sm' ? 5 : size === 'md' ? 7 : 9;
  const fontSize = size === 'sm' ? 'text-[8px]' : size === 'md' ? 'text-[10px]' : 'text-xs';
  const aSize = size === 'sm' ? 'text-lg' : size === 'md' ? 'text-2xl' : 'text-3xl';

  useEffect(() => {
    if (!animated) {
      // Static noise pattern
      const grid: string[][] = [];
      for (let y = 0; y < gridSize; y++) {
        const row: string[] = [];
        for (let x = 0; x < gridSize; x++) {
          const charIndex = Math.floor(Math.random() * CHARS.length);
          row.push(CHARS[charIndex]);
        }
        grid.push(row);
      }
      setNoiseChars(grid);
      return;
    }

    let animationId: number;
    const startTime = performance.now();

    function animate() {
      const t = (performance.now() - startTime) * 0.001;
      const grid: string[][] = [];

      for (let y = 0; y < gridSize; y++) {
        const row: string[] = [];
        for (let x = 0; x < gridSize; x++) {
          const noise = simpleNoise(x, y, t);
          const charIndex = Math.floor(noise * CHARS.length);
          row.push(CHARS[Math.min(charIndex, CHARS.length - 1)]);
        }
        grid.push(row);
      }

      setNoiseChars(grid);
      setFrame(f => f + 1);
      animationId = requestAnimationFrame(animate);
    }

    animate();
    return () => cancelAnimationFrame(animationId);
  }, [animated, gridSize]);

  // Determine which cells should be "cut out" for the A shape
  const isPartOfA = (x: number, y: number): boolean => {
    const mid = Math.floor(gridSize / 2);
    const third = Math.floor(gridSize / 3);

    // Top point
    if (y === 0 && x === mid) return true;

    // Diagonal sides going down
    if (y > 0 && y < gridSize) {
      const leftEdge = mid - Math.ceil(y * 0.6);
      const rightEdge = mid + Math.ceil(y * 0.6);

      // Left and right edges
      if (x === Math.max(0, leftEdge) || x === Math.min(gridSize - 1, rightEdge)) return true;

      // Crossbar (middle row)
      if (y === Math.floor(gridSize * 0.55) && x > leftEdge && x < rightEdge) return true;
    }

    return false;
  };

  return (
    <div className={`relative inline-block ${className}`}>
      {/* Noise background */}
      <div className={`${fontSize} leading-none font-mono`}>
        {noiseChars.map((row, y) => (
          <div key={y} className="flex">
            {row.map((char, x) => (
              <span
                key={x}
                className={
                  isPartOfA(x, y)
                    ? 'text-spice font-bold'
                    : 'text-sand-dim/40'
                }
                style={{
                  width: size === 'sm' ? '8px' : size === 'md' ? '10px' : '12px',
                  display: 'inline-block',
                  textAlign: 'center',
                }}
              >
                {isPartOfA(x, y) ? (animated ? char : '@') : char}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Simple inline logo - just the A with some noise decoration
export function AsciiLogoInline({ className = '' }: { className?: string }) {
  return (
    <span className={`font-mono font-bold ${className}`}>
      <span className="text-sand-dim/50">;</span>
      <span className="text-spice">A</span>
      <span className="text-sand-dim/50">;</span>
    </span>
  );
}

// Compact animated logo for header
export function AsciiLogoCompact({ className = '', animated = true }: { className?: string; animated?: boolean }) {
  const [chars, setChars] = useState(['@', '#', '$']);

  useEffect(() => {
    if (!animated) return;

    const interval = setInterval(() => {
      setChars([
        CHARS[Math.floor(Math.random() * CHARS.length)],
        CHARS[Math.floor(Math.random() * CHARS.length)],
        CHARS[Math.floor(Math.random() * CHARS.length)],
      ]);
    }, 200);

    return () => clearInterval(interval);
  }, [animated]);

  return (
    <span className={`font-mono ${className}`}>
      <span className="text-sand-dim/40 text-xs">{chars[0]}</span>
      <span className="text-spice font-bold">A</span>
      <span className="text-sand-dim/40 text-xs">{chars[1]}</span>
    </span>
  );
}
