import type { Metadata } from 'next';
import Link from 'next/link';
import { AsciiAccent, AsciiDivider } from '@/components/AsciiAccent';
import { RandomAsciiChars } from '@/components/RandomAsciiChars';

export const metadata: Metadata = {
  title: 'Built on Collab.Land // ARRAKIS',
  description:
    'Arrakis extends Collab.Land with engagement intelligence. Same trust, more insight. Available through the Collab.Land marketplace.',
};

export default function CollabLandPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section className="relative">
        <RandomAsciiChars count={12} variant="mixed" className="text-sand-dim" />
        <div className="text-sand-dim text-xs mb-2">// collab-land</div>
        <h1 className="text-2xl text-sand-bright">
          built on collab.land. powered by engagement intelligence.
        </h1>
        <p className="text-sand mt-2">
          arrakis extends collab.land with conviction scoring and tiered progression.
          you already trust collab.land — we just make it smarter.
        </p>
        <p className="text-spice text-sm mt-4">
          available through the collab.land marketplace
        </p>
      </section>

      <AsciiAccent variant="bright" height={2} />

      {/* Trust Section */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// trust_inheritance</div>
        <div className="border border-spice/50 p-4">
          <div className="text-spice mb-4">
            you don&apos;t need to trust anything beyond collab.land
          </div>
          <p className="text-sand text-sm mb-4">
            arrakis is built directly on top of collab.land&apos;s infrastructure.
            when you connect your wallet through arrakis, you&apos;re using
            collab.land&apos;s verified system.
          </p>
          <pre className="text-sand text-xs overflow-x-auto whitespace-pre border border-sand-dim/30 p-4 bg-black/50">
{`┌─────────────────────────────────────────────────────────────────┐
│                    TRUST INHERITANCE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  COLLAB.LAND PROVIDES          ARRAKIS INHERITS                 │
│  ───────────────────           ────────────────                 │
│  ✓ Wallet verification    →    Uses their verification         │
│  ✓ Token ownership check  →    Builds on their checks          │
│  ✓ Discord integration    →    Extends their patterns          │
│  ✓ Security model         →    Inherits their security         │
│  ✓ 6.5M+ verified wallets →    Leverages their trust           │
│                                                                  │
│  RESULT: You trust Collab.Land. That's all you need.            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘`}
          </pre>
        </div>
      </section>

      {/* What Arrakis Adds */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// what_arrakis_adds</div>
        <p className="text-sand-bright mb-4">
          collab.land handles access. arrakis adds intelligence.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-dim text-xs mb-2">collab.land provides</div>
            <div className="text-sand text-sm space-y-1">
              <p>binary access (yes/no)</p>
              <p>balance check</p>
              <p>static roles</p>
              <p>who can enter</p>
              <p>wallet verification</p>
            </div>
          </div>
          <div className="border border-spice/50 p-4">
            <div className="text-spice text-xs mb-2">arrakis adds</div>
            <div className="text-sand text-sm space-y-1">
              <p>9-tier progression</p>
              <p>conviction scoring</p>
              <p>dynamic rank updates</p>
              <p>who actually matters</p>
              <p>engagement intelligence</p>
            </div>
          </div>
        </div>
      </section>

      <AsciiDivider />

      {/* Features */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// features</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">conviction_scoring</div>
            <p className="text-sand text-sm">
              collab.land tells you who holds your token. arrakis tells you who
              believes in your project — holding duration, trading patterns,
              accumulation history.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">9_tier_progression</div>
            <p className="text-sand text-sm">
              from outsider to naib council. your most committed members earn
              visible status that drives engagement.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">badge_gamification</div>
            <p className="text-sand text-sm">
              10+ badge types for tenure, achievements, and community
              contribution. create collector culture.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">analytics_dashboard</div>
            <p className="text-sand text-sm">
              know your community composition. see conviction distribution.
              plan better airdrops.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// how_it_works</div>
        <div className="font-mono text-sm space-y-2">
          <p className="text-sand-bright mb-4">install from the collab.land marketplace</p>
          <div className="text-sand space-y-2">
            <p>
              <span className="text-sand-dim">[step 1]</span> find arrakis in the
              collab.land marketplace
            </p>
            <p>
              <span className="text-sand-dim">[step 2]</span> install with one click
              (uses your existing collab.land setup)
            </p>
            <p>
              <span className="text-sand-dim">[step 3]</span> configure your tiers
              and conviction thresholds
            </p>
            <p>
              <span className="text-sand-dim">[step 4]</span> your community gains
              engagement intelligence instantly
            </p>
          </div>
          <p className="text-spice mt-4">
            no migration. no switching. just enhancement.
          </p>
        </div>
      </section>

      {/* Why Extension vs Alternative */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// why_extend_not_switch</div>
        <div className="border border-sand-dim/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-dim/30">
                <th className="text-left p-3 text-sand-dim">approach</th>
                <th className="text-center p-3 text-sand-dim">trust required</th>
                <th className="text-center p-3 text-sand-dim">migration</th>
                <th className="text-center p-3 text-sand-dim">risk</th>
              </tr>
            </thead>
            <tbody className="text-sand">
              <tr className="border-b border-sand-dim/10 bg-spice/5">
                <td className="p-3 text-spice">arrakis (collab.land extension)</td>
                <td className="p-3 text-center">none new</td>
                <td className="p-3 text-center">none</td>
                <td className="p-3 text-center text-spice">zero</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">guild.xyz</td>
                <td className="p-3 text-center">new platform</td>
                <td className="p-3 text-center">full</td>
                <td className="p-3 text-center">medium</td>
              </tr>
              <tr>
                <td className="p-3">custom build</td>
                <td className="p-3 text-center">self</td>
                <td className="p-3 text-center">n/a</td>
                <td className="p-3 text-center">high</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sand-dim text-sm mt-4">
          other tools ask you to switch platforms, migrate your community, and trust
          new infrastructure. arrakis just extends what you already have.
        </p>
      </section>

      <AsciiAccent variant="subtle" height={2} />

      {/* FAQ */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// faq</div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> is arrakis a replacement for collab.land?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> no. arrakis is built on top of
              collab.land and extends it. you keep using collab.land — we just add
              engagement intelligence.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> do i need to trust a new platform?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> no. arrakis uses collab.land&apos;s
              infrastructure for wallet verification and token checking. if you
              trust collab.land, you can trust arrakis.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> how do i install arrakis?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> through the collab.land marketplace.
              one-click install that extends your existing setup.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> what if i want to remove arrakis later?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> no problem. arrakis is an add-on.
              remove it and you&apos;re back to standard collab.land — your original
              setup is unchanged.
            </p>
          </div>
        </div>
      </section>

      <AsciiAccent variant="bright" height={3} />

      {/* CTA */}
      <section className="relative border border-spice/50 p-6 text-center overflow-hidden">
        <RandomAsciiChars count={10} variant="spice" className="text-spice" minOpacity={0.05} maxOpacity={0.2} />
        <p className="text-sand-bright text-lg mb-2">
          ready to add engagement intelligence?
        </p>
        <p className="text-sand-dim text-sm mb-6">
          install arrakis from the collab.land marketplace. same trust, more insight.
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <Link
            href="https://discord.gg/thehoneyjar"
            className="text-spice hover:text-spice-bright"
          >
            [join discord]
          </Link>
          <Link href="/pricing" className="text-sand hover:text-sand-bright">
            [view pricing]
          </Link>
        </div>
        <p className="text-sand-dim text-xs mt-4">
          built on collab.land • zero migration • remove anytime
        </p>
      </section>
    </div>
  );
}
