'use client';

import { useEffect, useRef, useState } from 'react';

const users = [
  { name: '@diamond_hands', score: 95, highlight: true },
  { name: '@steady_stacker', score: 78, highlight: true },
  { name: '@curious_collector', score: 52, highlight: false },
  { name: '@paper_trader', score: 23, highlight: false },
];

function getBarColor(score: number): string {
  if (score >= 70) return '#c45c4a'; // ruby
  if (score >= 50) return '#f4a460'; // spice
  return '#6b6245'; // sand-dim
}

export function ConvictionBoard() {
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
      <div className="space-y-4">
        {users.map((user, index) => (
          <div
            key={user.name}
            className="flex items-center justify-between"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? 'translateX(0)' : 'translateX(-8px)',
              transition: `opacity 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80 + 100}ms, transform 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80 + 100}ms`,
            }}
          >
            <span className={`text-sm ${user.highlight ? 'text-sand' : 'text-sand-dim'}`}>
              {user.name}
            </span>
            <div className="flex items-center gap-3">
              <div className="w-32 lg:w-48 h-2 bg-sand-dim/20 overflow-hidden">
                <div
                  className="h-full"
                  style={{
                    backgroundColor: getBarColor(user.score),
                    width: isVisible ? `${user.score}%` : '0%',
                    transition: `width 600ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80 + 200}ms`,
                  }}
                />
              </div>
              <span
                className={`text-sm font-mono w-8 ${user.highlight ? 'text-sand-bright' : 'text-sand-dim'}`}
                style={{
                  opacity: isVisible ? 1 : 0,
                  transition: `opacity 300ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80 + 400}ms`,
                }}
              >
                {user.score}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
