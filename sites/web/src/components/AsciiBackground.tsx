'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

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

// Words that will appear in the background - themed around the brand
const WORDS = ['SPICE', 'DUNE', 'HONEY', 'FLOW', 'DATA', 'HODL', 'WEB3', 'CHAIN'];

// Characters for noise fill - more varied and visible
const NOISE_CHARS = '.·:;+=xX#@$%&*░▒▓█';

interface AsciiBackgroundProps {
  className?: string;
  opacity?: number;
  speed?: number;
  wordDensity?: number;
}

export function AsciiBackground({
  className = '',
  opacity = 0.15,
  speed = 0.0005,
  wordDensity = 0.025,
}: AsciiBackgroundProps) {
  const [output, setOutput] = useState<string>('');
  const [dimensions, setDimensions] = useState({ cols: 120, rows: 40 });
  const noiseRef = useRef<ReturnType<typeof createNoise> | null>(null);
  const wordPositionsRef = useRef<Array<{
    word: string;
    x: number;
    y: number;
    vx: number;
    vy: number;
  }>>([]);

  // Initialize word positions
  const initWords = useCallback((cols: number, rows: number) => {
    const numWords = Math.floor(cols * rows * wordDensity / 5);
    wordPositionsRef.current = [];

    for (let i = 0; i < numWords; i++) {
      wordPositionsRef.current.push({
        word: WORDS[Math.floor(Math.random() * WORDS.length)],
        x: Math.random() * cols,
        y: Math.random() * rows,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.15,
      });
    }
  }, [wordDensity]);

  // Handle sizing - ensure full viewport coverage
  useEffect(() => {
    const updateSize = () => {
      // Character dimensions for 10px JetBrains Mono (monospace ~0.6 ratio)
      const charWidth = 6;
      const charHeight = 14;
      // Use full viewport width/height
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      // Calculate columns needed, add buffer for safety
      const cols = Math.ceil(viewportWidth / charWidth) + 10;
      const rows = Math.ceil(viewportHeight / charHeight) + 5;
      setDimensions({
        cols: Math.max(200, cols),  // Ensure minimum wide coverage
        rows: Math.max(60, rows)
      });
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
    };
  }, []);

  // Initialize words when dimensions change
  useEffect(() => {
    initWords(dimensions.cols, dimensions.rows);
  }, [dimensions.cols, dimensions.rows, initWords]);

  // Animation loop
  useEffect(() => {
    noiseRef.current = createNoise(Date.now());

    let animationId: number;
    const startTime = performance.now();

    function render() {
      if (!noiseRef.current) return;

      const t = (performance.now() - startTime) * speed;
      const { cols, rows } = dimensions;

      // Create a 2D grid
      const grid: string[][] = [];
      for (let y = 0; y < rows; y++) {
        grid[y] = [];
        for (let x = 0; x < cols; x++) {
          // Use noise to determine character
          const nx = x * 0.04;
          const ny = y * 0.025 + t;
          const value = noiseRef.current.noise3D(nx, ny, t * 2);
          const normalized = value * 0.5 + 0.5;

          // More noise characters visible - lower threshold
          if (normalized > 0.45) {
            const index = Math.floor((normalized - 0.45) / 0.55 * NOISE_CHARS.length);
            grid[y][x] = NOISE_CHARS[Math.min(index, NOISE_CHARS.length - 1)];
          } else {
            grid[y][x] = ' ';
          }
        }
      }

      // Update and render floating words
      wordPositionsRef.current.forEach((wp) => {
        // Update position
        wp.x += wp.vx;
        wp.y += wp.vy;

        // Wrap around edges
        if (wp.x < -wp.word.length) wp.x = cols;
        if (wp.x > cols) wp.x = -wp.word.length;
        if (wp.y < 0) wp.y = rows - 1;
        if (wp.y >= rows) wp.y = 0;

        // Render word onto grid
        const wordX = Math.floor(wp.x);
        const wordY = Math.floor(wp.y);

        for (let i = 0; i < wp.word.length; i++) {
          const x = wordX + i;
          if (x >= 0 && x < cols && wordY >= 0 && wordY < rows) {
            grid[wordY][x] = wp.word[i];
          }
        }
      });

      // Convert grid to string
      const lines = grid.map(row => row.join(''));
      setOutput(lines.join('\n'));

      animationId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [dimensions.cols, dimensions.rows, speed]);

  return (
    <div
      className={`fixed top-0 left-0 pointer-events-none overflow-hidden z-0 ${className}`}
      style={{
        opacity,
        width: '100vw',
        height: '100vh',
      }}
    >
      <pre
        className="font-mono text-spice whitespace-pre select-none"
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '10px',
          lineHeight: '14px',
          margin: 0,
          padding: 0,
        }}
      >
        {output}
      </pre>
    </div>
  );
}
