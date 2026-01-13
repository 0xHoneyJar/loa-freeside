'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AsciiLogoCompact } from './AsciiLogo';
import { ScrambleLink } from './TextScramble';

const navLinks = [
  { href: '/features', label: 'features' },
  { href: '/pricing', label: 'pricing' },
  { href: '/use-cases/daos', label: 'use-cases' },
  { href: '/about', label: 'about' },
];

export function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header>
      <nav className="flex items-center justify-between">
        <Link href="/" className="text-sand-bright hover:text-spice flex items-center gap-1">
          <AsciiLogoCompact />
          <span>ARRAKIS</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <ScrambleLink
              key={link.href}
              href={link.href}
              className="text-sand-dim hover:text-sand-bright text-sm"
            >
              {link.label}
            </ScrambleLink>
          ))}
          <span className="text-sand-dim">|</span>
          <ScrambleLink
            href="https://discord.gg/thehoneyjar"
            className="text-spice hover:text-spice-bright text-sm"
            external
          >
            discord
          </ScrambleLink>
        </div>

        {/* Mobile toggle */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="md:hidden text-sand-dim hover:text-sand-bright"
          aria-label="Toggle menu"
        >
          [{isOpen ? '-' : '+'}]
        </button>
      </nav>

      {/* Mobile nav */}
      {isOpen && (
        <div className="md:hidden mt-4 border-t border-sand-dim/30 pt-4">
          <div className="flex flex-col gap-2">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsOpen(false)}
                className="text-sand-dim hover:text-sand-bright text-sm"
              >
                <span className="text-sand-dim mr-2">&gt;</span>
                {link.label}
              </Link>
            ))}
            <Link
              href="https://discord.gg/thehoneyjar"
              target="_blank"
              className="text-spice hover:text-spice-bright text-sm"
            >
              <span className="text-sand-dim mr-2">&gt;</span>
              discord
            </Link>
          </div>
        </div>
      )}

      <div className="mt-4 text-sand-dim text-xs overflow-hidden">
        {'─'.repeat(80)}
      </div>
    </header>
  );
}
