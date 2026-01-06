import type { Metadata } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AsciiBackground } from '@/components/AsciiBackground';
import { ScrambleProvider } from '@/components/TextScramble';

export const metadata: Metadata = {
  title: 'ARRAKIS // The Engagement Layer for Collab.Land',
  description:
    'Built on Collab.Land, available through their marketplace. Conviction scoring and tiered progression for the token-gating you already trust.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'ARRAKIS // Engagement Intelligence',
    description:
      'Know your community, not just your holders. Conviction scoring, 9-tier progression, and zero-risk adoption.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-black font-mono">
        <AsciiBackground opacity={0.10} speed={0.000286} wordDensity={0.035} />
        <ScrambleProvider className="relative z-10 mx-auto max-w-4xl px-6 py-8">
          <Header />
          <main className="mt-12">{children}</main>
          <Footer />
        </ScrambleProvider>
      </body>
    </html>
  );
}
