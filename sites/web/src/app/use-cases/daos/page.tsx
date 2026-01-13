import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'daos // ARRAKIS',
  description:
    'Find your diamond hands before airdrops and governance votes. Conviction scoring for DAOs.',
};

export default function DAOsPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// use-cases / daos</div>
        <h1 className="text-2xl text-sand-bright">
          find your diamond hands before your next airdrop
        </h1>
        <p className="text-sand mt-2">
          your dao has thousands of token holders. but how many are true believers?
        </p>
      </section>

      {/* Problem */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// the problem</div>
        <div className="space-y-3 text-sm">
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">everyone looks the same</span>
            <p className="text-sand mt-1">
              token balance doesn&apos;t tell you who held through the bear market vs who
              bought yesterday.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">airdrops go to farmers</span>
            <p className="text-sand mt-1">
              you spend months planning. then bots claim 60%+ of it. your real community
              gets diluted.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">5% governance participation</span>
            <p className="text-sand mt-1">
              thousands of holders, handful of votes. people who care have no special
              recognition.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">tool sprawl</span>
            <p className="text-sand mt-1">
              collab.land + mee6 + guild.xyz + custom scripts. it&apos;s a mess.
            </p>
          </div>
        </div>
      </section>

      {/* Solution */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// the solution</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">conviction_scoring_for_airdrops</div>
            <p className="text-sand text-sm">
              know who your diamond hands are before you distribute. scoring analyzes
              holding duration, trading patterns, activity.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: fair airdrops that reward contribution, not exploitation.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">tiered_governance_recognition</div>
            <p className="text-sand text-sm">
              your naib council (top 7) gets visible status. fedaykin elite have their
              own channels. hierarchy reflects commitment.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: governance participation increases with recognition.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">pre_airdrop_planning</div>
            <p className="text-sand text-sm">
              export conviction data for your snapshot. identify exclusions (farmers)
              and extra allocations (diamond hands).
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: distribution aligned with your dao&apos;s values.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">consolidated_tooling</div>
            <p className="text-sand text-sm">
              replace your collab.land + mee6 + scripts stack. token-gating, tiers,
              badges, analytics in one place.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: less maintenance, clearer operations.
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// use-cases</div>

        <div className="space-y-6">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">fair airdrop distribution</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: your dao is planning a major airdrop. last time, farmers claimed
              most of it.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> run shadow mode to see
                conviction scores
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> identify diamond hands vs
                recent buyers
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> export data for snapshot tool
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> weight distribution by
                conviction
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> execute with confidence
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: tokens go to members who contributed for months, not accounts
              that appeared last week.
            </p>
          </div>

          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">governance engagement</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: 3-5% participation. critical votes pass with handful of wallets.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> implement 9-tier progression
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> create naib-only channels
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> award voter badges
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> surface diamond hands
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> recognize contributors
                publicly
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: members see path to status. participation increases.
            </p>
          </div>
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// features for daos</div>
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
                <td className="p-3 text-sand-dim">identify believers for airdrops</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">9-tier progression</td>
                <td className="p-3 text-sand-dim">council hierarchy (naib, fedaykin...)</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">badge system</td>
                <td className="p-3 text-sand-dim">recognize tenure, achievements</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">shadow mode</td>
                <td className="p-3 text-sand-dim">try alongside collab.land</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">analytics</td>
                <td className="p-3 text-sand-dim">understand composition</td>
              </tr>
              <tr>
                <td className="p-3">multi-chain</td>
                <td className="p-3 text-sand-dim">aggregate across l2s</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// recommended tiers</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-spice/50 p-4">
            <div className="text-spice text-sm mb-1">premium $99/mo [recommended]</div>
            <div className="text-sand-dim text-xs mb-3">for most daos</div>
            <div className="text-sm text-sand space-y-1">
              <p>+ conviction scoring for airdrops</p>
              <p>+ 9-tier progression for governance</p>
              <p>+ analytics for decision-making</p>
              <p>+ up to 3 discord servers</p>
            </div>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-bright text-sm mb-1">enterprise $399/mo</div>
            <div className="text-sand-dim text-xs mb-3">for large daos</div>
            <div className="text-sm text-sand space-y-1">
              <p>+ unlimited servers</p>
              <p>+ api access for custom tooling</p>
              <p>+ audit trail for compliance</p>
              <p>+ custom themes for branding</p>
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
              <span className="text-spice">Q:</span> we already use collab.land
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> perfect — shadow mode runs
              alongside it. see conviction data without changing anything.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> how do we know scoring works?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> we show your data in shadow mode.
              validate before committing. if it doesn&apos;t match your intuition, don&apos;t
              switch.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> we have limited treasury budget
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> $99/mo is less than $1,200/year.
              one prevented farmer-captured airdrop pays for decades of arrakis.
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
            <span className="text-sand-dim">[2]</span> enter token - contract address
          </p>
          <p>
            <span className="text-sand-dim">[3]</span> configure tiers - choose
            sietchtheme
          </p>
          <p>
            <span className="text-sand-dim">[4]</span> enable shadow - see data alongside
            current setup
          </p>
          <p>
            <span className="text-sand-dim">[5]</span> validate - confirm scoring matches
            intuition
          </p>
          <p>
            <span className="text-sand-dim">[6]</span> go live - switch when ready
          </p>
        </div>
        <p className="text-spice text-sm mt-4">setup time: ~15 minutes</p>
      </section>

      {/* CTA */}
      <section className="border border-spice/50 p-6 text-center">
        <p className="text-sand-bright text-lg mb-2">
          know your dao, not just your token holders
        </p>
        <p className="text-sand-dim text-sm mb-6">
          start with shadow mode. see conviction data. upgrade when confident.
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
          no credit card • shadow mode = zero risk • cancel anytime
        </p>
      </section>
    </div>
  );
}
