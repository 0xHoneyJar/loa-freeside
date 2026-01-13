'use client';

import { usePathname } from 'next/navigation';
import { Footer } from './Footer';

// Pages that should not show the footer (app-like experiences)
// Note: /losers now lives in the app (app.arrakis.community)
const NO_FOOTER_PATHS: string[] = [];

export function FooterWrapper() {
  const pathname = usePathname();

  // Hide footer on specific paths
  if (NO_FOOTER_PATHS.includes(pathname)) {
    return null;
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <Footer />
    </div>
  );
}
