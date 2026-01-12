'use client';

import { useEffect, useRef, useState, useCallback, memo } from 'react';

// Simplex noise implementation for organic movement
function createNoise(seed: number) {
  const F3 = 1 / 3;
  const G3 = 1 / 6;

  const grad3 = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  ];

  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);

  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  let s = seed;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }

  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }

  function dot3(g: number[], x: number, y: number, z: number) {
    return g[0] * x + g[1] * y + g[2] * z;
  }

  function noise3D(x: number, y: number, z: number): number {
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const X0 = i - t;
    const Y0 = j - t;
    const Z0 = k - t;
    const x0 = x - X0;
    const y0 = y - Y0;
    const z0 = z - Z0;

    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }

    const x1 = x0 - i1 + G3;
    const y1 = y0 - j1 + G3;
    const z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3;
    const y2 = y0 - j2 + 2 * G3;
    const z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3;
    const y3 = y0 - 1 + 3 * G3;
    const z3 = z0 - 1 + 3 * G3;

    const ii = i & 255;
    const jj = j & 255;
    const kk = k & 255;

    let n0 = 0, n1 = 0, n2 = 0, n3 = 0;

    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 >= 0) {
      const gi0 = permMod12[ii + perm[jj + perm[kk]]];
      t0 *= t0;
      n0 = t0 * t0 * dot3(grad3[gi0], x0, y0, z0);
    }

    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 >= 0) {
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      t1 *= t1;
      n1 = t1 * t1 * dot3(grad3[gi1], x1, y1, z1);
    }

    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 >= 0) {
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      t2 *= t2;
      n2 = t2 * t2 * dot3(grad3[gi2], x2, y2, z2);
    }

    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 >= 0) {
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      t3 *= t3;
      n3 = t3 * t3 * dot3(grad3[gi3], x3, y3, z3);
    }

    return 32 * (n0 + n1 + n2 + n3);
  }

  return { noise3D };
}

// Characters for noise fill
const NOISE_CHARS = '.·:;+=xX#@';

// Brand colors for gems (full brightness to stand out)
const GEM_RUBY = '#e07060';
const GEM_BLUE = '#70a8d0';

// Sand color - subtle so gems stand out
const SAND_COLOR = 'rgba(244, 164, 96, 0.28)';

interface CharData {
  char: string;
  isGem?: boolean;
  isRuby?: boolean;
}

interface AsciiBackgroundProps {
  className?: string;
  speed?: number;
  stripWidth?: number;
}

export function AsciiBackground({
  className = '',
  speed = 0.0003,
  stripWidth = 360,
}: AsciiBackgroundProps) {
  const [leftGrid, setLeftGrid] = useState<CharData[][]>([]);
  const [rightGrid, setRightGrid] = useState<CharData[][]>([]);
  const [dimensions, setDimensions] = useState({ cols: 52, rows: 70 });
  const noiseRef = useRef<ReturnType<typeof createNoise> | null>(null);
  const gemNoiseRef = useRef<ReturnType<typeof createNoise> | null>(null);
  const animationRef = useRef<number | null>(null);
  const timeRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  // Handle sizing
  useEffect(() => {
    const updateSize = () => {
      const charWidth = 7;
      const charHeight = 15;
      const viewportHeight = window.innerHeight;
      const cols = Math.ceil(stripWidth / charWidth) + 5;
      const rows = Math.ceil(viewportHeight / charHeight) + 5;
      setDimensions({ cols: Math.max(52, cols), rows: Math.max(70, rows) });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [stripWidth]);

  // Render function with organic flow variation
  const renderStrip = useCallback((
    cols: number,
    rows: number,
    offsetX: number,
    time: number
  ): CharData[][] => {
    if (!noiseRef.current || !gemNoiseRef.current) return [];

    const grid: CharData[][] = [];
    for (let y = 0; y < rows; y++) {
      grid[y] = [];
      for (let x = 0; x < cols; x++) {
        // Vary time based on position for organic flow
        const flowVariation = gemNoiseRef.current.noise3D(x * 0.02, y * 0.02, 0) * 0.5 + 0.5;
        const localTime = time * (0.6 + flowVariation * 0.8);

        const nx = (x + offsetX) * 0.04;
        const ny = y * 0.025;
        const value = noiseRef.current.noise3D(nx, ny, localTime);
        const normalized = value * 0.5 + 0.5;

        // Check for rare gem placement - use high frequency noise for scatter
        // Higher frequency = more chaotic, less clustering
        const gemValue = gemNoiseRef.current.noise3D(nx * 2.5, ny * 2.5, time * 0.03);
        const gemNormalized = gemValue * 0.5 + 0.5;

        // Very rare - only sharp peaks get gems (scattered singles)
        if (gemNormalized > 0.96) {
          const isRuby = gemNoiseRef.current.noise3D(x * 0.1, y * 0.1, 0) > 0;
          grid[y][x] = { char: '◆', isGem: true, isRuby };
        } else if (normalized > 0.5) {
          // ASCII sand characters
          const index = Math.floor((normalized - 0.5) / 0.5 * NOISE_CHARS.length);
          const char = NOISE_CHARS[Math.min(index, NOISE_CHARS.length - 1)];
          grid[y][x] = { char };
        } else {
          grid[y][x] = { char: ' ' };
        }
      }
    }

    return grid;
  }, []);

  // Throttled animation loop (target ~20fps for smooth feel without perf hit)
  useEffect(() => {
    noiseRef.current = createNoise(42);
    gemNoiseRef.current = createNoise(123);

    const targetInterval = 50; // ~20fps

    const animate = (timestamp: number) => {
      if (timestamp - lastFrameRef.current >= targetInterval) {
        lastFrameRef.current = timestamp;
        timeRef.current += speed * targetInterval;
        const { cols, rows } = dimensions;
        setLeftGrid(renderStrip(cols, rows, 0, timeRef.current));
        setRightGrid(renderStrip(cols, rows, 100, timeRef.current));
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [dimensions, speed, renderStrip]);

  const preStyle = {
    fontFamily: 'var(--font-geist-mono), monospace',
    fontSize: '11px',
    lineHeight: '15px',
    margin: 0,
    padding: 0,
  };

  // Render grid - no container opacity, colors have opacity baked in
  const renderGridContent = (grid: CharData[][]) => {
    return grid.map((row, y) => (
      <div key={y} style={{ height: '15px' }}>
        {row.map((cell, x) => (
          cell.isGem ? (
            <span
              key={x}
              style={{ color: cell.isRuby ? GEM_RUBY : GEM_BLUE }}
            >
              {cell.char}
            </span>
          ) : (
            <span key={x} style={{ color: SAND_COLOR }}>{cell.char}</span>
          )
        ))}
      </div>
    ));
  };

  return (
    <div className={`fixed inset-0 pointer-events-none overflow-hidden z-0 ${className}`}>
      {/* Left Strip - no container opacity */}
      <div
        className="absolute top-0 left-0 h-full overflow-hidden"
        style={{ width: stripWidth }}
      >
        <div className="font-mono whitespace-pre select-none" style={preStyle}>
          {renderGridContent(leftGrid)}
        </div>
        {/* Fade to black on the right edge */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to right, transparent 0%, transparent 30%, #0a0a0a 100%)',
          }}
        />
      </div>

      {/* Right Strip - no container opacity */}
      <div
        className="absolute top-0 right-0 h-full overflow-hidden"
        style={{ width: stripWidth }}
      >
        <div className="font-mono whitespace-pre select-none" style={preStyle}>
          {renderGridContent(rightGrid)}
        </div>
        {/* Fade to black on the left edge */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'linear-gradient(to left, transparent 0%, transparent 30%, #0a0a0a 100%)',
          }}
        />
      </div>
    </div>
  );
}
