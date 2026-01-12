'use client';

import { useEffect, useRef, useState } from 'react';

const stats = [
  { value: '0', label: 'queries to write' },
  { value: '15', label: 'min setup' },
  { value: '6h', label: 'auto-refresh' },
  { value: '#1', label: 'dune team' },
];

export function StatsGrid() {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.3,
        rootMargin: '0px 0px -50px 0px',
      }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="mt-12 border border-sand-dim/30 p-8 lg:p-12"
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateY(0)' : 'translateY(12px)',
        transition: 'opacity 500ms cubic-bezier(0.16, 1, 0.3, 1), transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateY(0)' : 'translateY(8px)',
              transition: `opacity 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 60 + 100}ms, transform 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 60 + 100}ms`,
            }}
          >
            <div className="font-display text-4xl lg:text-5xl text-spice mb-2">{stat.value}</div>
            <div className="text-sand-dim text-xs font-mono">{stat.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
