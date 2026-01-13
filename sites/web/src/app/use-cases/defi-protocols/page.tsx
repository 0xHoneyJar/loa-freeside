import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'defi-protocols // ARRAKIS',
  description:
    'Enterprise-grade community infrastructure for protocols. Conviction intelligence at scale.',
};

export default function DeFiProtocolsPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// use-cases / defi-protocols</div>
        <h1 className="text-2xl text-sand-bright">
          enterprise-grade community infrastructure
        </h1>
        <p className="text-sand mt-2">
          your protocol has 50,000 discord members. but only 500 vote. arrakis
          identifies your real users, drives governance participation, and prevents
          sybil attacks — with the security your foundation requires.
        </p>
      </section>

      {/* Problem */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// protocol-scale challenges</div>
        <div className="space-y-3 text-sm">
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">low_governance_participation</span>
            <p className="text-sand mt-1">
              50,000 token holders. 500 voters. your governance proposals pass with
              a handful of wallets while the community watches from the sidelines.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">sybil_attacks_on_distributions</span>
            <p className="text-sand mt-1">
              your last airdrop went to 10,000 addresses. 8,000 were farmers. millions
              in tokens distributed to bots. your real users got diluted.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">cant_distinguish_users</span>
            <p className="text-sand mt-1">
              someone who&apos;s used your protocol for two years looks the same as
              someone who bought the dip yesterday. no way to tier access.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <span className="text-spice">security_requirements</span>
            <p className="text-sand mt-1">
              your foundation requires audit trails, data isolation, and enterprise
              slas. current discord bots are held together with duct tape.
            </p>
          </div>
        </div>
      </section>

      {/* Solution */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// protocol-grade intelligence</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">drive_governance_participation</div>
            <p className="text-sand text-sm">
              tiered recognition makes governance matter. your most active users earn
              visible status. council-level access creates incentive to engage.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: voters feel recognized. participation increases.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">prevent_sybil_attacks</div>
            <p className="text-sand text-sm">
              conviction scoring identifies real users before distributions. analyze
              holding duration, trading patterns, and protocol usage.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: airdrops go to contributors, not bots.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">enterprise_security</div>
            <p className="text-sand text-sm">
              postgresql with row-level security for complete tenant isolation. full
              audit trail for compliance. two-tier architecture ensures uptime.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: security you can document to your foundation.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">scale_for_protocols</div>
            <p className="text-sand text-sm">
              built for 100,000+ discord members per community and 1,000+ concurrent
              tenants. sub-100ms eligibility checks. 99.9% uptime architecture.
            </p>
            <p className="text-sand-dim text-xs mt-2">
              result: infrastructure that grows with your protocol.
            </p>
          </div>
        </div>
      </section>

      {/* Use Cases */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// use-cases</div>

        <div className="space-y-6">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">governance engagement</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: your protocol has active governance with weekly proposals.
              but participation hovers at 5-10%. you need engaged token holders to vote.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> implement conviction-based
                tier progression
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> create governance council
                (naib tier) for top stakeholders
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> gate governance discussion
                channels by tier
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> award &quot;voter&quot; badges for
                participation
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> surface conviction analytics
                to identify engaged vs passive
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: governance becomes aspirational. members see a path to council
              status. participation increases as engagement becomes visible.
            </p>
          </div>

          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">sybil-resistant token distribution</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: your protocol is planning a major token distribution. you&apos;ve
              been burned before — farmers claimed 60% of your last airdrop.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> run conviction analysis
                across all eligible addresses
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> identify patterns: holding
                duration, accumulation, protocol usage
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> flag suspicious addresses
                (recent buyers, known farmer patterns)
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> export conviction-weighted
                eligibility data
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> execute distribution that
                rewards genuine users
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: distribution goes to users who&apos;ve contributed for months, not
              addresses that appeared last week. your community sees fairness.
            </p>
          </div>

          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">enterprise compliance</div>
            <p className="text-sand-dim text-sm mb-3">
              scenario: your foundation requires audit trails for community tooling.
              you need to demonstrate data isolation and security practices.
            </p>
            <div className="text-sm space-y-1 text-sand">
              <p>
                <span className="text-sand-dim">[1]</span> enable full audit trail
                logging (enterprise tier)
              </p>
              <p>
                <span className="text-sand-dim">[2]</span> row-level security ensures
                complete tenant isolation
              </p>
              <p>
                <span className="text-sand-dim">[3]</span> export logs for compliance
                review
              </p>
              <p>
                <span className="text-sand-dim">[4]</span> document security
                architecture for foundation
              </p>
              <p>
                <span className="text-sand-dim">[5]</span> establish sla-backed
                support relationship
              </p>
            </div>
            <p className="text-spice text-sm mt-3">
              outcome: your foundation has the documentation they need. security
              review passes. operations are audit-ready.
            </p>
          </div>
        </div>
      </section>

      {/* Enterprise Architecture */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// enterprise_architecture</div>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">row_level_security</div>
            <p className="text-sand text-sm">
              every database query is scoped to your protocol&apos;s data. complete tenant
              isolation at the database level — not application-level filtering.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">audit_trail</div>
            <p className="text-sand text-sm">
              full logging of all admin actions: who changed tier config, when roles
              were modified, what eligibility criteria were updated.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">two_tier_architecture</div>
            <p className="text-sand text-sm">
              tier 1 provides basic verification always. tier 2 for advanced analytics
              with circuit breaker fallback. your access is never down.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-dim text-xs mb-3">// infrastructure_stack</div>
            <div className="text-sm space-y-2">
              <div className="flex justify-between text-sand">
                <span>database</span>
                <span className="text-sand-dim">postgresql 15 with rls</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>cache</span>
                <span className="text-sand-dim">redis 7</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>secrets</span>
                <span className="text-sand-dim">hcp vault</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>cloud</span>
                <span className="text-sand-dim">aws eks (kubernetes)</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>monitoring</span>
                <span className="text-sand-dim">datadog</span>
              </div>
            </div>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-sand-dim text-xs mb-3">// performance_targets</div>
            <div className="text-sm space-y-2">
              <div className="flex justify-between text-sand">
                <span>basic eligibility check</span>
                <span className="text-spice">&lt;100ms</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>advanced eligibility check</span>
                <span className="text-spice">&lt;500ms</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>concurrent communities</span>
                <span className="text-spice">1,000+</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>members per community</span>
                <span className="text-spice">100,000+</span>
              </div>
              <div className="flex justify-between text-sand">
                <span>uptime sla</span>
                <span className="text-spice">99.9%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// features for protocols</div>
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
                <td className="p-3 text-sand-dim">sybil-resistant distributions, governance weighting</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">9-tier progression</td>
                <td className="p-3 text-sand-dim">governance council, stakeholder hierarchy</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">custom themes</td>
                <td className="p-3 text-sand-dim">protocol branding, custom tier names</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">audit trail</td>
                <td className="p-3 text-sand-dim">compliance documentation, foundation requirements</td>
              </tr>
              <tr className="border-b border-sand-dim/10">
                <td className="p-3">api access</td>
                <td className="p-3 text-sand-dim">custom integrations, governance tooling</td>
              </tr>
              <tr>
                <td className="p-3">multi-chain</td>
                <td className="p-3 text-sand-dim">l2 deployments, cross-chain holdings</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Pricing */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// recommended tier</div>
        <div className="border border-spice/50 p-6">
          <div className="text-spice text-lg mb-2">enterprise $399/mo [recommended]</div>
          <div className="text-sand-dim text-xs mb-4">for defi protocols</div>

          <div className="grid md:grid-cols-2 gap-4 text-sm text-sand mb-6">
            <div className="space-y-1">
              <p>+ all premium features</p>
              <p>+ unlimited discord servers</p>
              <p>+ full api access</p>
            </div>
            <div className="space-y-1">
              <p>+ audit trail for compliance</p>
              <p>+ dedicated slack support</p>
              <p>+ custom sla available</p>
            </div>
          </div>

          <div className="border border-sand-dim/30 p-3 text-sm text-sand-dim">
            <span className="text-sand-bright">custom pricing</span> available for 10+
            community operations, custom security requirements, extended support slas,
            and on-premise considerations.
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// faq</div>
        <div className="space-y-4 text-sm">
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> we need to security review
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> happy to share architecture
              documentation. postgresql rls ensures complete data isolation. no shared
              tenant data. we welcome security audits.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> can you handle our scale?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> built for 100,000+ members per
              community and 1,000+ concurrent tenants. sub-100ms eligibility checks.
              two-tier architecture ensures availability.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> we have custom requirements
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> enterprise tier includes custom
              themes, api access, and dedicated support. for unique requirements, let&apos;s
              discuss custom arrangements.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> what about uptime?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> two-tier provider architecture
              means core token-gating works even if advanced features are degraded.
              circuit breakers ensure graceful fallback. 99.9% uptime sla available.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> this seems expensive vs free alternatives
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> free tools provide access control.
              arrakis provides intelligence. preventing one sybil-captured airdrop saves
              more than years of enterprise subscription.
            </p>
          </div>
        </div>
      </section>

      {/* Getting Started */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// enterprise evaluation</div>
        <div className="text-sm space-y-1 text-sand">
          <p>
            <span className="text-sand-dim">[1]</span> contact sales - discuss your
            protocol&apos;s requirements
          </p>
          <p>
            <span className="text-sand-dim">[2]</span> security review - we provide
            architecture documentation
          </p>
          <p>
            <span className="text-sand-dim">[3]</span> trial setup - guided enterprise
            configuration
          </p>
          <p>
            <span className="text-sand-dim">[4]</span> shadow mode - evaluate conviction
            data alongside current tools
          </p>
          <p>
            <span className="text-sand-dim">[5]</span> foundation review - document
            security and compliance
          </p>
          <p>
            <span className="text-sand-dim">[6]</span> production deployment - full
            rollout with dedicated support
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="border border-spice/50 p-6 text-center">
        <p className="text-sand-bright text-lg mb-2">
          protocol-grade community infrastructure
        </p>
        <p className="text-sand-dim text-sm mb-6">
          enterprise security. conviction intelligence. the foundation your protocol
          requires.
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <Link
            href="https://discord.gg/thehoneyjar"
            className="text-spice hover:text-spice-bright"
          >
            [contact sales]
          </Link>
          <Link href="/pricing" className="text-sand hover:text-sand-bright">
            [view pricing]
          </Link>
        </div>
        <p className="text-sand-dim text-xs mt-4">
          postgresql rls • full audit trail • 99.9% uptime sla • dedicated support
        </p>
      </section>
    </div>
  );
}
