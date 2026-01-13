import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6">
      <h1 className="font-[family-name:var(--font-adhesion)] text-4xl text-[#e8ddb5] mb-4">
        Arrakis
      </h1>
      <p className="text-[#c2b280] mb-8">
        Community intelligence dashboard
      </p>
      <Link
        href="/losers"
        className="px-6 py-3 bg-[#f4a460] text-black font-mono text-sm uppercase tracking-wider"
      >
        Losers of Berachain
      </Link>
    </div>
  );
}
