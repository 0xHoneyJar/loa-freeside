import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Header } from '@/components/Header';
import { FooterWrapper } from '@/components/FooterWrapper';
import { AsciiBackground } from '@/components/AsciiBackground';
import { PromoCard } from '@/components/PromoCard';

const adhesion = localFont({
  src: '../assets/fonts/Adhesion-Regular.woff2',
  variable: '--font-adhesion',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ARRAKIS // Dune Analytics for Discord',
  description:
    'The #1 Dune team brings on-chain intelligence to your Discord. Zero code required. 15-minute setup.',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
  openGraph: {
    title: 'ARRAKIS // Dune Analytics for Discord',
    description:
      'Conviction scoring. Tier progression. Zero SQL. The #1 Dune team, now powering your community.',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${adhesion.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-black font-mono">
        <AsciiBackground opacity={0.08} />
        <Header />
        <PromoCard />
        <div className="relative z-10 pt-16">
          <main>{children}</main>
          <FooterWrapper />
        </div>
      </body>
    </html>
  );
}
