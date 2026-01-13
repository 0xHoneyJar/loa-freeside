import Link from 'next/link';
import { AsciiNoise } from '@/components/AsciiNoise';

const ARRAKIS_ASCII = `
    ___    ____  ____  ___    __ __ ________
   /   |  / __ \\/ __ \\/   |  / //_//  _/ ___/
  / /| | / /_/ / /_/ / /| | / ,<   / / \\__ \\
 / ___ |/ _, _/ _, _/ ___ |/ /| |_/ / ___/ /
/_/  |_/_/ |_/_/ |_/_/  |_/_/ |_/___//____/
`;

const WORM_ASCII = `
                    .---.
                   /     \\
                  | () () |
                   \\  ^  /
              .-----'---'-----.
             /                  \\
            |   ~~~~~~~~~~~~~~~   |
             \\                  /
              '----------------'
                  SHAI-HULUD
`;

export default function HomePage() {
  return (
    <div>
      {/* Hero Section - Split Layout */}
      <section className="relative -mx-6 -mt-12 mb-16">
        <div className="flex flex-col lg:flex-row min-h-[80vh]">
          {/* Left Half - Full ASCII Noise */}
          <div className="hidden lg:block lg:w-1/2 bg-black relative overflow-hidden border-r border-sand-dim/20">
            <div className="absolute inset-0 flex items-center justify-center">
              <AsciiNoise
                autoSize
                speed={0.0006}
                scale={0.04}
                charWidth={7}
                charHeight={14}
                className="text-spice/80 text-[11px]"
              />
            </div>
            {/* Overlay gradient for text readability */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-black/50" />
            {/* Centered label */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-sand-dim/40 text-xs mb-2">// the_spice_flow</div>
                <div className="text-sand/30 text-[10px] tracking-widest">REAL-TIME CONVICTION DATA</div>
              </div>
            </div>
          </div>

          {/* Right Half - Content */}
          <div className="lg:w-1/2 flex flex-col justify-center px-6 lg:px-12 py-12 lg:py-0">
            <pre className="text-spice text-xs sm:text-sm leading-none hidden sm:block mb-8">
              {ARRAKIS_ASCII}
            </pre>
            <h1 className="sm:hidden text-2xl text-sand-bright mb-8">ARRAKIS</h1>

            <div className="space-y-4 mb-8">
              <p className="text-sand-bright text-lg">
                dune analytics power. zero code required.
              </p>
              <p className="text-sand">
                the #1 dune team brings on-chain intelligence to your discord —
                no SQL, no dashboards, no data analysts needed.
              </p>
              <p className="text-sand-dim text-sm">
                built on collab.land. powered by dune expertise.
              </p>
            </div>

            <div className="space-y-2 text-sm mb-8">
              <p className="text-sand-dim">
                <span className="text-spice">$</span> arrakis --features
              </p>
              <div className="pl-4 text-sand space-y-1">
                <p>&gt; dune-powered - on-chain analytics, no queries</p>
                <p>&gt; conviction-scoring - identify diamond hands</p>
                <p>&gt; tier-progression - insights as discord roles</p>
                <p>&gt; zero-code - 15 minute setup, anyone can use it</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <Link
                href="https://discord.gg/thehoneyjar"
                className="text-spice hover:text-spice-bright"
              >
                [join discord]
              </Link>
              <Link href="/pricing" className="text-sand hover:text-sand-bright">
                [view pricing]
              </Link>
              <Link href="/features" className="text-sand hover:text-sand-bright">
                [features]
              </Link>
            </div>
          </div>
        </div>

        {/* Mobile ASCII Noise Banner */}
        <div className="lg:hidden border-y border-sand-dim/20 bg-black/50 overflow-hidden">
          <div className="relative h-32">
            <AsciiNoise
              width={60}
              height={8}
              speed={0.0006}
              scale={0.05}
              className="text-spice/60 text-[10px]"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <div className="text-sand-dim/50 text-xs">// the spice must flow</div>
            </div>
          </div>
        </div>
      </section>

      {/* Rest of content */}
      <div className="space-y-16">
        {/* Dune Power Section */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// the_dune_advantage</div>
          <div className="border border-spice/30 p-4 space-y-4">
            <p className="text-spice">
              a dune wizard embedded in your discord
            </p>
            <p className="text-sand text-sm mb-4">
              think of it this way: dune analytics is the bloomberg terminal for crypto — powerful, but requires expertise.
              arrakis is that bloomberg data delivered as a simple app on your phone.
            </p>
            <div className="space-y-3 text-sm text-sand">
              <p>
                <span className="text-sand-dim">[+]</span> no SQL required — we&apos;ve done the hard work
              </p>
              <p>
                <span className="text-sand-dim">[+]</span> curated insights — pre-built conviction scoring
              </p>
              <p>
                <span className="text-sand-dim">[+]</span> discord roles — analytics delivered where you engage
              </p>
              <p>
                <span className="text-sand-dim">[+]</span> dynamic updates — refreshes every 6 hours automatically
              </p>
            </div>
            <p className="text-sand-dim text-xs pt-2 border-t border-sand-dim/20">
              the #1 dune team spent years mastering on-chain analytics. now that expertise is packaged into a 15-minute setup.
            </p>
          </div>
        </section>

        {/* Problem Statement */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// the_problem</div>
          <div className="border border-sand-dim/30 p-4 space-y-4">
            <p className="text-sand-bright">
              on-chain data is powerful.
              <br />
              but who has time for SQL?
            </p>
            <div className="space-y-3 text-sm text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> you need a data analyst
                - getting conviction insights requires dune queries and dashboards
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> airdrops go to farmers
                - without on-chain intelligence, you can&apos;t tell diamond hands from day traders
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> analytics stay in spreadsheets
                - insights live in CSVs, not where your community engages
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> data gets stale
                - one-time snapshots don&apos;t capture dynamic community changes
              </p>
            </div>
          </div>
        </section>

        {/* Solution */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// what_arrakis_delivers</div>

          <pre className="text-sand-dim text-xs leading-tight mb-6 hidden md:block">
            {WORM_ASCII}
          </pre>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">zero_code_analytics</div>
              <p className="text-sand text-sm">
                we&apos;ve spent years mastering dune queries. now that expertise is
                packaged into a 15-minute setup anyone can use.
              </p>
            </div>

            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">conviction_scoring</div>
              <p className="text-sand text-sm">
                holding duration, trading patterns, on-chain activity — all
                curated into a single conviction score. no dashboards needed.
              </p>
            </div>

            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">tier_progression</div>
              <p className="text-sand text-sm">
                from outsider to naib council. insights delivered as discord
                roles that update automatically every 6 hours.
              </p>
            </div>

            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">collab.land_foundation</div>
              <p className="text-sand text-sm">
                built on collab.land&apos;s trusted infrastructure. same security
                you already rely on, with intelligence on top.
              </p>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// quickstart</div>
          <div className="font-mono text-sm space-y-2">
            <p className="text-sand-dim">
              <span className="text-spice">$</span> arrakis install
            </p>
            <div className="pl-4 text-sand space-y-1">
              <p>
                <span className="text-sand-dim">[step 1]</span> find arrakis in the
                collab.land marketplace
              </p>
              <p>
                <span className="text-sand-dim">[step 2]</span> one-click install
                (uses your existing collab.land setup)
              </p>
              <p>
                <span className="text-sand-dim">[step 3]</span> configure tiers and
                conviction thresholds
              </p>
            </div>
            <p className="text-sand-dim mt-4">
              <span className="text-spice">$</span> # no migration. same trust. more intelligence.
            </p>
          </div>
        </section>

        {/* Pricing Preview */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// pricing</div>
          <pre className="text-sand text-xs overflow-x-auto">
            {`
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   STARTER        GROWTH          ENTERPRISE                 │
│   $0/mo          $99/mo          $399/mo                    │
│                                                             │
│   - 3 tiers      - 9 tiers       - custom themes            │
│   - 1 server     - conviction    - unlimited servers        │
│   - basic gate   - analytics     - api access               │
│   - shadow mode  - 5 servers     - dedicated support        │
│                                                             │
│   [start free]   [upgrade]       [contact]                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
            `}
          </pre>
          <p className="text-spice text-sm mt-4">
            * founding 50: first 50 premium customers get 50% off for life
          </p>
          <Link
            href="/pricing"
            className="inline-block mt-4 text-sand-dim hover:text-sand text-sm"
          >
            [view full pricing]
          </Link>
        </section>

        {/* Use Cases */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// use-cases</div>
          <div className="space-y-4 text-sm">
            <Link
              href="/use-cases/daos"
              className="block border border-sand-dim/30 p-4 hover:border-sand-dim"
            >
              <span className="text-spice">&gt;</span>{' '}
              <span className="text-sand-bright">daos</span>
              <span className="text-sand-dim ml-4">
                - find diamond hands before governance votes
              </span>
            </Link>
            <Link
              href="/use-cases/nft-projects"
              className="block border border-sand-dim/30 p-4 hover:border-sand-dim"
            >
              <span className="text-spice">&gt;</span>{' '}
              <span className="text-sand-bright">nft-projects</span>
              <span className="text-sand-dim ml-4">
                - turn post-mint silence into collector culture
              </span>
            </Link>
            <Link
              href="/use-cases/defi-protocols"
              className="block border border-sand-dim/30 p-4 hover:border-sand-dim"
            >
              <span className="text-spice">&gt;</span>{' '}
              <span className="text-sand-bright">defi-protocols</span>
              <span className="text-sand-dim ml-4">
                - enterprise-grade community infrastructure
              </span>
            </Link>
          </div>
        </section>

        {/* Credibility */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// why_trust_us</div>
          <div className="border border-sand-dim/30 p-4">
            <p className="text-sand-bright mb-4">
              the #1 dune team. now powering your discord.
            </p>
            <p className="text-sand text-sm mb-4">
              we&apos;ve spent years analyzing on-chain data for protocols, DAOs, and NFT projects.
              now that expertise is packaged into a tool anyone can use — no SQL, no dashboards, no data engineers.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center text-sm">
              <div>
                <div className="text-spice text-xl">#1</div>
                <div className="text-sand-dim">dune team</div>
              </div>
              <div>
                <div className="text-spice text-xl">0</div>
                <div className="text-sand-dim">code needed</div>
              </div>
              <div>
                <div className="text-spice text-xl">15</div>
                <div className="text-sand-dim">min setup</div>
              </div>
              <div>
                <div className="text-spice text-xl">6h</div>
                <div className="text-sand-dim">auto-refresh</div>
              </div>
              <div>
                <div className="text-spice text-xl">CL</div>
                <div className="text-sand-dim">foundation</div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border border-spice/50 p-6 text-center">
          <p className="text-sand-bright text-lg mb-2">ready for dune-powered community intelligence?</p>
          <p className="text-sand-dim text-sm mb-6">
            15 minutes to setup. no SQL required. no data analysts needed.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link
              href="https://discord.gg/thehoneyjar"
              className="text-spice hover:text-spice-bright"
            >
              [start free]
            </Link>
            <Link href="/features" className="text-sand hover:text-sand-bright">
              [see features]
            </Link>
          </div>
          <p className="text-sand-dim text-xs mt-4">
            powered by dune expertise • built on collab.land • zero code required
          </p>
        </section>
      </div>
    </div>
  );
}
