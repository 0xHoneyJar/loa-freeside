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
    <div className="space-y-16">
      {/* Hero with ASCII Noise */}
      <section className="relative">
        {/* Animated noise background */}
        <div className="absolute inset-0 -z-10 opacity-[0.07] overflow-hidden pointer-events-none hidden md:block">
          <AsciiNoise
            width={100}
            height={20}
            speed={0.0005}
            scale={0.04}
            className="text-spice text-[8px]"
          />
        </div>

        <pre className="text-spice text-xs sm:text-sm leading-none hidden sm:block">
          {ARRAKIS_ASCII}
        </pre>
        <h1 className="sm:hidden text-2xl text-sand-bright">ARRAKIS</h1>

        <div className="mt-8 space-y-4">
          <p className="text-sand-bright text-lg">
            engagement intelligence for web3 communities
          </p>
          <p className="text-sand">
            know your community, not just your holders.
          </p>
        </div>

        <div className="mt-8 space-y-2 text-sm">
          <p className="text-sand-dim">
            <span className="text-spice">$</span> arrakis --help
          </p>
          <div className="pl-4 text-sand space-y-1">
            <p>&gt; conviction-scoring - identify diamond hands</p>
            <p>&gt; tier-progression - 9 levels from outsider to naib</p>
            <p>&gt; badge-system - gamified achievements</p>
            <p>&gt; shadow-mode - zero-risk parallel deployment</p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
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
      </section>

      {/* Problem Statement */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// the problem</div>
        <div className="border border-sand-dim/30 p-4 space-y-4">
          <p className="text-sand-bright">
            token-gating is table stakes.
            <br />
            engagement intelligence is the future.
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
        <div className="text-sand-dim text-xs mb-4">// the solution</div>

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
            <div className="text-spice text-sm mb-2">zero_risk_adoption</div>
            <p className="text-sand text-sm">
              shadow mode runs alongside collab.land or guild.xyz. validate
              accuracy, switch when ready.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// quickstart</div>
        <div className="font-mono text-sm space-y-2">
          <p className="text-sand-dim">
            <span className="text-spice">$</span> arrakis init
          </p>
          <div className="pl-4 text-sand space-y-1">
            <p>
              <span className="text-sand-dim">[step 1]</span> connect your token
              contract
            </p>
            <p>
              <span className="text-sand-dim">[step 2]</span> configure tiers
              (basic or sietch theme)
            </p>
            <p>
              <span className="text-sand-dim">[step 3]</span> deploy - roles and
              channels auto-created
            </p>
          </div>
          <p className="text-sand-dim mt-4">
            <span className="text-spice">$</span> # setup complete in ~15
            minutes
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

      {/* Spice Flow Visualization */}
      <section className="relative overflow-hidden">
        <div className="text-sand-dim text-xs mb-4">// the_spice_flow</div>
        <div className="border border-sand-dim/30 relative">
          <div className="absolute inset-0 flex items-center justify-center opacity-30">
            <AsciiNoise
              width={80}
              height={8}
              speed={0.0008}
              scale={0.05}
              className="text-spice text-[10px]"
            />
          </div>
          <div className="relative p-6 text-center backdrop-blur-[1px]">
            <p className="text-sand-bright text-sm mb-2">real-time conviction data flows through arrakis</p>
            <p className="text-sand-dim text-xs">the spice must flow</p>
          </div>
        </div>
      </section>

      {/* Credibility */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// credentials</div>
        <div className="border border-sand-dim/30 p-4">
          <p className="text-sand-bright mb-4">
            built by the #1 starred team on dune analytics
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
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
        <p className="text-sand-bright text-lg mb-2">ready to know your community?</p>
        <p className="text-sand-dim text-sm mb-6">
          start free. see conviction data in shadow mode. upgrade when confident.
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <Link
            href="https://discord.gg/thehoneyjar"
            className="text-spice hover:text-spice-bright"
          >
            [join discord - no credit card]
          </Link>
          <Link href="/about" className="text-sand hover:text-sand-bright">
            [learn more]
          </Link>
        </div>
        <p className="text-sand-dim text-xs mt-4">
          founding 50 spots remaining
        </p>
      </section>
    </div>
  );
}
