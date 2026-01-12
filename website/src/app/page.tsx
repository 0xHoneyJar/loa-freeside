import Link from 'next/link';
import { HeroFeatures } from '@/components/HeroFeatures';
import { StatsGrid } from '@/components/StatsGrid';
import { ConvictionBoard } from '@/components/ConvictionBoard';
import { TierCards } from '@/components/TierCards';
import { ChartLineUp, Diamond, Medal } from '@phosphor-icons/react/dist/ssr';

export default function HomePage() {
  return (
    <div>
      {/* Hero Section */}
      <section className="relative min-h-[55vh] overflow-hidden">
        {/* Content */}
        <div className="relative z-10 mx-auto max-w-4xl px-6 min-h-[55vh] flex items-center">
          <div className="flex flex-col justify-center max-w-2xl">
            <p className="text-sand-dim text-xs font-mono mb-4 uppercase tracking-wider">
              from the #1 dune team
            </p>

            <h1 className="font-display text-4xl lg:text-5xl text-sand-bright mb-6">
              Dune analytics power.
              <br />
              Zero code required.
            </h1>

            <p className="text-sand text-base mb-8 max-w-lg">
              On-chain intelligence for your Discord, built on Collab.Land — no SQL, no dashboards needed.
            </p>

            <div className="flex flex-wrap gap-4">
              <Link
                href="https://discord.gg/thehoneyjar"
                className="px-5 py-2.5 bg-spice text-black font-mono text-sm uppercase tracking-wider hover:bg-spice-bright transition-colors duration-150 flex items-center gap-2"
              >
                Add to Discord
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/>
                </svg>
              </Link>
              <Link
                href="/demo"
                className="px-5 py-2.5 border border-sand-dim/40 text-sand font-mono text-sm uppercase tracking-wider hover:border-sand hover:text-sand-bright transition-colors duration-150"
              >
                View Demo
              </Link>
            </div>
          </div>
        </div>

        {/* Interactive hero image + features strip */}
        <HeroFeatures />
      </section>

      <div className="space-y-48 relative z-10 mt-20">
        {/* Feature 1: On-chain Analytics */}
        <section className="mx-auto max-w-4xl px-6">
          <div className="flex items-center gap-2 mb-6">
            <div
              className="w-6 h-6 flex items-center justify-center"
              style={{ backgroundColor: '#f4a460' }}
            >
              <ChartLineUp weight="fill" className="w-4 h-4 text-black" />
            </div>
            <span className="text-sand-bright text-xs font-mono uppercase tracking-wider">On-chain Analytics</span>
          </div>
          <h2 className="font-display text-3xl lg:text-4xl text-sand-bright mb-4">
            Dune queries. Zero SQL.
          </h2>
          <p className="text-sand text-base mb-8 max-w-2xl">
            Years of Dune expertise in a 15-minute setup. Wallet activity, trading patterns, holding duration — no SQL required.
          </p>
          <Link
            href="#features"
            className="inline-flex items-center gap-2 text-spice hover:text-spice-bright font-mono text-sm transition-colors duration-150"
          >
            Learn more
            <span>→</span>
          </Link>
          {/* Visual */}
          <StatsGrid />
        </section>

        {/* Feature 2: Conviction Scoring */}
        <section className="mx-auto max-w-4xl px-6">
          <div className="flex items-center gap-2 mb-6">
            <div
              className="w-6 h-6 flex items-center justify-center"
              style={{ backgroundColor: '#c45c4a' }}
            >
              <Diamond weight="fill" className="w-4 h-4 text-black" />
            </div>
            <span className="text-sand-bright text-xs font-mono uppercase tracking-wider">Conviction Scoring</span>
          </div>
          <h2 className="font-display text-3xl lg:text-4xl text-sand-bright mb-4">
            Diamond hands. Quantified.
          </h2>
          <p className="text-sand text-base mb-8 max-w-2xl">
            Score holder commitment by holding duration, trading patterns, and on-chain activity. Reward believers, not flippers.
          </p>
          <Link
            href="#features"
            className="inline-flex items-center gap-2 text-spice hover:text-spice-bright font-mono text-sm transition-colors duration-150"
          >
            Learn more
            <span>→</span>
          </Link>
          {/* Visual */}
          <ConvictionBoard />
        </section>

        {/* Feature 3: Tier Progression */}
        <section className="mx-auto max-w-4xl px-6">
          <div className="flex items-center gap-2 mb-6">
            <div
              className="w-6 h-6 flex items-center justify-center"
              style={{ backgroundColor: '#5b8fb9' }}
            >
              <Medal weight="fill" className="w-4 h-4 text-black" />
            </div>
            <span className="text-sand-bright text-xs font-mono uppercase tracking-wider">Tier Progression</span>
          </div>
          <h2 className="font-display text-3xl lg:text-4xl text-sand-bright mb-4">
            From Outsider to Naib Council.
          </h2>
          <p className="text-sand text-base mb-8 max-w-2xl">
            Discord roles that reflect real conviction. Members climb tiers automatically — updates every 6 hours.
          </p>
          <Link
            href="#features"
            className="inline-flex items-center gap-2 text-spice hover:text-spice-bright font-mono text-sm transition-colors duration-150"
          >
            Learn more
            <span>→</span>
          </Link>
          {/* Visual */}
          <TierCards />
        </section>

      </div>
    </div>
  );
}
