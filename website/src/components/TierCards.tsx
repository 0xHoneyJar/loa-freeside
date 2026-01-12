'use client';

import { useEffect, useRef, useState } from 'react';
import { Crown, Sword, Users, UserCircle } from '@phosphor-icons/react';

const tiers = [
  {
    name: 'Naib Council',
    score: '90+',
    color: '#5b8fb9',
    icon: Crown,
    highlight: true,
  },
  {
    name: 'Fedaykin',
    score: '70+',
    color: '#c45c4a',
    icon: Sword,
    highlight: false,
  },
  {
    name: 'Fremen',
    score: '50+',
    color: '#f4a460',
    icon: Users,
    highlight: false,
  },
  {
    name: 'Outsider',
    score: '0+',
    color: '#6b6245',
    icon: UserCircle,
    highlight: false,
  },
];

export function TierCards() {
  const [isVisible, setIsVisible] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        // Only trigger once when entering view
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      {
        threshold: 0.2, // Trigger when 20% visible
        rootMargin: '0px 0px -50px 0px', // Slight offset from bottom
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
      className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4"
    >
      {tiers.map((tier, index) => {
        const Icon = tier.icon;
        return (
          <div
            key={tier.name}
            className="border border-sand-dim/30 p-6"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible
                ? 'translateY(0)'
                : 'translateY(16px)',
              transition: `opacity 500ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80}ms, transform 500ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80}ms`,
            }}
          >
            {/* Icon with colored background */}
            <div
              className="w-10 h-10 flex items-center justify-center mb-4"
              style={{
                backgroundColor: tier.color,
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? 'scale(1)' : 'scale(0.8)',
                transition: `opacity 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80 + 150}ms, transform 400ms cubic-bezier(0.16, 1, 0.3, 1) ${index * 80 + 150}ms`,
              }}
            >
              <Icon weight="fill" className="w-5 h-5 text-black" />
            </div>
            {/* Tier name */}
            <div
              className={`text-sm font-mono mb-1 ${tier.highlight ? 'text-sand-bright' : 'text-sand'}`}
            >
              {tier.name}
            </div>
            {/* Score requirement */}
            <div className="text-sand-dim text-xs">Score {tier.score}</div>
          </div>
        );
      })}
    </div>
  );
}
