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
                the engagement layer for collab.land
              </p>
              <p className="text-sand">
                built on collab.land. available through their marketplace.
              </p>
              <p className="text-sand-dim text-sm">
                you trust collab.land — we just make it smarter.
              </p>
            </div>

            <div className="space-y-2 text-sm mb-8">
              <p className="text-sand-dim">
                <span className="text-spice">$</span> arrakis --features
              </p>
              <div className="pl-4 text-sand space-y-1">
                <p>&gt; trust-inheritance - same collab.land security</p>
                <p>&gt; conviction-scoring - identify diamond hands</p>
                <p>&gt; tier-progression - 9 levels from outsider to naib</p>
                <p>&gt; badge-system - gamified achievements</p>
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
        {/* Trust Section */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// trust_inheritance</div>
          <div className="border border-spice/30 p-4 space-y-4">
            <p className="text-spice">
              you don&apos;t need to trust anything beyond collab.land
            </p>
            <div className="space-y-3 text-sm text-sand">
              <p>
                <span className="text-sand-dim">[+]</span> wallet verification — uses collab.land&apos;s proven infrastructure
              </p>
              <p>
                <span className="text-sand-dim">[+]</span> token checking — builds on collab.land&apos;s verification
              </p>
              <p>
                <span className="text-sand-dim">[+]</span> security model — inherits collab.land&apos;s trust assumptions
              </p>
              <p>
                <span className="text-sand-dim">[+]</span> marketplace distribution — available through official collab.land marketplace
              </p>
            </div>
            <p className="text-sand-dim text-xs pt-2 border-t border-sand-dim/20">
              result: same security you already rely on. new intelligence on top.
            </p>
          </div>
        </section>

        {/* Problem Statement */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// the_problem</div>
          <div className="border border-sand-dim/30 p-4 space-y-4">
            <p className="text-sand-bright">
              collab.land tells you who holds.
              <br />
              arrakis tells you who believes.
            </p>
            <div className="space-y-3 text-sm text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> same balance, different
                believers - someone who held through the bear market is not the
                same as someone who bought yesterday
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> airdrops go to farmers
                - millions distributed to bots while real community gets diluted
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> flat discord experience
                - biggest supporters get the same treatment as day-one flippers
              </p>
            </div>
          </div>
        </section>

        {/* Solution */}
        <section>
          <div className="text-sand-dim text-xs mb-4">// what_arrakis_adds</div>

          <pre className="text-sand-dim text-xs leading-tight mb-6 hidden md:block">
            {WORM_ASCII}
          </pre>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">conviction_scoring</div>
              <p className="text-sand text-sm">
                know who your diamond hands are before your next airdrop. scoring
                goes beyond balance to measure true commitment.
              </p>
            </div>

            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">tier_progression</div>
              <p className="text-sand text-sm">
                from outsider to naib council. 9 tiers that drive engagement
                through visible status, not just access.
              </p>
            </div>

            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">badge_gamification</div>
              <p className="text-sand text-sm">
                10+ badge types for tenure, achievements, and contribution. create
                collector culture in your discord.
              </p>
            </div>

            <div className="border border-sand-dim/30 p-4">
              <div className="text-spice text-sm mb-2">marketplace_install</div>
              <p className="text-sand text-sm">
                install from the collab.land marketplace. no migration needed.
                your existing setup gains intelligence instantly.
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
          <div className="text-sand-dim text-xs mb-4">// credentials</div>
          <div className="border border-sand-dim/30 p-4">
            <p className="text-sand-bright mb-4">
              built on collab.land. by the #1 team on dune analytics.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center text-sm">
              <div>
                <div className="text-spice text-xl">CL</div>
                <div className="text-sand-dim">built on</div>
              </div>
              <div>
                <div className="text-spice text-xl">65+</div>
                <div className="text-sand-dim">sprints</div>
              </div>
              <div>
                <div className="text-spice text-xl">#1</div>
                <div className="text-sand-dim">dune team</div>
              </div>
              <div>
                <div className="text-spice text-xl">99.9%</div>
                <div className="text-sand-dim">uptime</div>
              </div>
              <div>
                <div className="text-spice text-xl">RLS</div>
                <div className="text-sand-dim">security</div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="border border-spice/50 p-6 text-center">
          <p className="text-sand-bright text-lg mb-2">ready to extend collab.land?</p>
          <p className="text-sand-dim text-sm mb-6">
            install from the collab.land marketplace. same trust, more intelligence.
          </p>
          <div className="flex flex-wrap justify-center gap-4 text-sm">
            <Link
              href="https://discord.gg/thehoneyjar"
              className="text-spice hover:text-spice-bright"
            >
              [join discord]
            </Link>
            <Link href="/collab-land" className="text-sand hover:text-sand-bright">
              [learn more]
            </Link>
          </div>
          <p className="text-sand-dim text-xs mt-4">
            built on collab.land • available through their marketplace
          </p>
        </section>
      </div>
    </div>
  );
}
