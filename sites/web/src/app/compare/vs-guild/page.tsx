import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'vs guild.xyz // ARRAKIS',
  description:
    'Guild.xyz manages access. Arrakis creates value. Compare engagement intelligence vs access control.',
};

export default function VsGuildPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// compare / vs-guild</div>
        <h1 className="text-2xl text-sand-bright">
          guild.xyz manages access. arrakis creates value.
        </h1>
        <p className="text-sand mt-2">
          guild.xyz offers free token-gating with impressive chain support. but when
          you need to know who matters in your community — not just who can enter —
          that&apos;s where arrakis begins.
        </p>
      </section>

      {/* Quick Comparison */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// quick_comparison</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-spice/50 p-4">
            <div className="text-spice mb-3">ARRAKIS</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-spice">+</span> token-gating</p>
              <p><span className="text-spice">+</span> multi-chain</p>
              <p><span className="text-spice">+</span> conviction scoring</p>
              <p><span className="text-spice">+</span> 9-tier progression</p>
              <p><span className="text-spice">+</span> 10+ badges</p>
              <p><span className="text-spice">+</span> shadow mode</p>
              <p><span className="text-spice">+</span> analytics dashboard</p>
              <p><span className="text-spice">+</span> telegram support</p>
            </div>
            <div className="text-sand-dim text-xs mt-4 pt-3 border-t border-sand-dim/30">
              free + premium: $99/mo
            </div>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright mb-3">GUILD.XYZ</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-sand-dim">+</span> token-gating</p>
              <p><span className="text-sand-dim">+</span> multi-chain (60+ evm)</p>
              <p><span className="text-sand-dim">-</span> no conviction scoring</p>
              <p><span className="text-sand-dim">~</span> basic requirements</p>
              <p><span className="text-sand-dim">~</span> points system</p>
              <p><span className="text-sand-dim">-</span> no coexistence mode</p>
              <p><span className="text-sand-dim">~</span> basic analytics</p>
              <p><span className="text-sand-dim">-</span> no telegram</p>
            </div>
            <div className="text-sand-dim text-xs mt-4 pt-3 border-t border-sand-dim/30">
              price: free (all features)
            </div>
          </div>
        </div>
      </section>

      {/* Core Difference */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// core_difference</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4 text-center">
            <div className="text-sand-dim text-xs mb-2">guild.xyz answers:</div>
            <div className="text-sand-bright">
              &quot;does this wallet meet our requirements?&quot;
            </div>
          </div>
          <div className="border border-spice/50 p-4 text-center">
            <div className="text-sand-dim text-xs mb-2">arrakis answers:</div>
            <div className="text-spice">
              &quot;how committed is this person to our community?&quot;
            </div>
          </div>
        </div>
      </section>

      {/* Detailed Comparison */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// detailed_comparison</div>
        <div className="border border-sand-dim/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-dim/30">
                <th className="text-left p-3 text-sand-dim">feature</th>
                <th className="text-center p-3 text-spice">arrakis</th>
                <th className="text-center p-3 text-sand-dim">guild.xyz</th>
              </tr>
            </thead>
            <tbody className="text-sand">
              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>token-gating</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">erc20 balance check</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">nft ownership</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">multi-chain support</td>
                <td className="p-3 text-center text-spice">score service</td>
                <td className="p-3 text-center text-sand-dim">60+ evm</td>
              </tr>

              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>requirements engine</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">on-chain requirements</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">off-chain requirements</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">custom logic</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>

              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>engagement intelligence</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">conviction scoring</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">holding duration analysis</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">diamond hands identification</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>

              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>progression system</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">tiered roles</td>
                <td className="p-3 text-center text-spice">9 tiers</td>
                <td className="p-3 text-center text-sand-dim">requirements-based</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">dynamic rank progression</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">badge gamification</td>
                <td className="p-3 text-center text-spice">10+ types</td>
                <td className="p-3 text-center text-sand-dim">points</td>
              </tr>

              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>platforms</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">discord</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">telegram</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">other (github, google)</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>

              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>pricing</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">free tier</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">all features free</td>
              </tr>
              <tr>
                <td className="p-3">premium features</td>
                <td className="p-3 text-center text-spice">$99/mo</td>
                <td className="p-3 text-center text-sand-dim">free</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* What Guild.xyz Does Well */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// what_guild_does_well</div>
        <div className="border border-sand-dim/30 p-4">
          <div className="text-sand-bright mb-3">free and flexible access management</div>
          <p className="text-sand text-sm mb-4">
            guild.xyz offers a generous free tier with impressive flexibility. their
            requirements engine supports complex logic across on-chain and off-chain conditions.
          </p>
          <div className="grid md:grid-cols-2 gap-2 text-sm">
            <div className="text-sand"><span className="text-sand-dim">+</span> completely free (all features)</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> 60+ evm chains</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> flexible requirements</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> clean ux/ui</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> multi-platform (github, google)</div>
          </div>
          <p className="text-sand-dim text-sm mt-4 pt-3 border-t border-sand-dim/30">
            if you need flexible access management with complex requirements logic,
            guild.xyz is powerful.
          </p>
        </div>
      </section>

      {/* What Arrakis Adds */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// what_arrakis_adds</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">conviction_scoring</div>
            <p className="text-sand text-sm">
              guild.xyz checks if requirements are met right now. arrakis analyzes
              behavior over time — holding duration, trading patterns, accumulation.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              the difference: a wallet that bought yesterday and one that held for
              two years both pass guild.xyz requirements. only arrakis distinguishes them.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">9_tier_progression</div>
            <p className="text-sand text-sm">
              guild.xyz assigns roles based on requirements. arrakis creates a
              progression journey from outsider to naib. visible hierarchy drives engagement.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              guild: &quot;you meet requirements.&quot; arrakis: &quot;you&apos;re rank #12 and climbing
              toward fedaykin elite.&quot;
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">telegram_support</div>
            <p className="text-sand text-sm">
              guild.xyz focuses on discord and web platforms. arrakis supports both
              discord and telegram for communities that span both platforms.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">shadow_mode</div>
            <p className="text-sand text-sm">
              guild.xyz is all-or-nothing. arrakis lets you run in shadow mode
              alongside any existing setup — see conviction data before committing.
            </p>
          </div>
        </div>
      </section>

      {/* Free vs Paid Trade-off */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// free_vs_paid_tradeoff</div>
        <pre className="text-sand text-xs overflow-x-auto whitespace-pre border border-sand-dim/30 p-4">
{`┌────────────────────────────────────────────────────────────────────────┐
│                     PRICING COMPARISON                                 │
├────────────────────────────┬─────────────────┬────────────────────────┤
│  feature set               │  guild.xyz      │  arrakis               │
├────────────────────────────┼─────────────────┼────────────────────────┤
│  basic token-gating        │  free           │  free                  │
│  60+ chains                │  free           │  —                     │
│  off-chain requirements    │  free           │  —                     │
│  conviction scoring        │  — not avail    │  $99/mo                │
│  9-tier progression        │  — not avail    │  $99/mo                │
│  analytics + insights      │  — not avail    │  $99/mo                │
│  telegram support          │  — not avail    │  $99/mo                │
└────────────────────────────┴─────────────────┴────────────────────────┘

if you only need access control: guild.xyz free tier is hard to beat.
if you need to know who your diamond hands are: no amount of guild.xyz
features provides that. arrakis premium does.`}
        </pre>
      </section>

      {/* ROI Calculation */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// roi_calculation</div>
        <div className="border border-sand-dim/30 p-4">
          <div className="text-spice mb-3">scenario: planning a $1M airdrop</div>
          <div className="grid md:grid-cols-2 gap-4 text-sm mb-4">
            <div className="border border-sand-dim/30 p-3">
              <div className="text-sand-bright mb-2">with guild.xyz (free):</div>
              <p className="text-sand-dim">
                gate access based on requirements. no insight into farmer vs believer.
                risk: 50%+ goes to farmers.
              </p>
            </div>
            <div className="border border-spice/50 p-3">
              <div className="text-spice mb-2">with arrakis ($99/mo):</div>
              <p className="text-sand-dim">
                conviction scoring identifies diamond hands. weight distribution by
                commitment. better allocation to true community.
              </p>
            </div>
          </div>
          <p className="text-sand text-sm">
            <span className="text-spice">roi:</span> if conviction data improves distribution
            by even 10%, that&apos;s $100,000 value for $99/month.
          </p>
        </div>
      </section>

      {/* When to Choose */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// when_to_choose</div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright text-sm mb-3">choose guild.xyz if:</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-sand-dim">-</span> free is the primary requirement</p>
              <p><span className="text-sand-dim">-</span> you need 60+ chain support</p>
              <p><span className="text-sand-dim">-</span> you want off-chain requirements</p>
              <p><span className="text-sand-dim">-</span> access management is the only goal</p>
              <p><span className="text-sand-dim">-</span> you don&apos;t need conviction data</p>
            </div>
          </div>
          <div className="border border-spice/50 p-4">
            <div className="text-spice text-sm mb-3">choose arrakis if:</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-spice">+</span> you need to identify valuable members</p>
              <p><span className="text-spice">+</span> you&apos;re planning airdrops</p>
              <p><span className="text-spice">+</span> you want tiered progression</p>
              <p><span className="text-spice">+</span> you need telegram support</p>
              <p><span className="text-spice">+</span> you value engagement over access</p>
            </div>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright text-sm mb-3">use both if:</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-sand-dim">-</span> guild for off-chain requirements</p>
              <p><span className="text-sand-dim">-</span> arrakis for on-chain intelligence</p>
              <p><span className="text-sand-dim">-</span> different use cases in same community</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// faq</div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> guild.xyz is free — why pay for arrakis?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> free is great for access control. but
              when you need to know who your diamond hands are — not just who holds tokens —
              guild.xyz can&apos;t tell you. no free tool can. that intelligence has value,
              especially before airdrops.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> guild.xyz has more chain support
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> true. if you need specific chains
              guild.xyz supports that we don&apos;t, use guild.xyz for those. but chain count
              doesn&apos;t reveal conviction. a holder on 60 chains means nothing if you don&apos;t
              know which ones are farmers.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> i need off-chain requirements
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> guild.xyz is better for that. we focus
              on on-chain intelligence. consider using both — guild.xyz for off-chain
              requirements, arrakis for conviction-based tiering.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> everything i need is free with guild.xyz
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> if access management is all you need,
              stay with guild.xyz. but ask: do you know who your top 7 holders are? who&apos;s
              held longest? who&apos;s accumulating vs selling? if those questions matter, that&apos;s
              where we start.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border border-spice/50 p-6 text-center">
        <p className="text-sand-bright text-lg mb-2">
          free works until you need to know who matters
        </p>
        <p className="text-sand-dim text-sm mb-6">
          guild.xyz gates access. arrakis identifies value. start free, upgrade when
          conviction data proves its worth.
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <Link
            href="https://discord.gg/thehoneyjar"
            className="text-spice hover:text-spice-bright"
          >
            [start free]
          </Link>
          <Link href="/pricing" className="text-sand hover:text-sand-bright">
            [view pricing]
          </Link>
        </div>
        <p className="text-sand-dim text-xs mt-4">
          free tier available • shadow mode evaluation • no credit card required
        </p>
      </section>
    </div>
  );
}
