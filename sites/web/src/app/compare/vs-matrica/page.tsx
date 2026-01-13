import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'vs matrica // ARRAKIS',
  description:
    'Matrica is the all-in-one Solana suite. Arrakis goes deeper on engagement intelligence. Compare community management approaches.',
};

export default function VsMatricaPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// compare / vs-matrica</div>
        <h1 className="text-2xl text-sand-bright">
          matrica covers breadth. arrakis covers depth.
        </h1>
        <p className="text-sand mt-2">
          matrica is the all-in-one community layer for solana — verification, quests,
          sales bots, and more. arrakis focuses specifically on engagement intelligence:
          understanding who your believers are.
        </p>
      </section>

      {/* Quick Comparison */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// quick_comparison</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-spice/50 p-4">
            <div className="text-spice mb-3">ARRAKIS</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-spice">+</span> conviction scoring</p>
              <p><span className="text-spice">+</span> 9-tier progression</p>
              <p><span className="text-spice">+</span> 10+ badge types</p>
              <p><span className="text-spice">+</span> shadow/coexistence mode</p>
              <p><span className="text-spice">+</span> evm-native</p>
              <p><span className="text-spice">+</span> analytics dashboard</p>
              <p><span className="text-sand-dim">-</span> no quests</p>
              <p><span className="text-sand-dim">-</span> no sales bot</p>
            </div>
            <div className="text-sand-dim text-xs mt-4 pt-3 border-t border-sand-dim/30">
              free tier available | premium: $99/mo
            </div>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright mb-3">MATRICA</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-sand-dim">+</span> token verification</p>
              <p><span className="text-sand-dim">+</span> quest system</p>
              <p><span className="text-sand-dim">+</span> sales bot</p>
              <p><span className="text-sand-dim">+</span> floor tracker</p>
              <p><span className="text-sand-dim">+</span> solana-native (8 chains)</p>
              <p><span className="text-sand-dim">+</span> telegram gating</p>
              <p><span className="text-sand-dim">-</span> no conviction scoring</p>
              <p><span className="text-sand-dim">-</span> no tiered progression</p>
            </div>
            <div className="text-sand-dim text-xs mt-4 pt-3 border-t border-sand-dim/30">
              no free tier | premium: $99/mo | pro: $199/mo
            </div>
          </div>
        </div>
      </section>

      {/* Core Difference */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// core_difference</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4 text-center">
            <div className="text-sand-dim text-xs mb-2">matrica answers:</div>
            <div className="text-sand-bright">
              &quot;how do i manage my community?&quot;
            </div>
          </div>
          <div className="border border-spice/50 p-4 text-center">
            <div className="text-sand-dim text-xs mb-2">arrakis answers:</div>
            <div className="text-spice">
              &quot;who are my true believers?&quot;
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
                <th className="text-center p-3 text-sand-dim">matrica</th>
              </tr>
            </thead>
            <tbody className="text-sand">
              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>token verification</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">nft ownership</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">fungible tokens</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">✓ (pro)</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">multi-chain</td>
                <td className="p-3 text-center text-spice">evm-native</td>
                <td className="p-3 text-center text-sand-dim">8 chains (sol-native)</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">bitcoin ordinals/runes</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓ (pro)</td>
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
                <td className="p-3">trading pattern detection</td>
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
                <td className="p-3 text-center text-sand-dim">custom roles</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">dynamic progression</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">badge gamification</td>
                <td className="p-3 text-center text-spice">10+ types</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>

              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>community tools</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">quest system</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">sales bot</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">floor tracker</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">telegram gating</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">✓ (pro)</td>
              </tr>

              <tr className="border-b border-sand-dim/10 bg-sand-dim/5">
                <td className="p-3 text-sand-bright" colSpan={3}>operations</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">free tier</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">shadow/coexistence mode</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">analytics dashboard</td>
                <td className="p-3 text-center text-spice">✓</td>
                <td className="p-3 text-center text-sand-dim">collection overview</td>
              </tr>
              <tr>
                <td className="p-3">api access</td>
                <td className="p-3 text-center text-spice">✓ (enterprise)</td>
                <td className="p-3 text-center text-sand-dim">✓</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* What Matrica Does Well */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// what_matrica_does_well</div>
        <div className="border border-sand-dim/30 p-4">
          <div className="text-sand-bright mb-3">the all-in-one solana community suite</div>
          <p className="text-sand text-sm mb-4">
            matrica has become the community layer for solana. with 300k+ verified wallets
            and coverage across solana, bitcoin ordinals, and 8 chains, they&apos;ve built a
            comprehensive toolkit.
          </p>
          <div className="grid md:grid-cols-2 gap-2 text-sm">
            <div className="text-sand"><span className="text-sand-dim">+</span> quest system drives engagement</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> sales bot tracks marketplace activity</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> floor tracker for price monitoring</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> strong solana ecosystem support</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> telegram gating (pro tier)</div>
            <div className="text-sand"><span className="text-sand-dim">+</span> bitcoin ordinals/runes support</div>
          </div>
          <p className="text-sand-dim text-sm mt-4 pt-3 border-t border-sand-dim/30">
            if you&apos;re a solana-native project wanting one tool for everything, matrica
            covers the basics well.
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
              matrica tells you who holds your token. arrakis tells you who believes in
              your project — analyzing holding duration, trading patterns, and accumulation.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              use case: weight your airdrop by conviction, not just balance.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">9_tier_progression</div>
            <p className="text-sand text-sm">
              custom roles are static. arrakis creates a dynamic journey from outsider
              to naib council. your holders see a path to status.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              use case: create council-only channels for your most committed members.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">badge_gamification</div>
            <p className="text-sand text-sm">
              10+ badge types for tenure, achievements, and community contribution.
              automatic recognition for first-wave minters and long-term holders.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              use case: og badges create visible social proof.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">free_tier_&amp;_shadow_mode</div>
            <p className="text-sand text-sm">
              matrica has no free tier. arrakis lets you start free and run in shadow
              mode alongside existing tools. zero risk evaluation.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              use case: try before you commit.
            </p>
          </div>
        </div>
      </section>

      {/* Chain Focus */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// chain_focus</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-spice/50 p-4">
            <div className="text-spice mb-2">arrakis: evm-native</div>
            <p className="text-sand text-sm">
              built for ethereum and l2s. deep evm chain support with score service
              architecture. optimized for erc20/erc721/erc1155.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              best for: ethereum, polygon, arbitrum, optimism, base
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright mb-2">matrica: solana-native</div>
            <p className="text-sand text-sm">
              built for solana ecosystem. 8 chains including solana, bitcoin, ethereum,
              polygon, eclipse, base, monad, apechain.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              best for: solana projects, bitcoin ordinals, cross-chain solana communities
            </p>
          </div>
        </div>
      </section>

      {/* Pricing Comparison */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// pricing_comparison</div>
        <div className="border border-sand-dim/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-dim/30">
                <th className="text-left p-3 text-sand-dim">tier</th>
                <th className="text-center p-3 text-spice">arrakis</th>
                <th className="text-center p-3 text-sand-dim">matrica</th>
              </tr>
            </thead>
            <tbody className="text-sand">
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">free</td>
                <td className="p-3 text-center text-spice">✓ (3 tiers)</td>
                <td className="p-3 text-center text-sand-dim">—</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">premium</td>
                <td className="p-3 text-center text-spice">$99/mo</td>
                <td className="p-3 text-center text-sand-dim">$99/mo</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">pro</td>
                <td className="p-3 text-center text-sand-dim">—</td>
                <td className="p-3 text-center text-sand-dim">$199/mo</td>
              </tr>
              <tr>
                <td className="p-3">enterprise</td>
                <td className="p-3 text-center text-spice">$399/mo</td>
                <td className="p-3 text-center text-sand-dim">custom</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-sand-dim text-xs mt-2">
          matrica add-ons: role limit increase $15/mo per 10 roles, multi-telegram $15/mo,
          snapshot plus $99/mo
        </p>
      </section>

      {/* When to Choose */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// when_to_choose</div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright text-sm mb-3">choose matrica if:</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-sand-dim">-</span> you&apos;re solana-native</p>
              <p><span className="text-sand-dim">-</span> you want one all-in-one tool</p>
              <p><span className="text-sand-dim">-</span> you need quests and sales bots</p>
              <p><span className="text-sand-dim">-</span> bitcoin ordinals matter</p>
              <p><span className="text-sand-dim">-</span> you need telegram gating</p>
            </div>
          </div>
          <div className="border border-spice/50 p-4">
            <div className="text-spice text-sm mb-3">choose arrakis if:</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-spice">+</span> you&apos;re evm-native</p>
              <p><span className="text-spice">+</span> you want conviction intelligence</p>
              <p><span className="text-spice">+</span> you&apos;re planning token distributions</p>
              <p><span className="text-spice">+</span> you want tiered progression</p>
              <p><span className="text-spice">+</span> you want to start free</p>
            </div>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright text-sm mb-3">different needs:</div>
            <div className="text-sm text-sand space-y-1">
              <p><span className="text-sand-dim">-</span> matrica = breadth (many tools)</p>
              <p><span className="text-sand-dim">-</span> arrakis = depth (engagement)</p>
              <p><span className="text-sand-dim">-</span> different chain ecosystems</p>
              <p><span className="text-sand-dim">-</span> complementary, not competitive</p>
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
              <span className="text-spice">Q:</span> we&apos;re a solana project
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> matrica is probably better for you.
              they&apos;re solana-native with deep ecosystem support. arrakis is evm-focused.
              different chains, different tools.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> we need quests for engagement
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> matrica has quests, arrakis doesn&apos;t.
              but consider: quests drive activity, conviction scoring identifies believers.
              activity ≠ commitment. both have value.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> matrica has no free tier
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> correct. matrica starts at $99/mo.
              arrakis has a free tier with basic features. if you want to try before
              committing, arrakis lets you start free.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> we&apos;re multi-chain
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> depends on your primary chain. matrica
              covers 8 chains (solana-native). arrakis is evm-native. pick based on where
              most of your community lives.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> what about conviction scoring?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> matrica doesn&apos;t have it. they tell
              you who holds tokens. arrakis analyzes behavior to identify who believes.
              if you&apos;re planning airdrops or want to recognize diamond hands, that&apos;s
              where arrakis shines.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border border-spice/50 p-6 text-center">
        <p className="text-sand-bright text-lg mb-2">
          know your believers, not just your holders
        </p>
        <p className="text-sand-dim text-sm mb-6">
          start free with arrakis. see conviction data for your evm community.
          upgrade when you&apos;re ready.
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
          no credit card • free tier available • shadow mode for zero-risk evaluation
        </p>
      </section>
    </div>
  );
}
