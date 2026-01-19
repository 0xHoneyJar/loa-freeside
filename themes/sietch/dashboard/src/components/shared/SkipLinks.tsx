/**
 * Skip Links Component
 *
 * Sprint 132: Performance & Accessibility
 *
 * Provides skip links for keyboard navigation accessibility.
 *
 * @module components/shared/SkipLinks
 */

import React from 'react';
import { DEFAULT_SKIP_LINKS, type SkipLink } from '../../utils/accessibility';

// =============================================================================
// Types
// =============================================================================

export interface SkipLinksProps {
  /** Custom skip links (defaults to main content + navigation) */
  links?: SkipLink[];
  /** Class name for the container */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export const SkipLinks: React.FC<SkipLinksProps> = ({
  links = DEFAULT_SKIP_LINKS,
  className = '',
}) => {
  const handleClick = (targetId: string) => (event: React.MouseEvent) => {
    event.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
      target.focus();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div
      className={`skip-links fixed top-0 left-0 z-50 ${className}`}
      role="navigation"
      aria-label="Skip links"
    >
      {links.map((link) => (
        <a
          key={link.id}
          id={link.id}
          href={`#${link.targetId}`}
          onClick={handleClick(link.targetId)}
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-amber-500 focus:text-black focus:font-medium focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
        >
          {link.label}
        </a>
      ))}
    </div>
  );
};

export default SkipLinks;
