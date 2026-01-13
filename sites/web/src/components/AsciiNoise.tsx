'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

// Simplex noise implementation (adapted from blindman67/SimplexNoiseJS)
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

// Character density map - from dense to sparse
const DENSITY = 'Ñ@#W$9876543210?!abcxyz;:+=-,._ ';

interface AsciiNoiseProps {
  className?: string;
  width?: number;
  height?: number;
  speed?: number;
  scale?: number;
  autoSize?: boolean;
  charWidth?: number;
  charHeight?: number;
}

export function AsciiNoise({
  className = '',
  width = 80,
  height = 12,
  speed = 0.0007,
  scale = 0.03,
  autoSize = false,
  charWidth = 6,
  charHeight = 12,
}: AsciiNoiseProps) {
  const [output, setOutput] = useState<string>('');
  const [dimensions, setDimensions] = useState({ cols: width, rows: height });
  const containerRef = useRef<HTMLPreElement>(null);
  const noiseRef = useRef<ReturnType<typeof createNoise> | null>(null);

  // Handle auto-sizing
  useEffect(() => {
    if (!autoSize) {
      setDimensions({ cols: width, rows: height });
      return;
    }

    const updateSize = () => {
      if (containerRef.current?.parentElement) {
        const parent = containerRef.current.parentElement;
        const cols = Math.floor(parent.clientWidth / charWidth);
        const rows = Math.floor(parent.clientHeight / charHeight);
        setDimensions({ cols: Math.max(10, cols), rows: Math.max(5, rows) });
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [autoSize, width, height, charWidth, charHeight]);

  // Animation loop
  useEffect(() => {
    noiseRef.current = createNoise(Date.now());

    const aspect = 2.0;
    let animationId: number;
    const startTime = performance.now();

    function render() {
      if (!noiseRef.current) return;

      const t = (performance.now() - startTime) * speed;
      const lines: string[] = [];

      for (let y = 0; y < dimensions.rows; y++) {
        let line = '';
        for (let x = 0; x < dimensions.cols; x++) {
          const nx = x * scale;
          const ny = (y * scale) / aspect + t;
          const value = noiseRef.current.noise3D(nx, ny, t);
          const normalized = value * 0.5 + 0.5;
          const index = Math.floor(normalized * DENSITY.length);
          const clampedIndex = Math.max(0, Math.min(DENSITY.length - 1, index));
          line += DENSITY[clampedIndex];
        }
        lines.push(line);
      }

      setOutput(lines.join('\n'));
      animationId = requestAnimationFrame(render);
    }

    render();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [dimensions.cols, dimensions.rows, speed, scale]);

  return (
    <pre
      ref={containerRef}
      className={`font-mono leading-none select-none overflow-hidden ${className}`}
    >
      {output}
    </pre>
  );
}
