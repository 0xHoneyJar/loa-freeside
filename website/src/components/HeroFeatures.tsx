'use client';

import { useState } from 'react';
import Image from 'next/image';
import sandwormAscii from '@/assets/sandworm-ascii.png';
import { ChartLineUp, Diamond, Medal } from '@phosphor-icons/react';

const features = [
  { id: 'analytics', label: 'On-chain Analytics', icon: ChartLineUp, color: '#f4a460' }, // spice orange
  { id: 'conviction', label: 'Conviction Scoring', icon: Diamond, color: '#c45c4a' }, // ruby red
  { id: 'tiers', label: 'Tier Progression', icon: Medal, color: '#5b8fb9' }, // dusty blue
] as const;

type FeatureId = (typeof features)[number]['id'];

export function HeroFeatures() {
  const [activeFeature, setActiveFeature] = useState<FeatureId>('analytics');

  return (
    <>
      {/* Hero Image - with crossfade and subtle scale on feature change */}
      <div
        className="absolute -top-8 -right-24 w-[55%] hidden lg:block pointer-events-none z-10"
        style={{
          maskImage: 'linear-gradient(to right, transparent 0%, black 35%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 35%)',
        }}
      >
        <div className="relative">
          {features.map((feature) => {
            const isActive = activeFeature === feature.id;
            return (
              <Image
                key={feature.id}
                src={sandwormAscii}
                alt={`${feature.label} illustration`}
                width={650}
                height={650}
                className="object-contain object-right"
                style={{
                  position: feature.id === 'analytics' ? 'relative' : 'absolute',
                  top: 0,
                  left: 0,
                  opacity: isActive ? 1 : 0,
                  transform: isActive ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
                  transition: 'opacity 400ms cubic-bezier(0.16, 1, 0.3, 1), transform 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
                priority={feature.id === 'analytics'}
                unoptimized
              />
            );
          })}
        </div>
      </div>

      {/* Features strip */}
      <div
        className="w-full border-y border-sand-dim/20 mb-20 bg-sand-dim/10 relative z-0"
        style={{
          maskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)',
        }}
      >
        <div className="py-3" />
        {/* Feature buttons - commented out for now
        <div className="flex justify-start gap-1 py-1.5 max-w-4xl mx-auto">
          {features.map((feature) => {
            const Icon = feature.icon;
            const isActive = activeFeature === feature.id;

            return (
              <button
                key={feature.id}
                onClick={() => setActiveFeature(feature.id)}
                onMouseEnter={() => setActiveFeature(feature.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 relative"
                style={{
                  transition: 'transform 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                  transform: isActive ? 'scale(1)' : 'scale(0.98)',
                }}
              >
                <div
                  className="absolute inset-0 rounded-sm"
                  style={{
                    backgroundColor: isActive ? 'rgba(107, 98, 69, 0.3)' : 'transparent',
                    transition: 'background-color 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
                <div
                  className="relative z-10 w-4 h-4 flex items-center justify-center"
                  style={{
                    backgroundColor: isActive ? feature.color : '#c2b280',
                    transition: 'background-color 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  <Icon
                    weight="fill"
                    className="w-2.5 h-2.5"
                    style={{
                      color: isActive ? '#0a0a0a' : '#6b6245',
                      transition: 'color 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
                <span
                  className="relative z-10 text-xs"
                  style={{
                    color: isActive ? '#e8ddb5' : '#c2b280',
                    opacity: isActive ? 1 : 0.7,
                    transition: 'color 150ms cubic-bezier(0.16, 1, 0.3, 1), opacity 150ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                >
                  {feature.label}
                </span>
              </button>
            );
          })}
        </div>
        */}
      </div>
    </>
  );
}
