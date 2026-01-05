import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'about // ARRAKIS',
  description:
    'Built on Collab.Land by the #1 team on Dune Analytics. 65+ sprints of development.',
};

export default function AboutPage() {
  return (
    <div className="space-y-16">
      {/* Header */}
      <section>
        <div className="text-sand-dim text-xs mb-2">// about</div>
        <h1 className="text-2xl text-sand-bright">
          built on collab.land. by the #1 team on dune analytics.
        </h1>
        <p className="text-sand mt-2">
          arrakis extends collab.land with engagement intelligence. you trust
          collab.land — we just make it smarter.
        </p>
        <p className="text-spice text-sm mt-4">
          available through the collab.land marketplace
        </p>
      </section>

      {/* Mission */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// mission</div>
        <div className="border border-sand-dim/30 p-4 space-y-4 text-sand">
          <p>
            collab.land solved token-gating. but communities deserve more than binary
            access control — they deserve to know who actually believes in their project.
          </p>
          <p className="text-spice">
            we&apos;re extending collab.land with engagement intelligence.
          </p>
          <p>
            you don&apos;t need to trust anything beyond collab.land. arrakis uses their
            infrastructure for wallet verification and token checking. we just add
            conviction scoring and tiered progression on top.
          </p>
          <p>
            we analyze on-chain behavior to identify conviction — holding duration,
            trading patterns, accumulation history. then we create tiered experiences
            that reward that commitment.
          </p>
          <p className="text-sand-bright">
            result: the same collab.land trust you rely on, with the intelligence
            to know who your real community actually is.
          </p>
        </div>
      </section>

      {/* Story */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// story</div>

        <div className="space-y-6">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">the problem we kept seeing</div>
            <p className="text-sand mb-4">
              working on dune analytics, we built dashboards for dozens of protocols.
              again and again, we saw the same pattern:
            </p>
            <div className="text-sm text-sand space-y-1">
              <p>
                <span className="text-sand-dim">-</span> communities couldn&apos;t distinguish
                believers from speculators
              </p>
              <p>
                <span className="text-sand-dim">-</span> airdrops went to farmers, diluting
                loyal holders
              </p>
              <p>
                <span className="text-sand-dim">-</span> governance participation was abysmal
              </p>
              <p>
                <span className="text-sand-dim">-</span> discord servers felt flat — everyone
                looked the same
              </p>
            </div>
            <p className="text-sand-bright mt-4">
              token-gating solved access. but it didn&apos;t solve engagement.
            </p>
          </div>

          <div className="border border-spice/30 p-4">
            <div className="text-spice mb-2">the solution we built</div>
            <p className="text-sand">
              we realized the same on-chain intelligence we used for analytics could be
              applied to community management. but we didn&apos;t want to build yet another
              platform requiring new trust. so we built on top of collab.land.
            </p>
            <p className="text-sand mt-4">
              arrakis extends collab.land with conviction scoring and tiered progression.
              you don&apos;t need to trust anything new — we use their infrastructure for
              wallet verification.
            </p>
            <p className="text-spice mt-4">
              arrakis: the engagement layer for collab.land.
            </p>
          </div>

          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">65+ sprints of building</div>
            <p className="text-sand mb-4">
              this isn&apos;t a weekend project. arrakis has been through 65+ development
              sprints building on top of collab.land:
            </p>
            <div className="text-sm text-sand space-y-1">
              <p>
                <span className="text-spice">+</span> collab.land marketplace integration
              </p>
              <p>
                <span className="text-spice">+</span> enterprise-grade postgresql with
                row-level security
              </p>
              <p>
                <span className="text-spice">+</span> two-tier architecture for 99.9%
                uptime
              </p>
              <p>
                <span className="text-spice">+</span> 9-tier progression system
                (sietchtheme)
              </p>
              <p>
                <span className="text-spice">+</span> conviction scoring powered by dune
                expertise
              </p>
            </div>
            <p className="text-sand-bright mt-4">
              we&apos;ve built something serious on a foundation you already trust.
            </p>
          </div>
        </div>
      </section>

      {/* Values */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// values</div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">intelligence over access</div>
            <p className="text-sand text-sm">
              token-gating is table stakes. the future is understanding who matters,
              not just who can enter.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">engagement through recognition</div>
            <p className="text-sand text-sm">
              people engage when they feel recognized. tiered progression and visible
              status create motivation.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">zero-risk adoption</div>
            <p className="text-sand text-sm">
              switching tools shouldn&apos;t require a leap of faith. shadow mode lets you
              validate before committing.
            </p>
          </div>
          <div className="border border-sand-dim/30 p-4">
            <div className="text-spice mb-2">security by design</div>
            <p className="text-sand text-sm">
              postgresql row-level security isn&apos;t optional — it&apos;s foundational. we
              build for enterprise even when serving small communities.
            </p>
          </div>
        </div>
      </section>

      {/* Credentials */}
      <section>
        <div className="text-sand-dim text-xs mb-4">// credentials</div>
        <div className="border border-sand-dim/30 p-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-spice text-2xl">65+</div>
              <div className="text-sand-dim text-sm">sprints</div>
            </div>
            <div>
              <div className="text-spice text-2xl">#1</div>
              <div className="text-sand-dim text-sm">dune team</div>
            </div>
            <div>
              <div className="text-spice text-2xl">99.9%</div>
              <div className="text-sand-dim text-sm">uptime</div>
            </div>
            <div>
              <div className="text-spice text-2xl">RLS</div>
              <div className="text-sand-dim text-sm">security</div>
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
                  href="mailto:hello@thehoneyjar.xyz"
                  className="text-sand hover:text-sand-bright"
                >
                  hello@thehoneyjar.xyz
                </a>
              </div>
              <div>
                <span className="text-sand-dim">sales:</span>{' '}
                <a
                  href="mailto:hello@thehoneyjar.xyz"
                  className="text-sand hover:text-sand-bright"
                >
                  hello@thehoneyjar.xyz
                </a>
              </div>
              <div>
                <span className="text-sand-dim">security:</span>{' '}
                <a
                  href="mailto:security@thehoneyjar.xyz"
                  className="text-sand hover:text-sand-bright"
                >
                  security@thehoneyjar.xyz
                </a>
              </div>
            </div>
          </div>

          <div>
            <div className="text-sand-bright mb-4">follow</div>
            <div className="space-y-2 text-sm">
              <div>
                <a
                  href="https://twitter.com/0xHoneyJar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sand hover:text-sand-bright"
                >
                  <span className="text-spice">&gt;</span> twitter @0xHoneyJar
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
                  href="https://github.com/0xHoneyJar"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sand hover:text-sand-bright"
                >
                  <span className="text-spice">&gt;</span> github.com/0xHoneyJar
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border border-spice/50 p-6 text-center">
        <p className="text-sand-bright text-lg mb-2">ready to extend collab.land?</p>
        <p className="text-sand-dim text-sm mb-6">
          install from the collab.land marketplace. same trust, more intelligence.
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
          built on collab.land • available through their marketplace
        </p>
      </section>
    </div>
  );
}
