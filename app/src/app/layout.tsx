import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { GeistMono } from 'geist/font/mono';
import './globals.css';
import { Providers } from './providers';

const adhesion = localFont({
  src: '../assets/fonts/Adhesion-Regular.woff2',
  variable: '--font-adhesion',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Arrakis App',
  description: 'Dune-powered community intelligence',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${adhesion.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-[#0a0a0a] font-mono antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
