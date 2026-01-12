import Link from 'next/link';
import type { Metadata } from 'next';
import { Medal, ChartLineUp, Users, Gear, Clock, ShieldCheck, Diamond } from '@phosphor-icons/react/dist/ssr';
import { FAQAccordion } from '@/components/FAQAccordion';

export const metadata: Metadata = {
  title: 'Pricing // ARRAKIS',
  description: 'Simple pricing for Dune-powered community intelligence. Start free, scale as you grow.',
};

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 pb-20">
      {/* Header + Pricing Grid - full viewport */}
      <div className="min-h-[calc(100vh-4rem)] flex flex-col justify-center">
        <div className="mb-12">
          <h1 className="font-display text-3xl lg:text-4xl text-sand-bright mb-4">
            Simple pricing. Scale as you grow.
          </h1>
          <p className="text-sand text-base max-w-lg">
            Start free with essential features. Upgrade when you need conviction scoring,
            more tiers, or multi-server support.
          </p>
        </div>

        {/* Pricing Grid */}
        <div className="grid md:grid-cols-3 gap-0">
        {/* Starter */}
        <div className="flex flex-col">
          <div className="border border-sand-dim/30 p-8 flex flex-col flex-1">
            <div className="font-display text-xl text-sand-bright mb-2">Starter</div>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="font-display text-4xl text-sand-bright">$0</span>
              <span className="text-sand-dim text-sm">per month</span>
            </div>

            {/* Features - aligned with other columns */}
            <div className="space-y-4 text-sm flex-1">
              <div className="flex items-center gap-3">
                <Medal weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">3 tiers</span>
              </div>
              <div className="flex items-center gap-3">
                <Users weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">1 server</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">24h data refresh</span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">Basic token gating</span>
              </div>
              <div className="flex items-center gap-3">
                <Gear weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">Shadow mode</span>
              </div>
            </div>

            <Link
              href="https://discord.gg/thehoneyjar"
              className="block w-full text-center px-4 py-3 border border-sand-dim/40 text-sand font-mono text-sm uppercase tracking-wider hover:border-sand hover:text-sand-bright transition-colors duration-150 mt-8"
            >
              Start Free
            </Link>
          </div>
          {/* Empty footer to align with other columns */}
          <div className="h-10" />
        </div>

        {/* Growth - Popular */}
        <div className="flex flex-col">
          <div className="border-y border-x md:border border-sand-dim/30 md:border-spice/50 p-8 relative flex flex-col flex-1 bg-sand-dim/5">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-spice px-3 py-1 text-xs text-black font-mono tracking-wider">
              POPULAR
            </div>
            <div className="font-display text-xl text-sand-bright mb-2">Growth</div>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="font-display text-4xl text-sand-bright">$99</span>
              <span className="text-sand-dim text-sm">per month</span>
            </div>

            {/* Features - aligned with other columns */}
            <div className="space-y-4 text-sm flex-1">
              <div className="flex items-center gap-3">
                <Medal weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand-bright">9 tiers</span>
              </div>
              <div className="flex items-center gap-3">
                <Users weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand-bright">5 servers</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand-bright">6h data refresh</span>
              </div>
              <div className="flex items-center gap-3">
                <ChartLineUp weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">Analytics dashboard</span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">Priority support</span>
              </div>
            </div>

            <Link
              href="https://discord.gg/thehoneyjar"
              className="block w-full text-center px-4 py-3 bg-spice text-black font-mono text-sm uppercase tracking-wider hover:bg-spice-bright transition-colors duration-150 mt-8"
            >
              Get Started
            </Link>
          </div>
          {/* Includes Conviction Scoring - outside card */}
          <div className="flex items-center justify-center gap-2 py-3 border border-t-0 border-sand-dim/30">
            <div className="w-4 h-4 flex items-center justify-center shrink-0" style={{ backgroundColor: '#c45c4a' }}>
              <Diamond weight="fill" className="w-2.5 h-2.5 text-black" />
            </div>
            <span className="text-sand-dim text-xs">Includes</span>
            <span className="text-sand-bright text-xs font-semibold">Conviction Scoring</span>
          </div>
        </div>

        {/* Enterprise */}
        <div className="flex flex-col">
          <div className="border border-l-0 md:border-l border-sand-dim/30 p-8 flex flex-col flex-1">
            <div className="font-display text-xl text-sand-bright mb-2">Enterprise</div>
            <div className="flex items-baseline gap-1 mb-6">
              <span className="font-display text-4xl text-sand-bright">$399</span>
              <span className="text-sand-dim text-sm">per month</span>
            </div>

            {/* Features - aligned with other columns */}
            <div className="space-y-4 text-sm flex-1">
              <div className="flex items-center gap-3">
                <Medal weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand-bright">Unlimited tiers</span>
              </div>
              <div className="flex items-center gap-3">
                <Users weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand-bright">Unlimited servers</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand-bright">1h data refresh</span>
              </div>
              <div className="flex items-center gap-3">
                <Gear weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">Custom branding</span>
              </div>
              <div className="flex items-center gap-3">
                <ChartLineUp weight="fill" className="w-4 h-4 text-sand-dim shrink-0" />
                <span className="text-sand">API access</span>
              </div>
            </div>

            <Link
              href="https://discord.gg/thehoneyjar"
              className="block w-full text-center px-4 py-3 border border-sand-dim/40 text-sand font-mono text-sm uppercase tracking-wider hover:border-sand hover:text-sand-bright transition-colors duration-150 mt-8"
            >
              Contact Us
            </Link>
          </div>
          {/* Includes Conviction Scoring - outside card */}
          <div className="flex items-center justify-center gap-2 py-3 border border-t-0 border-sand-dim/30">
            <div className="w-4 h-4 flex items-center justify-center shrink-0" style={{ backgroundColor: '#c45c4a' }}>
              <Diamond weight="fill" className="w-2.5 h-2.5 text-black" />
            </div>
            <span className="text-sand-dim text-xs">Includes</span>
            <span className="text-sand-bright text-xs font-semibold">Conviction Scoring</span>
          </div>
        </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="mb-16">
        <h2 className="font-display text-2xl text-sand-bright mb-8">
          Frequently asked questions
        </h2>
        <FAQAccordion />
      </div>

    </div>
  );
}
