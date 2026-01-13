import type { Metadata } from 'next';
import Link from 'next/link';
import { AsciiAccent, AsciiDivider } from '@/components/AsciiAccent';
import { RandomAsciiChars } from '@/components/RandomAsciiChars';

export const metadata: Metadata = {
  title: 'about // ARRAKIS',
  description:
    'The #1 Dune team brings on-chain intelligence to your Discord — no SQL required. 65+ sprints. Zero code. Built on Collab.Land.',
};

export default function AboutPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section className="relative">
        <RandomAsciiChars count={10} variant="mixed" className="text-sand-dim" />
        <div className="text-sand-dim text-xs mb-2">// about</div>
        <h1 className="text-2xl text-sand-bright">
          dune analytics power. zero code required.
        </h1>
        <p className="text-sand mt-2">
          the #1 dune team brings on-chain community intelligence to your discord —
          no SQL queries, no dashboards, no data analysts needed.
        </p>
        <p className="text-spice text-sm mt-4">
          built on collab.land • powered by dune expertise
        </p>
      </section>

      <AsciiAccent variant="subtle" />

      {/* Mission */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// mission</div>
        <div className="border border-sand-dim/30 p-4 space-y-4 text-sand">
          <p>
            on-chain data holds incredible insights about your community — who&apos;s been
            holding since day one, who accumulates during dips, who really believes in
            your project.
          </p>
          <p className="text-spice">
            but getting those insights requires dune queries, dashboards, and data analysts.
            most communities can&apos;t afford that expertise.
          </p>
          <p>
            we&apos;re the #1 team on dune analytics. we&apos;ve spent years mastering on-chain
            data for protocols, DAOs, and NFT projects. now we&apos;ve packaged that expertise
            into a tool anyone can use — no SQL, no dashboards, no code.
          </p>
          <p>
            arrakis delivers conviction insights as discord roles that update automatically.
            holding duration, trading patterns, on-chain activity — all curated for you.
          </p>
          <p className="text-sand-bright">
            result: dune analytics power delivered to your discord. 15 minutes to setup.
            zero code required.
          </p>
        </div>
      </section>

      <AsciiDivider />

      {/* Story */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// story</div>

        <div className="space-y-6">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">the problem we kept seeing</div>
            <p className="text-sand mb-4">
              working as the #1 dune analytics team, we built dashboards for dozens of
              protocols. again and again, we saw the same pattern:
            </p>
            <div className="text-sm text-sand space-y-1">
              <p>
                <span className="text-sand-dim">-</span> communities wanted conviction data
                but couldn&apos;t afford data analysts
              </p>
              <p>
                <span className="text-sand-dim">-</span> airdrops went to farmers because
                nobody could identify real holders
              </p>
              <p>
                <span className="text-sand-dim">-</span> on-chain insights lived in CSVs,
                not where communities engage
              </p>
              <p>
                <span className="text-sand-dim">-</span> dashboards got stale — one-time
                snapshots don&apos;t capture dynamic communities
              </p>
            </div>
            <p className="text-sand-bright mt-4">
              powerful on-chain data existed. it just wasn&apos;t accessible.
            </p>
          </div>

          <div className="border border-spice/30 p-4">
            <div className="text-spice mb-2">the solution: dune for discord</div>
            <p className="text-sand">
              we realized we could package our dune expertise into a tool anyone could use.
              no SQL queries. no dashboard building. no data engineering.
            </p>
            <p className="text-sand mt-4">
              arrakis delivers conviction insights as discord roles. holding duration,
              trading patterns, on-chain activity — all curated into a 15-minute setup
              that updates automatically every 6 hours.
            </p>
            <p className="text-spice mt-4">
              arrakis: a dune wizard embedded in your discord.
            </p>
          </div>

          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">65+ sprints of dune expertise</div>
            <p className="text-sand mb-4">
              this isn&apos;t a weekend project. arrakis represents 65+ sprints of
              packaging our dune analytics expertise into accessible tooling:
            </p>
            <div className="text-sm text-sand space-y-1">
              <p>
                <span className="text-spice">+</span> years of on-chain analytics experience
              </p>
              <p>
                <span className="text-spice">+</span> conviction scoring algorithms — no
                queries needed
              </p>
              <p>
                <span className="text-spice">+</span> pre-built insights that update
                automatically
              </p>
              <p>
                <span className="text-spice">+</span> self-service wizard — 15 minute setup
              </p>
              <p>
                <span className="text-spice">+</span> enterprise-grade infrastructure with RLS
              </p>
            </div>
            <p className="text-sand-bright mt-4">
              the power of dune. the simplicity of a discord bot. zero code required.
            </p>
          </div>
        </div>
      </section>

      <AsciiAccent variant="default" height={2} />

      {/* Values */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// values</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">dune power, zero code</div>
            <p className="text-sand text-sm">
              on-chain analytics shouldn&apos;t require SQL expertise. we&apos;ve done the
              hard work so you don&apos;t have to.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">insights where you engage</div>
            <p className="text-sand text-sm">
              analytics in spreadsheets don&apos;t drive action. insights delivered as
              discord roles create engagement.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">curated, not overwhelming</div>
            <p className="text-sand text-sm">
              we don&apos;t dump raw data on you. we curate conviction insights into
              actionable tiers and badges.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">always fresh</div>
            <p className="text-sand text-sm">
              one-time snapshots get stale. arrakis updates every 6 hours automatically
              so your community data is always current.
            </p>
          </div>
        </div>
      </section>

      {/* Credentials */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// credentials</div>
        <div className="border border-sand-dim/30 p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
            <div>
              <div className="text-spice text-2xl">#1</div>
              <div className="text-sand-dim text-sm">dune team</div>
            </div>
            <div>
              <div className="text-spice text-2xl">0</div>
              <div className="text-sand-dim text-sm">code needed</div>
            </div>
            <div>
              <div className="text-spice text-2xl">15</div>
              <div className="text-sand-dim text-sm">min setup</div>
            </div>
            <div>
              <div className="text-spice text-2xl">6h</div>
              <div className="text-sand-dim text-sm">auto-refresh</div>
            </div>
            <div>
              <div className="text-spice text-2xl">65+</div>
              <div className="text-sand-dim text-sm">sprints</div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// contact</div>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-sand-bright mb-4">reach out</div>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-sand-dim">general:</span>{' '}
                <a
                  href="mailto:fud@0xhoneyjar.xyz"
                  className="text-sand hover:text-sand-bright"
                >
                  fud@0xhoneyjar.xyz
                </a>
              </div>
              <div>
                <span className="text-sand-dim">sales:</span>{' '}
                <a
                  href="mailto:henlo@0xhoneyjar.xyz"
                  className="text-sand hover:text-sand-bright"
                >
                  henlo@0xhoneyjar.xyz
                </a>
              </div>
              <div>
                <span className="text-sand-dim">security:</span>{' '}
                <a
                  href="mailto:security@0xhoneyjar.xyz"
                  className="text-sand hover:text-sand-bright"
                >
                  security@0xhoneyjar.xyz
                </a>
              </div>
            </div>
          </div>

          <div>
            <div className="text-sand-bright mb-4">follow</div>
            <div className="space-y-2 text-sm">
              <div>
                <a
                  href="https://dune.com/discover/creators/top-teams"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sand hover:text-sand-bright"
                >
                  <span className="text-spice">&gt;</span> dune.com/thj
                </a>
              </div>
              <div>
                <a
                  href="https://discord.gg/thehoneyjar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sand hover:text-sand-bright"
                >
                  <span className="text-spice">&gt;</span> discord.gg/thehoneyjar
                </a>
              </div>
              <div>
                <a
                  href="https://github.com/0xHoneyJar/arrakis"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sand hover:text-sand-bright"
                >
                  <span className="text-spice">&gt;</span> github.com/0xHoneyJar/arrakis
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      <AsciiAccent variant="bright" height={3} />

      {/* CTA */}
      <section className="relative border border-spice/50 p-6 text-center overflow-hidden">
        <RandomAsciiChars count={8} variant="spice" className="text-spice" minOpacity={0.05} maxOpacity={0.15} />
        <p className="text-sand-bright text-lg mb-2">ready for dune-powered community intelligence?</p>
        <p className="text-sand-dim text-sm mb-6">
          15 minutes to setup. no SQL. no data analysts. no code.
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
          powered by dune expertise • built on collab.land • zero code required
        </p>
      </section>
    </div>
  );
}
