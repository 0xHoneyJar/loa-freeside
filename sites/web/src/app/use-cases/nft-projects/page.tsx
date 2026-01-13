import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'nft-projects // ARRAKIS',
  description:
    'Your mint was just the beginning. Create tiered holder experiences that reward your OGs.',
};

export default function NFTProjectsPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// use-cases / nft-projects</div>
        <h1 className="text-2xl text-sand-bright">
          your mint was just the beginning
        </h1>
        <p className="text-sand mt-2">
          engagement dies after mint. arrakis brings it back with tiered progression
          that rewards your ogs and turns floor-watchers into diamond hands.
        </p>
      </section>

      {/* Problem */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// the problem</div>
        <div className="space-y-3 text-sm">
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">post_mint_silence</span>
            <p className="text-sand mt-1">
              discord was electric during mint week. now it&apos;s crickets. the same
              people who refreshed opensea every hour are gone.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">floor_watchers_everywhere</span>
            <p className="text-sand mt-1">
              half your &quot;holders&quot; are just waiting to dump. they&apos;re not collectors —
              they&apos;re exit liquidity. but they look exactly like your believers.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">ogs_feel_invisible</span>
            <p className="text-sand mt-1">
              someone who minted day one and held through the floor gets the same
              experience as someone who bought yesterday.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">generic_discord_vibes</span>
            <p className="text-sand mt-1">
              every nft server looks the same: holder-verified channel, announcements,
              general chat. nothing special.
            </p>
          </div>
        </div>
      </section>

      {/* Solution */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// the solution</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">identify_collectors_vs_flippers</div>
            <p className="text-sand text-sm">
              conviction scoring goes beyond wallet snapshots. we track holding
              duration, accumulation patterns, and trading behavior.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: stop treating flippers the same as believers.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">9_tier_holder_progression</div>
            <p className="text-sand text-sm">
              from outsider to naib, your holders earn status as they prove
              commitment. your top 7 holders become your council.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: holding becomes a journey, not just a transaction.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">og_recognition_with_badges</div>
            <p className="text-sand text-sm">
              automatic badges for first-wave minters, long-term holders,
              multi-nft collectors, and more.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: your earliest believers finally get recognition.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">stand_out_from_generic</div>
            <p className="text-sand text-sm">
              dune-themed tiers (fedaykin, fremen, wanderer) create unique identity.
              custom themes available on enterprise.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: a discord experience as unique as your art.
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// use-cases</div>

        <div className="space-y-6">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">post-mint engagement recovery</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: you minted out 3 months ago. initial hype faded. discord
              engagement dropped 80%. you need to reignite without another mint.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> install arrakis in shadow
                mode — see holder conviction data
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> identify diamond hands
                (high conviction) vs floor-watchers (low)
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> enable 9-tier progression
                with sietchtheme
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> create tier-gated channels
                (fedaykin+ discussions, naib council)
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> roll out badge recognition
                for early minters
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: holders see a path to status. floor-watchers commit or leave.
              your believers feel recognized.
            </p>
          </div>

          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">holder airdrops done right</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: you&apos;re planning a companion drop. last time, secondary buyers
              who held for 12 hours got the same allocation as day-one minters.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> run conviction analysis on
                your holder base
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> identify holding duration
                and accumulation patterns
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> export conviction data for
                your snapshot
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> weight allocations by
                conviction score, not just ownership
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> execute distribution that
                rewards true collectors
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: your ogs get more. recent buyers get less. the community sees
              you reward loyalty.
            </p>
          </div>

          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">multi-nft holder recognition</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: some holders own 10+ pieces. others own 1. currently they get
              identical discord roles. your whales feel undervalued.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> configure tier thresholds
                based on quantity + duration
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> multi-nft holders
                automatically rank higher
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> create whale-only channels
                (naib council for top 7)
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> surface top collectors in
                member list with gold roles
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> enable holder-to-holder
                badge gifting (lineage)
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: biggest supporters get visible recognition. collector culture
              drives accumulation.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// features for nft projects</div>
        <div className="border border-sand-dim/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-dim/30">
                <th className="text-left p-3 text-sand-dim">feature</th>
                <th className="text-left p-3 text-sand-dim">use</th>
              </tr>
            </thead>
            <tbody className="text-sand">
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">conviction scoring</td>
                <td className="p-3 text-sand-dim">identify collectors vs flippers</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">9-tier progression</td>
                <td className="p-3 text-sand-dim">create aspirational holder journey</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">badge system</td>
                <td className="p-3 text-sand-dim">recognize ogs, tenure, achievements</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">shadow mode</td>
                <td className="p-3 text-sand-dim">test alongside collab.land risk-free</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">multi-chain</td>
                <td className="p-3 text-sand-dim">support collections across l2s</td>
              </tr>
              <tr>
                <td className="p-3">self-service wizard</td>
                <td className="p-3 text-sand-dim">15-minute setup, no code required</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// recommended tiers</div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright text-sm mb-1">free (explorer)</div>
            <div className="text-sand-dim text-xs mb-3">for new projects</div>
            <div className="text-sm text-sand space-y-1">
              <p>+ basictheme (3 tiers)</p>
              <p>+ token-gating</p>
              <p>+ 1 discord server</p>
              <p>+ try before you commit</p>
            </div>
          </div>
          <div className="border border-spice/50 p-4">
            <div className="text-spice text-sm mb-1">premium $99/mo [recommended]</div>
            <div className="text-sand-dim text-xs mb-3">for established collections</div>
            <div className="text-sm text-sand space-y-1">
              <p>+ conviction scoring for airdrops</p>
              <p>+ 9-tier sietchtheme progression</p>
              <p>+ badge recognition system</p>
              <p>+ analytics dashboard</p>
            </div>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright text-sm mb-1">enterprise $399/mo</div>
            <div className="text-sand-dim text-xs mb-3">for blue-chip projects</div>
            <div className="text-sm text-sand space-y-1">
              <p>+ custom themes matching brand</p>
              <p>+ unlimited servers (multi-collection)</p>
              <p>+ api access for custom tooling</p>
              <p>+ white-label option</p>
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
              <span className="text-spice">Q:</span> we&apos;re a small project
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> start free with basictheme. see
              the value before spending anything. premium is less than one secondary
              sale per month.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> our community is used to collab.land
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> shadow mode runs alongside your
              current setup. your holders won&apos;t notice until you&apos;re ready to switch.
              zero disruption.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> sounds complicated
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> 15-minute wizard. no code. choose
              your theme, enter your contract address, deploy. we guide you through every step.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> how does tier progression drive engagement?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> status is powerful. when your holders
              see a path from outsider to naib council, they&apos;re incentivized to hold and
              accumulate. visible tier roles create fomo.
            </p>
          </div>
        </div>
      </section>

      {/* Getting Started */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// quickstart</div>
        <div className="text-sm space-y-1 text-sand">
          <p>
            <span className="text-sand-dim">[1]</span> install arrakis - add bot to
            discord
          </p>
          <p>
            <span className="text-sand-dim">[2]</span> enter your contract - nft
            collection address
          </p>
          <p>
            <span className="text-sand-dim">[3]</span> choose your theme - basictheme
            (free) or sietchtheme (premium)
          </p>
          <p>
            <span className="text-sand-dim">[4]</span> configure tiers - quantity
            thresholds, duration bonuses
          </p>
          <p>
            <span className="text-sand-dim">[5]</span> create channels - tier-gated
            spaces for different holder levels
          </p>
          <p>
            <span className="text-sand-dim">[6]</span> go live - roles assigned
            automatically based on holdings
          </p>
        </div>
        <p className="text-spice text-sm mt-4">setup time: ~15 minutes</p>
      </section>

      {/* CTA */}
      <section className="border border-spice/50 p-6 text-center">
        <p className="text-sand-bright text-lg mb-2">
          turn your holders into believers
        </p>
        <p className="text-sand-dim text-sm mb-6">
          start free. see your holder conviction data. create the tiered experience
          your ogs deserve.
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
          no credit card • 15-minute setup • shadow mode = zero risk
        </p>
      </section>
    </div>
  );
}
