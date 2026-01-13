import type { Metadata } from 'next';
import Link from 'next/link';
import { AsciiAccent, AsciiDivider } from '@/components/AsciiAccent';
import { RandomAsciiChars } from '@/components/RandomAsciiChars';

export const metadata: Metadata = {
  title: 'pricing // ARRAKIS',
  description:
    'Start free, upgrade when ready. Conviction scoring and 9-tier progression for Web3 communities.',
};

export default function PricingPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section className="relative">
        <RandomAsciiChars count={10} variant="dune" className="text-sand-dim" />
        <div className="text-sand-dim text-xs mb-2">// pricing</div>
        <h1 className="text-2xl text-sand-bright">
          simple pricing for communities of all sizes
        </h1>
        <p className="text-sand mt-2">
          start free with basictheme. upgrade to premium for conviction scoring.
        </p>
      </section>

      <AsciiAccent variant="subtle" />

      {/* Pricing Table */}
      <section>
        <pre className="text-sand text-xs overflow-x-auto whitespace-pre">
{`┌──────────────────────────────────────────────────────────────────────────────┐
│                              PRICING TIERS                                   │
├────────────────────┬────────────────────┬────────────────────────────────────┤
│                    │                    │                                    │
│   STARTER          │   GROWTH           │   ENTERPRISE                       │
│   $0/mo            │   $99/mo           │   $399/mo                          │
│   ─────────        │   ────────         │   ───────────                      │
│                    │                    │                                    │
│   [+] token-gate   │   [+] everything   │   [+] everything in growth         │
│   [+] 3 tiers      │       in starter   │   [+] custom themes                │
│   [+] 5 badges     │   [+] conviction   │   [+] unlimited servers            │
│   [+] 1 server     │       scoring      │   [+] full api access              │
│   [+] shadow mode  │   [+] 9 tiers      │   [+] audit trail                  │
│   [+] 24h refresh  │   [+] 10+ badges   │   [+] white-label                  │
│                    │   [+] analytics    │   [+] 1h refresh                   │
│   limits:          │   [+] 3 servers    │   [+] dedicated slack              │
│   - no analytics   │   [+] 6h refresh   │   [+] sla 4h response              │
│   - no conviction  │                    │                                    │
│                    │   * founding 50:   │   custom pricing                   │
│                    │     50% off life   │   for 10+ communities              │
│                    │     = $49/mo       │                                    │
│                    │                    │                                    │
└────────────────────┴────────────────────┴────────────────────────────────────┘`}
        </pre>

        <div className="mt-8 flex flex-wrap gap-4 text-sm">
          <Link
            href="https://discord.gg/thehoneyjar"
            className="text-spice hover:text-spice-bright"
          >
            [start free]
          </Link>
          <Link
            href="https://discord.gg/thehoneyjar"
            className="text-sand hover:text-sand-bright"
          >
            [upgrade to growth]
          </Link>
          <Link
            href="mailto:henlo@0xhoneyjar.xyz"
            className="text-sand hover:text-sand-bright"
          >
            [contact sales]
          </Link>
        </div>
      </section>

      {/* Feature Comparison */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// feature comparison</div>
        <div className="border border-sand-dim/30 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-dim/30">
                <th className="text-left p-3 text-sand-dim">feature</th>
                <th className="text-center p-3 text-sand-dim">starter</th>
                <th className="text-center p-3 text-spice">growth</th>
                <th className="text-center p-3 text-sand-dim">enterprise</th>
              </tr>
            </thead>
            <tbody className="text-sand">
              <tr className="border-b border-sand-dim/20">
                <td colSpan={4} className="p-2 text-sand-dim text-xs">
                  // token-gating
                </td>
              </tr>
              <FeatureRow feature="erc20 gating" starter="+" growth="+" enterprise="+" />
              <FeatureRow feature="nft gating" starter="+" growth="+" enterprise="+" />
              <FeatureRow feature="multi-chain" starter="+" growth="+" enterprise="+" />
              <FeatureRow feature="shadow mode" starter="+" growth="+" enterprise="+" />

              <tr className="border-b border-sand-dim/20">
                <td colSpan={4} className="p-2 text-sand-dim text-xs">
                  // progression
                </td>
              </tr>
              <FeatureRow feature="tier system" starter="3" growth="9" enterprise="custom" />
              <FeatureRow feature="badges" starter="5" growth="10+" enterprise="unlimited" />
              <FeatureRow feature="badge lineage" starter="-" growth="+" enterprise="+" />

              <tr className="border-b border-sand-dim/20">
                <td colSpan={4} className="p-2 text-sand-dim text-xs">
                  // intelligence
                </td>
              </tr>
              <FeatureRow feature="conviction score" starter="-" growth="+" enterprise="+" />
              <FeatureRow feature="analytics" starter="-" growth="+" enterprise="+" />
              <FeatureRow feature="holder insights" starter="-" growth="+" enterprise="+" />

              <tr className="border-b border-sand-dim/20">
                <td colSpan={4} className="p-2 text-sand-dim text-xs">
                  // platform
                </td>
              </tr>
              <FeatureRow feature="discord servers" starter="1" growth="3" enterprise="unlimited" />
              <FeatureRow feature="telegram groups" starter="-" growth="1" enterprise="unlimited" />
              <FeatureRow feature="balance refresh" starter="24h" growth="6h" enterprise="1h" />
              <FeatureRow feature="api access" starter="-" growth="read" enterprise="full" />

              <tr className="border-b border-sand-dim/20">
                <td colSpan={4} className="p-2 text-sand-dim text-xs">
                  // security
                </td>
              </tr>
              <FeatureRow feature="row-level security" starter="+" growth="+" enterprise="+" />
              <FeatureRow feature="audit trail" starter="-" growth="-" enterprise="+" />
              <FeatureRow feature="white-label" starter="-" growth="-" enterprise="+" />
            </tbody>
          </table>
        </div>
      </section>

      <AsciiDivider />

      {/* Add-ons */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// add-ons</div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between border-b border-sand-dim/20 pb-2">
            <span className="text-sand">additional discord server</span>
            <span className="text-spice">$29/mo</span>
          </div>
          <div className="flex justify-between border-b border-sand-dim/20 pb-2">
            <span className="text-sand">additional telegram group</span>
            <span className="text-spice">$19/mo</span>
          </div>
          <div className="flex justify-between border-b border-sand-dim/20 pb-2">
            <span className="text-sand">custom badge design</span>
            <span className="text-spice">$199 one-time</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sand">theme customization</span>
            <span className="text-spice">$499 one-time</span>
          </div>
        </div>
      </section>

      <AsciiAccent variant="default" height={2} />

      {/* FAQ */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// faq</div>
        <div className="space-y-6 text-sm">
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> can i try premium before paying?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> yes - shadow mode shows conviction data on
              free tier. upgrade when ready.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> what chains do you support?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> all major evm chains - ethereum, polygon,
              arbitrum, optimism, base, and more.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> can i use arrakis alongside collab.land?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> yes - shadow mode runs in parallel. zero
              risk. switch when confident.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> what&apos;s the founding 50 offer?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> first 50 premium customers get 50% off for
              life. $49/mo instead of $99/mo.
            </p>
          </div>
          <div>
            <p className="text-sand-bright">
              <span className="text-spice">Q:</span> is my data secure?
            </p>
            <p className="text-sand mt-1">
              <span className="text-sand-dim">A:</span> postgresql with row-level security.
              enterprise tier includes full audit trails.
            </p>
          </div>
        </div>
      </section>

      <AsciiAccent variant="bright" height={3} />

      {/* CTA */}
      <section className="relative border border-spice/50 p-6 text-center overflow-hidden">
        <RandomAsciiChars count={8} variant="spice" className="text-spice" minOpacity={0.05} maxOpacity={0.15} />
        <p className="text-sand-bright text-lg mb-2">ready to start?</p>
        <p className="text-sand-dim text-sm mb-6">
          free forever to get started. upgrade when conviction data proves value.
        </p>
        <div className="flex flex-wrap justify-center gap-4 text-sm">
          <Link
            href="https://discord.gg/thehoneyjar"
            className="text-spice hover:text-spice-bright"
          >
            [start free - no credit card]
          </Link>
          <Link
            href="mailto:henlo@0xhoneyjar.xyz"
            className="text-sand hover:text-sand-bright"
          >
            [contact sales]
          </Link>
        </div>
      </section>
    </div>
  );
}

function FeatureRow({
  feature,
  starter,
  growth,
  enterprise,
}: {
  feature: string;
  starter: string;
  growth: string;
  enterprise: string;
}) {
  const formatValue = (val: string) => {
    if (val === '+') return <span className="text-spice">+</span>;
    if (val === '-') return <span className="text-sand-dim">-</span>;
    return <span>{val}</span>;
  };

  return (
    <tr className="border-b border-sand-dim/10">
      <td className="p-2 text-sand">{feature}</td>
      <td className="p-2 text-center">{formatValue(starter)}</td>
      <td className="p-2 text-center">{formatValue(growth)}</td>
      <td className="p-2 text-center">{formatValue(enterprise)}</td>
    </tr>
  );
}
